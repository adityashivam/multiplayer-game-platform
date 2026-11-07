import { pongGameMeta } from "./metadata.js";
import {
  emitEvent,
  registerPluggableGame,
  scheduleStart,
} from "../core/index.js";
import { createAuthoritativeInputSession } from "../core/authoritativeInputSession.js";
import {
  PONG_FIXED_DT_SEC,
  PONG_INPUT_TEMPLATE,
  PONG_PADDLE_SETTINGS,
  stepPongPaddle,
} from "../../../public/games/pong/shared/simulation.js";
import { INPUT_PROTOCOL, SOCKET_EVENT } from "../../../public/platform/shared/networkProtocol.js";

/** @typedef {import("../../../public/games/pong/shared/simulation.js").PongInputState} PongInputState */
/** @typedef {"p1" | "p2"} PongPlayerId */
/**
 * @typedef {import("../core/authoritativeInputSession.js").AuthoritativePlayerInputState<keyof PongInputState> & {
 *   y: number,
 *   score: number,
 *   connected: boolean,
 *   input: PongInputState,
 *   inputEpoch: number,
 *   inputSimulationTick: number,
 *   lastInputSeqAck: number,
 *   rejoinToken?: string
 * }} PongServerPlayerState
 */

/**
 * @typedef {object} PongBallState
 * @property {number} x
 * @property {number} y
 * @property {number} vx
 * @property {number} vy
 * @property {number} speed
 */

/**
 * @typedef {object} PongGameState
 * @property {{p1: PongServerPlayerState, p2: PongServerPlayerState}} players
 * @property {PongBallState} ball
 * @property {boolean} started
 * @property {number | null} startAt
 * @property {boolean} gameOver
 * @property {PongPlayerId | null} winner
 * @property {{p1: boolean, p2: boolean}} rematchRequests
 * @property {number} lastUpdate
 * @property {PongPlayerId | null} [lastLost]
 * @property {number | null} [abandonedAt]
 */

const WIDTH = 1280;
const HEIGHT = PONG_PADDLE_SETTINGS.HEIGHT;
const PADDLE_W = 26;
const PADDLE_H = PONG_PADDLE_SETTINGS.PADDLE_HEIGHT;
const BALL_BASE_SPEED = 450;
const COUNTDOWN_MS = 1500;
const WIN_SCORE = 10;
const ROOM_CLEANUP_DELAY_MS = 30000;

/** @type {ReadonlyArray<PongPlayerId>} */
const PONG_PLAYER_IDS = ["p1", "p2"];
const pongInputSession = createAuthoritativeInputSession({
  inputTemplate: PONG_INPUT_TEMPLATE,
  fixedDtSec: PONG_FIXED_DT_SEC,
});

/**
 * @param {number} [initialDir]
 * @returns {PongBallState}
 */
