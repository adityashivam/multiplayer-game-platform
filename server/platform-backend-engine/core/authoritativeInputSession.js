import {
  applySequencedInput,
  consumeInputFrames,
  enqueueInputFrame,
  ensurePlayerInputState,
  resetInputBuffer,
} from "./inputProtocol.js";
import {
  INPUT_LIMITS,
  INPUT_MESSAGE_TYPE,
  INPUT_PROTOCOL,
  NETWORK_TIMING,
} from "../../../public/platform/shared/networkProtocol.js";

/**
 * Networking state owned by the SDK, added to a game's player state in place.
 * @template {string} InputKey
 * @typedef {import("./inputProtocol.js").PlayerInputState<InputKey> & {
 *   inputProtocol?: 1 | 2 | null,
 *   __lastInputReceiptMs?: number | null,
 *   __inputLoopTick?: number,
 *   __inputStepsThisTick?: number,
 *   __inputDroppedSteps?: number
 * }} AuthoritativePlayerInputState
 */

/**
 * Game-owned slots plus timing attached by the platform room loop.
 * @template {string} PlayerId
 * @template PlayerState
 * @typedef {object} AuthoritativeInputRoom
 * @property {Record<PlayerId, PlayerState>} players
 * @property {number} [__loopTick]
 * @property {number} [__loopMonotonicNow]
 * @property {{droppedSteps: number}} [__roomClock]
 */

/**
 * @typedef {object} PlayerInputSnapshotMetadata
 * @property {number} inputSeqAck
 * @property {number | undefined} inputEpoch
 * @property {number | undefined} inputSimulationTick
 */

/**
 * Own queued/legacy receipt, command budgets and recovery for a game's players.
 * Call resetPlayer on each ownership change. Games retain simulation rules;
 * simulateRoom supplies platform timing and getPlayerSnapshotMetadata serializes
 * acknowledgements, ownership epochs and simulation ticks.
 * @template {string} InputKey
 * @param {object} options
 * @param {import("./inputProtocol.js").GameInputState<InputKey>} options.inputTemplate
 * @param {ReadonlyArray<InputKey>} [options.edgeKeys]
 * @param {number} [options.fixedDtSec] Duration of one queued simulation step.
 * @param {number} [options.starvationMs] Maximum gap before queued input resets.
 * @returns {{
 *   resetPlayer: (player: AuthoritativePlayerInputState<InputKey>) => void,
 *   receiveInput: (player: AuthoritativePlayerInputState<InputKey>, payload: import("./inputProtocol.js").InputPacket<InputKey>, nowMs?: number) => boolean,
 *   simulatePlayer: (options: {
 *     player: AuthoritativePlayerInputState<InputKey>,
 *     dtSec: number,
 *     loopTick?: number,
 *     nowMs?: number,
 *     droppedSteps?: number,
 *     simulate: import("./inputProtocol.js").InputSimulation<InputKey>
 *   }) => number,
 *   simulateRoom: <PlayerId extends string, PlayerState extends AuthoritativePlayerInputState<InputKey>>(options: {
 *     state: AuthoritativeInputRoom<PlayerId, PlayerState>,
 *     dtSec: number,
 *     simulate: (player: PlayerState, inputState: import("./inputProtocol.js").GameInputState<InputKey>, fixedDtSec: number, playerId: PlayerId, inputFrame: import("./inputProtocol.js").QueuedInputFrame<InputKey> | null) => void
 *   }) => number,
 *   getPlayerSnapshotMetadata: (player: AuthoritativePlayerInputState<InputKey>) => PlayerInputSnapshotMetadata
 * }}
 * @throws {TypeError} If simulation duration or starvation timing is invalid.
 */
