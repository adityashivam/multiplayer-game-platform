import { NETWORK_TIMING } from "../../../platform/shared/networkProtocol.js";
import {
  createHorizontalSeparationController,
  createSideViewCharacterController,
  createTimedActionController,
} from "../../../platform/shared/simulationControllers.js";

/** @typedef {"p1"|"p2"} FightPlayerId */
/** @typedef {"light"|"light2"|"finisher"|"heavy"|"sweep"|"launcher"|"aerial"|"special"} FightAttackType */
/** @typedef {{left: boolean, right: boolean, jump: boolean, attack: boolean, heavyAttack: boolean, aerialAttack: boolean, block: boolean, dash: boolean, specialAttack: boolean, crouch: boolean}} FightInputState */
/**
 * Mutable, deterministic player state shared by authority and prediction.
 * @typedef {object} FightPlayerState
 * @property {number} x
 * @property {number} y
 * @property {number} vx
 * @property {number} vy
 * @property {1|-1} dir
 * @property {number} health
 * @property {boolean} dead
 * @property {boolean} attacking
 * @property {FightAttackType|null} attackType
 * @property {number} attackTimer
 * @property {number} cooldownTimer
 * @property {boolean} hasHitThisSwing
 * @property {number} attackId
 * @property {number} guardMeter
 * @property {number} specialMeter
 * @property {boolean} guarding
 * @property {boolean} crouching
 * @property {number} guardTimer
 * @property {number} guardBrokenTimer
 * @property {number} stunTimer
 * @property {number} dashTimer
 * @property {"dodge"|"slide"|null} dashType
 * @property {number} dashCooldown
 * @property {1|-1} dashDir
 * @property {number} comboStep
 * @property {number} comboWindowTimer
 * @property {number} comboHits
 * @property {number} comboHitTimer
 * @property {FightAttackType|null} bufferedAttack
 * @property {number} bufferTimerSec
 */
/** @typedef {{label: string, damage: number, range: number, duration: number, cooldown: number, startupSec: number, activeSec: number, stunSec: number, pushPx: number, guardDamage: number}} FightAttackDefinition */
/** @typedef {{kind: "hit"|"block"|"parry"|"guard-break", attackType: FightAttackType, damage: number}} FightImpact */

