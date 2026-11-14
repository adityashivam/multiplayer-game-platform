import { BUMPER_LINKS_BOT_SETTINGS, BUMPER_LINKS_MATCH_SETTINGS } from "./config.js";
import { createBumperLinksRandom } from "./course.js";
import { BUMPER_LINKS_SUNK_SCORE, createBumperLinksShotCandidates, simulateBumperLinksShot } from "./solver.js";

/** @typedef {import("./ball.js").BumperLinksBall} BumperLinksBall */
/** @typedef {import("./match.js").BumperLinksMatch} BumperLinksMatch */
/** @typedef {import("./solver.js").BumperLinksShot} BumperLinksShot */
/**
 * Server-only planning state for one bot ball. The rest identity fields say
 * which resting spot the candidate list belongs to.
 * @typedef {object} BumperLinksBotBrain
 * @property {()=>number} random
 * @property {number} restHoleSerial @property {number} restShotId @property {number} restLifeId
 * @property {number} restX @property {number} restZ
 * @property {number} waitSec Reaction delay left.
 * @property {BumperLinksShot[]} candidates
 * @property {number} candidateIndex
 * @property {BumperLinksShot|null} best
 * @property {number} bestScore
 * @property {number} candidatesEvaluatedLastCall Diagnostics and tests.
 */

/** @param {number} seed @returns {BumperLinksBotBrain} */
export function createBumperLinksBotBrain(seed) {
  return {
    random: createBumperLinksRandom(seed),
    restHoleSerial: -1,
    restShotId: -1,
    restLifeId: -1,
    restX: 0,
    restZ: 0,
    waitSec: 0,
    candidates: [],
    candidateIndex: 0,
    best: null,
    bestScore: Infinity,
    candidatesEvaluatedLastCall: 0,
  };
}

/** @param {BumperLinksBotBrain} brain */
function forgetBumperLinksBotRest(brain) {
  brain.restHoleSerial = -1;
  brain.candidates = [];
  brain.best = null;
}

/** @param {BumperLinksBotBrain} brain @param {BumperLinksBall} bot @param {BumperLinksMatch} match */
function isSameBumperLinksBotRest(brain, bot, match) {
  return brain.restHoleSerial === match.holeSerial && brain.restShotId === bot.shotId &&
    brain.restLifeId === bot.lifeId && brain.restX === bot.x && brain.restZ === bot.z;
}

/** @param {BumperLinksBotBrain} brain @param {BumperLinksBall} bot @param {BumperLinksMatch} match */
function beginBumperLinksBotPlan(brain, bot, match) {
  const settings = BUMPER_LINKS_BOT_SETTINGS;
  brain.restHoleSerial = match.holeSerial;
  brain.restShotId = bot.shotId;
  brain.restLifeId = bot.lifeId;
  brain.restX = bot.x;
  brain.restZ = bot.z;
  brain.waitSec = settings.minReactionSec + brain.random() * (settings.maxReactionSec - settings.minReactionSec);
  brain.candidates = createBumperLinksShotCandidates(match.course, bot, {
    yawSamples: settings.yawSamples,
    powerSamples: settings.powerSamples,
  });
  brain.candidateIndex = 0;
  brain.best = null;
  brain.bestScore = Infinity;
}

/**
 * Plan a bot putt a few candidates per tick while its reaction delay runs,
 * then shoot with human-sized aim and power error.
 * @param {BumperLinksBall} bot Read-only here; `aimYaw` shows its current pick.
 * @param {BumperLinksBotBrain} brain Mutated.
 * @param {BumperLinksMatch} match Read-only.
 * @param {number} dtSec
 * @returns {BumperLinksShot|null} A shot to request this tick, or null.
 */
export function decideBumperLinksBotShot(bot, brain, match, dtSec) {
  brain.candidatesEvaluatedLastCall = 0;
  if (match.phase !== "playing" || !match.started || bot.sunk || !bot.atRest ||
      bot.strokes >= BUMPER_LINKS_MATCH_SETTINGS.maxStrokes) {
    forgetBumperLinksBotRest(brain);
    return null;
  }
  if (!isSameBumperLinksBotRest(brain, bot, match)) beginBumperLinksBotPlan(brain, bot, match);

  const settings = BUMPER_LINKS_BOT_SETTINGS;
  for (let evaluated = 0; evaluated < settings.candidatesPerTick && brain.candidateIndex < brain.candidates.length; evaluated += 1) {
    const candidate = brain.candidates[brain.candidateIndex];
    brain.candidateIndex += 1;
    brain.candidatesEvaluatedLastCall += 1;
    const result = simulateBumperLinksShot(match.course, bot, candidate, match.holeTimeSec);
    if (result.score < brain.bestScore) {
      brain.bestScore = result.score;
      brain.best = candidate;
      bot.aimYaw = candidate.aimYaw;
    }
    if (result.score === BUMPER_LINKS_SUNK_SCORE) brain.candidateIndex = brain.candidates.length;
  }
  brain.waitSec -= dtSec;
  if (brain.waitSec > 0 || brain.candidateIndex < brain.candidates.length || !brain.best) return null;

  const shot = {
    aimYaw: brain.best.aimYaw + (brain.random() * 2 - 1) * settings.aimNoiseRad,
    power: Math.max(0.05, Math.min(1, brain.best.power * (1 + (brain.random() * 2 - 1) * settings.powerNoise))),
  };
  forgetBumperLinksBotRest(brain);
  return shot;
}
