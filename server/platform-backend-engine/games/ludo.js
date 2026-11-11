import { allPlayersConnected, emitEvent, registerGame, scheduleStart } from "../core/index.js";
import { SOCKET_EVENT } from "../../../public/platform/shared/networkProtocol.js";
import { ROOM_START_COUNTDOWN_MS } from "../../../public/platform/shared/roomLifecycle.js";
import { ludoPresentation, ludoTouchControls } from "../../../public/games/ludo/catalog.js";
import { LUDO_LIMITS, LUDO_PLAYER_IDS } from "../../../public/games/ludo/shared/config.js";
import { rollLudoDie } from "./ludoDice.js";
import {
  advanceLudoRound,
  applyLudoMove,
  applyLudoRoll,
  createLudoRound,
  getLegalLudoTokenIndices,
  isLudoEntryEligible,
} from "../../../public/games/ludo/shared/rules.js";

/** @typedef {import("../../../public/games/ludo/shared/config.js").LudoPlayerId} LudoPlayerId */
/** @typedef {import("../../../public/games/ludo/shared/config.js").LudoCommand} LudoCommand */
/** @typedef {import("../../../public/games/ludo/shared/rules.js").LudoRoundState} LudoRoundState */
/** @typedef {Omit<LudoRoundState,"legalTokenIndices">} LudoSnapshot */
/** @typedef {import("../../../public/games/ludo/shared/rules.js").LudoPlayerState & {rejoinToken?:string}} LudoServerPlayerState */
/** @typedef {{p1?:LudoServerPlayerState,p2?:LudoServerPlayerState,p3?:LudoServerPlayerState,p4?:LudoServerPlayerState}} LudoServerPlayers */
/** @typedef {{p1?:boolean,p2?:boolean,p3?:boolean,p4?:boolean}} LudoRematchRequests */
/**
 * @typedef {object} LudoPausedClock
 * @property {number} pausedAtMs
 * @property {number} phaseRemainingMs
 * @property {number} turnRemainingMs
 */
/**
 * Private room fields are deliberately excluded by serializeLudoState.
 * @typedef {Omit<LudoRoundState,"players"> & {
 *   players:LudoServerPlayers,
 *   rematchRequests:LudoRematchRequests,
 *   pausedClock:LudoPausedClock|null,
 *   abandonedAt:number|null,
 *   lastUpdate:number,
 *   __roomStart?:{scheduledStartAtMs:number,countdownDurationMs:number}
 * }} LudoServerState
 */
/**
 * Clock and die injection support deterministic server tests; clients cannot set them.
 * @typedef {object} LudoServerOptions
 * @property {(context:{entryBoosted:boolean}) => number} [rollDie] Random 1..6 sampler with server-selected entry odds.
 * @property {() => number} [nowFn] Defaults to the server wall clock.
 */
/**
 * @typedef {object} LudoServerController
 * @property {() => LudoServerState} createState
 * @property {(state:LudoServerState,playerId:LudoPlayerId) => void} onPlayerConnected
 * @property {(context:{state:LudoServerState,playerId:LudoPlayerId,payload:unknown}) => boolean} handleInput
 * @property {(state:LudoServerState,playerId:LudoPlayerId) => void} handleDisconnect
 * @property {(context:{socket:import("socket.io").Socket,games:Map<string,LudoServerState>,nsp:import("socket.io").Namespace}) => void} handleRematch
 * @property {(state:LudoServerState) => void} beforeUpdate
 * @property {(state:LudoServerState,nowMs:number) => boolean} shouldCleanup
 * @property {(state:LudoServerState) => LudoSnapshot} serializeState
 */

const ROOM_CLEANUP_DELAY_MS = 30000;
const ROLL_COMMAND_KEYS = Object.freeze(["type", "roundId", "revision"]);
const MOVE_COMMAND_KEYS = Object.freeze(["type", "roundId", "revision", "tokenIndex"]);

