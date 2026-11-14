import { SKYBREAK_ARENA, SKYBREAK_BOT_SETTINGS, SKYBREAK_COMBAT_SETTINGS } from "./config.js";
import { getSkybreakGroundClearanceHeight } from "./terrain.js";

/** @typedef {import("./flight.js").SkybreakJet} SkybreakJet */
/** @typedef {import("./match.js").SkybreakMatch} SkybreakMatch */
/** @typedef {import("./config.js").SkybreakInputState} SkybreakInputState */
/**
 * Server-private pilot memory; its input object is reused every step.
 * @typedef {object} SkybreakBotBrain
 * @property {number} seed 32-bit PRNG state.
 * @property {number} skill Zero to one: aim tolerance, reaction and nerve.
 * @property {string|null} targetId
 * @property {number} retargetSec
 * @property {number} flareCooldownSec
 * @property {SkybreakInputState} input
 */

const RETARGET_SEC = 4;
/** Below this angle off the nose, steering switches from bank-and-pull to fine corrections. */
const FINE_AIM_RAD = 0.22;

/** Mulberry32 step. @param {SkybreakBotBrain} brain */
function nextSkybreakBotRandom(brain) {
  brain.seed = (brain.seed + 0x6d2b79f5) >>> 0;
  let mixed = brain.seed;
  mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
  mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
  return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
}

/** @param {number} seed @returns {SkybreakBotBrain} */
export function createSkybreakBotBrain(seed) {
  const brain = {
    seed: (Math.imul(seed | 0, 2654435761) ^ 0x27d4eb2f) >>> 0,
    skill: 0,
    targetId: null,
    retargetSec: 0,
    flareCooldownSec: 0,
    input: { pitch: 0, roll: 0, yaw: 0, boost: false, brake: false, fire: false, missile: false, flare: false, restart: false, viewLagTicks: 0 },
  };
  brain.skill = 1 - SKYBREAK_BOT_SETTINGS.skillSpread * nextSkybreakBotRandom(brain);
  return brain;
}

/**
 * Steer toward a world direction by banking the lift vector onto it and
 * pulling: the way real pilots turn. Writes pitch, roll and yaw.
 * @param {SkybreakJet} jet
 * @param {number} directionX
 * @param {number} directionY
 * @param {number} directionZ
 * @param {SkybreakInputState} input
 */
function steerSkybreakBot(jet, directionX, directionY, directionZ, input) {
  const rightX = jet.forwardY * jet.upZ - jet.forwardZ * jet.upY;
  const rightY = jet.forwardZ * jet.upX - jet.forwardX * jet.upZ;
  const rightZ = jet.forwardX * jet.upY - jet.forwardY * jet.upX;
  const ahead = directionX * jet.forwardX + directionY * jet.forwardY + directionZ * jet.forwardZ;
  const side = directionX * rightX + directionY * rightY + directionZ * rightZ;
  const above = directionX * jet.upX + directionY * jet.upY + directionZ * jet.upZ;
  const gain = SKYBREAK_BOT_SETTINGS.steerGain;
  const offNose = Math.acos(Math.max(-1, Math.min(1, ahead)));
  if (offNose < FINE_AIM_RAD) {
    // Nearly on target: level the wings and make small direct corrections.
    input.roll = Math.max(-1, Math.min(1, rightY * 2.5));
    input.pitch = Math.max(-1, Math.min(1, above * gain * 2.5));
    input.yaw = Math.max(-1, Math.min(1, side * 4));
    return;
  }
  // Far off target: roll the lift vector onto it, then pull.
  const bankError = Math.atan2(side, above);
  input.roll = Math.max(-1, Math.min(1, bankError * gain));
  const aligned = Math.cos(bankError);
  input.pitch = Math.max(-1, Math.min(1, aligned > 0.5 ? offNose * gain * 1.5 : 0));
  input.yaw = Math.max(-1, Math.min(1, side * 2));
}

/**
 * @param {SkybreakJet} bot
 * @param {readonly SkybreakJet[]} jets
 * @returns {SkybreakJet|null}
 */
function chooseSkybreakBotTarget(bot, jets) {
  let best = null;
  let bestScore = Infinity;
  for (const jet of jets) {
    if (jet === bot || !jet.alive) continue;
    const distance = Math.hypot(jet.x - bot.x, jet.y - bot.y, jet.z - bot.z);
    const score = distance - jet.kills * 120;
    if (score < bestScore) {
      bestScore = score;
      best = jet;
    }
  }
  return best;
}

/**
 * Decide one bot's controls. Priorities: avoid terrain, stay in the arena,
 * defend against missiles, then hunt with lead pursuit, guns and missiles.
 * Pure apart from the supplied brain.
 * @param {SkybreakJet} bot
 * @param {SkybreakBotBrain} brain
 * @param {Readonly<SkybreakMatch>} match
 * @param {readonly SkybreakJet[]} jets
 * @param {number} dtSec
 * @returns {Readonly<SkybreakInputState>}
 */
