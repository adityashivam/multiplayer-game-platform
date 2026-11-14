import { getGamesStore } from "./gameStore.js";
import { tickGames } from "./gameLoop.js";
import { getReconnectGraceMs, handleJoinGame, handlePlayerDisconnect } from "./rooms.js";
import { registerSocketHandlers } from "./socketHandlers.js";
import { createVoiceSignaling } from "./voiceSignaling.js";
import { NETWORK_TIMING, SOCKET_EVENT } from "../../../public/platform/shared/networkProtocol.js";

/**
 * @template {import("./state.js").RoomState} GameState
 * @typedef {object} GameRegistrationOptions
 * @property {import("socket.io").Server} io
 * @property {import("./gameRegistry.js").GameMetadata & {namespace: string}} meta
 * @property {readonly string[]} [playerIds] Defaults to meta.room.playerIds, then state.players keys.
 * @property {() => GameState} createState
 * @property {(state: GameState) => void} [onStateCreated]
 * @property {(state: GameState, playerId: string) => void} [onPlayerConnected]
 * @property {(options: {state: GameState, playerId: string, payload: unknown, socket: import("socket.io").Socket}) => void} [handleInput]
 * @property {(state: GameState, playerId: string) => void} [handleDisconnect]
 * @property {(options: {socket: import("socket.io").Socket, games: Map<string, GameState>, nsp: import("socket.io").Namespace, payload: unknown}) => void} [handleRematch]
 * @property {(state: GameState, dtSec: number) => void} [beforeUpdate]
 * @property {(state: GameState, dtSec: number) => void} [updateState]
 * @property {(state: GameState) => object} [serializeState]
 * @property {(state: GameState, dtSec: number) => void} [afterEmit]
 * @property {(state: GameState, nowMs: number) => boolean} [shouldCleanup]
 * @property {number} [tickMs] Defaults to the metadata cadence, then the platform default.
 * @property {number} [dtFallback] Defaults to tickMs expressed in seconds.
 * @property {string} [stateEvent]
 */

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

/**
 * Mount a game's room lifecycle and authoritative scheduler in its declared namespace.
 * State and lifecycle callbacks remain game-owned; slot allocation is platform-owned.
 * @template {import("./state.js").RoomState} GameState
 * @param {GameRegistrationOptions<GameState>} options
 * @returns {void}
 */
export function registerGame({
  io,
  meta,
  playerIds = meta.room?.playerIds,
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
  tickMs = 1000 / (meta.networking?.tickRateHz ?? NETWORK_TIMING.SIMULATION_HZ),
  dtFallback = tickMs / 1000,
  stateEvent = SOCKET_EVENT.STATE,
}) {
  if (!Number.isFinite(tickMs) || tickMs <= 0 || !Number.isFinite(dtFallback) || dtFallback <= 0) {
    throw new TypeError("Game registration requires positive finite simulation durations.");
  }

  const nsp = io.of(meta.namespace);
  const games = getGamesStore(nsp);
  const voiceSignaling = createVoiceSignaling({ nsp, games, playerIds });
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
        onPlayerDisconnect: handleDisconnect,
        playerIds,
        voiceSignaling,
      }),
      input: createInputHandler({ socket, games, handleInput }),
      disconnect: createDisconnectHandler({ socket, games, handleDisconnect, voiceSignaling }),
      ...voiceSignaling.createSocketHandlers(socket),
    };

    if (handleRematch) {
      handlers.rematch = createRematchHandler({ socket, games, nsp, handleRematch });
    }

    return handlers;
  });
}

function createJoinHandler({
  nsp,
  socket,
  games,
  createState,
  onStateCreated,
  onPlayerConnected,
  onPlayerDisconnect,
  playerIds,
  voiceSignaling,
}) {
  return ({ gameId, rejoinToken }) => {
    if (gameId && gameId !== socket.data.gameId) {
      voiceSignaling.leave(socket);
    }

    try {
      handleJoinGame({
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
      });
    } finally {
      voiceSignaling.reconcileSocket(socket);
    }
  };
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

/**
 * A broken transport holds the seat for a short reconnect grace so a brief
 * network or proxy cut does not pause the match; a deliberate leave releases it.
 */
function createDisconnectHandler({ socket, games, handleDisconnect, voiceSignaling }) {
  return (reason) => {
    voiceSignaling.leave(socket);
    handlePlayerDisconnect({
      socket,
      games,
      onPlayerDisconnect: handleDisconnect,
      reconnectGraceMs: getReconnectGraceMs(reason),
    });
  };
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
