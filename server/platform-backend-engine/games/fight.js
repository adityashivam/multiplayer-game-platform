import { ROOM_START_COUNTDOWN_MS } from "../../../public/platform/shared/roomLifecycle.js";
import { fightGameMeta } from "./metadata.js";
import { emitEvent, registerPluggableGame, scheduleStart } from "../core/index.js";
import { createAuthoritativeInputSession } from "../core/authoritativeInputSession.js";
import {
  FIGHT_COMBAT,
  FIGHT_ACTION_EDGE_KEYS,
  createFightPlayerState as createSharedFightPlayer,
  resolveFightExchange,
  FIGHT_FIXED_DT_SEC,
  FIGHT_INPUT_TEMPLATE,
  FIGHT_MOVEMENT,
  stepFightPlayer,
  resolveFightSeparation,
} from "../../../public/games/fight/shared/simulation.js";
import {
  INPUT_PROTOCOL,
  NETWORK_TIMING,
  SOCKET_EVENT,
} from "../../../public/platform/shared/networkProtocol.js";

/** @typedef {import("../../../public/games/fight/shared/simulation.js").FightInputState} FightInputState */
/** @typedef {import("../../../public/games/fight/shared/simulation.js").FightPlayerId} FightPlayerId */
/** @typedef {import("../../../public/games/fight/shared/simulation.js").FightPlayerState} FightPlayerState */
/** @typedef {import("../core/authoritativeInputSession.js").AuthoritativePlayerInputState<keyof FightInputState>} FightPlayerInputSession */

/**
 * Authoritative combat and connection fields extend the shared player simulation.
 * @typedef {FightPlayerState & FightPlayerInputSession & {
 *   health: number,
 *   input: FightInputState,
 *   inputEpoch: number,
 *   lastInputSeqAck: number,
 *   inputSimulationTick: number,
 *   connected: boolean,
 *   rejoinToken?: string
 * }} FightServerPlayerState
 */

/**
 * @typedef {object} FightGameState
 * @property {{p1: FightServerPlayerState, p2: FightServerPlayerState}} players
 * @property {number} timer
 * @property {Array<{id: number, kind: string, attackerId: FightPlayerId, defenderId: FightPlayerId, attackType: string, damage: number, x: number, y: number}>} combatEvents
 * @property {number} nextCombatEventId
 * @property {boolean} gameOver
 * @property {FightPlayerId | "tie" | null} winner
 * @property {{p1: boolean, p2: boolean}} rematchRequests
 * @property {number} lastUpdate
 * @property {boolean} started
 * @property {number | null} startAt
 * @property {number | null} [abandonedAt]
 */

/**
 * @typedef {object} FightSimulationContext
 * @property {FightGameState} state
 * @property {number} dt Simulation duration in seconds.
 * @property {number} nowMs Wall time for combat and match timing.
 */

const GAME_DURATION_SEC = FIGHT_COMBAT.ROUND_DURATION_SEC;
const COUNTDOWN_MS = ROOM_START_COUNTDOWN_MS;
const ROOM_CLEANUP_DELAY_MS = 30000;
const COMBAT_EVENT_LIMIT = 16;
// Fixed event slots preserve the packed snapshot schema as the history fills.
// ID zero denotes an unused slot and is ignored by presentation consumers.
const EMPTY_COMBAT_EVENT = Object.freeze({
  id: 0, kind: "hit", attackerId: "p1", defenderId: "p2", attackType: "light", damage: 0, x: 0, y: 0,
});
const FIGHT_PLAYER_SNAPSHOT_KEYS = Object.freeze(Object.keys(createSharedFightPlayer(0, 1)));

/** @type {ReadonlyArray<FightPlayerId>} */
const FIGHT_PLAYER_IDS = ["p1", "p2"];

const DEFAULT_INPUT_STATE = FIGHT_INPUT_TEMPLATE;
const fightInputSession = createAuthoritativeInputSession({
  inputTemplate: FIGHT_INPUT_TEMPLATE,
  edgeKeys: FIGHT_ACTION_EDGE_KEYS,
  fixedDtSec: FIGHT_FIXED_DT_SEC,
});

/**
 * @param {number} x
 * @param {1 | -1} dir
 * @returns {FightServerPlayerState}
 */
function createFightPlayerState(x, dir) {
  return {
    ...createSharedFightPlayer(x, dir),
    lastInputSeqAck: 0,
    inputEpoch: 0,
    inputSimulationTick: 0,
    connected: false,
    input: { ...DEFAULT_INPUT_STATE },
  };
}

