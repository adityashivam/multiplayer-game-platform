import { SKY_DASH_CHARACTER_SETTINGS } from "../shared/config.js";

/** @typedef {"low"|"medium"|"high"} SkyDashRenderQuality */
/** @typedef {{autoTier?:"low"|"medium"|"balanced",autoLowEndActive?:boolean,resolutionScale?:number,targetFps?:number,reducedEffects?:boolean}} SkyDashQualityProfile */
/** @typedef {{bodyX:number,bodyY:number,bodyZ:number,bodyScaleX:number,bodyScaleY:number,bodyScaleZ:number,bob:number,leftArmX:number,rightArmX:number,leftArmZ:number,rightArmZ:number,leftLegX:number,rightLegX:number,leftKneeX:number,rightKneeX:number,eyeScaleY:number}} SkyDashRunnerPose */

/**
 * Writes a deck's world matrix about its walkable top center. A shear preserves
 * the SDK's projected width/depth and vertical thickness on sloped platforms.
 * @param {{x:number,topY:number,z:number,slopeX?:number,slopeZ?:number}} platform
 * @param {number[]|Float32Array} elements Caller-owned column-major matrix buffer.
 * @returns {number[]|Float32Array} The same output buffer.
 */
export function writeSkyDashPlatformTransform(platform, elements) {
  elements[0] = 1;
  elements[1] = platform.slopeX || 0;
  elements[2] = 0;
  elements[3] = 0;
  elements[4] = 0;
  elements[5] = 1;
  elements[6] = 0;
  elements[7] = 0;
  elements[8] = 0;
  elements[9] = platform.slopeZ || 0;
  elements[10] = 1;
  elements[11] = 0;
  elements[12] = platform.x;
  elements[13] = platform.topY;
  elements[14] = platform.z;
  elements[15] = 1;
  return elements;
}

/**
 * Aligns the shared unit-Y cylinder to a canonical 3D capsule segment. Its
 * hemispherical endpoint meshes use the same sample and radius independently.
 * @param {{ax:number,ay:number,az:number,bx:number,by:number,bz:number,radius:number}} segment
 * @param {number[]|Float32Array} elements Caller-owned column-major matrix buffer.
 * @returns {number[]|Float32Array} The same output buffer.
 */
export function writeSkyDashSegmentTransform(segment, elements) {
  const deltaX = segment.bx - segment.ax;
  const deltaY = segment.by - segment.ay;
  const deltaZ = segment.bz - segment.az;
  const length = Math.hypot(deltaX, deltaY, deltaZ);
  const directionX = length ? deltaX / length : 0;
  const directionY = length ? deltaY / length : 1;
  const directionZ = length ? deltaZ / length : 0;
  const projectedLength = Math.hypot(directionX, directionY);
  const basisX = projectedLength ? directionY / projectedLength : 1;
  const basisY = projectedLength ? -directionX / projectedLength : 0;

  elements[0] = basisX * segment.radius;
  elements[1] = basisY * segment.radius;
  elements[2] = 0;
  elements[3] = 0;
  elements[4] = deltaX;
  elements[5] = deltaY;
  elements[6] = deltaZ;
  elements[7] = 0;
  elements[8] = basisY * directionZ * segment.radius;
  elements[9] = -basisX * directionZ * segment.radius;
  elements[10] = (basisX * directionY - basisY * directionX) * segment.radius;
  elements[11] = 0;
  elements[12] = (segment.ax + segment.bx) * 0.5;
  elements[13] = (segment.ay + segment.by) * 0.5;
  elements[14] = (segment.az + segment.bz) * 0.5;
  elements[15] = 1;
  return elements;
}

/**
 * Tests the view segment against a gate wall with clearance for the runner's
 * silhouette. Upcoming gates remain solid; only a wall behind the runner fades.
 * @param {{x:number,y:number,z:number,openingRadius:number,frameWidth:number,frameBottomY:number,frameTopY:number,depth?:number}} gate
 * @param {{x:number,y:number,z:number}} cameraPosition
 * @param {{x:number,y:number,z:number}} runnerState
 * @returns {boolean}
 */
export function shouldFadeSkyDashGate(gate, cameraPosition, runnerState) {
  const clearedGateZ = gate.z - (gate.depth || 0) * 0.5 - SKY_DASH_CHARACTER_SETTINGS.radius;
  if (runnerState.z >= clearedGateZ || cameraPosition.z <= gate.z) return false;
  const viewDeltaZ = runnerState.z - cameraPosition.z;
  if (Math.abs(viewDeltaZ) < 0.0001) return false;
  const intersectionRatio = (gate.z - cameraPosition.z) / viewDeltaZ;
  if (intersectionRatio <= 0 || intersectionRatio >= 1) return false;
  const intersectionX = cameraPosition.x + (runnerState.x - cameraPosition.x) * intersectionRatio;
  const intersectionY = cameraPosition.y + (runnerState.y + SKY_DASH_CHARACTER_SETTINGS.height * 0.5 - cameraPosition.y) * intersectionRatio;
  if (Math.abs(intersectionX - gate.x) > gate.frameWidth * 0.5 || intersectionY < gate.frameBottomY || intersectionY > gate.frameTopY) return false;
  return Math.hypot(intersectionX - gate.x, intersectionY - gate.y) > gate.openingRadius - 0.5;
}

