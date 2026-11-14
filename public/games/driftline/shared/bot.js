import { DRIFTLINE_BOT_SETTINGS } from "./config.js";
import { getDriftlineTrackPoint, wrapDriftlineDistance } from "./track.js";

/** @typedef {import("./vehicle.js").DriftlineCar} DriftlineCar */
/** @typedef {import("./track.js").DriftlineTrack} DriftlineTrack */
/** @typedef {import("./config.js").DriftlineInputState} DriftlineInputState */
/**
 * Server-private driver memory. The input object is owned by the brain and
 * reused every step; callers must not retain it.
 * @typedef {object} DriftlineBotBrain
 * @property {number} seed 32-bit PRNG state.
 * @property {number} pace Fraction of the computed corner speed this driver dares, around one.
 * @property {number} lineBias Lateral preference in metres, so bots spread across the road.
 * @property {number} handbrakeSec Remaining handbrake flick.
 * @property {number} stuckSec Time spent nearly stopped.
 * @property {number} launchTicks Countdown tick at which this bot starts revving.
 * @property {DriftlineInputState} input
 */

const BRAKING_DECEL = 9;
const SPEED_PLAN_HORIZON_M = 90;
const SPEED_PLAN_STEP_M = 6;
const STUCK_SPEED = 2;
const STUCK_RECOVER_SEC = 2.5;
const HANDBRAKE_FLICK_SEC = 0.12;
const MAX_STRAIGHT_SPEED = 60;

/**
 * Mulberry32 step; identical on every JavaScript engine.
 * @param {DriftlineBotBrain} brain
 * @returns {number} In [0, 1).
 */
function nextDriftlineBotRandom(brain) {
  brain.seed = (brain.seed + 0x6d2b79f5) >>> 0;
  let mixed = brain.seed;
  mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
  mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
  return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
}

/**
 * Create a deterministic driver with its own pace and preferred line.
 * @param {number} seed
 * @returns {DriftlineBotBrain}
 */
export function createDriftlineBotBrain(seed) {
  const brain = {
    seed: (Math.imul(seed | 0, 2654435761) ^ 0x85ebca6b) >>> 0,
    pace: 1,
    lineBias: 0,
    handbrakeSec: 0,
    stuckSec: 0,
    launchTicks: 0,
    input: { steer: 0, throttle: 0, brake: 0, handbrake: false, recover: false },
  };
  brain.pace = DRIFTLINE_BOT_SETTINGS.cornerSpeedScale * (1 - DRIFTLINE_BOT_SETTINGS.skillSpread * nextDriftlineBotRandom(brain));
  brain.lineBias = (nextDriftlineBotRandom(brain) - 0.5) * 3;
  brain.launchTicks = 10 + Math.floor(nextDriftlineBotRandom(brain) * 60);
  return brain;
}

/**
 * Highest speed that still makes every corner in the planning horizon at
 * the bot's braking rate.
 * @param {Readonly<DriftlineTrack>} track
 * @param {number} along
 * @param {number} pace
 */
function planDriftlineBotSpeed(track, along, pace) {
  let allowed = MAX_STRAIGHT_SPEED;
  for (let distance = 0; distance <= SPEED_PLAN_HORIZON_M; distance += SPEED_PLAN_STEP_M) {
    const index = Math.floor(wrapDriftlineDistance(track, along + distance) / track.spacingM) % track.sampleCount;
    const curvature = Math.max(1e-4, Math.abs(track.curvature[index]));
    const cornerSpeed = Math.sqrt((DRIFTLINE_BOT_SETTINGS.cornerGripAccel * track.surfaceGrip) / curvature) * pace;
    allowed = Math.min(allowed, Math.sqrt(cornerSpeed * cornerSpeed + 2 * BRAKING_DECEL * distance));
  }
  return allowed;
}

/**
 * Pure-pursuit driving along an apex-seeking line with corner speed planning
 * and occasional handbrake flicks into tight bends. Mutates only the brain.
 * @param {Readonly<DriftlineCar>} car
 * @param {DriftlineBotBrain} brain
 * @param {Readonly<DriftlineTrack>} track
 * @param {number} dtSec
 * @returns {Readonly<DriftlineInputState>} The brain-owned input, valid until the next call.
 */
export function decideDriftlineBotInput(car, brain, track, dtSec) {
  const input = brain.input;
  input.recover = false;
  const speed = Math.hypot(car.vx, car.vz);
  brain.stuckSec = speed < STUCK_SPEED ? brain.stuckSec + dtSec : 0;
  if (brain.stuckSec > STUCK_RECOVER_SEC && car.recoverCooldownSec <= 0 && !car.finished) {
    brain.stuckSec = 0;
    input.recover = true;
  }

  const lookahead = DRIFTLINE_BOT_SETTINGS.lookaheadBaseM + DRIFTLINE_BOT_SETTINGS.lookaheadPerSpeed * speed;
  const aheadIndex = Math.floor(wrapDriftlineDistance(track, car.along + lookahead * 1.6) / track.spacingM) % track.sampleCount;
  const bend = track.curvature[aheadIndex];
  const halfWidth = track.halfWidth[aheadIndex];
  const apexOffset = Math.sign(bend) * Math.min(halfWidth - 2, Math.abs(bend) * DRIFTLINE_BOT_SETTINGS.apexPull);
  const lineOffset = Math.max(-(halfWidth - 1.5), Math.min(halfWidth - 1.5, apexOffset + brain.lineBias));
  const target = getDriftlineTrackPoint(track, car.along + lookahead, lineOffset);
  const offsetX = target.x - car.x;
  const offsetZ = target.z - car.z;
  const forwardOffset = offsetX * Math.sin(car.yaw) + offsetZ * Math.cos(car.yaw);
  const sideOffset = offsetX * Math.cos(car.yaw) - offsetZ * Math.sin(car.yaw);
  const headingError = Math.atan2(sideOffset, Math.max(0.5, forwardOffset));
  input.steer = Math.max(-1, Math.min(1, -DRIFTLINE_BOT_SETTINGS.steerGain * headingError));

  const targetSpeed = planDriftlineBotSpeed(track, car.along, brain.pace);
  const overSpeed = speed - targetSpeed;
  input.throttle = overSpeed < -1 ? 1 : overSpeed < 1 ? 0.5 : 0;
  input.brake = overSpeed > DRIFTLINE_BOT_SETTINGS.brakeMarginMps ? Math.min(1, overSpeed / 6) : 0;
  if (Math.abs(car.driftAngle) > 0.7) input.throttle *= 0.5;

  brain.handbrakeSec = Math.max(0, brain.handbrakeSec - dtSec);
  const tightBend = Math.abs(bend) > DRIFTLINE_BOT_SETTINGS.driftCurvature;
  if (brain.handbrakeSec <= 0 && tightBend && speed > DRIFTLINE_BOT_SETTINGS.driftMinSpeed && !car.drifting &&
      nextDriftlineBotRandom(brain) < 0.04) {
    brain.handbrakeSec = HANDBRAKE_FLICK_SEC;
  }
  input.handbrake = brain.handbrakeSec > 0;
  return input;
}

/**
 * During the countdown each bot revs from its own randomized tick, so bots
 * earn a mix of perfect, good and bogged launches.
 * @param {DriftlineBotBrain} brain
 * @param {number} ticksUntilStart Fixed steps left before the start.
 * @returns {number} Throttle for this countdown step.
 */
export function decideDriftlineBotLaunchThrottle(brain, ticksUntilStart) {
  return ticksUntilStart <= brain.launchTicks ? 1 : 0;
}
