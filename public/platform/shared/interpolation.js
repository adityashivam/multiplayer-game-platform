import { getConnectionState } from "./connectionBridge.js";

const DEFAULT_STATE_INTERVAL_MS = 1000 / 60;
const STATE_SAMPLE_WINDOW = 180;

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function toFiniteNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function createStateMetrics() {
  let prevArrivalMs = null;
  let prevSeq = null;
  let intervalEwmaMs = DEFAULT_STATE_INTERVAL_MS;
  let jitterMs = 0;
  let outOfOrderCount = 0;
  let serverTickRate = null;
  let totalExpected = 0;
  let totalReceived = 0;
  const lossWindow = [];
  const recentArrivals = [];

  function pushLossSample(expected, received) {
    lossWindow.push({ expected, received });
    totalExpected += expected;
    totalReceived += received;
    if (lossWindow.length > STATE_SAMPLE_WINDOW) {
      const removed = lossWindow.shift();
      totalExpected -= removed.expected;
      totalReceived -= removed.received;
    }
  }

  function record(state, nowMs) {
    if (prevArrivalMs != null) {
      const interval = Math.max(0, nowMs - prevArrivalMs);
      intervalEwmaMs += (interval - intervalEwmaMs) * 0.12;
      const jitterDelta = Math.abs(interval - intervalEwmaMs);
      jitterMs += (jitterDelta - jitterMs) / 16;
    }
    prevArrivalMs = nowMs;

    recentArrivals.push(nowMs);
    while (recentArrivals.length > 0 && nowMs - recentArrivals[0] > 5000) {
      recentArrivals.shift();
    }

    const net = state?.net && typeof state.net === "object" ? state.net : null;
    const seq = toFiniteNumber(net?.seq);
    if (seq != null) {
      if (prevSeq == null) {
        pushLossSample(1, 1);
        prevSeq = seq;
      } else if (seq > prevSeq) {
        pushLossSample(seq - prevSeq, 1);
        prevSeq = seq;
      } else if (seq < prevSeq) {
        outOfOrderCount += 1;
      }
    } else {
      pushLossSample(1, 1);
    }

    const tickRate = toFiniteNumber(net?.tickRate);
    if (tickRate != null && tickRate > 0) {
      serverTickRate = tickRate;
    }
  }

  function getSnapshot() {
    let updateRateHz = 0;
    if (recentArrivals.length >= 2) {
      const spanMs = recentArrivals[recentArrivals.length - 1] - recentArrivals[0];
      if (spanMs > 0) {
        updateRateHz = ((recentArrivals.length - 1) * 1000) / spanMs;
      }
    }
    const expected = Math.max(1, totalExpected);
    const packetLossPct = clamp((1 - totalReceived / expected) * 100, 0, 100);
    return {
      avgIntervalMs: intervalEwmaMs,
      jitterMs,
      packetLossPct,
      updateRateHz,
      outOfOrderCount,
      serverTickRate,
    };
  }

  function reset() {
    prevArrivalMs = null;
    prevSeq = null;
    intervalEwmaMs = DEFAULT_STATE_INTERVAL_MS;
    jitterMs = 0;
    outOfOrderCount = 0;
    serverTickRate = null;
    totalExpected = 0;
    totalReceived = 0;
    lossWindow.length = 0;
    recentArrivals.length = 0;
  }

  return {
    record,
    getSnapshot,
    reset,
  };
}

