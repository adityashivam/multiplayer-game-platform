import { SKYBREAK_ARENA, SKYBREAK_COMBAT_SETTINGS, SKYBREAK_FLIGHT_SETTINGS } from "./config.js";
import { getSkybreakGroundClearanceHeight } from "./terrain.js";

/** @typedef {import("./config.js").SkybreakInputState} SkybreakInputState */
/** @typedef {import("./config.js").SkybreakWeapon} SkybreakWeapon */
/**
 * Game-owned jet state. Orientation is an orthonormal forward/up pair; right
 * is forward x up. Velocity is forward times speed (arcade flight). Every
 * field exists before the first snapshot.
 * @typedef {object} SkybreakJet
 * @property {string} id
 * @property {number} slotIndex
 * @property {number} colorIndex
 * @property {boolean} isBot
 * @property {boolean} connected
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} previousX Position before the last step, for gate and hit sweeps.
 * @property {number} previousY
 * @property {number} previousZ
 * @property {number} forwardX
 * @property {number} forwardY
 * @property {number} forwardZ
 * @property {number} upX
 * @property {number} upY
 * @property {number} upZ
 * @property {number} speed
 * @property {number} pitchInput Smoothed control deflections, also drive control-surface visuals.
 * @property {number} rollInput
 * @property {number} yawInput
 * @property {boolean} boosting
 * @property {boolean} braking
 * @property {number} fuel From zero to one.
 * @property {number} gForce
 * @property {number} strain Zero to one; blackout at one.
 * @property {number} blackoutSec
 * @property {boolean} crashed Set by flight when it hits ground; consumed by the world.
 * @property {number} outsideSec Time beyond the arena boundary.
 * @property {number} health
 * @property {boolean} alive
 * @property {number} respawnSec
 * @property {number} shieldSec
 * @property {number} respawnId Changes on every respawn or restart.
 * @property {number} deathSerial
 * @property {string|null} lastKillerId Last attacker while alive; the killer once dead.
 * @property {number} lastAttackTimeSec Match time of the last hit taken, for crash kill credit.
 * @property {SkybreakWeapon|null} lastDeathCause
 * @property {number} heat Cannon heat from zero to one.
 * @property {number} overheatSec
 * @property {number} fireCooldownSec
 * @property {boolean} cannonFiring True while rounds are leaving the barrel.
 * @property {number} missiles
 * @property {number} missileReloadSec
 * @property {boolean} missileHeld
 * @property {string|null} lockTargetId
 * @property {number} lockProgress From zero to one; one means locked.
 * @property {boolean} incomingMissile
 * @property {number} flares
 * @property {number} flareRechargeSec
 * @property {number} flareSerial
 * @property {boolean} flareHeld
 * @property {boolean} restartHeld
 * @property {number} hitSerial Increments when this jet is hit.
 * @property {number} hitConfirmSerial Increments when this jet lands a hit.
 * @property {number} kills
 * @property {number} deaths
 * @property {number} gateIndex Next time-trial gate.
 * @property {boolean} runActive
 * @property {number} runTimeSec
 * @property {number} lastRunSec
 * @property {number} bestRunSec Zero until a run completes.
 * @property {number} runSerial Increments on every run start, finish or restart.
 */

const MAX_PURE_STEP_SEC = 0.05;

