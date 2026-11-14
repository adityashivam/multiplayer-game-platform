import { BUMPER_LINKS_BALL_SETTINGS, BUMPER_LINKS_MATCH_SETTINGS } from "./config.js";
import { createBumperLinksCourse } from "./course.js";
import {
  createBumperLinksBall,
  isBumperLinksBallCapturedByCup,
  placeBumperLinksBall,
  resolveBumperLinksBallContacts,
  shootBumperLinksBall,
  stepBumperLinksBall,
} from "./ball.js";

/** @typedef {import("./ball.js").BumperLinksBall} BumperLinksBall */
/** @typedef {import("./course.js").BumperLinksCourse} BumperLinksCourse */
/** @typedef {import("./config.js").BumperLinksPhase} BumperLinksPhase */
/**
 * @typedef {"sink"|"splash"|"knockout"} BumperLinksEventType
 * @typedef {{serial:number,type:BumperLinksEventType,ballId:string,byId:string|null,points:number,x:number,z:number}} BumperLinksMatchEvent
 *   `x`/`z` is where it happened: the cup, or where the ball hit the water.
 * @typedef {{seed:number,par:number}} BumperLinksHole
 * @typedef {(holeSeed:number)=>BumperLinksHole} BumperLinksHoleResolver
 *   Turns a candidate seed into a playable hole; the server proves it with the solver.
 * @typedef {object} BumperLinksMatch
 * @property {number} matchId
 * @property {number} matchSeed Varies per room so every match plays new holes.
 * @property {number} holeIndex 0-based.
 * @property {number} holes
 * @property {number} holeSeed
 * @property {number} par
 * @property {BumperLinksCourse} course Rebuilt from holeSeed; never sent to clients.
 * @property {Record<string,BumperLinksBall>} players Human seats.
 * @property {BumperLinksBall[]} bots
 * @property {BumperLinksPhase} phase
 * @property {boolean} started
 * @property {number|null} startAt
 * @property {boolean} gameOver
 * @property {string|null} winner
 * @property {number} holeTimeSec
 * @property {number} holeResetRemainingSec Intermission left after a hole.
 * @property {number} sinkCount
 * @property {number} holeSerial Increments per loaded hole.
 * @property {number} eventSerial
 * @property {BumperLinksMatchEvent[]} recentEvents Bounded, newest last.
 */

/** Spawn offsets across the tee, nearest the centre first. */
const TEE_SPAWN_OFFSETS = Object.freeze([-0.45, 0.45, -1.35, 1.35]);
const TEE_SPAWN_ROW_STEP_M = 0.8;
const SUNK_DEPTH_M = 0.12;

/** @type {BumperLinksHoleResolver} */
function useBumperLinksSeedAsHole(holeSeed) {
  return { seed: holeSeed, par: 3 };
}

/**
 * Candidate seed for a hole. The resolver may move past it.
 * @param {number} matchSeed @param {number} holeIndex
 */
export function getBumperLinksHoleSeed(matchSeed, holeIndex) {
  return (Math.imul(matchSeed, 31) + Math.imul(holeIndex + 1, 7919)) >>> 0;
}

/**
 * Tee spawn for a slot, spread across the tee so balls never start overlapping.
 * @param {Readonly<BumperLinksCourse>} course @param {number} slotIndex
 */
export function getBumperLinksTeeSpawn(course, slotIndex) {
  const offset = TEE_SPAWN_OFFSETS[slotIndex % TEE_SPAWN_OFFSETS.length];
  const row = Math.floor(slotIndex / TEE_SPAWN_OFFSETS.length);
  const sideX = Math.cos(course.teeYaw);
  const sideZ = -Math.sin(course.teeYaw);
  return {
    x: course.tee.x + sideX * offset + Math.sin(course.teeYaw) * row * TEE_SPAWN_ROW_STEP_M,
    y: course.tee.y,
    z: course.tee.z + sideZ * offset + Math.cos(course.teeYaw) * row * TEE_SPAWN_ROW_STEP_M,
  };
}

/**
 * Humans then bots, in slot order.
 * @param {Readonly<BumperLinksMatch>} match @param {BumperLinksBall[]} out Cleared first.
 * @returns {BumperLinksBall[]} `out`.
 */
export function listBumperLinksBalls(match, out) {
  out.length = 0;
  for (const playerId of Object.keys(match.players)) out.push(match.players[playerId]);
  for (const bot of match.bots) out.push(bot);
  return out;
}

/**
 * Load a hole: rebuild the course and return every ball to the tee with this
 * hole's strokes and points cleared. Banked points and totals are kept.
 * @param {BumperLinksMatch} match
 * @param {number} holeIndex
 * @param {BumperLinksHole} hole
 */
