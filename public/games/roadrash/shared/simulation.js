import { createAxisMovementController } from "../../../platform/shared/simulationControllers.js";

/**
 * @typedef {object} RoadRashInputState
 * @property {boolean} left
 * @property {boolean} right
 * @property {boolean} throttle
 * @property {boolean} brake
 * @property {boolean} kickLeft
 * @property {boolean} kickRight
 */

/**
 * Continuous movement is shared; traffic, integrity, kicks and race results stay authoritative.
 * @typedef {object} RoadRashRiderState
 * @property {number} x Lateral road coordinate.
 * @property {number} z Wrapped track coordinate, derived from progress.
 * @property {number} progress Unwrapped race distance; never interpolate wrapped z.
 * @property {number} lapsCompleted
 * @property {number} speed Track units per second.
 * @property {boolean} finished
 */

/**
 * @typedef {object} RoadRashPredictionContext
 * @property {boolean} [active]
 * @property {number} [trackLength]
 * @property {number} [lapsRequired]
 * @property {number} [simulationTick]
 * @property {number} [continuityKey]
 */

export const ROAD_RASH_FIXED_DT_SEC = 1 / 60;

/** @type {Readonly<RoadRashInputState>} */
export const ROAD_RASH_INPUT_TEMPLATE = Object.freeze({
  left: false,
  right: false,
  throttle: false,
  brake: false,
  kickLeft: false,
  kickRight: false,
});

/** @type {ReadonlyArray<keyof RoadRashInputState>} */
export const ROAD_RASH_EDGE_INPUT_KEYS = Object.freeze(["kickLeft", "kickRight"]);

export const ROAD_RASH_MOVEMENT_SETTINGS = Object.freeze({
  TRACK_LENGTH: 120000,
  TARGET_LAPS: 10,
  MAX_SPEED: 28500,
  ACCEL: 16500,
  BRAKE_DECEL: 23000,
  COAST_DECEL: 9000,
  OFFROAD_DECEL: 18000,
  STEER_SPEED_BASE: 0.9,
  STEER_SPEED_GAIN: 1.5,
  MIN_X: -1.2,
  MAX_X: 1.2,
});

const stepRoadRashSteering = createAxisMovementController({
  state: { position: "x" },
  input: { negative: "left", positive: "right" },
  speed: 1,
  min: ROAD_RASH_MOVEMENT_SETTINGS.MIN_X,
  max: ROAD_RASH_MOVEMENT_SETTINGS.MAX_X,
});

/**
 * Convert progress to the renderer's wrapped track coordinate without losing a lap.
 * @param {number} progress
 * @param {number} [trackLength]
 * @param {number} [lapsRequired]
 * @returns {{progress: number, z: number, lapsCompleted: number}}
 */
export function splitRoadRashProgress(
  progress,
  trackLength = ROAD_RASH_MOVEMENT_SETTINGS.TRACK_LENGTH,
  lapsRequired = ROAD_RASH_MOVEMENT_SETTINGS.TARGET_LAPS,
) {
  const boundedProgress = Math.max(0, Math.min(trackLength * lapsRequired, progress));
  const lapsCompleted = Math.min(lapsRequired, Math.floor(boundedProgress / trackLength));
  return {
    progress: boundedProgress,
    z: boundedProgress - lapsCompleted * trackLength,
    lapsCompleted,
  };
}

/**
 * Read a monotonic race coordinate, accepting older snapshots that only contain laps/z.
 * @param {{progress?:number,lapsCompleted?:number,z?:number}} riderState
 * @param {number} [trackLength]
 * @returns {number}
 */
export function readRoadRashProgress(riderState, trackLength = ROAD_RASH_MOVEMENT_SETTINGS.TRACK_LENGTH) {
  return Number.isFinite(riderState.progress)
    ? riderState.progress
    : (riderState.lapsCompleted || 0) * trackLength + (riderState.z || 0);
}

/**
 * Advance an owned rider at the declared command cadence. Mutates movement fields
 * only; input/context remain borrowed and unmodified. Paused or finished riders
 * coast down without changing position. Finish timestamps and winners belong to the server.
 * @param {RoadRashRiderState} riderState
 * @param {RoadRashInputState} inputState
 * @param {number} fixedDtSec
 * @param {RoadRashPredictionContext} [predictionContext]
 * @returns {void}
 */
export function stepRoadRashRider(riderState, inputState, fixedDtSec, predictionContext = {}) {
  const settings = ROAD_RASH_MOVEMENT_SETTINGS;
  const trackLength = predictionContext.trackLength ?? settings.TRACK_LENGTH;
  const lapsRequired = predictionContext.lapsRequired ?? settings.TARGET_LAPS;

  if (predictionContext.active === false || riderState.finished) {
    riderState.speed = Math.max(0, riderState.speed - settings.COAST_DECEL * fixedDtSec);
    return;
  }

  if (inputState.throttle && !inputState.brake) {
    riderState.speed += settings.ACCEL * fixedDtSec;
  } else if (inputState.brake && !inputState.throttle) {
    riderState.speed -= settings.BRAKE_DECEL * fixedDtSec;
  } else {
    riderState.speed -= settings.COAST_DECEL * fixedDtSec;
  }

  const steerSpeed = settings.STEER_SPEED_BASE +
    (riderState.speed / settings.MAX_SPEED) * settings.STEER_SPEED_GAIN;
  stepRoadRashSteering(riderState, inputState, steerSpeed * fixedDtSec);

  if (riderState.x < -1 || riderState.x > 1) {
    riderState.speed -= settings.OFFROAD_DECEL * fixedDtSec;
  }
  riderState.speed = Math.max(0, Math.min(settings.MAX_SPEED, riderState.speed));

  const progress = readRoadRashProgress(riderState, trackLength) + riderState.speed * fixedDtSec;
  Object.assign(riderState, splitRoadRashProgress(progress, trackLength, lapsRequired));
  if (riderState.lapsCompleted >= lapsRequired) {
    riderState.finished = true;
    riderState.speed = 0;
  }
}