/** @param {number} value @param {number} minimum @param {number} maximum */
function clampSkybreak(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

/** @param {unknown} value */
function readSkybreakAxis(value) {
  return typeof value === "number" && Number.isFinite(value) ? clampSkybreak(value, -1, 1) : 0;
}

/** @param {number} dtSec @returns {number} */
export function getSkybreakStepDuration(dtSec) {
  return Number.isFinite(dtSec) ? clampSkybreak(dtSec, 0, MAX_PURE_STEP_SEC) : 0;
}

/**
 * @param {string} id
 * @param {number} slotIndex
 * @param {boolean} [isBot]
 * @returns {SkybreakJet}
 */
export function createSkybreakJet(id, slotIndex, isBot = false) {
  return {
    id,
    slotIndex,
    colorIndex: slotIndex,
    isBot,
    connected: isBot,
    x: 0, y: SKYBREAK_ARENA.spawnAltitudeM, z: 0,
    previousX: 0, previousY: SKYBREAK_ARENA.spawnAltitudeM, previousZ: 0,
    forwardX: 0, forwardY: 0, forwardZ: 1,
    upX: 0, upY: 1, upZ: 0,
    speed: SKYBREAK_FLIGHT_SETTINGS.cruiseSpeed,
    pitchInput: 0, rollInput: 0, yawInput: 0,
    boosting: false,
    braking: false,
    fuel: 1,
    gForce: 1,
    strain: 0,
    blackoutSec: 0,
    crashed: false,
    outsideSec: 0,
    health: SKYBREAK_COMBAT_SETTINGS.maxHealth,
    alive: true,
    respawnSec: 0,
    shieldSec: 0,
    respawnId: 0,
    deathSerial: 0,
    lastKillerId: null,
    lastAttackTimeSec: -1000,
    lastDeathCause: null,
    heat: 0,
    overheatSec: 0,
    fireCooldownSec: 0,
    cannonFiring: false,
    missiles: SKYBREAK_COMBAT_SETTINGS.maxMissiles,
    missileReloadSec: 0,
    missileHeld: false,
    lockTargetId: null,
    lockProgress: 0,
    incomingMissile: false,
    flares: SKYBREAK_COMBAT_SETTINGS.maxFlares,
    flareRechargeSec: 0,
    flareSerial: 0,
    flareHeld: false,
    restartHeld: false,
    hitSerial: 0,
    hitConfirmSerial: 0,
    kills: 0,
    deaths: 0,
    gateIndex: 0,
    runActive: false,
    runTimeSec: 0,
    lastRunSec: 0,
    bestRunSec: 0,
    runSerial: 0,
  };
}

/**
 * Put a jet at a pose, wings level, at cruise speed.
 * @param {SkybreakJet} jet
 * @param {{x:number,y:number,z:number,forwardX:number,forwardZ:number}} pose
 */
export function placeSkybreakJet(jet, pose) {
  const length = Math.hypot(pose.forwardX, pose.forwardZ) || 1;
  Object.assign(jet, {
    x: pose.x, y: pose.y, z: pose.z,
    previousX: pose.x, previousY: pose.y, previousZ: pose.z,
    forwardX: pose.forwardX / length, forwardY: 0, forwardZ: pose.forwardZ / length,
    upX: 0, upY: 1, upZ: 0,
    speed: SKYBREAK_FLIGHT_SETTINGS.cruiseSpeed,
    pitchInput: 0, rollInput: 0, yawInput: 0,
    strain: 0, blackoutSec: 0, gForce: 1, crashed: false, outsideSec: 0,
  });
}

/** Re-orthonormalize forward/up after incremental rotations. @param {SkybreakJet} jet */
function orthonormalizeSkybreakJet(jet) {
  const forwardLength = Math.hypot(jet.forwardX, jet.forwardY, jet.forwardZ) || 1;
  jet.forwardX /= forwardLength;
  jet.forwardY /= forwardLength;
  jet.forwardZ /= forwardLength;
  let rightX = jet.forwardY * jet.upZ - jet.forwardZ * jet.upY;
  let rightY = jet.forwardZ * jet.upX - jet.forwardX * jet.upZ;
  let rightZ = jet.forwardX * jet.upY - jet.forwardY * jet.upX;
  const rightLength = Math.hypot(rightX, rightY, rightZ) || 1;
  rightX /= rightLength;
  rightY /= rightLength;
  rightZ /= rightLength;
  jet.upX = rightY * jet.forwardZ - rightZ * jet.forwardY;
  jet.upY = rightZ * jet.forwardX - rightX * jet.forwardZ;
  jet.upZ = rightX * jet.forwardY - rightY * jet.forwardX;
}

/**
 * Rotate the airframe by pitch (about right), roll (about forward) and yaw
 * (about up), in that order, by the given angles in radians.
 * @param {SkybreakJet} jet
 * @param {number} pitchRad Positive raises the nose.
 * @param {number} rollRad Positive rolls right.
 * @param {number} yawRad Positive yaws right.
 */
function rotateSkybreakJet(jet, pitchRad, rollRad, yawRad) {
  const cosPitch = Math.cos(pitchRad);
  const sinPitch = Math.sin(pitchRad);
  const forwardX = jet.forwardX * cosPitch + jet.upX * sinPitch;
  const forwardY = jet.forwardY * cosPitch + jet.upY * sinPitch;
  const forwardZ = jet.forwardZ * cosPitch + jet.upZ * sinPitch;
  jet.upX = jet.upX * cosPitch - jet.forwardX * sinPitch;
  jet.upY = jet.upY * cosPitch - jet.forwardY * sinPitch;
  jet.upZ = jet.upZ * cosPitch - jet.forwardZ * sinPitch;
  jet.forwardX = forwardX;
  jet.forwardY = forwardY;
  jet.forwardZ = forwardZ;

  let rightX = jet.forwardY * jet.upZ - jet.forwardZ * jet.upY;
  let rightY = jet.forwardZ * jet.upX - jet.forwardX * jet.upZ;
  let rightZ = jet.forwardX * jet.upY - jet.forwardY * jet.upX;
  const cosRoll = Math.cos(rollRad);
  const sinRoll = Math.sin(rollRad);
  jet.upX = jet.upX * cosRoll + rightX * sinRoll;
  jet.upY = jet.upY * cosRoll + rightY * sinRoll;
  jet.upZ = jet.upZ * cosRoll + rightZ * sinRoll;

  rightX = jet.forwardY * jet.upZ - jet.forwardZ * jet.upY;
  rightY = jet.forwardZ * jet.upX - jet.forwardX * jet.upZ;
  rightZ = jet.forwardX * jet.upY - jet.forwardY * jet.upX;
  const cosYaw = Math.cos(yawRad);
  const sinYaw = Math.sin(yawRad);
  jet.forwardX = jet.forwardX * cosYaw + rightX * sinYaw;
  jet.forwardY = jet.forwardY * cosYaw + rightY * sinYaw;
  jet.forwardZ = jet.forwardZ * cosYaw + rightZ * sinYaw;
  orthonormalizeSkybreakJet(jet);
}

/**
 * Turn authority as a function of speed: best at corner speed, weaker when
 * slow or very fast. This is the energy trade at the heart of dogfighting.
 * @param {number} speed
 */
export function getSkybreakTurnScale(speed) {
  const offset = (speed - SKYBREAK_FLIGHT_SETTINGS.cornerSpeed) / SKYBREAK_FLIGHT_SETTINGS.cornerWidth;
  return Math.max(SKYBREAK_FLIGHT_SETTINGS.minTurnScale, 1 - offset * offset);
}

/**
 * Gentle steering back toward the arena when outside it or above the
 * ceiling. Returns extra yaw and pitch in radians for this step.
 * @param {SkybreakJet} jet
 * @param {number} stepSec
 */
function getSkybreakBoundaryAssist(jet, stepSec) {
  const distance = Math.hypot(jet.x, jet.z);
  let yaw = 0;
  let pitch = 0;
  if (distance > SKYBREAK_ARENA.radiusM) {
    const towardX = -jet.x / distance;
    const towardZ = -jet.z / distance;
    const rightX = jet.forwardY * jet.upZ - jet.forwardZ * jet.upY;
    const rightZ = jet.forwardX * jet.upY - jet.forwardY * jet.upX;
    const side = towardX * rightX + towardZ * rightZ;
    const ahead = towardX * jet.forwardX + towardZ * jet.forwardZ;
    yaw = Math.sign(side || 1) * (ahead < 0.95 ? 1 : Math.abs(side)) * SKYBREAK_ARENA.boundarySteerRad * stepSec;
  }
  if (jet.y > SKYBREAK_ARENA.ceilingM && jet.forwardY > -0.3) pitch = -SKYBREAK_ARENA.boundarySteerRad * stepSec;
  return { yaw, pitch };
}

/**
 * Shared flight for one jet: control smoothing, rotation, speed, fuel, G
 * strain, movement and ground contact. Combat, damage and gates are world
 * rules. Dead, inactive or invalid steps do no work.
 * @param {SkybreakJet} jet
 * @param {Readonly<SkybreakInputState>} input
 * @param {number} dtSec
 * @param {{active:boolean,boundary:boolean}} context
 */
export function stepSkybreakFlight(jet, input, dtSec, { active, boundary }) {
  if (!active || !jet.alive) return;
  const stepSec = getSkybreakStepDuration(dtSec);
  if (stepSec <= 0) return;
  const settings = SKYBREAK_FLIGHT_SETTINGS;

  jet.blackoutSec = Math.max(0, jet.blackoutSec - stepSec);
  const controlScale = jet.blackoutSec > 0 ? settings.blackoutControlScale : 1;
  const response = settings.inputResponsePerSec * stepSec;
  jet.pitchInput += clampSkybreak(readSkybreakAxis(input.pitch) * controlScale - jet.pitchInput, -response, response);
  jet.rollInput += clampSkybreak(readSkybreakAxis(input.roll) - jet.rollInput, -response, response);
  jet.yawInput += clampSkybreak(readSkybreakAxis(input.yaw) * controlScale - jet.yawInput, -response, response);

  const turnScale = getSkybreakTurnScale(jet.speed);
  const pitchRad = jet.pitchInput * settings.pitchRateRad * turnScale * stepSec;
  const assist = boundary ? getSkybreakBoundaryAssist(jet, stepSec) : { yaw: 0, pitch: 0 };
  rotateSkybreakJet(jet, pitchRad + assist.pitch, jet.rollInput * settings.rollRateRad * stepSec, jet.yawInput * settings.yawRateRad * turnScale * stepSec + assist.yaw);

  jet.boosting = Boolean(input.boost) && jet.fuel > 0.02;
  jet.braking = Boolean(input.brake) && !jet.boosting;
  jet.fuel = clampSkybreak(jet.fuel + (jet.boosting ? -settings.boostDrainPerSec : settings.fuelRegenPerSec) * stepSec, 0, 1);
  const targetSpeed = jet.boosting ? settings.boostSpeed : jet.braking ? settings.brakeSpeed : settings.cruiseSpeed;
  jet.speed += (targetSpeed - jet.speed) * Math.min(1, settings.speedResponsePerSec * stepSec);
  jet.speed -= settings.gravityAlongPath * jet.forwardY * stepSec;
  jet.speed -= settings.pullDragPerSec * Math.abs(jet.pitchInput) * turnScale * jet.speed * stepSec;
  jet.speed = clampSkybreak(jet.speed, settings.minSpeed, settings.maxSpeed);

  // Arcade G: about 9 G at full pull at corner speed, less when slow or fast.
  jet.gForce = 1 + settings.peakPullG * Math.abs(jet.pitchInput) * turnScale * Math.min(1.2, jet.speed / settings.cornerSpeed);
  if (jet.gForce > settings.strainThresholdG) jet.strain += (jet.gForce - settings.strainThresholdG) * settings.strainGainPerG * stepSec;
  else jet.strain = Math.max(0, jet.strain - settings.strainRecoveryPerSec * stepSec);
  if (jet.strain >= 1) {
    jet.strain = 0.6;
    jet.blackoutSec = settings.blackoutSec;
  }

  jet.previousX = jet.x;
  jet.previousY = jet.y;
  jet.previousZ = jet.z;
  jet.x += jet.forwardX * jet.speed * stepSec;
  jet.y += jet.forwardY * jet.speed * stepSec;
  jet.z += jet.forwardZ * jet.speed * stepSec;
  if (jet.y <= getSkybreakGroundClearanceHeight(jet.x, jet.z) + settings.crashClearanceM) jet.crashed = true;
  if (boundary) {
    const outside = Math.hypot(jet.x, jet.z) > SKYBREAK_ARENA.radiusM || jet.y > SKYBREAK_ARENA.ceilingM;
    jet.outsideSec = outside ? jet.outsideSec + stepSec : 0;
  }
}
