import { marioGameMeta } from "./metadata.js";
import { emitEvent, registerPluggableGame, scheduleStart } from "../utils/utils.js";
import { buildOneOneTrack } from "../../public/games/mario/levelData.js";

const FPS = 60;
const DT = 1 / FPS;
const COUNTDOWN_MS = 3000;
const ROOM_CLEANUP_DELAY_MS = 30000;

const TRACK = buildOneOneTrack();

const PLAYER_W = 16;
const PLAYER_H = 16;
const WALK_ACCEL = 920;
const RUN_ACCEL = 1320;
const AIR_ACCEL = 720;
const GROUND_FRICTION = 1080;
const AIR_DRAG = 180;
const MAX_WALK_SPEED = 125;
const MAX_RUN_SPEED = 175;
const JUMP_SPEED = 460;
const GRAVITY = 1450;
const MAX_FALL_SPEED = 760;
const HURT_COOLDOWN_SEC = 0.85;

const ENEMY_GRAVITY = 1150;
const ENEMY_MAX_FALL_SPEED = 760;
const GOOMBA_SPEED = 58;
const KOOPA_SPEED = 52;
const GOOMBA_STOMP_MS = 320;
const KOOPA_STOMP_MS = 850;

const START_POSITIONS = {
  p1: { x: TRACK.playerSpawn.x, y: TRACK.playerSpawn.y },
  p2: { x: TRACK.playerSpawn.x + 24, y: TRACK.playerSpawn.y },
};

