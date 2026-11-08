import {
  SKY_DASH_ACTION_SETTINGS,
  SKY_DASH_BOT_COUNT,
  SKY_DASH_BOT_NAMES,
  SKY_DASH_CHARACTER_SETTINGS,
  SKY_DASH_FINISH_Z,
  SKY_DASH_INPUT_TEMPLATE,
  SKY_DASH_MAX_RUNNERS,
  SKY_DASH_PLAYER_IDS,
  SKY_DASH_RESPAWN_SEC,
  SKY_DASH_ROUND_DURATION_SEC,
  SKY_DASH_SEESAW_SETTINGS,
} from "./config.js";
import {
  SKY_DASH_CHECKPOINTS,
  createSkyDashSeesaws,
  getSkyDashPlatformTopY,
  sampleSkyDashObstacles,
  sampleSkyDashPlatforms,
  sampleSkyDashSeesaws,
} from "./course.js";
import { isSupportedPlayerSlotId } from "../../../platform/shared/gameIdentifiers.js";
import { createKinematicCharacterController, resolveKinematicCharacterSeparation } from "../../../platform/shared/kinematicCharacter.js";

/** @typedef {import("./config.js").SkyDashInputState} SkyDashInputState */
/** @typedef {import("./config.js").SkyDashAction} SkyDashAction */
/** @typedef {import("./course.js").SkyDashPlatform} SkyDashPlatform */
/** @typedef {import("./course.js").SkyDashObstacle} SkyDashObstacle */
/** @typedef {import("./course.js").SkyDashSeesaw} SkyDashSeesaw */
/**
 * Game-owned movement/action state. Y is the collider's bottom. Action time is
 * the remaining clip/recovery time, not elapsed animation time. Every leaf is
 * present before the first packed snapshot; SDK input ownership is separate.
 * @typedef {object} SkyDashRunner
 * @property {string} id
 * @property {string} name
 * @property {boolean} isBot
 * @property {number} slotIndex
 * @property {number} colorIndex
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} vx
 * @property {number} vy
 * @property {number} vz
 * @property {number} yaw Zero faces negative Z.
 * @property {boolean} grounded
 * @property {number} supportId Zero means no platform support.
 * @property {number} coyoteSec
 * @property {number} jumpBufferSec
 * @property {boolean} jumpHeld
 * @property {boolean} dashHeld
 * @property {boolean} diveHeld
 * @property {boolean} connected
 * @property {boolean} finished
 * @property {number} finishTimeSec Zero until finished.
 * @property {number} rank
 * @property {number} checkpoint Last earned ordered checkpoint.
 * @property {number} progress Checkpoint plus fractional progress along its leg.
 * @property {number} lastProgressZ Previous authority sample for gate crossing.
 * @property {SkyDashAction} action
 * @property {number} actionTimeSec
 * @property {number} dashCooldownSec
 * @property {number} diveCooldownSec
 * @property {number} hitSec
 * @property {number} hitImmunitySec
 * @property {number} respawnSec
 * @property {number} respawnId Monotonic authority snap identity within a round.
 */
/**
 * @typedef {{id:string,name:string,isBot:boolean,colorIndex:number,finished:boolean,finishTimeSec:number,checkpoint:number,progress:number,rank:number}} SkyDashStanding
 * @typedef {object} SkyDashRound
 * @property {Record<string,SkyDashRunner>} players Configured human socket slots.
 * @property {SkyDashRunner[]} bots Fixed actors, never human socket slots.
 * @property {SkyDashStanding[]} standings Fixed count, sorted by current rank.
 * @property {SkyDashSeesaw[]} seesaws Fixed reactive platform state.
 * @property {number} timeSec Analytic course clock; paused with the round.
 * @property {number} timer Remaining race seconds.
 * @property {number} durationSec
 * @property {boolean} started
 * @property {number|null} startAt
 * @property {boolean} gameOver
 * @property {string|null} winner A human or bot actor ID.
 * @property {number} roundId
 */

const MAX_PURE_STEP_SEC = 0.05;
const CONTACT_STEP_SEC = 1 / 120;
const CONTACT_PADDING = 0.002;
const TIME_EPSILON_SEC = 0.000001;
const CHARACTER_RADIUS = SKY_DASH_CHARACTER_SETTINGS.radius;
const CHARACTER_HEIGHT = SKY_DASH_CHARACTER_SETTINGS.height;
const CHARACTER_DIAMETER = CHARACTER_RADIUS * 2;
const characterController = createKinematicCharacterController(SKY_DASH_CHARACTER_SETTINGS);