export function createAuthoritativeInputSession({
  inputTemplate,
  edgeKeys = [],
  fixedDtSec = NETWORK_TIMING.FIXED_DT_SEC,
  starvationMs = NETWORK_TIMING.INPUT_STARVATION_MS,
}) {
  if (!Number.isFinite(fixedDtSec) || fixedDtSec <= 0) {
    throw new TypeError("Authoritative input session fixedDtSec must be positive and finite.");
  }
  if (!Number.isFinite(starvationMs) || starvationMs < 0) {
    throw new TypeError("Authoritative input session starvationMs must be nonnegative and finite.");
  }

  /**
   * Clear held/queued input and advance ownership without changing game fields.
   * Keep the dropped-step baseline so recovery occurs once per counter increase.
   * @param {AuthoritativePlayerInputState<InputKey>} player
   */
  function resetPlayer(player) {
    if (!player || typeof player !== "object") {
      return;
    }
    ensurePlayerInputState(player, inputTemplate);
    resetInputBuffer(player);
    player.inputEpoch = (Number.isSafeInteger(player.inputEpoch) ? player.inputEpoch : 0) + 1;
    player.inputProtocol = null;
    player.__lastInputReceiptMs = null;
    delete player.__inputLoopTick;
    player.__inputStepsThisTick = 0;
  }

  /**
   * Accept an owned command copy; queued input blocks legacy overwrites.
   * Invalid or stale packets do not extend the queued session's lifetime.
   * @param {AuthoritativePlayerInputState<InputKey>} player
   * @param {import("./inputProtocol.js").InputPacket<InputKey>} payload
   * @param {number} [nowMs] Monotonic receipt time in milliseconds.
   * @returns {boolean} Whether the input was accepted.
   */
  function receiveInput(player, payload, nowMs = performance.now()) {
    if (!player || typeof player !== "object") {
      return false;
    }

    if (payload?.type === INPUT_MESSAGE_TYPE.FRAME && payload.protocol === INPUT_PROTOCOL.QUEUED) {
      const acceptedFrame = enqueueInputFrame({ player, payload, inputTemplate });
      if (acceptedFrame) {
        player.inputProtocol = INPUT_PROTOCOL.QUEUED;
        player.__lastInputReceiptMs = nowMs;
      }
      return acceptedFrame;
    }
    if (player.inputProtocol === INPUT_PROTOCOL.QUEUED) {
      return false;
    }

    return applySequencedInput({ player, payload, inputTemplate });
  }

  /**
   * Advance one world step, with one command budget across a loop's catch-up.
   * Queued simulation continues held input between packets. A throwing callback
   * leaves its command queued and unacknowledged; game mutations are not undone.
   * @param {object} options
   * @param {AuthoritativePlayerInputState<InputKey>} options.player Mutated in place.
   * @param {number} options.dtSec Legacy step duration in seconds.
   * @param {number} [options.loopTick] Shared identifier for a room-loop invocation.
   * @param {number} [options.nowMs] Monotonic simulation time in milliseconds.
   * @param {number} [options.droppedSteps] Cumulative dropped world-step count.
   * @param {import("./inputProtocol.js").InputSimulation<InputKey>} options.simulate
   * @returns {number} Queued commands incorporated in this world step.
   * @throws {Error} Propagates simulation callback errors.
   */
  function simulatePlayer({
    player,
    dtSec,
    loopTick,
    nowMs = performance.now(),
    droppedSteps = 0,
    simulate,
  }) {
    if (!player || typeof player !== "object" || typeof simulate !== "function") {
      return 0;
    }
    ensurePlayerInputState(player, inputTemplate);

    const didDropSteps = droppedSteps > (player.__inputDroppedSteps || 0);
    player.__inputDroppedSteps = droppedSteps;
    const inputStarved = Number.isFinite(player.__lastInputReceiptMs) &&
      nowMs - player.__lastInputReceiptMs > starvationMs;
    if (player.inputProtocol === INPUT_PROTOCOL.QUEUED && (didDropSteps || inputStarved)) {
      resetPlayer(player);
    }

    if (player.inputProtocol !== INPUT_PROTOCOL.QUEUED) {
      // Retain bounded pre-session credit and legacy simulation timing.
      consumeInputFrames({ player, dtSec, fixedDtSec, simulate() {} });
      simulate(player.input, dtSec, null);
      return 0;
    }

    if (loopTick == null || player.__inputLoopTick !== loopTick ||
        !Number.isFinite(player.__inputStepsThisTick)) {
      player.__inputLoopTick = loopTick;
      player.__inputStepsThisTick = 0;
    }

    const consumedFrameCount = consumeInputFrames({
      player,
      dtSec,
      fixedDtSec,
      simulate,
      maxSteps: INPUT_LIMITS.MAX_FRAMES_PER_TICK - player.__inputStepsThisTick,
      continuous: true,
      edgeKeys,
    });
    player.__inputStepsThisTick += consumedFrameCount;
    return consumedFrameCount;
  }

  /**
   * Simulate each own player slot in the order declared by state.players. Clock
   * metadata stays inside the SDK; each player retains its own bounded budget.
   * An error stops later slots, retains the failing command and preserves earlier
   * completed player steps. Game mutations are never rolled back.
   * @template {string} PlayerId
   * @template {AuthoritativePlayerInputState<InputKey>} PlayerState
   * @param {object} options
   * @param {AuthoritativeInputRoom<PlayerId, PlayerState>} options.state
   * @param {number} options.dtSec World-step duration in seconds.
   * @param {(player: PlayerState, inputState: import("./inputProtocol.js").GameInputState<InputKey>, fixedDtSec: number, playerId: PlayerId, inputFrame: import("./inputProtocol.js").QueuedInputFrame<InputKey> | null) => void} options.simulate
   * @returns {number} Total commands incorporated across all player slots.
   * @throws {Error} Propagates simulation callback errors.
   */
  function simulateRoom({ state, dtSec, simulate }) {
    if (!state?.players || typeof simulate !== "function") {
      return 0;
    }
    const playerIds = /** @type {PlayerId[]} */ (Object.keys(state.players));
    const loopTick = state.__loopTick;
    const nowMs = state.__loopMonotonicNow;
    const droppedSteps = state.__roomClock?.droppedSteps || 0;
    let consumedFrameCount = 0;

    for (const playerId of playerIds) {
      const player = state.players[playerId];
      consumedFrameCount += simulatePlayer({
        player,
        dtSec,
        loopTick,
        nowMs,
        droppedSteps,
        simulate: (inputState, fixedDtSec, inputFrame) =>
          simulate(player, inputState, fixedDtSec, playerId, inputFrame),
      });
    }
    return consumedFrameCount;
  }

  /**
   * Map SDK ownership to an owned snapshot object, preserving wire defaults.
   * @param {AuthoritativePlayerInputState<InputKey>} player
   * @returns {PlayerInputSnapshotMetadata}
   */
  function getPlayerSnapshotMetadata(player) {
    return {
      inputSeqAck: player.lastInputSeqAck || 0,
      inputEpoch: player.inputEpoch,
      inputSimulationTick: player.inputSimulationTick,
    };
  }

  return { resetPlayer, receiveInput, simulatePlayer, simulateRoom, getPlayerSnapshotMetadata };
}
