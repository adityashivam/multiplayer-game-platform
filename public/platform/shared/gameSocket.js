const socketCache = new Map();

const STATE_SAMPLE_WINDOW = 240;
const DEFAULT_STATE_INTERVAL_MS = 1000 / 60;
const CONNECTION_NOTIFY_INTERVAL_MS = 120;

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

function quantileFromSamples(samples, q) {
  if (!Array.isArray(samples) || samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * clamp(q, 0, 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  const t = idx - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * t;
}

function pushSample(samples, value) {
  if (!Number.isFinite(value)) return;
  samples.push(value);
  if (samples.length > STATE_SAMPLE_WINDOW) {
    samples.shift();
  }
}

function toFiniteNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function getNetMeta(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  if (payload.net && typeof payload.net === "object") return payload.net;
  if (payload.__packed === 1 && payload.n && typeof payload.n === "object") return payload.n;
  return null;
}

function ensureObjectPath(root, tokens) {
  let node = root;
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const token = tokens[i];
    const nextToken = tokens[i + 1];
    const key = /^\d+$/.test(token) ? Number(token) : token;
    if (node[key] == null) {
      node[key] = /^\d+$/.test(nextToken) ? [] : {};
    }
    node = node[key];
  }
  return node;
}

function inflateStateFromSchema(schemaTokens, values) {
  const root = {};
  for (let i = 0; i < schemaTokens.length; i += 1) {
    const tokens = schemaTokens[i];
    if (!Array.isArray(tokens) || tokens.length === 0) continue;
    const parent = ensureObjectPath(root, tokens);
    const leafToken = tokens[tokens.length - 1];
    const leafKey = /^\d+$/.test(leafToken) ? Number(leafToken) : leafToken;
    parent[leafKey] = values[i];
  }
  return root;
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
  let lastNotifyMs = 0;
  let notifyTimer = null;
  let notifyPending = false;

  let prevStateArrivalMs = null;
  let prevStateSeq = null;
  let intervalEwmaMs = DEFAULT_STATE_INTERVAL_MS;
  let jitterMs = 0;
  let outOfOrderCount = 0;
  let serverTickRate = null;
  let serverMetrics = null;
  let totalExpectedPackets = 0;
  let totalReceivedPackets = 0;
  const lossWindow = [];
  const recentArrivals = [];
  const pingSamples = [];
  const jitterSamples = [];
  const lossSamples = [];

  const eventWrappers = new Map();
  const decodedStateCache = new WeakMap();
  const decodeTransport = {
    schemaPaths: null,
    schemaTokens: null,
    lastValues: null,
    lastSeq: null,
  };

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
    serverMetrics = null;
    totalExpectedPackets = 0;
    totalReceivedPackets = 0;
    lossWindow.length = 0;
    recentArrivals.length = 0;
    jitterSamples.length = 0;
    lossSamples.length = 0;
    decodeTransport.schemaPaths = null;
    decodeTransport.schemaTokens = null;
    decodeTransport.lastValues = null;
    decodeTransport.lastSeq = null;
    cachedSnapshot = null;
    snapshotDirty = true;
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

  let cachedSnapshot = null;
  let snapshotDirty = true;

  function markSnapshotDirty() {
    snapshotDirty = true;
  }

  function buildSnapshot() {
    if (cachedSnapshot && !snapshotDirty) {
      // Fast path: update only cheap fields
      cachedSnapshot.status = connectionState;
      cachedSnapshot.ping = ping;
      cachedSnapshot.jitterMs = jitterMs;
      cachedSnapshot.packetLossPct = computePacketLossPct();
      cachedSnapshot.updateRateHz = computeUpdateRateHz();
      cachedSnapshot.outOfOrderCount = outOfOrderCount;
      cachedSnapshot.serverTickRate = serverTickRate;
      cachedSnapshot.server = serverMetrics;
      return cachedSnapshot;
    }

    snapshotDirty = false;
    cachedSnapshot = {
      status: connectionState,
      ping,
      pingP95Ms: quantileFromSamples(pingSamples, 0.95),
      pingP99Ms: quantileFromSamples(pingSamples, 0.99),
      jitterMs,
      jitterP95Ms: quantileFromSamples(jitterSamples, 0.95),
      jitterP99Ms: quantileFromSamples(jitterSamples, 0.99),
      packetLossPct: computePacketLossPct(),
      packetLossP95Pct: quantileFromSamples(lossSamples, 0.95),
      packetLossP99Pct: quantileFromSamples(lossSamples, 0.99),
      updateRateHz: computeUpdateRateHz(),
      outOfOrderCount,
      serverTickRate,
      server: serverMetrics,
    };
    return cachedSnapshot;
  }

  function emitConnectionSnapshot() {
    notifyPending = false;
    notifyTimer = null;
    lastNotifyMs = performance.now();
    const snapshot = buildSnapshot();
    connectionListeners.forEach((fn) => fn(snapshot));
  }

  function scheduleConnectionNotify({ force = false } = {}) {
    if (connectionListeners.size === 0 && !force) {
      return;
    }

    if (force) {
      if (notifyTimer) {
        clearTimeout(notifyTimer);
        notifyTimer = null;
      }
      notifyPending = false;
      emitConnectionSnapshot();
      return;
    }

    notifyPending = true;
    const now = performance.now();
    if (lastNotifyMs === 0 || now - lastNotifyMs >= CONNECTION_NOTIFY_INTERVAL_MS) {
      emitConnectionSnapshot();
      return;
    }

    if (notifyTimer) return;
    const delayMs = Math.max(0, CONNECTION_NOTIFY_INTERVAL_MS - (now - lastNotifyMs));
    notifyTimer = setTimeout(() => {
      if (!notifyPending) {
        notifyTimer = null;
        return;
      }
      emitConnectionSnapshot();
    }, delayMs);
  }

  function setConnectionState(next) {
    if (next === connectionState) return;
    connectionState = next;
    scheduleConnectionNotify({ force: true });
  }

  function recordStatePacket(payload) {
    const net = getNetMeta(payload);
    if (!net) return;
    const nowMs = Date.now();

    if (prevStateArrivalMs != null) {
      const interval = Math.max(0, nowMs - prevStateArrivalMs);
      intervalEwmaMs += (interval - intervalEwmaMs) * 0.12;
      const jitterDelta = Math.abs(interval - intervalEwmaMs);
      jitterMs += (jitterDelta - jitterMs) / 16;
      pushSample(jitterSamples, jitterMs);
    }
    prevStateArrivalMs = nowMs;

    recentArrivals.push(nowMs);
    while (recentArrivals.length > 0 && nowMs - recentArrivals[0] > 5000) {
      recentArrivals.shift();
    }

    const seq = toFiniteNumber(net?.seq);
    if (seq != null) {
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

    const lossPct = computePacketLossPct();
    pushSample(lossSamples, lossPct);
    markSnapshotDirty();

    const tickRate = toFiniteNumber(net?.tickRate);
    if (tickRate != null && tickRate > 0) {
      serverTickRate = tickRate;
    }

    if (net.server && typeof net.server === "object") {
      serverMetrics = net.server;
    }

    scheduleConnectionNotify();
  }

  function decodePackedState(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
    if (payload.__packed !== 1) return payload;

    const kind = payload.k;
    if (kind === "f") {
      const schemaPaths = Array.isArray(payload.p) ? payload.p : decodeTransport.schemaPaths;
      if (!Array.isArray(schemaPaths) || schemaPaths.length === 0) return null;
      const schemaTokens = schemaPaths.map((path) => String(path).split("."));
      const values = Array.isArray(payload.v) ? payload.v : [];
      const state = inflateStateFromSchema(schemaTokens, values);

      decodeTransport.schemaPaths = schemaPaths;
      decodeTransport.schemaTokens = schemaTokens;
      decodeTransport.lastValues = values.slice();
      decodeTransport.lastSeq = toFiniteNumber(payload.s);

      if (!state.net && payload.n && typeof payload.n === "object") {
        state.net = payload.n;
      }
      return state;
    }

    if (kind === "d") {
      if (
        !Array.isArray(decodeTransport.schemaTokens) ||
        !Array.isArray(decodeTransport.lastValues) ||
        !Number.isFinite(decodeTransport.lastSeq)
      ) {
        return null;
      }

      const baseSeq = toFiniteNumber(payload.b);
      if (!Number.isFinite(baseSeq) || baseSeq !== decodeTransport.lastSeq) {
        return null;
      }

      const values = decodeTransport.lastValues.slice();
      const changes = Array.isArray(payload.c) ? payload.c : [];
      for (const change of changes) {
        if (!Array.isArray(change) || change.length < 2) continue;
        const idx = change[0];
        if (!Number.isInteger(idx) || idx < 0 || idx >= values.length) continue;
        values[idx] = change[1];
      }

      const state = inflateStateFromSchema(decodeTransport.schemaTokens, values);
      decodeTransport.lastValues = values;
      decodeTransport.lastSeq = toFiniteNumber(payload.s);

      if (!state.net && payload.n && typeof payload.n === "object") {
        state.net = payload.n;
      }
      return state;
    }

    return null;
  }

  function decodeStatePayload(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
    if (decodedStateCache.has(payload)) {
      return decodedStateCache.get(payload);
    }
    const decoded = decodePackedState(payload);
    decodedStateCache.set(payload, decoded);
    return decoded;
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

  // State packet recording is handled inside the onEvent wrapper for
  // "state" events — no need for onAny which fires on EVERY event and
  // duplicates the work.
  const handleAnyEvent = null;

  const handleEnginePing = () => {
    pingStart = performance.now();
  };

  const handleEnginePong = () => {
    if (!pingStart) return;
    ping = Math.round(performance.now() - pingStart);
    pushSample(pingSamples, ping);
    markSnapshotDirty();
    scheduleConnectionNotify();
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
        pushSample(pingSamples, ping);
        markSnapshotDirty();
        scheduleConnectionNotify();
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
      pushSample(pingSamples, ping);
      markSnapshotDirty();
      scheduleConnectionNotify();
    });
    startPingProbe();
  };

  const handleDisconnectProbe = () => {
    stopPingProbe();
    ping = null;
    pingSamples.length = 0;
    resetStateMetrics();
    cachedSnapshot = null;
    snapshotDirty = true;
    scheduleConnectionNotify({ force: true });
  };

  raw.on("connect", handleConnectProbe);
  raw.on("disconnect", handleDisconnectProbe);

  function clearWrappedHandlers(event) {
    const eventMap = eventWrappers.get(event);
    if (!eventMap) return;
    for (const wrapped of eventMap.values()) {
      raw.off(event, wrapped);
    }
    eventWrappers.delete(event);
  }

  const api = {
    onEvent(event, handler) {
      if (typeof handler !== "function") return () => {};
      const isStateEvent = event === "state";
      const wrapped = (...args) => {
        const payload = args[0];
        const shouldDecode =
          isStateEvent ||
          (payload && typeof payload === "object" && !Array.isArray(payload) && payload.__packed === 1);
        if (shouldDecode) {
          const decoded = decodeStatePayload(args[0]);
          if (!decoded) return;
          args[0] = decoded;
        }
        // Record metrics for state packets (replaces the removed onAny handler)
        if (isStateEvent) {
          recordStatePacket(args[0]);
        }
        handler(...args);
      };

      if (!eventWrappers.has(event)) {
        eventWrappers.set(event, new Map());
      }
      eventWrappers.get(event).set(handler, wrapped);
      raw.on(event, wrapped);
      return () => api.offEvent(event, handler);
    },
    offEvent(event, handler) {
      if (!event) return;
      if (handler) {
        const eventMap = eventWrappers.get(event);
        const wrapped = eventMap?.get(handler);
        if (wrapped) {
          raw.off(event, wrapped);
          eventMap.delete(handler);
          if (eventMap.size === 0) {
            eventWrappers.delete(event);
          }
        }
        return;
      }

      clearWrappedHandlers(event);
      raw.off(event);
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
      if (notifyTimer) {
        clearTimeout(notifyTimer);
        notifyTimer = null;
      }
      notifyPending = false;
      connectionListeners.clear();

      removeListener(raw, "connect", handleConnectState);
      removeListener(raw, "disconnect", handleDisconnectState);
      removeListener(raw, "connect", handleConnectProbe);
      removeListener(raw, "disconnect", handleDisconnectProbe);
      removeListener(raw.io, "reconnect_attempt", handleReconnectAttempt);
      removeListener(raw.io, "reconnect", handleReconnect);
      removeListener(raw.io, "open", handleManagerOpen);
      // onAny handler removed for performance — no cleanup needed.
      detachEngineListeners(raw.io?.engine);

      for (const event of eventWrappers.keys()) {
        clearWrappedHandlers(event);
      }

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
