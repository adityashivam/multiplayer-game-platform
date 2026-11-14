/** @typedef {import("../shared/runner.js").LastFuseRunner} LastFuseRunner */
/** @typedef {import("../shared/match.js").LastFuseMatch} LastFuseMatch */
/** @typedef {import("../shared/prediction.js").LastFusePredictionState} LastFusePredictionState */
/**
 * Discrete local animation and ability state copied outside numeric smoothing.
 * @typedef {Pick<LastFuseRunner,"id"|"action"|"actionId"|"actionTimeSec"|"dashCooldownSec"|"grounded"|"respawnId"> & {matchId:number,roundNumber:number}} LastFuseLocalPresentation
 * @typedef {LastFuseRunner & {index:number}} LastFusePresentedRunner
 */

const CONTINUOUS_FIELDS = Object.freeze(["x", "y", "z"]);
const LOCAL_PRESENTATION_FIELDS = Object.freeze(["action", "actionId", "actionTimeSec", "dashCooldownSec", "grounded"]);

/**
 * Humans then bots, in slot order. A new owned array of borrowed runners.
 * @param {Readonly<LastFuseMatch>} snapshot
 * @returns {LastFuseRunner[]}
 */
export function listLastFuseSnapshotRunners(snapshot) {
  return [...Object.values(snapshot.players || {}), ...(snapshot.bots || [])];
}

/** @param {Readonly<LastFuseMatch>} snapshot @param {Readonly<LastFuseRunner>} runner */
export function getLastFuseRunnerIdentity(snapshot, runner) {
  return `${snapshot.matchId}:${snapshot.roundNumber}:${runner.respawnId}`;
}

/** @param {Record<string,number>} pose @param {Readonly<LastFuseRunner>} runner */
function writeLastFuseRunnerPose(pose, runner) {
  for (const field of CONTINUOUS_FIELDS) pose[`${runner.id}.${field}`] = runner[field];
  pose[`${runner.id}.facingSin`] = Math.sin(runner.facing);
  pose[`${runner.id}.facingCos`] = Math.cos(runner.facing);
}

/**
 * Map every runner to the SDK's numeric interpolation paths. Facing uses a
 * unit vector so crossing -PI/PI never spins a runner through a full turn.
 * @param {Readonly<LastFuseMatch>} snapshot
 * @returns {Record<string,number>}
 */
export function extractLastFusePositions(snapshot) {
  const pose = { matchId: snapshot.matchId, roundNumber: snapshot.roundNumber, gameTimeSec: snapshot.timeSec };
  for (const runner of listLastFuseSnapshotRunners(snapshot)) writeLastFuseRunnerPose(pose, runner);
  return pose;
}

/**
 * Rounds and respawns teleport runners, so each life is its own identity and
 * never slides across the city.
 * @param {Readonly<LastFuseMatch>} snapshot
 * @returns {Record<string,string>}
 */
export function extractLastFuseContinuityKeys(snapshot) {
  const roundIdentity = `${snapshot.matchId}:${snapshot.roundNumber}`;
  const keys = { matchId: roundIdentity, roundNumber: roundIdentity, gameTimeSec: roundIdentity };
  for (const runner of listLastFuseSnapshotRunners(snapshot)) {
    const identity = getLastFuseRunnerIdentity(snapshot, runner);
    for (const field of [...CONTINUOUS_FIELDS, "facingSin", "facingCos"]) keys[`${runner.id}.${field}`] = identity;
  }
  return keys;
}

/**
 * @param {Readonly<LastFusePredictionState>|null} predictedState Borrowed SDK clone.
 * @returns {LastFuseLocalPresentation|null}
 */
export function createLastFuseLocalPresentation(predictedState) {
  if (!predictedState) return null;
  const presentation = /** @type {LastFuseLocalPresentation} */ ({
    id: predictedState.id,
    matchId: predictedState.predictionMatchId,
    roundNumber: predictedState.predictionRoundNumber,
    respawnId: predictedState.respawnId,
  });
  for (const field of LOCAL_PRESENTATION_FIELDS) presentation[field] = predictedState[field];
  return presentation;
}

/**
 * Combine remote interpolation with the local predicted runner. Nothing
 * borrowed from the SDK is retained.
 * @param {Record<string,number>|null} remotePose
 * @param {{x:number,y:number,z:number,facingSin:number,facingCos:number}|null} localPose
 * @param {Readonly<LastFuseMatch>|null} snapshot
 * @param {string|null} playerId
 * @param {Readonly<LastFusePredictionState>|null} predictedState
 * @returns {Record<string,number>|null}
 */
export function composeLastFuseRenderPose(remotePose, localPose, snapshot, playerId, predictedState) {
  if (!snapshot) return null;
  const sameRound = remotePose?.matchId === snapshot.matchId && remotePose?.roundNumber === snapshot.roundNumber;
  const pose = sameRound ? { ...remotePose } : extractLastFusePositions(snapshot);
  const authority = playerId ? snapshot.players?.[playerId] : null;
  const predictsThisLife = predictedState?.predictionMatchId === snapshot.matchId &&
    predictedState.predictionRoundNumber === snapshot.roundNumber && predictedState.respawnId === authority?.respawnId;
  if (!playerId || !localPose || !predictsThisLife || authority.eliminated || authority.fallen) return pose;
  for (const field of CONTINUOUS_FIELDS) pose[`${playerId}.${field}`] = localPose[field];
  pose[`${playerId}.facingSin`] = localPose.facingSin;
  pose[`${playerId}.facingCos`] = localPose.facingCos;
  return pose;
}

/**
 * Owned presentation values per runner. Discrete action identity comes from
 * one source: prediction for the local runner, authority for everyone else.
 * @param {Readonly<LastFuseMatch>} snapshot
 * @param {Record<string,number>|null} pose
 * @param {LastFuseLocalPresentation|null} [localPresentation]
 * @returns {LastFusePresentedRunner[]}
 */
export function createLastFusePresentedRunners(snapshot, pose, localPresentation = null) {
  const sameRound = pose?.matchId === snapshot.matchId && pose?.roundNumber === snapshot.roundNumber;
  return listLastFuseSnapshotRunners(snapshot).map((runner) => {
    const presented = /** @type {LastFusePresentedRunner} */ ({ ...runner, index: runner.slotIndex });
    if (!sameRound) return presented;
    for (const field of CONTINUOUS_FIELDS) {
      const value = pose[`${runner.id}.${field}`];
      if (Number.isFinite(value)) presented[field] = value;
    }
    const sin = pose[`${runner.id}.facingSin`];
    const cos = pose[`${runner.id}.facingCos`];
    if (Number.isFinite(sin) && Number.isFinite(cos) && Math.hypot(sin, cos) > 0.01) presented.facing = Math.atan2(sin, cos);
    const ownsLocal = localPresentation?.id === runner.id && localPresentation.matchId === snapshot.matchId &&
      localPresentation.roundNumber === snapshot.roundNumber && localPresentation.respawnId === runner.respawnId &&
      !runner.eliminated && !runner.fallen && runner.stunSec <= 0 && runner.staggerSec <= 0;
    if (ownsLocal) {
      for (const field of LOCAL_PRESENTATION_FIELDS) presented[field] = localPresentation[field];
    }
    return presented;
  });
}
