import { createAxisMovementController } from "../../../platform/shared/simulationControllers.js";

/**
 * @typedef {object} PongInputState
 * @property {boolean} up
 * @property {boolean} down
 */

/**
 * Only the paddle pose is predicted; ball and scoring remain authoritative.
 * @typedef {object} PongPlayerState
 * @property {number} y Paddle center in playfield coordinates.
 */

/** @type {Readonly<PongInputState>} */
export const PONG_INPUT_TEMPLATE = Object.freeze({ up: false, down: false });
export const PONG_FIXED_DT_SEC = 1 / 60;
export const PONG_ARENA_SETTINGS = Object.freeze({ WIDTH: 1280, HEIGHT: 720 });
export const PONG_PADDLE_SETTINGS = Object.freeze({
  HEIGHT: PONG_ARENA_SETTINGS.HEIGHT,
  PADDLE_HEIGHT: 160,
  SPEED: 900,
});

const halfPaddleHeight = PONG_PADDLE_SETTINGS.PADDLE_HEIGHT / 2;
const stepPongAxis = createAxisMovementController({
  state: { position: "y" },
  input: { negative: "up", positive: "down" },
  speed: PONG_PADDLE_SETTINGS.SPEED,
  min: halfPaddleHeight,
  max: PONG_PADDLE_SETTINGS.HEIGHT - halfPaddleHeight,
});

/**
 * Move a paddle in place and clamp its entire height within the playfield.
 * Opposing held controls cancel each other. No other player fields are changed.
 * @param {PongPlayerState} player
 * @param {PongInputState} input
 * @param {number} dtSec Simulation duration in seconds.
 * @returns {void}
 */
export function stepPongPaddle(player, input, dtSec) {
  stepPongAxis(player, input, dtSec);
}
