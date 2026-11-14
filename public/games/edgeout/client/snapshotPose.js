/** @typedef {import("../shared/simulation.js").EdgeoutFighter} EdgeoutFighter */
/** @typedef {import("../shared/simulation.js").EdgeoutMatch} EdgeoutMatch */
/** @typedef {import("../shared/prediction.js").EdgeoutPredictionState} EdgeoutPredictionState */
/**
 * Discrete local animation and ability state copied outside numeric smoothing.
 * @typedef {Pick<EdgeoutFighter,"id"|"action"|"actionId"|"actionTimeSec"|"chargeSec"|"shovePower"|"dashCooldownSec"|"shoveCooldownSec"|"blockSec"|"grounded"> & {matchId:number,roundNumber:number}} EdgeoutLocalPresentation
 * @typedef {EdgeoutFighter & {index:number}} EdgeoutPresentedFighter
 */

const CONTINUOUS_FIELDS = Object.freeze(["x", "y", "z"]);
const LOCAL_PRESENTATION_FIELDS = Object.freeze(["action", "actionId", "actionTimeSec", "chargeSec", "shovePower", "dashCooldownSec", "shoveCooldownSec", "blockSec", "grounded"]);

/**
 * Humans then bots, in slot order. A new owned array of borrowed fighters.
 * @param {Readonly<EdgeoutMatch>} snapshot
 * @returns {EdgeoutFighter[]}
 */
export function listEdgeoutSnapshotFighters(snapshot) {
  return [...Object.values(snapshot.players || {}), ...(snapshot.bots || [])];
}

/** @param {Readonly<EdgeoutMatch>} snapshot @returns {string} */
function getEdgeoutRoundIdentity(snapshot) {
  return `${snapshot.matchId}:${snapshot.roundNumber}`;
}

/** @param {Record<string,number>} pose @param {Readonly<EdgeoutFighter>} fighter */
function writeEdgeoutFighterPose(pose, fighter) {
  for (const field of CONTINUOUS_FIELDS) pose[`${fighter.id}.${field}`] = fighter[field];
  pose[`${fighter.id}.facingSin`] = Math.sin(fighter.facing);
  pose[`${fighter.id}.facingCos`] = Math.cos(fighter.facing);
}

/**
 * Map every fighter to the SDK's numeric interpolation paths. Facing uses a
 * unit vector so crossing -PI/PI never spins a fighter through a full turn.
 * @param {Readonly<EdgeoutMatch>} snapshot
 * @returns {Record<string,number>}
 */
export function extractEdgeoutPositions(snapshot) {
  const pose = { matchId: snapshot.matchId, roundNumber: snapshot.roundNumber, gameTimeSec: snapshot.timeSec };
  for (const fighter of listEdgeoutSnapshotFighters(snapshot)) writeEdgeoutFighterPose(pose, fighter);
  return pose;
}

/**
 * New rounds respawn every fighter, so positions snap instead of sliding
 * across the arena from where the last round ended.
 * @param {Readonly<EdgeoutMatch>} snapshot
 * @returns {Record<string,string>}
 */
export function extractEdgeoutContinuityKeys(snapshot) {
  const identity = getEdgeoutRoundIdentity(snapshot);
  return Object.fromEntries(Object.keys(extractEdgeoutPositions(snapshot)).map((path) => [path, identity]));
}

/**
 * @param {Readonly<EdgeoutPredictionState>|null} predictedState Borrowed SDK clone.
 * @returns {EdgeoutLocalPresentation|null}
 */
export function createEdgeoutLocalPresentation(predictedState) {
  if (!predictedState) return null;
  const presentation = /** @type {EdgeoutLocalPresentation} */ ({
    id: predictedState.id,
    matchId: predictedState.predictionMatchId,
    roundNumber: predictedState.predictionRoundNumber,
  });
  for (const field of LOCAL_PRESENTATION_FIELDS) presentation[field] = predictedState[field];
  return presentation;
}

/**
 * Combine remote interpolation with the local predicted fighter. Nothing
 * borrowed from the SDK is retained.
 * @param {Record<string,number>|null} remotePose
 * @param {{x:number,y:number,z:number,facingSin:number,facingCos:number}|null} localPose
 * @param {Readonly<EdgeoutMatch>|null} snapshot
 * @param {string|null} playerId
 * @param {Readonly<EdgeoutPredictionState>|null} predictedState
 * @returns {Record<string,number>|null}
 */
export function composeEdgeoutRenderPose(remotePose, localPose, snapshot, playerId, predictedState) {
  if (!snapshot) return null;
  const sameRound = remotePose?.matchId === snapshot.matchId && remotePose?.roundNumber === snapshot.roundNumber;
  const pose = sameRound ? { ...remotePose } : extractEdgeoutPositions(snapshot);
  const predictsThisRound = predictedState?.predictionMatchId === snapshot.matchId &&
    predictedState.predictionRoundNumber === snapshot.roundNumber;
  if (!playerId || !localPose || !predictsThisRound || predictedState.eliminated) return pose;
  for (const field of CONTINUOUS_FIELDS) pose[`${playerId}.${field}`] = localPose[field];
  pose[`${playerId}.facingSin`] = localPose.facingSin;
  pose[`${playerId}.facingCos`] = localPose.facingCos;
  return pose;
}

/**
 * Owned presentation values per fighter. Discrete action identity and its
 * clock always come from one source: prediction for the local fighter,
 * authority for everyone else.
 * @param {Readonly<EdgeoutMatch>} snapshot
 * @param {Record<string,number>|null} pose
 * @param {EdgeoutLocalPresentation|null} [localPresentation]
 * @returns {EdgeoutPresentedFighter[]}
 */
export function createEdgeoutPresentedFighters(snapshot, pose, localPresentation = null) {
  const sameRound = pose?.matchId === snapshot.matchId && pose?.roundNumber === snapshot.roundNumber;
  return listEdgeoutSnapshotFighters(snapshot).map((fighter) => {
    const presented = /** @type {EdgeoutPresentedFighter} */ ({ ...fighter, index: fighter.slotIndex });
    if (!sameRound) return presented;
    for (const field of CONTINUOUS_FIELDS) {
      const value = pose[`${fighter.id}.${field}`];
      if (Number.isFinite(value)) presented[field] = value;
    }
    const sin = pose[`${fighter.id}.facingSin`];
    const cos = pose[`${fighter.id}.facingCos`];
    if (Number.isFinite(sin) && Number.isFinite(cos) && Math.hypot(sin, cos) > 0.01) presented.facing = Math.atan2(sin, cos);
    const ownsLocal = localPresentation?.id === fighter.id && localPresentation.matchId === snapshot.matchId &&
      localPresentation.roundNumber === snapshot.roundNumber && !fighter.eliminated && fighter.action !== "stunned";
    if (ownsLocal) {
      for (const field of LOCAL_PRESENTATION_FIELDS) presented[field] = localPresentation[field];
    }
    return presented;
  });
}
