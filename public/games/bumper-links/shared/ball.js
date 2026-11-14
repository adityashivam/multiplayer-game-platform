import { createSphereBodyController } from "../../../platform/shared/sphereBody.js";
import { BUMPER_LINKS_BALL_SETTINGS, BUMPER_LINKS_CUP, BUMPER_LINKS_MATCH_SETTINGS, BUMPER_LINKS_SWEEPER } from "./config.js";
import { getBumperLinksSweeperSegment, listBumperLinksNearbySolids } from "./course.js";

/** @typedef {import("./course.js").BumperLinksCourse} BumperLinksCourse */
/** @typedef {import("../../../platform/shared/sphereBody.js").SphereSolid} SphereSolid */
/**
 * One golf ball. Position and velocity field names match the platform
 * sphere body so the controller steps it in place.
 * @typedef {object} BumperLinksBall
 * @property {string} id
 * @property {number} slotIndex Stable colour and spawn index.
 * @property {number} x @property {number} y @property {number} z
 * @property {number} vx @property {number} vy @property {number} vz
 * @property {number} restX @property {number} restY @property {number} restZ Last resting spot; water returns here.
 * @property {boolean} atRest Only a resting ball can be shot.
 * @property {number} aimYaw Latest aim, shown to rivals.
 * @property {number} strokes This hole, including penalties.
 * @property {number} totalStrokes Completed holes.
 * @property {boolean} sunk
 * @property {number} sinkOrder 1 for the first ball in this hole; 0 while out.
 * @property {number} holePoints Points earned this hole so far.
 * @property {number} points Points banked from finished holes.
 * @property {number} knockouts Rivals sent into the water this match.
 * @property {number} splashes Times this ball went into the water this match.
 * @property {string|null} lastHitById The ball that last struck this one.
 * @property {number} lastHitAgeSec
 * @property {number} shotId Increments per shot; presentation keys sounds on it.
 * @property {number} lifeId Increments on every teleport (hole start, water).
 * @property {boolean} connected Humans only change this; bots stay true.
 */

const SUPPORT_TOLERANCE_M = 0.04;
const MAX_VERTICAL_REST_SPEED = 0.5;
const SWEEPER_RESTITUTION = 0.6;
const CUP_CAPTURE_HEIGHT_M = 0.15;
const ballSphere = createSphereBodyController({
  radius: BUMPER_LINKS_BALL_SETTINGS.radius,
  gravity: BUMPER_LINKS_BALL_SETTINGS.gravity,
  restitution: BUMPER_LINKS_BALL_SETTINGS.restitution,
  floorRestitution: BUMPER_LINKS_BALL_SETTINGS.floorRestitution,
  linearDamping: BUMPER_LINKS_BALL_SETTINGS.linearDamping,
  groundFriction: 0,
  restSpeed: BUMPER_LINKS_BALL_SETTINGS.restSpeed,
  maxSpeed: BUMPER_LINKS_BALL_SETTINGS.maxSpeed,
  maxDtSec: BUMPER_LINKS_BALL_SETTINGS.maxDtSec,
  maxSubsteps: BUMPER_LINKS_BALL_SETTINGS.maxSubsteps,
});
/** Reused per step; simulation never runs two balls concurrently. */
const nearbySolids = /** @type {SphereSolid[]} */ ([]);
const sweeperSegment = { ax: 0, az: 0, bx: 0, bz: 0, angle: 0 };
const sphereContext = { solids: nearbySolids };

/**
 * @param {string} id
 * @param {number} slotIndex
 * @param {{x:number,y:number,z:number}} spawn
 * @param {{human:boolean}} seat Humans start disconnected until they join.
 * @returns {BumperLinksBall}
 */
export function createBumperLinksBall(id, slotIndex, spawn, { human }) {
  return {
    id,
    slotIndex,
    x: spawn.x,
    y: spawn.y,
    z: spawn.z,
    vx: 0,
    vy: 0,
    vz: 0,
    restX: spawn.x,
    restY: spawn.y,
    restZ: spawn.z,
    atRest: true,
    aimYaw: 0,
    strokes: 0,
    totalStrokes: 0,
    sunk: false,
    sinkOrder: 0,
    holePoints: 0,
    points: 0,
    knockouts: 0,
    splashes: 0,
    lastHitById: null,
    lastHitAgeSec: 0,
    shotId: 0,
    lifeId: 0,
    connected: !human,
  };
}

/**
 * Teleport to a resting spot; a new life so presentation never slides there.
 * @param {BumperLinksBall} ball @param {{x:number,y:number,z:number}} spot
 */
export function placeBumperLinksBall(ball, spot) {
  ball.x = spot.x;
  ball.y = spot.y;
  ball.z = spot.z;
  ball.vx = 0;
  ball.vy = 0;
  ball.vz = 0;
  ball.restX = spot.x;
  ball.restY = spot.y;
  ball.restZ = spot.z;
  ball.atRest = true;
  ball.lastHitById = null;
  ball.lifeId += 1;
}

