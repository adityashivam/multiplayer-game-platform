import { isSupportedPlayerSlotId } from "../../../public/platform/shared/gameIdentifiers.js";
import { ROOM_START_COUNTDOWN_MS } from "../../../public/platform/shared/roomLifecycle.js";

/**
 * @typedef {object} RoomPlayerState
 * @property {boolean} [connected]
 * @property {string} [rejoinToken]
 * @property {number} [inputEpoch]
 */

/**
 * @typedef {object} RoomState
 * @property {Record<string, RoomPlayerState>} players Game-defined authoritative slots.
 * @property {boolean} [started]
 * @property {boolean} [gameOver]
 * @property {number|null} [startAt]
 * @property {{scheduledStartAtMs:number,countdownDurationMs:number}} [__roomStart] Platform-owned timing retained after startAt is cleared.
 */

/**
 * Resolve the configured slots without deriving capacity from socket room size.
 * @param {RoomState} state
 * @param {readonly string[]} [playerIds] Defaults to all own keys in state.players.
 * @returns {readonly string[]}
 * @throws {TypeError} If configured slots are invalid or absent from the state.
 */
export function getRoomPlayerIds(state, playerIds) {
  if (!state?.players || typeof state.players !== "object" || Array.isArray(state.players)) {
    throw new TypeError("Room state requires a players object");
  }

  const roomPlayerIds = playerIds ?? Object.keys(state.players);
  if (!Array.isArray(roomPlayerIds) || (playerIds !== undefined && roomPlayerIds.length === 0) ||
      new Set(roomPlayerIds).size !== roomPlayerIds.length ||
      roomPlayerIds.some((playerId) => !isSupportedPlayerSlotId(playerId) ||
        !Object.hasOwn(state.players, playerId) || !state.players[playerId] ||
        typeof state.players[playerId] !== "object")) {
    throw new TypeError("Room playerIds must identify unique authoritative player slots");
  }
  return roomPlayerIds;
}

/** @param {RoomState} state @param {readonly string[]} [playerIds] @returns {boolean} */
export function allPlayersConnected(state, playerIds) {
  const roomPlayerIds = getRoomPlayerIds(state, playerIds);
  return roomPlayerIds.length > 0 && roomPlayerIds.every((playerId) => Boolean(state.players[playerId].connected));
}

/** Preserve the original public name while supporting every configured player slot.
 * @param {RoomState} state
 * @param {readonly string[]} [playerIds]
 * @returns {boolean}
 */
export function bothPlayersConnected(state, playerIds) {
  return allPlayersConnected(state, playerIds);
}

/**
 * Schedule a ready room once; the game callback may prepare its countdown state.
 * @template {RoomState} GameState
 * @param {GameState} state Mutated in place.
 * @param {number} [countdownMs=5000]
 * @param {(state: GameState) => void} [onScheduleStart]
 * @param {readonly string[]} [playerIds]
 * @returns {void}
 */
export function scheduleStart(state, countdownMs = ROOM_START_COUNTDOWN_MS, onScheduleStart, playerIds) {
  if (!state.started && !state.gameOver && !state.startAt && allPlayersConnected(state, playerIds)) {
    if (onScheduleStart) {
      onScheduleStart(state);
    }
    state.startAt = Date.now() + countdownMs;
    state.__roomStart = { scheduledStartAtMs: state.startAt, countdownDurationMs: countdownMs };
  }
}