export const FIGHT_FIXED_DT_SEC = NETWORK_TIMING.FIXED_DT_SEC;
/** @type {Readonly<FightInputState>} */
export const FIGHT_INPUT_TEMPLATE = Object.freeze({
  left: false, right: false, jump: false, attack: false, heavyAttack: false,
  aerialAttack: false, block: false, dash: false, specialAttack: false, crouch: false,
});
/** @type {ReadonlyArray<keyof FightInputState>} */
export const FIGHT_ACTION_EDGE_KEYS = Object.freeze(["jump", "attack", "heavyAttack", "aerialAttack", "dash", "specialAttack"]);
export const FIGHT_MOVEMENT = Object.freeze({
  GROUND_Y: 870, MOVE_SPEED: 500, ATTACK_MOVE_SPEED: 150, JUMP_SPEED: -850,
  GRAVITY: 1600, MIN_X: 100, MAX_X: 1180, MIN_HORIZONTAL_SEPARATION: 120,
  VERTICAL_SEPARATION_LIMIT: 100, JUMP_GROUND_TOLERANCE: 1, AERIAL_ATTACK_GROUND_OFFSET: 5,
});
export const FIGHT_COMBAT = Object.freeze({
  MAX_HEALTH: 500, MAX_GUARD: 100, MAX_SPECIAL: 100, ROUND_DURATION_SEC: 90,
  PARRY_WINDOW_SEC: .12, PARRY_STUN_SEC: .32, GUARD_BREAK_SEC: .8,
  GUARD_REGEN_PER_SEC: 24, GUARD_MOVE_SCALE: .3, CROUCH_MOVE_SCALE: .5,
  DASH_DURATION_SEC: .16, DASH_INVULNERABLE_SEC: .08, DASH_COOLDOWN_SEC: .45,
  DASH_SPEED: 1100, DASH_GUARD_COST: 20, INPUT_BUFFER_SEC: .14,
  SLIDE_DURATION_SEC: .32, SLIDE_SPEED: 850, SLIDE_GUARD_COST: 25, SLIDE_COOLDOWN_SEC: .65,
  COMBO_WINDOW_SEC: .75, COMBO_HIT_WINDOW_SEC: .85, HIT_HEIGHT: 145,
});
/** @type {Readonly<Record<FightAttackType, FightAttackDefinition>>} */
export const FIGHT_ATTACK_DEFINITIONS = Object.freeze({
  light: {
    label: "Quick slash", damage: 24, range: 215,
    duration: .24, cooldown: .02, startupSec: .055,
    activeSec: .075, stunSec: .16, pushPx: 14,
    guardDamage: 15,
  },
  light2: {
    label: "Cross cut", damage: 28, range: 230,
    duration: .26, cooldown: .02, startupSec: .06,
    activeSec: .08, stunSec: .18, pushPx: 18,
    guardDamage: 18,
  },
  finisher: {
    label: "Combo finisher", damage: 44, range: 255,
    duration: .36, cooldown: .05, startupSec: .09,
    activeSec: .085, stunSec: .24, pushPx: 60,
    guardDamage: 26,
  },
  heavy: {
    label: "Heavy cleave", damage: 65, range: 280,
    duration: .53, cooldown: .07, startupSec: .18,
    activeSec: .1, stunSec: .28, pushPx: 55,
    guardDamage: 42,
  },
  sweep: {
    label: "Low sweep", damage: 34, range: 235,
    duration: .43, cooldown: .04, startupSec: .12,
    activeSec: .09, stunSec: .22, pushPx: 28,
    guardDamage: 25,
  },
  launcher: {
    label: "Rising cut", damage: 36, range: 215,
    duration: .44, cooldown: .06, startupSec: .11,
    activeSec: .09, stunSec: .26, pushPx: 18,
    guardDamage: 28,
  },
  aerial: {
    label: "Air slash", damage: 42, range: 240,
    duration: .34, cooldown: .05, startupSec: .07,
    activeSec: .1, stunSec: .23, pushPx: 35,
    guardDamage: 30,
  },
  special: {
    label: "Moon breaker", damage: 110, range: 355,
    duration: .78, cooldown: .18, startupSec: .22,
    activeSec: .18, stunSec: .35, pushPx: 90,
    guardDamage: 100,
  },
});
const LIGHT_CHAIN = Object.freeze(["light", "light2", "finisher"]);
const COMBAT_DEFAULTS = Object.freeze({
  attackId: 0, attackType: null, hasHitThisSwing: false, guardMeter: 100, specialMeter: 0,
  guarding: false, crouching: false, guardTimer: 0, guardBrokenTimer: 0, stunTimer: 0,
  dashTimer: 0, dashType: null, dashCooldown: 0, dashDir: 1, comboStep: 0, comboWindowTimer: 0,
  comboHits: 0, comboHitTimer: 0, bufferedAttack: null, bufferTimerSec: 0,
});
const COMBAT_STATE_FIELDS = Object.freeze(Object.keys(COMBAT_DEFAULTS));
const EXCHANGE_ACCUMULATED_FIELDS = Object.freeze(["health", "guardMeter", "specialMeter", "x", "vy"]);
const TIMED_COMBAT_FIELDS = Object.freeze(["stunTimer", "guardBrokenTimer", "dashTimer", "dashCooldown", "comboWindowTimer", "comboHitTimer", "bufferTimerSec"]);

/** Create a fresh fighter without connection or transport state. @param {number} x @param {1|-1} dir @returns {FightPlayerState} */
export function createFightPlayerState(x, dir) {
  return {
    ...COMBAT_DEFAULTS, x, y: FIGHT_MOVEMENT.GROUND_Y, vx: 0, vy: 0, dir,
    dashDir: dir, health: FIGHT_COMBAT.MAX_HEALTH, dead: false, attacking: false,
    attackTimer: 0, cooldownTimer: 0,
  };
}

