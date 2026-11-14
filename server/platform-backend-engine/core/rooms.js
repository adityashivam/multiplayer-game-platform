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
 * How long a seat survives an involuntary transport loss before the game is
 * told the player left. Proxies and mobile networks cut WebSockets for a
 * moment; a token rejoin inside this window resumes play without a pause.
 */
export const PLATFORM_RECONNECT_GRACE_MS = 4000;
/** Socket.IO disconnect reasons that mean the connection broke, not that the player left. */
const TRANSPORT_LOSS_REASONS = new Set(["transport close", "transport error", "ping timeout"]);

/**
 * @typedef {{cancel: () => void}} SeatReleaseHandle
 * @typedef {(release: () => void, delayMs: number) => SeatReleaseHandle} SeatReleaseScheduler
 */

/** Seats held for reconnection, per room state. Server-private; never serialized. */
const heldSeatsByRoom = new WeakMap();

/**
 * Default scheduler: an unreferenced timer, so a held seat never keeps the
 * process alive.
 * @type {SeatReleaseScheduler}
 */
function scheduleSeatReleaseTimer(release, delayMs) {
  const timer = setTimeout(release, delayMs);
  timer.unref?.();
  return { cancel: () => clearTimeout(timer) };
}

/**
 * Grace for a Socket.IO disconnect reason: transport loss is held for
 * reconnection; a deliberate leave or server shutdown releases at once.
 * @param {string | undefined} reason
 * @returns {number} Milliseconds; zero releases immediately.
 */
export function getReconnectGraceMs(reason) {
  return TRANSPORT_LOSS_REASONS.has(reason) ? PLATFORM_RECONNECT_GRACE_MS : 0;
}

/** @param {object} state @param {string} playerId @returns {boolean} */
function isSeatHeldForReconnect(state, playerId) {
  return heldSeatsByRoom.get(state)?.has(playerId) === true;
}

/**
 * Cancel a pending release because the seat's owner came back.
 * @param {object} state
 * @param {string} playerId
 */
function resumeHeldSeat(state, playerId) {
  const heldSeats = heldSeatsByRoom.get(state);
  heldSeats?.get(playerId)?.cancel();
  heldSeats?.delete(playerId);
}

/**
 * Mark a seat offline and run game cleanup.
 * @template {import("./state.js").RoomState} GameState
 * @param {GameState} state
 * @param {string} playerId
 * @param {((state: GameState, playerId: string) => void) | undefined} onPlayerDisconnect
 */
function releasePlayerSeat(state, playerId, onPlayerDisconnect) {
  state.players[playerId].connected = false;
  if (onPlayerDisconnect) {
    onPlayerDisconnect(state, playerId);
  }
}

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
 * @returns {Map<string, import("socket.io").Socket>}
 */
function collectPlayerSocketOwners(nsp, gameId) {
  const playerSocketOwners = new Map();
  const roomSocketIds = nsp.adapter.rooms.get(gameId);
  if (!roomSocketIds) return playerSocketOwners;

  for (const socketId of roomSocketIds) {
    const roomSocket = nsp.sockets.get(socketId);
    if (roomSocket?.data?.gameId === gameId && roomSocket.data.playerId) {
      playerSocketOwners.set(roomSocket.data.playerId, roomSocket);
    }
  }
  return playerSocketOwners;
}