/** @returns {FightGameState} */
function createInitialGameState() {
  return {
    players: {
      p1: createFightPlayerState(200, 1),
      p2: createFightPlayerState(1000, -1),
    },
    timer: GAME_DURATION_SEC,
    gameOver: false,
    winner: null,
    rematchRequests: { p1: false, p2: false },
    combatEvents: [],
    nextCombatEventId: 1,
    lastUpdate: Date.now(),
    started: false,
    startAt: null,
  };
}

/** @param {FightGameState} state */
function scheduleFightStart(state) {
  scheduleStart(state, COUNTDOWN_MS);
}

/** @param {FightServerPlayerState} playerState */
function serializeFightPlayerState(playerState) {
  const combatSnapshot = {};
  for (const field of FIGHT_PLAYER_SNAPSHOT_KEYS) combatSnapshot[field] = playerState[field];
  return { ...combatSnapshot, ...fightInputSession.getPlayerSnapshotMetadata(playerState) };
}

/** @param {FightGameState} state */
export function serializeFightState(state) {
  const combatEvents = Array.from({ length: COMBAT_EVENT_LIMIT }, (_, index) => state.combatEvents[index] || EMPTY_COMBAT_EVENT);
  return {
    players: {
      p1: serializeFightPlayerState(state.players.p1),
      p2: serializeFightPlayerState(state.players.p2),
    },
    inputProtocol: INPUT_PROTOCOL.QUEUED,
    combatEvents,
    maxHealth: FIGHT_COMBAT.MAX_HEALTH,
    durationSec: GAME_DURATION_SEC,
    timer: Math.ceil(state.timer),
    gameOver: state.gameOver,
    winner: state.winner,
    started: state.started,
    startAt: state.startAt,
    connected: {
      p1: state.players.p1.connected,
      p2: state.players.p2.connected,
    },
  };
}

/** @param {FightGameState} state */
function isFightActive(state) {
  return Boolean(state.started && !state.gameOver);
}

/**
 * @param {FightGameState} state
 * @param {number} nowMs
 */
function syncFightStartState(state, nowMs) {
  if (!state.started && state.startAt && nowMs >= state.startAt) {
    state.started = true;
    state.startAt = null;
  }
}

/** @param {FightSimulationContext} context */
function runFightPlayerIntentSystem({ state, dt }) {
  const facingPositions = {
    p1: { x: state.players.p1.x, y: state.players.p1.y },
    p2: { x: state.players.p2.x, y: state.players.p2.y },
  };
  fightInputSession.simulateRoom({
    state,
    dtSec: dt,
    simulate: (playerState, inputState, fixedDtSec, playerId) => {
      const opponent = facingPositions[playerId === "p1" ? "p2" : "p1"];
      stepFightPlayer(playerState, inputState, fixedDtSec, { active: isFightActive(state), opponent });
    },
  });
}

/** @param {FightSimulationContext} context */
function runFightCombatSystem({ state }) {
  if (!isFightActive(state)) {
    return;
  }

  const { p1, p2 } = state.players;
  resolveFightSeparation(p1, p2);
  const impacts = resolveFightExchange(p1, p2);
  for (const attackerId of FIGHT_PLAYER_IDS) {
    const impact = impacts[attackerId];
    if (!impact) continue;
    const defenderId = attackerId === "p1" ? "p2" : "p1";
    const defender = state.players[defenderId];
    state.combatEvents.push({
      id: state.nextCombatEventId++, ...impact, attackerId, defenderId, x: defender.x, y: defender.y,
    });
  }
  if (state.combatEvents.length > COMBAT_EVENT_LIMIT) state.combatEvents.splice(0, state.combatEvents.length - COMBAT_EVENT_LIMIT);
  if (p1.dead || p2.dead) {
    state.gameOver = true;
    state.winner = p1.dead && p2.dead ? "tie" : p1.dead ? "p2" : "p1";
  }
}

/** @param {FightSimulationContext} context */
function runFightTimerSystem({ state, dt }) {
  if (!isFightActive(state)) {
    return;
  }

  const { p1, p2 } = state.players;
  state.timer = Math.max(0, state.timer - dt);
  if (state.timer === 0 && !state.gameOver) {
    state.gameOver = true;
    if (p1.health > p2.health) {
      state.winner = "p1";
    } else if (p2.health > p1.health) {
      state.winner = "p2";
    } else {
      state.winner = "tie";
    }
  }
}