/** Fill new combat fields in retained snapshots/older adapters without overwriting owned values. */
function initializeCombatFields(player) {
  for (const field of COMBAT_STATE_FIELDS) {
    if (player[field] === undefined) player[field] = COMBAT_DEFAULTS[field];
  }
}

const fightActions = createTimedActionController({
  state: { active: "attacking", kind: "attackType", remainingSec: "attackTimer", cooldownSec: "cooldownTimer" },
  definitions: FIGHT_ATTACK_DEFINITIONS,
  bindings: Object.keys(FIGHT_ATTACK_DEFINITIONS).map((actionId) => ({
    inputKey: "attack", actionId, when: (_player, input) => input.requestedAction === actionId,
  })),
  onStart: (player, actionId) => {
    player.hasHitThisSwing = false;
    player.attackId++;
    player.bufferedAttack = null;
    player.bufferTimerSec = 0;
    if (actionId === "special") player.specialMeter = 0;
    const comboIndex = LIGHT_CHAIN.indexOf(actionId);
    player.comboStep = comboIndex >= 0 ? comboIndex + 1 : 0;
    player.comboWindowTimer = comboIndex >= 0 ? FIGHT_COMBAT.COMBO_WINDOW_SEC : 0;
  },
});
const stepFightCharacter = createSideViewCharacterController({
  state: { x: "x", y: "y", vx: "vx", vy: "vy", facing: "dir", disabled: "dead" },
  input: { negative: "left", positive: "right", jump: "jump" },
  movement: {
    speed: FIGHT_MOVEMENT.MOVE_SPEED, busySpeed: FIGHT_MOVEMENT.ATTACK_MOVE_SPEED,
    jumpSpeed: FIGHT_MOVEMENT.JUMP_SPEED, gravity: FIGHT_MOVEMENT.GRAVITY,
    floorY: FIGHT_MOVEMENT.GROUND_Y, minX: FIGHT_MOVEMENT.MIN_X, maxX: FIGHT_MOVEMENT.MAX_X,
    groundTolerance: FIGHT_MOVEMENT.JUMP_GROUND_TOLERANCE,
  },
  actions: fightActions,
});
const separateFightPlayers = createHorizontalSeparationController({
  state: { x: "x", y: "y", vx: "vx" }, minX: FIGHT_MOVEMENT.MIN_X,
  maxX: FIGHT_MOVEMENT.MAX_X, minDistance: FIGHT_MOVEMENT.MIN_HORIZONTAL_SEPARATION,
  verticalLimit: FIGHT_MOVEMENT.VERTICAL_SEPARATION_LIMIT,
});

/** Return authored timing phase; only active frames may cause damage. @param {FightPlayerState} player @returns {"idle"|"startup"|"active"|"recovery"} */
export function getFightAttackPhase(player) {
  const definition = FIGHT_ATTACK_DEFINITIONS[player.attackType];
  if (!player.attacking || !definition) return "idle";
  const elapsed = definition.duration - player.attackTimer;
  if (elapsed < definition.startupSec) return "startup";
  return elapsed < definition.startupSec + definition.activeSec ? "active" : "recovery";
}

/** Choose a game move from explicit, context-sensitive controls. */
function selectFightAttack(player, input) {
  if (input.specialAttack || (input.block && input.aerialAttack)) return "special";
  const airborne = player.y < FIGHT_MOVEMENT.GROUND_Y - FIGHT_MOVEMENT.AERIAL_ATTACK_GROUND_OFFSET;
  if (input.aerialAttack) return airborne ? "aerial" : "launcher";
  if (input.heavyAttack) return airborne ? "aerial" : input.crouch ? "sweep" : "heavy";
  if (input.attack) return airborne ? "aerial" : LIGHT_CHAIN[player.comboWindowTimer > 0 ? player.comboStep % LIGHT_CHAIN.length : 0];
  return null;
}

