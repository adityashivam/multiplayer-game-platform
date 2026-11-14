/** Pure Edgeout contracts shared by the browser and the authoritative server. */
export const EDGEOUT_GAME_ID = "edgeout";
export const EDGEOUT_PRACTICE_GAME_ID = "edgeout-practice";
export const EDGEOUT_FIXED_DT_SEC = 1 / 60;

/** Human seats for the competitive duel; the room starts when both connect. */
export const EDGEOUT_DUEL_PLAYER_IDS = Object.freeze(["p1", "p2"]);
/** Practice keeps one human seat and fills the arena with server-owned bots. */
export const EDGEOUT_PRACTICE_PLAYER_IDS = Object.freeze(["p1"]);
export const EDGEOUT_PRACTICE_BOT_IDS = Object.freeze(["cpu"]);

/**
 * @typedef {"idle"|"run"|"charge"|"shove"|"dash"|"block"|"stunned"|"falling"|"victory"|"defeat"} EdgeoutAction
 * @typedef {"none"|"shove"|"charged"|"dash"|"blocked"|"guardBreak"|"parried"} EdgeoutHitKind
 * @typedef {"waiting"|"countdown"|"playing"|"roundOver"|"paused"|"finished"} EdgeoutPhase
 * @typedef {{moveX:number,moveZ:number,aimX:number,aimZ:number,shove:boolean,dash:boolean,block:boolean}} EdgeoutInputState
 * World-space movement/aim axes. Shove is held to charge and fires on release.
 */

/** @type {Readonly<EdgeoutInputState>} */
export const EDGEOUT_INPUT_TEMPLATE = Object.freeze({
  moveX: 0,
  moveZ: 0,
  aimX: 0,
  aimZ: 0,
  shove: false,
  dash: false,
  block: false,
});
export const EDGEOUT_NUMERIC_INPUTS = Object.freeze({
  moveX: Object.freeze({ min: -1, max: 1 }),
  moveZ: Object.freeze({ min: -1, max: 1 }),
  aimX: Object.freeze({ min: -1, max: 1 }),
  aimZ: Object.freeze({ min: -1, max: 1 }),
});
/** Short presses must survive between fixed captures; block is a plain hold. */
export const EDGEOUT_EDGE_KEYS = Object.freeze(["shove", "dash"]);
export const EDGEOUT_ACTIONS = Object.freeze(["idle", "run", "charge", "shove", "dash", "block", "stunned", "falling", "victory", "defeat"]);
export const EDGEOUT_FIGHTER_COLORS = Object.freeze(["#2ee6c8", "#ff6f91", "#ffc24b", "#9d8cff"]);

/**
 * Square tile arena. `rings` counts the centre tile as ring zero, so four rings
 * make a 7 x 7 grid. Rings collapse from the outside on a fixed round schedule.
 */
export const EDGEOUT_ARENA = Object.freeze({
  tileSize: 2,
  rings: 4,
  tileThickness: 1.2,
  firstCollapseSec: 14,
  collapseIntervalSec: 9,
  warningSec: 2.4,
  spawnRadius: 2.6,
  eliminationY: -4,
  lowestFallY: -40,
});

export const EDGEOUT_CHARACTER_SETTINGS = Object.freeze({
  radius: 0.45,
  height: 1.6,
  moveSpeed: 6.2,
  acceleration: 42,
  airAcceleration: 5,
  braking: 36,
  gravity: 26,
  jumpSpeed: 8,
  coyoteSec: 0.06,
  jumpBufferSec: 0,
  maxDtSec: 0.05,
  maxSubsteps: 12,
});

/**
 * Knockback speeds are world units per second before damage scaling. Every
 * point of damage adds one percent knockback, so late hits travel further.
 */
export const EDGEOUT_COMBAT_SETTINGS = Object.freeze({
  shoveWindupSec: 0.07,
  shoveActiveSec: 0.11,
  shoveDurationSec: 0.36,
  shoveCooldownSec: 0.45,
  shoveRange: 1.65,
  shoveArcCos: 0.4,
  maxChargeSec: 0.7,
  chargeMoveScale: 0.55,
  shoveMoveScale: 0.3,
  quickShoveKnockback: 6.5,
  chargedShoveKnockback: 13,
  quickShoveDamage: 8,
  chargedShoveDamage: 18,
  blockMoveScale: 0.35,
  blockKnockbackScale: 0.25,
  blockChipDamage: 2,
  blockArcCos: 0.2,
  parryWindowSec: 0.18,
  parryStunSec: 0.55,
  parryRecoilSpeed: 6,
  dashDurationSec: 0.18,
  dashCooldownSec: 1.1,
  dashSpeedScale: 2.3,
  dashHitReach: 0.3,
  dashHitKnockback: 8.5,
  dashHitDamage: 6,
  guardBreakStunSec: 0.5,
  guardBreakKnockback: 4,
  damageKnockbackScale: 0.01,
  maxDamage: 200,
  hitStunBaseSec: 0.14,
  hitStunPerSpeedSec: 0.022,
  maxHitStunSec: 0.7,
  stunFrictionPerSec: 4.2,
});

export const EDGEOUT_MATCH_SETTINGS = Object.freeze({
  roundsToWin: 3,
  roundResetSec: 2.4,
});

/** Practice bot tuning: a beatable sparring partner, not a frame-perfect one. */
export const EDGEOUT_BOT_SETTINGS = Object.freeze({
  reactionSec: 0.2,
  blockChance: 0.45,
  chargeChance: 0.35,
  dashChance: 0.25,
  edgeMargin: 1.3,
  minChargeSec: 0.25,
  maxChargeSec: 0.6,
  dashMinRange: 2.6,
  dashMaxRange: 4.8,
  threatRange: 2.6,
});
