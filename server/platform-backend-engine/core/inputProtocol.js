import {
  INPUT_LIMITS,
  INPUT_MESSAGE_TYPE,
  INPUT_PROTOCOL,
  NETWORK_TIMING,
} from "../../../public/platform/shared/networkProtocol.js";
import { isValidGameInputState, isValidNumericInputValue } from "../../../public/platform/shared/inputSchema.js";

/**
 * Input keys belong to the registered game rather than the reusable protocol.
 * @template {string} InputKey
 * @typedef {Record<InputKey, boolean | number>} GameInputState
 */

/**
 * @template {string} InputKey
 * @typedef {object} InputPacket
 * @property {string} [type]
 * @property {number} [protocol]
 * @property {number} [seq]
 * @property {number} [epoch]
 * @property {GameInputState<InputKey>} [state]
 * @property {unknown} [value]
 */

/**
 * Validated, owned copy of a queued command. Epoch validation happens on receipt.
 * @template {string} InputKey
 * @typedef {object} QueuedInputFrame
 * @property {"inputFrame"} type
 * @property {2} protocol
 * @property {number} seq
 * @property {GameInputState<InputKey>} state
 */

/**
 * @template {string} InputKey
 * @typedef {object} PlayerInputBuffer
 * @property {Array<QueuedInputFrame<InputKey>>} queue
 * @property {number} credit Accumulated simulation time in seconds.
 * @property {number} lastQueuedSeq
 */

/**
 * Input session fields added to a game's own player state.
 * @template {string} InputKey
 * @typedef {object} PlayerInputState
 * @property {GameInputState<InputKey>} [input]
 * @property {number} [lastInputSeqAck]
 * @property {number} [inputEpoch]
 * @property {number} [inputSimulationTick]
 * @property {PlayerInputBuffer<InputKey>} [__inputBuffer]
 */

/**
 * @template {string} InputKey
 * @typedef {(inputState: GameInputState<InputKey>, fixedDtSec: number, inputFrame: QueuedInputFrame<InputKey> | null) => void} InputSimulation
 */

const INPUT_CREDIT_EPSILON_SEC = 1e-10;

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

/** @param {number | undefined} sequenceNumber */
function normalizeInputSequenceNumber(sequenceNumber) {
  return Number.isFinite(sequenceNumber) ? Math.max(0, Math.floor(sequenceNumber)) : null;
}

/**
 * Initialize missing input and acknowledgement fields without replacing held input.
 * @template {string} InputKey
 * @param {PlayerInputState<InputKey>} player
 * @param {GameInputState<InputKey>} [inputTemplate]
 * @returns {void}
 */
export function ensurePlayerInputState(player, inputTemplate = {}) {
  if (!player || typeof player !== "object") {
    return;
  }
  if (!isPlainObject(player.input)) {
    player.input = { ...inputTemplate };
  }
  if (!Number.isFinite(player.lastInputSeqAck)) {
    player.lastInputSeqAck = 0;
  }
}

/**
 * Apply legacy held/discrete input, preserving acknowledgement before validation.
 * @template {string} InputKey
 * @param {object} options
 * @param {PlayerInputState<InputKey>} options.player Mutated in place.
 * @param {InputPacket<InputKey>} options.payload
 * @param {GameInputState<InputKey>} [options.inputTemplate]
 * @param {import("../../../public/platform/shared/inputSchema.js").NumericInputConfiguration<InputKey>} [options.numericInputs]
 * @param {(player: PlayerInputState<InputKey>, inputState: GameInputState<InputKey>) => void} [options.applyInputState]
 * @param {(player: PlayerInputState<InputKey>, inputType: string, value: boolean) => boolean} [options.applyDiscreteInput]
 * @returns {boolean} Whether this packet was recognized.
 */
export function applySequencedInput({
  player,
  payload,
  inputTemplate = {},
  numericInputs = {},
  applyInputState,
  applyDiscreteInput,
}) {
  if (!player || typeof player !== "object") {
    return false;
  }
  ensurePlayerInputState(player, inputTemplate);

  const inputType = payload?.type;
  const sequenceNumber = normalizeInputSequenceNumber(payload?.seq);
  if (sequenceNumber != null) {
    player.lastInputSeqAck = Math.max(player.lastInputSeqAck || 0, sequenceNumber);
  }

  if (inputType === INPUT_MESSAGE_TYPE.FRAME) {
    const inputState = payload?.state;
    if (Object.keys(numericInputs).length > 0 && !isValidGameInputState(inputState, inputTemplate, numericInputs)) {
      return false;
    }
    if (!isPlainObject(inputState)) {
      return true;
    }

    if (typeof applyInputState === "function") {
      applyInputState(player, inputState);
      return true;
    }

    const inputKeys = /** @type {InputKey[]} */ (Object.keys(inputTemplate));
    for (const inputKey of inputKeys) {
      player.input[inputKey] = Object.hasOwn(numericInputs, inputKey) ? inputState[inputKey] : Boolean(inputState[inputKey]);
    }
    return true;
  }

  if (Object.hasOwn(numericInputs, inputType)) {
    if (!isValidNumericInputValue(payload?.value, numericInputs[inputType])) {
      return false;
    }
    player.input[inputType] = payload.value;
    return true;
  }

  const inputValue = Boolean(payload?.value);
  if (typeof applyDiscreteInput === "function") {
    return Boolean(applyDiscreteInput(player, inputType, inputValue));
  }

  if (typeof inputType === "string" && Object.prototype.hasOwnProperty.call(player.input, inputType)) {
    player.input[inputType] = inputValue;
    return true;
  }

  return false;
}