/**
 * Advance shared movement, defense and action timing. Mutates and returns the player.
 * Damage and meter earnings are resolved separately by the authoritative combat step.
 * @template {FightPlayerState} PlayerState
 * @param {PlayerState} player
 * @param {FightInputState} input
 * @param {number} dtSec
 * @param {{active?: boolean, opponent?: {x: number, y: number}}} [options]
 * @returns {PlayerState}
 */
export function stepFightPlayer(player, input, dtSec, { active = false, opponent } = {}) {
  initializeCombatFields(player);
  if (!active || player.dead) {
    player.guarding = false;
    player.crouching = false;
    player.guardTimer = 0;
    player.dashTimer = 0;
    player.dashType = null;
    player.bufferedAttack = null;
    player.bufferTimerSec = 0;
    player.vx = 0;
    fightActions.reset(player);
    return stepFightCharacter(player, input, dtSec, { active: false });
  }

  for (const field of TIMED_COMBAT_FIELDS) player[field] = Math.max(0, player[field] - dtSec);
  if (!player.dashTimer) player.dashType = null;
  if (!player.comboHitTimer) player.comboHits = 0;
  if (!player.bufferTimerSec) player.bufferedAttack = null;
  const stunned = player.stunTimer > 0;
  const previousX = player.x;
  const wasAttacking = player.attacking;
  const grounded = player.y >= FIGHT_MOVEMENT.GROUND_Y - FIGHT_MOVEMENT.JUMP_GROUND_TOLERANCE;
  if (stunned) {
    fightActions.reset(player);
    player.dashTimer = 0;
    player.dashType = null;
  }

  const wantsSlide = input.crouch && grounded && !input.block;
  const mobilityCost = wantsSlide ? FIGHT_COMBAT.SLIDE_GUARD_COST : FIGHT_COMBAT.DASH_GUARD_COST;
  if (input.dash && !stunned && !player.attacking && player.dashCooldown <= 0 && player.guardMeter >= mobilityCost) {
    if (opponent && opponent.x !== previousX) player.dir = opponent.x > previousX ? 1 : -1;
    player.dashType = wantsSlide ? "slide" : "dodge";
    player.dashDir = input.block ? -player.dir : input.left && !input.right ? -1 : input.right && !input.left ? 1 : player.dir;
    player.dashTimer = wantsSlide ? FIGHT_COMBAT.SLIDE_DURATION_SEC : FIGHT_COMBAT.DASH_DURATION_SEC;
    player.dashCooldown = wantsSlide ? FIGHT_COMBAT.SLIDE_COOLDOWN_SEC : FIGHT_COMBAT.DASH_COOLDOWN_SEC;
    player.guardMeter -= mobilityCost;
  }
  const dashing = player.dashTimer > 0;
  const requestedAttack = stunned || dashing ? null : selectFightAttack(player, input);
  if (requestedAttack && (requestedAttack !== "special" || player.specialMeter >= FIGHT_COMBAT.MAX_SPECIAL)) {
    player.bufferedAttack = requestedAttack;
    player.bufferTimerSec = FIGHT_COMBAT.INPUT_BUFFER_SEC;
  }
  const requestedAction = !stunned && !dashing && player.cooldownTimer <= 0 && !player.attacking
    ? player.bufferedAttack : null;
  const canGuard = input.block && !input.jump && !requestedAction && !player.attacking && !stunned &&
    !dashing && grounded && player.guardBrokenTimer <= 0 && player.guardMeter > 0;
  player.guardTimer = canGuard ? player.guarding ? player.guardTimer + dtSec : dtSec : 0;
  player.guarding = Boolean(canGuard);
  player.crouching = Boolean(input.crouch && grounded && !player.attacking && !requestedAction && !stunned && !dashing && !canGuard);

  const actionDirection = player.dir;
  stepFightCharacter(player, {
    ...input, requestedAction, left: !stunned && input.left, right: !stunned && input.right,
    jump: !stunned && !dashing && !player.guarding && input.jump,
  }, dtSec);
  if (stunned) {
    player.x = previousX;
    player.vx = 0;
  } else if (dashing) {
    player.vx = player.dashDir * (player.dashType === "slide" ? FIGHT_COMBAT.SLIDE_SPEED : FIGHT_COMBAT.DASH_SPEED);
    player.x = previousX + player.vx * dtSec;
  } else if (player.guarding || (input.crouch && grounded && !player.attacking)) {
    const movementScale = player.guarding ? FIGHT_COMBAT.GUARD_MOVE_SCALE : FIGHT_COMBAT.CROUCH_MOVE_SCALE;
    player.x = previousX + (player.x - previousX) * movementScale;
    player.vx *= movementScale;
  }
  player.x = Math.max(FIGHT_MOVEMENT.MIN_X, Math.min(FIGHT_MOVEMENT.MAX_X, player.x));
  if (wasAttacking || dashing) {
    player.dir = actionDirection;
  } else if (opponent) {
    player.dir = opponent.x >= previousX ? 1 : -1;
  }
  if (!player.guarding && !dashing && !player.attacking) {
    player.guardMeter = Math.min(FIGHT_COMBAT.MAX_GUARD, player.guardMeter + FIGHT_COMBAT.GUARD_REGEN_PER_SEC * dtSec);
  }
  return player;
}

