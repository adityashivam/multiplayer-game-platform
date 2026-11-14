import {
  createKinematicCharacterController,
  resolveKinematicCharacterSeparation,
} from "../../../platform/shared/kinematicCharacter.js";
import {
  EDGEOUT_ARENA,
  EDGEOUT_CHARACTER_SETTINGS,
  EDGEOUT_COMBAT_SETTINGS,
  EDGEOUT_MATCH_SETTINGS,
} from "./config.js";
import { createEdgeoutArena, getEdgeoutArenaPlatforms, updateEdgeoutArena } from "./arena.js";
import { resolveEdgeoutCombat } from "./combat.js";

/** @typedef {import("./config.js").EdgeoutAction} EdgeoutAction */
/** @typedef {import("./config.js").EdgeoutHitKind} EdgeoutHitKind */
/** @typedef {import("./config.js").EdgeoutPhase} EdgeoutPhase */
/** @typedef {import("./config.js").EdgeoutInputState} EdgeoutInputState */
/** @typedef {import("./arena.js").EdgeoutArena} EdgeoutArena */
/**
 * Game-owned fighter body and combat state. Y is the feet position; facing zero
 * points along positive Z. Every field exists before the first snapshot. SDK
 * command queues, rejoin tokens and bot brains live outside this shape.
 * @typedef {object} EdgeoutFighter
 * @property {string} id Human slot ID or bot ID; unique within a match.
 * @property {number} slotIndex Spawn and camera order.
 * @property {number} colorIndex
 * @property {boolean} isBot
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} vx
 * @property {number} vy
 * @property {number} vz
 * @property {number} facing
 * @property {boolean} grounded
 * @property {number} supportId
 * @property {number} coyoteSec
 * @property {number} jumpBufferSec
 * @property {boolean} jumpHeld
 * @property {boolean} shoveHeld
 * @property {boolean} dashHeld
 * @property {boolean} connected Bots are always connected.
 * @property {EdgeoutAction} action
 * @property {number} actionId Stable animation and hit identity.
 * @property {number} actionTimeSec Elapsed time in the current action.
 * @property {number} chargeSec
 * @property {number} shovePower Released charge fraction from zero to one.
 * @property {number} shoveHitId Action ID of the last shove that connected.
 * @property {number} shoveCooldownSec
 * @property {number} dashCooldownSec
 * @property {number} dashRemainingSec
 * @property {number} dashHitId Action ID of the last dash that connected.
 * @property {number} blockSec Time the current block has been held; drives the parry window.
 * @property {number} stunSec
 * @property {number} damage Percent; scales knockback taken.
 * @property {number} hitSerial Increments whenever this fighter is struck or parried.
 * @property {EdgeoutHitKind} lastHitKind
 * @property {number} lastHitSpeed Knockback speed of the last hit, for effects.
 * @property {number} parrySerial Increments whenever this fighter parries.
 * @property {boolean} eliminated
 * @property {number} roundWins
 * @property {number} seriesWins
 */
/**
 * @typedef {object} EdgeoutMatch
 * @property {number} matchId Changes on rematch; stable through recovery.
 * @property {number} roundNumber One-based round within the match.
 * @property {Record<string,EdgeoutFighter>} players Human seats only.
 * @property {EdgeoutFighter[]} bots Server-owned fighters outside seat ownership.
 * @property {EdgeoutArena} arena
 * @property {number} roundTimeSec Play time this round; drives the collapse schedule.
 * @property {number} timeSec Total simulated match time.
 * @property {boolean} started
 * @property {number|null} startAt
 * @property {boolean} gameOver
 * @property {string|null} winner Fighter ID.
 * @property {EdgeoutPhase} phase
 * @property {string|null} roundWinnerId Null after a drawn round.
 * @property {number} roundSerial Increments when a round ends.
 * @property {number} roundResetRemainingSec
 * @property {number} roundsToWin
 * @property {number} ringOutSerial Increments on every elimination.
 * @property {string|null} lastRingOutId
 */
/** @typedef {{active:boolean,intactRings:number}} EdgeoutFighterStepContext */

