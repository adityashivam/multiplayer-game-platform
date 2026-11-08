import { MARIO_MOVEMENT_SETTINGS, MARIO_TRACK } from "./config.js";

/** @typedef {import("./config.js").MarioInputState} MarioInputState */
/** @typedef {{x: number, y: number, w: number, h: number}} MarioSolid */
/**
 * @typedef {object} MarioMovementState
 * @property {number} x
 * @property {number} y
 * @property {number} vx
 * @property {number} vy
 * @property {number} width
 * @property {number} height
 * @property {boolean} onGround
 * @property {number} facing
 * @property {boolean} jumpHeld Last simulated jump state; held input cannot auto-jump.
 */
/** @typedef {{active?: boolean, solids?: ReadonlyArray<MarioSolid>, worldWidth?: number}} MarioMovementContext */

const DEFAULT_MOVEMENT_CONTEXT = Object.freeze({ active: true });
const {
  WALK_ACCEL, RUN_ACCEL, AIR_ACCEL, GROUND_FRICTION, AIR_DRAG,
  MAX_WALK_SPEED, MAX_RUN_SPEED, JUMP_SPEED, GRAVITY, MAX_FALL_SPEED,
} = MARIO_MOVEMENT_SETTINGS;

/** @param {number} value @param {number} minimum @param {number} maximum */
function clampMarioMovement(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

/** @param {number} velocity @param {number} step */
function reduceMarioVelocity(velocity, step) {
  if (velocity < 0) return Math.min(0, velocity + step);
  return Math.max(0, velocity - step);
}

/** @param {MarioSolid} firstRect @param {MarioSolid} secondRect @returns {boolean} */
export function marioRectanglesIntersect(firstRect, secondRect) {
  return firstRect.x < secondRect.x + secondRect.w && firstRect.x + firstRect.w > secondRect.x &&
    firstRect.y < secondRect.y + secondRect.h && firstRect.y + firstRect.h > secondRect.y;
}

/**
 * Resolve the game's tile collision order for players and authoritative enemies.
 * Mutates position/velocity only and never retains the immutable solid geometry.
 * @param {MarioMovementState} entityState
 * @param {ReadonlyArray<MarioSolid>} solids
 * @param {number} dtSec
 * @returns {boolean} Whether a wall was touched.
 */
export function resolveMarioHorizontalMovement(entityState, solids, dtSec) {
  let nextX = entityState.x + entityState.vx * dtSec;
  const entityRect = { x: nextX, y: entityState.y, w: entityState.width, h: entityState.height };
  let collided = false;

  for (const solid of solids) {
    if (!marioRectanglesIntersect(entityRect, solid)) continue;
    collided = true;
    if (entityState.vx > 0) {
      nextX = solid.x - entityState.width;
      entityState.vx = 0;
    } else if (entityState.vx < 0) {
      nextX = solid.x + solid.w;
      entityState.vx = 0;
    }
    entityRect.x = nextX;
  }
  entityState.x = nextX;
  return collided;
}

/**
 * Resolve floors and ceilings in place using the game's authored tile order.
 * @param {MarioMovementState} entityState
 * @param {ReadonlyArray<MarioSolid>} solids
 * @param {number} dtSec
 * @returns {void}
 */
export function resolveMarioVerticalMovement(entityState, solids, dtSec) {
  let nextY = entityState.y + entityState.vy * dtSec;
  const entityRect = { x: entityState.x, y: nextY, w: entityState.width, h: entityState.height };
  let grounded = false;

  for (const solid of solids) {
    if (!marioRectanglesIntersect(entityRect, solid)) continue;
    if (entityState.vy > 0) {
      nextY = solid.y - entityState.height;
      entityState.vy = 0;
      grounded = true;
    } else if (entityState.vy < 0) {
      nextY = solid.y + solid.h;
      entityState.vy = 0;
    }
    entityRect.y = nextY;
  }
  entityState.y = nextY;
  entityState.onGround = grounded;
}

/**
 * Simulate one fixed Mario movement step in place for server and prediction.
 * Acceleration and tile collisions are game rules; enemies, hurt/respawn, finish
 * times and ranks stay authoritative. Input and context are read-only. An inactive
 * race brakes without integration and consumes jump state, matching countdowns.
 * @param {MarioMovementState} playerState
 * @param {MarioInputState} inputState
 * @param {number} dtSec
 * @param {MarioMovementContext} [context]
 * @returns {void}
 */
export function stepMarioPlayer(playerState, inputState, dtSec, context = DEFAULT_MOVEMENT_CONTEXT) {
  const jumpPressed = inputState.jump && !playerState.jumpHeld;
  playerState.jumpHeld = Boolean(inputState.jump);
  if (context.active === false) {
    playerState.vx = reduceMarioVelocity(playerState.vx, GROUND_FRICTION * dtSec);
    playerState.vy = 0;
    playerState.onGround = true;
    return;
  }

  let moveDirection = 0;
  if (inputState.left && !inputState.right) moveDirection = -1;
  if (inputState.right && !inputState.left) moveDirection = 1;
  if (moveDirection) {
    const acceleration = playerState.onGround ? inputState.run ? RUN_ACCEL : WALK_ACCEL : AIR_ACCEL;
    playerState.vx += moveDirection * acceleration * dtSec;
    playerState.facing = moveDirection;
  } else {
    playerState.vx = reduceMarioVelocity(playerState.vx,
      (playerState.onGround ? GROUND_FRICTION : AIR_DRAG) * dtSec);
  }
  const maximumSpeed = inputState.run ? MAX_RUN_SPEED : MAX_WALK_SPEED;
  playerState.vx = clampMarioMovement(playerState.vx, -maximumSpeed, maximumSpeed);
  if (jumpPressed && playerState.onGround) {
    playerState.vy = -JUMP_SPEED;
    playerState.onGround = false;
  }
  playerState.vy = clampMarioMovement(playerState.vy + GRAVITY * dtSec, -JUMP_SPEED, MAX_FALL_SPEED);

  const solids = context.solids ?? MARIO_TRACK.solids;
  resolveMarioHorizontalMovement(playerState, solids, dtSec);
  playerState.x = clampMarioMovement(playerState.x, 0, (context.worldWidth ?? MARIO_TRACK.worldWidth) - playerState.width);
  resolveMarioVerticalMovement(playerState, solids, dtSec);
}
