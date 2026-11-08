import { SKY_DASH_SEESAW_SETTINGS } from "./config.js";
export { getKinematicPlatformTopY as getSkyDashPlatformTopY } from "../../../platform/shared/kinematicCharacter.js";

/**
 * Shared collision geometry and analytic obstacle motion. Course runs toward -Z;
 * platform Y is its walkable top, while renderer thickness extends below it.
 * @typedef {{platformId:number,angle:number,angularVelocity:number}} SkyDashSeesaw
 * @typedef {{id:number,x:number,z:number,width:number,depth:number,topY:number,thickness:number,vx:number,vy:number,vz:number,slopeX:number,slopeZ:number,seesaw?:boolean}} SkyDashPlatform
 * @typedef {{id:number,kind:"sweeper"|"hammer"|"bumper"|"hurdle"|"gate"|"gate-spoke",x:number,y:number,z:number,ax:number,ay:number,az:number,bx:number,by:number,bz:number,radius:number,vx:number,vy:number,vz:number,angle:number,angularSpeed:number,openingRadius?:number,frameWidth?:number,frameBottomY?:number,frameTopY?:number,depth?:number}} SkyDashObstacle
 */
export const SKY_DASH_PLATFORMS = Object.freeze([
  { id: 1, x: 0, z: -4, width: 16, depth: 24, topY: 0, thickness: 1.6, color: "#48c9cc" },
  { id: 2, x: 0, z: -29, width: 16, depth: 22, topY: 0.3, thickness: 1.5, color: "#a894ee" },
  { id: 3, x: 0, z: -45, width: 6.5, depth: 5, topY: 0.6, thickness: 1.25, color: "#ffd17d", amplitude: 1.5, frequency: 0.65, phase: 0, seesaw: true },
  { id: 4, x: 0, z: -52, width: 6.5, depth: 5, topY: 0.9, thickness: 1.25, color: "#ff9a8b", amplitude: 1.8, frequency: 0.65, phase: 1.2, seesaw: true },
  { id: 5, x: 0, z: -59, width: 6.5, depth: 5, topY: 1.2, thickness: 1.25, color: "#ffd17d", amplitude: 1.5, frequency: 0.65, phase: 2.4, seesaw: true },
  { id: 6, x: 0, z: -68, width: 16, depth: 9, topY: 1.2, thickness: 1.6, color: "#48c9cc" },
  { id: 7, x: 0, z: -83, width: 16, depth: 19, topY: 1.2, thickness: 1.6, color: "#ef9aaf" },
  { id: 8, x: 0, z: -100, width: 16, depth: 10, topY: 1.2, thickness: 1.6, color: "#48c9cc" },
  { id: 9, x: 0, z: -116, width: 12, depth: 16, topY: 1.2, thickness: 1.6, color: "#a894ee" },
  { id: 10, x: 0, z: -133, width: 17, depth: 14, topY: 1.2, thickness: 1.8, color: "#ffd17d" },
].map((platform) => Object.freeze(platform)));

export const SKY_DASH_CHECKPOINTS = Object.freeze([
  { id: 0, x: 0, y: 0.02, z: 1, platformId: 1, label: "Launch pad" },
  { id: 1, x: 0, y: 0.32, z: -36, platformId: 2, label: "Spin city" },
  { id: 2, x: 0, y: 1.22, z: -68, platformId: 6, label: "Cloud crossing" },
  { id: 3, x: 0, y: 1.22, z: -100, platformId: 8, label: "Bumper boulevard" },
].map((checkpoint) => Object.freeze(checkpoint)));

export const SKY_DASH_OBSTACLES = Object.freeze([
  { id: 1, kind: "sweeper", x: 0, y: 0.98, z: -25, halfLength: 5.8, radius: 0.32, angularSpeed: 1.12, phase: 0.2, color: "#ff875f" },
  { id: 2, kind: "sweeper", x: 0, y: 0.98, z: -33, halfLength: 5.8, radius: 0.32, angularSpeed: -1.32, phase: 1.3, color: "#ffd066" },
  { id: 3, kind: "hammer", x: -2.8, y: 6.9, z: -80, length: 4.6, radius: 1.05, angularSpeed: 1.35, phase: 0.5, color: "#ffca61" },
  { id: 4, kind: "hammer", x: 2.8, y: 6.9, z: -87, length: 4.6, radius: 1.05, angularSpeed: 1.45, phase: 2.1, color: "#9a81ed" },
  { id: 5, kind: "bumper", x: 0, y: 1.95, z: -114, amplitude: 3.8, radius: 1, angularSpeed: 1.5, phase: 0.8, color: "#ff977f" },
  { id: 6, kind: "bumper", x: 0, y: 1.95, z: -121, amplitude: 3.8, radius: 1, angularSpeed: 1.7, phase: 2.5, color: "#ffd066" },
  { id: 7, kind: "hurdle", x: 0, y: 0.72, z: -8, ax: -8.2, bx: 8.2, radius: 0.25, angularSpeed: 0, phase: 0, color: "#ff946f" },
  { id: 8, kind: "hurdle", x: 0, y: 1.92, z: -76, ax: -8.2, bx: 8.2, radius: 0.25, angularSpeed: 0, phase: 0, color: "#ffcf62" },
  { id: 9, kind: "gate", x: 0, y: 4.95, z: -84, openingRadius: 3.45, radius: 0.24, frameWidth: 16, frameBottomY: 1.2, frameTopY: 9.1, depth: 0.48, angularSpeed: 0, phase: 0, color: "#8777de" },
  { id: 10, kind: "gate-spoke", x: 0, y: 4.95, z: -84, length: 3.15, radius: 0.23, angularSpeed: 0.8, phase: 0.2, color: "#ffcf62" },
  { id: 11, kind: "gate", x: 0, y: 4.95, z: -130, openingRadius: 3.45, radius: 0.24, frameWidth: 17, frameBottomY: 1.2, frameTopY: 9.1, depth: 0.48, angularSpeed: 0, phase: 0, color: "#4ccbd0" },
  { id: 12, kind: "gate-spoke", x: 0, y: 4.95, z: -130, length: 3.15, radius: 0.23, angularSpeed: -0.7, phase: 2, color: "#ff946f" },
].map((obstacle) => Object.freeze(obstacle)));