const MAX_PURE_STEP_SEC = 0.05;
const TIMER_EPSILON_SEC = 1e-7;
const MIN_INTENT = 0.1;
const SEPARATION_ITERATIONS = 6;
const LOCKED_ACTIONS = new Set(["charge", "shove", "block", "stunned", "victory", "defeat"]);
const NEUTRAL_MOVEMENT = Object.freeze({ x: 0, z: 0, jump: false });
const characterController = createKinematicCharacterController(EDGEOUT_CHARACTER_SETTINGS);
const separationSettings = Object.freeze({
  radius: EDGEOUT_CHARACTER_SETTINGS.radius,
  height: EDGEOUT_CHARACTER_SETTINGS.height,
  iterations: SEPARATION_ITERATIONS,
});
/** Reused per world step; the simulation is single-threaded and never re-enters. */
const fighterScratch = [];
const standingScratch = [];
/** Owned per call so concurrent bodies never share one movement intent. */
const movementIntent = { x: 0, z: 0, jump: false };

/** @param {number} value @param {number} minimum @param {number} maximum */
function clampEdgeoutNumber(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

/** @param {unknown} value @returns {number} A finite axis in [-1, 1]; zero otherwise. */
function readEdgeoutAxis(value) {
  return typeof value === "number" && Number.isFinite(value) ? clampEdgeoutNumber(value, -1, 1) : 0;
}

/**
 * Bound one pure step. Long durations clamp instead of running unlimited
 * catch-up, and invalid durations do no work.
 * @param {number} dtSec
 * @returns {number}
 */
export function getEdgeoutStepDuration(dtSec) {
  return Number.isFinite(dtSec) ? clampEdgeoutNumber(dtSec, 0, MAX_PURE_STEP_SEC) : 0;
}

/**
 * Spawn points sit on a circle facing the centre, so any fighter count works.
 * @param {number} slotIndex
 * @param {number} fighterCount
 * @returns {{x:number,z:number,facing:number}}
 */
export function getEdgeoutSpawn(slotIndex, fighterCount) {
  const angle = (Math.PI * 2 * slotIndex) / Math.max(1, fighterCount);
  return {
    x: EDGEOUT_ARENA.spawnRadius * Math.sin(angle),
    z: EDGEOUT_ARENA.spawnRadius * Math.cos(angle),
    facing: angle + Math.PI,
  };
}

/**
 * Create a fighter at its spawn with full round state cleared.
 * @param {string} id
 * @param {number} slotIndex
 * @param {number} fighterCount
 * @param {boolean} [isBot]
 * @returns {EdgeoutFighter}
 */
export function createEdgeoutFighter(id, slotIndex, fighterCount, isBot = false) {
  const spawn = getEdgeoutSpawn(slotIndex, fighterCount);
  return {
    id,
    slotIndex,
    colorIndex: slotIndex,
    isBot,
    x: spawn.x,
    y: 0,
    z: spawn.z,
    vx: 0,
    vy: 0,
    vz: 0,
    facing: spawn.facing,
    grounded: true,
    supportId: 1,
    coyoteSec: 0,
    jumpBufferSec: 0,
    jumpHeld: false,
    shoveHeld: false,
    dashHeld: false,
    connected: isBot,
    action: "idle",
    actionId: 0,
    actionTimeSec: 0,
    chargeSec: 0,
    shovePower: 0,
    shoveHitId: -1,
    shoveCooldownSec: 0,
    dashCooldownSec: 0,
    dashRemainingSec: 0,
    dashHitId: -1,
    blockSec: 0,
    stunSec: 0,
    damage: 0,
    hitSerial: 0,
    lastHitKind: "none",
    lastHitSpeed: 0,
    parrySerial: 0,
    eliminated: false,
    roundWins: 0,
    seriesWins: 0,
  };
}

/**
 * Create an independent match. Human seats begin unconnected; bots begin
 * connected. Player and bot IDs must be unique across both lists.
 * @param {{playerIds:readonly string[],botIds?:readonly string[]}} options
 * @returns {EdgeoutMatch}
 * @throws {TypeError} If there are fewer than two fighters or IDs repeat.
 */
export function createEdgeoutMatch({ playerIds, botIds = [] }) {
  const fighterIds = [...playerIds, ...botIds];
  if (fighterIds.length < 2 || new Set(fighterIds).size !== fighterIds.length) {
    throw new TypeError("Edgeout needs at least two fighters with unique IDs.");
  }

  const players = {};
  playerIds.forEach((playerId, index) => {
    players[playerId] = createEdgeoutFighter(playerId, index, fighterIds.length);
  });
  const bots = botIds.map((botId, index) => createEdgeoutFighter(botId, playerIds.length + index, fighterIds.length, true));
  return {
    matchId: 1,
    roundNumber: 1,
    players,
    bots,
    arena: createEdgeoutArena(),
    roundTimeSec: 0,
    timeSec: 0,
    started: false,
    startAt: null,
    gameOver: false,
    winner: null,
    phase: "waiting",
    roundWinnerId: null,
    roundSerial: 0,
    roundResetRemainingSec: 0,
    roundsToWin: EDGEOUT_MATCH_SETTINGS.roundsToWin,
    ringOutSerial: 0,
    lastRingOutId: null,
  };
}

/**
 * Collect humans then bots in stable slot order.
 * @param {Readonly<EdgeoutMatch>} match
 * @param {EdgeoutFighter[]} [target] Cleared and refilled when supplied.
 * @returns {EdgeoutFighter[]}
 */
export function listEdgeoutFighters(match, target = []) {
  target.length = 0;
  for (const fighter of Object.values(match.players)) target.push(fighter);
  for (const fighter of match.bots) target.push(fighter);
  return target;
}

/**
 * Begin an action and advance its identity. Re-entering the same action keeps
 * its clock unless `restart` asks for a fresh identity.
 * @param {EdgeoutFighter} fighter
 * @param {EdgeoutAction} action
 * @param {boolean} [restart]
 */
export function beginEdgeoutAction(fighter, action, restart = false) {
  if (fighter.action === action && !restart) return;
  fighter.action = action;
  fighter.actionId += 1;
  fighter.actionTimeSec = 0;
}

/**
 * Cancel held edges and in-progress actions on ownership changes, without
 * touching pose, damage, round wins or series wins. Velocity freezes so a
 * paused fighter cannot drift while awaiting a rejoin.
 * @param {EdgeoutFighter} fighter
 */
export function resetEdgeoutFighterControls(fighter) {
  fighter.shoveHeld = false;
  fighter.dashHeld = false;
  fighter.jumpHeld = false;
  fighter.jumpBufferSec = 0;
  fighter.chargeSec = 0;
  fighter.dashRemainingSec = 0;
  fighter.blockSec = 0;
  fighter.vx = 0;
  fighter.vz = 0;
  if (fighter.grounded) fighter.vy = 0;
  const keepsPose = fighter.eliminated || fighter.action === "victory" || fighter.action === "defeat" || fighter.action === "stunned";
  if (!keepsPose) beginEdgeoutAction(fighter, "idle");
}

/** @param {EdgeoutFighter} fighter @param {number} stepSec */
function stepEdgeoutFighterTimers(fighter, stepSec) {
  fighter.actionTimeSec += stepSec;
  fighter.shoveCooldownSec = Math.max(0, fighter.shoveCooldownSec - stepSec);
  fighter.dashCooldownSec = Math.max(0, fighter.dashCooldownSec - stepSec);
  fighter.dashRemainingSec = Math.max(0, fighter.dashRemainingSec - stepSec);
  fighter.stunSec = Math.max(0, fighter.stunSec - stepSec);
  if (fighter.action === "block") fighter.blockSec += stepSec;
}

/**
 * Apply edge-triggered and held actions. Stunned fighters ignore input.
 * @param {EdgeoutFighter} fighter
 * @param {Readonly<EdgeoutInputState>} input
 * @param {number} moveX
 * @param {number} moveZ
 * @param {number} stepSec
 */
function applyEdgeoutActions(fighter, input, moveX, moveZ, stepSec) {
  const shoveInput = Boolean(input.shove);
  const shovePressed = shoveInput && !fighter.shoveHeld;
  const shoveReleased = !shoveInput && fighter.shoveHeld;
  const dashPressed = Boolean(input.dash) && !fighter.dashHeld;
  fighter.shoveHeld = shoveInput;
  fighter.dashHeld = Boolean(input.dash);
  if (fighter.stunSec > 0) {
    fighter.chargeSec = 0;
    return;
  }
  if (fighter.action === "stunned") beginEdgeoutAction(fighter, "idle");

  const aimX = readEdgeoutAxis(input.aimX);
  const aimZ = readEdgeoutAxis(input.aimZ);
  if (fighter.action !== "shove") {
    if (Math.hypot(aimX, aimZ) > MIN_INTENT) fighter.facing = Math.atan2(aimX, aimZ);
    else if (Math.hypot(moveX, moveZ) > MIN_INTENT) fighter.facing = Math.atan2(moveX, moveZ);
  }

  if (fighter.action === "shove" && fighter.actionTimeSec >= EDGEOUT_COMBAT_SETTINGS.shoveDurationSec) beginEdgeoutAction(fighter, "idle");
  const dashing = fighter.dashRemainingSec > 0;
  if (shoveReleased && fighter.action === "charge") {
    fighter.shovePower = clampEdgeoutNumber(fighter.chargeSec / EDGEOUT_COMBAT_SETTINGS.maxChargeSec, 0, 1);
    fighter.chargeSec = 0;
    fighter.shoveCooldownSec = EDGEOUT_COMBAT_SETTINGS.shoveCooldownSec;
    beginEdgeoutAction(fighter, "shove", true);
  } else if (shovePressed && fighter.shoveCooldownSec <= 0 && !dashing && fighter.action !== "shove") {
    fighter.chargeSec = 0;
    fighter.blockSec = 0;
    beginEdgeoutAction(fighter, "charge", true);
  }
  if (fighter.action === "charge") {
    fighter.chargeSec = Math.min(EDGEOUT_COMBAT_SETTINGS.maxChargeSec, fighter.chargeSec + stepSec);
  }

  if (input.block && !dashing && fighter.action !== "shove" && fighter.action !== "charge") {
    if (fighter.action !== "block") {
      fighter.blockSec = 0;
      beginEdgeoutAction(fighter, "block", true);
    }
  } else if (fighter.action === "block") {
    fighter.blockSec = 0;
    beginEdgeoutAction(fighter, "idle");
  }

  const canDash = fighter.dashCooldownSec <= 0 && fighter.action !== "shove" && fighter.action !== "block";
  if (dashPressed && canDash && fighter.grounded) {
    const movementLength = Math.hypot(moveX, moveZ);
    const directionX = movementLength > MIN_INTENT ? moveX / movementLength : Math.sin(fighter.facing);
    const directionZ = movementLength > MIN_INTENT ? moveZ / movementLength : Math.cos(fighter.facing);
    const dashSpeed = EDGEOUT_CHARACTER_SETTINGS.moveSpeed * EDGEOUT_COMBAT_SETTINGS.dashSpeedScale;
    fighter.vx = directionX * dashSpeed;
    fighter.vz = directionZ * dashSpeed;
    fighter.facing = Math.atan2(directionX, directionZ);
    fighter.chargeSec = 0;
    fighter.dashCooldownSec = EDGEOUT_COMBAT_SETTINGS.dashCooldownSec;
    fighter.dashRemainingSec = EDGEOUT_COMBAT_SETTINGS.dashDurationSec;
    beginEdgeoutAction(fighter, "dash", true);
  }
}

/** @param {EdgeoutFighter} fighter @returns {number} */
function getEdgeoutSpeedScale(fighter) {
  if (fighter.action === "charge") return EDGEOUT_COMBAT_SETTINGS.chargeMoveScale;
  if (fighter.action === "block") return EDGEOUT_COMBAT_SETTINGS.blockMoveScale;
  if (fighter.action === "shove") return EDGEOUT_COMBAT_SETTINGS.shoveMoveScale;
  return 1;
}

/**
 * Knockback keeps its momentum while the controller ignores input and
 * braking; this game-owned friction bleeds it off instead.
 * @param {EdgeoutFighter} fighter
 * @param {number} stepSec
 */
function applyEdgeoutKnockbackFriction(fighter, stepSec) {
  if (!fighter.grounded) return;
  const retained = 1 - Math.min(1, EDGEOUT_COMBAT_SETTINGS.stunFrictionPerSec * stepSec);
  fighter.vx *= retained;
  fighter.vz *= retained;
}

/**
 * Shared fighter movement and action timing. Mutates only this fighter; the
 * world owns hits, eliminations and rounds. Input axes are world-space X/Z.
 * An inactive or zero-length step consumes no edges or timers.
 * @param {EdgeoutFighter} fighter
 * @param {Readonly<EdgeoutInputState>} input
 * @param {number} dtSec
 * @param {EdgeoutFighterStepContext} context
 */
export function stepEdgeoutFighter(fighter, input, dtSec, { active, intactRings }) {
  if (!active || fighter.eliminated) return;
  const stepSec = getEdgeoutStepDuration(dtSec);
  if (stepSec <= 0) return;

  stepEdgeoutFighterTimers(fighter, stepSec);
  const moveX = readEdgeoutAxis(input.moveX);
  const moveZ = readEdgeoutAxis(input.moveZ);
  applyEdgeoutActions(fighter, input, moveX, moveZ, stepSec);

  const stunned = fighter.stunSec > 0;
  if (stunned) applyEdgeoutKnockbackFriction(fighter, stepSec);
  movementIntent.x = stunned ? 0 : moveX;
  movementIntent.z = stunned ? 0 : moveZ;
  characterController.step(fighter, movementIntent, stepSec, {
    platforms: getEdgeoutArenaPlatforms(intactRings),
    controlScale: stunned || fighter.dashRemainingSec > 0 ? 0 : 1,
    speedScale: getEdgeoutSpeedScale(fighter),
  });

  if (!LOCKED_ACTIONS.has(fighter.action)) {
    if (!fighter.grounded) beginEdgeoutAction(fighter, "falling");
    else if (fighter.dashRemainingSec > 0) beginEdgeoutAction(fighter, "dash");
    else beginEdgeoutAction(fighter, Math.hypot(fighter.vx, fighter.vz) > 0.3 ? "run" : "idle");
  } else if (!fighter.grounded && fighter.action !== "stunned") {
    fighter.chargeSec = 0;
    beginEdgeoutAction(fighter, "falling");
  }
}

/**
 * Ballistic fall for eliminated fighters; bounded so long rounds stay finite.
 * @param {EdgeoutFighter} fighter
 * @param {number} stepSec
 */
function stepEdgeoutFallingFighter(fighter, stepSec) {
  if (fighter.y <= EDGEOUT_ARENA.lowestFallY) return;
  fighter.vy -= EDGEOUT_CHARACTER_SETTINGS.gravity * stepSec;
  fighter.x += fighter.vx * stepSec;
  fighter.y = Math.max(EDGEOUT_ARENA.lowestFallY, fighter.y + fighter.vy * stepSec);
  fighter.z += fighter.vz * stepSec;
  fighter.actionTimeSec += stepSec;
}

/**
 * Push overlapping standing bodies apart, then re-validate floor support so a
 * push past the edge starts a fall on the next step.
 * @param {EdgeoutFighter[]} fighters
 * @param {number} intactRings
 */
function separateEdgeoutFighters(fighters, intactRings) {
  standingScratch.length = 0;
  for (const fighter of fighters) {
    if (!fighter.eliminated && fighter.grounded) standingScratch.push(fighter);
  }
  if (standingScratch.length < 2) return;
  resolveKinematicCharacterSeparation(standingScratch, separationSettings);
  const platforms = getEdgeoutArenaPlatforms(intactRings);
  for (const fighter of standingScratch) characterController.step(fighter, NEUTRAL_MOVEMENT, 0, { platforms });
}

/**
 * @param {EdgeoutMatch} match
 * @param {EdgeoutFighter[]} fighters
 */
function recordEdgeoutEliminations(match, fighters) {
  for (const fighter of fighters) {
    if (fighter.eliminated || fighter.y > EDGEOUT_ARENA.eliminationY) continue;
    fighter.eliminated = true;
    fighter.stunSec = 0;
    fighter.chargeSec = 0;
    fighter.dashRemainingSec = 0;
    beginEdgeoutAction(fighter, "falling");
    match.ringOutSerial += 1;
    match.lastRingOutId = fighter.id;
  }
}

/**
 * A lone survivor still in the air may yet fall, so the round waits for it to
 * land or drop out before deciding a winner.
 * @param {EdgeoutMatch} match
 * @param {EdgeoutFighter[]} fighters
 * @returns {boolean} True when the round ended this step.
 */
function decideEdgeoutRound(match, fighters) {
  let survivor = null;
  let survivorCount = 0;
  for (const fighter of fighters) {
    if (fighter.eliminated) continue;
    survivor = fighter;
    survivorCount += 1;
  }
  if (survivorCount > 1 || (survivor && !survivor.grounded)) return false;

  match.roundSerial += 1;
  match.roundWinnerId = survivor ? survivor.id : null;
  if (survivor) {
    survivor.roundWins += 1;
    survivor.vx = 0;
    survivor.vz = 0;
    survivor.stunSec = 0;
    beginEdgeoutAction(survivor, "victory", true);
  }
  if (survivor && survivor.roundWins >= match.roundsToWin) {
    finishEdgeoutMatch(match, fighters, survivor);
    return true;
  }
  match.phase = "roundOver";
  match.roundResetRemainingSec = EDGEOUT_MATCH_SETTINGS.roundResetSec;
  return true;
}

/**
 * @param {EdgeoutMatch} match
 * @param {EdgeoutFighter[]} fighters
 * @param {EdgeoutFighter} champion
 */
function finishEdgeoutMatch(match, fighters, champion) {
  match.gameOver = true;
  match.winner = champion.id;
  match.phase = "finished";
  match.roundResetRemainingSec = 0;
  champion.seriesWins += 1;
  for (const fighter of fighters) {
    if (fighter.eliminated) continue;
    resetEdgeoutFighterControls(fighter);
    beginEdgeoutAction(fighter, fighter === champion ? "victory" : "defeat", true);
  }
}

/**
 * Return every fighter to its spawn for the next round. Round wins, series
 * wins, connection and action identity carry forward; damage resets.
 * @param {EdgeoutMatch} match
 * @param {EdgeoutFighter[]} fighters
 */
function startNextEdgeoutRound(match, fighters) {
  for (const fighter of fighters) {
    const nextFighter = createEdgeoutFighter(fighter.id, fighter.slotIndex, fighters.length, fighter.isBot);
    nextFighter.colorIndex = fighter.colorIndex;
    nextFighter.connected = fighter.connected;
    nextFighter.roundWins = fighter.roundWins;
    nextFighter.seriesWins = fighter.seriesWins;
    nextFighter.actionId = fighter.actionId + 1;
    nextFighter.hitSerial = fighter.hitSerial;
    nextFighter.parrySerial = fighter.parrySerial;
    Object.assign(fighter, nextFighter);
  }
  match.roundNumber += 1;
  match.roundTimeSec = 0;
  match.roundResetRemainingSec = 0;
  match.roundWinnerId = null;
  Object.assign(match.arena, createEdgeoutArena());
  match.phase = "playing";
}

/**
 * Advance hits, the collapse schedule, eliminations and round results once
 * after every fighter has moved. Authority calls this; prediction does not.
 * Long durations clamp to 0.05 s; unstarted or finished matches are inert.
 * @param {EdgeoutMatch} match
 * @param {number} dtSec
 */
export function stepEdgeoutWorld(match, dtSec) {
  if (!match.started || match.gameOver) return;
  const stepSec = getEdgeoutStepDuration(dtSec);
  if (stepSec <= 0) return;

  const fighters = listEdgeoutFighters(match, fighterScratch);
  match.timeSec += stepSec;
  if (match.phase === "roundOver") {
    for (const fighter of fighters) if (fighter.eliminated) stepEdgeoutFallingFighter(fighter, stepSec);
    match.roundResetRemainingSec = Math.max(0, match.roundResetRemainingSec - stepSec);
    if (match.roundResetRemainingSec <= TIMER_EPSILON_SEC) startNextEdgeoutRound(match, fighters);
    return;
  }

  match.phase = "playing";
  match.roundTimeSec += stepSec;
  updateEdgeoutArena(match.arena, match.roundTimeSec);
  resolveEdgeoutCombat(fighters);
  separateEdgeoutFighters(fighters, match.arena.intactRings);
  for (const fighter of fighters) if (fighter.eliminated) stepEdgeoutFallingFighter(fighter, stepSec);
  recordEdgeoutEliminations(match, fighters);
  decideEdgeoutRound(match, fighters);
}
