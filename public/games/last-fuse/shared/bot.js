import { LAST_FUSE_BOT_SETTINGS } from "./config.js";
import { findLastFuseRoofAt, getLastFuseCityLayout, isLastFuseRoofCollapsed } from "./city.js";

/** @typedef {import("./runner.js").LastFuseRunner} LastFuseRunner */
/** @typedef {import("./match.js").LastFuseMatch} LastFuseMatch */
/** @typedef {import("./city.js").LastFuseRoof} LastFuseRoof */
/** @typedef {import("./city.js").LastFuseCityLayout} LastFuseCityLayout */
/** @typedef {import("./config.js").LastFuseInputState} LastFuseInputState */
/**
 * Server-private bot memory. The input object is owned by the brain and
 * reused every step; callers must not retain it.
 * @typedef {object} LastFuseBotBrain
 * @property {number} seed 32-bit PRNG state; the same seed replays the same choices.
 * @property {number} thinkSec Time until the next decision.
 * @property {number} goalX
 * @property {number} goalZ
 * @property {number} goalRoofId Roof the goal sits on.
 * @property {boolean} wantsDash
 * @property {LastFuseInputState} input
 */

const ROOF_INSET_M = 0.9;
const GOAL_REACHED_M = 0.4;
const PANIC_RANGE_M = 2.6;
const CALM_RANGE_M = 13;
const MIN_JUMP_SPEED = 3;

/**
 * @param {number} seed Any integer; mixed into a 32-bit state.
 * @returns {LastFuseBotBrain}
 */
export function createLastFuseBotBrain(seed) {
  return {
    seed: (Math.imul(seed | 0, 2654435761) ^ 0x9e3779b9) >>> 0,
    thinkSec: 0,
    goalX: 0,
    goalZ: 0,
    goalRoofId: 0,
    wantsDash: false,
    input: { moveX: 0, moveZ: 0, jump: false, dash: false, viewLagTicks: 0 },
  };
}

/** @param {LastFuseBotBrain} brain @returns {number} A value in [0, 1). */
function nextLastFuseBotRandom(brain) {
  brain.seed = (brain.seed + 0x6d2b79f5) >>> 0;
  let mixed = brain.seed;
  mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
  mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
  return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
}

/** @param {Readonly<LastFuseMatch>} match @param {LastFuseRoof} roof */
function isRoofUsable(match, roof) {
  return !isLastFuseRoofCollapsed(match.city.collapsedMask, roof.id) && roof.id !== match.city.crumblingRoofId;
}

/**
 * Next roof on the shortest jump path, or the start roof when already there.
 * @param {Readonly<LastFuseMatch>} match
 * @param {LastFuseCityLayout} layout
 * @param {number} fromId
 * @param {number} toId
 * @returns {number} Roof ID, or zero when unreachable.
 */
function findNextRoofTowards(match, layout, fromId, toId) {
  if (fromId === toId) return fromId;
  const previous = new Map([[fromId, 0]]);
  const queue = [fromId];
  while (queue.length > 0) {
    const roofId = queue.shift();
    if (roofId === toId) break;
    for (const neighborId of layout.roofs[roofId - 1].neighborIds) {
      if (previous.has(neighborId) || !isRoofUsable(match, layout.roofs[neighborId - 1])) continue;
      previous.set(neighborId, roofId);
      queue.push(neighborId);
    }
  }
  if (!previous.has(toId)) return 0;
  let step = toId;
  while (previous.get(step) !== fromId) step = previous.get(step);
  return step;
}

/** @param {LastFuseRoof} roof @param {number} x @param {number} z @returns {{x:number,z:number}} A point kept off the roof edge. */
function clampToRoof(roof, x, z) {
  const halfWidth = Math.max(0.2, roof.width / 2 - ROOF_INSET_M);
  const halfDepth = Math.max(0.2, roof.depth / 2 - ROOF_INSET_M);
  return {
    x: Math.max(roof.x - halfWidth, Math.min(roof.x + halfWidth, x)),
    z: Math.max(roof.z - halfDepth, Math.min(roof.z + halfDepth, z)),
  };
}