export const ludoGameMeta = {
  id: "ludo",
  presentation: ludoPresentation,
  touchControls: ludoTouchControls,
  name: "Ludo Table",
  description: "Roll, race and capture in a colorful two-player 3D Ludo match.",
  namespace: "/ludo",
  room: { playerIds: [...LUDO_PLAYER_IDS] },
  networking: {
    namespace: "/ludo",
    tickRateHz: 1000 / LUDO_LIMITS.SERVER_TICK_MS,
    inputProtocol: null,
    inputTemplate: null,
  },
  path: "/games/ludo",
  engine: "webgl",
  runtime: {
    kind: "module",
    mount: "canvas",
    entryUrl: "/games/ludo/dist/main.js",
    socketIo: true,
    kaboom: false,
  },
  tags: ["Board", "2 players", "Strategy"],
  startInLandscape: true,
  platformControlButtons: true,
};

/**
 * @param {{playerIds?:readonly LudoPlayerId[],roundId?:number,nowMs?:number}} [options]
 * @returns {LudoServerState} Fresh board and private room lifecycle state.
 */
export function createLudoServerState({ playerIds = LUDO_PLAYER_IDS, roundId = 1, nowMs = Date.now() } = {}) {
  const roundState = createLudoRound({ playerIds, roundId });
  /** @type {LudoRematchRequests} */
  const rematchRequests = {};
  for (const playerId of roundState.playerIds) {
    rematchRequests[playerId] = false;
  }

  return {
    ...roundState,
    rematchRequests,
    pausedClock: null,
    abandonedAt: null,
    lastUpdate: nowMs,
  };
}

/**
 * Return detached full recovery state with a stable action/player schema.
 * Reconnect credentials, rematch requests, pause bookkeeping and SDK internals stay private.
 * Clients derive legal choices from this board and die using the shared pure rules;
 * variable-length choice arrays never enter the packed snapshot schema.
 * @param {LudoServerState} state
 * @returns {LudoSnapshot}
 */
export function serializeLudoState(state) {
  /** @type {import("../../../public/games/ludo/shared/rules.js").LudoPlayers} */
  const players = {};
  for (const playerId of state.playerIds) {
    const playerState = state.players[playerId];
    players[playerId] = {
      id: playerState.id,
      color: playerState.color,
      tokens: [...playerState.tokens],
      connected: playerState.connected,
      finished: playerState.finished,
      captures: playerState.captures,
      seriesWins: playerState.seriesWins,
    };
  }

  return {
    roundId: state.roundId,
    revision: state.revision,
    playerIds: [...state.playerIds],
    players,
    started: state.started,
    startAt: state.startAt,
    gameOver: state.gameOver,
    winner: state.winner,
    currentPlayerId: state.currentPlayerId,
    phase: state.phase,
    diceValue: state.diceValue,
    rollSerial: state.rollSerial,
    consecutiveSixes: state.consecutiveSixes,
    phaseEndsAtMs: state.phaseEndsAtMs,
    turnEndsAtMs: state.turnEndsAtMs,
    lastMessage: state.lastMessage,
    lastAction: { ...state.lastAction },
  };
}

/**
 * Validate the closed wire shape before checking ownership or consuming randomness.
 * @param {unknown} payload
 * @returns {payload is LudoCommand}
 */
function isLudoCommand(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  const inputCommand = /** @type {Partial<LudoCommand>} */ (payload);
  const expectedKeys = inputCommand.type === "roll" ? ROLL_COMMAND_KEYS :
    inputCommand.type === "move" ? MOVE_COMMAND_KEYS : null;
  if (!expectedKeys || Object.keys(inputCommand).length !== expectedKeys.length ||
      !expectedKeys.every((key) => Object.hasOwn(inputCommand, key)) ||
      !Number.isSafeInteger(inputCommand.roundId) || !Number.isSafeInteger(inputCommand.revision)) {
    return false;
  }
  return inputCommand.type === "roll" || (Number.isInteger(inputCommand.tokenIndex) &&
    inputCommand.tokenIndex >= 0 && inputCommand.tokenIndex < LUDO_LIMITS.TOKENS_PER_PLAYER);
}

/**
 * Apply one current revision command. Rejected/stale commands cannot roll a die,
 * change the board, or consume a pending action. No continuous predictor is involved.
 * @param {LudoServerState} state
 * @param {LudoPlayerId} playerId Socket-owned identity supplied by the platform.
 * @param {unknown} payload
 * @param {{rollDie?:(context:{entryBoosted:boolean})=>number,nowMs?:number}} [options] Server-side test dependencies.
 * @returns {boolean}
 */
