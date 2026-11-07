import { fightGameMeta } from "./metadata.js";
import { emitEvent, registerPluggableGame, scheduleStart } from "../core/index.js";
import { createAuthoritativeInputSession } from "../core/authoritativeInputSession.js";
import {
  FIGHT_ATTACK_DEFINITIONS,
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
 *   lastHitTime: number,
 *   lastAttackHitTime?: number,
 *   connected: boolean,
 *   rejoinToken?: string
 * }} FightServerPlayerState
 */

/**
 * @typedef {object} FightGameState
 * @property {{p1: FightServerPlayerState, p2: FightServerPlayerState}} players
 * @property {number} timer
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

const GAME_DURATION_SEC = 300;
const COUNTDOWN_MS = 3000;
const ROOM_CLEANUP_DELAY_MS = 30000;
const MAX_HEALTH = 500;
const REGEN_DELAY_SEC = 0.5;
const HEALTH_REGEN_PER_SEC = 25;

/** @type {ReadonlyArray<FightPlayerId>} */
const FIGHT_PLAYER_IDS = ["p1", "p2"];
/** @type {ReadonlyArray<keyof FightInputState>} */
const FIGHT_ACTION_EDGE_KEYS = ["jump", "attack", "heavyAttack", "aerialAttack"];

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
    x,
    y: FIGHT_MOVEMENT.GROUND_Y - 42,
    vx: 0,
    vy: 0,
    dir,
    health: MAX_HEALTH,
    attacking: false,
    attackType: null,
    attackTimer: 0,
    cooldownTimer: 0,
    lastInputSeqAck: 0,
    inputEpoch: 0,
    inputSimulationTick: 0,
    lastHitTime: 0,
    dead: false,
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
    lastUpdate: Date.now(),
    started: false,
    startAt: null,
  };
}

/** @param {FightGameState} state */
function initializeFightAttackTimestamps(state) {
  state.players.p1.lastAttackHitTime = 0;
  state.players.p2.lastAttackHitTime = 0;
}

/** @param {FightGameState} state */
function scheduleFightStart(state) {
  scheduleStart(state, COUNTDOWN_MS, (gameState) => {
    gameState.timer = GAME_DURATION_SEC;
  });
}

/** @param {FightServerPlayerState} playerState */
function serializeFightPlayerState(playerState) {
  return {
    x: playerState.x,
    y: playerState.y,
    vx: playerState.vx,
    vy: playerState.vy,
    dir: playerState.dir,
    health: playerState.health,
    attacking: playerState.attacking,
    attackType: playerState.attackType,
    attackTimer: playerState.attackTimer,
    cooldownTimer: playerState.cooldownTimer,
    hasHitThisSwing: Boolean(playerState.hasHitThisSwing),
    ...fightInputSession.getPlayerSnapshotMetadata(playerState),
    dead: playerState.dead,
  };
}

/** @param {FightGameState} state */
function serializeFightState(state) {
  return {
    players: {
      p1: serializeFightPlayerState(state.players.p1),
      p2: serializeFightPlayerState(state.players.p2),
    },
    inputProtocol: INPUT_PROTOCOL.QUEUED,
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

/**
 * Resolve a swing's authoritative damage at most once, mutating both players.
 * @param {FightServerPlayerState} attacker
 * @param {FightServerPlayerState} defender
 * @param {FightGameState} state
 * @param {FightPlayerId} attackerId
 * @param {number} nowSec
 */
function resolveAttack(attacker, defender, state, attackerId, nowSec) {
  if (!attacker.attacking || attacker.hasHitThisSwing || attacker.dead || defender.dead) {
    return;
  }
  const attackDefinition = FIGHT_ATTACK_DEFINITIONS[attacker.attackType];
  if (!attackDefinition) {
    return;
  }

  const horizontalDistance = Math.abs(attacker.x - defender.x);
  if (horizontalDistance >= attackDefinition.range) {
    return;
  }

  attacker.hasHitThisSwing = true;
  defender.health = Math.max(0, defender.health - attackDefinition.damage);
  defender.lastHitTime = nowSec;
  if (defender.health === 0) {
    defender.dead = true;
    state.gameOver = true;
    state.winner = attackerId;
  }
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
function runFightPlayerIntentSystem({ state, dt, nowMs }) {
  fightInputSession.simulateRoom({
    state,
    dtSec: dt,
    simulate: (playerState, inputState, fixedDtSec, playerId) => {
      stepFightPlayer(playerState, inputState, fixedDtSec, { active: isFightActive(state) });
      if (isFightActive(state)) {
        const opponentState = state.players[playerId === "p1" ? "p2" : "p1"];
        resolveFightSeparation(state.players.p1, state.players.p2);
        resolveAttack(playerState, opponentState, state, playerId, nowMs / 1000);
      }
    },
  });
}

/** @param {FightSimulationContext} context */
function runFightCombatSystem({ state, nowMs }) {
  if (!isFightActive(state)) {
    return;
  }

  const nowSec = nowMs / 1000;
  const { p1, p2 } = state.players;
  resolveAttack(p1, p2, state, "p1", nowSec);
  resolveAttack(p2, p1, state, "p2", nowSec);
}

/** @param {FightSimulationContext} context */
function runFightRegenSystem({ state, dt, nowMs }) {
  if (!isFightActive(state)) {
    return;
  }

  const nowSec = nowMs / 1000;
  for (const playerState of [state.players.p1, state.players.p2]) {
    if (!playerState.dead && playerState.health < MAX_HEALTH) {
      const timeSinceHitSec = nowSec - (playerState.lastHitTime || 0);
      if (timeSinceHitSec >= REGEN_DELAY_SEC) {
        playerState.health = Math.min(MAX_HEALTH, playerState.health + HEALTH_REGEN_PER_SEC * dt);
      }
    }
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
      priority: 30,
      system: { name: "regeneration", update: runFightRegenSystem },
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
  if (bothDisconnected) {
    state.started = false;
    state.startAt = null;
    state.timer = GAME_DURATION_SEC;
    state.gameOver = false;
    state.winner = null;
    state.rematchRequests = { p1: false, p2: false };
    state.abandonedAt = Date.now();
  } else {
    // Pause the game while waiting for reconnect.
    state.started = false;
    state.startAt = null;
    state.rematchRequests = { p1: false, p2: false };
    state.abandonedAt = null;
  }
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
  initializeFightAttackTimestamps(nextState);
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
    onStateCreated: initializeFightAttackTimestamps,
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
