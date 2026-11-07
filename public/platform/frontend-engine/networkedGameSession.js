import { createPredictedInputSession } from "./predictedInputSession.js";
import { SOCKET_EVENT } from "../shared/networkProtocol.js";

const DEFAULT_DIAGNOSTICS_INTERVAL_MS = 120;

/** @typedef {"state"|"gameJoined"|"disconnect"|"rematchStarted"|"playerLeft"} NetworkedSessionEvent */
/** @typedef {import("./commandPrediction.js").PredictionClockContext} PredictionClockContext */
/** @typedef {import("./commandPrediction.js").PredictionStats} PredictionStats */
/** @typedef {import("./interpolation.js").InterpolationNetworkStats} InterpolationStats */
/** @typedef {{preserveSequence?: boolean}} NetworkedSessionResetOptions */
/** @typedef {{prediction: PredictionStats|null, interpolation: InterpolationStats|null}} NetworkedSessionStats */

/**
 * Only the transport facade used by this session; game/UI subscribers remain independent.
 * @template InputState
 * @typedef {object} NetworkedSessionSocket
 * @property {(eventName: NetworkedSessionEvent, subscriber: (payload: unknown) => void) => (() => void)} onEvent
 * @property {(eventName: "input", inputPacket: import("../shared/inputFrames.js").EncodedInputFrame<InputState>) => void} send
 * @property {() => boolean} isConnected
 * @property {() => import("./interpolation.js").InterpolationConnectionMetrics} getConnectionSnapshot
 */

/**
 * A caller-owned interpolator compatible with createWorkerInterpolator.
 * @template Snapshot
 * @typedef {object} NetworkedSessionInterpolator
 * @property {(snapshot: Snapshot) => void} pushState Retains snapshots without mutation.
 * @property {(options: import("./interpolation.js").InterpolationRuntimeOptions) => (Record<string, number>|null)} getInterpolatedPositions
 * @property {() => (InterpolationStats|null)} getNetworkStats
 * @property {() => void} reset
 */

/**
 * @template Snapshot, State, InputState, RenderPose
 * @template {PredictionClockContext} PredictionContext
 * @typedef {object} NetworkedGameSessionConfig
 * @property {NetworkedSessionSocket<InputState>} socket Caller-owned transport.
 * @property {NetworkedSessionInterpolator<Snapshot>} interpolator Caller-owned snapshot buffer.
 * @property {Omit<import("./predictedInputSession.js").PredictedInputSessionConfig<State, InputState, string, PredictionContext>, "sendInput">} [prediction]
 * @property {(snapshot: Snapshot) => (import("./predictedInputSession.js").PlayerAuthority<State, PredictionContext>|null)} [readAuthority]
 *   Required with prediction. Return null while local ownership is unavailable.
 * @property {(remotePose: Record<string, number>|null, localPose: Record<string, number>|null, snapshot: Snapshot|null) => RenderPose} [composeRenderPose]
 *   Combine game poses without mutating retained snapshots or the remote pose.
 * @property {(snapshot: Snapshot) => boolean} [canCaptureInput]
 * @property {(resetOptions: {preserveSequence: boolean}) => void} [onReset]
 * @property {(sessionStats: NetworkedSessionStats) => void} [onDiagnostics]
 * @property {number} [diagnosticsIntervalMs=120] Positive interval for connection metrics and diagnostics callbacks.
 */

/**
 * Own socket subscriptions, optional local prediction, and interpolation sampling.
 * Call samplePose once per game simulation step; it captures at most one command.
 * Destroy removes only this session's subscriptions and stops its prediction;
 * the supplied socket and interpolator remain usable by their owner.
 *
 * @template Snapshot, State, InputState, RenderPose
 * @template {PredictionClockContext} PredictionContext
 * @param {NetworkedGameSessionConfig<Snapshot, State, InputState, RenderPose, PredictionContext>} sessionConfig
 * @throws {TypeError} For missing dependencies, prediction mappings, or invalid diagnostics timing.
 */
