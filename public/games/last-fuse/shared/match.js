import { resolveKinematicCharacterSeparation } from "../../../platform/shared/kinematicCharacter.js";
import { LAST_FUSE_BOMB_SETTINGS, LAST_FUSE_CHARACTER_SETTINGS, LAST_FUSE_CITY, LAST_FUSE_MATCH_SETTINGS } from "./config.js";
import {
  chooseLastFuseCrumblingRoof,
  createLastFuseCityState,
  getLastFuseCityLayout,
  getLastFusePlatforms,
  isLastFuseRoofCollapsed,
  stepLastFuseCity,
} from "./city.js";
import {
  beginLastFuseAction,
  createLastFuseRunner,
  getLastFuseStepDuration,
  placeLastFuseRunner,
  resetLastFuseRunnerControls,
  stepLastFuseFallingRunner,
} from "./runner.js";

/** @typedef {import("./runner.js").LastFuseRunner} LastFuseRunner */
/** @typedef {import("./city.js").LastFuseCityState} LastFuseCityState */
/** @typedef {import("./config.js").LastFusePhase} LastFusePhase */
/**
 * The one bomb in play.
 * @typedef {object} LastFuseBomb
 * @property {string|null} holderId
 * @property {number} fuseSec Remaining fuse while held.
 * @property {number} fuseTotalSec Fuse length when this bomb was armed.
 * @property {number} armSec Delay before the next bomb appears; counts while nobody holds one.
 * @property {number} bombsThisRound Bombs that have exploded this round.
 * @property {string|null} lastPasserId Cannot be tagged straight back.
 * @property {number} tagBackSec
 * @property {number} passSerial
 * @property {string|null} lastPassFromId
 * @property {number} blastSerial
 * @property {string|null} lastBlastId
 * @property {number} blastX
 * @property {number} blastY
 * @property {number} blastZ
 */
/**
 * @typedef {object} LastFuseMatch
 * @property {number} matchId Changes on rematch; stable through recovery.
 * @property {number} roundNumber One-based.
 * @property {number} rounds
 * @property {Record<string,LastFuseRunner>} players Human seats only.
 * @property {LastFuseRunner[]} bots Server-owned runners outside seat ownership.
 * @property {LastFuseCityState} city
 * @property {LastFuseBomb} bomb
 * @property {number} roundTimeSec
 * @property {number} timeSec
 * @property {boolean} started
 * @property {number|null} startAt
 * @property {boolean} gameOver
 * @property {string|null} winner
 * @property {LastFusePhase} phase
 * @property {string|null} roundWinnerId
 * @property {number} roundSerial
 * @property {number} roundResetRemainingSec
 * @property {number} fallSerial
 * @property {string|null} lastFallId
 * @property {number} rngState Server-private choice stream; never snapshotted.
 * @property {Map<string,Float32Array>} [poseHistory] Server-private rewind ring.
 * @property {number} [historyTick]
 */

const SEPARATION_ITERATIONS = 4;
const TIMER_EPSILON_SEC = 1e-7;
const HISTORY_STRIDE = 3;
const separationSettings = Object.freeze({
  radius: LAST_FUSE_CHARACTER_SETTINGS.radius,
  height: LAST_FUSE_CHARACTER_SETTINGS.height,
  iterations: SEPARATION_ITERATIONS,
});
const PASS_DISTANCE = LAST_FUSE_CHARACTER_SETTINGS.radius * 2 + LAST_FUSE_BOMB_SETTINGS.passReach;
const PASS_HEIGHT = LAST_FUSE_CHARACTER_SETTINGS.height * 0.8;
/** Reused per world step; the simulation is single-threaded. */
const runnerScratch = [];
const standingScratch = [];
const sampledPose = { x: 0, y: 0, z: 0 };

/**
 * Mulberry32 on the match's private stream.
 * @param {LastFuseMatch} match
 * @returns {number} A value in [0, 1).
 */