/**
 * Resolve one active strike with facing, vertical, dash and guard checks.
 * Mutates both owned combat states; returns a display event or null for a miss.
 * @param {FightPlayerState} attacker
 * @param {FightPlayerState} defender
 * @returns {FightImpact|null}
 */
export function resolveFightStrike(attacker, defender) {
  initializeCombatFields(attacker);
  initializeCombatFields(defender);
  if (attacker.dead || defender.dead || attacker.hasHitThisSwing || getFightAttackPhase(attacker) !== "active") return null;
  const definition = FIGHT_ATTACK_DEFINITIONS[attacker.attackType];
  const distanceX = defender.x - attacker.x;
  const earlyDash = defender.dashType !== "slide" && defender.dashTimer > FIGHT_COMBAT.DASH_DURATION_SEC - FIGHT_COMBAT.DASH_INVULNERABLE_SEC;
  const underHorizontalCut = defender.dashType === "slide" && defender.dashTimer > 0 &&
    (attacker.attackType === "light" || attacker.attackType === "light2");
  if (distanceX * attacker.dir <= 0 || Math.abs(distanceX) >= definition.range ||
      Math.abs(attacker.y - defender.y) > FIGHT_COMBAT.HIT_HEIGHT || earlyDash || underHorizontalCut) return null;

  attacker.hasHitThisSwing = true;
  const attackType = attacker.attackType;
  const frontalGuard = defender.guarding && defender.dir * -distanceX > 0;
  if (frontalGuard && defender.guardTimer <= FIGHT_COMBAT.PARRY_WINDOW_SEC) {
    attacker.stunTimer = FIGHT_COMBAT.PARRY_STUN_SEC;
    fightActions.reset(attacker);
    defender.specialMeter = Math.min(FIGHT_COMBAT.MAX_SPECIAL, defender.specialMeter + 25);
    return { kind: "parry", attackType, damage: 0 };
  }

  let kind = "hit";
  let damage = definition.damage * Math.max(.55, 1 - Math.max(0, attacker.comboHits - 1) * .1);
  if (frontalGuard) {
    defender.guardMeter = Math.max(0, defender.guardMeter - definition.guardDamage);
    kind = defender.guardMeter <= 0 ? "guard-break" : "block";
    damage = kind === "block" ? Math.ceil(damage * .08) : Math.ceil(damage * .75);
    defender.stunTimer = kind === "block" ? .09 : FIGHT_COMBAT.GUARD_BREAK_SEC;
    if (kind === "guard-break") {
      defender.guarding = false;
      defender.guardBrokenTimer = FIGHT_COMBAT.GUARD_BREAK_SEC;
    }
  } else {
    damage = Math.round(damage);
    defender.stunTimer = definition.stunSec;
    defender.guarding = false;
    defender.dashTimer = 0;
    defender.dashType = null;
    fightActions.reset(defender);
    if (attackType === "launcher") defender.vy = -650;
    attacker.comboHits = attacker.comboHitTimer > 0 ? attacker.comboHits + 1 : 1;
    attacker.comboHitTimer = FIGHT_COMBAT.COMBO_HIT_WINDOW_SEC;
  }
  defender.x = Math.max(FIGHT_MOVEMENT.MIN_X, Math.min(FIGHT_MOVEMENT.MAX_X,
    defender.x + attacker.dir * definition.pushPx * (kind === "block" ? .3 : 1)));
  defender.health = Math.max(0, defender.health - damage);
  defender.dead = defender.health === 0;
  attacker.specialMeter = Math.min(FIGHT_COMBAT.MAX_SPECIAL, attacker.specialMeter + (kind === "block" ? 5 : 14));
  defender.specialMeter = Math.min(FIGHT_COMBAT.MAX_SPECIAL, defender.specialMeter + (kind === "block" ? 3 : 8));
  return { kind, attackType, damage };
}

