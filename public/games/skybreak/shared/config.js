/** Pure Skybreak contracts shared by the browser and the authoritative server. */
export const SKYBREAK_GAME_ID = "skybreak";
export const SKYBREAK_PRACTICE_GAME_ID = "skybreak-practice";
export const SKYBREAK_TIME_TRIAL_GAME_ID = "skybreak-time-trial";
export const SKYBREAK_FIXED_DT_SEC = 1 / 60;

export const SKYBREAK_DOGFIGHT_PLAYER_IDS = Object.freeze(["p1", "p2"]);
export const SKYBREAK_DOGFIGHT_BOT_IDS = Object.freeze(["bot1", "bot2", "bot3", "bot4"]);
export const SKYBREAK_PRACTICE_PLAYER_IDS = Object.freeze(["p1"]);
export const SKYBREAK_PRACTICE_BOT_IDS = Object.freeze(["bot1", "bot2", "bot3", "bot4", "bot5"]);
export const SKYBREAK_TIME_TRIAL_PLAYER_IDS = Object.freeze(["p1"]);

/**
 * @typedef {"dogfight"|"timeTrial"} SkybreakMode
 * @typedef {"waiting"|"countdown"|"playing"|"paused"|"finished"} SkybreakPhase
 * @typedef {"cannon"|"missile"|"terrain"|"boundary"} SkybreakWeapon
 * @typedef {{pitch:number,roll:number,yaw:number,boost:boolean,brake:boolean,fire:boolean,missile:boolean,flare:boolean,restart:boolean,viewLagTicks:number}} SkybreakInputState
 * Pitch +1 pulls the nose up, roll +1 rolls right, yaw +1 yaws right.
 * viewLagTicks is how far behind the server the pilot's view of rivals is,
 * used to rewind targets for fair hits; the server clamps it.
 */

/** @type {Readonly<SkybreakInputState>} */
export const SKYBREAK_INPUT_TEMPLATE = Object.freeze({
  pitch: 0,
  roll: 0,
  yaw: 0,
  boost: false,
  brake: false,
  fire: false,
  missile: false,
  flare: false,
  restart: false,
  viewLagTicks: 0,
});
export const SKYBREAK_NUMERIC_INPUTS = Object.freeze({
  pitch: Object.freeze({ min: -1, max: 1 }),
  roll: Object.freeze({ min: -1, max: 1 }),
  yaw: Object.freeze({ min: -1, max: 1 }),
  viewLagTicks: Object.freeze({ min: 0, max: 18, integer: true }),
});
export const SKYBREAK_EDGE_KEYS = Object.freeze(["missile", "flare", "restart"]);
export const SKYBREAK_TEAM_COLORS = Object.freeze(["#ff7a3d", "#3ec5ff", "#ffd23f", "#b48cff", "#46e08f", "#ff5c8a"]);

/**
 * Arcade flight: speed seeks a target set by boost and airbrake, turn rates
 * peak at corner speed, and hard pulls cost speed and build G strain.
 */
export const SKYBREAK_FLIGHT_SETTINGS = Object.freeze({
  cruiseSpeed: 150,
  boostSpeed: 235,
  brakeSpeed: 92,
  minSpeed: 70,
  maxSpeed: 290,
  speedResponsePerSec: 0.9,
  gravityAlongPath: 9.81,
  pullDragPerSec: 0.1,
  cornerSpeed: 165,
  cornerWidth: 150,
  minTurnScale: 0.55,
  pitchRateRad: 1.3,
  rollRateRad: 3.0,
  yawRateRad: 0.5,
  inputResponsePerSec: 9,
  boostDrainPerSec: 0.12,
  fuelRegenPerSec: 0.06,
  peakPullG: 8,
  strainThresholdG: 7.5,
  strainGainPerG: 0.11,
  strainRecoveryPerSec: 0.32,
  blackoutSec: 1.4,
  blackoutControlScale: 0.25,
  crashClearanceM: 3,
});

export const SKYBREAK_ARENA = Object.freeze({
  radiusM: 1700,
  ceilingM: 1500,
  boundaryDamagePerSec: 14,
  boundaryGraceSec: 4,
  boundarySteerRad: 0.7,
  seaLevelM: 0,
  spawnRadiusM: 900,
  spawnAltitudeM: 520,
});

export const SKYBREAK_COMBAT_SETTINGS = Object.freeze({
  maxHealth: 100,
  fireIntervalSec: 0.075,
  bulletSpeed: 950,
  bulletLifeSec: 1.3,
  bulletDamage: 7,
  hitRadiusM: 7,
  muzzleForwardM: 8,
  heatPerShot: 0.05,
  heatCoolPerSec: 0.35,
  overheatSec: 1.6,
  maxMissiles: 2,
  missileReloadSec: 9,
  lockConeRad: 0.42,
  lockRangeM: 1300,
  lockTimeSec: 1.1,
  missileSpeed: 340,
  missileTurnRateRad: 1.7,
  missileLifeSec: 7,
  missileDamage: 60,
  missileProximityM: 12,
  maxActiveMissiles: 12,
  maxFlares: 3,
  flareRechargeSec: 12,
  flareDecoyRangeM: 700,
  flareLifeSec: 3,
  respawnSec: 3,
  spawnShieldSec: 2,
  maxViewLagTicks: 18,
  poseHistoryTicks: 32,
});

export const SKYBREAK_MATCH_SETTINGS = Object.freeze({
  killsToWin: 10,
  durationSec: 240,
});

export const SKYBREAK_TIME_TRIAL_SETTINGS = Object.freeze({
  gateRadiusM: 24,
  /**
   * Medal times in seconds. The course autopilot flies a clean 25.0 s:
   * gold roughly matches it, platinum needs tighter lines and boost timing.
   */
  medals: Object.freeze({ platinum: 23.6, gold: 25.5, silver: 28.5, bronze: 33 }),
});

export const SKYBREAK_BOT_SETTINGS = Object.freeze({
  aimToleranceRad: 0.06,
  fireRangeM: 900,
  terrainLookaheadSec: 2.6,
  terrainMarginM: 90,
  steerGain: 2.2,
  skillSpread: 0.25,
  flareReactRangeM: 520,
});