export function createNetworkedGameSession(sessionConfig) {
  validateNetworkedSessionOptions(sessionConfig);

  const { socket, interpolator } = sessionConfig;
  const diagnosticsIntervalMs = sessionConfig.diagnosticsIntervalMs ?? DEFAULT_DIAGNOSTICS_INTERVAL_MS;
  const predictionSession = sessionConfig.prediction ? createPredictedInputSession({
    ...sessionConfig.prediction,
    sendInput: (inputPacket) => socket.send(SOCKET_EVENT.INPUT, inputPacket),
  }) : null;

  /** @type {Snapshot|null} */
  let latestSnapshot = null;
  let hasCurrentAuthority = false;
  let disposed = false;
  /** @type {number|null} */
  let lastDiagnosticsAtMs = null;
  /** @type {number|null} */
  let lastConnectionMetricsAtMs = null;
  /** @type {import("./interpolation.js").InterpolationConnectionMetrics} */
  let cachedConnectionMetrics = {};

  /** @returns {NetworkedSessionStats} Fresh metrics, safe for presentation to retain. */
  function getStats() {
    return {
      prediction: predictionSession?.getStats() ?? null,
      interpolation: interpolator.getNetworkStats() ?? null,
    };
  }

  /**
   * Clear both engines before presentation receives the reset notification.
   * Partial room pauses may preserve sequence ownership until authority resumes.
   * @param {NetworkedSessionResetOptions} [resetOptions]
   * @returns {void}
   */
  function reset({ preserveSequence = false } = {}) {
    if (disposed) return;

    predictionSession?.reset({ preserveSequence });
    interpolator.reset();
    latestSnapshot = null;
    hasCurrentAuthority = false;
    sessionConfig.onReset?.({ preserveSequence });
  }

  /** @param {Snapshot} snapshot */
  function receiveSnapshot(snapshot) {
    if (disposed) return;

    latestSnapshot = snapshot;
    interpolator.pushState(snapshot);
    if (!predictionSession) return;

    const playerAuthority = sessionConfig.readAuthority(snapshot);
    if (!playerAuthority?.state) {
      if (hasCurrentAuthority) {
        predictionSession.reset({ preserveSequence: true });
      }
      hasCurrentAuthority = false;
      return;
    }
    if (predictionSession.receiveAuthority(playerAuthority)) {
      hasCurrentAuthority = true;
    }
  }

  /** @param {number} nowMs */
  function publishDiagnosticsWhenDue(nowMs) {
    if (!sessionConfig.onDiagnostics || (lastDiagnosticsAtMs !== null &&
        nowMs >= lastDiagnosticsAtMs && nowMs - lastDiagnosticsAtMs < diagnosticsIntervalMs)) {
      return;
    }
    lastDiagnosticsAtMs = nowMs;
    sessionConfig.onDiagnostics(getStats());
  }

  /**
   * Bound transport quantile calculations independently of the fixed input cadence.
   * Copy selected values because a transport may update its cached snapshot in place.
   * @param {number} nowMs
   * @returns {import("./interpolation.js").InterpolationConnectionMetrics}
   */
  function getCachedConnectionMetrics(nowMs) {
    if (lastConnectionMetricsAtMs === null || nowMs < lastConnectionMetricsAtMs ||
        nowMs - lastConnectionMetricsAtMs >= diagnosticsIntervalMs) {
      const connectionSnapshot = socket.getConnectionSnapshot() ?? {};
      cachedConnectionMetrics = {
        ping: connectionSnapshot.ping,
        pingP95Ms: connectionSnapshot.pingP95Ms,
        jitterP95Ms: connectionSnapshot.jitterP95Ms,
        packetLossPct: connectionSnapshot.packetLossPct,
      };
      lastConnectionMetricsAtMs = nowMs;
    }
    return cachedConnectionMetrics;
  }

  /**
   * Sample remote playback, optionally send/predict one command, and compose presentation.
   * The caller supplies its render clock and elapsed time; command duration stays fixed.
   * @param {{nowMs?: number, deltaSec?: number}} [sampleOptions]
   * @returns {RenderPose|Record<string, number>|null}
   */
  function samplePose({ nowMs = performance.now(), deltaSec = 0 } = {}) {
    if (disposed) return null;

    const connectionMetrics = getCachedConnectionMetrics(nowMs);
    const remotePose = interpolator.getInterpolatedPositions({
      nowMs,
      pingMs: connectionMetrics.ping ?? undefined,
      pingP95Ms: connectionMetrics.pingP95Ms ?? undefined,
      jitterP95Ms: connectionMetrics.jitterP95Ms ?? undefined,
      packetLossPct: connectionMetrics.packetLossPct ?? undefined,
    });

    if (predictionSession && hasCurrentAuthority && latestSnapshot !== null && socket.isConnected() &&
        (!sessionConfig.canCaptureInput || sessionConfig.canCaptureInput(latestSnapshot))) {
      predictionSession.captureAndPredict();
    }
    const localPose = hasCurrentAuthority ? predictionSession?.getRenderPose(deltaSec) ?? null : null;
    publishDiagnosticsWhenDue(nowMs);

    return sessionConfig.composeRenderPose
      ? sessionConfig.composeRenderPose(remotePose, localPose, latestSnapshot)
      : remotePose;
  }

  const unsubscribeHandlers = [
    socket.onEvent(SOCKET_EVENT.STATE, (snapshot) => receiveSnapshot(/** @type {Snapshot} */ (snapshot))),
    socket.onEvent(SOCKET_EVENT.GAME_JOINED, () => reset()),
    socket.onEvent(SOCKET_EVENT.DISCONNECT, () => reset()),
    socket.onEvent(SOCKET_EVENT.REMATCH_STARTED, () => reset()),
    socket.onEvent(SOCKET_EVENT.PLAYER_LEFT, () => reset({ preserveSequence: true })),
  ];

  return {
    samplePose,
    getStats,
    /** @returns {Snapshot|null} Retained snapshot reference; callers must not mutate it. */
    getLatestSnapshot: () => latestSnapshot,
    reset,
    destroy() {
      if (disposed) return;
      disposed = true;
      for (const unsubscribe of unsubscribeHandlers) unsubscribe();
      unsubscribeHandlers.length = 0;
      predictionSession?.stop();
      latestSnapshot = null;
      hasCurrentAuthority = false;
    },
  };
}