function nextLastFuseRandom(match) {
  match.rngState = (match.rngState + 0x6d2b79f5) >>> 0;
  let mixed = match.rngState;
  mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
  mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
  return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
}

/** @param {number} matchId @param {number} roundNumber @returns {number} A city seed per round. */
export function getLastFuseRoundSeed(matchId, roundNumber) {
  return (Math.imul(matchId, 7919) + Math.imul(roundNumber, 104729) + 17) >>> 0;
}

/** @returns {LastFuseBomb} */
function createLastFuseBomb() {
  return {
    holderId: null,
    fuseSec: 0,
    fuseTotalSec: 0,
    armSec: LAST_FUSE_BOMB_SETTINGS.armDelaySec,
    bombsThisRound: 0,
    lastPasserId: null,
    tagBackSec: 0,
    passSerial: 0,
    lastPassFromId: null,
    blastSerial: 0,
    lastBlastId: null,
    blastX: 0,
    blastY: 0,
    blastZ: 0,
  };
}

/**
 * Collect humans then bots in stable slot order.
 * @param {Readonly<LastFuseMatch>} match
 * @param {LastFuseRunner[]} [target] Cleared and refilled when supplied.
 * @returns {LastFuseRunner[]}
 */
export function listLastFuseRunners(match, target = []) {
  target.length = 0;
  for (const runner of Object.values(match.players)) target.push(runner);
  for (const runner of match.bots) target.push(runner);
  return target;
}

/**
 * Put every runner on its spawn roof for the current round's city.
 * @param {LastFuseMatch} match
 * @param {LastFuseRunner[]} runners
 */
function spawnLastFuseRunners(match, runners) {
  const layout = getLastFuseCityLayout(match.city.seed);
  for (const runner of runners) {
    const roofId = layout.spawnRoofIds[runner.slotIndex % layout.spawnRoofIds.length];
    placeLastFuseRunner(runner, layout.roofs[roofId - 1]);
    runner.eliminated = false;
  }
}

/**
 * Create an independent match. Human seats begin unconnected; bots begin
 * connected. IDs must be unique across both lists.
 * @param {{playerIds:readonly string[],botIds?:readonly string[],matchId?:number}} options
 * @returns {LastFuseMatch}
 * @throws {TypeError} With fewer than two runners, repeated IDs or more runners than spawn roofs.
 */
export function createLastFuseMatch({ playerIds, botIds = [], matchId = 1 }) {
  const runnerIds = [...playerIds, ...botIds];
  if (runnerIds.length < 2 || new Set(runnerIds).size !== runnerIds.length) {
    throw new TypeError("Last Fuse needs at least two runners with unique IDs.");
  }
  if (runnerIds.length > getLastFuseCityLayout(1).spawnRoofIds.length) {
    throw new TypeError("Last Fuse has more runners than spawn roofs.");
  }
  const players = {};
  playerIds.forEach((playerId, index) => { players[playerId] = createLastFuseRunner(playerId, index); });
  const bots = botIds.map((botId, index) => createLastFuseRunner(botId, playerIds.length + index, true));
  const match = {
    matchId,
    roundNumber: 1,
    rounds: LAST_FUSE_MATCH_SETTINGS.rounds,
    players,
    bots,
    city: createLastFuseCityState(getLastFuseRoundSeed(matchId, 1)),
    bomb: createLastFuseBomb(),
    roundTimeSec: 0,
    timeSec: 0,
    started: false,
    startAt: null,
    gameOver: false,
    winner: null,
    phase: /** @type {LastFusePhase} */ ("waiting"),
    roundWinnerId: null,
    roundSerial: 0,
    roundResetRemainingSec: 0,
    fallSerial: 0,
    lastFallId: null,
    rngState: (Math.imul(matchId, 2246822519) ^ 0x27d4eb2f) >>> 0,
  };
  spawnLastFuseRunners(match, listLastFuseRunners(match));
  return match;
}

