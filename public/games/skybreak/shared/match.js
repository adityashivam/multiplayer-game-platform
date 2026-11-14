import { SKYBREAK_ARENA, SKYBREAK_COMBAT_SETTINGS, SKYBREAK_MATCH_SETTINGS } from "./config.js";
import { createSkybreakJet, getSkybreakStepDuration, placeSkybreakJet } from "./flight.js";
import {
  applySkybreakHazards,
  createSkybreakCombatPools,
  recordSkybreakPoses,
  stepSkybreakBullets,
  stepSkybreakMissiles,
} from "./combat.js";
import { SKYBREAK_COURSE_GATES, getSkybreakCourseStart } from "./terrain.js";

/** @typedef {import("./flight.js").SkybreakJet} SkybreakJet */
/** @typedef {import("./config.js").SkybreakMode} SkybreakMode */
/** @typedef {import("./config.js").SkybreakPhase} SkybreakPhase */
/** @typedef {import("./config.js").SkybreakInputState} SkybreakInputState */
/**
 * @typedef {import("./combat.js").SkybreakCombatState & {
 *   matchId:number,mode:SkybreakMode,players:Record<string,SkybreakJet>,bots:SkybreakJet[],
 *   phase:SkybreakPhase,started:boolean,startAt:number|null,gameOver:boolean,winner:string|null,
 *   matchTimeSec:number,durationSec:number,killsToWin:number
 * }} SkybreakMatch
 */

const RUN_RESTART_AFTER_CRASH_SEC = 1;
/** Reused per world step; the simulation never re-enters. */
const jetScratch = [];

/**
 * Create a match with every jet at its spawn. Human seats start unconnected.
 * @param {{mode:SkybreakMode,playerIds:readonly string[],botIds?:readonly string[]}} options
 * @returns {SkybreakMatch}
 * @throws {TypeError} For an empty or duplicate roster.
 */
export function createSkybreakMatch({ mode, playerIds, botIds = [] }) {
  const jetIds = [...playerIds, ...botIds];
  if (jetIds.length < 1 || new Set(jetIds).size !== jetIds.length) throw new TypeError("Skybreak needs at least one jet and unique jet IDs.");
  const players = {};
  playerIds.forEach((playerId, index) => { players[playerId] = createSkybreakJet(playerId, index); });
  const match = {
    matchId: 1,
    mode,
    players,
    bots: botIds.map((botId, index) => createSkybreakJet(botId, playerIds.length + index, true)),
    phase: "waiting",
    started: false,
    startAt: null,
    gameOver: false,
    winner: null,
    timeSec: 0,
    matchTimeSec: 0,
    durationSec: SKYBREAK_MATCH_SETTINGS.durationSec,
    killsToWin: SKYBREAK_MATCH_SETTINGS.killsToWin,
    tick: 0,
    missiles: [],
    nextMissileId: 1,
    killFeed: [],
    killSerial: 0,
    ...createSkybreakCombatPools(jetIds),
  };
  for (const jet of listSkybreakJets(match)) spawnSkybreakJet(match, jet, jetIds.length);
  return match;
}

/**
 * Humans then bots in slot order.
 * @param {Readonly<SkybreakMatch>} match
 * @param {SkybreakJet[]} [target]
 */
export function listSkybreakJets(match, target = []) {
  target.length = 0;
  for (const jet of Object.values(match.players)) target.push(jet);
  for (const jet of match.bots) target.push(jet);
  return target;
}

/**
 * Dogfight spawns sit on a ring facing the centre, rotated by each life so
 * respawns do not repeat. Time-trial spawns sit behind the first gate.
 * @param {SkybreakMatch} match
 * @param {SkybreakJet} jet
 * @param {number} jetCount
 */
export function spawnSkybreakJet(match, jet, jetCount) {
  if (match.mode === "timeTrial") {
    const start = getSkybreakCourseStart();
    placeSkybreakJet(jet, start);
  } else {
    const angle = (Math.PI * 2 * jet.slotIndex) / Math.max(1, jetCount) + jet.deathSerial * 0.9;
    const x = Math.sin(angle) * SKYBREAK_ARENA.spawnRadiusM;
    const z = Math.cos(angle) * SKYBREAK_ARENA.spawnRadiusM;
    placeSkybreakJet(jet, { x, y: SKYBREAK_ARENA.spawnAltitudeM + (jet.slotIndex % 3) * 40, z, forwardX: -x, forwardZ: -z });
  }
  Object.assign(jet, {
    alive: true,
    health: SKYBREAK_COMBAT_SETTINGS.maxHealth,
    respawnSec: 0,
    shieldSec: match.mode === "dogfight" ? SKYBREAK_COMBAT_SETTINGS.spawnShieldSec : 0,
    heat: 0,
    overheatSec: 0,
    fireCooldownSec: 0,
    missiles: SKYBREAK_COMBAT_SETTINGS.maxMissiles,
    missileReloadSec: 0,
    flares: SKYBREAK_COMBAT_SETTINGS.maxFlares,
    flareRechargeSec: 0,
    lockTargetId: null,
    lockProgress: 0,
    fuel: 1,
  });
  jet.respawnId += 1;
}

/**
 * Begin a fresh time-trial run from the start gate.
 * @param {SkybreakMatch} match
 * @param {SkybreakJet} jet
 */