export function decideSkybreakBotInput(bot, brain, match, jets, dtSec) {
  const input = brain.input;
  input.fire = false;
  input.missile = false;
  input.flare = false;
  input.boost = false;
  input.brake = false;
  brain.retargetSec -= dtSec;
  brain.flareCooldownSec = Math.max(0, brain.flareCooldownSec - dtSec);
  if (!bot.alive) return input;

  const lookahead = bot.speed * SKYBREAK_BOT_SETTINGS.terrainLookaheadSec;
  const probeX = bot.x + bot.forwardX * lookahead;
  const probeY = bot.y + bot.forwardY * lookahead;
  const probeZ = bot.z + bot.forwardZ * lookahead;
  const groundAhead = Math.max(getSkybreakGroundClearanceHeight(probeX, probeZ), getSkybreakGroundClearanceHeight(bot.x, bot.z));
  if (probeY < groundAhead + SKYBREAK_BOT_SETTINGS.terrainMarginM || bot.y < groundAhead + SKYBREAK_BOT_SETTINGS.terrainMarginM * 0.6) {
    steerSkybreakBot(bot, bot.forwardX * 0.3, 1, bot.forwardZ * 0.3, input);
    input.boost = bot.fuel > 0.3;
    return input;
  }
  const radial = Math.hypot(bot.x, bot.z);
  if (radial > SKYBREAK_ARENA.radiusM * 0.85 || bot.y > SKYBREAK_ARENA.ceilingM * 0.9) {
    const length = Math.hypot(bot.x, bot.y - SKYBREAK_ARENA.spawnAltitudeM, bot.z) || 1;
    steerSkybreakBot(bot, -bot.x / length, (SKYBREAK_ARENA.spawnAltitudeM - bot.y) / length, -bot.z / length, input);
    return input;
  }

  if (bot.incomingMissile && brain.flareCooldownSec <= 0 && bot.flares > 0) {
    const threat = match.missiles.find((missile) => missile.targetId === bot.id);
    if (threat && Math.hypot(threat.x - bot.x, threat.y - bot.y, threat.z - bot.z) < SKYBREAK_BOT_SETTINGS.flareReactRangeM * brain.skill &&
        nextSkybreakBotRandom(brain) < 0.2 + 0.6 * brain.skill) {
      input.flare = true;
      brain.flareCooldownSec = 1.5;
    }
  }

  let target = brain.targetId ? jets.find((jet) => jet.id === brain.targetId && jet.alive) ?? null : null;
  if (!target || brain.retargetSec <= 0) {
    target = chooseSkybreakBotTarget(bot, jets);
    brain.targetId = target?.id ?? null;
    brain.retargetSec = RETARGET_SEC * (0.7 + 0.6 * nextSkybreakBotRandom(brain));
  }
  if (!target) {
    steerSkybreakBot(bot, -bot.x / (radial || 1), 0, -bot.z / (radial || 1), input);
    return input;
  }

  const distance = Math.hypot(target.x - bot.x, target.y - bot.y, target.z - bot.z);
  const flightTime = distance / SKYBREAK_COMBAT_SETTINGS.bulletSpeed;
  const leadX = target.x + target.forwardX * target.speed * flightTime - bot.x;
  const leadY = target.y + target.forwardY * target.speed * flightTime - bot.y;
  const leadZ = target.z + target.forwardZ * target.speed * flightTime - bot.z;
  const leadLength = Math.hypot(leadX, leadY, leadZ) || 1;
  steerSkybreakBot(bot, leadX / leadLength, leadY / leadLength, leadZ / leadLength, input);
  const aimError = Math.acos(Math.max(-1, Math.min(1, (leadX * bot.forwardX + leadY * bot.forwardY + leadZ * bot.forwardZ) / leadLength)));
  input.boost = distance > 1100 && bot.fuel > 0.4;
  input.brake = distance < 250;
  input.fire = distance < SKYBREAK_BOT_SETTINGS.fireRangeM && aimError < SKYBREAK_BOT_SETTINGS.aimToleranceRad / brain.skill && bot.heat < 0.85;
  input.missile = bot.lockProgress >= 1 && bot.lockTargetId === target.id && nextSkybreakBotRandom(brain) < 0.05 * brain.skill;
  return input;
}

/**
 * Fly the time-trial course gate by gate. Used to calibrate medal times and
 * to check the course is completable; a strong human beats it with boost
 * timing and tighter lines.
 * @param {SkybreakJet} jet
 * @param {readonly import("./terrain.js").SkybreakGate[]} gates
 * @param {SkybreakInputState} input Overwritten.
 * @returns {SkybreakInputState}
 */
export function decideSkybreakCourseAutopilot(jet, gates, input) {
  const gate = gates[jet.gateIndex];
  input.fire = false;
  input.missile = false;
  input.flare = false;
  input.brake = false;
  if (!gate) return input;
  const aimX = gate.x - jet.x;
  const aimY = gate.y - jet.y;
  const aimZ = gate.z - jet.z;
  const distance = Math.hypot(aimX, aimY, aimZ) || 1;
  const throughX = aimX / distance;
  const throughY = aimY / distance;
  const throughZ = aimZ / distance;
  steerSkybreakBot(jet, throughX, throughY, throughZ, input);
  input.boost = jet.fuel > 0.25 && distance > 250 && (throughX * jet.forwardX + throughY * jet.forwardY + throughZ * jet.forwardZ) > 0.97;
  input.brake = distance < 200 && (throughX * jet.forwardX + throughY * jet.forwardY + throughZ * jet.forwardZ) < 0.8;
  return input;
}