function deriveAdaptiveSmoothing(baseInterpDelayMs, metrics, runtimeOptions, connectionProvider) {
  const avgIntervalMs = metrics?.avgIntervalMs ?? DEFAULT_STATE_INTERVAL_MS;
  const jitterMs = metrics?.jitterMs ?? 0;
  const renderIntervalMs =
    toFiniteNumber(runtimeOptions?.renderIntervalMs) ??
    DEFAULT_STATE_INTERVAL_MS;
  const connection = typeof connectionProvider === "function" ? connectionProvider() || {} : {};
  const packetLossPct =
    toFiniteNumber(runtimeOptions?.packetLossPct) ??
    toFiniteNumber(connection?.packetLossPct) ??
    metrics?.packetLossPct ??
    0;

  const rttMs =
    toFiniteNumber(runtimeOptions?.pingMs) ??
    toFiniteNumber(connection?.ping) ??
    0;
  const rttP95Ms =
    toFiniteNumber(runtimeOptions?.pingP95Ms) ??
    toFiniteNumber(connection?.pingP95Ms) ??
    rttMs;
  const jitterP95Ms =
    toFiniteNumber(runtimeOptions?.jitterP95Ms) ??
    toFiniteNumber(connection?.jitterP95Ms) ??
    jitterMs;

  // Tail-latency gap predicts burstiness better than average ping.
  const rttBurstMs = Math.max(0, rttP95Ms - rttMs);
  // Render thread slowdown (e.g. laptop low power mode) needs more history buffer.
  const renderPenaltyMs = Math.max(0, renderIntervalMs - DEFAULT_STATE_INTERVAL_MS);

  let interpDelayMs =
    Math.max(baseInterpDelayMs, 55) +
    avgIntervalMs * 1.35 +
    jitterMs * 2.4 +
    jitterP95Ms * 0.9 +
    packetLossPct * 4 +
    rttBurstMs * 0.2 +
    renderPenaltyMs * 1.65;
  if (rttMs > 90) {
    interpDelayMs += (rttMs - 90) * 0.2;
  }
  if (rttMs > 180) {
    interpDelayMs += (rttMs - 180) * 0.08;
  }
  if (renderIntervalMs > 28) {
    interpDelayMs += (renderIntervalMs - 28) * 1.1;
  }
  interpDelayMs = clamp(interpDelayMs, 55, 280);

  let extrapolateMs =
    10 +
    jitterMs * 1.2 +
    jitterP95Ms * 0.45 +
    packetLossPct * 2.2 +
    rttBurstMs * 0.08 +
    renderPenaltyMs * 0.35;
  if (rttMs > 170) {
    extrapolateMs += (rttMs - 170) * 0.06;
  }
  extrapolateMs = clamp(extrapolateMs, 10, 120);

  return { interpDelayMs, extrapolateMs };
}

/**
 * Creates a state interpolation controller that buffers server snapshots
 * and lerps positional data between them for smooth rendering.
 *
 * @param {Object} [config]
 * @param {number} [config.interpDelayMs=50] Base render delay behind latest state in ms.
 * @param {number} [config.maxBufferSize=10] Max snapshots to retain.
 * @param {boolean} [config.adaptive=true] Whether to auto-tune interpolation from live net quality.
 */
