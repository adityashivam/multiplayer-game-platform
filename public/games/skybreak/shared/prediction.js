import { createSkybreakJet, getSkybreakStepDuration, stepSkybreakFlight } from "./flight.js";

/** @typedef {import("./flight.js").SkybreakJet} SkybreakJet */
/** @typedef {import("./match.js").SkybreakMatch} SkybreakMatch */
/** @typedef {import("./config.js").SkybreakInputState} SkybreakInputState */
/**
 * SDK-owned local state: the pilot's jet plus the match it belongs to.
 * Weapons, hits, deaths, gates and restarts stay authoritative.
 * @typedef {SkybreakJet & {predictionMatchId:number,predictionBoundary:boolean,predictionActive:boolean}} SkybreakPredictionState
 */

/** Snapshot fields the server keeps private; prediction must not need them. */
export const SKYBREAK_PRIVATE_JET_FIELDS = Object.freeze(["previousX", "previousY", "previousZ", "missileHeld", "flareHeld", "restartHeld", "lastAttackTimeSec"]);
const JET_FIELDS = Object.freeze(/** @type {(keyof SkybreakJet)[]} */ (
  Object.keys(createSkybreakJet("p1", 0)).filter((field) => !SKYBREAK_PRIVATE_JET_FIELDS.includes(field))
));

/**
 * Copy only declared, public jet fields from authority.
 * @param {Readonly<SkybreakMatch>} snapshot
 * @param {string} playerId
 * @returns {SkybreakPredictionState|null}
 */
export function createSkybreakPredictionState(snapshot, playerId) {
  const jet = snapshot?.players?.[playerId];
  if (!jet) return null;
  const predictionState = /** @type {SkybreakPredictionState} */ ({});
  for (const field of JET_FIELDS) predictionState[field] = jet[field];
  predictionState.previousX = jet.x;
  predictionState.previousY = jet.y;
  predictionState.previousZ = jet.z;
  predictionState.predictionMatchId = snapshot.matchId;
  predictionState.predictionBoundary = snapshot.mode === "dogfight";
  predictionState.predictionActive = snapshot.started && !snapshot.gameOver && snapshot.phase === "playing";
  return predictionState;
}

/**
 * Replay local flight. A predicted crash freezes the jet until authority
 * reports the death or restart, so it never flies through the ground.
 * @param {SkybreakPredictionState} jet
 * @param {Readonly<SkybreakInputState>} input
 * @param {number} dtSec
 * @param {{active?:boolean}} [context]
 */
export function stepSkybreakPrediction(jet, input, dtSec, context = {}) {
  const active = context.active ?? jet.predictionActive;
  const stepSec = getSkybreakStepDuration(dtSec);
  if (!active || stepSec <= 0 || jet.crashed) return;
  stepSkybreakFlight(jet, input, stepSec, { active: true, boundary: jet.predictionBoundary });
}
