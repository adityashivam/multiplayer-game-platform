import { NETWORK_TIMING } from "../../../platform/shared/networkProtocol.js";
import {
  createHorizontalSeparationController,
  createSideViewCharacterController,
  createTimedActionController,
} from "../../../platform/shared/simulationControllers.js";

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

/** @type {import("../../../platform/shared/simulationControllers.js").TimedActionController<FightPlayerState, FightInputState, FightAttackType>} */
const fightActions = createTimedActionController({
  state: {
    active: "attacking",
    kind: "attackType",
    remainingSec: "attackTimer",
    cooldownSec: "cooldownTimer",
  },
  definitions: FIGHT_ATTACK_DEFINITIONS,
  bindings: [
    {
      inputKey: "aerialAttack",
      actionId: "aerial",
      when: (playerState, inputState) => inputState.aerialAttack ||
        (inputState.attack && playerState.y < FIGHT_MOVEMENT.GROUND_Y - FIGHT_MOVEMENT.AERIAL_ATTACK_GROUND_OFFSET),
    },
    { inputKey: "heavyAttack", actionId: "heavy" },
    { inputKey: "attack", actionId: "light" },
  ],
  onStart: (playerState) => {
    playerState.hasHitThisSwing = false;
  },
});

const stepFightCharacter = createSideViewCharacterController({
  state: { x: "x", y: "y", vx: "vx", vy: "vy", facing: "dir", disabled: "dead" },
  input: { negative: "left", positive: "right", jump: "jump" },
  movement: {
    speed: FIGHT_MOVEMENT.MOVE_SPEED,
    busySpeed: FIGHT_MOVEMENT.ATTACK_MOVE_SPEED,
    jumpSpeed: FIGHT_MOVEMENT.JUMP_SPEED,
    gravity: FIGHT_MOVEMENT.GRAVITY,
    floorY: FIGHT_MOVEMENT.GROUND_Y,
    minX: FIGHT_MOVEMENT.MIN_X,
    maxX: FIGHT_MOVEMENT.MAX_X,
    groundTolerance: FIGHT_MOVEMENT.JUMP_GROUND_TOLERANCE,
  },
  actions: fightActions,
});

const separateFightPlayers = createHorizontalSeparationController({
  state: { x: "x", y: "y", vx: "vx" },
  minX: FIGHT_MOVEMENT.MIN_X,
  maxX: FIGHT_MOVEMENT.MAX_X,
  minDistance: FIGHT_MOVEMENT.MIN_HORIZONTAL_SEPARATION,
  verticalLimit: FIGHT_MOVEMENT.VERTICAL_SEPARATION_LIMIT,
});
const FIGHT_INACTIVE_STEP = Object.freeze({ active: false });

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
  return stepFightCharacter(playerState, inputState, dtSec, active ? undefined : FIGHT_INACTIVE_STEP);
}

/**
 * Separate touching players and clamp both positions to the arena in place.
 * @param {FightPlayerState} p1
 * @param {FightPlayerState} p2
 * @returns {void}
 */
export function resolveFightSeparation(p1, p2) {
  separateFightPlayers(p1, p2);
}
