import { INPUT_LIMITS, NETWORK_TIMING } from "../shared/networkProtocol.js";

const DEFAULT_CORRECTION_DECAY_RATE = 18;
const DEFAULT_MAX_SMOOTHING_DISTANCE = 250;
const CORRECTION_COUNT_THRESHOLD = 0.001;

/**
 * @typedef {object} PredictionClockContext
 * @property {number} [simulationTick] Simulation time already covered by authority.
 * @property {string|number} [continuityKey] Game-owned movement identity. Changes
 *   snap render corrections while retaining unacknowledged command replay.
 */

/**
 * @typedef {object} PredictionStats
 * @property {number} corrections
 * @property {number} correctionDistance Current render offset magnitude.
 * @property {number} replayedCommands Cumulative replay count.
 * @property {number} lastReplayCount
 * @property {number} hardSnaps
 * @property {number} pendingCommands Commands replayed by the last reconciliation.
 */

/**
 * @template {string} PoseKey
 * @typedef {object} PoseCorrectionGroup
 * @property {string} [name] Optional label for readable game configuration.
 * @property {ReadonlyArray<PoseKey>} fields Continuous pose paths using one scale.
 * @property {number} maxSmoothingDistance Nonnegative finite group distance limit.
 */

/**
 * @template State, InputState
 * @template {string} PoseKey
 * @template {PredictionClockContext} PredictionContext
 * @typedef {object} CommandPredictionConfig
 * @property {(predictionState: State, inputState: InputState, fixedDtSec: number, predictionContext: PredictionContext) => (State | void)} simulate
 *   Mutate the owned prediction state, or return its replacement.
 * @property {(predictionState: State) => Record<PoseKey, number>} extractPose
 * @property {(predictionState: State) => State} [cloneState] Must not mutate the source state.
 * @property {number} [fixedDtSec=1/60]
 * @property {number} [correctionDecayRate=18]
 * @property {number} [maxSmoothingDistance=250]
 * @property {ReadonlyArray<PoseCorrectionGroup<PoseKey>>} [correctionGroups]
 *   Separate actors or units so one group's error cannot snap another group.
 *   Fields may belong to at most one group. Ungrouped fields share the default
 *   maxSmoothingDistance limit; no field names or units are inferred.
 * @property {number} [maxReplayFrames=240]
 */

/**
 * Copy game configuration so later caller mutations cannot change group ownership.
 * @template {string} PoseKey
 * @param {ReadonlyArray<PoseCorrectionGroup<PoseKey>>} [correctionGroups]
 * @returns {PoseCorrectionGroup<PoseKey>[]}
 * @throws {TypeError} For invalid thresholds, empty fields or overlapping groups.
 */
function copyAndValidateCorrectionGroups(correctionGroups = []) {
  if (!Array.isArray(correctionGroups)) {
    throw new TypeError("Prediction correctionGroups must be an array.");
  }
  const groupedFields = new Set();
  return correctionGroups.map((correctionGroup) => {
    if (!Array.isArray(correctionGroup?.fields) || correctionGroup.fields.length === 0 ||
        !Number.isFinite(correctionGroup.maxSmoothingDistance) || correctionGroup.maxSmoothingDistance < 0) {
      throw new TypeError("Prediction correction groups require fields and a nonnegative finite distance limit.");
    }
    for (const poseKey of correctionGroup.fields) {
      if (typeof poseKey !== "string" || poseKey.length === 0 || groupedFields.has(poseKey)) {
        throw new TypeError("Prediction correction group fields must be nonempty and cannot overlap.");
      }
      groupedFields.add(poseKey);
    }
    return { ...correctionGroup, fields: [...correctionGroup.fields] };
  });
}

/**
 * Predict commands with the server's simulation step and replay pending commands
 * after authority arrives. Only rendering absorbs reconciliation corrections.
 *
 * @template State, InputState
 * @template {string} PoseKey
 * @template {PredictionClockContext} PredictionContext
 * @param {CommandPredictionConfig<State, InputState, PoseKey, PredictionContext>} [config]
 * @throws {Error} When simulation or pose extraction callbacks are missing.
 * @throws {TypeError} When correction groups have invalid thresholds or overlap.
 */
