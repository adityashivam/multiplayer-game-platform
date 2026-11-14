import { createKinematicCharacterController } from "../../../platform/shared/kinematicCharacter.js";
import { LAST_FUSE_BOMB_SETTINGS, LAST_FUSE_CHARACTER_SETTINGS, LAST_FUSE_CITY } from "./config.js";

/** @typedef {import("./config.js").LastFuseAction} LastFuseAction */
/** @typedef {import("./config.js").LastFuseInputState} LastFuseInputState */
/** @typedef {import("./city.js").LastFusePlatform} LastFusePlatform */
/**
 * Game-owned runner body and status. Y is the feet position; facing zero
 * points along +Z. SDK queues, rejoin tokens and bot brains live elsewhere.
 * @typedef {object} LastFuseRunner
 * @property {string} id Human slot ID or bot ID; unique within a match.
 * @property {number} slotIndex Spawn and colour order.
 * @property {number} colorIndex
 * @property {boolean} isBot
 * @property {boolean} connected Bots are always connected.
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} vx
 * @property {number} vy
 * @property {number} vz
 * @property {number} facing
 * @property {boolean} grounded
 * @property {number} supportId Roof ID underfoot, or zero.
 * @property {number} coyoteSec
 * @property {number} jumpBufferSec
 * @property {boolean} jumpHeld
 * @property {boolean} dashHeld
 * @property {number} dashCooldownSec
 * @property {number} dashRemainingSec
 * @property {number} staggerSec Slowed after receiving the bomb.
 * @property {number} stunSec No control after a blast; momentum carries.
 * @property {LastFuseAction} action
 * @property {number} actionId Stable animation identity.
 * @property {number} actionTimeSec
 * @property {boolean} fallen Dropped to the street and waiting to respawn.
 * @property {number} respawnSec
 * @property {number} respawnId Increments on every teleport; an interpolation identity.
 * @property {boolean} eliminated Caught by a blast this round.
 * @property {number} points
 * @property {number} roundWins
 * @property {number} passes Bomb passes this match.
 * @property {number} viewLagTicks Last reported view lag; server use only.
 */
/** @typedef {{active:boolean,platforms:ReadonlyArray<Readonly<LastFusePlatform>>,holder:boolean}} LastFuseRunnerStepContext */

const MAX_PURE_STEP_SEC = 0.05;
const MIN_INTENT = 0.1;
const LOWEST_FALL_Y = -10;
/** Blast momentum bleeds off once a stunned runner lands. */
const STUN_FRICTION_PER_SEC = 5;
const characterController = createKinematicCharacterController(LAST_FUSE_CHARACTER_SETTINGS);
/** Owned per call; the simulation is single-threaded and never re-enters. */
const movementIntent = { x: 0, z: 0, jump: false };