const DEFAULT_INPUT_STATE = {
  left: false,
  right: false,
  run: false,
  jump: false,
  jumpQueued: false,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function approach(value, target, step) {
  if (value < target) return Math.min(target, value + step);
  if (value > target) return Math.max(target, value - step);
  return target;
}

function intersects(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

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
    input: { ...DEFAULT_INPUT_STATE },
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

function resolveHorizontalMovement(entity, solids, dt) {
  let nextX = entity.x + entity.vx * dt;
  const rect = { x: nextX, y: entity.y, w: entity.width, h: entity.height };
  let collided = false;

  for (let i = 0; i < solids.length; i += 1) {
    const solid = solids[i];
    if (!intersects(rect, solid)) continue;
    collided = true;
    if (entity.vx > 0) {
      nextX = solid.x - entity.width;
      rect.x = nextX;
      entity.vx = 0;
    } else if (entity.vx < 0) {
      nextX = solid.x + solid.w;
      rect.x = nextX;
      entity.vx = 0;
    }
  }

  entity.x = nextX;
  return collided;
}

function resolveVerticalMovement(entity, solids, dt) {
  let nextY = entity.y + entity.vy * dt;
  const rect = { x: entity.x, y: nextY, w: entity.width, h: entity.height };
  let grounded = false;

  for (let i = 0; i < solids.length; i += 1) {
    const solid = solids[i];
    if (!intersects(rect, solid)) continue;

    if (entity.vy > 0) {
      nextY = solid.y - entity.height;
      rect.y = nextY;
      entity.vy = 0;
      grounded = true;
    } else if (entity.vy < 0) {
      nextY = solid.y + solid.h;
      rect.y = nextY;
      entity.vy = 0;
    }
  }

  entity.y = nextY;
  entity.onGround = grounded;
}

function runStartTransitionSystem({ state, nowMs }) {
  state.lastUpdate = nowMs;
  syncStartState(state, nowMs);
}

function runPlayerSystem({ state, dt }) {
  const raceActive = isRaceActive(state);
  const solids = TRACK.solids;
  const worldWidth = TRACK.worldWidth;
  const finishX = TRACK.finishX;
  const groundY = TRACK.groundY;

  for (const playerId of ["p1", "p2"]) {
    const player = state.players[playerId];
    if (!player) continue;

    if (player.hurtCooldown > 0) {
      player.hurtCooldown = Math.max(0, player.hurtCooldown - dt);
    }

    if (!raceActive || !player.connected || player.finished) {
      player.vx = approach(player.vx, 0, GROUND_FRICTION * dt);
      player.vy = 0;
      player.onGround = true;
      player.input.jumpQueued = false;
      continue;
    }

    let moveDir = 0;
    if (player.input.left && !player.input.right) moveDir = -1;
    if (player.input.right && !player.input.left) moveDir = 1;

    if (moveDir !== 0) {
      const accel = player.onGround
        ? player.input.run
          ? RUN_ACCEL
          : WALK_ACCEL
        : AIR_ACCEL;
      player.vx += moveDir * accel * dt;
      player.facing = moveDir;
    } else {
      const drag = player.onGround ? GROUND_FRICTION : AIR_DRAG;
      player.vx = approach(player.vx, 0, drag * dt);
    }

    const maxSpeed = player.input.run ? MAX_RUN_SPEED : MAX_WALK_SPEED;
    player.vx = clamp(player.vx, -maxSpeed, maxSpeed);

    if (player.input.jumpQueued && player.onGround) {
      player.vy = -JUMP_SPEED;
      player.onGround = false;
    }
    player.input.jumpQueued = false;

    player.vy = clamp(player.vy + GRAVITY * dt, -JUMP_SPEED, MAX_FALL_SPEED);

    resolveHorizontalMovement(player, solids, dt);
    player.x = clamp(player.x, 0, worldWidth - player.width);

    resolveVerticalMovement(player, solids, dt);

    if (player.y > groundY + 260) {
      player.x = Math.max(START_POSITIONS[playerId].x, player.x - 96);
      player.y = START_POSITIONS[playerId].y;
      player.vx = 0;
      player.vy = 0;
      player.onGround = true;
    }

    if (!player.finished && player.x + player.width >= finishX) {
      player.finished = true;
      player.finishMs = Date.now();
      player.vx = 0;
      player.vy = 0;
    }
  }
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
    const hitWall = resolveHorizontalMovement(enemy, solids, dt);
    if (hitWall || enemy.vx === 0) {
      const speed = enemyBaseSpeed(enemy.type);
      const nextDir = prevVx <= 0 ? 1 : -1;
      enemy.vx = nextDir * speed;
    }

    enemy.facing = enemy.vx >= 0 ? 1 : -1;

    resolveVerticalMovement(enemy, solids, dt);

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
  for (const playerId of ["p1", "p2"]) {
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

      if (!intersects(playerRect, enemyRect)) continue;

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
      player.x = Math.max(START_POSITIONS[playerId].x, player.x - 96);
      player.y = START_POSITIONS[playerId].y;
      player.vx = 0;
      player.vy = 0;
      player.onGround = true;
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

function sanitizeStateForClients(state) {
  return {
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
    nextState.players.p1.connected = Boolean(state.players?.p1?.connected);
    nextState.players.p2.connected = Boolean(state.players?.p2?.connected);
    nextState.players.p1.rejoinToken = state.players?.p1?.rejoinToken || null;
    nextState.players.p2.rejoinToken = state.players?.p2?.rejoinToken || null;
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

export function registerMarioGame(io) {
  registerPluggableGame({
    io,
    meta: marioGameMeta,
    createState: createInitialGameState,
    systems: createMarioSystems(),
    onPlayerConnected: (state, playerId) => {
      state.players[playerId].connected = true;
      state.abandonedAt = null;
      if (state.gameOver) {
        resetRaceStateInPlace(state, { keepConnections: true });
      }
      scheduleMarioStart(state);
    },
    handleInput: ({ state, playerId, payload }) => {
      const player = state.players[playerId];
      if (!player || !payload || typeof payload !== "object") return;

      const { type, value } = payload;
      switch (type) {
        case "left":
        case "right":
        case "run":
          player.input[type] = Boolean(value);
          break;
        case "jump":
          if (value && !player.input.jump) {
            player.input.jumpQueued = true;
          }
          player.input.jump = Boolean(value);
          break;
        default:
          break;
      }
    },
    handleDisconnect: (state, playerId) => {
      state.players[playerId].connected = false;
      const otherPlayerId = playerId === "p1" ? "p2" : "p1";
      const bothDisconnected = !state.players[otherPlayerId].connected;

      if (bothDisconnected) {
        resetRaceStateInPlace(state, { keepConnections: false });
        state.abandonedAt = Date.now();
      } else {
        state.started = false;
        state.startAt = null;
        state.rematchRequests = { p1: false, p2: false };
        state.abandonedAt = null;
      }
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
      emitEvent({ socket, gameId, type: "rematchRequested", payload: { playerId }, target: "others" });

      const bothReady =
        state.players.p1.connected &&
        state.players.p2.connected &&
        state.rematchRequests.p1 &&
        state.rematchRequests.p2;
      if (!bothReady) return;

      const nextState = createInitialGameState();
      nextState.players.p1.connected = state.players.p1.connected;
      nextState.players.p2.connected = state.players.p2.connected;
      nextState.players.p1.rejoinToken = state.players.p1.rejoinToken || null;
      nextState.players.p2.rejoinToken = state.players.p2.rejoinToken || null;
      games.set(gameId, nextState);
      emitEvent({ nsp, gameId, type: "rematchStarted", target: "game" });
    },
    beforeUpdate: scheduleMarioStart,
    shouldCleanup: (state, now) => {
      if (!state.abandonedAt) return false;
      return now - state.abandonedAt > ROOM_CLEANUP_DELAY_MS;
    },
    serializeState: sanitizeStateForClients,
    dtFallback: DT,
    tickMs: 1000 / FPS,
  });
}
