import { emitEvent } from "./events.js";

const MAX_ELAPSED_MS = 250;
const MAX_SIM_STEPS_PER_TICK = 5;
const CPU_SAMPLE_WINDOW = 240;
const DELTA_KEYFRAME_INTERVAL = 12;
const DELTA_CHANGE_RATIO_THRESHOLD = 0.5;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function roundTo(value, decimals = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
}

function quantileFromSamples(samples, q) {
  if (!Array.isArray(samples) || samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const index = (sorted.length - 1) * clamp(q, 0, 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * weight;
}

function ensureRoomClock(state, now, tickMs) {
  if (!state.__roomClock) {
    state.__roomClock = {
      lastNowMs: now,
      accumulatorMs: 0,
      droppedSteps: 0,
      cpuEwmaMs: 0,
      cpuSamples: [],
      lastCpuMs: 0,
      fixedTickMs: tickMs,
    };
    return state.__roomClock;
  }

  if (!Number.isFinite(state.__roomClock.fixedTickMs) || state.__roomClock.fixedTickMs !== tickMs) {
    state.__roomClock.fixedTickMs = tickMs;
  }
  return state.__roomClock;
}

function updateCpuMetrics(clock, cpuMs) {
  const safeCpu = Math.max(0, cpuMs);
  clock.lastCpuMs = safeCpu;
  if (clock.cpuEwmaMs === 0) {
    clock.cpuEwmaMs = safeCpu;
  } else {
    clock.cpuEwmaMs += (safeCpu - clock.cpuEwmaMs) * 0.18;
  }
  // Use fixed-size circular buffer to avoid shift() array mutations
  if (clock.cpuSamples.length < CPU_SAMPLE_WINDOW) {
    clock.cpuSamples.push(safeCpu);
  } else {
    if (!Number.isFinite(clock._cpuIdx)) clock._cpuIdx = 0;
    clock.cpuSamples[clock._cpuIdx] = safeCpu;
    clock._cpuIdx = (clock._cpuIdx + 1) % CPU_SAMPLE_WINDOW;
  }
}

const CPU_QUANTILE_REFRESH_TICKS = 30; // Recalculate quantiles every ~0.5s at 60Hz

function describeRoomCpu(clock) {
  if (!clock._cpuDesc) {
    clock._cpuDesc = { roomCpuMs: 0, roomCpuAvgMs: 0, roomCpuP95Ms: 0, roomCpuP99Ms: 0 };
    clock._cpuDescAge = 0;
  }
  clock._cpuDesc.roomCpuMs = roundTo(clock.lastCpuMs, 2);
  clock._cpuDesc.roomCpuAvgMs = roundTo(clock.cpuEwmaMs, 2);
  clock._cpuDescAge += 1;
  if (clock._cpuDescAge >= CPU_QUANTILE_REFRESH_TICKS) {
    clock._cpuDescAge = 0;
    clock._cpuDesc.roomCpuP95Ms = roundTo(quantileFromSamples(clock.cpuSamples, 0.95), 2);
    clock._cpuDesc.roomCpuP99Ms = roundTo(quantileFromSamples(clock.cpuSamples, 0.99), 2);
  }
  return clock._cpuDesc;
}

function ensureStateSeq(state) {
  if (!Number.isFinite(state.__netSeq)) {
    state.__netSeq = 0;
  }
  state.__netSeq += 1;
  return state.__netSeq;
}

function decorateStatePayload(payload, state, now, tickMs, roomClock, loopLagMs) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return payload;
  }

  const existingNet =
    payload.net && typeof payload.net === "object" && !Array.isArray(payload.net) ? payload.net : {};
  const seq = Number.isFinite(existingNet.seq) ? existingNet.seq : ensureStateSeq(state);
  state.__netSeq = seq;
  const tickRate = tickMs > 0 ? Math.round(1000 / tickMs) : null;

  return {
    ...payload,
    net: {
      ...existingNet,
      seq,
      serverTime: Number.isFinite(existingNet.serverTime) ? existingNet.serverTime : now,
      tickRate: Number.isFinite(existingNet.tickRate) ? existingNet.tickRate : tickRate,
      server: {
        eventLoopLagMs: roundTo(loopLagMs, 2),
        tickDriftMs: roundTo(roomClock.accumulatorMs, 2),
        droppedSteps: roomClock.droppedSteps,
        ...describeRoomCpu(roomClock),
      },
    },
  };
}

function enumerateLeafPaths(value, path, out) {
  if (value == null || typeof value !== "object") {
    out.push(path.join("."));
    return;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      out.push(path.join("."));
      return;
    }
    for (let i = 0; i < value.length; i += 1) {
      path.push(String(i));
      enumerateLeafPaths(value[i], path, out);
      path.pop();
    }
    return;
  }

  const keys = Object.keys(value).sort();
  if (keys.length === 0) {
    out.push(path.join("."));
    return;
  }
  for (const key of keys) {
    path.push(key);
    enumerateLeafPaths(value[key], path, out);
    path.pop();
  }
}

function getByPathTokens(obj, tokens) {
  let current = obj;
  for (const token of tokens) {
    if (current == null) return undefined;
    const key = /^\d+$/.test(token) ? Number(token) : token;
    current = current[key];
  }
  return current;
}

function ensureTransportState(state, payload) {
  if (!state.__transport) {
    state.__transport = {
      schemaPaths: [],
      schemaTokens: [],
      lastValues: null,
      lastSeq: null,
      lastKeyframeSeq: null,
    };
  }

  const transport = state.__transport;
  if (!Array.isArray(transport.schemaTokens) || transport.schemaTokens.length === 0) {
    const schemaPaths = [];
    enumerateLeafPaths(payload, [], schemaPaths);
    transport.schemaPaths = schemaPaths;
    transport.schemaTokens = schemaPaths.map((path) => path.split("."));
    transport.lastValues = null;
    transport.lastSeq = null;
    transport.lastKeyframeSeq = null;
  }
  return transport;
}

