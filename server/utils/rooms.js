import { randomBytes } from "crypto";
import { emitEvent } from "./events.js";

function findRejoinSlot(state, rejoinToken) {
  if (!rejoinToken || !state || !state.players) return null;
  for (const id of ["p1", "p2"]) {
    const player = state.players[id];
    if (player && !player.connected && player.rejoinToken === rejoinToken) {
      return id;
    }
  }
  return null;
}

export function joinGameRoom({
  nsp,
  socket,
  games,
  gameId,
  createState,
  onStateCreated,
  rejoinToken,
}) {
  if (!gameId) return null;

  // If this socket was in a different room, leave it first
  const previousGameId = socket.data.gameId;
  if (previousGameId && previousGameId !== gameId) {
    socket.leave(previousGameId);
    const oldState = games.get(previousGameId);
    const oldPlayerId = socket.data.playerId;
    if (oldState && oldPlayerId && oldState.players && oldState.players[oldPlayerId]) {
      oldState.players[oldPlayerId].connected = false;
    }
    socket.data.gameId = null;
    socket.data.playerId = null;
  }

  // Ensure game state exists
  if (!games.has(gameId)) {
    games.set(gameId, createState());
    if (onStateCreated) {
      onStateCreated(games.get(gameId));
    }
  }

  const state = games.get(gameId);

  // Try to rejoin a disconnected slot first
  const rejoinSlot = findRejoinSlot(state, rejoinToken);
  if (rejoinSlot) {
    socket.join(gameId);
    socket.data.gameId = gameId;
    socket.data.playerId = rejoinSlot;
    return { playerId: rejoinSlot, state, rejoined: true };
  }

  // Normal join flow
  const room = nsp.adapter.rooms.get(gameId);
  let playerId;

  if (!room) {
    playerId = "p1";
  } else if (room.size === 1) {
    // Check if the one socket in the room already occupies a slot
    const existingSlots = new Set();
    for (const sid of room) {
      const s = nsp.sockets.get(sid);
      if (s?.data?.playerId) existingSlots.add(s.data.playerId);
    }
    if (!existingSlots.has("p1")) playerId = "p1";
    else if (!existingSlots.has("p2")) playerId = "p2";
    else {
      emitEvent({ socket, type: "roomFull" });
      return null;
    }
  } else {
    emitEvent({ socket, type: "roomFull" });
    return null;
  }

  socket.join(gameId);
  socket.data.gameId = gameId;
  socket.data.playerId = playerId;

  return {
    playerId,
    state,
    rejoined: false,
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
  rejoinToken,
}) {
  const joined = joinGameRoom({
    nsp,
    socket,
    games,
    gameId,
    createState,
    onStateCreated,
    rejoinToken,
  });
  if (!joined) return;

  const { playerId, state } = joined;

  // Generate a rejoin token for new joins; reuse existing for rejoins
  let token = rejoinToken;
  if (!joined.rejoined) {
    token = randomBytes(16).toString("hex");
  }
  if (state.players[playerId]) {
    state.players[playerId].rejoinToken = token;
  }

  if (state && state.players[playerId]) {
    if (onPlayerConnected) {
      onPlayerConnected(state, playerId);
    }
  }

  emitEvent({ socket, type: "gameJoined", payload: { playerId, gameId, rejoinToken: token } });
  emitEvent({ socket, gameId, type: "playerJoined", payload: { playerId }, target: "others" });
}