function createFightSimulationSystems() {
  return [
    {
      priority: -200,
      system: {
        name: "timestamp",
        update: ({ state, nowMs }) => {
          state.lastUpdate = nowMs;
        },
      },
    },
    {
      priority: -150,
      system: {
        name: "start-transition",
        update: ({ state, nowMs }) => {
          syncFightStartState(state, nowMs);
        },
      },
    },
    {
      priority: -100,
      system: { name: "player-intent", update: runFightPlayerIntentSystem },
    },
    {
      priority: 20,
      system: { name: "combat", update: runFightCombatSystem },
    },
    {
      priority: 40,
      system: { name: "timer", update: runFightTimerSystem },
    },
  ];
}

/**
 * @param {FightGameState} state
 * @param {FightPlayerId} playerId
 */
function connectFightPlayer(state, playerId) {
  const playerState = state.players[playerId];
  playerState.connected = true;
  fightInputSession.resetPlayer(playerState);
  state.abandonedAt = null;
  scheduleFightStart(state);
}

/**
 * Accept queued commands without allowing legacy input to overwrite that session.
 * @param {object} options
 * @param {FightGameState} options.state
 * @param {FightPlayerId} options.playerId
 * @param {import("../core/inputProtocol.js").InputPacket<keyof FightInputState>} options.payload
 */
function receiveFightPlayerInput({ state, playerId, payload }) {
  const playerState = state.players[playerId];
  if (!playerState || playerState.dead) {
    return;
  }

  fightInputSession.receiveInput(playerState, payload);
}

/**
 * @param {FightGameState} state
 * @param {FightPlayerId} playerId
 */
function disconnectFightPlayer(state, playerId) {
  const playerState = state.players[playerId];
  playerState.connected = false;
  fightInputSession.resetPlayer(playerState);

  const opponentId = playerId === "p1" ? "p2" : "p1";
  const bothDisconnected = !state.players[opponentId].connected;
  state.started = false;
  state.startAt = null;
  state.rematchRequests = { p1: false, p2: false };
  state.abandonedAt = bothDisconnected ? Date.now() : null;
}

/**
 * Replace a ready match while preserving connection ownership and advancing epochs.
 * @param {object} options
 * @param {import("socket.io").Socket} options.socket
 * @param {Map<string, FightGameState>} options.games
 * @param {import("socket.io").Namespace} options.nsp
 */
function requestFightRematch({ socket, games, nsp }) {
  const { gameId, playerId } = socket.data;
  if (!gameId || !playerId) {
    return;
  }
  const state = games.get(gameId);
  if (!state || !state.players?.[playerId]) {
    return;
  }

  if (!state.rematchRequests) {
    state.rematchRequests = { p1: false, p2: false };
  }
  state.rematchRequests[playerId] = true;
  emitEvent({
    socket,
    gameId,
    type: SOCKET_EVENT.REMATCH_REQUESTED,
    payload: { playerId },
    target: "others",
  });

  const bothReady =
    state.players.p1.connected &&
    state.players.p2.connected &&
    state.rematchRequests.p1 &&
    state.rematchRequests.p2;
  if (!bothReady) {
    return;
  }

  const nextState = createInitialGameState();
  for (const playerId of FIGHT_PLAYER_IDS) {
    nextState.players[playerId].inputEpoch = state.players[playerId].inputEpoch;
    fightInputSession.resetPlayer(nextState.players[playerId]);
  }
  nextState.players.p1.rejoinToken = state.players.p1.rejoinToken;
  nextState.players.p2.rejoinToken = state.players.p2.rejoinToken;
  nextState.players.p1.connected = state.players.p1.connected;
  nextState.players.p2.connected = state.players.p2.connected;
  games.set(gameId, nextState);
  emitEvent({ nsp, gameId, type: SOCKET_EVENT.REMATCH_STARTED, target: "game" });
}

/**
 * Register authoritative Fight simulation, command handling, and room lifecycle.
 * @param {import("socket.io").Server} io
 * @returns {ReturnType<typeof registerPluggableGame>}
 */
export function registerFightGame(io) {
  return registerPluggableGame({
    io,
    meta: fightGameMeta,
    createState: createInitialGameState,
    systems: createFightSimulationSystems(),
    shouldStep: ({ state }) => !state.gameOver,
    onPlayerConnected: connectFightPlayer,
    handleInput: receiveFightPlayerInput,
    handleDisconnect: disconnectFightPlayer,
    handleRematch: requestFightRematch,
    beforeUpdate: scheduleFightStart,
    shouldCleanup: (state, now) => {
      if (!state.abandonedAt) {
        return false;
      }
      return now - state.abandonedAt > ROOM_CLEANUP_DELAY_MS;
    },
    serializeState: serializeFightState,
    dtFallback: FIGHT_FIXED_DT_SEC,
    tickMs: 1000 / NETWORK_TIMING.SIMULATION_HZ,
  });
}
