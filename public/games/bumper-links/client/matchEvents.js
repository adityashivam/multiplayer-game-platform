import { listBumperLinksSnapshotBalls } from "./snapshotPose.js";

/**
 * @typedef {"shot"|"sink"|"splash"|"knockout"|"holeStart"|"holeOver"} BumperLinksClientEventType
 * @typedef {{type:BumperLinksClientEventType,ballId:string|null,byId:string|null,points:number,holeIndex:number,x:number,z:number}} BumperLinksClientEvent
 *   `x`/`z` locate sinks and splashes; 0 for other events.
 */

/**
 * Turn snapshot serials into one-shot presentation events. History that
 * arrived before this client joined, or before a rematch, is never replayed.
 * @returns {{update:(snapshot:import("./snapshotPose.js").BumperLinksSnapshot)=>BumperLinksClientEvent[],reset:()=>void}}
 */
export function createBumperLinksEventTracker() {
  let matchId = -1;
  let eventSerial = 0;
  let holeSerial = 0;
  let phase = "";
  /** @type {Map<string,number>} */
  const shotIds = new Map();

  function reset() {
    matchId = -1;
    eventSerial = 0;
    holeSerial = 0;
    phase = "";
    shotIds.clear();
  }

  /** @param {import("./snapshotPose.js").BumperLinksSnapshot} snapshot */
  function adoptBumperLinksSnapshot(snapshot) {
    matchId = snapshot.matchId;
    eventSerial = snapshot.eventSerial;
    holeSerial = snapshot.holeSerial;
    phase = snapshot.phase;
    shotIds.clear();
    for (const ball of listBumperLinksSnapshotBalls(snapshot)) shotIds.set(ball.id, ball.shotId);
  }

  /** @param {import("./snapshotPose.js").BumperLinksSnapshot} snapshot */
  function update(snapshot) {
    if (snapshot.matchId !== matchId) {
      adoptBumperLinksSnapshot(snapshot);
      return [];
    }
    /** @type {BumperLinksClientEvent[]} */
    const events = [];
    const holeIndex = snapshot.holeIndex;
    if (snapshot.holeSerial !== holeSerial) {
      holeSerial = snapshot.holeSerial;
      events.push({ type: "holeStart", ballId: null, byId: null, points: 0, holeIndex, x: 0, z: 0 });
    }
    for (const ball of listBumperLinksSnapshotBalls(snapshot)) {
      const previousShotId = shotIds.get(ball.id) ?? ball.shotId;
      if (ball.shotId > previousShotId) events.push({ type: "shot", ballId: ball.id, byId: null, points: 0, holeIndex, x: ball.x, z: ball.z });
      shotIds.set(ball.id, ball.shotId);
    }
    for (const matchEvent of snapshot.recentEvents) {
      if (matchEvent.serial <= eventSerial) continue;
      events.push({ type: matchEvent.type, ballId: matchEvent.ballId, byId: matchEvent.byId, points: matchEvent.points, holeIndex, x: matchEvent.x, z: matchEvent.z });
    }
    eventSerial = Math.max(eventSerial, snapshot.eventSerial);
    if (snapshot.phase !== phase) {
      if (snapshot.phase === "holeOver") events.push({ type: "holeOver", ballId: null, byId: null, points: 0, holeIndex, x: 0, z: 0 });
      phase = snapshot.phase;
    }
    return events;
  }

  return { update, reset };
}
