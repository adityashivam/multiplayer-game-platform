import { INPUT_LIMITS, NETWORK_TIMING } from "../shared/networkProtocol.js";

const DEFAULT_CORRECTION_DECAY_RATE = 18;
const DEFAULT_MAX_SMOOTHING_DISTANCE = 250;
const RENDER_OFFSET_ZERO_THRESHOLD = 0.0001;
const CORRECTION_COUNT_THRESHOLD = 0.001;

/**
 * @typedef {object} PredictionClockContext
 * @property {number} [simulationTick] Simulation time already covered by authority.
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
 * @property {number} [maxReplayFrames=240]
 */

/**
 * Predict commands with the server's simulation step and replay pending commands
 * after authority arrives. Only rendering absorbs reconciliation corrections.
 *
 * @template State, InputState
 * @template {string} PoseKey
 * @template {PredictionClockContext} PredictionContext
 * @param {CommandPredictionConfig<State, InputState, PoseKey, PredictionContext>} [config]
 * @throws {Error} When simulation or pose extraction callbacks are missing.
 */
export function createCommandPredictor(config = {}) {
  if (typeof config.simulate !== "function" || typeof config.extractPose !== "function") {
    throw new Error("Command prediction requires simulate and extractPose callbacks.");
  }

  const cloneState = config.cloneState || ((predictionState) => structuredClone(predictionState));
  const fixedDtSec = config.fixedDtSec ?? NETWORK_TIMING.FIXED_DT_SEC;
  const correctionDecayRate = config.correctionDecayRate ?? DEFAULT_CORRECTION_DECAY_RATE;
  const maxSmoothingDistance = config.maxSmoothingDistance ?? DEFAULT_MAX_SMOOTHING_DISTANCE;
  const maxReplayFrames = config.maxReplayFrames ?? INPUT_LIMITS.MAX_PENDING_FRAMES;

  /** @type {State | null} */
  let predictedState = null;
  let lastPredictedSequence = 0;
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
   * @returns {Record<PoseKey, number> | null}
   */
  function getRenderPose(deltaSec = 0) {
    const predictedPose = extractPredictedPose();
    if (!predictedPose) {
      return null;
    }

    const decayFactor = Math.exp(-Math.max(0, deltaSec) * correctionDecayRate);
    const renderPose = {};
    let offsetDistanceSquared = 0;

    for (const poseKey of Object.keys(predictedPose)) {
      renderOffsets[poseKey] = (renderOffsets[poseKey] || 0) * decayFactor;
      if (Math.abs(renderOffsets[poseKey]) < RENDER_OFFSET_ZERO_THRESHOLD) {
        renderOffsets[poseKey] = 0;
      }
      renderPose[poseKey] = predictedPose[poseKey] + renderOffsets[poseKey];
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
    lastPredictedSequence = 0;
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

    simulateInputFrame(inputFrame, predictionContext);
    lastPredictedSequence = inputFrame.seq;
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

    const previousRenderPose = predictedState ? getRenderPose(0) : null;
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
      let correctionDistanceSquared = 0;
      for (const poseKey of Object.keys(reconciledPose)) {
        const difference = Number.isFinite(previousRenderPose[poseKey])
          ? previousRenderPose[poseKey] - reconciledPose[poseKey]
          : 0;
        renderOffsets[poseKey] = difference;
        correctionDistanceSquared += difference * difference;
      }

      const correctionDistance = Math.sqrt(correctionDistanceSquared);
      if (correctionDistance > maxSmoothingDistance) {
        renderOffsets = {};
        predictionStats.hardSnaps++;
      } else if (correctionDistance > CORRECTION_COUNT_THRESHOLD) {
        predictionStats.corrections++;
      }
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
