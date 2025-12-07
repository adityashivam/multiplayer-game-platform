import { getGamesStore } from "./gameStore.js";
import { tickGames } from "./gameLoop.js";
import { handleJoinGame, handlePlayerDisconnect } from "./rooms.js";
import { registerSocketHandlers } from "./socketHandlers.js";

export function registerGame({
  io,
  meta,
  createState,
  onStateCreated,
  onPlayerConnected,
  handleInput,
  handleDisconnect,
  handleRematch,
  beforeUpdate,
  updateState,
  serializeState,
  afterEmit,
  tickMs = 1000 / 60,
  dtFallback = 1 / 60,
  stateEvent = "state",
}) {
  const nsp = io.of(meta.namespace);
  const games = getGamesStore(nsp);

  setInterval(
    () =>
      tickGames({
        games,
        nsp,
        dtFallback,
        beforeUpdate,
        updateState,
        serializeState,
        afterEmit,
        stateEvent,
      }),
    tickMs,
  );

  registerSocketHandlers(nsp, (socket) => {
    const handlers = {
      joinGame: createJoinHandler({
        nsp,
        socket,
        games,
        createState,
        onStateCreated,
        onPlayerConnected,
      }),
      input: createInputHandler({ socket, games, handleInput }),
      disconnect: createDisconnectHandler({ socket, games, handleDisconnect }),
    };

    if (handleRematch) {
      handlers.rematch = createRematchHandler({ socket, games, nsp, handleRematch });
    }

    return handlers;
  });
}

function createJoinHandler({ nsp, socket, games, createState, onStateCreated, onPlayerConnected }) {
  return ({ gameId }) =>
    handleJoinGame({
      nsp,
      socket,
      games,
      gameId,
      createState,
      onStateCreated,
      onPlayerConnected,
    });
}

function createInputHandler({ socket, games, handleInput }) {
  if (!handleInput) return null;
  return (payload) => {
    const gameId = socket.data.gameId;
    const playerId = socket.data.playerId;
    if (!gameId || !playerId) return;

    const state = games.get(gameId);
    if (!state) return;

    handleInput({ state, playerId, payload, socket });
  };
}

function createDisconnectHandler({ socket, games, handleDisconnect }) {
  return () =>
    handlePlayerDisconnect({
      socket,
      games,
      onPlayerDisconnect: handleDisconnect,
    });
}

function createRematchHandler({ socket, games, nsp, handleRematch }) {
  return (payload) =>
    handleRematch({
      socket,
      games,
      nsp,
      payload,
    });
}
