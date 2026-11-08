import { ROOM_START_COUNTDOWN_MS } from "../../../public/platform/shared/roomLifecycle.js";
import { marioGameMeta, marioTouchGameMeta } from "./metadata.js";
import { emitEvent, registerPluggableGame, scheduleStart } from "../core/index.js";
import { createAuthoritativeInputSession } from "../core/authoritativeInputSession.js";
import { INPUT_PROTOCOL, SOCKET_EVENT } from "../../../public/platform/shared/networkProtocol.js";
import {
  MARIO_EDGE_KEYS,
  MARIO_FIXED_DT_SEC,
  MARIO_INPUT_TEMPLATE,
  MARIO_MOVEMENT_SETTINGS,
  MARIO_PLAYER_IDS,
  MARIO_START_POSITIONS,
  MARIO_TRACK,
} from "../../../public/games/mario/shared/config.js";
import {
  marioRectanglesIntersect,
  resolveMarioHorizontalMovement,
  resolveMarioVerticalMovement,
  stepMarioPlayer,
} from "../../../public/games/mario/shared/simulation.js";

/** @typedef {import("../../../public/games/mario/shared/config.js").MarioPlayerId} MarioPlayerId */
/** @typedef {import("../../../public/games/mario/shared/config.js").MarioInputState} MarioInputState */
/**
 * @typedef {import("../../../public/games/mario/shared/simulation.js").MarioMovementState &
 *   import("../core/authoritativeInputSession.js").AuthoritativePlayerInputState<keyof MarioInputState> & {
 *   connected: boolean, finished: boolean, finishMs: number|null, rank: number,
 *   hurtCooldown: number, rejoinToken: string|null, movementEpoch: number
 * }} MarioServerPlayerState
 */

const COUNTDOWN_MS = ROOM_START_COUNTDOWN_MS;
const ROOM_CLEANUP_DELAY_MS = 30000;
const TRACK = MARIO_TRACK;
const START_POSITIONS = MARIO_START_POSITIONS;
const { PLAYER_WIDTH: PLAYER_W, PLAYER_HEIGHT: PLAYER_H, JUMP_SPEED } = MARIO_MOVEMENT_SETTINGS;
const marioInputSession = createAuthoritativeInputSession({
  inputTemplate: MARIO_INPUT_TEMPLATE,
  edgeKeys: MARIO_EDGE_KEYS,
  fixedDtSec: MARIO_FIXED_DT_SEC,
});

const HURT_COOLDOWN_SEC = 0.85;

const ENEMY_GRAVITY = 1150;
const ENEMY_MAX_FALL_SPEED = 760;
const GOOMBA_SPEED = 58;
const KOOPA_SPEED = 52;
const GOOMBA_STOMP_MS = 320;
const KOOPA_STOMP_MS = 850;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/** @param {{x: number, y: number}} startPos @returns {MarioServerPlayerState} */
function makePlayer(startPos) {
  return {
    x: startPos.x,
    y: startPos.y,
    vx: 0,
    vy: 0,
    width: PLAYER_W,
    height: PLAYER_H,
    onGround: true,
    facing: 1,
    connected: false,
    finished: false,
    finishMs: null,
    rank: 2,
    hurtCooldown: 0,
    rejoinToken: null,
    input: { ...MARIO_INPUT_TEMPLATE },
    inputEpoch: 0,
    inputSimulationTick: 0,
    lastInputSeqAck: 0,
    jumpHeld: false,
    movementEpoch: 0,
  };
}

function enemyBaseSpeed(type) {
  return type === "koopa" ? KOOPA_SPEED : GOOMBA_SPEED;
}

function makeEnemy(spawn, index) {
  const type = spawn.type === "koopa" ? "koopa" : "goomba";
  const speed = enemyBaseSpeed(type);
  const height = type === "koopa" ? 32 : 16;
  return {
    id: `e${index}`,
    type,
    x: spawn.x,
    y: spawn.y,
    spawnX: spawn.x,
    spawnY: spawn.y,
    vx: -speed,
    vy: 0,
    width: 16,
    height,
    facing: -1,
    alive: true,
    stomped: false,
    stompUntilMs: 0,
  };
}