/** Merge independent strike effects so simultaneous hits do not favor a player slot. */
function applyFightExchangeChanges(player, attackerCopy, defenderCopy) {
  for (const field of EXCHANGE_ACCUMULATED_FIELDS) {
    player[field] = attackerCopy[field] + defenderCopy[field] - player[field];
  }
  player.health = Math.max(0, player.health);
  player.guardMeter = Math.max(0, Math.min(FIGHT_COMBAT.MAX_GUARD, player.guardMeter));
  player.specialMeter = Math.max(0, Math.min(FIGHT_COMBAT.MAX_SPECIAL, player.specialMeter));
  player.x = Math.max(FIGHT_MOVEMENT.MIN_X, Math.min(FIGHT_MOVEMENT.MAX_X, player.x));
  player.dead = player.health === 0;
  player.stunTimer = Math.max(attackerCopy.stunTimer, defenderCopy.stunTimer);
  player.guardBrokenTimer = Math.max(attackerCopy.guardBrokenTimer, defenderCopy.guardBrokenTimer);
  player.dashTimer = Math.min(attackerCopy.dashTimer, defenderCopy.dashTimer);
  if (!player.dashTimer) player.dashType = null;
  player.guarding = attackerCopy.guarding && defenderCopy.guarding;
  player.hasHitThisSwing = attackerCopy.hasHitThisSwing;
  player.comboHits = attackerCopy.comboHits;
  player.comboHitTimer = attackerCopy.comboHitTimer;
  if (!attackerCopy.attacking || !defenderCopy.attacking) fightActions.reset(player);
}

/**
 * Resolve both strikes from the same pre-combat state, allowing fair trades.
 * @param {FightPlayerState} p1
 * @param {FightPlayerState} p2
 * @returns {{p1: FightImpact|null, p2: FightImpact|null}}
 */
export function resolveFightExchange(p1, p2) {
  if (getFightAttackPhase(p1) !== "active" && getFightAttackPhase(p2) !== "active") return { p1: null, p2: null };
  initializeCombatFields(p1);
  initializeCombatFields(p2);
  const firstAttack = { ...p1 };
  const firstDefense = { ...p2 };
  const secondAttack = { ...p2 };
  const secondDefense = { ...p1 };
  const impacts = {
    p1: resolveFightStrike(firstAttack, firstDefense),
    p2: resolveFightStrike(secondAttack, secondDefense),
  };
  applyFightExchangeChanges(p1, firstAttack, secondDefense);
  applyFightExchangeChanges(p2, secondAttack, firstDefense);
  return impacts;
}

/** Mutate both players to preserve bounded horizontal contact. @param {FightPlayerState} p1 @param {FightPlayerState} p2 @returns {void} */
export function resolveFightSeparation(p1, p2) {
  separateFightPlayers(p1, p2);
}
