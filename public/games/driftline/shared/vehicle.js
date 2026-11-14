import { DRIFTLINE_CAR_SETTINGS, DRIFTLINE_RACE_SETTINGS, DRIFTLINE_SKILL_SETTINGS } from "./config.js";
import { createDriftlineTrackPosition, getDriftlineTrackPoint, getDriftlineTravel, locateOnDriftlineTrack } from "./track.js";

/** @typedef {import("./config.js").DriftlineInputState} DriftlineInputState */
/** @typedef {import("./config.js").DriftlineLaunch} DriftlineLaunch */
/** @typedef {import("./track.js").DriftlineTrack} DriftlineTrack */
/**
 * Game-owned car state. Yaw zero faces +Z; forward is (sin yaw, cos yaw) and
 * the +yaw side is (cos yaw, -sin yaw). Every field exists before the first
 * snapshot; SDK queues, tokens and bot brains live outside this shape.
 * @typedef {object} DriftlineCar
 * @property {string} id
 * @property {number} slotIndex Grid order.
 * @property {number} colorIndex
 * @property {boolean} isBot
 * @property {boolean} connected Bots are always connected.
 * @property {number} x
 * @property {number} y Road height under the car.
 * @property {number} z
 * @property {number} yaw
 * @property {number} vx
 * @property {number} vz
 * @property {number} yawRate
 * @property {number} steer Smoothed steering, +1 right.
 * @property {number} throttle Last applied pedal, for lights and audio.
 * @property {number} brake
 * @property {boolean} handbrake
 * @property {boolean} recoverHeld
 * @property {number} longAccel Low-passed longitudinal acceleration for weight transfer.
 * @property {number} bodySlip Body slip angle at the previous physics substep.
 * @property {number} slope Road gradient along the direction of travel.
 * @property {boolean} onRunoff
 * @property {number} trackIndex Nearest track sample; a search hint.
 * @property {number} along Arc length on the lap.
 * @property {number} lateral Offset from the centre line.
 * @property {number} progress Unwrapped race distance; negative on the grid.
 * @property {boolean} drifting
 * @property {number} driftAngle Signed body slip angle in radians.
 * @property {number} driftSec Duration of the current drift.
 * @property {number} driftExitSec
 * @property {number} driftCharge Boost charge in tier units.
 * @property {number} spinSec Remaining spin-out recovery.
 * @property {number} boostSec
 * @property {number} boostTier Tier of the active or last boost.
 * @property {number} boostSerial Increments on every boost, for effects.
 * @property {number} slipstream Draft strength from zero to one; set by the race.
 * @property {number} wallHitSerial
 * @property {number} wallHitSpeed
 * @property {DriftlineLaunch} launch
 * @property {number} launchHoldTicks Fixed steps the throttle was held before the start.
 * @property {number} bogSec
 * @property {number} lap Completed laps.
 * @property {number} lapStartSec
 * @property {number} lastLapSec
 * @property {number} bestLapSec Zero until a lap completes.
 * @property {boolean} finished
 * @property {number} finishTimeSec
 * @property {number} position One-based race position.
 * @property {number} respawnId Changes on every recovery teleport.
 * @property {number} recoverCooldownSec
 */
/** @typedef {{track:Readonly<DriftlineTrack>,active:boolean}} DriftlineCarStepContext */

const MAX_PURE_STEP_SEC = 0.05;
const MIN_SLIP_SPEED = 2.5;
const MIN_LOAD_SHARE = 0.15;
const WALL_IMPACT_EVENT_SPEED = 2;
const RECOVER_BACKTRACK_M = 6;
const trackPosition = createDriftlineTrackPosition();
/** Finished cars ignore their driver and roll to a stop past the line. */
const FINISHED_COAST_INPUT = Object.freeze({ steer: 0, throttle: 0, brake: 0.25, handbrake: false, recover: false });