export function applyLudoServerInput(state, playerId, payload, { rollDie = rollLudoDie, nowMs = Date.now() } = {}) {
  if (!isLudoCommand(payload) || !state.started || state.gameOver ||
      !Object.hasOwn(state.players, playerId) || !state.players[playerId].connected ||
      !allPlayersConnected(state, state.playerIds) || state.currentPlayerId !== playerId ||
      payload.roundId !== state.roundId || payload.revision !== state.revision ||
      !Number.isFinite(nowMs) || nowMs >= state.turnEndsAtMs) {
    return false;
  }

  if (payload.type === "roll") {
    if (state.phase !== "roll") {
      return false;
    }
    const entryBoosted = isLudoEntryEligible(state.players[playerId]);
    return applyLudoRoll(state, playerId, rollDie({ entryBoosted }), nowMs);
  }
  if (state.phase !== "choose" || !getLegalLudoTokenIndices(state, playerId).includes(payload.tokenIndex)) {
    return false;
  }
  return applyLudoMove(state, playerId, payload.tokenIndex, nowMs);
}

/** @param {LudoServerState} state */
function clearLudoRematchRequests(state) {
  for (const playerId of state.playerIds) {
    state.rematchRequests[playerId] = false;
  }
}

/**
 * Freeze active phase/decision time once, retaining in-flight animation identity.
 * @param {LudoServerState} state
 * @param {number} nowMs
 */
function pauseLudoRoom(state, nowMs) {
  if (state.started && !state.gameOver && !state.pausedClock) {
    state.pausedClock = {
      pausedAtMs: nowMs,
      phaseRemainingMs: Math.max(0, state.phaseEndsAtMs - nowMs),
      turnRemainingMs: Math.max(0, state.turnEndsAtMs - nowMs),
    };
  }
  state.started = false;
  state.startAt = null;
  state.revision += 1;
  clearLudoRematchRequests(state);
}

/**
 * Restore retained phase time only after the shared five-second ready countdown.
 * @param {LudoServerState} state
 * @param {number} nowMs
 */
function resumeLudoRoom(state, nowMs) {
  const pausedClock = state.pausedClock;
  if (pausedClock) {
    const pauseDurationMs = Math.max(0, nowMs - pausedClock.pausedAtMs);
    const isDecisionPhase = state.phase === "roll" || state.phase === "choose";
    state.phaseEndsAtMs = isDecisionPhase ? 0 : nowMs + pausedClock.phaseRemainingMs;
    state.turnEndsAtMs = isDecisionPhase ? nowMs + pausedClock.turnRemainingMs : 0;
    if (state.lastAction.id > 0) {
      state.lastAction.startedAtMs += pauseDurationMs;
    }
  } else {
    state.phaseEndsAtMs = 0;
    state.turnEndsAtMs = nowMs + LUDO_LIMITS.TURN_TIMEOUT_MS;
    state.lastMessage = "Roll the die";
  }

  state.pausedClock = null;
  state.started = true;
  state.startAt = null;
  state.revision += 1;
}

/**
 * Compose testable game-owned callbacks without replacing platform room ownership,
 * countdown scheduling, transport, snapshot packing or voice signaling.
 * @param {LudoServerOptions & {playerIds?:readonly LudoPlayerId[]}} [options]
 * @returns {LudoServerController} Callbacks accepted by registerGame.
 */
