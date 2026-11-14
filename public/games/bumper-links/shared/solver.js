import { BUMPER_LINKS_SOLVER_SETTINGS } from "./config.js";
import { createBumperLinksCourse, measureBumperLinksRemainingPath } from "./course.js";
import {
  createBumperLinksBall,
  isBumperLinksBallCapturedByCup,
  shootBumperLinksBall,
  stepBumperLinksBall,
} from "./ball.js";

/** @typedef {import("./course.js").BumperLinksCourse} BumperLinksCourse */
/** @typedef {import("./match.js").BumperLinksHole} BumperLinksHole */
/**
 * @typedef {{aimYaw:number,power:number}} BumperLinksShot
 * @typedef {"sunk"|"rest"|"water"|"timeout"} BumperLinksShotOutcome
 * @typedef {{outcome:BumperLinksShotOutcome,x:number,y:number,z:number,score:number}} BumperLinksShotResult
 *   `score` is the path distance left at the end: -1 when sunk, Infinity in the water.
 * @typedef {object} BumperLinksShotSearchOptions
 * @property {number} [yawSamples] Odd counts include the straight line.
 * @property {readonly number[]} [powerSamples]
 * @property {number} [timeSec=0] Hole clock at the shot, for sweeper bars.
 * @property {number} [deadlineMs=Infinity] `performance.now()` value after which the search stops early.
 */

export const BUMPER_LINKS_SUNK_SCORE = -1;
const SUNK_SCORE = BUMPER_LINKS_SUNK_SCORE;
/** Hole generation must never stall the shared server loop for longer than this. */
export const BUMPER_LINKS_GENERATION_BUDGET_MS = 50;
/**
 * Seeds proven by `solveBumperLinksHole`, used when the budget runs out.
 * `tests/bumper-links-solver.test.js` re-proves every entry.
 * @type {readonly BumperLinksHole[]}
 */
export const BUMPER_LINKS_FALLBACK_HOLES = Object.freeze([
  Object.freeze({ seed: 5037, par: 3 }),
  Object.freeze({ seed: 5074, par: 3 }),
  Object.freeze({ seed: 5111, par: 3 }),
  Object.freeze({ seed: 5148, par: 3 }),
  Object.freeze({ seed: 5296, par: 3 }),
  Object.freeze({ seed: 5407, par: 3 }),
  Object.freeze({ seed: 5555, par: 3 }),
  Object.freeze({ seed: 5629, par: 3 }),
  Object.freeze({ seed: 5666, par: 3 }),
  Object.freeze({ seed: 5703, par: 3 }),
  Object.freeze({ seed: 5925, par: 3 }),
  Object.freeze({ seed: 6110, par: 3 }),
]);
const MIN_PROGRESS_M = 0.3;
/** One reusable solo ball; solver calls never overlap. */
const probeBall = createBumperLinksBall("probe", 0, { x: 0, y: 0, z: 0 }, { human: false });

/**
 * Point `distanceM` further along the course path than the closest point to
 * (x, z), clamped to the cup.
 * @param {Readonly<BumperLinksCourse>} course @param {number} x @param {number} z @param {number} distanceM
 * @returns {{x:number,z:number}}
 */
export function findBumperLinksPathPointAhead(course, x, z, distanceM) {
  const path = course.path;
  let bestIndex = 0;
  let bestAlong = 0;
  let bestDistanceSq = Infinity;
  for (let index = 0; index < path.length - 1; index += 1) {
    const segmentX = path[index + 1].x - path[index].x;
    const segmentZ = path[index + 1].z - path[index].z;
    const lengthSq = segmentX * segmentX + segmentZ * segmentZ;
    const along = lengthSq > 0 ? Math.max(0, Math.min(1, ((x - path[index].x) * segmentX + (z - path[index].z) * segmentZ) / lengthSq)) : 0;
    const offsetX = path[index].x + segmentX * along - x;
    const offsetZ = path[index].z + segmentZ * along - z;
    const distanceSq = offsetX * offsetX + offsetZ * offsetZ;
    if (distanceSq < bestDistanceSq) {
      bestDistanceSq = distanceSq;
      bestIndex = index;
      bestAlong = along;
    }
  }
  let remaining = distanceM;
  let index = bestIndex;
  let along = bestAlong;
  while (index < path.length - 1) {
    const segmentLength = Math.hypot(path[index + 1].x - path[index].x, path[index + 1].z - path[index].z);
    const left = segmentLength * (1 - along);
    if (remaining <= left && segmentLength > 0) {
      const fraction = along + remaining / segmentLength;
      return {
        x: path[index].x + (path[index + 1].x - path[index].x) * fraction,
        z: path[index].z + (path[index + 1].z - path[index].z) * fraction,
      };
    }
    remaining -= left;
    index += 1;
    along = 0;
  }
  return { x: path.at(-1).x, z: path.at(-1).z };
}

/**
 * A fan of headings around the next stretch of the path times each power.
 * @param {Readonly<BumperLinksCourse>} course
 * @param {{x:number,z:number}} from
 * @param {BumperLinksShotSearchOptions} [options]
 * @returns {BumperLinksShot[]}
 */
