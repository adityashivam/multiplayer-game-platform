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

  function setConnectionState(next) {
    if (next === connectionState) return;
    connectionState = next;
    const snapshot = { status: connectionState, ping };
    connectionListeners.forEach((fn) => fn(snapshot));
  }

  raw.on("connect", () => {
    setConnectionState("connected");
  });

  raw.on("disconnect", () => {
    setConnectionState("disconnected");
  });

  raw.io.on("reconnect_attempt", () => {
    setConnectionState("reconnecting");
  });

  raw.io.on("reconnect", () => {
    setConnectionState("connected");
  });

  // Ping measurement via socket.io engine
  if (raw.io && raw.io.engine) {
    raw.io.engine.on("ping", () => {
      pingStart = performance.now();
    });
    raw.io.engine.on("pong", () => {
      if (pingStart) {
        ping = Math.round(performance.now() - pingStart);
        const snapshot = { status: connectionState, ping };
        connectionListeners.forEach((fn) => fn(snapshot));
      }
    });
  }
  // Engine may not exist yet on first connect; attach after open
  raw.io.on("open", () => {
    const engine = raw.io.engine;
    if (!engine) return;
    engine.on("ping", () => {
      pingStart = performance.now();
    });
    engine.on("pong", () => {
      if (pingStart) {
        ping = Math.round(performance.now() - pingStart);
        const snapshot = { status: connectionState, ping };
        connectionListeners.forEach((fn) => fn(snapshot));
      }
    });
  });

  // Application-level ping probe (runs every 5s for faster updates)
  let pingInterval = null;
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
  raw.on("connect", () => {
    // Measure immediately on connect, then every 5s
    const start = performance.now();
    raw.volatile.emit("__ping", () => {
      ping = Math.round(performance.now() - start);
      const snapshot = { status: connectionState, ping };
      connectionListeners.forEach((fn) => fn(snapshot));
    });
    startPingProbe();
  });
  raw.on("disconnect", () => {
    stopPingProbe();
    ping = null;
  });

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
  };

  socketCache.set(normalized, api);
  return api;
}
