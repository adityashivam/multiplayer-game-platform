/** Pure Last Fuse contracts shared by the browser and the authoritative server. */
export const LAST_FUSE_GAME_ID = "last-fuse";
export const LAST_FUSE_PRACTICE_GAME_ID = "last-fuse-practice";
export const LAST_FUSE_FIXED_DT_SEC = 1 / 60;

/** Online: two human seats; bots fill the rooftops to six runners. */
export const LAST_FUSE_ONLINE_PLAYER_IDS = Object.freeze(["p1", "p2"]);
export const LAST_FUSE_ONLINE_BOT_IDS = Object.freeze(["bot1", "bot2", "bot3", "bot4"]);
/** Practice: one human seat and five server-owned bots. */
export const LAST_FUSE_PRACTICE_PLAYER_IDS = Object.freeze(["p1"]);
export const LAST_FUSE_PRACTICE_BOT_IDS = Object.freeze(["bot1", "bot2", "bot3", "bot4", "bot5"]);

/**
 * @typedef {"idle"|"run"|"jump"|"dash"|"stagger"|"fall"|"out"|"victory"} LastFuseAction
 * @typedef {"waiting"|"countdown"|"playing"|"roundOver"|"paused"|"finished"} LastFusePhase
 * @typedef {{moveX:number,moveZ:number,jump:boolean,dash:boolean,viewLagTicks:number}} LastFuseInputState
 * World-space movement axes. `viewLagTicks` is how far behind authority this
 * runner sees rivals; the server rewinds them by it before testing a pass.
 */

/** @type {Readonly<LastFuseInputState>} */
export const LAST_FUSE_INPUT_TEMPLATE = Object.freeze({
  moveX: 0,
  moveZ: 0,
  jump: false,
  dash: false,
  viewLagTicks: 0,
});
export const LAST_FUSE_NUMERIC_INPUTS = Object.freeze({
  moveX: Object.freeze({ min: -1, max: 1 }),
  moveZ: Object.freeze({ min: -1, max: 1 }),
  viewLagTicks: Object.freeze({ min: 0, max: 18, integer: true }),
});
/** Short taps must survive between fixed captures. */
export const LAST_FUSE_EDGE_KEYS = Object.freeze(["jump", "dash"]);
export const LAST_FUSE_RUNNER_COLORS = Object.freeze(["#3fd6ff", "#ff5d73", "#ffb547", "#8be36b", "#b48cff", "#f4f1e8"]);

/**
 * Rooftop city. A grid of buildings whose gaps and height steps are always
 * jumpable; the generator rejects layouts that are not connected.
 */
export const LAST_FUSE_CITY = Object.freeze({
  columns: 5,
  rows: 5,
  cellSize: 8.6,
  minRoofSize: 5.6,
  maxRoofSize: 7.2,
  baseRoofHeight: 18,
  heightSteps: Object.freeze([0, 0.6, 1.1]),
  /** Largest gap and rise a runner can reliably clear, used by the generator check. */
  maxJumpGap: 3.1,
  maxJumpRise: 1.2,
  /** Below this height a runner has fallen to the street. */
  fallY: 9,
  /** Collapsed roofs never shrink the city below this many buildings. */
  minStandingRoofs: 4,
  crumbleWarningSec: 1.6,
  layoutAttempts: 40,
});

export const LAST_FUSE_CHARACTER_SETTINGS = Object.freeze({
  radius: 0.4,
  height: 1.75,
  moveSpeed: 7.2,
  acceleration: 46,
  airAcceleration: 14,
  braking: 34,
  gravity: 24,
  jumpSpeed: 9,
  coyoteSec: 0.1,
  jumpBufferSec: 0.1,
  maxDtSec: 0.05,
  maxSubsteps: 12,
});

/**
 * Bomb and movement rules. Every runner is identical; the holder alone gets
 * a small speed edge so a chase can end.
 */
export const LAST_FUSE_BOMB_SETTINGS = Object.freeze({
  firstFuseSec: 18,
  fuseStepSec: 2,
  minFuseSec: 10,
  /** Each pass burns this much fuse, so frantic passing speeds the blast. */
  passBurnSec: 0.4,
  minFuseAfterPassSec: 2.5,
  armDelaySec: 2.2,
  passReach: 0.35,
  /** The previous holder cannot be tagged straight back for this long. */
  tagBackImmunitySec: 1,
  receiverStaggerSec: 0.4,
  staggerSpeedScale: 0.45,
  holderSpeedScale: 1.08,
  dashSpeedScale: 2.2,
  dashDurationSec: 0.2,
  dashCooldownSec: 1.3,
  blastRadius: 4.5,
  blastImpulse: 11,
  blastLift: 6,
  respawnSec: 1.4,
  maxViewLagTicks: 18,
  poseHistoryTicks: 24,
});

export const LAST_FUSE_MATCH_SETTINGS = Object.freeze({
  rounds: 3,
  survivePoints: 1,
  lastStandingPoints: 3,
  roundResetSec: 3,
});

/** Bot tuning: fast enough to chase and flee, slow enough to read. */
export const LAST_FUSE_BOT_SETTINGS = Object.freeze({
  reactionSec: 0.18,
  ledgeLookAheadM: 0.75,
  dashRange: 3.2,
  dashChance: 0.5,
  fleeReplanSec: 0.6,
  chaseReplanSec: 0.3,
});
