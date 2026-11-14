/** @typedef {import("../shared/race.js").DriftlineRace} DriftlineRace */
/** @typedef {import("./snapshotPose.js").DriftlinePresentedCar} DriftlinePresentedCar */
/**
 * One presentation event for effects, audio and HUD.
 * @typedef {object} DriftlineRaceEvent
 * @property {"boost"|"wallHit"|"contact"|"lap"|"finish"|"launch"} kind
 * @property {string|null} carId
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} value Kind-specific: boost tier, impact speed, lap number or launch rank.
 */

const LAUNCH_RANK = Object.freeze({ none: 0, bogged: 1, good: 2, perfect: 3 });

/**
 * Turn successive snapshots and presented cars into discrete events. Serial
 * baselines reset on a new match so rematches and rejoins never replay old
 * effects. The returned array is reused per call.
 * @returns {{update(snapshot:Readonly<DriftlineRace>,cars:readonly DriftlinePresentedCar[]):DriftlineRaceEvent[],reset():void}}
 */
export function createDriftlineEventTracker() {
  /** @type {DriftlineRaceEvent[]} */
  const events = [];
  const baselines = new Map();
  let matchId = null;
  let contactSerial = 0;

  /** @param {DriftlineRaceEvent["kind"]} kind @param {DriftlinePresentedCar|null} car @param {number} value */
  function pushEvent(kind, car, value) {
    events.push({ kind, carId: car?.id ?? null, x: car?.x ?? 0, y: car?.y ?? 0, z: car?.z ?? 0, value });
  }

  return {
    reset() {
      baselines.clear();
      matchId = null;
    },
    update(snapshot, cars) {
      events.length = 0;
      if (snapshot.matchId !== matchId) {
        matchId = snapshot.matchId;
        baselines.clear();
        contactSerial = snapshot.contactSerial;
      }
      for (const car of cars) {
        const baseline = baselines.get(car.id);
        if (!baseline) {
          baselines.set(car.id, { boostSerial: car.boostSerial, wallHitSerial: car.wallHitSerial, lap: car.lap, finished: car.finished, launch: car.launch });
          continue;
        }
        if (car.boostSerial !== baseline.boostSerial) pushEvent("boost", car, car.boostTier);
        if (car.wallHitSerial !== baseline.wallHitSerial) pushEvent("wallHit", car, car.wallHitSpeed);
        if (car.lap > baseline.lap && !car.finished) pushEvent("lap", car, car.lap);
        if (car.finished && !baseline.finished) pushEvent("finish", car, car.position);
        if (car.launch !== baseline.launch && car.launch !== "none") pushEvent("launch", car, LAUNCH_RANK[car.launch]);
        baseline.boostSerial = car.boostSerial;
        baseline.wallHitSerial = car.wallHitSerial;
        baseline.lap = car.lap;
        baseline.finished = car.finished;
        baseline.launch = car.launch;
      }
      if (snapshot.contactSerial !== contactSerial) {
        pushEvent("contact", null, 1);
        contactSerial = snapshot.contactSerial;
      }
      return events;
    },
  };
}
