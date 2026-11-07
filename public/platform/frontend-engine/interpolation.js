import { getConnectionState } from "./connectionBridge.js";
import { NETWORK_TIMING } from "../shared/networkProtocol.js";

const DEFAULT_STATE_INTERVAL_MS = 1000 / NETWORK_TIMING.SIMULATION_HZ;
const STATE_SAMPLE_WINDOW = 180;
const MIN_SAMPLE_SPACING_MS = 0.01;
const DEFAULT_MAX_BUFFER_SIZE = 32;
const MIN_BUFFERED_SNAPSHOT_INTERVALS = 2;
const MAX_PLAYBACK_CORRECTION_RATIO = 0.25;

/**
 * @typedef {object} InterpolationRuntimeOptions
 * @property {number} [nowMs] Render clock in milliseconds.
 * @property {number} [renderIntervalMs]
 * @property {number} [interpDelayMs]
 * @property {number} [extrapolateMs]
 * @property {number} [packetLossPct] Snapshot sequence gaps, not IP packet loss.
 * @property {number} [pingMs] Round-trip latency.
 * @property {number} [pingP95Ms]
 * @property {number} [jitterP95Ms]
 */

/**
 * @typedef {object} InterpolationConnectionMetrics
 * @property {number | null} [packetLossPct]
 * @property {number | null} [ping]
 * @property {number | null} [pingP95Ms]
 * @property {number | null} [jitterP95Ms]
 */

/**
 * @typedef {object} SnapshotDeliveryMetrics
 * @property {number} avgIntervalMs
 * @property {number} jitterMs
 * @property {number} packetLossPct Snapshot sequence gaps, not IP packet loss.
 * @property {number} updateRateHz
 * @property {number} outOfOrderCount
 * @property {number | null} serverTickRate
 */

/**
 * @typedef {SnapshotDeliveryMetrics & {
 *   renderIntervalMs: number,
 *   renderFps: number | null,
 *   interpDelayMs: number,
 *   extrapolateMs: number,
 *   playbackTimeMs: number | null,
 *   effectiveDelayMs: number | null,
 *   bufferOccupancyMs: number | null,
 *   underrunCount: number
 * }} InterpolationNetworkStats
 */

/**
 * @template State
 * @template {string} PoseKey
 * @typedef {object} InterpolationConfig
 * @property {number} [interpDelayMs=45] Base render delay in milliseconds.
 * @property {number} [maxBufferSize=32]
 * @property {boolean} [adaptive=true]
 * @property {() => InterpolationConnectionMetrics} [connectionProvider]
 * @property {(serverState: State) => (Record<PoseKey, number> | null)} [extractVelocities]
 */

/**
 * @template State
 * @typedef {object} SnapshotSample
 * @property {number} timestamp Server sample mapped to the local clock.
 * @property {number} arrivalMs Local arrival time; sample spacing ignores jitter.
 * @property {State} serverState Retained by reference without mutation.
 */

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

/**
 * @param {number} baseInterpDelayMs
 * @param {SnapshotDeliveryMetrics} metrics
 * @param {InterpolationRuntimeOptions} runtimeOptions
 * @param {() => InterpolationConnectionMetrics} connectionProvider
 * @returns {{ interpDelayMs: number, extrapolateMs: number }}
 */
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
    Math.max(baseInterpDelayMs, avgIntervalMs * MIN_BUFFERED_SNAPSHOT_INTERVALS) +
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
 * @template {{ net?: import("../shared/networkProtocol.js").SnapshotNetworkMetadata | null }} State
 * @template {string} PoseKey
 * @param {InterpolationConfig<State, PoseKey>} [config]
 */