export function createInterpolator(config = {}) {
  const baseInterpDelayMs = config.interpDelayMs ?? 50;
  const maxBufferSize = config.maxBufferSize ?? 10;
  const adaptive = config.adaptive ?? true;
  const connectionProvider = typeof config.connectionProvider === "function"
    ? config.connectionProvider
    : getConnectionState;
  const metrics = createStateMetrics();
  let buffer = [];
  let prevRenderSampleMs = null;
  let renderIntervalEwmaMs = DEFAULT_STATE_INTERVAL_MS;

  /**
   * Buffer a new server state snapshot.
   * @param {Object} state Raw server state.
   */
  function pushState(state, options = {}) {
    const timestampMs = Number.isFinite(options?.timestampMs) ? options.timestampMs : performance.now();
    const nowMs = timestampMs;
    buffer.push({ timestamp: nowMs, data: state });
    metrics.record(state, nowMs);
    if (buffer.length > maxBufferSize) {
      buffer.shift();
    }
  }

  function getRuntimeSmoothing(runtimeOptions = {}) {
    const effectiveOptions = {
      ...runtimeOptions,
      renderIntervalMs: runtimeOptions.renderIntervalMs ?? renderIntervalEwmaMs,
    };
    if (!adaptive) {
      return {
        interpDelayMs: effectiveOptions.interpDelayMs ?? baseInterpDelayMs,
        extrapolateMs: effectiveOptions.extrapolateMs ?? 0,
      };
    }
    const tuned = deriveAdaptiveSmoothing(
      baseInterpDelayMs,
      metrics.getSnapshot(),
      effectiveOptions,
      connectionProvider,
    );
    return {
      interpDelayMs: effectiveOptions.interpDelayMs ?? tuned.interpDelayMs,
      extrapolateMs: effectiveOptions.extrapolateMs ?? tuned.extrapolateMs,
    };
  }

  /**
   * Sample the buffer and return interpolated positional values.
   *
   * @param {(state: Object) => Record<string, number>} extractPositions
   *   Game-specific function that pulls numeric fields to interpolate.
   * @returns {Record<string, number> | null} Interpolated positions, or null if buffer is empty.
   */
  function getInterpolatedPositions(extractPositions, runtimeOptions = {}) {
    if (buffer.length === 0) return null;

    const nowMs = runtimeOptions.nowMs ?? performance.now();
    if (prevRenderSampleMs != null) {
      const deltaMs = clamp(nowMs - prevRenderSampleMs, 0, 250);
      renderIntervalEwmaMs += (deltaMs - renderIntervalEwmaMs) * 0.1;
    }
    prevRenderSampleMs = nowMs;

    const smoothing = getRuntimeSmoothing(runtimeOptions);
    const delayMs = smoothing.interpDelayMs;
    const extrapolateMs = smoothing.extrapolateMs;
    const renderTime = nowMs - delayMs;

    // Find stateA: last snapshot with timestamp <= renderTime
    let aIdx = -1;
    for (let i = buffer.length - 1; i >= 0; i--) {
      if (buffer[i].timestamp <= renderTime) {
        aIdx = i;
        break;
      }
    }

    // renderTime is before all snapshots — use earliest
    if (aIdx === -1) {
      return extractPositions(buffer[0].data);
    }

    const bIdx = aIdx + 1;

    // renderTime is past all snapshots — optionally extrapolate from recent velocity
    if (bIdx >= buffer.length) {
      const latest = buffer[buffer.length - 1];
      let latestPositions = extractPositions(latest.data);

      if (extrapolateMs > 0 && buffer.length >= 2) {
        const prev = buffer[buffer.length - 2];
        const range = latest.timestamp - prev.timestamp;
        const lead = clamp(renderTime - latest.timestamp, 0, extrapolateMs);
        if (range > 0 && lead > 0) {
          const prevPositions = extractPositions(prev.data);
          const extrapolated = {};
          for (const key of Object.keys(latestPositions)) {
            const velocity = (latestPositions[key] - prevPositions[key]) / range;
            extrapolated[key] = latestPositions[key] + velocity * lead;
          }
          latestPositions = extrapolated;
        }
      }

      if (buffer.length > 2) {
        buffer = buffer.slice(-2);
      }
      return latestPositions;
    }

    const stateA = buffer[aIdx];
    const stateB = buffer[bIdx];
    const range = stateB.timestamp - stateA.timestamp;
    const t = range > 0 ? clamp((renderTime - stateA.timestamp) / range, 0, 1) : 1;

    const posA = extractPositions(stateA.data);
    const posB = extractPositions(stateB.data);

    const result = {};
    for (const key of Object.keys(posA)) {
      result[key] = lerp(posA[key], posB[key], t);
    }

    // Prune: discard snapshots older than stateA
    if (aIdx > 0) {
      buffer = buffer.slice(aIdx);
    }

    return result;
  }

  /**
   * Return the most recently received raw server state.
   * @returns {Object | null}
   */
  function getLatestState() {
    return buffer.length > 0 ? buffer[buffer.length - 1].data : null;
  }

  function getNetworkStats() {
    const snapshot = metrics.getSnapshot();
    const tuned = deriveAdaptiveSmoothing(
      baseInterpDelayMs,
      snapshot,
      { renderIntervalMs: renderIntervalEwmaMs },
      connectionProvider,
    );
    return {
      ...snapshot,
      renderIntervalMs: renderIntervalEwmaMs,
      renderFps: renderIntervalEwmaMs > 0 ? 1000 / renderIntervalEwmaMs : null,
      interpDelayMs: tuned.interpDelayMs,
      extrapolateMs: tuned.extrapolateMs,
    };
  }

  /** Clear the buffer (call on scene re-entry, rematch, etc). */
  function reset() {
    buffer = [];
    metrics.reset();
    prevRenderSampleMs = null;
    renderIntervalEwmaMs = DEFAULT_STATE_INTERVAL_MS;
  }

  return { pushState, getInterpolatedPositions, getLatestState, getNetworkStats, reset };
}
