/** @typedef {import("../shared/ball.js").BumperLinksBall} BumperLinksBall */
/**
 * The client snapshot: match fields without the course, plus SDK metadata.
 * @typedef {object} BumperLinksSnapshot
 * @property {number} matchId @property {number} holeIndex @property {number} holes
 * @property {number} holeSeed @property {number} par
 * @property {Record<string,BumperLinksBall>} players @property {BumperLinksBall[]} bots
 * @property {import("../shared/config.js").BumperLinksPhase} phase
 * @property {boolean} started @property {number|null} startAt @property {boolean} gameOver
 * @property {string|null} winner @property {number} holeTimeSec @property {number} holeResetRemainingSec
 * @property {number} holeSerial @property {number} eventSerial
 * @property {import("../shared/match.js").BumperLinksMatchEvent[]} recentEvents
 * @typedef {BumperLinksBall & {index:number}} BumperLinksPresentedBall
 */

const CONTINUOUS_FIELDS = Object.freeze(["x", "y", "z"]);

/**
 * Humans then bots, in slot order. A new owned array of borrowed balls.
 * @param {Readonly<BumperLinksSnapshot>} snapshot
 * @returns {BumperLinksBall[]}
 */
export function listBumperLinksSnapshotBalls(snapshot) {
  return [...Object.values(snapshot.players || {}), ...(snapshot.bots || [])];
}

/** @param {Readonly<BumperLinksSnapshot>} snapshot */
function getBumperLinksHoleIdentity(snapshot) {
  return `${snapshot.matchId}:${snapshot.holeIndex}`;
}

/**
 * Map every ball to the SDK's numeric interpolation paths. The hole clock
 * rides along so sweeper bars render in step with the balls.
 * @param {Readonly<BumperLinksSnapshot>} snapshot
 * @returns {Record<string,number>}
 */
export function extractBumperLinksPositions(snapshot) {
  const pose = { matchId: snapshot.matchId, holeIndex: snapshot.holeIndex, holeTimeSec: snapshot.holeTimeSec };
  for (const ball of listBumperLinksSnapshotBalls(snapshot)) {
    for (const field of CONTINUOUS_FIELDS) pose[`${ball.id}.${field}`] = ball[field];
  }
  return pose;
}

/**
 * Hole starts and water returns teleport a ball, so each life is its own
 * identity and never slides across the course.
 * @param {Readonly<BumperLinksSnapshot>} snapshot
 * @returns {Record<string,string>}
 */
export function extractBumperLinksContinuityKeys(snapshot) {
  const holeIdentity = getBumperLinksHoleIdentity(snapshot);
  const keys = { matchId: holeIdentity, holeIndex: holeIdentity, holeTimeSec: holeIdentity };
  for (const ball of listBumperLinksSnapshotBalls(snapshot)) {
    const identity = `${holeIdentity}:${ball.lifeId}`;
    for (const field of CONTINUOUS_FIELDS) keys[`${ball.id}.${field}`] = identity;
  }
  return keys;
}

/**
 * Owned presentation copies with interpolated positions, used only when the
 * pose belongs to the snapshot's hole.
 * @param {Readonly<BumperLinksSnapshot>} snapshot
 * @param {Record<string,number>|null} pose
 * @returns {BumperLinksPresentedBall[]}
 */
export function createBumperLinksPresentedBalls(snapshot, pose) {
  const sameHole = pose?.matchId === snapshot.matchId && pose?.holeIndex === snapshot.holeIndex;
  return listBumperLinksSnapshotBalls(snapshot).map((ball) => {
    const presented = /** @type {BumperLinksPresentedBall} */ ({ ...ball, index: ball.slotIndex });
    if (!sameHole) return presented;
    for (const field of CONTINUOUS_FIELDS) {
      const value = pose[`${ball.id}.${field}`];
      if (Number.isFinite(value)) presented[field] = value;
    }
    return presented;
  });
}

/**
 * Presentation hole clock: interpolated when it belongs to this hole.
 * @param {Readonly<BumperLinksSnapshot>} snapshot @param {Record<string,number>|null} pose
 */
export function getBumperLinksPresentedHoleTime(snapshot, pose) {
  const sameHole = pose?.matchId === snapshot.matchId && pose?.holeIndex === snapshot.holeIndex;
  return sameHole && Number.isFinite(pose.holeTimeSec) ? pose.holeTimeSec : snapshot.holeTimeSec;
}