function createInitialGameState() {
  return {
    track: {
      worldWidth: TRACK.worldWidth,
      groundY: TRACK.groundY,
      finishX: TRACK.finishX,
      background: TRACK.background,
    },
    players: {
      p1: makePlayer(START_POSITIONS.p1),
      p2: makePlayer(START_POSITIONS.p2),
    },
    enemies: TRACK.enemySpawns.map((spawn, index) => makeEnemy(spawn, index)),
    started: false,
    startAt: null,
    gameOver: false,
    winner: null,
    rematchRequests: { p1: false, p2: false },
    lastUpdate: Date.now(),
    abandonedAt: null,
  };
}

function scheduleMarioStart(state) {
  scheduleStart(state, COUNTDOWN_MS);
}

function syncStartState(state, nowMs) {
  if (!state.started && state.startAt && nowMs >= state.startAt) {
    state.started = true;
    state.startAt = null;
  }
}

function isRaceActive(state) {
  return Boolean(state.started && !state.gameOver);
}

function runStartTransitionSystem({ state, nowMs }) {
  state.lastUpdate = nowMs;
  syncStartState(state, nowMs);
}

/** Respawn changes visual continuity, while retained commands keep their ownership. */
function respawnMarioPlayer(playerState, playerId) {
  playerState.x = Math.max(START_POSITIONS[playerId].x, playerState.x - 96);
  playerState.y = START_POSITIONS[playerId].y;
  playerState.vx = 0;
  playerState.vy = 0;
  playerState.onGround = true;
  playerState.movementEpoch += 1;
}

function runPlayerSystem({ state, dt }) {
  const raceActive = isRaceActive(state);
  for (const playerState of Object.values(state.players)) {
    if (playerState.hurtCooldown > 0) {
      playerState.hurtCooldown = Math.max(0, playerState.hurtCooldown - dt);
    }
  }
  marioInputSession.simulateRoom({
    state,
    dtSec: dt,
    simulate: (playerState, inputState, fixedDtSec, playerId) => {
      const active = raceActive && playerState.connected && !playerState.finished;
      stepMarioPlayer(playerState, inputState, fixedDtSec, { active });
      if (!active) return;
      if (playerState.y > TRACK.groundY + 260) respawnMarioPlayer(playerState, playerId);
      if (!playerState.finished && playerState.x + playerState.width >= TRACK.finishX) {
        playerState.finished = true;
        playerState.finishMs = Date.now();
        playerState.vx = 0;
        playerState.vy = 0;
      }
    },
  });
}

function runEnemySystem({ state, dt, nowMs }) {
  if (!isRaceActive(state)) return;

  const solids = TRACK.solids;
  const worldWidth = TRACK.worldWidth;
  const groundY = TRACK.groundY;

  for (let i = 0; i < state.enemies.length; i += 1) {
    const enemy = state.enemies[i];
    if (!enemy || !enemy.alive) continue;

    if (enemy.stomped) {
      if (nowMs >= enemy.stompUntilMs) {
        enemy.alive = false;
      }
      continue;
    }

    enemy.vy = clamp(enemy.vy + ENEMY_GRAVITY * dt, -ENEMY_MAX_FALL_SPEED, ENEMY_MAX_FALL_SPEED);

    const prevVx = enemy.vx;
    const hitWall = resolveMarioHorizontalMovement(enemy, solids, dt);
    if (hitWall || enemy.vx === 0) {
      const speed = enemyBaseSpeed(enemy.type);
      const nextDir = prevVx <= 0 ? 1 : -1;
      enemy.vx = nextDir * speed;
    }

    enemy.facing = enemy.vx >= 0 ? 1 : -1;

    resolveMarioVerticalMovement(enemy, solids, dt);

    if (enemy.x <= 0 || enemy.x + enemy.width >= worldWidth) {
      const speed = enemyBaseSpeed(enemy.type);
      const dir = enemy.x <= 0 ? 1 : -1;
      enemy.vx = dir * speed;
      enemy.facing = dir;
    }

    enemy.x = clamp(enemy.x, 0, worldWidth - enemy.width);

    if (enemy.y > groundY + 260) {
      enemy.alive = false;
    }
  }
}

