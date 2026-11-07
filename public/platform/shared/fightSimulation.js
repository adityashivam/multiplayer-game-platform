import { NETWORK_TIMING } from "./networkProtocol.js";

/** @typedef {"p1" | "p2"} FightPlayerId */
/** @typedef {"light" | "heavy" | "aerial"} FightAttackType */

/**
 * Supported Fight controls for one command or held input state.
 * @typedef {object} FightInputState
 * @property {boolean} left
 * @property {boolean} right
 * @property {boolean} jump
 * @property {boolean} attack
 * @property {boolean} heavyAttack
 * @property {boolean} aerialAttack
 */

/**
 * Simulation fields shared by authoritative and predicted Fight players.
 * Callers may own additional combat, connection, or rendering fields.
 * @typedef {object} FightPlayerState
 * @property {number} x
 * @property {number} y
 * @property {number} vx
 * @property {number} vy
 * @property {1 | -1} dir
 * @property {boolean} attacking
 * @property {FightAttackType | null} [attackType]
 * @property {number} attackTimer Remaining attack duration in seconds.
 * @property {number} cooldownTimer Remaining attack lockout in seconds.
 * @property {boolean} [hasHitThisSwing]
 * @property {boolean} dead
 */

/**
 * @typedef {object} FightAttackDefinition
 * @property {number} damage
 * @property {number} range
 * @property {number} cooldown Cooldown after the attack duration, in seconds.
 * @property {number} duration Attack duration in seconds.
 */

export const FIGHT_FIXED_DT_SEC = NETWORK_TIMING.FIXED_DT_SEC;

/** @type {Readonly<FightInputState>} */
export const FIGHT_INPUT_TEMPLATE = Object.freeze({
  left: false,
  right: false,
  jump: false,
  attack: false,
  heavyAttack: false,
  aerialAttack: false,
});

export const FIGHT_MOVEMENT = Object.freeze({
  GROUND_Y: 870,
  MOVE_SPEED: 500,
  ATTACK_MOVE_SPEED: 150,
  JUMP_SPEED: -1300,
  GRAVITY: 1600,
  MIN_X: 100,
  MAX_X: 1180,
  MIN_HORIZONTAL_SEPARATION: 120,
  VERTICAL_SEPARATION_LIMIT: 100,
  JUMP_GROUND_TOLERANCE: 1,
  AERIAL_ATTACK_GROUND_OFFSET: 5,
});

/** @type {Record<FightAttackType, FightAttackDefinition>} */
export const FIGHT_ATTACK_DEFINITIONS = {
  light: { damage: 30, range: 200, cooldown: 0.3, duration: 0.2 },
  heavy: { damage: 75, range: 280, cooldown: 0.8, duration: 0.4 },
  aerial: { damage: 50, range: 220, cooldown: 0.5, duration: 0.25 },
};

/**
 * Apply movement intent before starting this step's attack.
 * @param {FightPlayerState} playerState Mutated in place.
 * @param {FightInputState} inputState
 */
function applyFightMovementIntent(playerState, inputState) {
  const moveSpeed = playerState.attacking
    ? FIGHT_MOVEMENT.ATTACK_MOVE_SPEED
    : FIGHT_MOVEMENT.MOVE_SPEED;

  if (inputState.left && !inputState.right) {
    playerState.vx = -moveSpeed;
    if (!playerState.attacking) {
      playerState.dir = -1;
    }
  } else if (inputState.right && !inputState.left) {
    playerState.vx = moveSpeed;
    if (!playerState.attacking) {
      playerState.dir = 1;
    }
  } else {
    playerState.vx = 0;
  }

  if (inputState.jump && playerState.y >= FIGHT_MOVEMENT.GROUND_Y - FIGHT_MOVEMENT.JUMP_GROUND_TOLERANCE) {
    playerState.vy = FIGHT_MOVEMENT.JUMP_SPEED;
  }
}

/**
 * Preserve aerial, heavy, then light attack priority when controls overlap.
 * @param {FightPlayerState} playerState
 * @param {FightInputState} inputState
 * @returns {FightAttackType | null}
 */
