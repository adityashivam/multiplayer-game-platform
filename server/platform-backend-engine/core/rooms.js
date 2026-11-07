import { randomBytes } from "crypto";
import { emitEvent } from "./events.js";
import { getRoomPlayerIds } from "./state.js";
import { SOCKET_EVENT } from "../../../public/platform/shared/networkProtocol.js";

/**
 * @template {import("./state.js").RoomState} GameState
 * @typedef {object} JoinRoomOptions
 * @property {import("socket.io").Namespace} nsp
 * @property {import("socket.io").Socket} socket
 * @property {Map<string, GameState>} games
 * @property {string} gameId
 * @property {() => GameState} createState
 * @property {(state: GameState) => void} [onStateCreated]
 * @property {(state: GameState, playerId: string) => void} [onPlayerDisconnect]
 * @property {readonly string[]} [playerIds]
 * @property {string} [rejoinToken]
 */

/**
 * Include command ownership only for games that expose a valid input epoch.
 * @param {string} playerId
 * @param {string} gameId
 * @param {string} rejoinToken
 * @param {number | undefined} inputEpoch
 * @returns {{playerId: string, gameId: string, rejoinToken: string, inputEpoch?: number}}
 */
function createGameJoinedPayload(playerId, gameId, rejoinToken, inputEpoch) {
  return {
    playerId,
    gameId,
    rejoinToken,
    ...(Number.isSafeInteger(inputEpoch) ? { inputEpoch } : {}),
  };
}

/**
 * Socket ownership prevents a stale game connected flag from allowing a takeover.
 * @param {import("socket.io").Namespace} nsp
 * @param {string} gameId
 * @returns {Set<string>}
 */
function collectOccupiedPlayerIds(nsp, gameId) {
  const occupiedPlayerIds = new Set();
  const roomSocketIds = nsp.adapter.rooms.get(gameId);
  if (!roomSocketIds) return occupiedPlayerIds;

  for (const socketId of roomSocketIds) {
    const roomSocket = nsp.sockets.get(socketId);
    if (roomSocket?.data?.gameId === gameId && roomSocket.data.playerId) {
      occupiedPlayerIds.add(roomSocket.data.playerId);
    }
  }
  return occupiedPlayerIds;
}

/**
 * Allocate a game-defined slot, releasing the socket's previous room lifecycle first.
 * A missing/incorrect reconnect token follows ordinary vacant-slot allocation.
 * @template {import("./state.js").RoomState} GameState
 * @param {JoinRoomOptions<GameState>} options
 * @returns {{playerId: string, state: GameState, rejoined: boolean, alreadyJoined: boolean}|null}
 * @throws {TypeError} If room state or configured player slots are invalid.
 */
export function joinGameRoom({
  nsp,
  socket,
  games,
  gameId,
  createState,
  onStateCreated,
  onPlayerDisconnect,
  playerIds,
  rejoinToken,
}) {
  if (!gameId) return null;

  const previousGameId = socket.data.gameId;
  if (previousGameId && previousGameId !== gameId) {
    handlePlayerDisconnect({ socket, games, onPlayerDisconnect });
    socket.leave(previousGameId);
    socket.data.gameId = null;
    socket.data.playerId = null;
  }

  if (!games.has(gameId)) {
    games.set(gameId, createState());
    if (onStateCreated) {
      onStateCreated(games.get(gameId));
    }
  }

  const state = games.get(gameId);
  const roomPlayerIds = getRoomPlayerIds(state, playerIds);
  const previousPlayerId = socket.data.playerId;

  if (socket.data.gameId === gameId && roomPlayerIds.includes(previousPlayerId)) {
    socket.join(gameId);
    return { playerId: previousPlayerId, state, rejoined: true, alreadyJoined: true };
  }

  const occupiedPlayerIds = collectOccupiedPlayerIds(nsp, gameId);
  const isVacantSlot = (playerId) => !state.players[playerId].connected && !occupiedPlayerIds.has(playerId);
  const rejoinSlot = typeof rejoinToken === "string" && rejoinToken.length > 0
    ? roomPlayerIds.find((playerId) => isVacantSlot(playerId) && state.players[playerId].rejoinToken === rejoinToken)
    : undefined;
  const playerId = rejoinSlot ?? roomPlayerIds.find(isVacantSlot);

  if (playerId === undefined) {
    emitEvent({ socket, type: SOCKET_EVENT.ROOM_FULL });
    return null;
  }

  socket.join(gameId);
  socket.data.gameId = gameId;
  socket.data.playerId = playerId;
  state.players[playerId].connected = true;

  return {
    playerId,
    state,
    rejoined: rejoinSlot !== undefined,
    alreadyJoined: false,
  };
}

/**
 * Release platform ownership before invoking game cleanup; safe on repeated disconnects.
 * @template {import("./state.js").RoomState} GameState
 * @param {object} options
 * @param {import("socket.io").Socket} options.socket
 * @param {Map<string, GameState>} options.games
 * @param {(state: GameState, playerId: string) => void} [options.onPlayerDisconnect]
 * @returns {void}
 */
export function handlePlayerDisconnect({ socket, games, onPlayerDisconnect }) {
  const { gameId, playerId } = socket.data;
  if (!gameId || !playerId) return;

  const state = games.get(gameId);
  if (state?.players && Object.hasOwn(state.players, playerId)) {
    state.players[playerId].connected = false;
    if (onPlayerDisconnect) {
      onPlayerDisconnect(state, playerId);
    }
    emitEvent({ socket, gameId, type: SOCKET_EVENT.PLAYER_LEFT, payload: { playerId }, target: "others" });
  }

  socket.data.gameId = null;
  socket.data.playerId = null;
}

/**
 * Join and announce ownership; repeated joins retain the existing token and input epoch.
 * @template {import("./state.js").RoomState} GameState
 * @param {JoinRoomOptions<GameState> & {onPlayerConnected?: (state: GameState, playerId: string) => void}} options
 * @returns {void}
 */
export function handleJoinGame({
  nsp,
  socket,
  games,
  gameId,
  createState,
  onStateCreated,
  onPlayerConnected,
  onPlayerDisconnect,
  playerIds,
  rejoinToken,
}) {
  const joined = joinGameRoom({
    nsp,
    socket,
    games,
    gameId,
    createState,
    onStateCreated,
    onPlayerDisconnect,
    playerIds,
    rejoinToken,
  });
  if (!joined) return;

  const { playerId, state } = joined;

  const playerState = state.players[playerId];
  const token = joined.rejoined && playerState.rejoinToken
    ? playerState.rejoinToken
    : randomBytes(16).toString("hex");
  playerState.rejoinToken = token;

  if (!joined.alreadyJoined && onPlayerConnected) {
    onPlayerConnected(state, playerId);
  }

  emitEvent({
    socket,
    type: SOCKET_EVENT.GAME_JOINED,
    payload: createGameJoinedPayload(playerId, gameId, token, state.players[playerId]?.inputEpoch),
  });
  if (!joined.alreadyJoined) {
    emitEvent({ socket, gameId, type: SOCKET_EVENT.PLAYER_JOINED, payload: { playerId }, target: "others" });
  }
}