/**
 * Putt a resting ball. Rolling, sunk or capped balls ignore the shot and
 * keep their stroke count.
 * @param {BumperLinksBall} ball
 * @param {number} aimYaw World heading; 0 is +Z.
 * @param {number} power Charge in [0,1]; 0 never shoots.
 * @returns {boolean} Whether the ball was struck.
 */
export function shootBumperLinksBall(ball, aimYaw, power) {
  if (!ball.atRest || ball.sunk || !(power > 0) || ball.strokes >= BUMPER_LINKS_MATCH_SETTINGS.maxStrokes) return false;
  const settings = BUMPER_LINKS_BALL_SETTINGS;
  const speed = settings.minShotSpeed + Math.min(1, power) * (settings.maxShotSpeed - settings.minShotSpeed);
  ball.vx = Math.sin(aimYaw) * speed;
  ball.vy = 0;
  ball.vz = Math.cos(aimYaw) * speed;
  ball.aimYaw = aimYaw;
  ball.atRest = false;
  // The owner is now in charge of where it goes; an earlier bump earns no knockout.
  ball.lastHitById = null;
  ball.strokes += 1;
  ball.shotId += 1;
  return true;
}

/**
 * Whether a solid top is directly beneath the ball centre.
 * @param {BumperLinksBall} ball @param {readonly SphereSolid[]} solids
 */
function isBumperLinksBallSupported(ball, solids) {
  const bottom = ball.y - BUMPER_LINKS_BALL_SETTINGS.radius;
  for (const solid of solids) {
    if (ball.x < solid.minX || ball.x > solid.maxX || ball.z < solid.minZ || ball.z > solid.maxZ) continue;
    if (bottom >= solid.maxY - SUPPORT_TOLERANCE_M / 2 && bottom <= solid.maxY + SUPPORT_TOLERANCE_M) return true;
  }
  return false;
}

/**
 * Bounce a ball off any rotating bar it overlaps, relative to the bar's own
 * speed at the contact point, and push it clear.
 * @param {BumperLinksBall} ball @param {Readonly<BumperLinksCourse>} course @param {number} timeSec
 * @returns {boolean} Whether a bar touched the ball.
 */
function pushBumperLinksBallFromSweepers(ball, course, timeSec) {
  const radius = BUMPER_LINKS_BALL_SETTINGS.radius;
  const reach = BUMPER_LINKS_SWEEPER.length / 2 + radius + BUMPER_LINKS_SWEEPER.thickness;
  let touched = false;
  for (const sweeper of course.sweepers) {
    const offsetX = ball.x - sweeper.x;
    const offsetZ = ball.z - sweeper.z;
    if (offsetX * offsetX + offsetZ * offsetZ > reach * reach) continue;
    if (ball.y - sweeper.y > radius + BUMPER_LINKS_SWEEPER.height || ball.y < sweeper.y) continue;
    const segment = getBumperLinksSweeperSegment(sweeper, timeSec, sweeperSegment);
    const barX = segment.bx - segment.ax;
    const barZ = segment.bz - segment.az;
    const along = Math.max(0, Math.min(1, ((ball.x - segment.ax) * barX + (ball.z - segment.az) * barZ) / (barX * barX + barZ * barZ)));
    const closestX = segment.ax + barX * along;
    const closestZ = segment.az + barZ * along;
    let normalX = ball.x - closestX;
    let normalZ = ball.z - closestZ;
    const distance = Math.hypot(normalX, normalZ);
    const minimumDistance = radius + BUMPER_LINKS_SWEEPER.thickness / 2;
    if (distance >= minimumDistance) continue;
    if (distance > 1e-6) {
      normalX /= distance;
      normalZ /= distance;
    } else {
      normalX = Math.cos(segment.angle);
      normalZ = -Math.sin(segment.angle);
    }
    ball.x = closestX + normalX * minimumDistance;
    ball.z = closestZ + normalZ * minimumDistance;
    const relativeX = closestX - sweeper.x;
    const relativeZ = closestZ - sweeper.z;
    const barSpeedX = BUMPER_LINKS_SWEEPER.angularSpeed * relativeZ;
    const barSpeedZ = -BUMPER_LINKS_SWEEPER.angularSpeed * relativeX;
    const relativeNormalSpeed = (ball.vx - barSpeedX) * normalX + (ball.vz - barSpeedZ) * normalZ;
    if (relativeNormalSpeed < 0) {
      ball.vx -= (1 + SWEEPER_RESTITUTION) * relativeNormalSpeed * normalX;
      ball.vz -= (1 + SWEEPER_RESTITUTION) * relativeNormalSpeed * normalZ;
    }
    ball.atRest = false;
    touched = true;
  }
  return touched;
}

/**
 * Advance one ball on the course: sphere contact with nearby boxes, rolling
 * resistance on a green, sweeper bars and rest detection. Resting balls only
 * check the sweepers.
 * @param {BumperLinksBall} ball Mutated in place.
 * @param {number} dtSec
 * @param {Readonly<BumperLinksCourse>} course
 * @param {number} timeSec Hole clock for sweeper bars.
 */
