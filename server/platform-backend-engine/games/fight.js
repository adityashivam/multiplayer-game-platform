import { fightGameMeta } from "./metadata.js";
import { emitEvent, registerPluggableGame, scheduleStart } from "../core/index.js";
import {
  applySequencedInput,
  ensurePlayerInputState,
  enqueueInputFrame,
  consumeInputFrames,
  resetInputBuffer,
} from "../core/inputProtocol.js";
import {
  FIGHT_ATTACK_DEFINITIONS,
  FIGHT_FIXED_DT_SEC,
  FIGHT_INPUT_TEMPLATE,
  FIGHT_MOVEMENT,
  stepFightPlayer,
  resolveFightSeparation,
} from "../../../public/platform/shared/fightSimulation.js";
import {
  INPUT_LIMITS,
  INPUT_MESSAGE_TYPE,
  INPUT_PROTOCOL,
  NETWORK_TIMING,
  SOCKET_EVENT,
} from "../../../public/platform/shared/networkProtocol.js";

/** @typedef {import("../../../public/platform/shared/fightSimulation.js").FightInputState} FightInputState */
/** @typedef {import("../../../public/platform/shared/fightSimulation.js").FightPlayerId} FightPlayerId */
/** @typedef {import("../../../public/platform/shared/fightSimulation.js").FightPlayerState} FightPlayerState */
/** @typedef {import("../core/inputProtocol.js").PlayerInputState<keyof FightInputState>} FightPlayerInputSession */

/**
 * Authoritative combat and connection fields extend the shared player simulation.
 * @typedef {FightPlayerState & FightPlayerInputSession & {
 *   health: number,
 *   input: FightInputState,
 *   inputEpoch: number,
 *   lastInputSeqAck: number,
 *   inputSimulationTick: number,
 *   inputProtocol?: 1 | 2 | null,
 *   lastHitTime: number,
 *   lastAttackHitTime?: number,
 *   connected: boolean,
 *   rejoinToken?: string,
 *   __lastInputReceiptMs?: number | null,
 *   __inputLoopTick?: number,
 *   __inputStepsThisTick?: number
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
 * @property {{droppedSteps: number}} [__roomClock]
 * @property {number} [__fightDroppedSteps]
 * @property {number} [__loopTick]
 * @property {number} [__loopMonotonicNow]
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
    inputSeqAck: playerState.lastInputSeqAck || 0,
    inputEpoch: playerState.inputEpoch,
    inputSimulationTick: playerState.inputSimulationTick,
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

/**
 * Reset command ownership for a new session while retaining its receipt timestamp.
 * Starvation/drop resynchronization clears that timestamp at the call site.
 * @param {FightServerPlayerState} playerState
 */
function resetFightPlayerInputSession(playerState) {
  resetInputBuffer(playerState);
  playerState.inputEpoch += 1;
  playerState.inputProtocol = null;
}

/**
 * @param {FightServerPlayerState} playerState
 * @param {number} monotonicNowMs
 * @returns {boolean}
 */
function hasFightInputStarved(playerState, monotonicNowMs) {
  return playerState.inputProtocol === INPUT_PROTOCOL.QUEUED &&
    Number.isFinite(playerState.__lastInputReceiptMs) &&
    monotonicNowMs - playerState.__lastInputReceiptMs > NETWORK_TIMING.INPUT_STARVATION_MS;
}

/**
 * Share a bounded command budget across catch-up steps in one room-loop invocation.
 * @param {FightGameState} state
 * @param {FightServerPlayerState} playerState
 * @param {number} dtSec
 * @param {import("../core/inputProtocol.js").InputSimulation<keyof FightInputState>} simulatePlayerInput
 */
function consumeFightPlayerQueuedInput(state, playerState, dtSec, simulatePlayerInput) {
  if (playerState.__inputLoopTick !== state.__loopTick) {
    playerState.__inputLoopTick = state.__loopTick;
    playerState.__inputStepsThisTick = 0;
  }
  playerState.__inputStepsThisTick += consumeInputFrames({
    player: playerState,
    dtSec,
    simulate: simulatePlayerInput,
    maxSteps: INPUT_LIMITS.MAX_FRAMES_PER_TICK - playerState.__inputStepsThisTick,
    continuous: true,
    edgeKeys: FIGHT_ACTION_EDGE_KEYS,
  });
}

/** @param {FightSimulationContext} context */
function runFightPlayerIntentSystem({ state, dt, nowMs }) {
  const droppedStepCount = state.__roomClock?.droppedSteps || 0;
  const didDropSteps = droppedStepCount > (state.__fightDroppedSteps || 0);
  state.__fightDroppedSteps = droppedStepCount;

  for (const playerId of FIGHT_PLAYER_IDS) {
    const playerState = state.players[playerId];
    const opponentState = state.players[playerId === "p1" ? "p2" : "p1"];
    const inputStarved = hasFightInputStarved(playerState, state.__loopMonotonicNow);
    if (playerState.inputProtocol === INPUT_PROTOCOL.QUEUED && (didDropSteps || inputStarved)) {
      resetFightPlayerInputSession(playerState);
      playerState.__lastInputReceiptMs = null;
    }

    const simulatePlayerInput = (inputState, fixedDtSec) => {
      stepFightPlayer(playerState, inputState, fixedDtSec, { active: isFightActive(state) });
      if (isFightActive(state)) {
        resolveFightSeparation(state.players.p1, state.players.p2);
        resolveAttack(playerState, opponentState, state, playerId, nowMs / 1000);
      }
    };

    if (playerState.inputProtocol === INPUT_PROTOCOL.QUEUED) {
      consumeFightPlayerQueuedInput(state, playerState, dt, simulatePlayerInput);
    } else {
      // Build bounded credit before a protocol-2 client sends its first frame.
      consumeInputFrames({ player: playerState, dtSec: dt, simulate: () => {} });
      simulatePlayerInput(playerState.input, dt);
    }
  }
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
  resetFightPlayerInputSession(playerState);
  ensurePlayerInputState(playerState, DEFAULT_INPUT_STATE);
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

  if (payload?.type === INPUT_MESSAGE_TYPE.FRAME && payload?.protocol === INPUT_PROTOCOL.QUEUED) {
    if (enqueueInputFrame({ player: playerState, payload, inputTemplate: DEFAULT_INPUT_STATE })) {
      playerState.inputProtocol = INPUT_PROTOCOL.QUEUED;
      playerState.__lastInputReceiptMs = performance.now();
    }
    return;
  }
  if (playerState.inputProtocol === INPUT_PROTOCOL.QUEUED) {
    return;
  }

  applySequencedInput({
    player: playerState,
    payload,
    inputTemplate: DEFAULT_INPUT_STATE,
  });
}

/**
 * @param {FightGameState} state
 * @param {FightPlayerId} playerId
 */
function disconnectFightPlayer(state, playerId) {
  const playerState = state.players[playerId];
  playerState.connected = false;
  resetFightPlayerInputSession(playerState);

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
  nextState.players.p1.inputEpoch = state.players.p1.inputEpoch + 1;
  nextState.players.p2.inputEpoch = state.players.p2.inputEpoch + 1;
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
