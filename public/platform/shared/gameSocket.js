const socketCache = new Map();

function normalizeNamespace(namespace) {
  if (!namespace) {
    throw new Error("Game socket namespace is required.");
  }
  return namespace.startsWith("/") ? namespace : `/${namespace}`;
}

function resolveSocketIo() {
  if (typeof window === "undefined" || typeof window.io !== "function") {
    throw new Error("Socket.io client is not available.");
  }
  return window.io;
}

function removeListener(emitter, event, handler) {
  if (!emitter || typeof handler !== "function") return;
  if (typeof emitter.off === "function") {
    emitter.off(event, handler);
    return;
  }
  if (typeof emitter.removeListener === "function") {
    emitter.removeListener(event, handler);
  }
}

export function getGameSocket(namespace) {
  const normalized = normalizeNamespace(namespace);
  if (socketCache.has(normalized)) {
    return socketCache.get(normalized);
  }

  const io = resolveSocketIo();
  const raw = io(normalized, {
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
    timeout: 10000,
  });

  let connectionState = "disconnected";
  let ping = null;
  let pingStart = 0;
  const connectionListeners = new Set();
  let pingInterval = null;

  function setConnectionState(next) {
    if (next === connectionState) return;
    connectionState = next;
    const snapshot = { status: connectionState, ping };
    connectionListeners.forEach((fn) => fn(snapshot));
  }

  const handleConnectState = () => {
    setConnectionState("connected");
  };

  const handleDisconnectState = () => {
    setConnectionState("disconnected");
  };

  const handleReconnectAttempt = () => {
    setConnectionState("reconnecting");
  };

  const handleReconnect = () => {
    setConnectionState("connected");
  };

  raw.on("connect", handleConnectState);
  raw.on("disconnect", handleDisconnectState);
  raw.io.on("reconnect_attempt", handleReconnectAttempt);
  raw.io.on("reconnect", handleReconnect);

  const handleEnginePing = () => {
    pingStart = performance.now();
  };

  const handleEnginePong = () => {
    if (!pingStart) return;
    ping = Math.round(performance.now() - pingStart);
    const snapshot = { status: connectionState, ping };
    connectionListeners.forEach((fn) => fn(snapshot));
  };

  function attachEngineListeners(engine) {
    if (!engine) return;
    if (typeof engine.on === "function") {
      engine.on("ping", handleEnginePing);
      engine.on("pong", handleEnginePong);
    }
  }

  function detachEngineListeners(engine) {
    if (!engine) return;
    removeListener(engine, "ping", handleEnginePing);
    removeListener(engine, "pong", handleEnginePong);
  }

  const handleManagerOpen = () => {
    attachEngineListeners(raw.io.engine);
  };

  // Ping measurement via socket.io engine
  if (raw.io && raw.io.engine) {
    attachEngineListeners(raw.io.engine);
  }
  // Engine may not exist yet on first connect; attach after open
  raw.io.on("open", handleManagerOpen);

  // Application-level ping probe (runs every 5s for faster updates)
  function startPingProbe() {
    stopPingProbe();
    pingInterval = setInterval(() => {
      if (!raw.connected) return;
      const start = performance.now();
      raw.volatile.emit("__ping", () => {
        ping = Math.round(performance.now() - start);
        const snapshot = { status: connectionState, ping };
        connectionListeners.forEach((fn) => fn(snapshot));
      });
    }, 5000);
  }
  function stopPingProbe() {
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
  }
  const handleConnectProbe = () => {
    // Measure immediately on connect, then every 5s
    const start = performance.now();
    raw.volatile.emit("__ping", () => {
      ping = Math.round(performance.now() - start);
      const snapshot = { status: connectionState, ping };
      connectionListeners.forEach((fn) => fn(snapshot));
    });
    startPingProbe();
  };

  const handleDisconnectProbe = () => {
    stopPingProbe();
    ping = null;
  };

  raw.on("connect", handleConnectProbe);
  raw.on("disconnect", handleDisconnectProbe);

  const api = {
    onEvent(event, handler) {
      if (typeof handler !== "function") return () => {};
      raw.on(event, handler);
      return () => raw.off(event, handler);
    },
    offEvent(event, handler) {
      if (handler) {
        raw.off(event, handler);
      } else {
        raw.off(event);
      }
    },
    send(event, payload) {
      raw.emit(event, payload);
    },
    isConnected() {
      return raw.connected;
    },
    getConnectionState() {
      return connectionState;
    },
    getPing() {
      return ping;
    },
    onConnectionChange(callback) {
      if (typeof callback !== "function") return () => {};
      connectionListeners.add(callback);
      callback({ status: connectionState, ping });
      return () => connectionListeners.delete(callback);
    },
    destroy() {
      stopPingProbe();
      connectionListeners.clear();

      removeListener(raw, "connect", handleConnectState);
      removeListener(raw, "disconnect", handleDisconnectState);
      removeListener(raw, "connect", handleConnectProbe);
      removeListener(raw, "disconnect", handleDisconnectProbe);
      removeListener(raw.io, "reconnect_attempt", handleReconnectAttempt);
      removeListener(raw.io, "reconnect", handleReconnect);
      removeListener(raw.io, "open", handleManagerOpen);
      detachEngineListeners(raw.io?.engine);

      if (typeof raw.removeAllListeners === "function") {
        raw.removeAllListeners();
      }
      if (typeof raw.disconnect === "function") {
        raw.disconnect();
      }

      socketCache.delete(normalized);
    },
  };

  socketCache.set(normalized, api);
  return api;
}