export function createCommandPredictor(config = {}) {
  if (typeof config.simulate !== "function" || typeof config.extractPose !== "function") {
    throw new Error("Command prediction requires simulate and extractPose callbacks.");
  }

  const cloneState = config.cloneState || ((predictionState) => structuredClone(predictionState));
  const fixedDtSec = config.fixedDtSec ?? NETWORK_TIMING.FIXED_DT_SEC;
  const correctionDecayRate = config.correctionDecayRate ?? DEFAULT_CORRECTION_DECAY_RATE;
  const maxSmoothingDistance = config.maxSmoothingDistance ?? DEFAULT_MAX_SMOOTHING_DISTANCE;
  const correctionGroups = copyAndValidateCorrectionGroups(config.correctionGroups);
  const groupedPoseFields = new Set(correctionGroups.flatMap((correctionGroup) => correctionGroup.fields));
  const maxReplayFrames = config.maxReplayFrames ?? INPUT_LIMITS.MAX_PENDING_FRAMES;

  /** @type {State | null} */
  let predictedState = null;
  /** @type {Record<PoseKey, number>|null} */
  let previousFixedPose = null;
  let lastPredictedSequence = 0;
  /** @type {string|number|undefined} */
  let lastContinuityKey;
  /** @type {Partial<Record<PoseKey, number>>} */
  let renderOffsets = {};
  /** @type {PredictionStats} */
  const predictionStats = {
    corrections: 0,
    correctionDistance: 0,
    replayedCommands: 0,
    lastReplayCount: 0,
    hardSnaps: 0,
    pendingCommands: 0,
  };

  /** @returns {Record<PoseKey, number> | null} */
  function extractPredictedPose() {
    return predictedState ? config.extractPose(predictedState) : null;
  }

  /**
   * Decay owned offsets and return a fresh pose without changing simulation state.
   * @param {number} [deltaSec=0] Elapsed render time in seconds.
   * @param {number} [interpolationAlpha=1] Fixed-step render fraction, clamped to [0, 1].
   * @returns {Record<PoseKey, number> | null}
   */
  function getRenderPose(deltaSec = 0, interpolationAlpha = 1) {
    const predictedPose = extractPredictedPose();
    if (!predictedPose) {
      return null;
    }

    const decayFactor = Math.exp(-Math.max(0, deltaSec) * correctionDecayRate);
    const renderFraction = Number.isFinite(interpolationAlpha)
      ? Math.max(0, Math.min(1, interpolationAlpha))
      : 1;
    const renderPose = {};
    let offsetDistanceSquared = 0;

    for (const poseKey of Object.keys(predictedPose)) {
      renderOffsets[poseKey] = (renderOffsets[poseKey] || 0) * decayFactor;
      const previousValue = Number.isFinite(previousFixedPose?.[poseKey])
        ? previousFixedPose[poseKey]
        : predictedPose[poseKey];
      renderPose[poseKey] = previousValue + (predictedPose[poseKey] - previousValue) * renderFraction + renderOffsets[poseKey];
      offsetDistanceSquared += renderOffsets[poseKey] * renderOffsets[poseKey];
    }

    predictionStats.correctionDistance = Math.sqrt(offsetDistanceSquared);
    return renderPose;
  }

  /**
   * @param {import("./inputTimeline.js").InputCommandFrame<InputState>} inputFrame
   * @param {PredictionContext} predictionContext
   */
  function simulateInputFrame(inputFrame, predictionContext) {
    const nextPredictedState = config.simulate(
      predictedState,
      inputFrame.input,
      fixedDtSec,
      predictionContext,
    );
    if (nextPredictedState) {
      predictedState = nextPredictedState;
    }
  }

  /**
   * Start a fresh command sequence, cloning authority and clearing render offsets.
   * Cumulative correction, replay, and hard-snap counters are retained.
   * @param {State | null} [authoritativeState=null]
   */
  function reset(authoritativeState = null) {
    predictedState = authoritativeState ? cloneState(authoritativeState) : null;
    previousFixedPose = predictedState ? { ...extractPredictedPose() } : null;
    lastPredictedSequence = 0;
    lastContinuityKey = undefined;
    renderOffsets = {};
    predictionStats.correctionDistance = 0;
    predictionStats.lastReplayCount = 0;
    predictionStats.pendingCommands = 0;
  }

  /**
   * Simulate a sequence once; ignore invalid, duplicate, or older commands.
   * @param {import("./inputTimeline.js").InputCommandFrame<InputState>} inputFrame
   * @param {PredictionContext} [predictionContext]
   */
  function advance(inputFrame, predictionContext = {}) {
    if (!predictedState || !Number.isSafeInteger(inputFrame?.seq) || inputFrame.seq <= lastPredictedSequence) {
      return;
    }

    previousFixedPose = { ...extractPredictedPose() };
    simulateInputFrame(inputFrame, predictionContext);
    lastPredictedSequence = inputFrame.seq;
  }

  /**
   * Snap only the selected continuous fields and their preceding render endpoints.
   * @param {ReadonlyArray<PoseKey>} poseFields
   * @param {Record<PoseKey, number>} reconciledPose
   */
  function resetPoseCorrectionFields(poseFields, reconciledPose) {
    for (const poseKey of poseFields) {
      if (Object.hasOwn(reconciledPose, poseKey)) {
        renderOffsets[poseKey] = 0;
        previousFixedPose[poseKey] = reconciledPose[poseKey];
      }
    }
  }

  /** @param {ReadonlyArray<PoseKey>} poseFields @returns {number} Current group offset magnitude. */
  function measurePoseCorrectionDistance(poseFields) {
    let distanceSquared = 0;
    for (const poseKey of poseFields) {
      const offset = renderOffsets[poseKey] || 0;
      distanceSquared += offset * offset;
    }
    return Math.sqrt(distanceSquared);
  }

  /**
   * Preserve the current visible pose while replacing simulation with authority
   * plus bounded replay. Neither authority nor pending frames are mutated.
   * @param {State | null} authoritativeState
   * @param {import("./inputTimeline.js").InputCommandFrame<InputState>[]} [pendingFrames]
   * @param {PredictionContext} [predictionContext]
   * @param {number} [acknowledgedSequence=0] Last command successfully simulated by the server.
   */
  function reconcile(authoritativeState, pendingFrames = [], predictionContext = {}, acknowledgedSequence = 0) {
    if (!authoritativeState) {
      return;
    }

    const continuityKey = predictionContext.continuityKey;
    const hasContinuityKey = typeof continuityKey === "string" ||
      (typeof continuityKey === "number" && Number.isFinite(continuityKey));
    const continuityChanged = hasContinuityKey && lastContinuityKey !== undefined &&
      continuityKey !== lastContinuityKey;
    const previousRenderPose = predictedState && !continuityChanged ? getRenderPose(0) : null;
    const previousSimulationPose = previousRenderPose ? { ...extractPredictedPose() } : null;
    if (hasContinuityKey) {
      lastContinuityKey = continuityKey;
    }
    predictedState = cloneState(authoritativeState);
    let replayCount = 0;

    // Held-input physics may have advanced while a command was late. Replay only
    // future simulation time; the separate acknowledgement retains late actions.
    lastPredictedSequence = Math.max(
      Number.isSafeInteger(acknowledgedSequence) ? acknowledgedSequence : 0,
      Number.isSafeInteger(predictionContext.simulationTick) ? predictionContext.simulationTick : 0,
    );
    for (const inputFrame of pendingFrames.slice(0, maxReplayFrames)) {
      if (!Number.isSafeInteger(inputFrame.seq) || inputFrame.seq <= lastPredictedSequence) {
        continue;
      }
      simulateInputFrame(inputFrame, predictionContext);
      lastPredictedSequence = inputFrame.seq;
      replayCount++;
    }

    predictionStats.lastReplayCount = replayCount;
    predictionStats.replayedCommands += replayCount;
    predictionStats.pendingCommands = replayCount;

    const reconciledPose = extractPredictedPose();
    renderOffsets = {};
    if (previousRenderPose && reconciledPose) {
      const poseFields = Object.keys(reconciledPose);
      previousFixedPose ??= {};
      for (const poseKey of poseFields) {
        // Preserve the preceding fixed step's displacement through correction;
        // the same render offset then keeps every fractional sample continuous.
        const previousDisplacement = Number.isFinite(previousFixedPose?.[poseKey])
          ? previousSimulationPose[poseKey] - previousFixedPose[poseKey]
          : 0;
        previousFixedPose[poseKey] = reconciledPose[poseKey] - previousDisplacement;
        const difference = Number.isFinite(previousRenderPose[poseKey])
          ? previousRenderPose[poseKey] - reconciledPose[poseKey]
          : 0;
        renderOffsets[poseKey] = difference;
      }

      let didHardSnap = false;
      for (const correctionGroup of correctionGroups) {
        if (measurePoseCorrectionDistance(correctionGroup.fields) > correctionGroup.maxSmoothingDistance) {
          resetPoseCorrectionFields(correctionGroup.fields, reconciledPose);
          didHardSnap = true;
        }
      }

      const ungroupedFields = correctionGroups.length
        ? poseFields.filter((poseKey) => !groupedPoseFields.has(poseKey))
        : poseFields;
      if (measurePoseCorrectionDistance(ungroupedFields) > maxSmoothingDistance) {
        resetPoseCorrectionFields(ungroupedFields, reconciledPose);
        didHardSnap = true;
      }
      if (didHardSnap) {
        predictionStats.hardSnaps++;
      }

      if (measurePoseCorrectionDistance(poseFields) > CORRECTION_COUNT_THRESHOLD) {
        predictionStats.corrections++;
      }
    } else {
      previousFixedPose = reconciledPose ? { ...reconciledPose } : null;
    }

    getRenderPose(0);
  }

  return {
    advance,
    reconcile,
    reset,
    getRenderPose,
    /** Return the owned mutable simulation state; callers must not mutate it. */
    getState: () => predictedState,
    getStats: () => ({ ...predictionStats, initialized: predictedState !== null }),
  };
}
