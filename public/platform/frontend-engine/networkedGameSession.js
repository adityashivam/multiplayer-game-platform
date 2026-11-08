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
 * @property {(remotePose: Record<string, number>|null, localPose: Record<string, number>|null, snapshot: Snapshot|null, predictedState: Readonly<State>|null) => RenderPose} [composeRenderPose]
 *   Combine poses without mutating snapshots, remote poses or the borrowed prediction
 *   state. Use predictedState for discrete animation/serve identities; extractPose
 *   should contain only continuous fields that may absorb correction offsets.
 * @property {(snapshot: Snapshot) => boolean} [canCaptureInput]
 * @property {(resetOptions: {preserveSequence: boolean}) => void} [onReset]
 * @property {(ownershipReset: {previousEpoch: number, inputEpoch: number}) => void} [onInputOwnershipReset]
 *   Reset game input latches after an accepted ownership change. Initial or
 *   missing epochs do not notify; fresh authority and interpolation are retained.
 * @property {(sessionStats: NetworkedSessionStats) => void} [onDiagnostics]
 * @property {number} [diagnosticsIntervalMs=120] Positive interval for connection metrics and diagnostics callbacks.
 */

/**
 * Own socket subscriptions, optional local prediction, and interpolation sampling.
 * Call captureAndPredict once per game simulation step, then samplePose with
 * captureInput:false once per render. Legacy callers may use samplePose alone
 * once per simulation step; it captures one command by default.
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
  /** @type {number|undefined} */
  let lastAcceptedInputEpoch;
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
    if (!preserveSequence) {
      lastAcceptedInputEpoch = undefined;
    }
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
      const inputEpoch = playerAuthority.inputEpoch;
      if (Number.isSafeInteger(inputEpoch) && inputEpoch >= 0) {
        const previousEpoch = lastAcceptedInputEpoch;
        lastAcceptedInputEpoch = inputEpoch;
        if (previousEpoch !== undefined && previousEpoch !== inputEpoch) {
          sessionConfig.onInputOwnershipReset?.({ previousEpoch, inputEpoch });
        }
      }
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
   * Capture one fixed command when connected and current game ownership permits it.
   * Render-only sampling uses the same state but never captures another command.
   * @returns {import("./inputTimeline.js").InputCommandFrame<InputState>|null}
   */
  function captureAndPredict() {
    if (disposed || !predictionSession || !hasCurrentAuthority || latestSnapshot === null ||
        !socket.isConnected() ||
        (sessionConfig.canCaptureInput && !sessionConfig.canCaptureInput(latestSnapshot))) {
      return null;
    }
    return predictionSession.captureAndPredict();
  }

  /**
   * Sample remote playback, optionally send/predict one command, and compose presentation.
   * The caller supplies its render clock and elapsed time; command duration stays fixed.
   * @param {{nowMs?: number, deltaSec?: number, captureInput?: boolean, interpolationAlpha?: number}} [sampleOptions]
   *   Pass the runtime's fixed-step alpha to interpolate local continuous poses.
   *   Discrete state passed to composeRenderPose always uses the current command.
   * @returns {RenderPose|Record<string, number>|null}
   */
  function samplePose({ nowMs = performance.now(), deltaSec = 0, captureInput = true, interpolationAlpha = 1 } = {}) {
    if (disposed) return null;

    const connectionMetrics = getCachedConnectionMetrics(nowMs);
    const remotePose = interpolator.getInterpolatedPositions({
      nowMs,
      pingMs: connectionMetrics.ping ?? undefined,
      pingP95Ms: connectionMetrics.pingP95Ms ?? undefined,
      jitterP95Ms: connectionMetrics.jitterP95Ms ?? undefined,
      packetLossPct: connectionMetrics.packetLossPct ?? undefined,
    });

    if (captureInput) {
      captureAndPredict();
    }
    const localPose = hasCurrentAuthority ? predictionSession?.getRenderPose(deltaSec, interpolationAlpha) ?? null : null;
    publishDiagnosticsWhenDue(nowMs);

    return sessionConfig.composeRenderPose
      ? sessionConfig.composeRenderPose(remotePose, localPose, latestSnapshot, hasCurrentAuthority ? predictionSession?.getState() ?? null : null)
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
    captureAndPredict,
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