/**
 * @template {string} InputKey
 * @param {PlayerInputState<InputKey>} player
 * @returns {PlayerInputBuffer<InputKey>} Lazily created buffer owned by the player.
 */
function getPlayerInputBuffer(player) {
  if (!player.__inputBuffer) {
    player.__inputBuffer = {
      queue: [],
      credit: 0,
      lastQueuedSeq: player.lastInputSeqAck || 0,
    };
  }
  return player.__inputBuffer;
}

/**
 * Validate a queued command and retain an owned copy without acknowledging it.
 * @template {string} InputKey
 * @param {object} options
 * @param {PlayerInputState<InputKey>} options.player Mutated in place.
 * @param {InputPacket<InputKey>} options.payload
 * @param {GameInputState<InputKey>} [options.inputTemplate]
 * @param {import("../../../public/platform/shared/inputSchema.js").NumericInputConfiguration<InputKey>} [options.numericInputs]
 * @returns {boolean} False for malformed, stale, wrong-epoch, or overflow frames.
 */
export function enqueueInputFrame({ player, payload, inputTemplate = {}, numericInputs = {} }) {
  if (!player || typeof player !== "object") {
    return false;
  }
  ensurePlayerInputState(player, inputTemplate);

  if (
    payload?.type !== INPUT_MESSAGE_TYPE.FRAME ||
    payload.protocol !== INPUT_PROTOCOL.QUEUED ||
    !Number.isSafeInteger(payload.seq) ||
    payload.seq <= 0 ||
    !isPlainObject(payload.state)
  ) {
    return false;
  }
  if (Number.isSafeInteger(player.inputEpoch) && payload.epoch !== player.inputEpoch) {
    return false;
  }

  const inputKeys = /** @type {InputKey[]} */ (Object.keys(inputTemplate));
  if (!isValidGameInputState(payload.state, inputTemplate, numericInputs)) {
    return false;
  }

  const inputBuffer = getPlayerInputBuffer(player);
  if (payload.seq <= inputBuffer.lastQueuedSeq || inputBuffer.queue.length >= INPUT_LIMITS.MAX_QUEUED_FRAMES) {
    return false;
  }

  const inputState = Object.fromEntries(inputKeys.map((inputKey) => [inputKey, payload.state[inputKey]]));
  inputBuffer.queue.push({
    type: INPUT_MESSAGE_TYPE.FRAME,
    protocol: INPUT_PROTOCOL.QUEUED,
    seq: payload.seq,
    state: inputState,
  });
  inputBuffer.lastQueuedSeq = payload.seq;
  return true;
}

/**
 * Advance one fixed world step, merging action edges from commands due by its tick.
 * Removal and acknowledgement follow successful simulation; empty steps still run.
 * @template {string} InputKey
 * @param {PlayerInputState<InputKey>} player
 * @param {PlayerInputBuffer<InputKey>} inputBuffer
 * @param {InputSimulation<InputKey>} simulate
 * @param {number} maxSteps
 * @param {ReadonlyArray<InputKey>} edgeKeys
 * @param {number} fixedDtSec
 * @returns {number} Number of queued frames incorporated into this step.
 */
function consumeContinuousInputFrames(player, inputBuffer, simulate, maxSteps, edgeKeys, fixedDtSec) {
  let targetSimulationTick = (player.inputSimulationTick || 0) + 1;
  if (inputBuffer.queue.length && inputBuffer.queue[0].seq > targetSimulationTick) {
    targetSimulationTick = inputBuffer.queue[0].seq;
  }

  const frameLimit = Math.min(INPUT_LIMITS.MAX_FRAMES_PER_TICK, Math.max(0, maxSteps));
  let consumedFrameCount = 0;
  let heldInputState = player.input;
  const actionEdges = /** @type {Partial<GameInputState<InputKey>>} */ ({});

  while (
    consumedFrameCount < frameLimit &&
    consumedFrameCount < inputBuffer.queue.length &&
    inputBuffer.queue[consumedFrameCount].seq <= targetSimulationTick
  ) {
    heldInputState = inputBuffer.queue[consumedFrameCount].state;
    for (const inputKey of edgeKeys) {
      if (heldInputState[inputKey]) {
        actionEdges[inputKey] = true;
      }
    }
    consumedFrameCount += 1;
  }

  const lastConsumedFrame = consumedFrameCount ? inputBuffer.queue[consumedFrameCount - 1] : null;
  simulate({ ...heldInputState, ...actionEdges }, fixedDtSec, lastConsumedFrame);

  if (consumedFrameCount) {
    inputBuffer.queue.splice(0, consumedFrameCount);
    player.input = { ...heldInputState };
    player.lastInputSeqAck = lastConsumedFrame.seq;
  }
  player.inputSimulationTick = targetSimulationTick;
  return consumedFrameCount;
}

