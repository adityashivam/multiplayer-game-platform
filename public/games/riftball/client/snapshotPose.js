/** @typedef {import("../shared/simulation.js").RiftballPlayer} RiftballPlayer */
/** @typedef {Pick<RiftballPlayer,"id"|"action"|"actionId"|"actionTimeSec"|"chargeSec"|"strikePower"|"stamina"|"dashCooldownSec"|"grounded"> & {roundId:number,serveId:number}} RiftballLocalPresentation */
const PLAYER_CONTINUOUS_FIELDS = Object.freeze(["x", "y", "z", "vx", "vy", "vz"]);
const BALL_COORDINATES = Object.freeze(["x", "y", "z"]);
const LOCAL_PRESENTATION_FIELDS = Object.freeze(["action", "actionId", "actionTimeSec", "chargeSec", "strikePower", "stamina", "dashCooldownSec", "grounded"]);

/**
 * Copy discrete local animation/ability state outside numeric pose smoothing.
 * @param {import("../shared/prediction.js").RiftballPredictionState|null} predictedState
 * @returns {RiftballLocalPresentation|null}
 */
export function createRiftballLocalPresentation(predictedState) {
  if (!predictedState) return null;
  return {
    id: predictedState.id, roundId: predictedState.predictionRoundId, serveId: predictedState.previewBall.serveId,
    action: predictedState.action, actionId: predictedState.actionId, actionTimeSec: predictedState.actionTimeSec,
    chargeSec: predictedState.chargeSec, strikePower: predictedState.strikePower,
    stamina: predictedState.stamina, dashCooldownSec: predictedState.dashCooldownSec, grounded: predictedState.grounded,
  };
}

/**
 * Map game state to the SDK's numeric interpolation paths. Facing uses a unit
 * vector so crossing -PI/PI cannot spin an athlete through a full turn.
 * @param {import("../shared/simulation.js").RiftballRound} snapshot
 * @returns {Record<string,number>}
 */
export function extractRiftballPositions(snapshot) {
  const pose = { roundId: snapshot.roundId, gameTimeSec: snapshot.timeSec };
  for (const player of Object.values(snapshot.players)) {
    writePlayerPose(pose, player);
    pose[`${player.id}.serveId`] = snapshot.ball.serveId;
  }
  for (const coordinate of BALL_COORDINATES) pose[`ball.${coordinate}`] = snapshot.ball[coordinate];
  pose["ball.serveId"] = snapshot.ball.serveId;
  return pose;
}

/** @param {import("../shared/simulation.js").RiftballRound} snapshot @returns {Record<string,string>} */
export function extractRiftballContinuityKeys(snapshot) {
  const identity = `${snapshot.roundId}:${snapshot.ball.serveId}`;
  return Object.fromEntries(Object.keys(extractRiftballPositions(snapshot)).map((path) => [path, identity]));
}

/**
 * Combine continuous remote and local poses without retaining mutable SDK state.
 * Action identity/clock copies remain outside this numeric interpolation path.
 * @param {Record<string,number>|null} remotePose
 * @param {Record<string,number>|null} localPose
 * @param {import("../shared/simulation.js").RiftballRound|null} snapshot
 * @param {string|null} playerId
 * @param {Readonly<import("../shared/prediction.js").RiftballPredictionState>|null} predictedState Borrowed simulation clone.
 */
export function composeRiftballRenderPose(remotePose, localPose, snapshot, playerId, predictedState) {
  if (!snapshot) return null;
  const pose = remotePose?.roundId === snapshot.roundId ? { ...remotePose } : extractRiftballPositions(snapshot);
  if (!playerId || !localPose || !predictedState || predictedState.predictionRoundId !== snapshot.roundId) return pose;
  writePlayerPose(pose, predictedState);
  pose[`${playerId}.serveId`] = predictedState.previewBall.serveId;
  for (const coordinate of BALL_COORDINATES) pose[`${playerId}.${coordinate}`] = localPose[coordinate];
  pose[`${playerId}.facingSin`] = localPose.facingSin;
  pose[`${playerId}.facingCos`] = localPose.facingCos;
  pose.gameTimeSec = predictedState.predictionTimeSec;
  if (predictedState.previewBall?.serveId === snapshot.ball.serveId && ["playing", "overtime"].includes(snapshot.phase)) {
    pose["ball.x"] = localPose.ballX;
    pose["ball.y"] = localPose.ballY;
    pose["ball.z"] = localPose.ballZ;
    pose["ball.serveId"] = predictedState.previewBall.serveId;
  }
  return pose;
}

/**
 * Create owned athlete values. Action identity and elapsed time always come
 * from the same discrete state. Round/serve resets use authority immediately.
 * @param {import("../shared/simulation.js").RiftballRound} snapshot
 * @param {Record<string,number>|null} pose
 * @param {RiftballLocalPresentation|null} [localPresentation]
 */
export function createRiftballPresentedPlayers(snapshot, pose, localPresentation = null) {
  return Object.values(snapshot.players).map((player) => {
    const presented = { ...player, index: player.slotIndex };
    if (!pose || pose.roundId !== snapshot.roundId || pose[`${player.id}.serveId`] !== snapshot.ball.serveId) return presented;
    for (const field of PLAYER_CONTINUOUS_FIELDS) {
      const value = pose[`${player.id}.${field}`];
      if (Number.isFinite(value)) presented[field] = value;
    }
    const sin = pose[`${player.id}.facingSin`];
    const cos = pose[`${player.id}.facingCos`];
    if (Number.isFinite(sin) && Number.isFinite(cos) && Math.hypot(sin, cos) > 0.01) presented.facing = Math.atan2(sin, cos);
    if (localPresentation?.id === player.id && localPresentation.roundId === snapshot.roundId && localPresentation.serveId === snapshot.ball.serveId) {
      for (const field of LOCAL_PRESENTATION_FIELDS) presented[field] = localPresentation[field];
    }
    return presented;
  });
}

/**
 * A serve identity change snaps to the new ball, never through the whole court.
 * @param {import("../shared/simulation.js").RiftballRound} snapshot
 * @param {Record<string,number>|null} pose
 */
export function createRiftballPresentedBall(snapshot, pose) {
  const presented = { ...snapshot.ball };
  if (!pose || pose.roundId !== snapshot.roundId || pose["ball.serveId"] !== snapshot.ball.serveId) return presented;
  for (const coordinate of BALL_COORDINATES) {
    const value = pose[`ball.${coordinate}`];
    if (Number.isFinite(value)) presented[coordinate] = value;
  }
  return presented;
}

/** @param {Record<string,number>} pose @param {Readonly<RiftballPlayer>} player */
function writePlayerPose(pose, player) {
  for (const field of PLAYER_CONTINUOUS_FIELDS) pose[`${player.id}.${field}`] = player[field];
  pose[`${player.id}.facingSin`] = Math.sin(player.facing);
  pose[`${player.id}.facingCos`] = Math.cos(player.facing);
}
