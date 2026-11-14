/** @typedef {import("../shared/flight.js").SkybreakJet} SkybreakJet */
/** @typedef {import("../shared/match.js").SkybreakMatch} SkybreakMatch */
/** @typedef {import("../shared/prediction.js").SkybreakPredictionState} SkybreakPredictionState */
/**
 * @typedef {Pick<SkybreakJet,"id"|"pitchInput"|"rollInput"|"yawInput"|"speed"|"boosting"|"braking"|"fuel"|"gForce"|"strain"|"blackoutSec"|"respawnId"> & {matchId:number}} SkybreakLocalPresentation
 * @typedef {SkybreakJet & {index:number}} SkybreakPresentedJet
 */

const POSE_FIELDS = Object.freeze(["x", "y", "z", "forwardX", "forwardY", "forwardZ", "upX", "upY", "upZ"]);
const LOCAL_FIELDS = Object.freeze(["pitchInput", "rollInput", "yawInput", "speed", "boosting", "braking", "fuel", "gForce", "strain", "blackoutSec"]);

/** Humans then bots. A new owned array of borrowed jets. @param {Readonly<SkybreakMatch>} snapshot */
export function listSkybreakSnapshotJets(snapshot) {
  return [...Object.values(snapshot.players || {}), ...(snapshot.bots || [])];
}

/**
 * Interpolation paths for every jet: position plus forward and up vectors,
 * which interpolate smoothly where angles would wrap.
 * @param {Readonly<SkybreakMatch>} snapshot
 * @returns {Record<string,number>}
 */
export function extractSkybreakPositions(snapshot) {
  const pose = { matchId: snapshot.matchId, gameTimeSec: snapshot.matchTimeSec };
  for (const jet of listSkybreakSnapshotJets(snapshot)) {
    for (const field of POSE_FIELDS) pose[`${jet.id}.${field}`] = jet[field];
  }
  return pose;
}

/**
 * Respawns and restarts teleport, so each life is its own interpolation
 * identity.
 * @param {Readonly<SkybreakMatch>} snapshot
 */
export function extractSkybreakContinuityKeys(snapshot) {
  const keys = { matchId: String(snapshot.matchId), gameTimeSec: String(snapshot.matchId) };
  for (const jet of listSkybreakSnapshotJets(snapshot)) {
    const identity = `${snapshot.matchId}:${jet.respawnId}`;
    for (const field of POSE_FIELDS) keys[`${jet.id}.${field}`] = identity;
  }
  return keys;
}

/** @param {Readonly<SkybreakPredictionState>|null} predictedState @returns {SkybreakLocalPresentation|null} */
export function createSkybreakLocalPresentation(predictedState) {
  if (!predictedState) return null;
  const presentation = /** @type {SkybreakLocalPresentation} */ ({ id: predictedState.id, matchId: predictedState.predictionMatchId, respawnId: predictedState.respawnId });
  for (const field of LOCAL_FIELDS) presentation[field] = predictedState[field];
  return presentation;
}

/**
 * Combine remote interpolation with the predicted local jet.
 * @param {Record<string,number>|null} remotePose
 * @param {Record<string,number>|null} localPose
 * @param {Readonly<SkybreakMatch>|null} snapshot
 * @param {string|null} playerId
 * @param {Readonly<SkybreakPredictionState>|null} predictedState
 */
export function composeSkybreakRenderPose(remotePose, localPose, snapshot, playerId, predictedState) {
  if (!snapshot) return null;
  const pose = remotePose?.matchId === snapshot.matchId ? { ...remotePose } : extractSkybreakPositions(snapshot);
  if (!playerId || !localPose || predictedState?.predictionMatchId !== snapshot.matchId) return pose;
  for (const field of POSE_FIELDS) pose[`${playerId}.${field}`] = localPose[field];
  return pose;
}

/** @param {SkybreakPresentedJet} jet Renormalize interpolated orientation in place. */
function normalizeSkybreakOrientation(jet) {
  const forwardLength = Math.hypot(jet.forwardX, jet.forwardY, jet.forwardZ) || 1;
  jet.forwardX /= forwardLength;
  jet.forwardY /= forwardLength;
  jet.forwardZ /= forwardLength;
  const along = jet.upX * jet.forwardX + jet.upY * jet.forwardY + jet.upZ * jet.forwardZ;
  jet.upX -= jet.forwardX * along;
  jet.upY -= jet.forwardY * along;
  jet.upZ -= jet.forwardZ * along;
  const upLength = Math.hypot(jet.upX, jet.upY, jet.upZ) || 1;
  jet.upX /= upLength;
  jet.upY /= upLength;
  jet.upZ /= upLength;
}

/**
 * Owned presentation values per jet. The local jet's controls, speed and
 * G come from prediction so the cockpit reacts instantly.
 * @param {Readonly<SkybreakMatch>} snapshot
 * @param {Record<string,number>|null} pose
 * @param {SkybreakLocalPresentation|null} [localPresentation]
 * @returns {SkybreakPresentedJet[]}
 */
export function createSkybreakPresentedJets(snapshot, pose, localPresentation = null) {
  const sameMatch = pose?.matchId === snapshot.matchId;
  return listSkybreakSnapshotJets(snapshot).map((jet) => {
    const presented = /** @type {SkybreakPresentedJet} */ ({ ...jet, index: jet.slotIndex });
    if (sameMatch) {
      for (const field of POSE_FIELDS) {
        const value = pose[`${jet.id}.${field}`];
        if (Number.isFinite(value)) presented[field] = value;
      }
      normalizeSkybreakOrientation(presented);
    }
    if (localPresentation?.id === jet.id && localPresentation.matchId === snapshot.matchId && localPresentation.respawnId === jet.respawnId) {
      for (const field of LOCAL_FIELDS) presented[field] = localPresentation[field];
    }
    return presented;
  });
}