/** @param {number} value @param {number} minimum @param {number} maximum @returns {number} */
function clampSkyDashNumber(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

/** @param {number} dtSec @returns {number} */
function getSkyDashStepDuration(dtSec) {
  return Number.isFinite(dtSec) ? clampSkyDashNumber(dtSec, 0, MAX_PURE_STEP_SEC) : 0;
}

/**
 * @param {string} id Snapshot-compatible actor identifier.
 * @param {number} slotIndex Shared spawn/color index, including bots.
 * @param {boolean} [isBot]
 * @returns {SkyDashRunner}
 */
export function createSkyDashRunner(id, slotIndex, isBot = false) {
  const spawnX = (slotIndex % 6 - 2.5) * 1.3;
  const spawnZ = 3 + Math.floor(slotIndex / 6) * 1.4;
  return {
    id,
    name: isBot ? SKY_DASH_BOT_NAMES[slotIndex % SKY_DASH_BOT_NAMES.length] : `Runner ${slotIndex + 1}`,
    isBot,
    slotIndex,
    colorIndex: slotIndex % SKY_DASH_MAX_RUNNERS,
    x: spawnX,
    y: 0,
    z: spawnZ,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 0,
    grounded: true,
    supportId: 1,
    coyoteSec: 0,
    jumpBufferSec: 0,
    jumpHeld: false,
    dashHeld: false,
    diveHeld: false,
    connected: isBot,
    finished: false,
    finishTimeSec: 0,
    rank: slotIndex + 1,
    checkpoint: 0,
    progress: 0,
    lastProgressZ: spawnZ,
    action: "idle",
    actionTimeSec: 0,
    dashCooldownSec: 0,
    diveCooldownSec: 0,
    hitSec: 0,
    hitImmunitySec: 0,
    respawnSec: 0,
    respawnId: 0,
  };
}

/**
 * Create a bounded independent race. Human IDs configure ownership capacity;
 * bots occupy their own fixed array and are never available as socket seats.
 * @param {{playerIds?:readonly string[],botCount?:number}} [options]
 * @returns {SkyDashRound}
 * @throws {TypeError} For invalid/duplicate human IDs or noninteger bot count.
 * @throws {RangeError} If total actor capacity exceeds twelve.
 */
export function createSkyDashRound({ playerIds = SKY_DASH_PLAYER_IDS, botCount = SKY_DASH_BOT_COUNT } = {}) {
  if (!Array.isArray(playerIds) || playerIds.length === 0 || new Set(playerIds).size !== playerIds.length ||
      playerIds.some((playerId) => !isSupportedPlayerSlotId(playerId))) {
    throw new TypeError("Sky Dash playerIds must contain unique snapshot-compatible identifiers.");
  }
  if (!Number.isInteger(botCount)) {
    throw new TypeError("Sky Dash botCount must be an integer.");
  }
  if (botCount < 0 || playerIds.length + botCount > SKY_DASH_MAX_RUNNERS) {
    throw new RangeError("Sky Dash supports at most twelve human and bot runners.");
  }

  const players = Object.fromEntries(playerIds.map((playerId, slotIndex) => [playerId, createSkyDashRunner(playerId, slotIndex)]));
  const bots = Array.from({ length: botCount }, (_, botIndex) => {
    let botId = `bot-${botIndex + 1}`;
    while (Object.hasOwn(players, botId)) botId = `_${botId}`;
    const bot = createSkyDashRunner(botId, playerIds.length + botIndex, true);
    bot.name = SKY_DASH_BOT_NAMES[botIndex % SKY_DASH_BOT_NAMES.length];
    return bot;
  });
  const runners = [...Object.values(players), ...bots];
  return {
    players,
    bots,
    standings: runners.map((runner) => createSkyDashStanding(runner)),
    seesaws: createSkyDashSeesaws(),
    timeSec: 0,
    timer: SKY_DASH_ROUND_DURATION_SEC,
    durationSec: SKY_DASH_ROUND_DURATION_SEC,
    started: false,
    startAt: null,
    gameOver: false,
    winner: null,
    roundId: 1,
  };
}

/** @param {SkyDashRunner} runner @returns {SkyDashStanding} */
function createSkyDashStanding(runner) {
  return {
    id: runner.id,
    name: runner.name,
    isBot: runner.isBot,
    colorIndex: runner.colorIndex,
    finished: runner.finished,
    finishTimeSec: runner.finishTimeSec,
    checkpoint: runner.checkpoint,
    progress: runner.progress,
    rank: runner.rank,
  };
}

/** @param {SkyDashRunner} runner */
function boundSkyDashRunnerVelocity(runner) {
  const horizontalSpeed = Math.hypot(runner.vx, runner.vz);
  if (horizontalSpeed > SKY_DASH_ACTION_SETTINGS.maxHorizontalSpeed) {
    const speedScale = SKY_DASH_ACTION_SETTINGS.maxHorizontalSpeed / horizontalSpeed;
    runner.vx *= speedScale;
    runner.vz *= speedScale;
  }
  runner.vy = clampSkyDashNumber(runner.vy, -35, 13);
}

/** @param {SkyDashRunner} runner @param {number} dtSec */
function stepSkyDashActionTimers(runner, dtSec) {
  runner.actionTimeSec = Math.max(0, runner.actionTimeSec - dtSec);
  runner.dashCooldownSec = Math.max(0, runner.dashCooldownSec - dtSec);
  runner.diveCooldownSec = Math.max(0, runner.diveCooldownSec - dtSec);
  runner.hitSec = Math.max(0, runner.hitSec - dtSec);
  runner.hitImmunitySec = Math.max(0, runner.hitImmunitySec - dtSec);
}

/** @param {SkyDashRunner} runner */
function beginSkyDashRespawn(runner) {
  runner.respawnSec = SKY_DASH_RESPAWN_SEC;
  runner.action = "respawn";
  runner.actionTimeSec = SKY_DASH_RESPAWN_SEC;
  runner.vx = 0;
  runner.vy = 0;
  runner.vz = 0;
  runner.grounded = false;
  runner.supportId = 0;
  runner.coyoteSec = 0;
  runner.jumpBufferSec = 0;
}

/**
 * Apply a bounded toy-like impact. Immunity suppresses repeated impulse/stagger
 * but never suppresses geometric push-out, which is performed by the caller.
 * @param {SkyDashRunner} runner
 * @param {SkyDashObstacle} obstacle
 * @param {number} normalX
 * @param {number} normalZ
 * @param {number} contactX
 * @param {number} contactY
 * @param {number} contactZ
 */
function applySkyDashObstacleImpact(runner, obstacle, normalX, normalZ, contactX, contactY, contactZ) {
  if (runner.hitImmunitySec > 0) return;
  const contactVx = obstacle.kind === "sweeper" ? -(contactZ - obstacle.z) * obstacle.angularSpeed :
    obstacle.kind === "gate-spoke" ? -(contactY - obstacle.y) * obstacle.angularSpeed : obstacle.vx;
  const contactVz = obstacle.kind === "sweeper" ? (contactX - obstacle.x) * obstacle.angularSpeed : obstacle.vz;
  const incomingSpeed = Math.max(0, (contactVx - runner.vx) * normalX + (contactVz - runner.vz) * normalZ);
  const impulseSpeed = obstacle.kind === "gate" ? SKY_DASH_ACTION_SETTINGS.gateReboundSpeed : clampSkyDashNumber(7 + incomingSpeed * 0.65, 7, 16);
  runner.vx = normalX * impulseSpeed + contactVx * 0.25;
  runner.vz = normalZ * impulseSpeed + contactVz * 0.25;
  runner.vy = Math.max(runner.vy, obstacle.kind === "gate" ? SKY_DASH_ACTION_SETTINGS.gateHopSpeed : obstacle.kind === "sweeper" ? 5 : 4);
  runner.grounded = false;
  runner.supportId = 0;
  runner.hitSec = obstacle.kind === "gate" ? SKY_DASH_ACTION_SETTINGS.gateHitRecoverySec : SKY_DASH_ACTION_SETTINGS.hitRecoverySec;
  runner.hitImmunitySec = SKY_DASH_ACTION_SETTINGS.hitImmunitySec;
  runner.action = "hit";
  runner.actionTimeSec = runner.hitSec;
  boundSkyDashRunnerVelocity(runner);
}

/**
 * Find the shortest contact between the runner's upright capsule axis and an
 * arbitrary 3D obstacle segment. Candidate regions cover both clamped runner
 * endpoints and the interior axis, including vertical rotating gate spokes.
 * @param {SkyDashRunner} runner
 * @param {SkyDashObstacle} obstacle
 * @returns {{x:number,y:number,z:number,runnerY:number,distance:number}}
 */
function getSkyDashObstacleAxisContact(runner, obstacle) {
  const ax = obstacle.ax ?? obstacle.x;
  const ay = obstacle.ay ?? obstacle.y;
  const az = obstacle.az ?? obstacle.z;
  const segmentX = (obstacle.bx ?? obstacle.x) - ax;
  const segmentY = (obstacle.by ?? obstacle.y) - ay;
  const segmentZ = (obstacle.bz ?? obstacle.z) - az;
  const horizontalLengthSquared = segmentX * segmentX + segmentZ * segmentZ;
  const segmentLengthSquared = horizontalLengthSquared + segmentY * segmentY;
  const axisBottomY = runner.y + CHARACTER_RADIUS;
  const axisTopY = runner.y + CHARACTER_HEIGHT - CHARACTER_RADIUS;
  const projectedHorizontal = (runner.x - ax) * segmentX + (runner.z - az) * segmentZ;
  const candidates = [0, 1];
  if (horizontalLengthSquared > 0.000001) candidates.push(projectedHorizontal / horizontalLengthSquared);
  if (segmentLengthSquared > 0.000001) {
    candidates.push((projectedHorizontal + (axisBottomY - ay) * segmentY) / segmentLengthSquared);
    candidates.push((projectedHorizontal + (axisTopY - ay) * segmentY) / segmentLengthSquared);
  }
  let nearestContact = { x: ax, y: ay, z: az, runnerY: clampSkyDashNumber(ay, axisBottomY, axisTopY), distance: Infinity };
  for (const candidate of candidates) {
    const alongSegment = clampSkyDashNumber(candidate, 0, 1);
    const x = ax + segmentX * alongSegment;
    const y = ay + segmentY * alongSegment;
    const z = az + segmentZ * alongSegment;
    const runnerY = clampSkyDashNumber(y, axisBottomY, axisTopY);
    const distance = Math.hypot(runner.x - x, runnerY - y, runner.z - z);
    if (distance < nearestContact.distance) nearestContact = { x, y, z, runnerY, distance };
  }
  return nearestContact;
}

/**
 * A visible slab with a circular opening blocks its solid wings and bottom lip.
 * The incoming face is retained on contact so push-out cannot teleport a runner
 * through the far side when an action crosses the plane within one substep.
 * @param {SkyDashRunner} runner
 * @param {SkyDashObstacle} gate
 * @param {number} previousZ
 */
function resolveSkyDashCircularFrameContact(runner, gate, previousZ) {
  const contactHalfDepth = gate.depth / 2 + CHARACTER_RADIUS;
  if (Math.abs(runner.z - gate.z) >= contactHalfDepth ||
      Math.abs(runner.x - gate.x) >= gate.frameWidth / 2 + CHARACTER_RADIUS ||
      runner.y + CHARACTER_HEIGHT <= gate.frameBottomY || runner.y >= gate.frameTopY) return;
  const axisBottomY = runner.y + CHARACTER_RADIUS;
  const axisTopY = runner.y + CHARACTER_HEIGHT - CHARACTER_RADIUS;
  const maximumAxisDistance = Math.max(Math.hypot(runner.x - gate.x, axisBottomY - gate.y), Math.hypot(runner.x - gate.x, axisTopY - gate.y));
  if (maximumAxisDistance + CHARACTER_RADIUS < gate.openingRadius) return;
  const normalZ = previousZ >= gate.z ? 1 : -1;
  runner.z = gate.z + normalZ * (contactHalfDepth + CONTACT_PADDING);
  applySkyDashObstacleImpact(runner, gate, 0, normalZ, runner.x, runner.y + CHARACTER_HEIGHT / 2, gate.z);
}

/**
 * Solid capsule bars/spheres and circular frame contacts run at bounded movement
 * substeps. Immunity skips repeated impulses while all geometric push-out stays.
 * @param {SkyDashRunner} runner
 * @param {readonly SkyDashObstacle[]} obstacles
 * @param {number} [previousZ]
 */
function resolveSkyDashObstacleContacts(runner, obstacles, previousZ = runner.z) {
  for (const obstacle of obstacles) {
    if (obstacle.kind === "gate") {
      resolveSkyDashCircularFrameContact(runner, obstacle, previousZ);
      continue;
    }
    const contact = getSkyDashObstacleAxisContact(runner, obstacle);
    const contactRadius = CHARACTER_RADIUS + obstacle.radius;
    if (contact.distance >= contactRadius) continue;
    const horizontalDistance = Math.hypot(runner.x - contact.x, runner.z - contact.z);
    let normalX = horizontalDistance > 0.00001 ? (runner.x - contact.x) / horizontalDistance : 0;
    let normalZ = horizontalDistance > 0.00001 ? (runner.z - contact.z) / horizontalDistance : previousZ >= obstacle.z ? 1 : -1;
    if (horizontalDistance <= 0.00001 && (obstacle.kind === "sweeper" || obstacle.kind === "hurdle")) {
      const segmentLength = Math.hypot(obstacle.bx - obstacle.ax, obstacle.bz - obstacle.az) || 1;
      normalX = -(obstacle.bz - obstacle.az) / segmentLength;
      normalZ = (obstacle.bx - obstacle.ax) / segmentLength;
    }
    const verticalSeparation = contact.runnerY - contact.y;
    const requiredHorizontalDistance = Math.sqrt(Math.max(0, contactRadius * contactRadius - verticalSeparation * verticalSeparation));
    const pushDistance = requiredHorizontalDistance - horizontalDistance + CONTACT_PADDING;
    runner.x += normalX * pushDistance;
    runner.z += normalZ * pushDistance;
    applySkyDashObstacleImpact(runner, obstacle, normalX, normalZ, contact.x, contact.y, contact.z);
  }
}

/**
 * Advance optional externally supplied start-of-step geometry without mutating
 * the caller's arrays. Normal course motion uses exact analytic samples instead.
 * @param {readonly SkyDashPlatform[]} platforms
 * @param {number} elapsedSec
 * @returns {SkyDashPlatform[]}
 */
function projectSkyDashPlatforms(platforms, elapsedSec) {
  return platforms.map((platform) => ({ ...platform, x: platform.x + platform.vx * elapsedSec, z: platform.z + platform.vz * elapsedSec, topY: platform.topY + platform.vy * elapsedSec }));
}

/** @param {readonly SkyDashObstacle[]} obstacles @param {number} elapsedSec @returns {SkyDashObstacle[]} */
function projectSkyDashObstacles(obstacles, elapsedSec) {
  return obstacles.map((obstacle) => ({
    ...obstacle,
    x: obstacle.x + obstacle.vx * elapsedSec,
    y: obstacle.y + obstacle.vy * elapsedSec,
    z: obstacle.z + obstacle.vz * elapsedSec,
    ax: obstacle.ax + obstacle.vx * elapsedSec,
    ay: (obstacle.ay ?? obstacle.y) + obstacle.vy * elapsedSec,
    az: obstacle.az + obstacle.vz * elapsedSec,
    bx: obstacle.bx + obstacle.vx * elapsedSec,
    by: (obstacle.by ?? obstacle.y) + obstacle.vy * elapsedSec,
    bz: obstacle.bz + obstacle.vz * elapsedSec,
  }));
}

/**
 * Shared local prediction and authority movement. Mutates only this runner;
 * checkpoint awards, respawn destinations, crowd contact and results belong to
 * stepSkyDashWorld. Forward input is positive moveZ and negative world Z.
 * @param {SkyDashRunner} runner
 * @param {SkyDashInputState} input
 * @param {number} dtSec
 * @param {{active:boolean,timeSec:number,seesaws?:readonly SkyDashSeesaw[],platforms?:readonly SkyDashPlatform[],obstacles?:readonly SkyDashObstacle[]}} options
 */
export function stepSkyDashRunner(runner, input, dtSec, { active, timeSec, seesaws = [], platforms, obstacles }) {
  if (!active || runner.finished) return;
  const stepSec = getSkyDashStepDuration(dtSec);
  if (stepSec <= 0) return;
  stepSkyDashActionTimers(runner, stepSec);
  if (runner.action === "respawn") {
    runner.respawnSec = Math.max(0, runner.respawnSec - stepSec);
    runner.actionTimeSec = runner.respawnSec;
    return;
  }
  if (runner.y < SKY_DASH_ACTION_SETTINGS.fallY) {
    beginSkyDashRespawn(runner);
    return;
  }

  const moveX = Number.isFinite(input.moveX) ? clampSkyDashNumber(input.moveX, -1, 1) : 0;
  const moveZ = Number.isFinite(input.moveZ) ? -clampSkyDashNumber(input.moveZ, -1, 1) : 0;
  const inputLength = Math.hypot(moveX, moveZ);
  const directionX = inputLength > 0.01 ? moveX / inputLength : Math.sin(runner.yaw);
  const directionZ = inputLength > 0.01 ? moveZ / inputLength : -Math.cos(runner.yaw);
  const dashPressed = input.dash && !runner.dashHeld;
  const divePressed = input.dive && !runner.diveHeld;
  runner.dashHeld = Boolean(input.dash);
  runner.diveHeld = Boolean(input.dive);

  if (runner.hitSec <= 0 && dashPressed && runner.dashCooldownSec <= 0) {
    runner.action = "dash";
    runner.actionTimeSec = SKY_DASH_ACTION_SETTINGS.dashDurationSec;
    runner.dashCooldownSec = SKY_DASH_ACTION_SETTINGS.dashCooldownSec;
    runner.vx = directionX * SKY_DASH_CHARACTER_SETTINGS.moveSpeed * SKY_DASH_ACTION_SETTINGS.dashSpeedScale;
    runner.vz = directionZ * SKY_DASH_CHARACTER_SETTINGS.moveSpeed * SKY_DASH_ACTION_SETTINGS.dashSpeedScale;
  }
  if (runner.hitSec <= 0 && divePressed && !runner.grounded && runner.diveCooldownSec <= 0) {
    runner.action = "dive";
    runner.actionTimeSec = SKY_DASH_ACTION_SETTINGS.diveDurationSec;
    runner.diveCooldownSec = SKY_DASH_ACTION_SETTINGS.diveCooldownSec;
    runner.vx = directionX * SKY_DASH_ACTION_SETTINGS.diveSpeed;
    runner.vz = directionZ * SKY_DASH_ACTION_SETTINGS.diveSpeed;
    runner.vy = Math.min(runner.vy, -3.5);
  }

  const substepCount = Math.ceil(stepSec / CONTACT_STEP_SEC);
  const substepSec = stepSec / substepCount;
  for (let substepIndex = 0; substepIndex < substepCount; substepIndex += 1) {
    const elapsedSec = substepIndex * substepSec;
    const sampledPlatforms = platforms ? projectSkyDashPlatforms(platforms, elapsedSec) : sampleSkyDashPlatforms(timeSec + elapsedSec, sampleSkyDashSeesaws(seesaws, elapsedSec));
    const speedScale = runner.action === "dash" && runner.actionTimeSec > 0 ? SKY_DASH_ACTION_SETTINGS.dashSpeedScale : 1;
    const controlScale = runner.hitSec > 0 || (runner.action === "dive" && runner.actionTimeSec > 0) ? 0 : 1;
    const previousZ = runner.z;
    characterController.step(runner, { x: moveX, z: moveZ, jump: Boolean(input.jump) && runner.hitSec <= 0 && runner.action !== "dive" }, substepSec, { platforms: sampledPlatforms, speedScale, controlScale });
    const sampledObstacles = obstacles ? projectSkyDashObstacles(obstacles, elapsedSec + substepSec) : sampleSkyDashObstacles(timeSec + elapsedSec + substepSec);
    resolveSkyDashObstacleContacts(runner, sampledObstacles, previousZ);
    const contactPlatforms = platforms ? projectSkyDashPlatforms(platforms, elapsedSec + substepSec) : sampleSkyDashPlatforms(timeSec + elapsedSec + substepSec, sampleSkyDashSeesaws(seesaws, elapsedSec + substepSec));
    characterController.step(runner, { x: 0, z: 0, jump: false }, 0, { platforms: contactPlatforms, controlScale: 0 });
    boundSkyDashRunnerVelocity(runner);
  }

  if (inputLength > 0.05 && runner.hitSec <= 0) runner.yaw = Math.atan2(directionX, -directionZ);
  if (runner.y < SKY_DASH_ACTION_SETTINGS.fallY) {
    beginSkyDashRespawn(runner);
  } else if (runner.hitSec > 0) {
    runner.action = "hit";
    runner.actionTimeSec = runner.hitSec;
  } else if (runner.action === "dive" && runner.grounded) {
    runner.actionTimeSec = 0;
    runner.action = inputLength > 0.05 ? "run" : "idle";
  } else if (runner.actionTimeSec <= 0 || (runner.action !== "dash" && runner.action !== "dive")) {
    runner.action = !runner.grounded ? "jump" : Math.hypot(runner.vx, runner.vz) > 0.25 ? "run" : "idle";
    runner.actionTimeSec = 0;
  }
}

/**
 * A deterministic reactive driver. It aims at the next platform's future center,
 * jumps at real ledges, and reads the same moving obstacles as human runners.
 * It only supplies supported input; it never changes position or race progress.
 * @param {SkyDashRound} round
 * @param {SkyDashRunner} bot
 * @returns {SkyDashInputState}
 */
export function createSkyDashBotInput(round, bot) {
  if (bot.finished || bot.action === "respawn" || !round.started || round.gameOver) return { ...SKY_DASH_INPUT_TEMPLATE };
  const platforms = sampleSkyDashPlatforms(round.timeSec, round.seesaws);
  let platformIndex = platforms.findIndex((platform) => platform.id === bot.supportId);
  if (platformIndex < 0) {
    platformIndex = platforms.findIndex((platform) => bot.z <= platform.z + platform.depth / 2 + CHARACTER_RADIUS && bot.z >= platform.z - platform.depth / 2 - CHARACTER_RADIUS);
  }
  if (platformIndex < 0) {
    platformIndex = platforms.findIndex((platform) => platform.z < bot.z);
  }
  if (platformIndex < 0) platformIndex = platforms.length - 1;
  const platform = platforms[platformIndex];
  const nextPlatform = platforms[Math.min(platformIndex + 1, platforms.length - 1)];
  const edgeZ = platform.z - platform.depth / 2;
  const edgeDistance = bot.z - edgeZ;
  const targetPlatform = edgeDistance < 4 || !bot.grounded ? nextPlatform : platform;
  const futurePlatform = sampleSkyDashPlatforms(round.timeSec + 0.35, sampleSkyDashSeesaws(round.seesaws, 0.15)).find((candidate) => candidate.id === targetPlatform.id) || targetPlatform;
  const laneOffset = targetPlatform.width < 10 ? 0 : (bot.slotIndex % 3 - 1) * 1.7;
  let targetX = futurePlatform.x + laneOffset;
  let jumpObstacle = false;
  let obstacleAhead = false;
  let waitForGate = false;
  for (const obstacle of sampleSkyDashObstacles(round.timeSec + 0.25)) {
    const forwardDistance = bot.z - obstacle.z;
    if (forwardDistance < -1 || forwardDistance > 8) continue;
    obstacleAhead = true;
    if (obstacle.kind === "sweeper" || obstacle.kind === "hurdle") {
      if (forwardDistance > 0 && forwardDistance < 2.6) jumpObstacle = true;
    } else if (obstacle.kind === "bumper") {
      if (forwardDistance > 0.2 && forwardDistance < 2.75) jumpObstacle = true;
    } else if (obstacle.kind === "gate") {
      targetX = obstacle.x + (bot.slotIndex % 5 - 2) * 0.8;
      if (forwardDistance > 0 && forwardDistance < 2.8) jumpObstacle = true;
      const arrivalSec = clampSkyDashNumber(forwardDistance / (SKY_DASH_CHARACTER_SETTINGS.moveSpeed * 0.94) + 0.08, 0.15, 0.9);
      const futureSpoke = sampleSkyDashObstacles(round.timeSec + arrivalSec).find((candidate) => candidate.kind === "gate-spoke" && candidate.z === obstacle.z);
      const gateOnCurrentPlatform = obstacle.z <= platform.z + platform.depth / 2 && obstacle.z >= platform.z - platform.depth / 2;
      if (futureSpoke && gateOnCurrentPlatform && bot.grounded && forwardDistance > 2.8 && forwardDistance < 5.5) {
        const jumpProbe = { ...bot, x: targetX, y: getSkyDashPlatformTopY(platform, bot.x, bot.z) + 1.6, z: obstacle.z };
        const spokeContact = getSkyDashObstacleAxisContact(jumpProbe, futureSpoke);
        waitForGate = spokeContact.distance < CHARACTER_RADIUS + futureSpoke.radius + 0.2;
      }
    } else if (obstacle.kind === "gate-spoke") {
      continue;
    } else if (targetPlatform.width >= 10 && forwardDistance < 6 && obstacle.y < bot.y + CHARACTER_HEIGHT + obstacle.radius) {
      targetX = obstacle.x > 0 ? -4.2 : 4.2;
    }
  }
  targetX = clampSkyDashNumber(targetX, targetPlatform.x - targetPlatform.width / 2 + 1, targetPlatform.x + targetPlatform.width / 2 - 1);
  const nextRearZ = nextPlatform.z + nextPlatform.depth / 2;
  const gapLength = edgeZ - nextRearZ;
  const jumpGap = platformIndex < platforms.length - 1 && gapLength > 0.25 && edgeDistance < 1.75 && edgeDistance > -0.4;
  const horizontalCorrection = clampSkyDashNumber((targetX - bot.x) * 0.85, -1, 1);
  return {
    moveX: horizontalCorrection,
    moveZ: waitForGate ? 0 : bot.z < -108 && bot.z > -128 ? 0.8 : 0.94 + (bot.slotIndex % 3) * 0.025,
    jump: !waitForGate && bot.grounded && !bot.jumpHeld && (jumpGap || jumpObstacle),
    dash: bot.grounded && edgeDistance > 14 && !obstacleAhead && bot.dashCooldownSec <= 0 && !bot.dashHeld,
    dive: false,
  };
}

/**
 * Pick a clear checkpoint spawn on its broad safe deck. Scoring is retained and
 * respawnId changes independently from checkpoint/progress identity.
 * @param {SkyDashRound} round
 * @param {SkyDashRunner} runner
 * @param {SkyDashRunner[]} runners
 * @param {SkyDashPlatform[]} platforms
 */
function respawnSkyDashRunner(round, runner, runners, platforms) {
  const checkpoint = SKY_DASH_CHECKPOINTS[runner.checkpoint];
  const platform = platforms.find((candidate) => candidate.id === checkpoint.platformId);
  let selectedX = checkpoint.x;
  let selectedZ = checkpoint.z + 1.4;
  let greatestClearance = -1;
  for (let candidateIndex = 0; candidateIndex < SKY_DASH_MAX_RUNNERS; candidateIndex += 1) {
    const spawnIndex = (candidateIndex + runner.slotIndex) % SKY_DASH_MAX_RUNNERS;
    const candidateX = checkpoint.x + (spawnIndex % 6 - 2.5) * 1.3;
    const candidateZ = checkpoint.z + 1.4 + Math.floor(spawnIndex / 6) * 1.4;
    let minimumClearance = Infinity;
    for (const otherRunner of runners) {
      if (otherRunner === runner || !otherRunner.connected || otherRunner.finished || otherRunner.action === "respawn") continue;
      minimumClearance = Math.min(minimumClearance, Math.hypot(otherRunner.x - candidateX, otherRunner.z - candidateZ));
    }
    if (minimumClearance > greatestClearance) {
      greatestClearance = minimumClearance;
      selectedX = candidateX;
      selectedZ = candidateZ;
    }
    if (minimumClearance > CHARACTER_DIAMETER + 0.2) break;
  }
  Object.assign(runner, {
    x: selectedX,
    y: platform ? getSkyDashPlatformTopY(platform, selectedX, selectedZ) : checkpoint.y,
    z: selectedZ,
    vx: 0,
    vy: 0,
    vz: 0,
    grounded: true,
    supportId: checkpoint.platformId,
    coyoteSec: 0,
    jumpBufferSec: 0,
    jumpHeld: false,
    dashHeld: false,
    diveHeld: false,
    action: "idle",
    actionTimeSec: 0,
    hitSec: 0,
    hitImmunitySec: 0.8,
    respawnSec: 0,
    respawnId: runner.respawnId + 1,
    lastProgressZ: selectedZ,
  });
}

/** @param {SkyDashRunner} runner @param {number} gateZ @param {number} maxTravelDistance @returns {boolean} */
function crossedSkyDashGate(runner, gateZ, maxTravelDistance) {
  return runner.lastProgressZ > gateZ && runner.z <= gateZ &&
    runner.lastProgressZ - runner.z <= maxTravelDistance;
}

/**
 * Validate ordered gate crossings against bounded locomotion plus the measured
 * authority contact correction. Dense crowd push-out must not invalidate a real
 * crossing, while an unrelated position discontinuity cannot skip the course.
 * @param {SkyDashRound} round
 * @param {SkyDashRunner} runner
 * @param {SkyDashPlatform[]} platforms
 * @param {number} dtSec
 * @param {number} contactTravelDistance
 */
function recordSkyDashRunnerProgress(round, runner, platforms, dtSec, contactTravelDistance) {
  if (runner.finished || runner.action === "respawn" || !runner.connected) return;
  const maxTravelDistance = SKY_DASH_ACTION_SETTINGS.maxHorizontalSpeed * dtSec + CHARACTER_DIAMETER + contactTravelDistance;
  const nextCheckpoint = SKY_DASH_CHECKPOINTS[runner.checkpoint + 1];
  if (nextCheckpoint && crossedSkyDashGate(runner, nextCheckpoint.z, maxTravelDistance)) {
    const gatePlatform = platforms.find((platform) => platform.id === nextCheckpoint.platformId);
    const gateTopY = gatePlatform ? getSkyDashPlatformTopY(gatePlatform, runner.x, runner.z) : 0;
    if (gatePlatform && Math.abs(runner.x - gatePlatform.x) <= gatePlatform.width / 2 - CHARACTER_RADIUS &&
        runner.y >= gateTopY - 0.15 && runner.y <= gateTopY + 3.8) {
      runner.checkpoint = nextCheckpoint.id;
    }
  }
  const checkpoint = SKY_DASH_CHECKPOINTS[runner.checkpoint];
  const nextGateZ = SKY_DASH_CHECKPOINTS[runner.checkpoint + 1]?.z ?? SKY_DASH_FINISH_Z;
  const legProgress = clampSkyDashNumber((checkpoint.z - runner.z) / (checkpoint.z - nextGateZ), 0, 0.999);
  runner.progress = runner.checkpoint + legProgress;
  if (runner.checkpoint === SKY_DASH_CHECKPOINTS.length - 1 && crossedSkyDashGate(runner, SKY_DASH_FINISH_Z, maxTravelDistance)) {
    const finishPlatform = platforms[platforms.length - 1];
    const finishTopY = getSkyDashPlatformTopY(finishPlatform, runner.x, runner.z);
    if (Math.abs(runner.x - finishPlatform.x) <= finishPlatform.width / 2 - CHARACTER_RADIUS &&
        runner.y >= finishTopY - 0.15 && runner.y <= finishTopY + 3.8) {
      const crossedFraction = clampSkyDashNumber((runner.lastProgressZ - SKY_DASH_FINISH_Z) / Math.max(TIME_EPSILON_SEC, runner.lastProgressZ - runner.z), 0, 1);
      runner.finished = true;
      runner.finishTimeSec = round.timeSec + dtSec * crossedFraction;
      runner.progress = SKY_DASH_CHECKPOINTS.length;
      runner.action = "finish";
      runner.actionTimeSec = 0;
      runner.vx = 0;
      runner.vy = 0;
      runner.vz = 0;
    }
  }
  runner.lastProgressZ = runner.z;
}

/** @param {SkyDashRound} round @param {SkyDashRunner[]} runners */
function updateSkyDashStandings(round, runners) {
  const orderedRunners = [...runners].sort((firstRunner, secondRunner) => {
    if (firstRunner.finished !== secondRunner.finished) return firstRunner.finished ? -1 : 1;
    if (firstRunner.finished) return firstRunner.finishTimeSec - secondRunner.finishTimeSec || firstRunner.slotIndex - secondRunner.slotIndex;
    return secondRunner.checkpoint - firstRunner.checkpoint || secondRunner.progress - firstRunner.progress || firstRunner.slotIndex - secondRunner.slotIndex;
  });
  for (let rankIndex = 0; rankIndex < orderedRunners.length; rankIndex += 1) {
    const runner = orderedRunners[rankIndex];
    runner.rank = rankIndex + 1;
    Object.assign(round.standings[rankIndex], createSkyDashStanding(runner));
  }
}

/**
 * Integrate bounded weight torque and a damped return spring once per authority
 * tick. Runner movement already sampled the old angular velocity; carry only
 * the remaining change from that predicted top to the new authoritative top.
 * @param {SkyDashRound} round
 * @param {SkyDashRunner[]} runners
 * @param {SkyDashPlatform[]} predictedPlatforms End-of-step extrapolated poses.
 * @param {number} dtSec
 * @returns {SkyDashPlatform[]} Authoritative end-of-step platform poses.
 */
function stepSkyDashSeesawWorld(round, runners, predictedPlatforms, dtSec) {
  for (const seesaw of round.seesaws) {
    const platform = predictedPlatforms.find((candidate) => candidate.id === seesaw.platformId);
    let occupantTorque = 0;
    for (const runner of runners) {
      if (!runner.connected || runner.finished || !runner.grounded || runner.supportId !== seesaw.platformId || runner.action === "respawn") continue;
      const normalizedLever = clampSkyDashNumber((runner.x - platform.x) / (platform.width / 2), -1, 1);
      occupantTorque -= normalizedLever * SKY_DASH_SEESAW_SETTINGS.weightTorque;
    }
    const angularAcceleration = occupantTorque - seesaw.angle * SKY_DASH_SEESAW_SETTINGS.returnSpring - seesaw.angularVelocity * SKY_DASH_SEESAW_SETTINGS.damping;
    seesaw.angularVelocity = clampSkyDashNumber(seesaw.angularVelocity + angularAcceleration * dtSec, -SKY_DASH_SEESAW_SETTINGS.maxAngularVelocityRadSec, SKY_DASH_SEESAW_SETTINGS.maxAngularVelocityRadSec);
    const nextAngle = seesaw.angle + seesaw.angularVelocity * dtSec;
    seesaw.angle = clampSkyDashNumber(nextAngle, -SKY_DASH_SEESAW_SETTINGS.maxAngleRad, SKY_DASH_SEESAW_SETTINGS.maxAngleRad);
    if (seesaw.angle !== nextAngle) seesaw.angularVelocity = 0;
  }
  const authoritativePlatforms = sampleSkyDashPlatforms(round.timeSec + dtSec, round.seesaws);
  for (const runner of runners) {
    if (!runner.connected || !runner.grounded || runner.action === "respawn") continue;
    const previousSupport = predictedPlatforms.find((platform) => platform.id === runner.supportId);
    const nextSupport = authoritativePlatforms.find((platform) => platform.id === runner.supportId);
    if (!previousSupport?.seesaw || !nextSupport) continue;
    const previousTopY = getSkyDashPlatformTopY(previousSupport, runner.x, runner.z);
    if (Math.abs(runner.y - previousTopY) > 0.1) continue;
    runner.y += getSkyDashPlatformTopY(nextSupport, runner.x, runner.z) - previousTopY;
    characterController.step(runner, { x: 0, z: 0, jump: false }, 0, { platforms: authoritativePlatforms, controlScale: 0 });
  }
  return authoritativePlatforms;
}

/**
 * Advance bots, shared contact/progress and race time once after human commands.
 * Human and bot movement sample the same pre-step course clock. Idle, paused and
 * completed rounds perform no gameplay mutations. No browser/server globals are
 * required, making this also the deterministic offline race entry point.
 * @param {SkyDashRound} round
 * @param {number} dtSec
 */
export function stepSkyDashWorld(round, dtSec) {
  if (!round.started || round.gameOver) return;
  const stepSec = getSkyDashStepDuration(dtSec);
  if (stepSec <= 0) return;
  for (const bot of round.bots) {
    stepSkyDashRunner(bot, createSkyDashBotInput(round, bot), stepSec, { active: true, timeSec: round.timeSec, seesaws: round.seesaws });
  }
  const predictedSeesaws = sampleSkyDashSeesaws(round.seesaws, stepSec);
  let platforms = sampleSkyDashPlatforms(round.timeSec + stepSec, predictedSeesaws);
  const obstacles = sampleSkyDashObstacles(round.timeSec + stepSec);
  const runners = [...Object.values(round.players), ...round.bots];
  const activeRunners = runners.filter((runner) => runner.connected && !runner.finished && runner.action !== "respawn");
  const contactStartPositions = new Map(activeRunners.map((runner) => [runner, { x: runner.x, z: runner.z }]));
  for (let contactPass = 0; contactPass < 3; contactPass += 1) {
    resolveKinematicCharacterSeparation(activeRunners, { radius: CHARACTER_RADIUS, height: CHARACTER_HEIGHT, iterations: 12 });
    for (const runner of activeRunners) {
      resolveSkyDashObstacleContacts(runner, obstacles, contactStartPositions.get(runner)?.z ?? runner.z);
      characterController.step(runner, { x: 0, z: 0, jump: false }, 0, { platforms, controlScale: 0 });
    }
  }
  platforms = stepSkyDashSeesawWorld(round, runners, platforms, stepSec);
  for (const runner of runners) {
    if (runner.action === "respawn" && runner.respawnSec <= TIME_EPSILON_SEC) respawnSkyDashRunner(round, runner, runners, platforms);
    const contactStart = contactStartPositions.get(runner);
    const contactTravelDistance = contactStart ? Math.hypot(runner.x - contactStart.x, runner.z - contactStart.z) : 0;
    recordSkyDashRunnerProgress(round, runner, platforms, stepSec, contactTravelDistance);
  }
  updateSkyDashStandings(round, runners);
  round.timeSec += stepSec;
  round.timer = Math.max(0, round.timer - stepSec);
  if (round.timer <= TIME_EPSILON_SEC || Object.values(round.players).every((runner) => runner.finished)) {
    if (round.timer <= TIME_EPSILON_SEC) round.timer = 0;
    round.gameOver = true;
    round.winner = round.standings[0].id;
  }
}
