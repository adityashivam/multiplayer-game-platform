import { getGamesStore } from "./gameStore.js";
import { tickGames } from "./gameLoop.js";
import { handleJoinGame, handlePlayerDisconnect } from "./rooms.js";
import { registerSocketHandlers } from "./socketHandlers.js";
import { NETWORK_TIMING, SOCKET_EVENT } from "../../../public/platform/shared/networkProtocol.js";

/**
 * Schedule repeated callbacks against monotonic time and return a cancellation handle.
 * @param {() => void} callback
 * @param {number} intervalMs
 * @returns {{clear: () => void}}
 */
function startMonotonicInterval(callback, intervalMs) {
  let expectedInvocationMs = performance.now() + intervalMs;
  let intervalTimer;

  function invokeIntervalCallback() {
    const schedulingDriftMs = performance.now() - expectedInvocationMs;
    callback();
    expectedInvocationMs += intervalMs;
    intervalTimer = setTimeout(invokeIntervalCallback, Math.max(0, intervalMs - schedulingDriftMs));
  }

  intervalTimer = setTimeout(invokeIntervalCallback, intervalMs);
  return { clear: () => clearTimeout(intervalTimer) };
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
  tickMs = 1000 / NETWORK_TIMING.SIMULATION_HZ,
  dtFallback = NETWORK_TIMING.FIXED_DT_SEC,
  stateEvent = SOCKET_EVENT.STATE,
}) {
  const nsp = io.of(meta.namespace);
  const games = getGamesStore(nsp);
  let lastTickInvocationMs = performance.now();

  startMonotonicInterval(
    () => {
      const monotonicNowMs = performance.now();
      const loopLagMs = Math.max(0, monotonicNowMs - lastTickInvocationMs - tickMs);
      lastTickInvocationMs = monotonicNowMs;
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