/**
 * Reject incomplete session contracts before taking ownership of subscriptions.
 * @template Snapshot, State, InputState, RenderPose
 * @template {PredictionClockContext} PredictionContext
 * @param {NetworkedGameSessionConfig<Snapshot, State, InputState, RenderPose, PredictionContext>} sessionConfig
 * @returns {void}
 */
function validateNetworkedSessionOptions(sessionConfig) {
  /** @type {ReadonlyArray<"onEvent"|"send"|"isConnected"|"getConnectionSnapshot">} */
  const socketMethods = ["onEvent", "send", "isConnected", "getConnectionSnapshot"];
  /** @type {ReadonlyArray<"pushState"|"getInterpolatedPositions"|"getNetworkStats"|"reset">} */
  const interpolationMethods = ["pushState", "getInterpolatedPositions", "getNetworkStats", "reset"];
  for (const methodName of socketMethods) {
    if (typeof sessionConfig?.socket?.[methodName] !== "function") {
      throw new TypeError(`Networked game session requires socket.${methodName}.`);
    }
  }
  for (const methodName of interpolationMethods) {
    if (typeof sessionConfig.interpolator?.[methodName] !== "function") {
      throw new TypeError(`Networked game session requires interpolator.${methodName}.`);
    }
  }
  if (sessionConfig.prediction && typeof sessionConfig.readAuthority !== "function") {
    throw new TypeError("Networked prediction requires readAuthority(snapshot).");
  }
  const diagnosticsIntervalMs = sessionConfig.diagnosticsIntervalMs ?? DEFAULT_DIAGNOSTICS_INTERVAL_MS;
  if (!Number.isFinite(diagnosticsIntervalMs) || diagnosticsIntervalMs <= 0) {
    throw new TypeError("Networked game diagnosticsIntervalMs must be positive and finite.");
  }
}