/** @param {Readonly<LastFuseMatch>} match @returns {ReadonlyArray<Readonly<import("./city.js").LastFusePlatform>>} */
export function getLastFuseMatchPlatforms(match) {
  return getLastFusePlatforms(match.city.seed, match.city.collapsedMask);
}

/** @param {Readonly<LastFuseRunner>} runner */
function isLastFuseRunnerInPlay(runner) {
  return !runner.eliminated && !runner.fallen;
}

/**
 * Record this tick's poses for rewound passes. Server-private; bounded ring.
 * @param {LastFuseMatch} match
 * @param {readonly LastFuseRunner[]} runners
 */
export function recordLastFusePoses(match, runners) {
  const length = LAST_FUSE_BOMB_SETTINGS.poseHistoryTicks;
  if (!match.poseHistory) {
    match.poseHistory = new Map();
    match.historyTick = 0;
  }
  match.historyTick += 1;
  const slot = (match.historyTick % length) * HISTORY_STRIDE;
  for (const runner of runners) {
    let ring = match.poseHistory.get(runner.id);
    if (!ring) {
      ring = new Float32Array(length * HISTORY_STRIDE).fill(Number.NaN);
      match.poseHistory.set(runner.id, ring);
    }
    ring[slot] = runner.x;
    ring[slot + 1] = runner.y;
    ring[slot + 2] = runner.z;
  }
}

/**
 * Where a runner was some ticks ago. Unknown or teleported history falls back
 * to the current pose.
 * @param {Readonly<LastFuseMatch>} match
 * @param {Readonly<LastFuseRunner>} runner
 * @param {number} ticksAgo
 * @param {{x:number,y:number,z:number}} target Reused output.
 */
export function sampleLastFusePose(match, runner, ticksAgo, target) {
  target.x = runner.x;
  target.y = runner.y;
  target.z = runner.z;
  const length = LAST_FUSE_BOMB_SETTINGS.poseHistoryTicks;
  const ring = match.poseHistory?.get(runner.id);
  const lag = Math.max(0, Math.min(length - 1, Math.round(ticksAgo)));
  if (!ring || lag === 0) return target;
  const slot = (((match.historyTick - lag) % length) + length) % length * HISTORY_STRIDE;
  if (Number.isNaN(ring[slot])) return target;
  target.x = ring[slot];
  target.y = ring[slot + 1];
  target.z = ring[slot + 2];
  return target;
}

/**
 * Arm a new bomb on a random runner still in play.
 * @param {LastFuseMatch} match
 * @param {LastFuseRunner[]} runners
 */
function armLastFuseBomb(match, runners) {
  const candidates = runners.filter((runner) => isLastFuseRunnerInPlay(runner));
  if (candidates.length === 0) return;
  const holder = candidates[Math.floor(nextLastFuseRandom(match) * candidates.length)];
  const bomb = match.bomb;
  bomb.holderId = holder.id;
  bomb.fuseTotalSec = Math.max(LAST_FUSE_BOMB_SETTINGS.minFuseSec,
    LAST_FUSE_BOMB_SETTINGS.firstFuseSec - LAST_FUSE_BOMB_SETTINGS.fuseStepSec * bomb.bombsThisRound);
  bomb.fuseSec = bomb.fuseTotalSec;
  bomb.lastPasserId = null;
  bomb.tagBackSec = 0;
  bomb.passSerial += 1;
  bomb.lastPassFromId = null;
}

/**
 * Hand the bomb to the first runner the holder touches. The holder's own pose
 * is current; rivals are tested where the holder saw them (rewound by its
 * reported view lag) and where they are now.
 * @param {LastFuseMatch} match
 * @param {LastFuseRunner[]} runners
 */
