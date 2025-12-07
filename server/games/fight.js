import { fightGameMeta } from "./metadata.js";
import { registerGame, scheduleStart } from "../utils/utils.js";

const FPS = 60;
const DT = 1 / FPS;
const MOVE_SPEED = 500;
const JUMP_SPEED = -800;
const GRAVITY = 2000;
const GROUND_Y = 870; // Ground height for physics
const ATTACK_RANGE = 250;
const ATTACK_COOLDOWN = 0.4;
const MIN_SEPARATION = 120;
const GAME_DURATION = 60;
const COUNTDOWN_MS = 3000;

function createInitialGameState() {
  return {
    players: {
      p1: {
        x: 200,
        y: GROUND_Y - 42,
        vx: 0,
        vy: 0,
        dir: 1,
        health: 500,
        attacking: false,
        dead: false,
        connected: false,
        input: {
          left: false,
          right: false,
          jump: false,
          attack: false,
        },
      },
      p2: {
        x: 1000,
        y: GROUND_Y - 42,
        vx: 0,
        vy: 0,
        dir: -1,
        health: 500,
        attacking: false,
        dead: false,
        connected: false,
        input: {
          left: false,
          right: false,
          jump: false,
          attack: false,
        },
      },
    },
    timer: GAME_DURATION,
    gameOver: false,
    winner: null,
    lastUpdate: Date.now(),
    started: false,
    startAt: null,
  };
}

function initAttackTimestamps(state) {
  state.players.p1.lastAttackHitTime = 0;
  state.players.p2.lastAttackHitTime = 0;
}

function scheduleFightStart(state) {
  scheduleStart(state, COUNTDOWN_MS, (gameState) => {
    gameState.timer = GAME_DURATION;
  });
}

function sanitizeStateForClients(state) {
  return {
    players: {
      p1: {
        x: state.players.p1.x,
        y: state.players.p1.y,
        dir: state.players.p1.dir,
        health: state.players.p1.health,
        attacking: state.players.p1.attacking,
        dead: state.players.p1.dead,
      },
      p2: {
        x: state.players.p2.x,
        y: state.players.p2.y,
        dir: state.players.p2.dir,
        health: state.players.p2.health,
        attacking: state.players.p2.attacking,
        dead: state.players.p2.dead,
      },
    },
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

function updateGameState(state, dt) {
  const { p1, p2 } = state.players;
  const now = Date.now();

  if (!state.started && state.startAt && now >= state.startAt) {
    state.started = true;
    state.startAt = null;
  }

  const gameActive = state.started && !state.gameOver;

  for (const player of [p1, p2]) {
    if (player.dead) {
      player.vx = 0;
      continue;
    }

    if (!gameActive) {
      player.vx = 0;
      player.vy = 0;
      player.attacking = false;
      if (player.y > GROUND_Y) {
        player.y = GROUND_Y;
      }
      continue;
    }

    if (player.input.left && !player.input.right) {
      player.vx = -MOVE_SPEED;
      player.dir = -1;
    } else if (player.input.right && !player.input.left) {
      player.vx = MOVE_SPEED;
      player.dir = 1;
    } else {
      player.vx = 0;
    }

    if (player.input.jump && player.y >= GROUND_Y - 1) {
      player.vy = JUMP_SPEED;
    }

    player.attacking = player.input.attack;
  }

  for (const player of [p1, p2]) {
    if (!player.dead && gameActive) {
      player.vy += GRAVITY * dt;
      player.y += player.vy * dt;

      if (player.y > GROUND_Y) {
        player.y = GROUND_Y;
        player.vy = 0;
      }

      player.x += player.vx * dt;
      player.x = Math.max(100, Math.min(1180, player.x));
    } else if (!player.dead && !gameActive && player.y > GROUND_Y) {
      player.y = GROUND_Y;
      player.vy = 0;
    }
  }

  if (gameActive) {
    const dx = p1.x - p2.x;
    if (Math.abs(dx) < MIN_SEPARATION) {
      const push = (MIN_SEPARATION - Math.abs(dx)) / 2;
      const dir = dx === 0 ? 1 : Math.sign(dx);
      p1.x += push * dir;
      p2.x -= push * dir;
      p1.vx = 0;
      p2.vx = 0;
    }

    p1.x = Math.max(100, Math.min(1180, p1.x));
    p2.x = Math.max(100, Math.min(1180, p2.x));

    const tNow = state.lastUpdate / 1000;

    if (p1.attacking && !p1.dead && !p2.dead) {
      const dist = Math.abs(p1.x - p2.x);
      if (dist < ATTACK_RANGE && tNow - (p1.lastAttackHitTime || 0) > ATTACK_COOLDOWN) {
        p1.lastAttackHitTime = tNow;
        p2.health = Math.max(0, p2.health - 50);
        if (p2.health === 0) {
          p2.dead = true;
          state.gameOver = true;
          state.winner = "p1";
        }
      }
    }

    if (p2.attacking && !p2.dead && !p1.dead) {
      const dist = Math.abs(p2.x - p1.x);
      if (dist < ATTACK_RANGE && tNow - (p2.lastAttackHitTime || 0) > ATTACK_COOLDOWN) {
        p2.lastAttackHitTime = tNow;
        p1.health = Math.max(0, p1.health - 50);
        if (p1.health === 0) {
          p1.dead = true;
          state.gameOver = true;
          state.winner = "p2";
        }
      }
    }

    state.timer = Math.max(0, state.timer - dt);
    if (state.timer === 0 && !state.gameOver) {
      state.gameOver = true;
      if (p1.health > p2.health) state.winner = "p1";
      else if (p2.health > p1.health) state.winner = "p2";
      else state.winner = "tie";
    }
  }
}

export function registerFightGame(io) {
  registerGame({
    io,
    meta: fightGameMeta,
    createState: createInitialGameState,
    onStateCreated: initAttackTimestamps,
    onPlayerConnected: (state, playerId) => {
      state.players[playerId].connected = true;
      scheduleFightStart(state);
    },
    handleInput: ({ state, playerId, payload }) => {
      const { type, value } = payload;
      const player = state.players[playerId];
      if (!player || player.dead) return;

      switch (type) {
        case "left":
        case "right":
        case "jump":
        case "attack":
          player.input[type] = value;
          break;
        default:
          break;
      }
    },
    handleDisconnect: (state, playerId) => {
      state.players[playerId].connected = false;
      state.started = false;
      state.startAt = null;
      state.timer = GAME_DURATION;
      state.gameOver = false;
      state.winner = null;
    },
    beforeUpdate: scheduleFightStart,
    updateState: (state, dt) => {
      if (!state.gameOver) {
        updateGameState(state, dt);
      }
    },
    serializeState: sanitizeStateForClients,
    dtFallback: DT,
    tickMs: 1000 / FPS,
  });
}