/** @returns {SkyDashSeesaw[]} Independent fixed state, including neutral leaves from the first snapshot. */
export function createSkyDashSeesaws() {
  return SKY_DASH_SEESAW_SETTINGS.platformIds.map((platformId) => ({ platformId, angle: 0, angularVelocity: 0 }));
}

/**
 * Extrapolate an authoritative sample without inventing future occupant weight.
 * One prediction horizon is bounded to 150ms and all angles remain physical.
 * @param {readonly SkyDashSeesaw[]} seesaws
 * @param {number} dtSec
 * @returns {SkyDashSeesaw[]}
 */
export function sampleSkyDashSeesaws(seesaws, dtSec) {
  const elapsedSec = Number.isFinite(dtSec) ? Math.max(0, Math.min(SKY_DASH_SEESAW_SETTINGS.maxPredictionSec, dtSec)) : 0;
  return seesaws.map((seesaw) => {
    const extrapolatedAngle = seesaw.angle + seesaw.angularVelocity * elapsedSec;
    const angle = Math.max(-SKY_DASH_SEESAW_SETTINGS.maxAngleRad, Math.min(SKY_DASH_SEESAW_SETTINGS.maxAngleRad, extrapolatedAngle));
    const angularVelocity = angle !== extrapolatedAngle ? 0 : seesaw.angularVelocity;
    return { platformId: seesaw.platformId, angle, angularVelocity };
  });
}

/**
 * @param {number} timeSec
 * @param {readonly SkyDashSeesaw[]} [seesaws] Already sampled/extrapolated tilt.
 * @returns {SkyDashPlatform[]} New values; configuration and seesaws stay immutable.
 */
export function sampleSkyDashPlatforms(timeSec, seesaws = []) {
  return SKY_DASH_PLATFORMS.map((platform) => {
    const phase = (platform.frequency || 0) * timeSec + (platform.phase || 0);
    return {
      ...platform,
      x: platform.x + (platform.amplitude || 0) * Math.sin(phase),
      vx: (platform.amplitude || 0) * (platform.frequency || 0) * Math.cos(phase),
      vy: 0,
      vz: 0,
      slopeX: Math.tan(seesaws.find((seesaw) => seesaw.platformId === platform.id)?.angle || 0),
      slopeZ: 0,
    };
  });
}

/** @param {number} timeSec @returns {SkyDashObstacle[]} Matching geometry for authority, prediction and renderers. */
export function sampleSkyDashObstacles(timeSec) {
  return SKY_DASH_OBSTACLES.map((obstacle) => {
    const phase = timeSec * obstacle.angularSpeed + obstacle.phase;
    if (obstacle.kind === "sweeper") {
      const offsetX = Math.cos(phase) * obstacle.halfLength;
      const offsetZ = Math.sin(phase) * obstacle.halfLength;
      return { ...obstacle, ax: obstacle.x - offsetX, ay: obstacle.y, az: obstacle.z - offsetZ, bx: obstacle.x + offsetX, by: obstacle.y, bz: obstacle.z + offsetZ, vx: 0, vy: 0, vz: 0, angle: phase };
    }
    if (obstacle.kind === "hammer") {
      const angle = Math.sin(phase) * 0.95;
      const angularVelocity = Math.cos(phase) * obstacle.angularSpeed * 0.95;
      const x = obstacle.x + Math.sin(angle) * obstacle.length;
      const y = obstacle.y - Math.cos(angle) * obstacle.length;
      return { ...obstacle, x, y, ax: x, ay: y, az: obstacle.z, bx: x, by: y, bz: obstacle.z, vx: Math.cos(angle) * obstacle.length * angularVelocity, vy: Math.sin(angle) * obstacle.length * angularVelocity, vz: 0, angle };
    }
    if (obstacle.kind === "gate-spoke") {
      return { ...obstacle, ax: obstacle.x, ay: obstacle.y, az: obstacle.z, bx: obstacle.x + Math.cos(phase) * obstacle.length, by: obstacle.y + Math.sin(phase) * obstacle.length, bz: obstacle.z, vx: 0, vy: 0, vz: 0, angle: phase };
    }
    if (obstacle.kind === "hurdle" || obstacle.kind === "gate") {
      return { ...obstacle, ax: obstacle.ax ?? obstacle.x, ay: obstacle.y, az: obstacle.z, bx: obstacle.bx ?? obstacle.x, by: obstacle.y, bz: obstacle.z, vx: 0, vy: 0, vz: 0, angle: phase };
    }
    const x = obstacle.x + Math.sin(phase) * obstacle.amplitude;
    return { ...obstacle, x, ax: x, ay: obstacle.y, az: obstacle.z, bx: x, by: obstacle.y, bz: obstacle.z, vx: Math.cos(phase) * obstacle.angularSpeed * obstacle.amplitude, vy: 0, vz: 0, angle: phase };
  });
}