export function createInterpolator(config = {}) {
  const baseInterpDelayMs = config.interpDelayMs ?? 45;
  const maxBufferSize = config.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE;
  const adaptive = config.adaptive ?? true;
  const connectionProvider = typeof config.connectionProvider === "function"
    ? config.connectionProvider
    : getConnectionState;
  const extractVelocities = typeof config.extractVelocities === "function"
    ? config.extractVelocities
    : null;
  const metrics = createStateMetrics();
  /** @type {SnapshotSample<State>[]} */
  const buffer = [];
  const interpolatedPositions = {};
  let poseKeys = null;
  let prevRenderSampleMs = null;
  let renderIntervalEwmaMs = DEFAULT_STATE_INTERVAL_MS;
  let serverTimeOffsetMs = null;
  let lastServerSampleTimeMs = null;
  let lastStateSeq = null;
  let playbackTimeMs = null;
  let playbackNowMs = null;
  let effectiveDelayMs = null;
  let underrunCount = 0;
  let inUnderrun = false;

  /**
   * Retain an accepted snapshot without mutating it. Duplicates and older
   * sequences leave both the buffer and the playback clock unchanged.
   * @param {State} state Raw server state.
   * @param {{ timestampMs?: number }} [options] Local arrival clock override.
   * @returns {boolean} Whether the snapshot was accepted.
   */
  function pushState(state, options = {}) {
    const nowMs = Number.isFinite(options?.timestampMs) ? options.timestampMs : performance.now();
    const net = state?.net && typeof state.net === "object" ? state.net : null;
    const seq = toFiniteNumber(net?.seq);
    if (seq != null) {
      if (lastStateSeq != null && seq <= lastStateSeq) {
        return false;
      }
      lastStateSeq = seq;
    }

    let sampleTimestampMs = nowMs;
    const serverTimeMs = toFiniteNumber(net?.serverTime);
    if (serverTimeMs != null) {
      if (serverTimeOffsetMs == null) {
        serverTimeOffsetMs = nowMs - serverTimeMs;
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

    buffer.push({ timestamp: sampleTimestampMs, arrivalMs: nowMs, serverState: state });
    metrics.record(state, nowMs);
    if (buffer.length > maxBufferSize) {
      buffer.splice(0, buffer.length - maxBufferSize);
    }
    return true;
  }

  /** @param {InterpolationRuntimeOptions} [runtimeOptions] */
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
   * Move playback toward buffered authority, preserving monotonic time even when
   * delay or extrapolation changes. Underruns count transitions before clamping.
   * @param {number} nowMs
   * @param {number} delayMs
   * @param {number} extrapolateMs
   * @returns {number} Playback time used for this render sample.
   */
  function advancePlaybackClock(nowMs, delayMs, extrapolateMs) {
    const latestSample = buffer[buffer.length - 1];
    const latestTimestampMs = latestSample.timestamp;

    // Project the latest authoritative sample forward by its age. This makes
    // occupancy the reference and follows clock drift without shifting samples.
    const targetPlaybackTimeMs = nowMs >= latestSample.arrivalMs
      ? latestTimestampMs + (nowMs - latestSample.arrivalMs) - delayMs
      : nowMs - delayMs;
    const previousPlaybackTimeMs = playbackTimeMs;

    if (playbackTimeMs == null) {
      playbackTimeMs = targetPlaybackTimeMs;
    } else {
      const elapsedMs = Math.max(0, nowMs - playbackNowMs);
      // Correct gradually, never stepping the authoritative timeline backward.
      const correctionMs = clamp(
        targetPlaybackTimeMs - (playbackTimeMs + elapsedMs),
        -elapsedMs * MAX_PLAYBACK_CORRECTION_RATIO,
        elapsedMs * MAX_PLAYBACK_CORRECTION_RATIO,
      );
      playbackTimeMs += elapsedMs + correctionMs;
    }
    playbackNowMs = nowMs;

    const underrun = playbackTimeMs > latestTimestampMs;
    if (underrun && !inUnderrun) {
      underrunCount += 1;
    }
    inUnderrun = underrun;
    playbackTimeMs = Math.max(
      previousPlaybackTimeMs ?? -Infinity,
      Math.min(playbackTimeMs, latestTimestampMs + Math.max(0, extrapolateMs)),
    );

    const projectedServerNowMs = latestTimestampMs + Math.max(0, nowMs - latestSample.arrivalMs);
    effectiveDelayMs = Math.max(0, projectedServerNowMs - playbackTimeMs);
    return playbackTimeMs;
  }

  /**
   * Sample positional fields. Interpolated or extrapolated results reuse an owned
   * object; copy them before retaining them across calls. Endpoint results are
   * returned directly from the game's extractor.
   * @param {(serverState: State) => Record<PoseKey, number>} extractPositions
   * @param {InterpolationRuntimeOptions} [runtimeOptions]
   * @returns {Record<PoseKey, number> | null}
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
    const extrapolateMs = smoothing.extrapolateMs;
    const renderTime = advancePlaybackClock(nowMs, smoothing.interpDelayMs, extrapolateMs);

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
      return extractPositions(buffer[0].serverState);
    }

    const bIdx = aIdx + 1;

    // renderTime is past all snapshots — optionally extrapolate
    if (bIdx >= buffer.length) {
      const latest = buffer[buffer.length - 1];
      let latestPositions = extractPositions(latest.serverState);
      if (!poseKeys) poseKeys = Object.keys(latestPositions);

      if (extrapolateMs > 0) {
        const lead = clamp(renderTime - latest.timestamp, 0, extrapolateMs);
        if (lead > 0) {
          // Prefer actual velocity data for extrapolation (more accurate than finite diff)
          const velLatest = extractVelocities ? extractVelocities(latest.serverState) : null;
          if (velLatest) {
            const leadSec = lead / 1000;
            for (let i = 0; i < poseKeys.length; i++) {
              const key = poseKeys[i];
              if (key in velLatest && Number.isFinite(velLatest[key])) {
                interpolatedPositions[key] = latestPositions[key] + velLatest[key] * leadSec;
              } else {
                interpolatedPositions[key] = latestPositions[key];
              }
            }
            latestPositions = interpolatedPositions;
          } else if (buffer.length >= 2) {
            // Fallback: finite-difference velocity
            const prev = buffer[buffer.length - 2];
            const range = latest.timestamp - prev.timestamp;
            if (range > 0) {
              const prevPositions = extractPositions(prev.serverState);
              for (let i = 0; i < poseKeys.length; i++) {
                const key = poseKeys[i];
                const velocity = (latestPositions[key] - prevPositions[key]) / range;
                interpolatedPositions[key] = latestPositions[key] + velocity * lead;
              }
              latestPositions = interpolatedPositions;
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

    const posA = extractPositions(stateA.serverState);
    const posB = extractPositions(stateB.serverState);
    if (!poseKeys) poseKeys = Object.keys(posA);

    // Use Hermite (cubic) interpolation when velocity data is available,
    // otherwise fall back to linear lerp.
    const velA = extractVelocities ? extractVelocities(stateA.serverState) : null;
    const velB = extractVelocities ? extractVelocities(stateB.serverState) : null;
    const rangeSec = range / 1000;

    for (let i = 0; i < poseKeys.length; i++) {
      const key = poseKeys[i];
      if (
        velA && velB &&
        key in velA && key in velB &&
        Number.isFinite(velA[key]) && Number.isFinite(velB[key]) &&
        rangeSec > 0
      ) {
        interpolatedPositions[key] = clamp(
          hermite(posA[key], velA[key], posB[key], velB[key], t, rangeSec),
          Math.min(posA[key], posB[key]),
          Math.max(posA[key], posB[key]),
        );
      } else {
        interpolatedPositions[key] = lerp(posA[key], posB[key], t);
      }
    }

    // Prune: discard snapshots older than stateA (in-place)
    if (aIdx > 0) {
      buffer.splice(0, aIdx);
    }

    return interpolatedPositions;
  }

  /**
   * Return the most recently received raw server state.
   * @returns {State | null} The retained snapshot reference.
   */
  function getLatestState() {
    return buffer.length > 0 ? buffer[buffer.length - 1].serverState : null;
  }

  /** @returns {InterpolationNetworkStats} A new metrics object. */
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
      playbackTimeMs,
      effectiveDelayMs,
      bufferOccupancyMs: playbackTimeMs == null || buffer.length === 0
        ? null
        : buffer[buffer.length - 1].timestamp - playbackTimeMs,
      underrunCount,
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
    playbackTimeMs = null;
    playbackNowMs = null;
    effectiveDelayMs = null;
    underrunCount = 0;
    inUnderrun = false;
    poseKeys = null;
  }

  return { pushState, getInterpolatedPositions, getLatestState, getNetworkStats, reset };
}