/** @param {LastFuseCityLayout} layout @param {Readonly<LastFuseMatch>} match @param {Readonly<LastFuseRunner>} runner */
function findRunnerRoof(layout, match, runner) {
  if (runner.grounded && runner.supportId > 0) return layout.roofs[runner.supportId - 1];
  return findLastFuseRoofAt(layout, match.city.collapsedMask, runner.x, runner.z, 0.4);
}

/**
 * Set a goal point on a roof, routing through the next jump when it is
 * elsewhere.
 * @param {LastFuseBotBrain} brain
 * @param {Readonly<LastFuseMatch>} match
 * @param {LastFuseCityLayout} layout
 * @param {LastFuseRoof} ownRoof
 * @param {LastFuseRoof} targetRoof
 * @param {number} targetX
 * @param {number} targetZ
 * @param {Readonly<LastFuseRunner>} bot
 */
function routeLastFuseBot(brain, match, layout, ownRoof, targetRoof, targetX, targetZ, bot) {
  const nextRoofId = findNextRoofTowards(match, layout, ownRoof.id, targetRoof.id);
  if (nextRoofId === 0 || nextRoofId === ownRoof.id) {
    const point = clampToRoof(ownRoof, targetX, targetZ);
    brain.goalX = point.x;
    brain.goalZ = point.z;
    brain.goalRoofId = ownRoof.id;
    return;
  }
  const nextRoof = layout.roofs[nextRoofId - 1];
  const landing = clampToRoof(nextRoof, bot.x, bot.z);
  brain.goalX = landing.x;
  brain.goalZ = landing.z;
  brain.goalRoofId = nextRoofId;
}

/**
 * Holder: chase the closest runner that can take the bomb.
 * @param {LastFuseBotBrain} brain
 * @param {Readonly<LastFuseMatch>} match
 * @param {LastFuseCityLayout} layout
 * @param {LastFuseRoof} ownRoof
 * @param {Readonly<LastFuseRunner>} bot
 * @param {readonly LastFuseRunner[]} runners
 */
function planLastFuseChase(brain, match, layout, ownRoof, bot, runners) {
  let target = null;
  let targetDistance = Infinity;
  for (const runner of runners) {
    if (runner === bot || runner.eliminated || runner.fallen) continue;
    if (runner.id === match.bomb.lastPasserId && match.bomb.tagBackSec > 0) continue;
    const distance = Math.hypot(runner.x - bot.x, runner.z - bot.z);
    if (distance < targetDistance) {
      target = runner;
      targetDistance = distance;
    }
  }
  if (!target) return;
  const targetRoof = findRunnerRoof(layout, match, target) ?? ownRoof;
  const leadX = target.x + target.vx * 0.25;
  const leadZ = target.z + target.vz * 0.25;
  routeLastFuseBot(brain, match, layout, ownRoof, targetRoof, leadX, leadZ, bot);
  if (targetRoof.id === ownRoof.id) {
    brain.goalX = leadX;
    brain.goalZ = leadZ;
  }
  brain.wantsDash = targetDistance < LAST_FUSE_BOT_SETTINGS.dashRange && nextLastFuseBotRandom(brain) < LAST_FUSE_BOT_SETTINGS.dashChance;
}

/**
 * Everyone else: put roofs between yourself and the bomb.
 * @param {LastFuseBotBrain} brain
 * @param {Readonly<LastFuseMatch>} match
 * @param {LastFuseCityLayout} layout
 * @param {LastFuseRoof} ownRoof
 * @param {Readonly<LastFuseRunner>} bot
 * @param {Readonly<LastFuseRunner>|null} holder
 */
