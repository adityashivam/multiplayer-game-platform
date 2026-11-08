/** Pure Riftball contracts shared by the browser and authoritative server. */
export const RIFTBALL_GAME_ID = "riftball";
export const RIFTBALL_PLAYER_IDS = Object.freeze(["p1", "p2"]);
export const RIFTBALL_FIXED_DT_SEC = 1 / 60;
export const RIFTBALL_ROUND_DURATION_SEC = 120;
export const RIFTBALL_SCORE_TO_WIN = 5;

/**
 * @typedef {"p1"|"p2"} RiftballPlayerId
 * @typedef {{moveX:number,moveZ:number,aimX:number,aimZ:number,strike:boolean,dash:boolean,jump:boolean,feint:boolean}} RiftballInputState
 * @typedef {"idle"|"run"|"charge"|"strike"|"jump"|"dash"|"feint"|"hit"|"victory"|"defeat"} RiftballAction
 */
/** @type {Readonly<RiftballInputState>} */
export const RIFTBALL_INPUT_TEMPLATE = Object.freeze({
  moveX: 0, moveZ: 0, aimX: 0, aimZ: 0,
  strike: false, dash: false, jump: false, feint: false,
});
export const RIFTBALL_NUMERIC_INPUTS = Object.freeze({
  moveX: Object.freeze({ min: -1, max: 1 }),
  moveZ: Object.freeze({ min: -1, max: 1 }),
  aimX: Object.freeze({ min: -1, max: 1 }),
  aimZ: Object.freeze({ min: -1, max: 1 }),
});
export const RIFTBALL_EDGE_KEYS = Object.freeze(["strike", "dash", "jump", "feint"]);
export const RIFTBALL_ACTIONS = Object.freeze(["idle", "run", "charge", "strike", "jump", "dash", "feint", "hit", "victory", "defeat"]);
export const RIFTBALL_TEAM_COLORS = Object.freeze(["#27ded1", "#ff896c"]);
export const RIFTBALL_COURT = Object.freeze({
  halfWidth: 10, halfLength: 17, wallHeight: 5,
  goalHalfWidth: 3.2, goalHeight: 3.2, goalDepth: 3,
  playerSpawnZ: 7.5, ballRadius: 0.4,
});
export const RIFTBALL_CHARACTER_SETTINGS = Object.freeze({
  radius: 0.43, height: 1.8, moveSpeed: 7.4,
  acceleration: 48, airAcceleration: 20, braking: 38,
  gravity: 24, jumpSpeed: 8.2, coyoteSec: 0.09, jumpBufferSec: 0.1,
  maxDtSec: 0.05, maxSubsteps: 16,
});
export const RIFTBALL_BALL_SETTINGS = Object.freeze({
  gravity: 18, restitution: 0.78, floorRestitution: 0.62,
  linearDamping: 0.12, groundFriction: 1.6, restSpeed: 0.55,
  maxSpeed: 28, maxDtSec: 0.05, maxSubsteps: 8, maxContacts: 8,
});
export const RIFTBALL_ACTION_SETTINGS = Object.freeze({
  maxChargeSec: 0.85, strikeWindupSec: 0.1, strikeDurationSec: 0.38,
  strikeCooldownSec: 0.28, strikeRange: 1.9, quickStrikeSpeed: 13,
  chargedStrikeSpeed: 24, aerialLiftSpeed: 2.5,
  dashDurationSec: 0.2, dashCooldownSec: 1.1, dashSpeedScale: 1.9,
  dashStaminaCost: 34, feintStaminaCost: 8, feintDurationSec: 0.18,
  staminaRecoveryPerSec: 24, goalPauseSec: 1.6,
});
