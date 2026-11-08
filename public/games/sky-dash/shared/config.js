/** Pure game configuration shared by clients, bots and the authoritative server. */
export const SKY_DASH_GAME_ID = "sky-dash";
export const SKY_DASH_FIXED_DT_SEC = 1 / 60;
export const SKY_DASH_PLAYER_IDS = Object.freeze(["p1", "p2"]);
export const SKY_DASH_BOT_COUNT = 3;
export const SKY_DASH_MAX_RUNNERS = 12;
export const SKY_DASH_ROUND_DURATION_SEC = 90;
export const SKY_DASH_FINISH_Z = -134;
export const SKY_DASH_RESPAWN_SEC = 0.65;

/**
 * @typedef {{moveX:number,moveZ:number,jump:boolean,dash:boolean,dive:boolean}} SkyDashInputState
 * @typedef {"idle"|"run"|"jump"|"dash"|"dive"|"hit"|"respawn"|"finish"} SkyDashAction
 */
/** @type {Readonly<SkyDashInputState>} */
export const SKY_DASH_INPUT_TEMPLATE = Object.freeze({ moveX: 0, moveZ: 0, jump: false, dash: false, dive: false });
export const SKY_DASH_NUMERIC_INPUTS = Object.freeze({
  moveX: Object.freeze({ min: -1, max: 1 }),
  moveZ: Object.freeze({ min: -1, max: 1 }),
});
export const SKY_DASH_EDGE_KEYS = Object.freeze(["jump", "dash", "dive"]);
export const SKY_DASH_CHARACTER_SETTINGS = Object.freeze({
  radius: 0.42,
  height: 1.45,
  moveSpeed: 8.6,
  acceleration: 46,
  airAcceleration: 18,
  braking: 35,
  gravity: 23,
  jumpSpeed: 9.2,
  coyoteSec: 0.1,
  jumpBufferSec: 0.12,
  maxDtSec: 0.05,
  maxSubsteps: 16,
});
export const SKY_DASH_ACTION_SETTINGS = Object.freeze({
  dashDurationSec: 0.22,
  dashCooldownSec: 1.6,
  dashSpeedScale: 2.15,
  diveDurationSec: 0.48,
  diveCooldownSec: 1.1,
  diveSpeed: 12.5,
  hitRecoverySec: 0.38,
  hitImmunitySec: 0.7,
  gateReboundSpeed: 3.5,
  gateHitRecoverySec: 0.22,
  gateHopSpeed: 1.5,
  maxHorizontalSpeed: 22,
  fallY: -12,
});
export const SKY_DASH_SEESAW_SETTINGS = Object.freeze({
  platformIds: Object.freeze([3, 4, 5]),
  maxAngleRad: 0.25,
  maxAngularVelocityRadSec: 0.8,
  weightTorque: 9,
  returnSpring: 15,
  damping: 6,
  maxPredictionSec: 0.15,
});
export const SKY_DASH_RUNNER_COLORS = Object.freeze(["#27d9dd", "#ff8275", "#a58cff", "#ffcb62", "#8ed979", "#ef88cf", "#8ebdff", "#f1a657", "#87dfcb", "#cd9be9", "#fa9bb8", "#cadc6f"]);
export const SKY_DASH_BOT_NAMES = Object.freeze(["Wobble", "Biscuit", "Noodle", "Pebble", "Mochi", "Sprout", "Doodle", "Pickle", "Pip", "Jelly"]);