export function restartSkybreakRun(match, jet) {
  spawnSkybreakJet(match, jet, 1);
  jet.gateIndex = 0;
  jet.runTimeSec = 0;
  jet.runActive = true;
  jet.runSerial += 1;
}

/**
 * Consume the restart edge for a time-trial pilot. Called with the jet's own
 * input before flight, so a restart takes effect the same step.
 * @param {SkybreakMatch} match
 * @param {SkybreakJet} jet
 * @param {Readonly<SkybreakInputState>} input
 */
export function applySkybreakRestartInput(match, jet, input) {
  const pressed = Boolean(input.restart) && !jet.restartHeld;
  jet.restartHeld = Boolean(input.restart);
  if (pressed && match.mode === "timeTrial" && match.started) restartSkybreakRun(match, jet);
}

/**
 * Did this step's path cross the gate's plane inside its ring?
 * @param {SkybreakJet} jet
 * @param {Readonly<import("./terrain.js").SkybreakGate>} gate
 */
export function crossedSkybreakGate(jet, gate) {
  const before = (jet.previousX - gate.x) * gate.forwardX + (jet.previousY - gate.y) * gate.forwardY + (jet.previousZ - gate.z) * gate.forwardZ;
  const after = (jet.x - gate.x) * gate.forwardX + (jet.y - gate.y) * gate.forwardY + (jet.z - gate.z) * gate.forwardZ;
  if (!(before < 0 && after >= 0)) return false;
  const amount = before / (before - after);
  const crossX = jet.previousX + (jet.x - jet.previousX) * amount;
  const crossY = jet.previousY + (jet.y - jet.previousY) * amount;
  const crossZ = jet.previousZ + (jet.z - jet.previousZ) * amount;
  return Math.hypot(crossX - gate.x, crossY - gate.y, crossZ - gate.z) <= gate.radius;
}

/**
 * Time-trial rules: advance gates in order, finish the run, and restart a
 * crashed pilot shortly after impact. Runs never end the match.
 * @param {SkybreakMatch} match
 * @param {SkybreakJet[]} jets
 * @param {number} stepSec
 */
function stepSkybreakTimeTrial(match, jets, stepSec) {
  for (const jet of jets) {
    if (jet.crashed) {
      jet.crashed = false;
      jet.alive = false;
      jet.runActive = false;
      jet.deathSerial += 1;
      jet.lastDeathCause = "terrain";
      jet.respawnSec = RUN_RESTART_AFTER_CRASH_SEC;
      continue;
    }
    if (!jet.alive) {
      jet.respawnSec -= stepSec;
      if (jet.respawnSec <= 0) restartSkybreakRun(match, jet);
      continue;
    }
    if (!jet.runActive) continue;
    jet.runTimeSec += stepSec;
    const gate = SKYBREAK_COURSE_GATES[jet.gateIndex];
    if (gate && crossedSkybreakGate(jet, gate)) jet.gateIndex += 1;
    if (jet.gateIndex >= SKYBREAK_COURSE_GATES.length) {
      jet.runActive = false;
      jet.lastRunSec = jet.runTimeSec;
      jet.bestRunSec = jet.bestRunSec > 0 ? Math.min(jet.bestRunSec, jet.runTimeSec) : jet.runTimeSec;
      jet.runSerial += 1;
    }
  }
}

/**
 * The dogfight ends at the kill limit or when the clock runs out; most kills
 * wins, then fewest deaths, then grid order.
 * @param {SkybreakMatch} match
 * @param {SkybreakJet[]} jets
 */
function decideSkybreakDogfight(match, jets) {
  const leader = [...jets].sort((jetA, jetB) => jetB.kills - jetA.kills || jetA.deaths - jetB.deaths || jetA.slotIndex - jetB.slotIndex)[0];
  if (!leader) return;
  if (leader.kills < match.killsToWin && match.matchTimeSec < match.durationSec) return;
  match.gameOver = true;
  match.phase = "finished";
  match.winner = leader.id;
}

/**
 * Advance rounds, missiles, hazards, respawns and match results once per
 * tick after every jet has flown. Authority calls this; prediction does not.
 * @param {SkybreakMatch} match
 * @param {number} dtSec
 */
export function stepSkybreakWorld(match, dtSec) {
  if (!match.started || match.gameOver) return;
  const stepSec = getSkybreakStepDuration(dtSec);
  if (stepSec <= 0) return;
  const jets = listSkybreakJets(match, jetScratch);
  match.phase = "playing";
  match.tick += 1;
  match.timeSec += stepSec;
  match.matchTimeSec += stepSec;
  if (match.mode === "timeTrial") {
    stepSkybreakTimeTrial(match, jets, stepSec);
    return;
  }

  recordSkybreakPoses(match, jets);
  stepSkybreakBullets(match, jets, stepSec);
  stepSkybreakMissiles(match, jets, stepSec);
  applySkybreakHazards(match, jets, stepSec);
  for (const jet of jets) {
    if (jet.alive) continue;
    jet.respawnSec -= stepSec;
    if (jet.respawnSec <= 0) spawnSkybreakJet(match, jet, jets.length);
  }
  decideSkybreakDogfight(match, jets);
}

/**
 * Called once when authority starts the match: time-trial pilots begin
 * their first run at the start signal.
 * @param {SkybreakMatch} match
 */
export function startSkybreakMatch(match) {
  if (match.mode !== "timeTrial") return;
  for (const jet of listSkybreakJets(match, jetScratch)) restartSkybreakRun(match, jet);
}