/** Follows the short arc when a heading crosses the -PI/PI seam. */
export function interpolateSkyDashAngle(current, target, blend) {
  return current + Math.atan2(Math.sin(target - current), Math.cos(target - current)) * Math.max(0, Math.min(1, blend));
}

/** @param {SkyDashRenderQuality|SkyDashQualityProfile} profile */
export function resolveSkyDashQuality(profile) {
  let quality = "high";
  let resolutionScale = 1;
  if (typeof profile === "string") {
    quality = profile === "low" || profile === "medium" ? profile : "high";
  } else {
    const lowEffects = profile?.autoLowEndActive || profile?.autoTier === "low" || profile?.resolutionScale <= 0.6;
    const mediumEffects = profile?.autoTier === "medium" || profile?.reducedEffects || profile?.targetFps <= 45;
    quality = lowEffects ? "low" : mediumEffects ? "medium" : "high";
    resolutionScale = Number.isFinite(profile?.resolutionScale) ? Math.max(0.6, Math.min(1, profile.resolutionScale)) : 1;
  }
  return {
    quality,
    resolutionScale,
    maxPixelRatio: quality === "low" ? 1 : quality === "medium" ? 1.35 : 1.7,
    shadows: quality !== "low",
    shadowMapSize: quality === "high" ? 2048 : 1024,
    particleLimit: quality === "high" ? 96 : quality === "medium" ? 48 : 16,
  };
}

/** Creates a reusable pose record; callers can fill it without frame allocations. */
export function createSkyDashRunnerPose() {
  return {
    bodyX: 0, bodyY: 0, bodyZ: 0,
    bodyScaleX: 1, bodyScaleY: 1, bodyScaleZ: 1,
    bob: 0,
    leftArmX: 0, rightArmX: 0, leftArmZ: 0, rightArmZ: 0,
    leftLegX: 0, rightLegX: 0, leftKneeX: 0, rightKneeX: 0,
    eyeScaleY: 1,
  };
}

/**
 * Authored joint clips only change visual transforms, never simulation fields.
 * The caller advances gait/action clocks at render cadence between snapshots.
 * @param {{action?:string,grounded?:boolean,vx?:number,vy?:number,vz?:number,finished?:boolean,hitSec?:number,respawnSec?:number}} runnerState
 * @param {{timeSec:number,gaitPhase:number,actionElapsedSec:number,seed:number,reducedMotion:boolean}} clocks
 * @param {SkyDashRunnerPose} pose Mutated output owned by the caller.
 * @returns {SkyDashRunnerPose}
 */
