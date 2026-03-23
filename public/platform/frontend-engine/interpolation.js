import { getConnectionState } from "./connectionBridge.js";

const DEFAULT_STATE_INTERVAL_MS = 1000 / 60;
const STATE_SAMPLE_WINDOW = 180;
const MIN_SAMPLE_SPACING_MS = 0.01;

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Cubic Hermite spline interpolation (C1-continuous).
 * Produces smooth velocity transitions between snapshots — the same technique
 * used by Source Engine, Unreal, and Unity for networked entity interpolation.
 *
 * @param {number} p0  Position at start
 * @param {number} v0  Velocity at start (units/sec)
 * @param {number} p1  Position at end
 * @param {number} v1  Velocity at end (units/sec)
 * @param {number} t   Normalized time [0, 1]
 * @param {number} dt  Time span between snapshots (seconds)
 */
function hermite(p0, v0, p1, v1, t, dt) {
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * p0
    + (t3 - 2 * t2 + t) * dt * v0
    + (-2 * t3 + 3 * t2) * p1
    + (t3 - t2) * dt * v1;
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
  const rttPressureMs = Math.max(0, rttMs - 65);
  // Render thread slowdown (e.g. laptop low power mode) needs more history buffer.
  const renderPenaltyMs = Math.max(0, renderIntervalMs - DEFAULT_STATE_INTERVAL_MS);

  let interpDelayMs =
    Math.max(baseInterpDelayMs, 42) +
    avgIntervalMs * 1.15 +
    jitterMs * 1.45 +
    jitterP95Ms * 0.45 +
    packetLossPct * 1.9 +
    rttPressureMs * 0.22 +
    rttBurstMs * 0.2 +
    renderPenaltyMs * 0.7;
  if (rttMs > 170) {
    interpDelayMs += (rttMs - 170) * 0.1;
  }
  if (renderIntervalMs > 30) {
    interpDelayMs += (renderIntervalMs - 30) * 0.55;
  }
  interpDelayMs = clamp(interpDelayMs, 40, 200);

  let extrapolateMs =
    10 +
    jitterMs * 0.9 +
    jitterP95Ms * 0.3 +
    packetLossPct * 1.4 +
    rttBurstMs * 0.06 +
    renderPenaltyMs * 0.2;
  if (rttMs > 170) {
    extrapolateMs += (rttMs - 170) * 0.04;
  }
  extrapolateMs = clamp(extrapolateMs, 10, 80);

  return { interpDelayMs, extrapolateMs };
}

/**
 * Creates a state interpolation controller that buffers server snapshots
 * and lerps positional data between them for smooth rendering.
 *
 * @param {Object} [config]
 * @param {number} [config.interpDelayMs=45] Base render delay behind latest state in ms.
 * @param {number} [config.maxBufferSize=10] Max snapshots to retain.
 * @param {boolean} [config.adaptive=true] Whether to auto-tune interpolation from live net quality.
 */