/**
 * Spend bounded time credit on queued commands, acknowledging after each step.
 * @template {string} InputKey
 * @param {PlayerInputState<InputKey>} player
 * @param {PlayerInputBuffer<InputKey>} inputBuffer
 * @param {number} dtSec
 * @param {InputSimulation<InputKey>} simulate
 * @param {number} maxSteps
 * @param {number} fixedDtSec
 * @returns {number}
 */
function consumeQueuedInputFrames(player, inputBuffer, dtSec, simulate, maxSteps, fixedDtSec) {
  const elapsedSec = Number.isFinite(dtSec) ? Math.max(0, dtSec) : 0;
  inputBuffer.credit = Math.min(INPUT_LIMITS.MAX_CREDIT_SEC, inputBuffer.credit + elapsedSec);

  let consumedFrameCount = 0;
  while (
    inputBuffer.queue.length &&
    inputBuffer.credit + INPUT_CREDIT_EPSILON_SEC >= fixedDtSec &&
    consumedFrameCount < Math.min(INPUT_LIMITS.MAX_FRAMES_PER_TICK, Math.max(0, maxSteps))
  ) {
    const inputFrame = inputBuffer.queue[0];
    simulate(inputFrame.state, fixedDtSec, inputFrame);

    inputBuffer.queue.shift();
    inputBuffer.credit = Math.max(0, inputBuffer.credit - fixedDtSec);
    player.input = { ...inputFrame.state };
    player.lastInputSeqAck = inputFrame.seq;
    consumedFrameCount += 1;
  }
  return consumedFrameCount;
}

/**
 * Consume queued commands or continue held input for one fixed world step.
 * A throwing simulation leaves its command queued and unacknowledged.
 * @template {string} InputKey
 * @param {object} options
 * @param {PlayerInputState<InputKey>} options.player Mutated in place.
 * @param {number} options.dtSec Elapsed credit for queued mode; ignored in continuous mode.
 * @param {InputSimulation<InputKey>} options.simulate
 * @param {number} [options.maxSteps]
 * @param {boolean} [options.continuous]
 * @param {ReadonlyArray<InputKey>} [options.edgeKeys]
 * @param {number} [options.fixedDtSec] Configured command duration in seconds.
 * @returns {number} Number of queued commands consumed.
 */
export function consumeInputFrames({
  player,
  dtSec,
  simulate,
  maxSteps = INPUT_LIMITS.MAX_FRAMES_PER_TICK,
  continuous = false,
  edgeKeys = [],
  fixedDtSec = NETWORK_TIMING.FIXED_DT_SEC,
}) {
  if (!player || typeof player !== "object" || typeof simulate !== "function") {
    return 0;
  }
  ensurePlayerInputState(player);
  const inputBuffer = getPlayerInputBuffer(player);

  if (continuous) {
    return consumeContinuousInputFrames(player, inputBuffer, simulate, maxSteps, edgeKeys, fixedDtSec);
  }
  return consumeQueuedInputFrames(player, inputBuffer, dtSec, simulate, maxSteps, fixedDtSec);
}

/**
 * Discard queued commands, credit, acknowledgements, and held input in place.
 * The game owns epoch/protocol resets and performs them separately.
 * @template {string} InputKey
 * @param {PlayerInputState<InputKey>} player
 * @param {GameInputState<InputKey>} [inputTemplate] Restore exact neutral defaults when provided.
 * @returns {void}
 */
export function resetInputBuffer(player, inputTemplate) {
  if (!player || typeof player !== "object") {
    return;
  }
  delete player.__inputBuffer;
  player.lastInputSeqAck = 0;
  player.inputSimulationTick = 0;

  if (isPlainObject(player.input)) {
    const inputKeys = /** @type {InputKey[]} */ (Object.keys(player.input));
    for (const inputKey of inputKeys) {
      if (inputTemplate && !Object.hasOwn(inputTemplate, inputKey)) {
        delete player.input[inputKey];
      } else {
        player.input[inputKey] = inputTemplate ? inputTemplate[inputKey] : false;
      }
    }
    if (inputTemplate) {
      Object.assign(player.input, inputTemplate);
    }
  }
}
