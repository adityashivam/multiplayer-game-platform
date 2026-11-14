/** @typedef {import("../shared/vehicle.js").DriftlineCar} DriftlineCar */
/** @typedef {import("../shared/race.js").DriftlineRace} DriftlineRace */
/** @typedef {import("../shared/prediction.js").DriftlinePredictionState} DriftlinePredictionState */
/**
 * Discrete and visual local state copied outside numeric smoothing.
 * @typedef {Pick<DriftlineCar,"id"|"steer"|"throttle"|"brake"|"handbrake"|"drifting"|"driftAngle"|"driftCharge"|"boostSec"|"boostTier"|"boostSerial"|"spinSec"|"onRunoff"|"vx"|"vz"|"respawnId"> & {matchId:number}} DriftlineLocalPresentation
 * @typedef {DriftlineCar & {index:number}} DriftlinePresentedCar
 */

const CONTINUOUS_FIELDS = Object.freeze(["x", "y", "z"]);
const LOCAL_PRESENTATION_FIELDS = Object.freeze(["steer", "throttle", "brake", "handbrake", "drifting", "driftAngle", "driftCharge", "boostSec", "boostTier", "boostSerial", "spinSec", "onRunoff", "vx", "vz"]);

/**
 * Humans then bots, in grid order. A new owned array of borrowed cars.
 * @param {Readonly<DriftlineRace>} snapshot
 * @returns {DriftlineCar[]}
 */
export function listDriftlineSnapshotCars(snapshot) {
  return [...Object.values(snapshot.players || {}), ...(snapshot.bots || [])];
}

/** @param {Record<string,number>} pose @param {Readonly<DriftlineCar>} car */
function writeDriftlineCarPose(pose, car) {
  for (const field of CONTINUOUS_FIELDS) pose[`${car.id}.${field}`] = car[field];
  pose[`${car.id}.yawSin`] = Math.sin(car.yaw);
  pose[`${car.id}.yawCos`] = Math.cos(car.yaw);
  pose[`${car.id}.steer`] = car.steer;
}

/**
 * Map every car to the SDK's numeric interpolation paths. Yaw is a unit
 * vector so crossing -PI/PI never spins a car through a full turn.
 * @param {Readonly<DriftlineRace>} snapshot
 * @returns {Record<string,number>}
 */
export function extractDriftlinePositions(snapshot) {
  const pose = { matchId: snapshot.matchId, gameTimeSec: snapshot.raceTimeSec };
  for (const car of listDriftlineSnapshotCars(snapshot)) writeDriftlineCarPose(pose, car);
  return pose;
}

/**
 * A recovery teleport changes that car's identity, so it snaps instead of
 * sliding across the scenery.
 * @param {Readonly<DriftlineRace>} snapshot
 * @returns {Record<string,string>}
 */
export function extractDriftlineContinuityKeys(snapshot) {
  const keys = { matchId: String(snapshot.matchId), gameTimeSec: String(snapshot.matchId) };
  for (const car of listDriftlineSnapshotCars(snapshot)) {
    const identity = `${snapshot.matchId}:${car.respawnId}`;
    for (const field of [...CONTINUOUS_FIELDS, "yawSin", "yawCos", "steer"]) keys[`${car.id}.${field}`] = identity;
  }
  return keys;
}

/**
 * @param {Readonly<DriftlinePredictionState>|null} predictedState Borrowed SDK clone.
 * @returns {DriftlineLocalPresentation|null}
 */
export function createDriftlineLocalPresentation(predictedState) {
  if (!predictedState) return null;
  const presentation = /** @type {DriftlineLocalPresentation} */ ({
    id: predictedState.id,
    matchId: predictedState.predictionMatchId,
    respawnId: predictedState.respawnId,
  });
  for (const field of LOCAL_PRESENTATION_FIELDS) presentation[field] = predictedState[field];
  return presentation;
}

/**
 * Combine remote interpolation with the locally predicted car.
 * @param {Record<string,number>|null} remotePose
 * @param {{x:number,y:number,z:number,yawSin:number,yawCos:number}|null} localPose
 * @param {Readonly<DriftlineRace>|null} snapshot
 * @param {string|null} playerId
 * @param {Readonly<DriftlinePredictionState>|null} predictedState
 * @returns {Record<string,number>|null}
 */
export function composeDriftlineRenderPose(remotePose, localPose, snapshot, playerId, predictedState) {
  if (!snapshot) return null;
  const pose = remotePose?.matchId === snapshot.matchId ? { ...remotePose } : extractDriftlinePositions(snapshot);
  if (!playerId || !localPose || predictedState?.predictionMatchId !== snapshot.matchId) return pose;
  for (const field of CONTINUOUS_FIELDS) pose[`${playerId}.${field}`] = localPose[field];
  pose[`${playerId}.yawSin`] = localPose.yawSin;
  pose[`${playerId}.yawCos`] = localPose.yawCos;
  pose[`${playerId}.steer`] = predictedState.steer;
  return pose;
}

/**
 * Owned presentation values per car. The local car's visual state comes from
 * prediction so lights, smoke and boost react instantly.
 * @param {Readonly<DriftlineRace>} snapshot
 * @param {Record<string,number>|null} pose
 * @param {DriftlineLocalPresentation|null} [localPresentation]
 * @returns {DriftlinePresentedCar[]}
 */
export function createDriftlinePresentedCars(snapshot, pose, localPresentation = null) {
  const sameMatch = pose?.matchId === snapshot.matchId;
  return listDriftlineSnapshotCars(snapshot).map((car) => {
    const presented = /** @type {DriftlinePresentedCar} */ ({ ...car, index: car.slotIndex });
    if (!sameMatch) return presented;
    for (const field of CONTINUOUS_FIELDS) {
      const value = pose[`${car.id}.${field}`];
      if (Number.isFinite(value)) presented[field] = value;
    }
    const sin = pose[`${car.id}.yawSin`];
    const cos = pose[`${car.id}.yawCos`];
    if (Number.isFinite(sin) && Number.isFinite(cos) && Math.hypot(sin, cos) > 0.01) presented.yaw = Math.atan2(sin, cos);
    if (Number.isFinite(pose[`${car.id}.steer`])) presented.steer = pose[`${car.id}.steer`];
    const ownsLocal = localPresentation?.id === car.id && localPresentation.matchId === snapshot.matchId &&
      localPresentation.respawnId === car.respawnId;
    if (ownsLocal) {
      for (const field of LOCAL_PRESENTATION_FIELDS) presented[field] = localPresentation[field];
    }
    return presented;
  });
}
