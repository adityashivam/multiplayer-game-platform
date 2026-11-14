import { EDGEOUT_BOT_SETTINGS, EDGEOUT_COMBAT_SETTINGS } from "./config.js";
import { getEdgeoutSafeHalfExtent } from "./arena.js";

/** @typedef {import("./simulation.js").EdgeoutFighter} EdgeoutFighter */
/** @typedef {import("./simulation.js").EdgeoutMatch} EdgeoutMatch */
/** @typedef {import("./config.js").EdgeoutInputState} EdgeoutInputState */
/**
 * Server-private bot memory. The input object is owned by the brain and
 * reused every step; callers must not retain it across steps.
 * @typedef {object} EdgeoutBotBrain
 * @property {number} seed 32-bit PRNG state; the same seed replays the same choices.
 * @property {number} thinkSec Time until the next decision.
 * @property {number} shoveHoldSec Remaining hold for the current charge.
 * @property {EdgeoutInputState} input
 */

const EDGE_PRESSURE_DISTANCE = 2.5;
const SHOVE_RANGE_SCALE = 0.95;
const QUICK_TAP_SEC = 0.02;
const DASH_ALIGNMENT_COS = 0.85;

/**
 * Create deterministic bot memory.
 * @param {number} seed Any integer; mixed into a 32-bit state.
 * @returns {EdgeoutBotBrain}
 */
export function createEdgeoutBotBrain(seed) {
  return {
    seed: (Math.imul(seed | 0, 2654435761) ^ 0x9e3779b9) >>> 0,
    thinkSec: 0,
    shoveHoldSec: 0,
    input: { moveX: 0, moveZ: 0, aimX: 0, aimZ: 0, shove: false, dash: false, block: false },
  };
}

/**
 * Mulberry32: small, fast and identical on every JavaScript engine.
 * @param {EdgeoutBotBrain} brain
 * @returns {number} A value in [0, 1).
 */
function nextEdgeoutBotRandom(brain) {
  brain.seed = (brain.seed + 0x6d2b79f5) >>> 0;
  let mixed = brain.seed;
  mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
  mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
  return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
}

/**
 * @param {Readonly<EdgeoutFighter>} bot
 * @param {readonly EdgeoutFighter[]} fighters
 * @returns {EdgeoutFighter|null}
 */
function findEdgeoutBotTarget(bot, fighters) {
  let nearest = null;
  let nearestDistanceSquared = Infinity;
  for (const fighter of fighters) {
    if (fighter === bot || fighter.eliminated) continue;
    const distanceSquared = (fighter.x - bot.x) ** 2 + (fighter.z - bot.z) ** 2;
    if (distanceSquared < nearestDistanceSquared) {
      nearest = fighter;
      nearestDistanceSquared = distanceSquared;
    }
  }
  return nearest;
}

/** @param {EdgeoutInputState} input @param {number} x @param {number} z */
function writeEdgeoutBotMovement(input, x, z) {
  const length = Math.hypot(x, z);
  input.moveX = length > 1e-4 ? x / length : 0;
  input.moveZ = length > 1e-4 ? z / length : 0;
}

/**
 * Is the rival winding up a shove that would reach the bot?
 * @param {Readonly<EdgeoutFighter>} bot
 * @param {Readonly<EdgeoutFighter>} rival
 * @param {number} distance
 */
function isEdgeoutBotThreatened(bot, rival, distance) {
  if (distance > EDGEOUT_BOT_SETTINGS.threatRange || distance < 1e-4) return false;
  if (rival.action !== "charge" && rival.action !== "shove") return false;
  const towardBotX = (bot.x - rival.x) / distance;
  const towardBotZ = (bot.z - rival.z) / distance;
  return towardBotX * Math.sin(rival.facing) + towardBotZ * Math.cos(rival.facing) > 0.5;
}