/** @param {number} value @param {number} minimum @param {number} maximum */
function clampLastFuseNumber(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

/** @param {unknown} value @returns {number} A finite axis in [-1, 1]; zero otherwise. */
export function readLastFuseAxis(value) {
  return typeof value === "number" && Number.isFinite(value) ? clampLastFuseNumber(value, -1, 1) : 0;
}

/**
 * Bound one pure step: long durations clamp, invalid ones do nothing.
 * @param {number} dtSec
 * @returns {number}
 */
export function getLastFuseStepDuration(dtSec) {
  return Number.isFinite(dtSec) ? clampLastFuseNumber(dtSec, 0, MAX_PURE_STEP_SEC) : 0;
}

/**
 * @param {string} id
 * @param {number} slotIndex
 * @param {boolean} [isBot]
 * @returns {LastFuseRunner}
 */
export function createLastFuseRunner(id, slotIndex, isBot = false) {
  return {
    id,
    slotIndex,
    colorIndex: slotIndex,
    isBot,
    connected: isBot,
    x: 0,
    y: LAST_FUSE_CITY.baseRoofHeight,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    facing: 0,
    grounded: true,
    supportId: 0,
    coyoteSec: 0,
    jumpBufferSec: 0,
    jumpHeld: false,
    dashHeld: false,
    dashCooldownSec: 0,
    dashRemainingSec: 0,
    staggerSec: 0,
    stunSec: 0,
    action: "idle",
    actionId: 0,
    actionTimeSec: 0,
    fallen: false,
    respawnSec: 0,
    respawnId: 0,
    eliminated: false,
    points: 0,
    roundWins: 0,
    passes: 0,
    viewLagTicks: 0,
  };
}

/**
 * Begin an action and advance its identity unless it is already running.
 * @param {LastFuseRunner} runner
 * @param {LastFuseAction} action
 * @param {boolean} [restart]
 */
export function beginLastFuseAction(runner, action, restart = false) {
  if (runner.action === action && !restart) return;
  runner.action = action;
  runner.actionId += 1;
  runner.actionTimeSec = 0;
}

/**
 * Teleport onto a roof, facing the city centre. Clears motion and timers but
 * keeps points and round wins.
 * @param {LastFuseRunner} runner
 * @param {{x:number,z:number,topY:number,id:number}} roof
 */
export function placeLastFuseRunner(runner, roof) {
  runner.x = roof.x;
  runner.y = roof.topY;
  runner.z = roof.z;
  runner.vx = 0;
  runner.vy = 0;
  runner.vz = 0;
  runner.facing = Math.atan2(-roof.x, -roof.z || 1e-6);
  runner.grounded = true;
  runner.supportId = roof.id;
  runner.coyoteSec = 0;
  runner.jumpBufferSec = 0;
  runner.dashRemainingSec = 0;
  runner.staggerSec = 0;
  runner.stunSec = 0;
  runner.fallen = false;
  runner.respawnSec = 0;
  runner.respawnId += 1;
  beginLastFuseAction(runner, "idle", true);
}

/**
 * Cancel held edges and in-progress dashes on ownership changes, without
 * touching pose, points or round state. Velocity freezes so a paused runner
 * cannot drift while awaiting a rejoin.
 * @param {LastFuseRunner} runner
 */
export function resetLastFuseRunnerControls(runner) {
  runner.jumpHeld = false;
  runner.dashHeld = false;
  runner.jumpBufferSec = 0;
  runner.dashRemainingSec = 0;
  runner.vx = 0;
  runner.vz = 0;
  if (runner.grounded) runner.vy = 0;
}

/** @param {LastFuseRunner} runner @param {boolean} holder @returns {number} */
function getLastFuseSpeedScale(runner, holder) {
  let scale = holder ? LAST_FUSE_BOMB_SETTINGS.holderSpeedScale : 1;
  if (runner.staggerSec > 0) scale *= LAST_FUSE_BOMB_SETTINGS.staggerSpeedScale;
  return scale;
}

/**
 * Start a dash along the movement intent, or along facing with no intent.
 * @param {LastFuseRunner} runner
 * @param {number} moveX
 * @param {number} moveZ
 * @param {boolean} holder
 */
function startLastFuseDash(runner, moveX, moveZ, holder) {
  const length = Math.hypot(moveX, moveZ);
  const directionX = length > MIN_INTENT ? moveX / length : Math.sin(runner.facing);
  const directionZ = length > MIN_INTENT ? moveZ / length : Math.cos(runner.facing);
  const speed = LAST_FUSE_CHARACTER_SETTINGS.moveSpeed * LAST_FUSE_BOMB_SETTINGS.dashSpeedScale * getLastFuseSpeedScale(runner, holder);
  runner.vx = directionX * speed;
  runner.vz = directionZ * speed;
  runner.facing = Math.atan2(directionX, directionZ);
  runner.dashCooldownSec = LAST_FUSE_BOMB_SETTINGS.dashCooldownSec;
  runner.dashRemainingSec = LAST_FUSE_BOMB_SETTINGS.dashDurationSec;
  beginLastFuseAction(runner, "dash", true);
}

/** @param {LastFuseRunner} runner */
function chooseLastFuseMovementAction(runner) {
  if (runner.stunSec > 0) beginLastFuseAction(runner, "stagger");
  else if (runner.dashRemainingSec > 0) beginLastFuseAction(runner, "dash");
  else if (!runner.grounded) beginLastFuseAction(runner, runner.vy > 0 ? "jump" : "fall");
  else if (runner.staggerSec > 0) beginLastFuseAction(runner, "stagger");
  else beginLastFuseAction(runner, Math.hypot(runner.vx, runner.vz) > 0.4 ? "run" : "idle");
}

/**
 * Shared runner movement: run, jump, dash, stagger and blast stun. Mutates
 * only this runner; the world owns passes, blasts, falls and rounds.
 * Inactive or zero-length steps consume no edges or timers.
 * @param {LastFuseRunner} runner
 * @param {Readonly<LastFuseInputState>} input
 * @param {number} dtSec
 * @param {LastFuseRunnerStepContext} context
 */
export function stepLastFuseRunner(runner, input, dtSec, { active, platforms, holder }) {
  if (!active || runner.eliminated || runner.fallen) return;
  const stepSec = getLastFuseStepDuration(dtSec);
  if (stepSec <= 0) return;

  runner.actionTimeSec += stepSec;
  runner.dashCooldownSec = Math.max(0, runner.dashCooldownSec - stepSec);
  runner.dashRemainingSec = Math.max(0, runner.dashRemainingSec - stepSec);
  runner.staggerSec = Math.max(0, runner.staggerSec - stepSec);
  runner.stunSec = Math.max(0, runner.stunSec - stepSec);

  const moveX = readLastFuseAxis(input.moveX);
  const moveZ = readLastFuseAxis(input.moveZ);
  const dashPressed = Boolean(input.dash) && !runner.dashHeld;
  runner.dashHeld = Boolean(input.dash);
  const stunned = runner.stunSec > 0;
  if (!stunned && dashPressed && runner.dashCooldownSec <= 0) startLastFuseDash(runner, moveX, moveZ, holder);
  if (!stunned && runner.dashRemainingSec <= 0 && Math.hypot(moveX, moveZ) > MIN_INTENT) runner.facing = Math.atan2(moveX, moveZ);

  if (stunned && runner.grounded) {
    const retained = 1 - Math.min(1, STUN_FRICTION_PER_SEC * stepSec);
    runner.vx *= retained;
    runner.vz *= retained;
  }
  movementIntent.x = stunned ? 0 : moveX;
  movementIntent.z = stunned ? 0 : moveZ;
  movementIntent.jump = !stunned && Boolean(input.jump);
  characterController.step(runner, movementIntent, stepSec, {
    platforms,
    controlScale: stunned || runner.dashRemainingSec > 0 ? 0 : 1,
    speedScale: getLastFuseSpeedScale(runner, holder),
  });
  chooseLastFuseMovementAction(runner);
}

/**
 * Ballistic drop for runners who fell or were blown out; bounded below.
 * @param {LastFuseRunner} runner
 * @param {number} stepSec
 */
export function stepLastFuseFallingRunner(runner, stepSec) {
  runner.actionTimeSec += stepSec;
  if (runner.y <= LOWEST_FALL_Y) return;
  runner.vy -= LAST_FUSE_CHARACTER_SETTINGS.gravity * stepSec;
  runner.x += runner.vx * stepSec;
  runner.y = Math.max(LOWEST_FALL_Y, runner.y + runner.vy * stepSec);
  runner.z += runner.vz * stepSec;
}
