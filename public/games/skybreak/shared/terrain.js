import { SKYBREAK_TIME_TRIAL_SETTINGS } from "./config.js";

/**
 * Deterministic coastal mountains with a winding canyon, shared by server
 * collision and browser rendering. The sea lies to the south (+Z).
 *
 * @typedef {{x:number,y:number,z:number,forwardX:number,forwardY:number,forwardZ:number,radius:number}} SkybreakGate
 */

const MOUNTAIN_HEIGHT_M = 430;
const MOUNTAIN_SCALE = 0.0015;
const CANYON_FLOOR_M = 28;
const CANYON_FLOOR_HALF_WIDTH_M = 130;
const CANYON_RIM_HALF_WIDTH_M = 330;
const SHORE_Z_M = 1350;
const SEA_FLOOR_M = -40;
/** Canyon centre line, west to east, in metres. */
const CANYON_POINTS = Object.freeze([
  [-2200, -500], [-1700, -380], [-1300, -120], [-950, -260], [-600, -520], [-250, -420],
  [50, -150], [300, 120], [650, 220], [1000, 40], [1350, -160], [1700, -60], [2200, 120],
]);

/** @param {number} x @param {number} z */
function hashSkybreak(x, z) {
  const value = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

/** Smooth value noise in [0, 1). @param {number} x @param {number} z */
function noiseSkybreak(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const top = hashSkybreak(ix, iz) + (hashSkybreak(ix + 1, iz) - hashSkybreak(ix, iz)) * sx;
  const bottom = hashSkybreak(ix, iz + 1) + (hashSkybreak(ix + 1, iz + 1) - hashSkybreak(ix, iz + 1)) * sx;
  return top + (bottom - top) * sz;
}

const OCTAVE_COS = Math.cos(0.62);
const OCTAVE_SIN = Math.sin(0.62);

/**
 * Ridged fractal for sharp mountain crests. Each octave is rotated and
 * offset, and the domain is warped, so the value-noise grid never shows.
 * @param {number} x
 * @param {number} z
 */
function ridgedSkybreak(x, z) {
  const warpX = x + (noiseSkybreak(x * 0.7 + 13.1, z * 0.7 - 7.3) - 0.5) * 0.9;
  const warpZ = z + (noiseSkybreak(x * 0.7 - 5.7, z * 0.7 + 21.9) - 0.5) * 0.9;
  let sampleX = warpX;
  let sampleZ = warpZ;
  let total = 0;
  let amplitude = 0.55;
  for (let octave = 0; octave < 4; octave += 1) {
    const ridge = 1 - Math.abs(noiseSkybreak(sampleX, sampleZ) * 2 - 1);
    total += ridge * ridge * amplitude;
    amplitude *= 0.5;
    const rotatedX = (sampleX * OCTAVE_COS - sampleZ * OCTAVE_SIN) * 2.03 + 17.3;
    sampleZ = (sampleX * OCTAVE_SIN + sampleZ * OCTAVE_COS) * 2.03 - 9.1;
    sampleX = rotatedX;
  }
  return total;
}

/** @param {number} edge0 @param {number} edge1 @param {number} value */
function smoothstepSkybreak(edge0, edge1, value) {
  const amount = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return amount * amount * (3 - 2 * amount);
}

/**
 * Distance to the canyon centre line only; allocation-free for collision.
 * @param {number} x
 * @param {number} z
 */
function measureSkybreakCanyonDistance(x, z) {
  let best = Infinity;
  for (let index = 0; index < CANYON_POINTS.length - 1; index += 1) {
    const [ax, az] = CANYON_POINTS[index];
    const [bx, bz] = CANYON_POINTS[index + 1];
    const segmentX = bx - ax;
    const segmentZ = bz - az;
    const amount = Math.max(0, Math.min(1, ((x - ax) * segmentX + (z - az) * segmentZ) / (segmentX * segmentX + segmentZ * segmentZ)));
    const distanceSquared = (x - ax - segmentX * amount) ** 2 + (z - az - segmentZ * amount) ** 2;
    if (distanceSquared < best) best = distanceSquared;
  }
  return Math.sqrt(best);
}

/**
 * Distance from a point to the canyon centre line and the arc length of the
 * closest point along it.
 * @param {number} x
 * @param {number} z
 * @returns {{distance:number,along:number}}
 */
export function measureSkybreakCanyon(x, z) {
  let best = Infinity;
  let bestAlong = 0;
  let travelled = 0;
  for (let index = 0; index < CANYON_POINTS.length - 1; index += 1) {
    const [ax, az] = CANYON_POINTS[index];
    const [bx, bz] = CANYON_POINTS[index + 1];
    const segmentX = bx - ax;
    const segmentZ = bz - az;
    const length = Math.hypot(segmentX, segmentZ);
    const amount = Math.max(0, Math.min(1, ((x - ax) * segmentX + (z - az) * segmentZ) / (length * length)));
    const distance = Math.hypot(x - (ax + segmentX * amount), z - (az + segmentZ * amount));
    if (distance < best) {
      best = distance;
      bestAlong = travelled + amount * length;
    }
    travelled += length;
  }
  return { distance: best, along: bestAlong };
}

/**
 * Ground height at a world position: ridged mountains, a carved canyon and
 * a coastline falling into the sea. Pure and deterministic.
 * @param {number} x
 * @param {number} z
 * @returns {number} Metres; below zero means sea floor.
 */
export function getSkybreakTerrainHeight(x, z) {
  const mountains = ridgedSkybreak(x * MOUNTAIN_SCALE, z * MOUNTAIN_SCALE) * MOUNTAIN_HEIGHT_M + 40;
  const canyonDistance = measureSkybreakCanyonDistance(x, z);
  const carve = smoothstepSkybreak(CANYON_FLOOR_HALF_WIDTH_M, CANYON_RIM_HALF_WIDTH_M, canyonDistance);
  const land = CANYON_FLOOR_M + (mountains - CANYON_FLOOR_M) * carve;
  const shoreline = SHORE_Z_M + Math.sin(x * 0.0021) * 160;
  const coast = smoothstepSkybreak(shoreline - 260, shoreline + 120, z);
  return land + (SEA_FLOOR_M - land) * coast;
}

/**
 * Height a jet must stay above: terrain, or the sea surface.
 * @param {number} x
 * @param {number} z
 */
export function getSkybreakGroundClearanceHeight(x, z) {
  return Math.max(getSkybreakTerrainHeight(x, z), 0);
}

/**
 * Point and direction along the canyon centre line.
 * @param {number} along Arc length in metres.
 * @returns {{x:number,z:number,directionX:number,directionZ:number}}
 */
export function getSkybreakCanyonPoint(along) {
  let remaining = along;
  for (let index = 0; index < CANYON_POINTS.length - 1; index += 1) {
    const [ax, az] = CANYON_POINTS[index];
    const [bx, bz] = CANYON_POINTS[index + 1];
    const length = Math.hypot(bx - ax, bz - az);
    if (remaining <= length || index === CANYON_POINTS.length - 2) {
      const amount = Math.max(0, Math.min(1, remaining / length));
      return { x: ax + (bx - ax) * amount, z: az + (bz - az) * amount, directionX: (bx - ax) / length, directionZ: (bz - az) / length };
    }
    remaining -= length;
  }
  return { x: 0, z: 0, directionX: 1, directionZ: 0 };
}

/** Total canyon length in metres. */
export const SKYBREAK_CANYON_LENGTH_M = CANYON_POINTS.slice(1).reduce((total, point, index) =>
  total + Math.hypot(point[0] - CANYON_POINTS[index][0], point[1] - CANYON_POINTS[index][1]), 0);

const COURSE_START_M = 780;
const COURSE_GATE_SPACING_M = 300;
const COURSE_GATE_COUNT = 12;
/** Gates that leave the canyon to hop a ridge, by index, with extra height. */
const COURSE_CLIMBS = Object.freeze({ 3: 100, 4: 210, 5: 230, 6: 110, 8: 90, 9: 170, 10: 80 });

/**
 * The time-trial course: gates down the canyon with two ridge hops. Each gate
 * faces along the route; passing means crossing its plane inside the radius.
 * @returns {ReadonlyArray<Readonly<SkybreakGate>>}
 */
function buildSkybreakCourse() {
  const centres = [];
  for (let index = 0; index < COURSE_GATE_COUNT; index += 1) {
    const along = COURSE_START_M + index * COURSE_GATE_SPACING_M;
    const point = getSkybreakCanyonPoint(along);
    const sideOffset = Math.sin(index * 1.7) * 20;
    const x = point.x - point.directionZ * sideOffset;
    const z = point.z + point.directionX * sideOffset;
    centres.push({ x, z, y: getSkybreakGroundClearanceHeight(x, z) + 55 + (COURSE_CLIMBS[index] ?? 0), canyonX: point.directionX, canyonZ: point.directionZ });
  }
  // Each ring faces the line from the previous ring, so it is square to the
  // natural approach; the first faces along the canyon from the start.
  return Object.freeze(centres.map((centre, index) => {
    const previous = centres[index - 1];
    const towardX = previous ? centre.x - previous.x : centre.canyonX;
    const towardZ = previous ? centre.z - previous.z : centre.canyonZ;
    const length = Math.hypot(towardX, towardZ) || 1;
    return Object.freeze({ x: centre.x, y: centre.y, z: centre.z, forwardX: towardX / length, forwardY: 0, forwardZ: towardZ / length, radius: SKYBREAK_TIME_TRIAL_SETTINGS.gateRadiusM });
  }));
}

export const SKYBREAK_COURSE_GATES = buildSkybreakCourse();

/** Start pose for a time-trial run, behind the first gate and facing it. */
export function getSkybreakCourseStart() {
  const first = SKYBREAK_COURSE_GATES[0];
  const x = first.x - first.forwardX * 380;
  const z = first.z - first.forwardZ * 380;
  return { x, y: Math.max(first.y + 10, getSkybreakGroundClearanceHeight(x, z) + 70), z, forwardX: first.forwardX, forwardZ: first.forwardZ };
}