export function createBumperLinksShotCandidates(course, from, options = {}) {
  const yawSamples = options.yawSamples ?? BUMPER_LINKS_SOLVER_SETTINGS.yawSamples;
  const powerSamples = options.powerSamples ?? BUMPER_LINKS_SOLVER_SETTINGS.powerSamples;
  const target = findBumperLinksPathPointAhead(course, from.x, from.z, BUMPER_LINKS_SOLVER_SETTINGS.lookAheadM);
  const centreYaw = Math.atan2(target.x - from.x, target.z - from.z);
  /** @type {BumperLinksShot[]} */
  const candidates = [];
  for (let yawIndex = 0; yawIndex < yawSamples; yawIndex += 1) {
    const spread = yawSamples > 1 ? (yawIndex / (yawSamples - 1)) * 2 - 1 : 0;
    const aimYaw = centreYaw + spread * BUMPER_LINKS_SOLVER_SETTINGS.yawSpreadRad;
    for (const power of powerSamples) candidates.push({ aimYaw, power });
  }
  return candidates;
}

/**
 * Simulate one solo putt until the ball rests, sinks, splashes or times out.
 * Other balls are ignored.
 * @param {Readonly<BumperLinksCourse>} course
 * @param {{x:number,y:number,z:number}} from
 * @param {Readonly<BumperLinksShot>} shot
 * @param {number} [timeSec=0]
 * @returns {BumperLinksShotResult}
 */
export function simulateBumperLinksShot(course, from, shot, timeSec = 0) {
  const settings = BUMPER_LINKS_SOLVER_SETTINGS;
  Object.assign(probeBall, { x: from.x, y: from.y, z: from.z, vx: 0, vy: 0, vz: 0, atRest: true, sunk: false, strokes: 0 });
  shootBumperLinksBall(probeBall, shot.aimYaw, shot.power);
  /** @type {BumperLinksShotOutcome} */
  let outcome = "timeout";
  for (let elapsedSec = 0; elapsedSec < settings.maxSimSec; elapsedSec += settings.simDtSec) {
    stepBumperLinksBall(probeBall, settings.simDtSec, course, timeSec + elapsedSec);
    if (isBumperLinksBallCapturedByCup(probeBall, course.cup)) {
      outcome = "sunk";
      break;
    }
    if (probeBall.y < course.waterY) {
      outcome = "water";
      break;
    }
    if (probeBall.atRest) {
      outcome = "rest";
      break;
    }
  }
  const score = outcome === "sunk" ? SUNK_SCORE
    : outcome === "water" ? Infinity
      : measureBumperLinksRemainingPath(course, probeBall.x, probeBall.z);
  return { outcome, x: probeBall.x, y: probeBall.y, z: probeBall.z, score };
}

/**
 * Best of a full candidate fan. Used by the hole solver; bots spread the
 * same search across ticks instead.
 * @param {Readonly<BumperLinksCourse>} course
 * @param {{x:number,y:number,z:number}} from
 * @param {BumperLinksShotSearchOptions} [options]
 * @returns {BumperLinksShot & BumperLinksShotResult}
 */
export function planBumperLinksShot(course, from, options = {}) {
  let best = null;
  const deadlineMs = options.deadlineMs ?? Infinity;
  for (const candidate of createBumperLinksShotCandidates(course, from, options)) {
    if (best && performance.now() > deadlineMs) break;
    const result = simulateBumperLinksShot(course, from, candidate, options.timeSec ?? 0);
    if (!best || result.score < best.score) best = { ...candidate, ...result };
    if (result.score === SUNK_SCORE) break;
  }
  return best;
}

/**
 * Greedy putts from the tee. A hole that cannot be finished within
 * maxShots, that stops making progress, or that runs past the deadline is
 * rejected.
 * @param {number} seed
 * @param {number} [deadlineMs=Infinity] `performance.now()` value to give up at.
 * @returns {BumperLinksHole|null} Par is one more than the solver needed, within [2,5].
 */
export function solveBumperLinksHole(seed, deadlineMs = Infinity) {
  const course = createBumperLinksCourse(seed);
  let from = { x: course.tee.x, y: course.tee.y, z: course.tee.z };
  let remaining = measureBumperLinksRemainingPath(course, from.x, from.z);
  for (let shot = 1; shot <= BUMPER_LINKS_SOLVER_SETTINGS.maxShots; shot += 1) {
    if (performance.now() > deadlineMs) return null;
    const plan = planBumperLinksShot(course, from, { deadlineMs });
    if (performance.now() > deadlineMs) return null;
    if (plan.score === SUNK_SCORE) return { seed, par: Math.max(2, Math.min(5, shot + 1)) };
    if (!(plan.score < remaining - MIN_PROGRESS_M)) return null;
    remaining = plan.score;
    from = { x: plan.x, y: plan.y, z: plan.z };
  }
  return null;
}

/**
 * First solvable hole from `firstSeed` onwards, within a time budget so a
 * hole change never stalls the shared loop. When the budget runs out, a
 * proven fallback hole is played instead.
 * @param {number} firstSeed
 * @param {{budgetMs?:number}} [options]
 * @returns {BumperLinksHole}
 */
export function generateSolvableBumperLinksHole(firstSeed, { budgetMs = BUMPER_LINKS_GENERATION_BUDGET_MS } = {}) {
  const deadlineMs = performance.now() + budgetMs;
  for (let attempt = 0; attempt < BUMPER_LINKS_SOLVER_SETTINGS.generateAttempts && performance.now() < deadlineMs; attempt += 1) {
    const hole = solveBumperLinksHole((firstSeed + attempt) >>> 0, deadlineMs);
    if (hole) return hole;
  }
  const fallback = BUMPER_LINKS_FALLBACK_HOLES[(firstSeed >>> 0) % BUMPER_LINKS_FALLBACK_HOLES.length];
  return { seed: fallback.seed, par: fallback.par };
}
