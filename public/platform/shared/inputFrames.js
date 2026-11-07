import { INPUT_MESSAGE_TYPE, INPUT_PROTOCOL, NETWORK_TIMING } from "./networkProtocol.js";

/**
 * @template InputState
 * @typedef {{type: "inputFrame", seq: number, dtSec: number, state: InputState}} LegacyInputFrame
 */

/**
 * @template InputState
 * @typedef {{type: "inputFrame", protocol: 2, epoch: number, seq: number, state: InputState}} QueuedInputFrame
 */

/**
 * @template InputState
 * @typedef {LegacyInputFrame<InputState>|QueuedInputFrame<InputState>} EncodedInputFrame
 */

/**
 * Encode a command using server-owned duration for queued input or explicit
 * duration for legacy input. The supplied game input is retained by reference.
 * @template InputState
 * @param {object} frameOptions
 * @param {number|undefined} frameOptions.protocolVersion
 * @param {number|undefined} frameOptions.inputEpoch
 * @param {number} frameOptions.sequenceNumber
 * @param {InputState} frameOptions.inputState
 * @param {number} [frameOptions.fixedDtSec=1/60]
 * @returns {EncodedInputFrame<InputState>}
 */
export function createInputFrame({
  protocolVersion,
  inputEpoch,
  sequenceNumber,
  inputState,
  fixedDtSec = NETWORK_TIMING.FIXED_DT_SEC,
}) {
  if (protocolVersion >= INPUT_PROTOCOL.QUEUED && Number.isSafeInteger(inputEpoch)) {
    return {
      type: INPUT_MESSAGE_TYPE.FRAME,
      protocol: INPUT_PROTOCOL.QUEUED,
      epoch: inputEpoch,
      seq: sequenceNumber,
      state: inputState,
    };
  }

  return {
    type: INPUT_MESSAGE_TYPE.FRAME,
    seq: sequenceNumber,
    dtSec: fixedDtSec,
    state: inputState,
  };
}