function planLastFuseFlight(brain, match, layout, ownRoof, bot, holder) {
  const dangerX = holder ? holder.x : 0;
  const dangerZ = holder ? holder.z : 0;
  const holderDistance = holder ? Math.hypot(holder.x - bot.x, holder.z - bot.z) : Infinity;
  const ownRoofSafe = isRoofUsable(match, ownRoof);
  if (holderDistance > CALM_RANGE_M && ownRoofSafe) {
    const wander = clampToRoof(ownRoof, ownRoof.x + (nextLastFuseBotRandom(brain) - 0.5) * 3, ownRoof.z + (nextLastFuseBotRandom(brain) - 0.5) * 3);
    brain.goalX = wander.x;
    brain.goalZ = wander.z;
    brain.goalRoofId = ownRoof.id;
    brain.wantsDash = false;
    return;
  }

  let bestRoof = ownRoofSafe ? ownRoof : null;
  let bestScore = ownRoofSafe ? Math.hypot(ownRoof.x - dangerX, ownRoof.z - dangerZ) : -Infinity;
  for (const neighborId of ownRoof.neighborIds) {
    const neighbor = layout.roofs[neighborId - 1];
    if (!isRoofUsable(match, neighbor)) continue;
    const score = Math.hypot(neighbor.x - dangerX, neighbor.z - dangerZ) - 1.5 + nextLastFuseBotRandom(brain) * 2;
    if (score > bestScore) {
      bestRoof = neighbor;
      bestScore = score;
    }
  }
  if (!bestRoof) bestRoof = ownRoof;
  if (bestRoof === ownRoof) {
    const awayX = bot.x - dangerX;
    const awayZ = bot.z - dangerZ;
    const length = Math.hypot(awayX, awayZ) || 1;
    const point = clampToRoof(ownRoof, bot.x + (awayX / length) * 6, bot.z + (awayZ / length) * 6);
    brain.goalX = point.x;
    brain.goalZ = point.z;
    brain.goalRoofId = ownRoof.id;
  } else {
    const landing = clampToRoof(bestRoof, bot.x, bot.z);
    brain.goalX = landing.x;
    brain.goalZ = landing.z;
    brain.goalRoofId = bestRoof.id;
  }
  brain.wantsDash = holderDistance < PANIC_RANGE_M && nextLastFuseBotRandom(brain) < LAST_FUSE_BOT_SETTINGS.dashChance;
}

/**
 * Decide one bot's input from the authoritative world. Deterministic for a
 * given brain seed and world history.
 * @param {Readonly<LastFuseRunner>} bot
 * @param {LastFuseBotBrain} brain
 * @param {Readonly<LastFuseMatch>} match
 * @param {readonly LastFuseRunner[]} runners
 * @param {number} dtSec
 * @returns {LastFuseInputState} The brain-owned input object.
 */
export function decideLastFuseBotInput(bot, brain, match, runners, dtSec) {
  const input = brain.input;
  input.moveX = 0;
  input.moveZ = 0;
  input.jump = false;
  input.dash = false;
  if (bot.eliminated || bot.fallen || match.phase !== "playing") return input;

  const layout = getLastFuseCityLayout(match.city.seed);
  const ownRoof = findRunnerRoof(layout, match, bot);
  brain.thinkSec -= dtSec;
  const holder = runners.find((runner) => runner.id === match.bomb.holderId) ?? null;
  const isHolder = holder === bot;
  if (ownRoof && brain.thinkSec <= 0) {
    brain.thinkSec = isHolder ? LAST_FUSE_BOT_SETTINGS.chaseReplanSec : LAST_FUSE_BOT_SETTINGS.reactionSec + nextLastFuseBotRandom(brain) * LAST_FUSE_BOT_SETTINGS.fleeReplanSec;
    if (isHolder) planLastFuseChase(brain, match, layout, ownRoof, bot, runners);
    else planLastFuseFlight(brain, match, layout, ownRoof, bot, holder);
  }

  const offsetX = brain.goalX - bot.x;
  const offsetZ = brain.goalZ - bot.z;
  const distance = Math.hypot(offsetX, offsetZ);
  if (distance > GOAL_REACHED_M) {
    const scale = Math.min(1, distance / 1.5);
    input.moveX = (offsetX / distance) * scale;
    input.moveZ = (offsetZ / distance) * scale;
  }
  if (brain.wantsDash && bot.dashCooldownSec <= 0 && distance > 1) {
    input.dash = true;
    brain.wantsDash = false;
  }
  if (ownRoof && bot.grounded && brain.goalRoofId !== ownRoof.id && distance > GOAL_REACHED_M && Math.hypot(bot.vx, bot.vz) > MIN_JUMP_SPEED) {
    const aheadX = bot.x + (offsetX / distance) * LAST_FUSE_BOT_SETTINGS.ledgeLookAheadM;
    const aheadZ = bot.z + (offsetZ / distance) * LAST_FUSE_BOT_SETTINGS.ledgeLookAheadM;
    const footing = findLastFuseRoofAt(layout, match.city.collapsedMask, aheadX, aheadZ);
    if (!footing || footing.id !== ownRoof.id) input.jump = true;
  }
  return input;
}