/** @param {number} value @param {number} minimum @param {number} maximum */
function clampDriftline(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

/** @param {unknown} value @param {number} minimum @param {number} maximum */
function readDriftlineAxis(value, minimum, maximum) {
  return typeof value === "number" && Number.isFinite(value) ? clampDriftline(value, minimum, maximum) : 0;
}

/** @param {number} dtSec @returns {number} */
export function getDriftlineStepDuration(dtSec) {
  return Number.isFinite(dtSec) ? clampDriftline(dtSec, 0, MAX_PURE_STEP_SEC) : 0;
}

/**
 * Normalized Pacejka-style lateral curve: linear near zero, peaking near 15
 * degrees and easing off beyond, so slides stay controllable.
 * @param {number} slipRad
 */
function getDriftlineTireForce(slipRad) {
  return Math.sin(DRIFTLINE_CAR_SETTINGS.tireShape * Math.atan(DRIFTLINE_CAR_SETTINGS.tireStiffness * slipRad));
}

/**
 * Create a car parked on the grid behind the start line.
 * @param {Readonly<DriftlineTrack>} track
 * @param {string} id
 * @param {number} slotIndex
 * @param {boolean} [isBot]
 * @returns {DriftlineCar}
 */
export function createDriftlineCar(track, id, slotIndex, isBot = false) {
  const row = Math.floor(slotIndex / 2);
  const along = -(DRIFTLINE_RACE_SETTINGS.gridFirstRowM + row * DRIFTLINE_RACE_SETTINGS.gridRowSpacingM);
  const lateral = (slotIndex % 2 === 0 ? 1 : -1) * DRIFTLINE_RACE_SETTINGS.gridLaneOffsetM;
  const gridPoint = getDriftlineTrackPoint(track, along, lateral);
  return {
    id,
    slotIndex,
    colorIndex: slotIndex,
    isBot,
    connected: isBot,
    x: gridPoint.x,
    y: gridPoint.y,
    z: gridPoint.z,
    yaw: gridPoint.yaw,
    vx: 0,
    vz: 0,
    yawRate: 0,
    steer: 0,
    throttle: 0,
    brake: 0,
    handbrake: false,
    recoverHeld: false,
    longAccel: 0,
    bodySlip: 0,
    slope: 0,
    onRunoff: false,
    trackIndex: gridPoint.index,
    along: track.lengthM + along,
    lateral,
    progress: along,
    drifting: false,
    driftAngle: 0,
    driftSec: 0,
    driftExitSec: 0,
    driftCharge: 0,
    spinSec: 0,
    boostSec: 0,
    boostTier: 0,
    boostSerial: 0,
    slipstream: 0,
    wallHitSerial: 0,
    wallHitSpeed: 0,
    launch: "none",
    launchHoldTicks: 0,
    bogSec: 0,
    lap: 0,
    lapStartSec: 0,
    lastLapSec: 0,
    bestLapSec: 0,
    finished: false,
    finishTimeSec: 0,
    position: slotIndex + 1,
    respawnId: 0,
    recoverCooldownSec: 0,
  };
}

/**
 * Integrate one physics substep of the bicycle model. World-space velocity
 * integration needs no rotating-frame terms.
 * @param {DriftlineCar} car
 * @param {number} throttle
 * @param {number} brake
 * @param {boolean} handbrake
 * @param {number} grip Surface multiplier.
 * @param {number} stepSec
 */
function integrateDriftlineCar(car, throttle, brake, handbrake, grip, stepSec) {
  const settings = DRIFTLINE_CAR_SETTINGS;
  const mass = settings.massKg;
  const gravity = settings.gravity;
  const frontArm = settings.frontAxleM;
  const rearArm = settings.rearAxleM;
  const wheelbase = frontArm + rearArm;
  const forwardX = Math.sin(car.yaw);
  const forwardZ = Math.cos(car.yaw);
  const sideX = Math.cos(car.yaw);
  const sideZ = -Math.sin(car.yaw);
  const forwardSpeed = car.vx * forwardX + car.vz * forwardZ;
  const sideSpeed = car.vx * sideX + car.vz * sideZ;
  const absForward = Math.abs(forwardSpeed);
  const direction = forwardSpeed >= 0 ? 1 : -1;
  const slipSpeed = Math.max(absForward, MIN_SLIP_SPEED);

  const bodySlip = Math.atan2(sideSpeed, slipSpeed);
  const speedSteerLimit = settings.maxSteerRad + (settings.highSpeedSteerRad - settings.maxSteerRad) * clampDriftline(absForward / settings.steerFadeSpeed, 0, 1);
  const requestedWheel = -car.steer;
  const sliding = Math.abs(bodySlip) > DRIFTLINE_SKILL_SETTINGS.driftMinAngleRad;
  const steeringIntoSlide = sliding && requestedWheel * bodySlip < 0;
  const steerLimit = steeringIntoSlide ? speedSteerLimit * settings.driftSteerScale : speedSteerLimit;
  const assist = forwardSpeed > 1 ? settings.counterSteerAssist * bodySlip : 0;
  const wheelAngle = clampDriftline(requestedWheel * steerLimit + assist, -speedSteerLimit - 0.45, speedSteerLimit + 0.45);

  const transfer = (mass * car.longAccel * settings.centerHeightM) / wheelbase;
  const frontLoad = Math.max(MIN_LOAD_SHARE * mass * gravity, (mass * gravity * rearArm) / wheelbase - transfer);
  const rearLoad = Math.max(MIN_LOAD_SHARE * mass * gravity, (mass * gravity * frontArm) / wheelbase + transfer);
  const frontCapacity = settings.frontGrip * grip * frontLoad;
  const rearCapacity = settings.rearGrip * grip * rearLoad;

  const frontSlip = wheelAngle * direction - Math.atan2(sideSpeed + frontArm * car.yawRate, slipSpeed);
  const rearSlip = -Math.atan2(sideSpeed - rearArm * car.yawRate, slipSpeed);
  const frontLateral = frontCapacity * getDriftlineTireForce(frontSlip);

  const speedLimitedForce = (force) => Math.min(force, (absForward * mass) / stepSec);
  let rearLongitudinal = 0;
  let frontLongitudinal = 0;
  const powerScale = car.bogSec > 0 ? DRIFTLINE_SKILL_SETTINGS.launchBogPowerScale : 1;
  if (throttle > 0) {
    rearLongitudinal += throttle * powerScale * Math.min(settings.maxDriveForceN, settings.enginePowerW / Math.max(absForward, 4));
  }
  if (brake > 0) {
    if (forwardSpeed > 0.5) {
      const brakeForce = speedLimitedForce(brake * settings.brakeForceN);
      frontLongitudinal -= brakeForce * 0.65;
      rearLongitudinal -= brakeForce * 0.35;
    } else if (throttle <= 0.05 && forwardSpeed > -settings.maxReverseSpeed) {
      rearLongitudinal -= brake * settings.reverseForceN;
    }
  }
  if (handbrake && absForward > 0.5) rearLongitudinal -= direction * speedLimitedForce(0.85 * rearCapacity);
  frontLongitudinal = clampDriftline(frontLongitudinal, -frontCapacity, frontCapacity);
  rearLongitudinal = clampDriftline(rearLongitudinal, -rearCapacity, rearCapacity);
  let rearLateralCap = Math.sqrt(Math.max(0, rearCapacity * rearCapacity - rearLongitudinal * rearLongitudinal));
  if (handbrake) rearLateralCap = Math.min(rearLateralCap, settings.handbrakeGrip * rearCapacity);
  const rearLateral = clampDriftline(rearCapacity * getDriftlineTireForce(rearSlip), -rearLateralCap, rearLateralCap);

  const boostForce = car.boostSec > 0 ? DRIFTLINE_SKILL_SETTINGS.boostForceN : 0;
  const dragScale = 1 - (1 - DRIFTLINE_SKILL_SETTINGS.slipstreamDragScale) * car.slipstream;
  const drag = settings.dragCoefficient * dragScale * forwardSpeed * absForward;
  const resistance = (car.onRunoff ? settings.runoffResistance : settings.rollingResistance) * mass * gravity;
  const rolling = absForward > 0.2 ? direction * Math.min(resistance, (absForward * mass) / stepSec) : 0;
  const slopeForce = -mass * gravity * car.slope * direction * Math.min(1, absForward);

  const cosWheel = Math.cos(wheelAngle);
  const sinWheel = Math.sin(wheelAngle);
  const longitudinalForce = rearLongitudinal + frontLongitudinal * cosWheel - frontLateral * sinWheel + boostForce - drag - rolling + slopeForce;
  const lateralForce = rearLateral + frontLateral * cosWheel + frontLongitudinal * sinWheel;
  const slideExcess = bodySlip - clampDriftline(bodySlip, -settings.stableSlipRad, settings.stableSlipRad);
  const slipRate = (bodySlip - car.bodySlip) / stepSec;
  car.bodySlip = bodySlip;
  const growingSlipRate = slipRate * bodySlip > 0 ? slipRate : 0;
  const stabilityAccel = settings.driftStability * slideExcess +
    settings.slipDamping * growingSlipRate * Math.min(1, Math.abs(bodySlip) / DRIFTLINE_SKILL_SETTINGS.driftMinAngleRad);
  const stabilityTorque = absForward > 3
    ? settings.yawInertia * clampDriftline(stabilityAccel, -settings.maxStabilityAccel, settings.maxStabilityAccel)
    : 0;
  const yawTorque = frontArm * (frontLateral * cosWheel + frontLongitudinal * sinWheel) - rearArm * rearLateral + stabilityTorque;

  const longitudinalAccel = longitudinalForce / mass;
  const lateralAccel = lateralForce / mass;
  car.longAccel += (longitudinalAccel - car.longAccel) * Math.min(1, 10 * stepSec);
  car.vx += (longitudinalAccel * forwardX + lateralAccel * sideX) * stepSec;
  car.vz += (longitudinalAccel * forwardZ + lateralAccel * sideZ) * stepSec;
  car.yawRate += (yawTorque / settings.yawInertia) * stepSec;
  if (Math.hypot(car.vx, car.vz) < settings.lowSpeedSettleMps && throttle <= 0.05 && brake <= 0.05) {
    car.vx *= 0.8;
    car.vz *= 0.8;
    car.yawRate *= 0.8;
  }
  car.yaw = Math.atan2(Math.sin(car.yaw + car.yawRate * stepSec), Math.cos(car.yaw + car.yawRate * stepSec));
  car.x += car.vx * stepSec;
  car.z += car.vz * stepSec;
}

/**
 * Snap the car to the road, slide it along barriers and track lap distance.
 * @param {DriftlineCar} car
 * @param {Readonly<DriftlineTrack>} track
 */
function constrainDriftlineCarToTrack(car, track) {
  const position = locateOnDriftlineTrack(track, car.x, car.z, car.trackIndex, trackPosition);
  const wallLimit = position.halfWidth + track.runoffM - DRIFTLINE_CAR_SETTINGS.collisionRadiusM;
  let lateral = position.lateral;
  if (Math.abs(lateral) > wallLimit) {
    const side = Math.sign(lateral);
    const normalX = position.tangentZ * side;
    const normalZ = -position.tangentX * side;
    const penetration = Math.abs(lateral) - wallLimit;
    car.x -= normalX * penetration;
    car.z -= normalZ * penetration;
    lateral = side * wallLimit;
    const outwardSpeed = car.vx * normalX + car.vz * normalZ;
    if (outwardSpeed > 0) {
      car.vx -= (1 + DRIFTLINE_CAR_SETTINGS.wallRestitution) * outwardSpeed * normalX;
      car.vz -= (1 + DRIFTLINE_CAR_SETTINGS.wallRestitution) * outwardSpeed * normalZ;
      car.vx *= DRIFTLINE_CAR_SETTINGS.wallScrub;
      car.vz *= DRIFTLINE_CAR_SETTINGS.wallScrub;
      car.yawRate *= 0.5;
      if (outwardSpeed > WALL_IMPACT_EVENT_SPEED) {
        car.wallHitSerial += 1;
        car.wallHitSpeed = outwardSpeed;
        car.driftCharge = Math.max(0, car.driftCharge - DRIFTLINE_SKILL_SETTINGS.wallChargeLoss);
      }
    }
  }

  const nextIndex = (position.index + 1) % track.sampleCount;
  const previousIndex = (position.index - 1 + track.sampleCount) % track.sampleCount;
  const gradient = (track.y[nextIndex] - track.y[previousIndex]) / (2 * track.spacingM);
  const travelling = car.vx * position.tangentX + car.vz * position.tangentZ >= 0 ? 1 : -1;
  car.slope = gradient * travelling;
  car.y = position.height;
  car.onRunoff = Math.abs(lateral) > position.halfWidth;
  car.progress += getDriftlineTravel(track, car.along, position.along);
  car.along = position.along;
  car.lateral = lateral;
  car.trackIndex = position.index;
}

/**
 * Detect drifts from body slip, bank boost charge while sliding, and release
 * the earned boost tier when the drift ends. A spin-out forfeits the charge.
 * @param {DriftlineCar} car
 * @param {number} stepSec
 */
function updateDriftlineDrift(car, stepSec) {
  const skills = DRIFTLINE_SKILL_SETTINGS;
  const forwardSpeed = car.vx * Math.sin(car.yaw) + car.vz * Math.cos(car.yaw);
  const sideSpeed = car.vx * Math.cos(car.yaw) - car.vz * Math.sin(car.yaw);
  const speed = Math.hypot(car.vx, car.vz);
  car.driftAngle = speed > 1 ? Math.atan2(sideSpeed, Math.abs(forwardSpeed)) * (forwardSpeed >= 0 ? 1 : -1) : 0;
  const slipAngle = speed > 1 ? Math.abs(Math.atan2(sideSpeed, forwardSpeed)) : 0;

  if (car.spinSec > 0) return;
  if (slipAngle > skills.spinAngleRad && speed > 4) {
    car.spinSec = skills.spinRecoverSec;
    car.drifting = false;
    car.driftCharge = 0;
    car.driftSec = 0;
    return;
  }
  if (!car.drifting) {
    if (slipAngle > skills.driftMinAngleRad && speed > skills.driftMinSpeed && forwardSpeed > 0) {
      car.drifting = true;
      car.driftSec = 0;
      car.driftExitSec = 0;
    }
    return;
  }

  car.driftSec += stepSec;
  const angleFactor = clampDriftline((slipAngle - 0.15) / 0.35, 0.3, 1.2);
  const speedFactor = clampDriftline(speed / 30, 0.4, 1.2);
  if (!car.onRunoff) car.driftCharge += skills.chargePerSec * angleFactor * speedFactor * stepSec;
  const leaving = slipAngle < skills.driftExitAngleRad || speed < skills.driftMinSpeed * 0.7;
  car.driftExitSec = leaving ? car.driftExitSec + stepSec : 0;
  if (car.driftExitSec < skills.driftExitGraceSec) return;

  let tier = 0;
  skills.boostTierCharge.forEach((threshold, index) => { if (car.driftCharge >= threshold) tier = index + 1; });
  if (tier > 0) {
    car.boostTier = tier;
    car.boostSec = skills.boostDurationSec[tier - 1];
    car.boostSerial += 1;
  }
  car.drifting = false;
  car.driftCharge = 0;
  car.driftSec = 0;
}

/**
 * Teleport back to the centre line a few metres behind, stopped and facing
 * the direction of travel. A new respawn identity snaps presentation.
 * @param {DriftlineCar} car
 * @param {Readonly<DriftlineTrack>} track
 */
export function recoverDriftlineCar(car, track) {
  const along = car.along - RECOVER_BACKTRACK_M;
  const point = getDriftlineTrackPoint(track, along, 0);
  Object.assign(car, {
    x: point.x, y: point.y, z: point.z, yaw: point.yaw,
    vx: 0, vz: 0, yawRate: 0, longAccel: 0, bodySlip: 0,
    trackIndex: point.index, along: ((along % track.lengthM) + track.lengthM) % track.lengthM,
    progress: car.progress - RECOVER_BACKTRACK_M, lateral: 0,
    drifting: false, driftCharge: 0, driftSec: 0, spinSec: 0, boostSec: 0,
    recoverCooldownSec: DRIFTLINE_RACE_SETTINGS.recoverCooldownSec,
  });
  car.respawnId += 1;
}

/**
 * Cancel held controls on ownership changes without moving the car or
 * touching race progress. The car coasts to a stop under its own physics.
 * @param {DriftlineCar} car
 */
export function resetDriftlineCarControls(car) {
  car.steer = 0;
  car.throttle = 0;
  car.brake = 0;
  car.handbrake = false;
  car.recoverHeld = false;
  car.launchHoldTicks = 0;
}

/**
 * Shared car dynamics, barrier contact, drift detection and boost timing.
 * Mutates only this car; finished cars coast to a stop regardless of input. Rivals, slipstream strength, laps and launches are
 * race rules applied by the world. Inactive or invalid steps do no work.
 * @param {DriftlineCar} car
 * @param {Readonly<DriftlineInputState>} requestedInput
 * @param {number} dtSec
 * @param {DriftlineCarStepContext} context
 */
export function stepDriftlineCar(car, requestedInput, dtSec, { track, active }) {
  if (!active) return;
  const input = car.finished ? FINISHED_COAST_INPUT : requestedInput;
  const stepSec = getDriftlineStepDuration(dtSec);
  if (stepSec <= 0) return;

  car.recoverCooldownSec = Math.max(0, car.recoverCooldownSec - stepSec);
  car.spinSec = Math.max(0, car.spinSec - stepSec);
  car.bogSec = Math.max(0, car.bogSec - stepSec);
  car.boostSec = Math.max(0, car.boostSec - stepSec);
  const recoverPressed = Boolean(input.recover) && !car.recoverHeld;
  car.recoverHeld = Boolean(input.recover);
  if (recoverPressed && car.recoverCooldownSec <= 0) {
    recoverDriftlineCar(car, track);
    return;
  }

  const steerTarget = readDriftlineAxis(input.steer, -1, 1);
  const steerStep = DRIFTLINE_CAR_SETTINGS.steerRatePerSec * stepSec;
  car.steer += clampDriftline(steerTarget - car.steer, -steerStep, steerStep);
  car.throttle = readDriftlineAxis(input.throttle, 0, 1);
  car.brake = readDriftlineAxis(input.brake, 0, 1);
  car.handbrake = Boolean(input.handbrake);

  const throttle = car.spinSec > 0 ? car.throttle * 0.4 : car.throttle;
  const surfaceGrip = car.onRunoff ? track.runoffGrip : track.surfaceGrip;
  const substeps = DRIFTLINE_CAR_SETTINGS.substeps;
  const substepSec = stepSec / substeps;
  for (let substep = 0; substep < substeps; substep += 1) {
    integrateDriftlineCar(car, throttle, car.brake, car.handbrake, surfaceGrip, substepSec);
  }
  constrainDriftlineCarToTrack(car, track);
  updateDriftlineDrift(car, stepSec);
}
