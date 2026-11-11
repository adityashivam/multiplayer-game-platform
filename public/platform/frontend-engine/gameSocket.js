import msgpackParser from "/platform/frontend-engine/msgpackParser.js";
import { createRoomJoinRecovery } from "./roomJoinRecovery.js";
import { publishRoomJoined, publishRoomSnapshot, publishRoomDisconnected, publishRoomRematch, publishRoomJoinFailure, resetRoomLifecycle } from "./roomLifecycleBridge.js";
import {
  NETWORK_TIMING,
  SNAPSHOT_KIND,
  SNAPSHOT_PROTOCOL,
  SOCKET_EVENT,
} from "../shared/networkProtocol.js";

/** @typedef {(...eventArguments: unknown[]) => void} SocketEventHandler */
/** @typedef {{gameId:string,playerId:string,rejoinToken:string|undefined,inputEpoch:number|undefined}} JoinedRoomOwnership */

/**
 * @typedef {object} SnapshotDecodeContext
 * @property {string[] | null} schemaPaths Game-defined flattened snapshot paths.
 * @property {string[][] | null} schemaTokens
 * @property {unknown[] | null} lastValues Baseline values indexed by schema path.
 * @property {number | null} lastSeq
 */

/**
 * @typedef {object} GameConnectionSnapshot
 * @property {"connected" | "disconnected" | "reconnecting"} status
 * @property {number | null} ping Round-trip latency in milliseconds.
 * @property {number | null} pingP95Ms
 * @property {number | null} pingP99Ms
 * @property {number} jitterMs
 * @property {number | null} jitterP95Ms
 * @property {number | null} jitterP99Ms
 * @property {number} packetLossPct Snapshot sequence gaps, not IP packet loss.
 * @property {number | null} packetLossP95Pct
 * @property {number | null} packetLossP99Pct
 * @property {number} updateRateHz
 * @property {number} outOfOrderCount
 * @property {number | null} serverTickRate
 * @property {import("../shared/networkProtocol.js").ServerTimingMetrics | null} server
 */

const socketCache = new Map();

const STATE_SAMPLE_WINDOW = 240;
const DEFAULT_STATE_INTERVAL_MS = 1000 / NETWORK_TIMING.SIMULATION_HZ;
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
  if (payload.__packed === SNAPSHOT_PROTOCOL.PACKED && payload.n && typeof payload.n === "object") return payload.n;
  return null;
}

/**
 * Write an own snapshot data property without invoking inherited setters.
 * Existing properties retain their descriptors, including native array length.
 * @param {object} target
 * @param {string|number} key
 * @param {unknown} value
 */
