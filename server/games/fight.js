import { fightGameMeta } from "./metadata.js";
import { emitEvent, registerGame, scheduleStart } from "../utils/utils.js";

const FPS = 60;
const DT = 1 / FPS;
const MOVE_SPEED = 500;
const JUMP_SPEED = -800;
const GRAVITY = 2000;
const GROUND_Y = 870; // Ground height for physics
const MIN_SEPARATION = 120;
const GAME_DURATION = 300;
const COUNTDOWN_MS = 3000;
const ROOM_CLEANUP_DELAY_MS = 30000;
const MAX_HEALTH = 500;
const REGEN_DELAY = 3; // seconds after last hit before regen starts
const REGEN_RATE = 8; // health per second

// Attack type definitions
const ATTACKS = {
  light:  { damage: 30, range: 200, cooldown: 0.3, duration: 0.2 },
  heavy:  { damage: 75, range: 280, cooldown: 0.8, duration: 0.4 },
  aerial: { damage: 50, range: 220, cooldown: 0.5, duration: 0.25 },
};

function makePlayer(x, dir) {
  return {
    x,
    y: GROUND_Y - 42,
    vx: 0,
    vy: 0,
    dir,
    health: MAX_HEALTH,
    attacking: false,
    attackType: null, // "light" | "heavy" | "aerial"
    attackTimer: 0,
    cooldownTimer: 0,
    lastHitTime: 0,
    dead: false,
    connected: false,
    input: {
      left: false,
      right: false,
      jump: false,
      attack: false,
      heavyAttack: false,
      aerialAttack: false,
    },
  };
}

function createInitialGameState() {
  return {
    players: {
      p1: makePlayer(200, 1),
      p2: makePlayer(1000, -1),
    },
    timer: GAME_DURATION,
    gameOver: false,
    winner: null,
    rematchRequests: { p1: false, p2: false },
    lastUpdate: Date.now(),
    started: false,
    startAt: null,
  };
}

function initAttackTimestamps(state) {
  // Attack timing is now initialized in makePlayer; keep for compatibility
  state.players.p1.lastAttackHitTime = 0;
  state.players.p2.lastAttackHitTime = 0;
}

function scheduleFightStart(state) {
  scheduleStart(state, COUNTDOWN_MS, (gameState) => {
    gameState.timer = GAME_DURATION;
  });
}

function sanitizePlayer(p) {
  return {
    x: p.x,
    y: p.y,
    vx: p.vx,
    dir: p.dir,
    health: p.health,
    attacking: p.attacking,
    attackType: p.attackType,
    dead: p.dead,
  };
}

function sanitizeStateForClients(state) {
  return {
    players: {
      p1: sanitizePlayer(state.players.p1),
      p2: sanitizePlayer(state.players.p2),
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

function chooseAttackType(player) {
  const inAir = player.y < GROUND_Y - 5;
  if (player.input.aerialAttack || (player.input.attack && inAir)) return "aerial";
  if (player.input.heavyAttack) return "heavy";
  if (player.input.attack) return "light";
  return null;
}

function tryStartAttack(player) {
  if (player.dead || player.attacking || player.cooldownTimer > 0) return;
  const type = chooseAttackType(player);
  if (!type) return;
  const def = ATTACKS[type];
  player.attacking = true;
  player.attackType = type;
  player.attackTimer = def.duration;
  player.cooldownTimer = def.duration + def.cooldown;
  player.hasHitThisSwing = false;
}

function resolveAttack(attacker, defender, state, attackerKey) {
  if (!attacker.attacking || attacker.hasHitThisSwing || attacker.dead || defender.dead) return;
  const def = ATTACKS[attacker.attackType];
  if (!def) return;
  const dist = Math.abs(attacker.x - defender.x);
  if (dist >= def.range) return;

  attacker.hasHitThisSwing = true;
  defender.health = Math.max(0, defender.health - def.damage);
  defender.lastHitTime = state.lastUpdate / 1000;
  if (defender.health === 0) {
    defender.dead = true;
    state.gameOver = true;
    state.winner = attackerKey;
  }
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
      player.attackType = null;
      player.attackTimer = 0;
      if (player.y > GROUND_Y) {
        player.y = GROUND_Y;
      }
      continue;
    }

    // Movement (reduced speed while attacking)
    const speedMult = player.attacking ? 0.3 : 1;
    if (player.input.left && !player.input.right) {
      player.vx = -MOVE_SPEED * speedMult;
      if (!player.attacking) player.dir = -1;
    } else if (player.input.right && !player.input.left) {
      player.vx = MOVE_SPEED * speedMult;
      if (!player.attacking) player.dir = 1;
    } else {
      player.vx = 0;
    }

    if (player.input.jump && player.y >= GROUND_Y - 1) {
      player.vy = JUMP_SPEED;
    }

    // Attack system
    tryStartAttack(player);
    if (player.attacking) {
      player.attackTimer -= dt;
      if (player.attackTimer <= 0) {
        player.attacking = false;
        player.attackType = null;
        player.attackTimer = 0;
      }
    }
    if (player.cooldownTimer > 0) {
      player.cooldownTimer -= dt;
    }
  }

  // Physics
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
    // Push apart if too close
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

    // Resolve attacks
    resolveAttack(p1, p2, state, "p1");
    resolveAttack(p2, p1, state, "p2");

    // Health regeneration
    const tNow = state.lastUpdate / 1000;
    for (const player of [p1, p2]) {
      if (!player.dead && player.health < MAX_HEALTH) {
        const timeSinceHit = tNow - (player.lastHitTime || 0);
        if (timeSinceHit >= REGEN_DELAY) {
          player.health = Math.min(MAX_HEALTH, player.health + REGEN_RATE * dt);
        }
      }
    }

    // Timer
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
      state.abandonedAt = null;
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
        case "heavyAttack":
        case "aerialAttack":
          player.input[type] = value;
          break;
        default:
          break;
      }
    },
    handleDisconnect: (state, playerId) => {
      state.players[playerId].connected = false;
      // Only fully reset if both players are disconnected
      const otherPlayer = playerId === "p1" ? "p2" : "p1";
      const bothDisconnected = !state.players[otherPlayer].connected;
      if (bothDisconnected) {
        state.started = false;
        state.startAt = null;
        state.timer = GAME_DURATION;
        state.gameOver = false;
        state.winner = null;
        state.rematchRequests = { p1: false, p2: false };
        state.abandonedAt = Date.now();
      } else {
        // Pause the game while waiting for reconnect
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
      initAttackTimestamps(nextState);
      games.set(gameId, nextState);
      emitEvent({ nsp, gameId, type: "rematchStarted", target: "game" });
    },
    beforeUpdate: scheduleFightStart,
    updateState: (state, dt) => {
      if (!state.gameOver) {
        updateGameState(state, dt);
      }
    },
    shouldCleanup: (state, now) => {
      if (!state.abandonedAt) return false;
      return now - state.abandonedAt > ROOM_CLEANUP_DELAY_MS;
    },
    serializeState: sanitizeStateForClients,
    dtFallback: DT,
    tickMs: 1000 / FPS,
  });
}