function passLastFuseBomb(match, runners) {
  const bomb = match.bomb;
  const holder = runners.find((runner) => runner.id === bomb.holderId);
  if (!holder || !isLastFuseRunnerInPlay(holder) || holder.staggerSec > 0) return;
  const lagTicks = holder.isBot ? 0 : Math.min(LAST_FUSE_BOMB_SETTINGS.maxViewLagTicks, holder.viewLagTicks);
  for (const target of runners) {
    if (target === holder || !isLastFuseRunnerInPlay(target)) continue;
    if (target.id === bomb.lastPasserId && bomb.tagBackSec > 0) continue;
    const touchingNow = Math.hypot(target.x - holder.x, target.z - holder.z) <= PASS_DISTANCE && Math.abs(target.y - holder.y) <= PASS_HEIGHT;
    sampleLastFusePose(match, target, lagTicks, sampledPose);
    const touchingSeen = Math.hypot(sampledPose.x - holder.x, sampledPose.z - holder.z) <= PASS_DISTANCE && Math.abs(sampledPose.y - holder.y) <= PASS_HEIGHT;
    if (!touchingNow && !touchingSeen) continue;

    bomb.holderId = target.id;
    bomb.lastPasserId = holder.id;
    bomb.lastPassFromId = holder.id;
    bomb.tagBackSec = LAST_FUSE_BOMB_SETTINGS.tagBackImmunitySec;
    bomb.fuseSec = Math.max(Math.min(bomb.fuseSec, LAST_FUSE_BOMB_SETTINGS.minFuseAfterPassSec), bomb.fuseSec - LAST_FUSE_BOMB_SETTINGS.passBurnSec);
    bomb.passSerial += 1;
    holder.passes += 1;
    target.staggerSec = LAST_FUSE_BOMB_SETTINGS.receiverStaggerSec;
    return;
  }
}

/**
 * The holder is out; nearby runners are thrown clear; survivors score; a roof
 * starts to crumble; the next bomb waits.
 * @param {LastFuseMatch} match
 * @param {LastFuseRunner[]} runners
 */
function detonateLastFuseBomb(match, runners) {
  const bomb = match.bomb;
  const holder = runners.find((runner) => runner.id === bomb.holderId);
  bomb.holderId = null;
  bomb.fuseSec = 0;
  bomb.armSec = LAST_FUSE_BOMB_SETTINGS.armDelaySec;
  bomb.bombsThisRound += 1;
  bomb.lastPasserId = null;
  bomb.tagBackSec = 0;
  if (!holder) return;

  bomb.blastSerial += 1;
  bomb.lastBlastId = holder.id;
  bomb.blastX = holder.x;
  bomb.blastY = holder.y;
  bomb.blastZ = holder.z;
  holder.eliminated = true;
  holder.fallen = false;
  holder.vx = 0;
  holder.vz = 0;
  holder.vy = 0;
  beginLastFuseAction(holder, "out", true);

  for (const runner of runners) {
    if (runner === holder || runner.eliminated) continue;
    runner.points += LAST_FUSE_MATCH_SETTINGS.survivePoints;
    if (runner.fallen) continue;
    const offsetX = runner.x - holder.x;
    const offsetZ = runner.z - holder.z;
    const distance = Math.hypot(offsetX, offsetZ);
    if (distance > LAST_FUSE_BOMB_SETTINGS.blastRadius || Math.abs(runner.y - holder.y) > 3) continue;
    const strength = 1 - distance / LAST_FUSE_BOMB_SETTINGS.blastRadius;
    const directionX = distance > 0.01 ? offsetX / distance : Math.sin(runner.facing + Math.PI);
    const directionZ = distance > 0.01 ? offsetZ / distance : Math.cos(runner.facing + Math.PI);
    runner.vx = directionX * LAST_FUSE_BOMB_SETTINGS.blastImpulse * (0.4 + strength * 0.6);
    runner.vz = directionZ * LAST_FUSE_BOMB_SETTINGS.blastImpulse * (0.4 + strength * 0.6);
    runner.vy = LAST_FUSE_BOMB_SETTINGS.blastLift * (0.5 + strength * 0.5);
    runner.grounded = false;
    runner.supportId = 0;
    runner.stunSec = 0.35 + strength * 0.35;
    beginLastFuseAction(runner, "stagger", true);
  }

  if (match.city.crumblingRoofId === 0) {
    const roofId = chooseLastFuseCrumblingRoof(getLastFuseCityLayout(match.city.seed), match.city, holder.x, holder.z);
    if (roofId > 0) {
      match.city.crumblingRoofId = roofId;
      match.city.crumbleRemainingSec = LAST_FUSE_CITY.crumbleWarningSec;
    }
  }
}