function createPongBall(initialDir = 1) {
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

/** @returns {PongServerPlayerState} */
function createPongPlayerState() {
  return {
    y: HEIGHT / 2,
    score: 0,
    connected: false,
    input: { ...PONG_INPUT_TEMPLATE },
    inputEpoch: 0,
    inputSimulationTick: 0,
    lastInputSeqAck: 0,
  };
}

/** @returns {PongGameState} */
function createInitialGameState() {
  return {
    players: {
      p1: createPongPlayerState(),
      p2: createPongPlayerState(),
    },
    ball: createPongBall(),
    started: false,
    startAt: null,
    gameOver: false,
    winner: null,
    rematchRequests: { p1: false, p2: false },
    lastUpdate: Date.now(),
  };
}

/**
 * @param {PongGameState} state
 * @param {number} [direction]
 */
function resetPongRound(state, direction = 1) {
  state.ball = createPongBall(direction);
  state.started = true; // keep the match flowing without a new countdown mid-game
  state.startAt = null;
}

/** @param {PongServerPlayerState} playerState */
function serializePongPlayerState(playerState) {
  return {
    y: playerState.y,
    score: playerState.score,
    connected: playerState.connected,
    ...pongInputSession.getPlayerSnapshotMetadata(playerState),
  };
}

/** @param {PongGameState} state */
function serializePongState(state) {
  return {
    players: {
      p1: serializePongPlayerState(state.players.p1),
      p2: serializePongPlayerState(state.players.p2),
    },
    inputProtocol: INPUT_PROTOCOL.QUEUED,
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

/** @param {PongGameState} state */
function isPongActive(state) {
  return Boolean(state.started && !state.gameOver);
}

/**
 * @param {PongGameState} state
 * @param {number} nowMs
 */
function syncPongStartState(state, nowMs) {
  scheduleStart(state, COUNTDOWN_MS);
  if (!state.started && state.startAt && nowMs >= state.startAt) {
    state.started = true;
    state.startAt = null;
  }
}

/** @param {{state: PongGameState, dt: number}} context */
function runPongPaddleSystem({ state, dt }) {
  // Paddles move regardless to respond instantly
  pongInputSession.simulateRoom({ state, dtSec: dt, simulate: stepPongPaddle });
}

/** @param {{state: PongGameState, dt: number}} context */
function runPongBallSystem({ state, dt }) {
  if (!isPongActive(state)) return;

  const { p1, p2 } = state.players;
  const ball = state.ball;

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
      resetPongRound(state, -1);
    }
  } else if (ball.x > WIDTH + 20) {
    p1.score += 1;
    state.lastLost = "p2";
    if (p1.score >= WIN_SCORE) {
      state.gameOver = true;
      state.winner = "p1";
    } else {
      resetPongRound(state, 1);
    }
  }
}

function createPongSimulationSystems() {
  return [
    {
      priority: -100,
      system: {
        name: "timestamp",
        update: ({ state, nowMs }) => {
          state.lastUpdate = nowMs;
        },
      },
    },
    {
      priority: -80,
      system: {
        name: "start-transition",
        update: ({ state, nowMs }) => {
          syncPongStartState(state, nowMs);
        },
      },
    },
    { priority: -40, system: { name: "paddle", update: runPongPaddleSystem } },
    { priority: 0, system: { name: "ball", update: runPongBallSystem } },
  ];
}

/**
 * @param {PongGameState} state
 * @param {PongPlayerId} playerId
 */
function connectPongPlayer(state, playerId) {
  const playerState = state.players[playerId];
  playerState.connected = true;
  pongInputSession.resetPlayer(playerState);
  state.abandonedAt = null;
  state.gameOver = false;
  state.winner = null;
  scheduleStart(state, COUNTDOWN_MS);
}

/**
 * @param {object} options
 * @param {PongGameState} options.state
 * @param {PongPlayerId} options.playerId
 * @param {import("../core/inputProtocol.js").InputPacket<keyof PongInputState>} options.payload
 */
function receivePongPlayerInput({ state, playerId, payload }) {
  pongInputSession.receiveInput(state.players[playerId], payload);
}

/**
 * @param {PongGameState} state
 * @param {PongPlayerId} playerId
 */
function disconnectPongPlayer(state, playerId) {
  const playerState = state.players[playerId];
  playerState.connected = false;
  pongInputSession.resetPlayer(playerState);
  const otherPlayerId = playerId === "p1" ? "p2" : "p1";
  const bothDisconnected = !state.players[otherPlayerId].connected;
  if (bothDisconnected) {
    state.started = false;
    state.startAt = null;
    state.gameOver = false;
    state.winner = null;
    state.ball = createPongBall();
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
 * Replace the match while preserving token ownership and advancing input epochs.
 * @param {object} options
 * @param {import("socket.io").Socket} options.socket
 * @param {Map<string, PongGameState>} options.games
 * @param {import("socket.io").Namespace} options.nsp
 */
function requestPongRematch({ socket, games, nsp }) {
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

  const bothReady = PONG_PLAYER_IDS.every((slotId) =>
    state.players[slotId].connected && state.rematchRequests[slotId],
  );
  if (!bothReady) {
    return;
  }

  const nextState = createInitialGameState();
  for (const slotId of PONG_PLAYER_IDS) {
    const previousPlayerState = state.players[slotId];
    const nextPlayerState = nextState.players[slotId];
    nextPlayerState.connected = previousPlayerState.connected;
    nextPlayerState.rejoinToken = previousPlayerState.rejoinToken;
    nextPlayerState.inputEpoch = previousPlayerState.inputEpoch;
    pongInputSession.resetPlayer(nextPlayerState);
  }
  games.set(gameId, nextState);
  emitEvent({ nsp, gameId, type: SOCKET_EVENT.REMATCH_STARTED, target: "game" });
}

/**
 * Register paddle input through the SDK and retain server ball/scoring rules.
 * @param {import("socket.io").Server} io
 * @returns {ReturnType<typeof registerPluggableGame>}
 */
export function registerPongGame(io) {
  return registerPluggableGame({
    io,
    meta: pongGameMeta,
    createState: createInitialGameState,
    systems: createPongSimulationSystems(),
    onPlayerConnected: connectPongPlayer,
    handleInput: receivePongPlayerInput,
    handleDisconnect: disconnectPongPlayer,
    handleRematch: requestPongRematch,
    shouldCleanup: (state, now) => {
      if (!state.abandonedAt) return false;
      return now - state.abandonedAt > ROOM_CLEANUP_DELAY_MS;
    },
    serializeState: serializePongState,
    afterEmit: (state) => {
      state.lastLost = null;
    },
    dtFallback: PONG_FIXED_DT_SEC,
    tickMs: PONG_FIXED_DT_SEC * 1000,
  });
}