export function createLudoServerController({ rollDie = rollLudoDie, nowFn = () => Date.now(), playerIds = LUDO_PLAYER_IDS } = {}) {
  /** @returns {LudoServerState} */
  function createState() {
    return createLudoServerState({ playerIds, nowMs: nowFn() });
  }

  /** @param {LudoServerState} state @param {LudoPlayerId} playerId */
  function onPlayerConnected(state, playerId) {
    if (!Object.hasOwn(state.players, playerId)) {
      return;
    }
    state.players[playerId].connected = true;
    state.abandonedAt = null;
    state.revision += 1;
    scheduleStart(state, ROOM_START_COUNTDOWN_MS, undefined, state.playerIds);
  }

  /** @param {LudoServerState} state @param {LudoPlayerId} playerId */
  function handleDisconnect(state, playerId) {
    if (!Object.hasOwn(state.players, playerId)) {
      return;
    }
    state.players[playerId].connected = false;
    const nowMs = nowFn();
    pauseLudoRoom(state, nowMs);
    state.abandonedAt = state.playerIds.every((ownerId) => !state.players[ownerId].connected) ? nowMs : null;
  }

  /** @param {LudoServerState} state */
  function beforeUpdate(state) {
    const nowMs = nowFn();
    state.lastUpdate = nowMs;
    scheduleStart(state, ROOM_START_COUNTDOWN_MS, undefined, state.playerIds);
    if (!allPlayersConnected(state, state.playerIds) || state.gameOver) {
      return;
    }
    if (!state.started && state.startAt !== null && nowMs >= state.startAt) {
      resumeLudoRoom(state, nowMs);
    }
    advanceLudoRound(state, nowMs);
  }

  /** @param {{state:LudoServerState,playerId:LudoPlayerId,payload:unknown}} context @returns {boolean} */
  function handleInput({ state, playerId, payload }) {
    return applyLudoServerInput(state, playerId, payload, { rollDie, nowMs: nowFn() });
  }

  /**
   * Start a new round only when every connected owner requests it. Socket seats,
   * reconnect tokens and platform voice membership stay in the existing room.
   * @param {{socket:import("socket.io").Socket,games:Map<string,LudoServerState>,nsp:import("socket.io").Namespace}} context
   */
  function handleRematch({ socket, games, nsp }) {
    const { gameId, playerId } = socket.data;
    const previousState = games.get(gameId);
    if (!gameId || !playerId || !previousState?.gameOver ||
        !Object.hasOwn(previousState.players, playerId) || !previousState.players[playerId].connected ||
        previousState.rematchRequests[playerId]) {
      return;
    }

    previousState.rematchRequests[playerId] = true;
    emitEvent({
      socket,
      gameId,
      type: SOCKET_EVENT.REMATCH_REQUESTED,
      payload: { playerId },
      target: "others",
    });
    const allReady = previousState.playerIds.every((ownerId) =>
      previousState.players[ownerId].connected && previousState.rematchRequests[ownerId]);
    if (!allReady) {
      return;
    }

    const nextState = createLudoServerState({
      playerIds: previousState.playerIds,
      roundId: previousState.roundId + 1,
      nowMs: nowFn(),
    });
    for (const ownerId of previousState.playerIds) {
      const previousPlayer = previousState.players[ownerId];
      const nextPlayer = nextState.players[ownerId];
      nextPlayer.connected = previousPlayer.connected;
      nextPlayer.seriesWins = previousPlayer.seriesWins;
      if (previousPlayer.rejoinToken) {
        nextPlayer.rejoinToken = previousPlayer.rejoinToken;
      }
    }
    scheduleStart(nextState, ROOM_START_COUNTDOWN_MS, undefined, nextState.playerIds);
    games.set(gameId, nextState);
    emitEvent({ nsp, gameId, type: SOCKET_EVENT.REMATCH_STARTED, target: "game" });
  }

  /** @param {LudoServerState} state @param {number} nowMs @returns {boolean} */
  function shouldCleanup(state, nowMs) {
    return state.abandonedAt !== null && nowMs - state.abandonedAt > ROOM_CLEANUP_DELAY_MS;
  }

  return {
    createState,
    onPlayerConnected,
    handleInput,
    handleDisconnect,
    handleRematch,
    beforeUpdate,
    shouldCleanup,
    serializeState: serializeLudoState,
  };
}

/**
 * Register authoritative discrete Ludo actions with the platform room/voice lifecycle.
 * @param {import("socket.io").Server} io
 * @param {LudoServerOptions} [options] Server-side deterministic test dependencies.
 * @returns {void}
 */
export function registerLudoGame(io, options = {}) {
  registerGame({
    io,
    meta: ludoGameMeta,
    ...createLudoServerController(options),
    tickMs: LUDO_LIMITS.SERVER_TICK_MS,
    dtFallback: LUDO_LIMITS.SERVER_TICK_MS / 1000,
  });
}