function selectFightAttackType(playerState, inputState) {
  if (
    inputState.aerialAttack ||
    (inputState.attack && playerState.y < FIGHT_MOVEMENT.GROUND_Y - FIGHT_MOVEMENT.AERIAL_ATTACK_GROUND_OFFSET)
  ) {
    return "aerial";
  }
  if (inputState.heavyAttack) {
    return "heavy";
  }
  if (inputState.attack) {
    return "light";
  }
  return null;
}

/**
 * Start an available attack, then advance its timers in the same step.
 * @param {FightPlayerState} playerState Mutated in place.
 * @param {FightInputState} inputState
 * @param {number} dtSec
 */
function advanceFightAttackState(playerState, inputState, dtSec) {
  if (!playerState.attacking && !(playerState.cooldownTimer > 0)) {
    const attackType = selectFightAttackType(playerState, inputState);
    if (attackType) {
      const attackDefinition = FIGHT_ATTACK_DEFINITIONS[attackType];
      playerState.attacking = true;
      playerState.attackType = attackType;
      playerState.attackTimer = attackDefinition.duration;
      playerState.cooldownTimer = attackDefinition.duration + attackDefinition.cooldown;
      playerState.hasHitThisSwing = false;
    }
  }

  if (playerState.attacking) {
    playerState.attackTimer -= dtSec;
    if (playerState.attackTimer <= 0) {
      playerState.attacking = false;
      playerState.attackType = null;
      playerState.attackTimer = 0;
    }
  }
  if (playerState.cooldownTimer > 0) {
    playerState.cooldownTimer -= dtSec;
  }
}

/**
 * Advance one player's shared movement and attack timers without resolving damage.
 * The supplied player is mutated and returned; the input state is only read.
 * @template {FightPlayerState} PlayerState
 * @param {PlayerState} playerState
 * @param {FightInputState} inputState
 * @param {number} dtSec Simulation duration in seconds.
 * @param {{active?: boolean}} [options]
 * @returns {PlayerState}
 */
export function stepFightPlayer(playerState, inputState, dtSec, { active } = {}) {
  if (playerState.dead) {
    playerState.vx = 0;
    return playerState;
  }

  if (!active) {
    playerState.vx = 0;
    playerState.vy = 0;
    playerState.attacking = false;
    playerState.attackType = null;
    playerState.attackTimer = 0;
    if (playerState.y > FIGHT_MOVEMENT.GROUND_Y) {
      playerState.y = FIGHT_MOVEMENT.GROUND_Y;
    }
    return playerState;
  }

  applyFightMovementIntent(playerState, inputState);
  advanceFightAttackState(playerState, inputState, dtSec);

  playerState.vy += FIGHT_MOVEMENT.GRAVITY * dtSec;
  playerState.y += playerState.vy * dtSec;
  if (playerState.y > FIGHT_MOVEMENT.GROUND_Y) {
    playerState.y = FIGHT_MOVEMENT.GROUND_Y;
    playerState.vy = 0;
  }
  playerState.x = Math.max(
    FIGHT_MOVEMENT.MIN_X,
    Math.min(FIGHT_MOVEMENT.MAX_X, playerState.x + playerState.vx * dtSec),
  );
  return playerState;
}

/**
 * Separate touching players and clamp both positions to the arena in place.
 * @param {FightPlayerState} p1
 * @param {FightPlayerState} p2
 * @returns {void}
 */
export function resolveFightSeparation(p1, p2) {
  const horizontalDistance = p1.x - p2.x;
  if (
    Math.abs(horizontalDistance) < FIGHT_MOVEMENT.MIN_HORIZONTAL_SEPARATION &&
    Math.abs(p1.y - p2.y) < FIGHT_MOVEMENT.VERTICAL_SEPARATION_LIMIT
  ) {
    const pushDistance = (FIGHT_MOVEMENT.MIN_HORIZONTAL_SEPARATION - Math.abs(horizontalDistance)) / 2;
    const pushDirection = horizontalDistance === 0 ? 1 : Math.sign(horizontalDistance);
    p1.x += pushDistance * pushDirection;
    p2.x -= pushDistance * pushDirection;
    p1.vx = 0;
    p2.vx = 0;
  }

  p1.x = Math.max(FIGHT_MOVEMENT.MIN_X, Math.min(FIGHT_MOVEMENT.MAX_X, p1.x));
  p2.x = Math.max(FIGHT_MOVEMENT.MIN_X, Math.min(FIGHT_MOVEMENT.MAX_X, p2.x));
}