export function loadBumperLinksHole(match, holeIndex, hole) {
  match.holeIndex = holeIndex;
  match.holeSeed = hole.seed;
  match.par = hole.par;
  match.course = createBumperLinksCourse(hole.seed);
  match.holeTimeSec = 0;
  match.holeResetRemainingSec = 0;
  match.sinkCount = 0;
  match.holeSerial += 1;
  for (const ball of listBumperLinksBalls(match, [])) {
    ball.strokes = 0;
    ball.sunk = false;
    ball.sinkOrder = 0;
    ball.holePoints = 0;
    ball.aimYaw = match.course.teeYaw;
    placeBumperLinksBall(ball, getBumperLinksTeeSpawn(match.course, ball.slotIndex));
  }
}

/**
 * @param {object} options
 * @param {readonly string[]} options.playerIds Human seats.
 * @param {readonly string[]} options.botIds Server-owned balls.
 * @param {number} [options.matchId=1]
 * @param {number} [options.matchSeed] Defaults to a value derived from matchId.
 * @param {BumperLinksHoleResolver} [options.resolveHole]
 * @returns {BumperLinksMatch}
 */
export function createBumperLinksMatch({ playerIds, botIds, matchId = 1, matchSeed = matchId * 7919, resolveHole = useBumperLinksSeedAsHole }) {
  const placeholder = { x: 0, y: BUMPER_LINKS_BALL_SETTINGS.radius, z: 0 };
  const players = Object.fromEntries(playerIds.map((playerId, index) => [playerId, createBumperLinksBall(playerId, index, placeholder, { human: true })]));
  const bots = botIds.map((botId, index) => createBumperLinksBall(botId, playerIds.length + index, placeholder, { human: false }));
  /** @type {BumperLinksMatch} */
  const match = {
    matchId,
    matchSeed,
    holeIndex: 0,
    holes: BUMPER_LINKS_MATCH_SETTINGS.holes,
    holeSeed: 0,
    par: 3,
    course: /** @type {BumperLinksCourse} */ (/** @type {unknown} */ (null)),
    players,
    bots,
    phase: "waiting",
    started: false,
    startAt: null,
    gameOver: false,
    winner: null,
    holeTimeSec: 0,
    holeResetRemainingSec: 0,
    sinkCount: 0,
    holeSerial: 0,
    eventSerial: 0,
    recentEvents: [],
  };
  loadBumperLinksHole(match, 0, resolveHole(getBumperLinksHoleSeed(matchSeed, 0)));
  return match;
}

/**
 * Putt one ball if the hole is in play and the ball is resting.
 * @param {BumperLinksMatch} match @param {string} ballId
 * @param {number} aimYaw @param {number} power
 * @returns {boolean}
 */
export function requestBumperLinksShot(match, ballId, aimYaw, power) {
  if (match.phase !== "playing" || !match.started || match.gameOver) return false;
  const ball = match.players[ballId] ?? match.bots.find((bot) => bot.id === ballId);
  return ball ? shootBumperLinksBall(ball, aimYaw, power) : false;
}

/**
 * Points desc, then fewer strokes, then slot order. A new array.
 * @param {readonly BumperLinksBall[]} balls
 */
export function rankBumperLinksBalls(balls) {
  return [...balls].sort((first, second) =>
    second.points - first.points || first.totalStrokes - second.totalStrokes || first.slotIndex - second.slotIndex);
}

/**
 * @param {BumperLinksMatch} match @param {BumperLinksEventType} type
 * @param {string} ballId @param {string|null} byId @param {number} points
 * @param {number} x @param {number} z
 */
function recordBumperLinksEvent(match, type, ballId, byId, points, x, z) {
  match.eventSerial += 1;
  match.recentEvents.push({ serial: match.eventSerial, type, ballId, byId, points, x, z });
  if (match.recentEvents.length > BUMPER_LINKS_MATCH_SETTINGS.recentEventLimit) match.recentEvents.shift();
}

/** @param {BumperLinksMatch} match @param {BumperLinksBall} ball */
function captureBumperLinksBallInCup(match, ball) {
  if (!isBumperLinksBallCapturedByCup(ball, match.course.cup)) return;
  const cup = match.course.cup;
  match.sinkCount += 1;
  const points = BUMPER_LINKS_MATCH_SETTINGS.sinkPoints[match.sinkCount - 1] ?? 0;
  Object.assign(ball, { x: cup.x, y: cup.y - SUNK_DEPTH_M, z: cup.z, vx: 0, vy: 0, vz: 0, atRest: true, sunk: true, sinkOrder: match.sinkCount });
  ball.holePoints += points;
  recordBumperLinksEvent(match, "sink", ball.id, null, points, cup.x, cup.z);
}

