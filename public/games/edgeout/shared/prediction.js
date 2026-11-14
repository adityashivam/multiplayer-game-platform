import { createEdgeoutFighter, getEdgeoutStepDuration, stepEdgeoutFighter } from "./simulation.js";

/** @typedef {import("./simulation.js").EdgeoutFighter} EdgeoutFighter */
/** @typedef {import("./simulation.js").EdgeoutMatch} EdgeoutMatch */
/** @typedef {import("./config.js").EdgeoutInputState} EdgeoutInputState */
/**
 * SDK-owned local state: the local fighter plus the round identity and floor
 * it was predicted against. Rivals, hits and eliminations stay authoritative.
 * @typedef {EdgeoutFighter & {
 *   predictionMatchId:number,predictionRoundNumber:number,
 *   predictionIntactRings:number,predictionPlaying:boolean
 * }} EdgeoutPredictionState
 */

const FIGHTER_FIELDS = Object.freeze(/** @type {(keyof EdgeoutFighter)[]} */ (Object.keys(createEdgeoutFighter("p1", 0, 2))));

/**
 * Copy only declared fighter fields from authority so input queues, rejoin
 * tokens and snapshot metadata never become prediction-owned gameplay state.
 * @param {Readonly<EdgeoutMatch>} snapshot
 * @param {string} playerId
 * @returns {EdgeoutPredictionState|null}
 */
export function createEdgeoutPredictionState(snapshot, playerId) {
  const fighter = snapshot?.players?.[playerId];
  if (!fighter || !snapshot.arena) return null;
  const predictionState = /** @type {EdgeoutPredictionState} */ ({});
  for (const field of FIGHTER_FIELDS) predictionState[field] = fighter[field];
  predictionState.predictionMatchId = snapshot.matchId;
  predictionState.predictionRoundNumber = snapshot.roundNumber;
  predictionState.predictionIntactRings = snapshot.arena.intactRings;
  predictionState.predictionPlaying = snapshot.phase === "playing";
  return predictionState;
}

/**
 * Replay local movement and action timing against the authoritative floor.
 * Knockback from rivals arrives through reconciliation, not prediction.
 * @param {EdgeoutPredictionState} fighter
 * @param {Readonly<EdgeoutInputState>} input
 * @param {number} dtSec
 * @param {{active?:boolean}} [context] Read-only SDK context.
 */
export function stepEdgeoutPrediction(fighter, input, dtSec, context = {}) {
  const active = context.active ?? fighter.predictionPlaying;
  const stepSec = getEdgeoutStepDuration(dtSec);
  if (!active || stepSec <= 0) return;
  stepEdgeoutFighter(fighter, input, stepSec, { active: true, intactRings: fighter.predictionIntactRings });
}