export function sampleSkyDashRunnerPose(runnerState, clocks, pose) {
  const { timeSec, gaitPhase, actionElapsedSec, seed, reducedMotion } = clocks;
  const speed = Math.hypot(runnerState.vx || 0, runnerState.vz || 0);
  const locomotion = Math.min(1, speed / 8.6);
  const stride = Math.sin(gaitPhase);
  const motionScale = reducedMotion ? 0.5 : 1;
  const action = runnerState.finished ? "finish" : runnerState.respawnSec > 0 ? "respawn" : runnerState.action || "idle";

  pose.bodyX = -locomotion * 0.12;
  pose.bodyY = 0;
  pose.bodyZ = Math.cos(gaitPhase) * locomotion * 0.055 * motionScale;
  pose.bodyScaleX = 1;
  pose.bodyScaleY = 1;
  pose.bodyScaleZ = 1;
  pose.bob = runnerState.grounded ? Math.abs(stride) * locomotion * 0.065 * motionScale : 0;
  pose.leftArmX = stride * locomotion * 0.7;
  pose.rightArmX = -stride * locomotion * 0.7;
  pose.leftArmZ = 0.16;
  pose.rightArmZ = -0.16;
  pose.leftLegX = -stride * locomotion * 0.7;
  pose.rightLegX = stride * locomotion * 0.7;
  pose.leftKneeX = Math.max(0, stride) * locomotion * 0.7;
  pose.rightKneeX = Math.max(0, -stride) * locomotion * 0.7;
  const blinkPhase = (timeSec + seed * 1.37) % 4.9;
  pose.eyeScaleY = blinkPhase > 4.75 ? 0.12 : 1;

  if (!runnerState.grounded || action === "jump") {
    const launchSquash = Math.max(0, 1 - actionElapsedSec / 0.11);
    pose.bodyScaleX = 1 + launchSquash * 0.12;
    pose.bodyScaleY = 1 - launchSquash * 0.16;
    pose.bodyX = (runnerState.vy || 0) > 0 ? -0.12 : 0.12;
    pose.leftArmX = -1.5;
    pose.rightArmX = -1.35;
    pose.leftArmZ = 0.6;
    pose.rightArmZ = -0.6;
    pose.leftLegX = -0.35;
    pose.rightLegX = 0.38;
    pose.leftKneeX = 0.7;
    pose.rightKneeX = 0.9;
    pose.bob = 0;
  }
  if (action === "dash") {
    pose.bodyX = -0.5;
    pose.bodyScaleZ = 1.12;
    pose.bodyScaleY = 0.92;
    pose.leftArmX = 1.05;
    pose.rightArmX = 1.05;
    pose.leftArmZ = 0.24;
    pose.rightArmZ = -0.24;
    pose.leftLegX = -stride * 1.05;
    pose.rightLegX = stride * 1.05;
  }
  if (action === "dive") {
    pose.bodyX = -1.35;
    pose.bodyScaleZ = 1.08;
    pose.bodyScaleY = 1.08;
    pose.bob = -0.14;
    pose.leftArmX = -2.55;
    pose.rightArmX = -2.55;
    pose.leftArmZ = 0.12;
    pose.rightArmZ = -0.12;
    pose.leftLegX = 0.45;
    pose.rightLegX = 0.52;
    pose.leftKneeX = 0.2;
    pose.rightKneeX = 0.32;
  }
  if (action === "hit" || (runnerState.hitSec || 0) > 0) {
    const tumble = actionElapsedSec * 12;
    pose.bodyX = reducedMotion ? -0.55 : -0.55 - tumble;
    pose.bodyZ = reducedMotion ? 0.3 : Math.sin(tumble) * 0.55;
    pose.bodyScaleX = 1.1;
    pose.bodyScaleY = 0.9;
    pose.leftArmX = -1.3 + Math.sin(tumble) * 0.6;
    pose.rightArmX = -1.2 - Math.sin(tumble) * 0.6;
    pose.leftArmZ = 0.9;
    pose.rightArmZ = -0.9;
    pose.leftLegX = -0.7;
    pose.rightLegX = 0.65;
    pose.leftKneeX = 0.7;
    pose.rightKneeX = 0.9;
    pose.eyeScaleY = 0.42;
  }
  if (action === "respawn") {
    const pop = Math.max(0, Math.min(1, actionElapsedSec / 0.3));
    pose.bodyX = 0;
    pose.bodyZ = 0;
    pose.bodyScaleX = 1.18 - pop * 0.18;
    pose.bodyScaleY = 0.72 + Math.sin(pop * Math.PI * 0.5) * 0.28;
    pose.bob = Math.sin(pop * Math.PI) * 0.18 * motionScale;
    pose.leftArmZ = 0.8 * (1 - pop);
    pose.rightArmZ = -pose.leftArmZ;
  }
  if (action === "finish") {
    const cheer = Math.sin(actionElapsedSec * 7);
    pose.bodyX = 0;
    pose.bodyY = Math.sin(actionElapsedSec * 2.5) * 0.25 * motionScale;
    pose.bodyZ = cheer * 0.1 * motionScale;
    pose.bob = Math.abs(cheer) * 0.19 * motionScale;
    pose.leftArmX = -0.1;
    pose.rightArmX = -0.1;
    pose.leftArmZ = 2.55;
    pose.rightArmZ = -2.55;
    pose.leftLegX = 0;
    pose.rightLegX = 0;
    pose.leftKneeX = 0;
    pose.rightKneeX = 0;
    pose.eyeScaleY = 0.75;
  }
  return pose;
}

/**
 * Camera anchors stay above course architecture and stop following a fall into
 * the abyss. The collider origin and an ahead-facing view survive portrait hosts.
 * @param {{x:number,y:number,z:number}} runnerState
 * @param {{aspect:number,orbit:number,groundY:number}} settings
 */
export function getSkyDashCameraTargets(runnerState, { aspect, orbit, groundY }) {
  const portraitScale = Math.max(1, Math.min(1.65, 1 / Math.max(0.45, aspect)));
  const orbitAngle = Math.max(-1.1, Math.min(1.1, Number.isFinite(orbit) ? orbit : 0));
  const distance = 10.8 * portraitScale;
  const followedY = Math.max(groundY - 0.35, Math.min(groundY + 2.2, runnerState.y));
  const shoulder = aspect >= 1.1 ? 1.65 : 0.35;

  return {
    x: runnerState.x + Math.sin(orbitAngle) * distance + Math.cos(orbitAngle) * shoulder,
    y: followedY + 6.7 + (portraitScale - 1) * 3.5,
    z: runnerState.z + Math.cos(orbitAngle) * distance - Math.sin(orbitAngle) * shoulder,
    targetX: runnerState.x - Math.sin(orbitAngle) * 3.2,
    targetY: followedY + 1.25,
    targetZ: runnerState.z - Math.cos(orbitAngle) * 4.7,
  };
}