/**
 * Splash: back to the last resting spot with a stroke penalty. A recent
 * strike by another ball turns it into that ball's knockout.
 * @param {BumperLinksMatch} match @param {BumperLinksBall} ball @param {readonly BumperLinksBall[]} balls
 */
function returnBumperLinksBallFromWater(match, ball, balls) {
  const striker = ball.lastHitById && ball.lastHitById !== ball.id &&
    ball.lastHitAgeSec < BUMPER_LINKS_BALL_SETTINGS.knockCreditSec
    ? balls.find((candidate) => candidate.id === ball.lastHitById) ?? null
    : null;
  const splashX = ball.x;
  const splashZ = ball.z;
  ball.strokes += BUMPER_LINKS_MATCH_SETTINGS.waterPenaltyStrokes;
  ball.splashes += 1;
  placeBumperLinksBall(ball, { x: ball.restX, y: ball.restY, z: ball.restZ });
  if (striker) {
    striker.knockouts += 1;
    striker.holePoints += BUMPER_LINKS_MATCH_SETTINGS.knockoutPoints;
    recordBumperLinksEvent(match, "knockout", ball.id, striker.id, BUMPER_LINKS_MATCH_SETTINGS.knockoutPoints, splashX, splashZ);
  } else {
    recordBumperLinksEvent(match, "splash", ball.id, null, 0, splashX, splashZ);
  }
}

/**
 * Every connected ball is in the cup or out of strokes and resting. Away
 * humans never hold a hole open.
 * @param {readonly BumperLinksBall[]} balls
 */
function isBumperLinksHoleSettled(balls) {
  return balls.every((ball) => !ball.connected || ball.sunk ||
    (ball.atRest && ball.strokes >= BUMPER_LINKS_MATCH_SETTINGS.maxStrokes));
}

/** @param {BumperLinksMatch} match @param {readonly BumperLinksBall[]} balls */
function finishBumperLinksHole(match, balls) {
  for (const ball of balls) {
    ball.points += ball.holePoints;
    ball.totalStrokes += ball.strokes;
  }
  match.phase = "holeOver";
  match.holeResetRemainingSec = BUMPER_LINKS_MATCH_SETTINGS.holeResetSec;
}

/** @param {BumperLinksMatch} match @param {readonly BumperLinksBall[]} balls @param {BumperLinksHoleResolver} resolveHole */
function advanceBumperLinksHole(match, balls, resolveHole) {
  const nextIndex = match.holeIndex + 1;
  if (nextIndex >= match.holes) {
    match.phase = "finished";
    match.gameOver = true;
    match.winner = rankBumperLinksBalls(balls)[0]?.id ?? null;
    return;
  }
  loadBumperLinksHole(match, nextIndex, resolveHole(getBumperLinksHoleSeed(match.matchSeed, nextIndex)));
  match.phase = "playing";
}

/** Reused per tick; the scheduler never runs rooms concurrently. */
const ballScratch = /** @type {BumperLinksBall[]} */ ([]);

/**
 * Advance the shared world one fixed step: balls, contacts, cup, water and
 * the hole clock, then the intermission between holes.
 * @param {BumperLinksMatch} match Mutated in place.
 * @param {number} dtSec
 * @param {{resolveHole?:BumperLinksHoleResolver}} [options] Server passes the solver.
 */
export function stepBumperLinksWorld(match, dtSec, { resolveHole = useBumperLinksSeedAsHole } = {}) {
  if (!match.started || match.gameOver) return;
  const balls = listBumperLinksBalls(match, ballScratch);
  if (match.phase === "holeOver") {
    match.holeResetRemainingSec = Math.max(0, match.holeResetRemainingSec - dtSec);
    if (match.holeResetRemainingSec <= 0) advanceBumperLinksHole(match, balls, resolveHole);
    return;
  }
  if (match.phase !== "playing") return;

  match.holeTimeSec += dtSec;
  for (const ball of balls) stepBumperLinksBall(ball, dtSec, match.course, match.holeTimeSec);
  resolveBumperLinksBallContacts(balls);
  for (const ball of balls) {
    if (ball.sunk) continue;
    captureBumperLinksBallInCup(match, ball);
    if (!ball.sunk && ball.y < match.course.waterY) returnBumperLinksBallFromWater(match, ball, balls);
  }
  if (match.holeTimeSec >= BUMPER_LINKS_MATCH_SETTINGS.holeTimeSec || isBumperLinksHoleSettled(balls)) {
    finishBumperLinksHole(match, balls);
  }
}