/**
 * Choose this step's input for one bot: retreat from crumbling edges, block
 * telegraphed shoves, close in, and shove or dash rivals toward the edge.
 * Decisions refresh on a reaction delay; held charges release on their own
 * timer. Pure apart from the supplied brain, which it mutates.
 * @param {Readonly<EdgeoutFighter>} bot
 * @param {EdgeoutBotBrain} brain
 * @param {Readonly<EdgeoutMatch>} match
 * @param {readonly EdgeoutFighter[]} fighters
 * @param {number} dtSec
 * @returns {Readonly<EdgeoutInputState>} The brain-owned input, valid until the next call.
 */
export function decideEdgeoutBotInput(bot, brain, match, fighters, dtSec) {
  const input = brain.input;
  input.dash = false;
  if (brain.shoveHoldSec > 0) {
    brain.shoveHoldSec -= dtSec;
    if (brain.shoveHoldSec <= 0) input.shove = false;
  }
  brain.thinkSec -= dtSec;

  const rival = findEdgeoutBotTarget(bot, fighters);
  if (!rival || bot.eliminated) {
    writeEdgeoutBotMovement(input, 0, 0);
    input.shove = false;
    input.block = false;
    return input;
  }
  const offsetX = rival.x - bot.x;
  const offsetZ = rival.z - bot.z;
  const distance = Math.hypot(offsetX, offsetZ);
  if (distance > 1e-4) {
    input.aimX = offsetX / distance;
    input.aimZ = offsetZ / distance;
  }
  if (brain.thinkSec > 0) return input;
  brain.thinkSec = EDGEOUT_BOT_SETTINGS.reactionSec * (0.7 + 0.6 * nextEdgeoutBotRandom(brain));

  const safeHalfExtent = Math.max(0.5, getEdgeoutSafeHalfExtent(match.arena) - EDGEOUT_BOT_SETTINGS.edgeMargin);
  const nearEdge = Math.max(Math.abs(bot.x), Math.abs(bot.z)) > safeHalfExtent;
  const threatened = isEdgeoutBotThreatened(bot, rival, distance);
  if (nearEdge) {
    writeEdgeoutBotMovement(input, -bot.x, -bot.z);
    input.block = threatened && nextEdgeoutBotRandom(brain) < EDGEOUT_BOT_SETTINGS.blockChance;
    return input;
  }
  if (threatened && nextEdgeoutBotRandom(brain) < EDGEOUT_BOT_SETTINGS.blockChance) {
    writeEdgeoutBotMovement(input, 0, 0);
    input.block = true;
    input.shove = false;
    brain.shoveHoldSec = 0;
    return input;
  }

  input.block = false;
  writeEdgeoutBotMovement(input, offsetX, offsetZ);
  const rivalEdgeDistance = getEdgeoutSafeHalfExtent(match.arena) - Math.max(Math.abs(rival.x), Math.abs(rival.z));
  if (distance < EDGEOUT_COMBAT_SETTINGS.shoveRange * SHOVE_RANGE_SCALE) {
    if (!input.shove && bot.shoveCooldownSec <= 0) {
      const charges = rivalEdgeDistance > EDGE_PRESSURE_DISTANCE && nextEdgeoutBotRandom(brain) < EDGEOUT_BOT_SETTINGS.chargeChance;
      input.shove = true;
      brain.shoveHoldSec = charges
        ? EDGEOUT_BOT_SETTINGS.minChargeSec + (EDGEOUT_BOT_SETTINGS.maxChargeSec - EDGEOUT_BOT_SETTINGS.minChargeSec) * nextEdgeoutBotRandom(brain)
        : QUICK_TAP_SEC;
    }
    return input;
  }

  const inDashRange = distance >= EDGEOUT_BOT_SETTINGS.dashMinRange && distance <= EDGEOUT_BOT_SETTINGS.dashMaxRange;
  const aligned = distance > 1e-4 && (offsetX * Math.sin(bot.facing) + offsetZ * Math.cos(bot.facing)) / distance > DASH_ALIGNMENT_COS;
  if (inDashRange && aligned && bot.dashCooldownSec <= 0 && rivalEdgeDistance < EDGE_PRESSURE_DISTANCE * 1.5 &&
      nextEdgeoutBotRandom(brain) < EDGEOUT_BOT_SETTINGS.dashChance) {
    input.dash = true;
  }
  return input;
}
