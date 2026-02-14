const socketCache = new Map();
const STATE_SAMPLE_WINDOW = 180;
const DEFAULT_STATE_INTERVAL_MS = 1000 / 60;

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

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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

  let prevStateArrivalMs = null;
  let prevStateSeq = null;
  let intervalEwmaMs = DEFAULT_STATE_INTERVAL_MS;
  let jitterMs = 0;
  let outOfOrderCount = 0;
  let serverTickRate = null;
  let totalExpectedPackets = 0;
  let totalReceivedPackets = 0;
  const lossWindow = [];
  const recentArrivals = [];

  function pushLossSample(expected, received) {
    lossWindow.push({ expected, received });
    totalExpectedPackets += expected;
    totalReceivedPackets += received;
    if (lossWindow.length > STATE_SAMPLE_WINDOW) {
      const removed = lossWindow.shift();
      totalExpectedPackets -= removed.expected;
      totalReceivedPackets -= removed.received;
    }
  }

  function resetStateMetrics() {
    prevStateArrivalMs = null;
    prevStateSeq = null;
    intervalEwmaMs = DEFAULT_STATE_INTERVAL_MS;
    jitterMs = 0;
    outOfOrderCount = 0;
    serverTickRate = null;
    totalExpectedPackets = 0;
    totalReceivedPackets = 0;
    lossWindow.length = 0;
    recentArrivals.length = 0;
  }

  function computeUpdateRateHz() {
    if (recentArrivals.length < 2) return 0;
    const spanMs = recentArrivals[recentArrivals.length - 1] - recentArrivals[0];
    if (spanMs <= 0) return 0;
    return ((recentArrivals.length - 1) * 1000) / spanMs;
  }

  function computePacketLossPct() {
    const expected = Math.max(1, totalExpectedPackets);
    return clamp((1 - totalReceivedPackets / expected) * 100, 0, 100);
  }

  function buildSnapshot() {
    return {
      status: connectionState,
      ping,
      jitterMs,
      packetLossPct: computePacketLossPct(),
      updateRateHz: computeUpdateRateHz(),
      outOfOrderCount,
      serverTickRate,
    };
  }

  function notifyConnectionListeners() {
    const snapshot = buildSnapshot();
    connectionListeners.forEach((fn) => fn(snapshot));
  }

  function setConnectionState(next) {
    if (next === connectionState) return;
    connectionState = next;
    notifyConnectionListeners();
  }

  function recordStatePacket(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return;
    const nowMs = Date.now();

    if (prevStateArrivalMs != null) {
      const interval = Math.max(0, nowMs - prevStateArrivalMs);
      intervalEwmaMs += (interval - intervalEwmaMs) * 0.12;
      const jitterDelta = Math.abs(interval - intervalEwmaMs);
      jitterMs += (jitterDelta - jitterMs) / 16;
    }
    prevStateArrivalMs = nowMs;

    recentArrivals.push(nowMs);
    while (recentArrivals.length > 0 && nowMs - recentArrivals[0] > 5000) {
      recentArrivals.shift();
    }

    const net = payload.net && typeof payload.net === "object" ? payload.net : null;
    const seq = Number(net?.seq);
    if (Number.isFinite(seq)) {
      if (prevStateSeq == null) {
        pushLossSample(1, 1);
        prevStateSeq = seq;
      } else if (seq > prevStateSeq) {
        const gap = seq - prevStateSeq;
        pushLossSample(gap, 1);
        prevStateSeq = seq;
      } else if (seq < prevStateSeq) {
        outOfOrderCount += 1;
      }
    } else {
      pushLossSample(1, 1);
    }

    const tickRate = Number(net?.tickRate);
    if (Number.isFinite(tickRate) && tickRate > 0) {
      serverTickRate = tickRate;
    }
    notifyConnectionListeners();
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

  const handleAnyEvent = (event, payload) => {
    if (
      event === "state" ||
      (payload && typeof payload === "object" && !Array.isArray(payload) && payload.net)
    ) {
      recordStatePacket(payload);
    }
  };
  if (typeof raw.onAny === "function") {
    raw.onAny(handleAnyEvent);
  }

  const handleEnginePing = () => {
    pingStart = performance.now();
  };

  const handleEnginePong = () => {
    if (!pingStart) return;
    ping = Math.round(performance.now() - pingStart);
    notifyConnectionListeners();
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
        notifyConnectionListeners();
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
      notifyConnectionListeners();
    });
    startPingProbe();
  };

  const handleDisconnectProbe = () => {
    stopPingProbe();
    ping = null;
    resetStateMetrics();
    notifyConnectionListeners();
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
    getConnectionSnapshot() {
      return buildSnapshot();
    },
    onConnectionChange(callback) {
      if (typeof callback !== "function") return () => {};
      connectionListeners.add(callback);
      callback(buildSnapshot());
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
      if (typeof raw.offAny === "function") {
        raw.offAny(handleAnyEvent);
      }
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