/**
 * Allocate a game-defined slot, releasing the socket's previous room lifecycle first.
 * A missing/incorrect reconnect token follows ordinary vacant-slot allocation.
 * A token for an occupied slot preserves that identity and requests bounded retry.
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
    handlePlayerDisconnect({ socket, nsp, games, onPlayerDisconnect });
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

  const playerSocketOwners = collectPlayerSocketOwners(nsp, gameId);
  const isVacantSlot = (playerId) => !state.players[playerId].connected && !playerSocketOwners.has(playerId);
  const tokenPlayerId = typeof rejoinToken === "string" && rejoinToken.length > 0
    ? roomPlayerIds.find((playerId) => state.players[playerId].rejoinToken === rejoinToken)
    : undefined;
  const resumesHeldSeat = tokenPlayerId !== undefined && isSeatHeldForReconnect(state, tokenPlayerId) &&
    !playerSocketOwners.has(tokenPlayerId);
  if (resumesHeldSeat) {
    resumeHeldSeat(state, tokenPlayerId);
  } else if (tokenPlayerId !== undefined && !isVacantSlot(tokenPlayerId)) {
    emitEvent({ socket, type: SOCKET_EVENT.ROOM_FULL, payload: { gameId, rejoinPending: true } });
    return null;
  }

  const rejoinSlot = tokenPlayerId;
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
 * Release platform ownership before invoking game cleanup; safe on repeated
 * disconnects and on stale transports whose slot already has another owner.
 * With a reconnect grace the seat stays connected and the game keeps running;
 * cleanup runs only if the owner has not rejoined with its token in time.
 * @template {import("./state.js").RoomState} GameState
 * @param {object} options
 * @param {import("socket.io").Socket} options.socket
 * @param {import("socket.io").Namespace} [options.nsp] Defaults to the socket's namespace.
 * @param {Map<string, GameState>} options.games
 * @param {(state: GameState, playerId: string) => void} [options.onPlayerDisconnect]
 * @param {number} [options.reconnectGraceMs] Zero (the default) releases immediately.
 * @param {SeatReleaseScheduler} [options.scheduleSeatRelease] Injectable for tests.
 * @returns {void}
 */
export function handlePlayerDisconnect({
  socket,
  nsp = socket.nsp,
  games,
  onPlayerDisconnect,
  reconnectGraceMs = 0,
  scheduleSeatRelease = scheduleSeatReleaseTimer,
}) {
  const { gameId, playerId } = socket.data;
  if (!gameId || !playerId) return;

  const state = games.get(gameId);
  const currentSocketOwner = nsp && collectPlayerSocketOwners(nsp, gameId).get(playerId);
  const belongsToAnotherSocket = currentSocketOwner && currentSocketOwner !== socket;
  const ownsSeat = !belongsToAnotherSocket && state?.players && Object.hasOwn(state.players, playerId);
  socket.data.gameId = null;
  socket.data.playerId = null;
  if (!ownsSeat) return;

  if (reconnectGraceMs > 0 && !state.gameOver) {
    holdSeatForReconnect({ nsp, games, gameId, state, playerId, onPlayerDisconnect, reconnectGraceMs, scheduleSeatRelease });
    return;
  }
  releasePlayerSeat(state, playerId, onPlayerDisconnect);
  emitEvent({ socket, gameId, type: SOCKET_EVENT.PLAYER_LEFT, payload: { playerId }, target: "others" });
}

/**
 * Keep a seat for its owner; after the grace, release it unless the owner
 * rejoined or the room was replaced (rematch or cleanup).
 * @template {import("./state.js").RoomState} GameState
 * @param {{nsp: import("socket.io").Namespace, games: Map<string, GameState>, gameId: string, state: GameState, playerId: string,
 *   onPlayerDisconnect?: (state: GameState, playerId: string) => void, reconnectGraceMs: number, scheduleSeatRelease: SeatReleaseScheduler}} options
 */
function holdSeatForReconnect({ nsp, games, gameId, state, playerId, onPlayerDisconnect, reconnectGraceMs, scheduleSeatRelease }) {
  if (!heldSeatsByRoom.has(state)) heldSeatsByRoom.set(state, new Map());
  const heldSeats = heldSeatsByRoom.get(state);
  heldSeats.get(playerId)?.cancel();
  heldSeats.set(playerId, scheduleSeatRelease(() => {
    if (heldSeats.get(playerId) === undefined) return;
    heldSeats.delete(playerId);
    if (games.get(gameId) !== state) return;
    releasePlayerSeat(state, playerId, onPlayerDisconnect);
    emitEvent({ nsp, gameId, type: SOCKET_EVENT.PLAYER_LEFT, payload: { playerId }, target: "game" });
  }, reconnectGraceMs));
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