function hasSameSchemaPaths(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function flattenBySchema(payload, schemaTokens) {
  return schemaTokens.map((tokens) => getByPathTokens(payload, tokens));
}

function toPackedFullPayload(transport, seq, values, netMeta) {
  return {
    __packed: 1,
    k: "f",
    s: seq,
    p: transport.schemaPaths,
    v: values,
    n: netMeta,
  };
}

function toPackedDeltaPayload(seq, baseSeq, changes, netMeta) {
  return {
    __packed: 1,
    k: "d",
    s: seq,
    b: baseSeq,
    c: changes,
    n: netMeta,
  };
}

function packStatePayload(state, payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const seq = Number(payload?.net?.seq);
  if (!Number.isFinite(seq)) return payload;

  const transport = ensureTransportState(state, payload);

  // Only re-enumerate schema when we don't have one yet or periodically
  // to detect shape changes.  For stable game states the schema never
  // changes, so checking every 60th keyframe is more than enough.
  if (!Array.isArray(transport.schemaTokens) || transport.schemaTokens.length === 0 ||
      (Number.isFinite(transport._schemaCheckCounter) ? ++transport._schemaCheckCounter >= 60 : true)) {
    transport._schemaCheckCounter = 0;
    const currentSchemaPaths = [];
    enumerateLeafPaths(payload, [], currentSchemaPaths);

    if (!hasSameSchemaPaths(currentSchemaPaths, transport.schemaPaths)) {
      transport.schemaPaths = currentSchemaPaths;
      transport.schemaTokens = currentSchemaPaths.map((path) => path.split("."));
      transport.lastValues = null;
      transport.lastSeq = null;
      transport.lastKeyframeSeq = null;
    }
  }

  const values = flattenBySchema(payload, transport.schemaTokens);
  const netMeta = payload.net;

  const shouldEmitKeyframe =
    !Array.isArray(transport.lastValues) ||
    !Number.isFinite(transport.lastSeq) ||
    !Number.isFinite(transport.lastKeyframeSeq) ||
    seq - transport.lastKeyframeSeq >= DELTA_KEYFRAME_INTERVAL;

  if (shouldEmitKeyframe) {
    transport.lastValues = values;
    transport.lastSeq = seq;
    transport.lastKeyframeSeq = seq;
    return toPackedFullPayload(transport, seq, values, netMeta);
  }

  const previousValues = transport.lastValues;
  const changes = [];
  for (let i = 0; i < values.length; i += 1) {
    if (!Object.is(values[i], previousValues[i])) {
      changes.push([i, values[i]]);
    }
  }

  // Skip emission entirely when state is unchanged (saves bandwidth when idle)
  if (changes.length === 0) {
    return null;
  }

  const useDelta = changes.length <= values.length * DELTA_CHANGE_RATIO_THRESHOLD;
  const packed = useDelta
    ? toPackedDeltaPayload(seq, transport.lastSeq, changes, netMeta)
    : toPackedFullPayload(transport, seq, values, netMeta);

  transport.lastValues = values;
  transport.lastSeq = seq;
  if (!useDelta) {
    transport.lastKeyframeSeq = seq;
  }
  return packed;
}

export function tickGames({
  games,
  nsp,
  tickMs = 1000 / 60,
  dtFallback = 1 / 60,
  beforeUpdate,
  updateState,
  serializeState,
  afterEmit,
  stateEvent = "state",
  shouldCleanup,
  loopLagMs = 0,
}) {
  const now = Date.now();
  const toDelete = [];
  const fixedDt = tickMs > 0 ? tickMs / 1000 : dtFallback;

  for (const [gameId, state] of games.entries()) {
    if (shouldCleanup && shouldCleanup(state, now)) {
      toDelete.push(gameId);
      continue;
    }

    const roomClock = ensureRoomClock(state, now, tickMs);
    const elapsedMs = clamp(now - roomClock.lastNowMs, 0, MAX_ELAPSED_MS);
    roomClock.lastNowMs = now;
    roomClock.accumulatorMs += elapsedMs;

    const roomCpuStart = performance.now();
    let steps = 0;

    while (roomClock.accumulatorMs >= tickMs && steps < MAX_SIM_STEPS_PER_TICK) {
      if (beforeUpdate) {
        beforeUpdate(state, fixedDt);
      }

      if (updateState) {
        updateState(state, fixedDt);
      }

      roomClock.accumulatorMs -= tickMs;
      steps += 1;
    }

    if (roomClock.accumulatorMs >= tickMs) {
      const dropped = Math.floor(roomClock.accumulatorMs / tickMs);
      roomClock.droppedSteps += dropped;
      roomClock.accumulatorMs = roomClock.accumulatorMs % tickMs;
    }

    if (serializeState) {
      let payload = serializeState(state);
      payload = decorateStatePayload(payload, state, now, tickMs, roomClock, loopLagMs);
      payload = packStatePayload(state, payload);
      if (payload != null) {
        emitEvent({ nsp, gameId, type: stateEvent, payload, target: "game" });
      }
    }

    const roomCpuMs = performance.now() - roomCpuStart;
    updateCpuMetrics(roomClock, roomCpuMs);

    if (afterEmit) {
      const simulatedDt = steps > 0 ? steps * fixedDt : dtFallback;
      afterEmit(state, simulatedDt);
    }
  }

  for (const id of toDelete) {
    games.delete(id);
  }
}
