import { getLastFusePlatforms } from "./city.js";
import { createLastFuseRunner, getLastFuseStepDuration, stepLastFuseRunner } from "./runner.js";

/** @typedef {import("./runner.js").LastFuseRunner} LastFuseRunner */
/** @typedef {import("./match.js").LastFuseMatch} LastFuseMatch */
/** @typedef {import("./config.js").LastFuseInputState} LastFuseInputState */
/**
 * SDK-owned local state: the local runner plus the round, roofs and bomb
 * ownership it was predicted against. Passes, blasts and falls stay
 * authoritative.
 * @typedef {LastFuseRunner & {
 *   predictionMatchId:number,predictionRoundNumber:number,predictionCitySeed:number,
 *   predictionCollapsedMask:number,predictionHolder:boolean,predictionPlaying:boolean
 * }} LastFusePredictionState
 */

/** Server-only runner fields that prediction never copies. */
export const LAST_FUSE_PRIVATE_RUNNER_FIELDS = Object.freeze(["viewLagTicks"]);
const RUNNER_FIELDS = Object.freeze(/** @type {(keyof LastFuseRunner)[]} */ (
  Object.keys(createLastFuseRunner("p1", 0)).filter((field) => !LAST_FUSE_PRIVATE_RUNNER_FIELDS.includes(field))
));

/**
 * Copy only declared runner fields from authority.
 * @param {Readonly<LastFuseMatch>} snapshot
 * @param {string} playerId
 * @returns {LastFusePredictionState|null}
 */
export function createLastFusePredictionState(snapshot, playerId) {
  const runner = snapshot?.players?.[playerId];
  if (!runner || !snapshot.city) return null;
  const predictionState = /** @type {LastFusePredictionState} */ ({});
  for (const field of RUNNER_FIELDS) predictionState[field] = runner[field];
  predictionState.viewLagTicks = 0;
  predictionState.predictionMatchId = snapshot.matchId;
  predictionState.predictionRoundNumber = snapshot.roundNumber;
  predictionState.predictionCitySeed = snapshot.city.seed;
  predictionState.predictionCollapsedMask = snapshot.city.collapsedMask;
  predictionState.predictionHolder = snapshot.bomb?.holderId === playerId;
  predictionState.predictionPlaying = snapshot.started && !snapshot.gameOver && snapshot.phase === "playing";
  return predictionState;
}

/**
 * Replay local running against the authoritative roofs. Blast knockback and
 * falls arrive through reconciliation, not prediction.
 * @param {LastFusePredictionState} runner
 * @param {Readonly<LastFuseInputState>} input
 * @param {number} dtSec
 * @param {{active?:boolean}} [context] Read-only SDK context.
 */
export function stepLastFusePrediction(runner, input, dtSec, context = {}) {
  const active = context.active ?? runner.predictionPlaying;
  const stepSec = getLastFuseStepDuration(dtSec);
  if (!active || stepSec <= 0) return;
  stepLastFuseRunner(runner, input, stepSec, {
    active: true,
    platforms: getLastFusePlatforms(runner.predictionCitySeed, runner.predictionCollapsedMask),
    holder: runner.predictionHolder,
  });
}
