/** Pure Bumper Links contracts shared by the browser and the authoritative server. */
export const BUMPER_LINKS_GAME_ID = "bumper-links";
export const BUMPER_LINKS_PRACTICE_GAME_ID = "bumper-links-practice";
export const BUMPER_LINKS_FIXED_DT_SEC = 1 / 60;

/** Online: two human seats; bots fill the hole to four balls. */
export const BUMPER_LINKS_ONLINE_PLAYER_IDS = Object.freeze(["p1", "p2"]);
export const BUMPER_LINKS_ONLINE_BOT_IDS = Object.freeze(["bot1", "bot2"]);
/** Practice: one human seat and three server-owned bots. */
export const BUMPER_LINKS_PRACTICE_PLAYER_IDS = Object.freeze(["p1"]);
export const BUMPER_LINKS_PRACTICE_BOT_IDS = Object.freeze(["bot1", "bot2", "bot3"]);

/**
 * @typedef {{aimYaw:number,power:number,shoot:boolean}} BumperLinksInputState
 * `aimYaw` is a world heading (0 points along +Z); `power` is the charge in
 * [0,1] at the moment `shoot` is pressed.
 * @typedef {"waiting"|"countdown"|"playing"|"holeOver"|"paused"|"finished"} BumperLinksPhase
 * @typedef {"tee"|"straight"|"corner"|"cup"} BumperLinksTileKind
 * @typedef {"none"|"drop"|"bumpers"|"sweeper"} BumperLinksTileFeature
 */

/** @type {Readonly<BumperLinksInputState>} */
export const BUMPER_LINKS_INPUT_TEMPLATE = Object.freeze({
  aimYaw: 0,
  power: 0,
  shoot: false,
});
export const BUMPER_LINKS_NUMERIC_INPUTS = Object.freeze({
  aimYaw: Object.freeze({ min: -Math.PI, max: Math.PI }),
  power: Object.freeze({ min: 0, max: 1 }),
});
/** A quick release must survive until the next fixed capture. */
export const BUMPER_LINKS_EDGE_KEYS = Object.freeze(["shoot"]);
export const BUMPER_LINKS_BALL_COLORS = Object.freeze(["#ffffff", "#ff5d73", "#ffc23d", "#3fd6ff", "#b48cff", "#8be36b"]);

/**
 * Tile course. Paths only stay level or step down, because the sphere
 * controller collides with axis-aligned boxes and has no slopes.
 */
export const BUMPER_LINKS_COURSE = Object.freeze({
  tileSize: 4,
  minTiles: 4,
  maxTiles: 7,
  floorThickness: 1,
  railHeight: 0.35,
  railThickness: 0.2,
  dropHeight: 0.6,
  maxDrops: 2,
  dropChance: 0.25,
  bumperChance: 0.3,
  sweeperChance: 0.3,
  openRailChance: 0.35,
  postSize: 0.45,
  postHeight: 0.5,
  /** Water sits this far below the lowest green. */
  waterDepth: 1.6,
  walkAttempts: 30,
});

export const BUMPER_LINKS_BALL_SETTINGS = Object.freeze({
  radius: 0.22,
  gravity: 18,
  restitution: 0.62,
  floorRestitution: 0.15,
  linearDamping: 0.2,
  restSpeed: 0.4,
  maxSpeed: 24,
  maxDtSec: 0.05,
  maxSubsteps: 8,
  /** Rolling resistance on a green, in m/s². */
  rollDeceleration: 2.6,
  minShotSpeed: 1.2,
  maxShotSpeed: 11,
  restSpeedThreshold: 0.12,
  ballRestitution: 0.9,
  /** A splash within this long of being struck credits the striker. */
  knockCreditSec: 3,
});

export const BUMPER_LINKS_CUP = Object.freeze({
  radius: 0.38,
  captureSpeed: 4.2,
});

/** A rotating bar centred on its tile. */
export const BUMPER_LINKS_SWEEPER = Object.freeze({
  length: 2.6,
  thickness: 0.3,
  height: 0.4,
  angularSpeed: 1.6,
});

export const BUMPER_LINKS_MATCH_SETTINGS = Object.freeze({
  holes: 6,
  holeTimeSec: 40,
  holeResetSec: 3,
  sinkPoints: Object.freeze([5, 3, 2, 1]),
  knockoutPoints: 1,
  waterPenaltyStrokes: 1,
  maxStrokes: 10,
  recentEventLimit: 8,
});

/** Solver and bot shot search. Bots spread candidates across ticks. */
export const BUMPER_LINKS_SOLVER_SETTINGS = Object.freeze({
  yawSamples: 9,
  yawSpreadRad: (40 * Math.PI) / 180,
  powerSamples: Object.freeze([0.25, 0.45, 0.65, 0.85, 1]),
  maxSimSec: 4,
  simDtSec: 1 / 30,
  maxShots: 6,
  lookAheadM: 5,
  generateAttempts: 30,
});

/** Bots search fewer candidates, one per tick, inside their reaction delay. */
export const BUMPER_LINKS_BOT_SETTINGS = Object.freeze({
  minReactionSec: 1.2,
  maxReactionSec: 2.4,
  candidatesPerTick: 1,
  yawSamples: 7,
  powerSamples: Object.freeze([0.3, 0.55, 0.8, 1]),
  aimNoiseRad: (7 * Math.PI) / 180,
  powerNoise: 0.14,
});
