import { pongGameMeta } from "./metadata.js";
import {
  emitEvent,
  registerGame,
  scheduleStart,
} from "../utils/utils.js";

const FPS = 60;
const DT = 1 / FPS;
const WIDTH = 1280;
const HEIGHT = 720;
const PADDLE_W = 26;
const PADDLE_H = 160;
const PADDLE_SPEED = 900;
const BALL_BASE_SPEED = 450;
const COUNTDOWN_MS = 1500;
const WIN_SCORE = 10;

function makeBall(initialDir = 1) {
  const angle = (Math.random() * Math.PI) / 3 - Math.PI / 6; // -30deg..+30deg
  const speed = BALL_BASE_SPEED;
  return {
    x: WIDTH / 2,
    y: HEIGHT / 2,
    vx: Math.cos(angle) * speed * initialDir,
    vy: Math.sin(angle) * speed,
    speed,
  };
}

function createInitialGameState() {
  return {
    players: {
      p1: {
        y: HEIGHT / 2,
        score: 0,
        connected: false,
        input: { up: false, down: false },
      },
      p2: {
        y: HEIGHT / 2,
        score: 0,
        connected: false,
        input: { up: false, down: false },
      },
    },
    ball: makeBall(),
    started: false,
    startAt: null,
    gameOver: false,
    winner: null,
    rematchRequests: { p1: false, p2: false },
    lastUpdate: Date.now(),
  };
}

function resetRound(state, direction = 1) {
  state.ball = makeBall(direction);
  state.started = true; // keep the match flowing without a new countdown mid-game
  state.startAt = null;
}

function sanitize(state) {
  return {
    players: {
      p1: {
        y: state.players.p1.y,
        score: state.players.p1.score,
        connected: state.players.p1.connected,
      },
      p2: {
        y: state.players.p2.y,
        score: state.players.p2.score,
        connected: state.players.p2.connected,
      },
    },
    ball: {
      x: state.ball.x,
      y: state.ball.y,
    },
    gameOver: state.gameOver,
    winner: state.winner,
    started: state.started,
    startAt: state.startAt,
    lastLost: state.lastLost || null,
  };
}

function updateGameState(state, dt) {
  const { p1, p2 } = state.players;
  const ball = state.ball;
  const now = Date.now();

  // Ensure countdown starts if both players are connected
  scheduleStart(state, COUNTDOWN_MS);

  if (!state.started && state.startAt && now >= state.startAt) {
    state.started = true;
    state.startAt = null;
  }

  // Paddles move regardless to respond instantly
  for (const player of [p1, p2]) {
    let vy = 0;
    if (player.input.up && !player.input.down) vy = -PADDLE_SPEED;
    else if (player.input.down && !player.input.up) vy = PADDLE_SPEED;
    player.y += vy * dt;
    player.y = Math.max(PADDLE_H / 2, Math.min(HEIGHT - PADDLE_H / 2, player.y));
  }

  if (!state.started || state.gameOver) return;

  // Ball physics
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  // Top/bottom walls
  if (ball.y <= 0) {
    ball.y = 0;
    ball.vy *= -1;
  } else if (ball.y >= HEIGHT) {
    ball.y = HEIGHT;
    ball.vy *= -1;
  }

  // Paddle collision helpers
  const paddleX1 = 70;
  const paddleX2 = WIDTH - 70;
  const halfH = PADDLE_H / 2;

  const hitPaddle = (px, py) =>
    ball.x >= px - PADDLE_W / 2 &&
    ball.x <= px + PADDLE_W / 2 &&
    ball.y >= py - halfH &&
    ball.y <= py + halfH;

  if (ball.vx < 0 && hitPaddle(paddleX1, p1.y)) {
    ball.x = paddleX1 + PADDLE_W / 2;
    const offset = (ball.y - p1.y) / halfH;
    const angle = offset * (Math.PI / 3); // up to 60deg
    const speed = Math.min(ball.speed * 1.015, BALL_BASE_SPEED * 1.25);
    ball.vx = Math.cos(angle) * speed;
    ball.vy = Math.sin(angle) * speed;
    ball.speed = speed;
  } else if (ball.vx > 0 && hitPaddle(paddleX2, p2.y)) {
    ball.x = paddleX2 - PADDLE_W / 2;
    const offset = (ball.y - p2.y) / halfH;
    const angle = offset * (Math.PI / 3);
    const speed = Math.min(ball.speed * 1.015, BALL_BASE_SPEED * 1.25);
    ball.vx = -Math.cos(angle) * speed;
    ball.vy = Math.sin(angle) * speed;
    ball.speed = speed;
  }

  // Scoring
  if (ball.x < -20) {
    p2.score += 1;
    state.lastLost = "p1";
    if (p2.score >= WIN_SCORE) {
      state.gameOver = true;
      state.winner = "p2";
    } else {
      resetRound(state, -1);
    }
  } else if (ball.x > WIDTH + 20) {
    p1.score += 1;
    state.lastLost = "p2";
    if (p1.score >= WIN_SCORE) {
      state.gameOver = true;
      state.winner = "p1";
    } else {
      resetRound(state, 1);
    }
  }
}

export function registerPongGame(io) {
  registerGame({
    io,
    meta: pongGameMeta,
    createState: createInitialGameState,
    onPlayerConnected: (state, playerId) => {
      state.players[playerId].connected = true;
      state.gameOver = false;
      state.winner = null;
      scheduleStart(state, COUNTDOWN_MS);
    },
    handleInput: ({ state, playerId, payload }) => {
      const { type, value } = payload;
      const player = state.players[playerId];
      if (!player) return;

      switch (type) {
        case "up":
        case "down":
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
      state.gameOver = false;
      state.winner = null;
      state.ball = makeBall();
      state.rematchRequests = { p1: false, p2: false };
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
      games.set(gameId, nextState);
      emitEvent({ nsp, gameId, type: "rematchStarted", target: "game" });
    },
    updateState: updateGameState,
    serializeState: sanitize,
    afterEmit: (state) => {
      state.lastLost = null;
    },
    dtFallback: DT,
    tickMs: 1000 / FPS,
  });
}
