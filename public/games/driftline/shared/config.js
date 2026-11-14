/** Pure Driftline contracts shared by the browser and the authoritative server. */
export const DRIFTLINE_GAME_ID = "driftline";
export const DRIFTLINE_PRACTICE_GAME_ID = "driftline-practice";
export const DRIFTLINE_FIXED_DT_SEC = 1 / 60;

/** Online race: two human seats; bots fill the grid to six cars. */
export const DRIFTLINE_RACE_PLAYER_IDS = Object.freeze(["p1", "p2"]);
export const DRIFTLINE_RACE_BOT_IDS = Object.freeze(["bot1", "bot2", "bot3", "bot4"]);
/** Practice: one human seat against five server-owned bots. */
export const DRIFTLINE_PRACTICE_PLAYER_IDS = Object.freeze(["p1"]);
export const DRIFTLINE_PRACTICE_BOT_IDS = Object.freeze(["bot1", "bot2", "bot3", "bot4", "bot5"]);

/**
 * @typedef {{steer:number,throttle:number,brake:number,handbrake:boolean,recover:boolean}} DriftlineInputState
 * Steer is screen-relative: +1 turns right, which decreases yaw. Throttle and
 * brake are analog pedals from zero to one.
 * @typedef {"waiting"|"countdown"|"racing"|"paused"|"finished"} DriftlinePhase
 * @typedef {"none"|"perfect"|"good"|"bogged"} DriftlineLaunch
 */

/** @type {Readonly<DriftlineInputState>} */
export const DRIFTLINE_INPUT_TEMPLATE = Object.freeze({
  steer: 0,
  throttle: 0,
  brake: 0,
  handbrake: false,
  recover: false,
});
export const DRIFTLINE_NUMERIC_INPUTS = Object.freeze({
  steer: Object.freeze({ min: -1, max: 1 }),
  throttle: Object.freeze({ min: 0, max: 1 }),
  brake: Object.freeze({ min: 0, max: 1 }),
});
/** A handbrake flick shorter than one capture must still reach simulation. */
export const DRIFTLINE_EDGE_KEYS = Object.freeze(["handbrake", "recover"]);
export const DRIFTLINE_CAR_COLORS = Object.freeze(["#ff5a36", "#2ec5ff", "#ffd23f", "#9b6bff", "#3ee08f", "#ff4fa3"]);

/**
 * Rear-wheel-drive car on a bicycle tyre model. Units are SI: metres,
 * seconds, kilograms and newtons. The tyre curve peaks near 15 degrees of
 * slip and falls off gently, so a committed slide keeps usable grip.
 */
export const DRIFTLINE_CAR_SETTINGS = Object.freeze({
  massKg: 1200,
  yawInertia: 1750,
  frontAxleM: 1.2,
  rearAxleM: 1.35,
  centerHeightM: 0.48,
  frontGrip: 1.08,
  rearGrip: 1.0,
  tireStiffness: 8,
  tireShape: 1.4,
  handbrakeGrip: 0.28,
  enginePowerW: 165000,
  maxDriveForceN: 7600,
  brakeForceN: 11500,
  reverseForceN: 3500,
  maxReverseSpeed: 9,
  dragCoefficient: 1.55,
  rollingResistance: 0.015,
  runoffResistance: 0.09,
  gravity: 9.81,
  maxSteerRad: 0.58,
  highSpeedSteerRad: 0.26,
  steerFadeSpeed: 42,
  steerRatePerSec: 6.5,
  counterSteerAssist: 0.25,
  stableSlipRad: 0.55,
  driftStability: 18,
  slipDamping: 6,
  maxStabilityAccel: 4,
  driftSteerScale: 0.6,
  lowSpeedSettleMps: 0.6,
  substeps: 4,
  collisionRadiusM: 1.0,
  collisionOffsetM: 1.05,
  wallRestitution: 0.25,
  wallScrub: 0.9,
});

/** Drift, boost, slipstream and launch rules that decide races. */
export const DRIFTLINE_SKILL_SETTINGS = Object.freeze({
  driftMinAngleRad: 0.2,
  driftExitAngleRad: 0.14,
  driftMinSpeed: 10,
  driftExitGraceSec: 0.18,
  spinAngleRad: 1.75,
  spinRecoverSec: 1.2,
  chargePerSec: 1,
  boostTierCharge: Object.freeze([0.9, 2.0, 3.3]),
  boostDurationSec: Object.freeze([0.55, 1.0, 1.5]),
  boostForceN: 5200,
  wallChargeLoss: 1,
  slipstreamRangeM: 22,
  slipstreamWidthM: 3.2,
  slipstreamDragScale: 0.55,
  slipstreamBuildPerSec: 1.6,
  launchPerfectMaxTicks: 30,
  launchGoodMaxTicks: 60,
  launchBoostSec: 0.9,
  launchGoodBoostSec: 0.4,
  launchBogSec: 0.7,
  launchBogPowerScale: 0.35,
});

export const DRIFTLINE_RACE_SETTINGS = Object.freeze({
  laps: 3,
  finishGraceSec: 25,
  maxRaceSec: 360,
  recoverCooldownSec: 1.5,
  gridFirstRowM: 10,
  gridRowSpacingM: 9,
  gridLaneOffsetM: 3,
});

export const DRIFTLINE_BOT_SETTINGS = Object.freeze({
  cornerGripAccel: 7.5,
  steerGain: 1.8,
  apexPull: 260,
  lookaheadBaseM: 13,
  lookaheadPerSpeed: 0.55,
  cornerSpeedScale: 1.0,
  brakeMarginMps: 2,
  driftCurvature: 0.035,
  driftMinSpeed: 22,
  skillSpread: 0.07,
});
