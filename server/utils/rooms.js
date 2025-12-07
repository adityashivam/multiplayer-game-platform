import { emitEvent } from "./events.js";

export function joinGameRoom({
  nsp,
  socket,
  games,
  gameId,
  createState,
  onStateCreated,
}) {
  if (!gameId) return null;

  const room = nsp.adapter.rooms.get(gameId);
  let playerId;

  if (!room) {
    playerId = "p1";
  } else if (room.size === 1) {
    playerId = "p2";
  } else {
    emitEvent({ socket, type: "roomFull" });
    return null;
  }

  socket.join(gameId);
  socket.data.gameId = gameId;
  socket.data.playerId = playerId;

  if (!games.has(gameId)) {
    games.set(gameId, createState());
    if (onStateCreated) {
      onStateCreated(games.get(gameId));
    }
  }

  return {
    playerId,
    state: games.get(gameId),
  };
}

export function handlePlayerDisconnect({ socket, games, onPlayerDisconnect }) {
  const { gameId, playerId } = socket.data;
  if (!gameId || !playerId) return;

  const state = games.get(gameId);
  if (!state || !state.players || !state.players[playerId]) return;

  if (onPlayerDisconnect) {
    onPlayerDisconnect(state, playerId);
  }

  emitEvent({ socket, gameId, type: "playerLeft", payload: { playerId }, target: "others" });
}

export function handleJoinGame({
  nsp,
  socket,
  games,
  gameId,
  createState,
  onStateCreated,
  onPlayerConnected,
}) {
  const joined = joinGameRoom({
    nsp,
    socket,
    games,
    gameId,
    createState,
    onStateCreated,
  });
  if (!joined) return;

  const { playerId, state } = joined;
  if (state && state.players[playerId]) {
    if (onPlayerConnected) {
      onPlayerConnected(state, playerId);
    }
  }

  emitEvent({ socket, type: "gameJoined", payload: { playerId, gameId } });
  emitEvent({ socket, gameId, type: "playerJoined", payload: { playerId }, target: "others" });
}