function runEnemyCollisionSystem({ state, nowMs }) {
  if (!isRaceActive(state)) return;

  const players = state.players;
  for (const playerId of MARIO_PLAYER_IDS) {
    const player = players[playerId];
    if (!player || !player.connected || player.finished) continue;

    const playerRect = {
      x: player.x,
      y: player.y,
      w: player.width,
      h: player.height,
    };

    for (let i = 0; i < state.enemies.length; i += 1) {
      const enemy = state.enemies[i];
      if (!enemy || !enemy.alive || enemy.stomped) continue;

      const enemyRect = {
        x: enemy.x,
        y: enemy.y,
        w: enemy.width,
        h: enemy.height,
      };

      if (!marioRectanglesIntersect(playerRect, enemyRect)) continue;

      const playerBottom = player.y + player.height;
      const stomped =
        player.vy > 40 &&
        player.y < enemy.y &&
        playerBottom - enemy.y <= Math.min(12, enemy.height * 0.7);

      if (stomped) {
        enemy.stomped = true;
        enemy.stompUntilMs = nowMs + (enemy.type === "koopa" ? KOOPA_STOMP_MS : GOOMBA_STOMP_MS);
        enemy.vx = 0;
        enemy.vy = 0;

        if (enemy.type === "koopa" && enemy.height > 16) {
          enemy.y += enemy.height - 16;
          enemy.height = 16;
        }

        player.vy = -JUMP_SPEED * 0.52;
        player.onGround = false;
        break;
      }

      if (player.hurtCooldown > 0) {
        continue;
      }

      player.hurtCooldown = HURT_COOLDOWN_SEC;
      respawnMarioPlayer(player, playerId);
      break;
    }
  }
}

function raceProgress(player) {
  if (!player) return 0;
  if (player.finished) return Number.MAX_SAFE_INTEGER;
  return player.x;
}

function updateRanks(state) {
  const standings = [
    { id: "p1", player: state.players.p1 },
    { id: "p2", player: state.players.p2 },
  ];

  standings.sort((a, b) => {
    if (a.player.finished && b.player.finished) {
      return (a.player.finishMs || Infinity) - (b.player.finishMs || Infinity);
    }
    if (a.player.finished && !b.player.finished) return -1;
    if (!a.player.finished && b.player.finished) return 1;
    return raceProgress(b.player) - raceProgress(a.player);
  });

  standings.forEach((entry, index) => {
    entry.player.rank = index + 1;
  });
}

function decideWinner(state) {
  if (state.gameOver) return;

  const { p1, p2 } = state.players;
  if (!p1.finished && !p2.finished) return;

  state.gameOver = true;
  if (p1.finished && p2.finished) {
    if ((p1.finishMs || Infinity) < (p2.finishMs || Infinity)) state.winner = "p1";
    else if ((p2.finishMs || Infinity) < (p1.finishMs || Infinity)) state.winner = "p2";
    else state.winner = "tie";
  } else {
    state.winner = p1.finished ? "p1" : "p2";
  }
}

function runRaceRulesSystem({ state }) {
  if (state.gameOver) return;
  updateRanks(state);
  decideWinner(state);
}

function sanitizePlayer(player) {
  return {
    x: player.x,
    y: player.y,
    vx: player.vx,
    vy: player.vy,
    onGround: player.onGround,
    facing: player.facing,
    connected: player.connected,
    finished: player.finished,
    rank: player.rank,
    hurtCooldown: player.hurtCooldown,
    width: player.width,
    height: player.height,
    jumpHeld: player.jumpHeld,
    movementEpoch: player.movementEpoch,
    ...marioInputSession.getPlayerSnapshotMetadata(player),
  };
}

function sanitizeEnemy(enemy) {
  return {
    id: enemy.id,
    type: enemy.type,
    x: enemy.x,
    y: enemy.y,
    vx: enemy.vx,
    vy: enemy.vy,
    width: enemy.width,
    height: enemy.height,
    facing: enemy.facing,
    alive: enemy.alive,
    stomped: enemy.stomped,
  };
}

export function serializeMarioState(state) {
  return {
    inputProtocol: INPUT_PROTOCOL.QUEUED,
    track: state.track,
    players: {
      p1: sanitizePlayer(state.players.p1),
      p2: sanitizePlayer(state.players.p2),
    },
    enemies: state.enemies.map(sanitizeEnemy),
    started: state.started,
    startAt: state.startAt,
    gameOver: state.gameOver,
    winner: state.winner,
  };
}

function createMarioSystems() {
  return [
    { priority: -200, system: { name: "start-transition", update: runStartTransitionSystem } },
    { priority: -120, system: { name: "players", update: runPlayerSystem } },
    { priority: -70, system: { name: "enemies", update: runEnemySystem } },
    { priority: -40, system: { name: "enemy-collision", update: runEnemyCollisionSystem } },
    { priority: 10, system: { name: "race-rules", update: runRaceRulesSystem } },
  ];
}

