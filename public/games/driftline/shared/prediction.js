import { getDriftlineTrack } from "./tracks/index.js";
import { createDriftlineCar, getDriftlineStepDuration, stepDriftlineCar } from "./vehicle.js";

/** @typedef {import("./vehicle.js").DriftlineCar} DriftlineCar */
/** @typedef {import("./race.js").DriftlineRace} DriftlineRace */
/** @typedef {import("./config.js").DriftlineInputState} DriftlineInputState */
/**
 * SDK-owned local state: the local car plus the race identity and track it
 * was predicted on. Rivals, contacts, drafting and laps stay authoritative.
 * @typedef {DriftlineCar & {predictionMatchId:number,predictionTrackId:string,predictionRacing:boolean}} DriftlinePredictionState
 */

const CAR_FIELDS = Object.freeze(/** @type {(keyof DriftlineCar)[]} */ (
  Object.keys(createDriftlineCar(getDriftlineTrack("sunset-cliffs"), "p1", 0))
));

/**
 * Copy only declared car fields from authority so input queues, rejoin tokens
 * and snapshot metadata never become prediction-owned gameplay state.
 * @param {Readonly<DriftlineRace>} snapshot
 * @param {string} playerId
 * @returns {DriftlinePredictionState|null}
 */
export function createDriftlinePredictionState(snapshot, playerId) {
  const car = snapshot?.players?.[playerId];
  if (!car || typeof snapshot.trackId !== "string") return null;
  const predictionState = /** @type {DriftlinePredictionState} */ ({});
  for (const field of CAR_FIELDS) predictionState[field] = car[field];
  predictionState.predictionMatchId = snapshot.matchId;
  predictionState.predictionTrackId = snapshot.trackId;
  predictionState.predictionRacing = snapshot.started && !snapshot.gameOver && snapshot.phase === "racing";
  return predictionState;
}

/**
 * Replay local driving, barrier contact and drift timing on the shared track.
 * @param {DriftlinePredictionState} car
 * @param {Readonly<DriftlineInputState>} input
 * @param {number} dtSec
 * @param {{active?:boolean}} [context] Read-only SDK context.
 */
export function stepDriftlinePrediction(car, input, dtSec, context = {}) {
  const active = context.active ?? car.predictionRacing;
  const stepSec = getDriftlineStepDuration(dtSec);
  if (!active || stepSec <= 0) return;
  stepDriftlineCar(car, input, stepSec, { track: getDriftlineTrack(car.predictionTrackId), active: true });
}
