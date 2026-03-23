import { getGamesStore } from "./gameStore.js";
import { tickGames } from "./gameLoop.js";
import { handleJoinGame, handlePlayerDisconnect } from "./rooms.js";
import { registerSocketHandlers } from "./socketHandlers.js";

function preciseInterval(callback, intervalMs) {
  let expected = Date.now() + intervalMs;
  let timer;
  function step() {
    const drift = Date.now() - expected;
    callback();
    expected += intervalMs;
    timer = setTimeout(step, Math.max(0, intervalMs - drift));
  }
  timer = setTimeout(step, intervalMs);
  return { clear: () => clearTimeout(timer) };
}

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
  shouldCleanup,
  tickMs = 1000 / 60,
  dtFallback = 1 / 60,
  stateEvent = "state",
}) {
  const nsp = io.of(meta.namespace);
  const games = getGamesStore(nsp);
  let lastTickInvokeMs = Date.now();

  preciseInterval(
    () => {
      const nowMs = Date.now();
      const loopLagMs = Math.max(0, nowMs - lastTickInvokeMs - tickMs);
      lastTickInvokeMs = nowMs;
      tickGames({
        games,
        nsp,
        tickMs,
        dtFallback,
        beforeUpdate,
        updateState,
        serializeState,
        afterEmit,
        stateEvent,
        shouldCleanup,
        loopLagMs,
      });
    },
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
  return ({ gameId, rejoinToken }) =>
    handleJoinGame({
      nsp,
      socket,
      games,
      gameId,
      createState,
      onStateCreated,
      onPlayerConnected,
      rejoinToken,
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