function defineSnapshotProperty(target, key, value) {
  if (Object.hasOwn(target, key)) {
    Object.defineProperty(target, key, { value });
    return;
  }

  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

/**
 * Create path containers in the supplied root without traversing inherited members.
 * @param {object} root
 * @param {string[]} tokens
 * @returns {object} The own container for the final path token.
 */
function ensureObjectPath(root, tokens) {
  let node = root;
  for (let i = 0; i < tokens.length - 1; i += 1) {
    const token = tokens[i];
    const nextToken = tokens[i + 1];
    const key = /^\d+$/.test(token) ? Number(token) : token;
    if (!Object.hasOwn(node, key) || node[key] == null) {
      defineSnapshotProperty(node, key, /^\d+$/.test(nextToken) ? [] : {});
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
    defineSnapshotProperty(parent, leafKey, values[i]);
  }
  return root;
}

/**
 * Reuse one connection per normalized game namespace. State subscribers share
 * decoding and metrics while each handler receives an accepted snapshot once.
 * Token rejoins blocked by their previous transport retry within a bounded window.
 * @param {string} namespace
 * @throws {Error} When the namespace or Socket.IO browser client is unavailable.
 */
export function getGameSocket(namespace) {
  const normalized = normalizeNamespace(namespace);
  if (socketCache.has(normalized)) {
    return socketCache.get(normalized);
  }

  const io = resolveSocketIo();
  const raw = io(normalized, {
    transports: ["websocket"],
    parser: msgpackParser,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 500,
    reconnectionDelayMax: 5000,
    timeout: 10000,
  });

  let connectionState = "disconnected";
  let ping = null;
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
  const suppressedRoomFullPackets = new WeakSet();
  const suppressedRoomJoinPackets = new WeakSet();
  /** @type {JoinedRoomOwnership|null} Ownership confirmed on the current transport. */
  let joinedRoomOwnership = null;
  const roomJoinRecovery = createRoomJoinRecovery({
    sendJoinRequest: (joinRequest) => raw.emit(SOCKET_EVENT.JOIN_GAME, joinRequest),
    isConnected: () => raw.connected,
    onRoomFull: (roomFullPayload) => {
      publishRoomJoinFailure(namespace, SOCKET_EVENT.ROOM_FULL);
      const roomFullSubscribers = [...(eventWrappers.get(SOCKET_EVENT.ROOM_FULL)?.keys() ?? [])];
      for (const subscriber of roomFullSubscribers) subscriber(roomFullPayload);
    },
  });
  const decodedStateCache = new WeakMap();
  /** @type {WeakMap<object, Set<SocketEventHandler>>} */
  let stateDeliveries = new WeakMap();
  /** @type {SnapshotDecodeContext} */
  const decodeTransport = {
    schemaPaths: null,
    schemaTokens: null,
    lastValues: null,
    lastSeq: null,
  };
  let lastDeliveredStateSeq = null;

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

  /** Clear snapshot metrics, sequence acceptance, and the packed delta baseline. */
  function resetSnapshotSession() {
    stateDeliveries = new WeakMap();
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
    lastDeliveredStateSeq = null;
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

  /** @type {GameConnectionSnapshot | null} */
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
    if (payload.__packed !== SNAPSHOT_PROTOCOL.PACKED) return payload;

    const kind = payload.k;
    if (kind === SNAPSHOT_KIND.FULL) {
      const schemaPaths = Array.isArray(payload.p) ? payload.p : decodeTransport.schemaPaths;
      if (!Array.isArray(schemaPaths) || schemaPaths.length === 0) return null;
      const seq = toFiniteNumber(payload.s);
      if (seq != null && Number.isFinite(decodeTransport.lastSeq) && seq <= decodeTransport.lastSeq) {
        return null;
      }
      const schemaTokens = schemaPaths.map((path) => String(path).split("."));
      const values = Array.isArray(payload.v) ? payload.v : [];
      const state = inflateStateFromSchema(schemaTokens, values);

      decodeTransport.schemaPaths = schemaPaths;
      decodeTransport.schemaTokens = schemaTokens;
      decodeTransport.lastValues = values.slice();
      decodeTransport.lastSeq = seq;

      if (!state.net && payload.n && typeof payload.n === "object") {
        state.net = payload.n;
      }
      return state;
    }

    if (kind === SNAPSHOT_KIND.DELTA) {
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
    joinedRoomOwnership = null;
    roomJoinRecovery.reset();
    publishRoomDisconnected(namespace);
    setConnectionState("disconnected");
  };

  const handleRoomFullRecovery = (roomFullPayload) => {
    if (roomJoinRecovery.receiveRoomFull(roomFullPayload)) {
      suppressedRoomFullPackets.add(roomFullPayload);
    } else {
      publishRoomJoinFailure(namespace, SOCKET_EVENT.ROOM_FULL);
    }
  };

  const handleGameJoinedRecovery = (joinedRoom) => {
    roomJoinRecovery.reset();
    if (joinedRoom && typeof joinedRoom === "object") {
      suppressedRoomJoinPackets.delete(joinedRoom);
      const sameOwnership = joinedRoomOwnership && joinedRoomOwnership.gameId === joinedRoom.gameId &&
        joinedRoomOwnership.playerId === joinedRoom.playerId && joinedRoomOwnership.rejoinToken === joinedRoom.rejoinToken &&
        joinedRoomOwnership.inputEpoch === joinedRoom.inputEpoch;
      if (sameOwnership) {
        suppressedRoomJoinPackets.add(joinedRoom);
        return;
      }
      resetSnapshotSession();
      // Retain values rather than a subscriber-mutable acknowledgement object.
      joinedRoomOwnership = {
        gameId: joinedRoom.gameId,
        playerId: joinedRoom.playerId,
        rejoinToken: joinedRoom.rejoinToken,
        inputEpoch: joinedRoom.inputEpoch,
      };
    }
    publishRoomJoined(namespace, joinedRoom);
  };
  const handleRematchStarted = () => {
    resetSnapshotSession();
    publishRoomRematch(namespace);
  };

  const handleReconnectAttempt = () => {
    setConnectionState("reconnecting");
  };

  const handleReconnect = () => {
    setConnectionState("connected");
  };

  raw.on(SOCKET_EVENT.CONNECT, handleConnectState);
  raw.on(SOCKET_EVENT.ROOM_FULL, handleRoomFullRecovery);
  raw.on(SOCKET_EVENT.GAME_JOINED, handleGameJoinedRecovery);
  // A rematch starts a fresh snapshot sequence and delta baseline on this socket.
  raw.on(SOCKET_EVENT.REMATCH_STARTED, handleRematchStarted);
  raw.on(SOCKET_EVENT.DISCONNECT, handleDisconnectState);
  raw.on(SOCKET_EVENT.STATE, receiveTransportSnapshot);
  raw.io.on(SOCKET_EVENT.RECONNECT_ATTEMPT, handleReconnectAttempt);
  raw.io.on(SOCKET_EVENT.RECONNECT, handleReconnect);

  // State packet recording is handled inside the onEvent wrapper for
  // state events — no need for onAny which fires on EVERY event and
  // duplicates the work.
  const handleAnyEvent = null;

  // Engine.IO v4 emits ping/pong together when answering a server heartbeat;
  // that local turnaround is not RTT. Only acknowledged application probes
  // supply latency measurements and quantile samples.
  function startPingProbe() {
    stopPingProbe();
    pingInterval = setInterval(() => {
      if (!raw.connected) return;
      const start = performance.now();
      raw.volatile.emit(SOCKET_EVENT.PING, () => {
        ping = Math.round(performance.now() - start);
        pushSample(pingSamples, ping);
        markSnapshotDirty();
        scheduleConnectionNotify();
      });
    }, 2000);
  }
  function stopPingProbe() {
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
  }
  const handleConnectProbe = () => {
    // Measure immediately on connect, then keep probing periodically.
    const start = performance.now();
    raw.volatile.emit(SOCKET_EVENT.PING, () => {
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
    resetSnapshotSession();
    cachedSnapshot = null;
    snapshotDirty = true;
    scheduleConnectionNotify({ force: true });
  };

  raw.on(SOCKET_EVENT.CONNECT, handleConnectProbe);
  raw.on(SOCKET_EVENT.DISCONNECT, handleDisconnectProbe);

  function clearWrappedHandlers(event) {
    const eventMap = eventWrappers.get(event);
    if (!eventMap) return;
    for (const wrapped of eventMap.values()) {
      raw.off(event, wrapped);
    }
    eventWrappers.delete(event);
  }

  /**
   * Own transport metrics and lifecycle independently of game subscriptions.
   * Older sequences are rejected before recording; repeated delivery reuses the
   * accepted snapshot's subscriber set and packed decoding baseline.
   * @param {{ net?: import("../shared/networkProtocol.js").SnapshotNetworkMetadata }} serverState
   * @returns {boolean} Whether this snapshot is accepted for delivery.
   */
  function recordAcceptedStateSnapshot(serverState) {
    let deliveredSubscribers = stateDeliveries.get(serverState);
    if (!deliveredSubscribers) {
      const sequenceNumber = toFiniteNumber(serverState?.net?.seq);
      if (sequenceNumber != null) {
        if (lastDeliveredStateSeq != null && sequenceNumber <= lastDeliveredStateSeq) {
          return false;
        }
        lastDeliveredStateSeq = sequenceNumber;
      }

      recordStatePacket(serverState);
      publishRoomSnapshot(namespace, serverState, { pingMs: ping });
      deliveredSubscribers = new Set();
      stateDeliveries.set(serverState, deliveredSubscribers);
    }
    return true;
  }

  /** Decode baselines and lifecycle before any gameplay consumer needs a frame. */
  function receiveTransportSnapshot(payload) {
    const serverState = decodeStatePayload(payload);
    if (serverState) recordAcceptedStateSnapshot(serverState);
  }

  /** Deliver each accepted snapshot once to each registered game subscriber. */
  function recordStateDelivery(serverState, subscriber) {
    if (!recordAcceptedStateSnapshot(serverState)) return false;
    const deliveredSubscribers = stateDeliveries.get(serverState);
    if (deliveredSubscribers.has(subscriber)) {
      return false;
    }
    deliveredSubscribers.add(subscriber);
    return true;
  }

  const api = {
    /**
     * @param {string} event Game-defined event name.
     * @param {SocketEventHandler} handler
     * @returns {() => void} Remove this subscriber.
     */
    onEvent(event, handler) {
      if (typeof handler !== "function") return () => {};
      const isStateEvent = event === SOCKET_EVENT.STATE;
      const wrapped = (...args) => {
        const payload = args[0];
        if (event === SOCKET_EVENT.ROOM_FULL && suppressedRoomFullPackets.has(payload)) return;
        if (event === SOCKET_EVENT.GAME_JOINED && suppressedRoomJoinPackets.has(payload)) return;
        const shouldDecode =
          isStateEvent ||
          (payload && typeof payload === "object" && !Array.isArray(payload) && payload.__packed === SNAPSHOT_PROTOCOL.PACKED);
        if (shouldDecode) {
          const decoded = decodeStatePayload(args[0]);
          if (!decoded) return;
          args[0] = decoded;
        }
        if (isStateEvent && !recordStateDelivery(args[0], handler)) {
          return;
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
    },
    send(event, payload) {
      if (event === SOCKET_EVENT.JOIN_GAME) {
        roomJoinRecovery.recordJoinRequest(payload);
        if (joinedRoomOwnership && typeof payload?.gameId === "string" && payload.gameId.length > 0 &&
            payload.gameId !== joinedRoomOwnership.gameId) {
          // A room switch releases the previous server seat even if the target is full.
          joinedRoomOwnership = null;
        }
      }
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
      resetRoomLifecycle(namespace);
      roomJoinRecovery.reset();
      stopPingProbe();
      if (notifyTimer) {
        clearTimeout(notifyTimer);
        notifyTimer = null;
      }
      notifyPending = false;
      connectionListeners.clear();

      removeListener(raw, SOCKET_EVENT.CONNECT, handleConnectState);
      removeListener(raw, SOCKET_EVENT.ROOM_FULL, handleRoomFullRecovery);
      removeListener(raw, SOCKET_EVENT.GAME_JOINED, handleGameJoinedRecovery);
      removeListener(raw, SOCKET_EVENT.REMATCH_STARTED, handleRematchStarted);
      removeListener(raw, SOCKET_EVENT.DISCONNECT, handleDisconnectState);
      removeListener(raw, SOCKET_EVENT.STATE, receiveTransportSnapshot);
      removeListener(raw, SOCKET_EVENT.CONNECT, handleConnectProbe);
      removeListener(raw, SOCKET_EVENT.DISCONNECT, handleDisconnectProbe);
      removeListener(raw.io, SOCKET_EVENT.RECONNECT_ATTEMPT, handleReconnectAttempt);
      removeListener(raw.io, SOCKET_EVENT.RECONNECT, handleReconnect);
      // onAny handler removed for performance — no cleanup needed.

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