/**
 * The standing roof farthest from every danger: the bomb holder, else the
 * centre. Deterministic, so respawns never land beside the bomb.
 * @param {LastFuseMatch} match
 * @param {LastFuseRunner[]} runners
 */
function chooseLastFuseRespawnRoof(match, runners) {
  const layout = getLastFuseCityLayout(match.city.seed);
  const holder = runners.find((runner) => runner.id === match.bomb.holderId);
  const dangerX = holder ? holder.x : 0;
  const dangerZ = holder ? holder.z : 0;
  let best = null;
  let bestDistance = -1;
  for (const roof of layout.roofs) {
    if (isLastFuseRoofCollapsed(match.city.collapsedMask, roof.id) || roof.id === match.city.crumblingRoofId) continue;
    const distance = (roof.x - dangerX) ** 2 + (roof.z - dangerZ) ** 2;
    if (distance > bestDistance) {
      best = roof;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Runners below the street line are out of play until they respawn. The
 * bomb keeps burning in a faller's hands.
 * @param {LastFuseMatch} match
 * @param {LastFuseRunner[]} runners
 * @param {number} stepSec
 */
function stepLastFuseFalls(match, runners, stepSec) {
  for (const runner of runners) {
    if (runner.eliminated) continue;
    if (!runner.fallen && runner.y < LAST_FUSE_CITY.fallY) {
      runner.fallen = true;
      runner.respawnSec = LAST_FUSE_BOMB_SETTINGS.respawnSec;
      runner.stunSec = 0;
      runner.dashRemainingSec = 0;
      beginLastFuseAction(runner, "fall", true);
      match.fallSerial += 1;
      match.lastFallId = runner.id;
      continue;
    }
    if (!runner.fallen) continue;
    stepLastFuseFallingRunner(runner, stepSec);
    runner.respawnSec = Math.max(0, runner.respawnSec - stepSec);
    if (runner.respawnSec > TIMER_EPSILON_SEC) continue;
    const roof = chooseLastFuseRespawnRoof(match, runners);
    if (roof) placeLastFuseRunner(runner, roof);
  }
}

/**
 * Push overlapping standing runners apart, so bodies block and a shoulder can
 * nudge someone off a ledge.
 * @param {LastFuseRunner[]} runners
 */
function separateLastFuseRunners(runners) {
  standingScratch.length = 0;
  for (const runner of runners) {
    if (isLastFuseRunnerInPlay(runner) && runner.grounded) standingScratch.push(runner);
  }
  if (standingScratch.length >= 2) resolveKinematicCharacterSeparation(standingScratch, separationSettings);
}

/**
 * One runner left standing ends the round; the last round ends the match.
 * @param {LastFuseMatch} match
 * @param {LastFuseRunner[]} runners
 */
function decideLastFuseRound(match, runners) {
  let survivor = null;
  let survivorCount = 0;
  for (const runner of runners) {
    if (runner.eliminated) continue;
    survivor = runner;
    survivorCount += 1;
  }
  if (survivorCount > 1) return;

  match.roundSerial += 1;
  match.roundWinnerId = survivor ? survivor.id : null;
  match.bomb.holderId = null;
  if (survivor) {
    survivor.points += LAST_FUSE_MATCH_SETTINGS.lastStandingPoints;
    survivor.roundWins += 1;
    resetLastFuseRunnerControls(survivor);
    beginLastFuseAction(survivor, "victory", true);
  }
  if (match.roundNumber >= match.rounds) {
    finishLastFuseMatch(match, runners);
    return;
  }
  match.phase = "roundOver";
  match.roundResetRemainingSec = LAST_FUSE_MATCH_SETTINGS.roundResetSec;
}

/**
 * Rank by points, then round wins, then slot order.
 * @param {readonly LastFuseRunner[]} runners
 * @returns {LastFuseRunner[]} A new owned array.
 */
export function rankLastFuseRunners(runners) {
  return [...runners].sort((first, second) => second.points - first.points || second.roundWins - first.roundWins || first.slotIndex - second.slotIndex);
}

/** @param {LastFuseMatch} match @param {LastFuseRunner[]} runners */
function finishLastFuseMatch(match, runners) {
  match.gameOver = true;
  match.phase = "finished";
  match.roundResetRemainingSec = 0;
  match.winner = rankLastFuseRunners(runners)[0].id;
}

/**
 * Fresh city, everyone back on a spawn roof; points and round wins carry.
 * @param {LastFuseMatch} match
 * @param {LastFuseRunner[]} runners
 */
function startNextLastFuseRound(match, runners) {
  match.roundNumber += 1;
  match.roundTimeSec = 0;
  match.roundResetRemainingSec = 0;
  match.roundWinnerId = null;
  match.city = createLastFuseCityState(getLastFuseRoundSeed(match.matchId, match.roundNumber));
  const { passSerial, blastSerial } = match.bomb;
  match.bomb = createLastFuseBomb();
  match.bomb.passSerial = passSerial;
  match.bomb.blastSerial = blastSerial;
  match.poseHistory?.clear();
  spawnLastFuseRunners(match, runners);
  match.phase = "playing";
}

/**
 * Advance bombs, passes, blasts, falls, crumbling roofs and rounds once after
 * every runner has moved. Authority calls this; prediction does not.
 * Unstarted or finished matches are inert.
 * @param {LastFuseMatch} match
 * @param {number} dtSec
 */
export function stepLastFuseWorld(match, dtSec) {
  if (!match.started || match.gameOver) return;
  const stepSec = getLastFuseStepDuration(dtSec);
  if (stepSec <= 0) return;

  const runners = listLastFuseRunners(match, runnerScratch);
  match.timeSec += stepSec;
  if (match.phase === "roundOver") {
    for (const runner of runners) if (runner.fallen) stepLastFuseFallingRunner(runner, stepSec);
    match.roundResetRemainingSec = Math.max(0, match.roundResetRemainingSec - stepSec);
    if (match.roundResetRemainingSec <= TIMER_EPSILON_SEC) startNextLastFuseRound(match, runners);
    return;
  }

  match.phase = "playing";
  match.roundTimeSec += stepSec;
  stepLastFuseCity(match.city, stepSec);
  separateLastFuseRunners(runners);
  stepLastFuseFalls(match, runners, stepSec);
  recordLastFusePoses(match, runners);

  const bomb = match.bomb;
  bomb.tagBackSec = Math.max(0, bomb.tagBackSec - stepSec);
  if (bomb.holderId === null) {
    bomb.armSec = Math.max(0, bomb.armSec - stepSec);
    if (bomb.armSec <= TIMER_EPSILON_SEC) armLastFuseBomb(match, runners);
  } else {
    passLastFuseBomb(match, runners);
    bomb.fuseSec = Math.max(0, bomb.fuseSec - stepSec);
    if (bomb.fuseSec <= TIMER_EPSILON_SEC) detonateLastFuseBomb(match, runners);
  }
  decideLastFuseRound(match, runners);
}