export function stepBumperLinksBall(ball, dtSec, course, timeSec) {
  if (ball.sunk) return;
  ball.lastHitAgeSec += dtSec;
  if (ball.atRest) {
    pushBumperLinksBallFromSweepers(ball, course, timeSec);
    if (ball.atRest) return;
  }
  listBumperLinksNearbySolids(course, ball.x, ball.z, nearbySolids);
  ballSphere.step(ball, dtSec, sphereContext);
  pushBumperLinksBallFromSweepers(ball, course, timeSec);

  if (!isBumperLinksBallSupported(ball, nearbySolids)) return;
  const settings = BUMPER_LINKS_BALL_SETTINGS;
  const horizontalSpeed = Math.hypot(ball.vx, ball.vz);
  const rollingScale = horizontalSpeed > 0 ? Math.max(0, 1 - (settings.rollDeceleration * dtSec) / horizontalSpeed) : 0;
  ball.vx *= rollingScale;
  ball.vz *= rollingScale;
  if (horizontalSpeed * rollingScale < settings.restSpeedThreshold && Math.abs(ball.vy) < MAX_VERTICAL_REST_SPEED) {
    ball.vx = 0;
    ball.vy = 0;
    ball.vz = 0;
    ball.restX = ball.x;
    ball.restY = ball.y;
    ball.restZ = ball.z;
    ball.atRest = true;
  }
}

/**
 * Equal-mass ball contacts: split overlaps evenly and exchange an impulse
 * only while the pair is closing. The slower ball records the faster one as
 * its striker so a splash can be credited.
 * @param {readonly BumperLinksBall[]} balls
 */
export function resolveBumperLinksBallContacts(balls) {
  const minimumDistance = BUMPER_LINKS_BALL_SETTINGS.radius * 2;
  for (let first = 0; first < balls.length; first += 1) {
    const ballA = balls[first];
    if (ballA.sunk) continue;
    for (let second = first + 1; second < balls.length; second += 1) {
      const ballB = balls[second];
      if (ballB.sunk) continue;
      const offsetX = ballB.x - ballA.x;
      const offsetY = ballB.y - ballA.y;
      const offsetZ = ballB.z - ballA.z;
      const distanceSq = offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ;
      if (distanceSq >= minimumDistance * minimumDistance) continue;
      const distance = Math.sqrt(distanceSq);
      const normalX = distance > 1e-9 ? offsetX / distance : 1;
      const normalY = distance > 1e-9 ? offsetY / distance : 0;
      const normalZ = distance > 1e-9 ? offsetZ / distance : 0;
      const correction = (minimumDistance - distance) / 2;
      ballA.x -= normalX * correction;
      ballA.y -= normalY * correction;
      ballA.z -= normalZ * correction;
      ballB.x += normalX * correction;
      ballB.y += normalY * correction;
      ballB.z += normalZ * correction;
      const closingSpeed = (ballB.vx - ballA.vx) * normalX + (ballB.vy - ballA.vy) * normalY + (ballB.vz - ballA.vz) * normalZ;
      if (closingSpeed >= 0) {
        // Pure separation keeps resting balls resting where they now sit.
        for (const ball of [ballA, ballB]) {
          if (!ball.atRest) continue;
          ball.restX = ball.x;
          ball.restZ = ball.z;
        }
        continue;
      }
      const impulse = (-(1 + BUMPER_LINKS_BALL_SETTINGS.ballRestitution) * closingSpeed) / 2;
      const speedASq = ballA.vx * ballA.vx + ballA.vy * ballA.vy + ballA.vz * ballA.vz;
      const speedBSq = ballB.vx * ballB.vx + ballB.vy * ballB.vy + ballB.vz * ballB.vz;
      ballA.vx -= impulse * normalX;
      ballA.vy -= impulse * normalY;
      ballA.vz -= impulse * normalZ;
      ballB.vx += impulse * normalX;
      ballB.vy += impulse * normalY;
      ballB.vz += impulse * normalZ;
      ballA.atRest = false;
      ballB.atRest = false;
      const [striker, struck] = speedASq >= speedBSq ? [ballA, ballB] : [ballB, ballA];
      struck.lastHitById = striker.id;
      struck.lastHitAgeSec = 0;
    }
  }
}

/**
 * A ball drops when it rolls over the cup slowly enough; faster balls lip out.
 * @param {Readonly<BumperLinksBall>} ball
 * @param {{x:number,y:number,z:number}} cup
 * @returns {boolean}
 */
export function isBumperLinksBallCapturedByCup(ball, cup) {
  const offsetX = ball.x - cup.x;
  const offsetZ = ball.z - cup.z;
  if (offsetX * offsetX + offsetZ * offsetZ > BUMPER_LINKS_CUP.radius * BUMPER_LINKS_CUP.radius) return false;
  if (ball.y - cup.y > BUMPER_LINKS_BALL_SETTINGS.radius + CUP_CAPTURE_HEIGHT_M || ball.y < cup.y) return false;
  return ball.vx * ball.vx + ball.vz * ball.vz <= BUMPER_LINKS_CUP.captureSpeed * BUMPER_LINKS_CUP.captureSpeed;
}