function resetRaceStateInPlace(state, { keepConnections = true } = {}) {
  const nextState = createInitialGameState();
  if (keepConnections) {
    for (const playerId of MARIO_PLAYER_IDS) {
      const previousPlayer = state.players[playerId];
      const nextPlayer = nextState.players[playerId];
      nextPlayer.connected = Boolean(previousPlayer.connected);
      nextPlayer.rejoinToken = previousPlayer.rejoinToken || null;
      nextPlayer.inputEpoch = previousPlayer.inputEpoch;
      nextPlayer.movementEpoch = previousPlayer.movementEpoch + 1;
      marioInputSession.resetPlayer(nextPlayer);
    }
  }

  state.track = nextState.track;
  state.players = nextState.players;
  state.enemies = nextState.enemies;
  state.started = nextState.started;
  state.startAt = nextState.startAt;
  state.gameOver = nextState.gameOver;
  state.winner = nextState.winner;
  state.rematchRequests = nextState.rematchRequests;
  state.lastUpdate = nextState.lastUpdate;
}

function registerMarioWithMeta(io, meta) {
  return registerPluggableGame({
    io,
    meta,
    createState: createInitialGameState,
    systems: createMarioSystems(),
    onPlayerConnected: (state, playerId) => {
      state.players[playerId].connected = true;
      marioInputSession.resetPlayer(state.players[playerId]);
      state.players[playerId].jumpHeld = false;
      state.abandonedAt = null;
      if (state.gameOver) {
        resetRaceStateInPlace(state, { keepConnections: true });
      }
      scheduleMarioStart(state);
    },
    handleInput: ({ state, playerId, payload }) => {
      marioInputSession.receiveInput(state.players[playerId], payload);
    },
    handleDisconnect: (state, playerId) => {
      state.players[playerId].connected = false;
      for (const playerState of Object.values(state.players)) {
        marioInputSession.resetPlayer(playerState);
        playerState.jumpHeld = false;
        playerState.vx = 0;
        playerState.vy = 0;
      }
      const otherPlayerId = playerId === "p1" ? "p2" : "p1";
      const bothDisconnected = !state.players[otherPlayerId].connected;

      state.started = false;
      state.startAt = null;
      state.rematchRequests = { p1: false, p2: false };
      state.abandonedAt = bothDisconnected ? Date.now() : null;
    },
    handleRematch: ({ socket, games, nsp }) => {
      const { gameId, playerId } = socket.data;
      if (!gameId || !playerId) return;
      const state = games.get(gameId);
      if (!state || !state.players?.[playerId]) return;

      if (!state.rematchRequests) {
        state.rematchRequests = { p1: false, p2: false };
      }
      state.rematchRequests[playerId] = true;
      emitEvent({ socket, gameId, type: SOCKET_EVENT.REMATCH_REQUESTED, payload: { playerId }, target: "others" });

      const bothReady =
        state.players.p1.connected &&
        state.players.p2.connected &&
        state.rematchRequests.p1 &&
        state.rematchRequests.p2;
      if (!bothReady) return;

      const nextState = createInitialGameState();
      for (const playerId of MARIO_PLAYER_IDS) {
        const previousPlayer = state.players[playerId];
        const nextPlayer = nextState.players[playerId];
        nextPlayer.connected = previousPlayer.connected;
        nextPlayer.rejoinToken = previousPlayer.rejoinToken || null;
        nextPlayer.inputEpoch = previousPlayer.inputEpoch;
        nextPlayer.movementEpoch = previousPlayer.movementEpoch + 1;
        marioInputSession.resetPlayer(nextPlayer);
      }
      games.set(gameId, nextState);
      emitEvent({ nsp, gameId, type: SOCKET_EVENT.REMATCH_STARTED, target: "game" });
    },
    beforeUpdate: scheduleMarioStart,
    shouldCleanup: (state, now) => {
      if (!state.abandonedAt) return false;
      return now - state.abandonedAt > ROOM_CLEANUP_DELAY_MS;
    },
    serializeState: serializeMarioState,
    dtFallback: MARIO_FIXED_DT_SEC,
    tickMs: MARIO_FIXED_DT_SEC * 1000,
  });
}

export function registerMarioGame(io) {
  return registerMarioWithMeta(io, marioGameMeta);
}

export function registerMarioTouchGame(io) {
  return registerMarioWithMeta(io, marioTouchGameMeta);
}
