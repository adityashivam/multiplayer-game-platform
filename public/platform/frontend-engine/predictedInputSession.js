import { createCommandPredictor } from "./commandPrediction.js";
import { createInputTimeline } from "./inputTimeline.js";
import { createInputFrame } from "../shared/inputFrames.js";
import { INPUT_PROTOCOL, NETWORK_TIMING } from "../shared/networkProtocol.js";

/** @type {ReadonlyArray<"captureInput"|"sendInput"|"simulate"|"extractPose">} */
const REQUIRED_SESSION_CALLBACKS = Object.freeze([
  "captureInput", "sendInput", "simulate", "extractPose",
]);

/** @typedef {import("./commandPrediction.js").PredictionClockContext} PredictionClockContext */

/**
 * @template State, InputState
 * @template {string} PoseKey
 * @template {PredictionClockContext} PredictionContext
 * @typedef {import("./commandPrediction.js").CommandPredictionConfig<State, InputState, PoseKey, PredictionContext> & {
 *   captureInput: () => InputState,
 *   sendInput: (inputPacket: import("../shared/inputFrames.js").EncodedInputFrame<InputState>) => void,
 *   maxPendingFrames?: number
 * }} PredictedInputSessionConfig
 */

/**
 * @template State
 * @template {PredictionClockContext} PredictionContext
 * @typedef {object} PlayerAuthority
 * @property {State|null} state Game-owned authoritative state; never mutated here.
 * @property {1|2} [protocol=1]
 * @property {number} [inputEpoch] Command ownership advertised by the server.
 * @property {number} [acknowledgedSequence=0] Last command incorporated by simulation.
 * @property {PredictionContext} [context] Game data needed for deterministic replay.
 */

/**
 * Connect a game's simulation callbacks to command delivery and reconciliation.
 * The game calls captureAndPredict once per configured simulation step and owns
 * transport, rendering, input collection, and the choice to enable prediction.
 *
 * @template State, InputState
 * @template {string} PoseKey
 * @template {PredictionClockContext} PredictionContext
 * @param {PredictedInputSessionConfig<State, InputState, PoseKey, PredictionContext>} sessionConfig
 * @throws {TypeError} If callbacks or a positive finite simulation duration are missing.
 */
export function createPredictedInputSession(sessionConfig) {
  for (const callbackName of REQUIRED_SESSION_CALLBACKS) {
    if (typeof sessionConfig?.[callbackName] !== "function") {
      throw new TypeError(`Predicted input session requires ${callbackName}.`);
    }
  }

  const fixedDtSec = sessionConfig.fixedDtSec ?? NETWORK_TIMING.FIXED_DT_SEC;
  if (!Number.isFinite(fixedDtSec) || fixedDtSec <= 0) {
    throw new TypeError("Predicted input session fixedDtSec must be positive and finite.");
  }

  const commandPredictor = createCommandPredictor({ ...sessionConfig, fixedDtSec });
  /** @type {1|2} */
  let inputProtocol = INPUT_PROTOCOL.LEGACY;
  /** @type {number|undefined} */
  let inputEpoch;
  let lastAcknowledgedSequence = 0;
  /** @type {PredictionContext} */
  let authorityContext = {};
  let stopped = false;

  const inputTimeline = createInputTimeline({
    hz: 1 / fixedDtSec,
    fixedDtSec,
    maxPendingFrames: sessionConfig.maxPendingFrames,
    captureInput: sessionConfig.captureInput,
    sendFrame: (inputFrame) => sessionConfig.sendInput(createInputFrame({
      protocolVersion: inputProtocol,
      inputEpoch,
      sequenceNumber: inputFrame.seq,
      inputState: inputFrame.input,
      fixedDtSec,
    })),
  });

  /**
   * Install authority, reset changed ownership, then acknowledge and replay.
   * Delayed previous epochs and regressing acknowledgements are ignored.
   * @param {PlayerAuthority<State, PredictionContext>} playerAuthority
   * @returns {boolean} Whether this authority was accepted.
   * @throws {TypeError} If an unsupported input protocol is supplied.
   */
  function receiveAuthority({
    state,
    protocol = INPUT_PROTOCOL.LEGACY,
    inputEpoch: nextInputEpoch,
    acknowledgedSequence = 0,
    context = {},
  }) {
    if (!state) {
      return false;
    }
    if (protocol !== INPUT_PROTOCOL.LEGACY && protocol !== INPUT_PROTOCOL.QUEUED) {
      throw new TypeError("Unsupported predicted input protocol.");
    }

    const hasInputEpoch = Number.isSafeInteger(nextInputEpoch) && nextInputEpoch >= 0;
    if (hasInputEpoch && inputEpoch !== undefined && nextInputEpoch < inputEpoch) {
      return false;
    }
    const ownershipChanged = hasInputEpoch && nextInputEpoch !== inputEpoch;
    const safeAcknowledgement = Number.isSafeInteger(acknowledgedSequence)
      ? Math.max(0, acknowledgedSequence)
      : 0;
    if (!ownershipChanged && safeAcknowledgement < lastAcknowledgedSequence) {
      return false;
    }

    if (ownershipChanged) {
      inputTimeline.reset();
      commandPredictor.reset(state);
      inputEpoch = nextInputEpoch;
    }
    inputProtocol = protocol;
    lastAcknowledgedSequence = safeAcknowledgement;
    authorityContext = context;
    inputTimeline.acknowledge(safeAcknowledgement);
    // A capture pause advances time, while late action commands still need acknowledgement.
    inputTimeline.advanceSequenceBaseline(context.simulationTick);
    commandPredictor.reconcile(state, inputTimeline.getPendingFrames(), context, safeAcknowledgement);

    return true;
  }

  /**
   * Capture, deliver and predict one fixed command after authority is available.
   * captureInput must return an owned input object; context is read-only to callbacks.
   * @param {PredictionContext} [predictionContext]
   * @returns {import("./inputTimeline.js").InputCommandFrame<InputState>|null}
   */
  function captureAndPredict(predictionContext = authorityContext) {
    const ownershipReady = inputProtocol !== INPUT_PROTOCOL.QUEUED || Number.isSafeInteger(inputEpoch);
    if (stopped || !commandPredictor.getState() || !ownershipReady) {
      return null;
    }

    const inputFrame = inputTimeline.sendNow();
    commandPredictor.advance(inputFrame, predictionContext);
    return inputFrame;
  }

  /**
   * Clear rendering/prediction state; optionally retain commands during a brief
   * room pause until authority confirms which inputs were processed.
   * @param {{preserveSequence?: boolean}} [resetOptions]
   * @returns {void}
   */
  function reset({ preserveSequence = false } = {}) {
    commandPredictor.reset();
    authorityContext = {};
    stopped = false;
    if (!preserveSequence) {
      inputTimeline.reset();
      inputEpoch = undefined;
      inputProtocol = INPUT_PROTOCOL.LEGACY;
      lastAcknowledgedSequence = 0;
    }
  }

  return {
    receiveAuthority,
    captureAndPredict,
    reset,
    /** Stop accepting local commands until the session is reset. */
    stop() {
      stopped = true;
      inputTimeline.stop();
    },
    getRenderPose: (deltaSec = 0, interpolationAlpha = 1) => commandPredictor.getRenderPose(deltaSec, interpolationAlpha),
    /** Return library-owned state; consumers must not mutate it. */
    getState: () => commandPredictor.getState(),
    getStats: () => ({
      ...commandPredictor.getStats(),
      pendingCommands: inputTimeline.getPendingFrames().length,
    }),
  };
}