export function createInterpolator(config = {}) {
  const baseInterpDelayMs = config.interpDelayMs ?? 45;
  const maxBufferSize = config.maxBufferSize ?? 10;
  const adaptive = config.adaptive ?? true;
  const connectionProvider = typeof config.connectionProvider === "function"
    ? config.connectionProvider
    : getConnectionState;
  const extractVelocities = typeof config.extractVelocities === "function"
    ? config.extractVelocities
    : null;
  const metrics = createStateMetrics();
  const buffer = [];
  const _reusableResult = {};
  let _cachedKeys = null;
  let prevRenderSampleMs = null;
  let renderIntervalEwmaMs = DEFAULT_STATE_INTERVAL_MS;
  let serverTimeOffsetMs = null;
  let lastServerSampleTimeMs = null;
  let lastStateSeq = null;

  /**
   * Buffer a new server state snapshot.
   * @param {Object} state Raw server state.
   */
  function pushState(state, options = {}) {
    const nowMs = Number.isFinite(options?.timestampMs) ? options.timestampMs : performance.now();
    const net = state?.net && typeof state.net === "object" ? state.net : null;
    const seq = toFiniteNumber(net?.seq);
    if (seq != null) {
      if (lastStateSeq != null && seq <= lastStateSeq) {
        return;
      }
      lastStateSeq = seq;
    }

    let sampleTimestampMs = nowMs;
    const serverTimeMs = toFiniteNumber(net?.serverTime);
    if (serverTimeMs != null) {
      if (serverTimeOffsetMs == null) {
        serverTimeOffsetMs = nowMs - serverTimeMs;
      } else {
        // Track server clock drift slowly; avoid jitter from one packet's transit spike.
        const observedOffsetMs = nowMs - serverTimeMs;
        serverTimeOffsetMs += (observedOffsetMs - serverTimeOffsetMs) * 0.08;
      }

      let stableServerTimeMs = serverTimeMs;
      if (lastServerSampleTimeMs != null && stableServerTimeMs <= lastServerSampleTimeMs) {
        stableServerTimeMs = lastServerSampleTimeMs + MIN_SAMPLE_SPACING_MS;
      }
      lastServerSampleTimeMs = stableServerTimeMs;
      sampleTimestampMs = stableServerTimeMs + serverTimeOffsetMs;
    }

    if (buffer.length > 0) {
      const lastTimestamp = buffer[buffer.length - 1].timestamp;
      if (sampleTimestampMs <= lastTimestamp) {
        sampleTimestampMs = lastTimestamp + MIN_SAMPLE_SPACING_MS;
      }
    }

    buffer.push({ timestamp: sampleTimestampMs, data: state });
    metrics.record(state, nowMs);
    if (buffer.length > maxBufferSize) {
      buffer.splice(0, buffer.length - maxBufferSize);
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

    // renderTime is past all snapshots — optionally extrapolate
    if (bIdx >= buffer.length) {
      const latest = buffer[buffer.length - 1];
      let latestPositions = extractPositions(latest.data);
      if (!_cachedKeys) _cachedKeys = Object.keys(latestPositions);

      if (extrapolateMs > 0) {
        const lead = clamp(renderTime - latest.timestamp, 0, extrapolateMs);
        if (lead > 0) {
          // Prefer actual velocity data for extrapolation (more accurate than finite diff)
          const velLatest = extractVelocities ? extractVelocities(latest.data) : null;
          if (velLatest) {
            const leadSec = lead / 1000;
            for (let i = 0; i < _cachedKeys.length; i++) {
              const key = _cachedKeys[i];
              if (key in velLatest && Number.isFinite(velLatest[key])) {
                _reusableResult[key] = latestPositions[key] + velLatest[key] * leadSec;
              } else {
                _reusableResult[key] = latestPositions[key];
              }
            }
            latestPositions = _reusableResult;
          } else if (buffer.length >= 2) {
            // Fallback: finite-difference velocity
            const prev = buffer[buffer.length - 2];
            const range = latest.timestamp - prev.timestamp;
            if (range > 0) {
              const prevPositions = extractPositions(prev.data);
              for (let i = 0; i < _cachedKeys.length; i++) {
                const key = _cachedKeys[i];
                const velocity = (latestPositions[key] - prevPositions[key]) / range;
                _reusableResult[key] = latestPositions[key] + velocity * lead;
              }
              latestPositions = _reusableResult;
            }
          }
        }
      }

      if (buffer.length > 2) {
        buffer.splice(0, buffer.length - 2);
      }
      return latestPositions;
    }

    const stateA = buffer[aIdx];
    const stateB = buffer[bIdx];
    const range = stateB.timestamp - stateA.timestamp;
    const t = range > 0 ? clamp((renderTime - stateA.timestamp) / range, 0, 1) : 1;

    const posA = extractPositions(stateA.data);
    const posB = extractPositions(stateB.data);
    if (!_cachedKeys) _cachedKeys = Object.keys(posA);

    // Use Hermite (cubic) interpolation when velocity data is available,
    // otherwise fall back to linear lerp.
    const velA = extractVelocities ? extractVelocities(stateA.data) : null;
    const velB = extractVelocities ? extractVelocities(stateB.data) : null;
    const rangeSec = range / 1000;

    for (let i = 0; i < _cachedKeys.length; i++) {
      const key = _cachedKeys[i];
      if (
        velA && velB &&
        key in velA && key in velB &&
        Number.isFinite(velA[key]) && Number.isFinite(velB[key]) &&
        rangeSec > 0
      ) {
        _reusableResult[key] = hermite(posA[key], velA[key], posB[key], velB[key], t, rangeSec);
      } else {
        _reusableResult[key] = lerp(posA[key], posB[key], t);
      }
    }

    // Prune: discard snapshots older than stateA (in-place)
    if (aIdx > 0) {
      buffer.splice(0, aIdx);
    }

    return _reusableResult;
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
    buffer.length = 0;
    metrics.reset();
    prevRenderSampleMs = null;
    renderIntervalEwmaMs = DEFAULT_STATE_INTERVAL_MS;
    serverTimeOffsetMs = null;
    lastServerSampleTimeMs = null;
    lastStateSeq = null;
    _cachedKeys = null;
  }

  return { pushState, getInterpolatedPositions, getLatestState, getNetworkStats, reset };
}
