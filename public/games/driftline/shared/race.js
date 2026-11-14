import { DRIFTLINE_CAR_SETTINGS, DRIFTLINE_RACE_SETTINGS, DRIFTLINE_SKILL_SETTINGS } from "./config.js";
import { DRIFTLINE_DEFAULT_TRACK_ID, getDriftlineTrack } from "./tracks/index.js";
import { createDriftlineCar, getDriftlineStepDuration } from "./vehicle.js";

/** @typedef {import("./vehicle.js").DriftlineCar} DriftlineCar */
/** @typedef {import("./config.js").DriftlinePhase} DriftlinePhase */
/**
 * @typedef {object} DriftlineRace
 * @property {number} matchId Changes on rematch.
 * @property {string} trackId
 * @property {Record<string,DriftlineCar>} players Human seats only.
 * @property {DriftlineCar[]} bots Server-owned cars outside seat ownership.
 * @property {number} laps
 * @property {number} raceTimeSec Time since the start lights went out.
 * @property {number} timeSec Total simulated time.
 * @property {boolean} started
 * @property {number|null} startAt
 * @property {boolean} launchResolved
 * @property {boolean} gameOver
 * @property {string|null} winner Car ID.
 * @property {DriftlinePhase} phase
 * @property {string[]} finishOrder Car IDs in crossing order.
 * @property {number} firstFinishSec Race time of the first finish, or -1.
 * @property {number} contactSerial Increments on every car-to-car contact.
 */

const CONTACT_EVENT_SPEED = 1.5;
const MAX_CONTACT_IMPULSE = 4;
const CONTACT_RESTITUTION = 0.2;
/** Reused per world step; the simulation never re-enters. */
const carScratch = [];

/**
 * Create a race with every car on the grid. Human seats start unconnected.
 * @param {{playerIds:readonly string[],botIds?:readonly string[],trackId?:string}} options
 * @returns {DriftlineRace}
 * @throws {TypeError} For an unknown track, an empty grid or repeated IDs.
 */
export function createDriftlineRace({ playerIds, botIds = [], trackId = DRIFTLINE_DEFAULT_TRACK_ID }) {
  const carIds = [...playerIds, ...botIds];
  if (carIds.length < 1 || new Set(carIds).size !== carIds.length) {
    throw new TypeError("Driftline needs at least one car and unique car IDs.");
  }
  const track = getDriftlineTrack(trackId);
  const players = {};
  playerIds.forEach((playerId, index) => {
    players[playerId] = createDriftlineCar(track, playerId, index);
  });
  return {
    matchId: 1,
    trackId,
    players,
    bots: botIds.map((botId, index) => createDriftlineCar(track, botId, playerIds.length + index, true)),
    laps: DRIFTLINE_RACE_SETTINGS.laps,
    raceTimeSec: 0,
    timeSec: 0,
    started: false,
    startAt: null,
    launchResolved: false,
    gameOver: false,
    winner: null,
    phase: "waiting",
    finishOrder: [],
    firstFinishSec: -1,
    contactSerial: 0,
  };
}

/**
 * Humans then bots in grid order.
 * @param {Readonly<DriftlineRace>} race
 * @param {DriftlineCar[]} [target] Cleared and refilled when supplied.
 * @returns {DriftlineCar[]}
 */
export function listDriftlineCars(race, target = []) {
  target.length = 0;
  for (const car of Object.values(race.players)) target.push(car);
  for (const car of race.bots) target.push(car);
  return target;
}

/**
 * Count fixed steps the throttle is held during the platform countdown. Only
 * the final unbroken hold counts, so early revving is visible at the start.
 * @param {DriftlineCar} car
 * @param {number} throttle
 */
export function recordDriftlineLaunchInput(car, throttle) {
  car.launchHoldTicks = throttle > 0.5 ? car.launchHoldTicks + 1 : 0;
}

/**
 * Turn the countdown hold into a launch: a late, short hold is perfect, a
 * slightly longer one is good, and revving too early bogs the engine.
 * @param {DriftlineCar} car
 */
export function applyDriftlineLaunch(car) {
  const skills = DRIFTLINE_SKILL_SETTINGS;
  const ticks = car.launchHoldTicks;
  car.launchHoldTicks = 0;
  if (ticks <= 0) {
    car.launch = "none";
  } else if (ticks <= skills.launchPerfectMaxTicks) {
    car.launch = "perfect";
    car.boostTier = 1;
    car.boostSec = skills.launchBoostSec;
    car.boostSerial += 1;
  } else if (ticks <= skills.launchGoodMaxTicks) {
    car.launch = "good";
    car.boostTier = 1;
    car.boostSec = skills.launchGoodBoostSec;
    car.boostSerial += 1;
  } else {
    car.launch = "bogged";
    car.bogSec = skills.launchBogSec;
  }
}

const CONTACT_ENDS = Object.freeze([1, -1]);

/**
 * Push overlapping cars apart and exchange a bounded impulse along the contact
 * normal, so bumps happen but nobody can be punted off the road.
 * @param {DriftlineRace} race
 * @param {DriftlineCar[]} cars
 */
function resolveDriftlineContacts(race, cars) {
  const minimumDistance = DRIFTLINE_CAR_SETTINGS.collisionRadiusM * 2;
  for (let first = 0; first < cars.length; first += 1) {
    for (let second = first + 1; second < cars.length; second += 1) {
      const carA = cars[first];
      const carB = cars[second];
      if (Math.abs(carA.x - carB.x) > 8 || Math.abs(carA.z - carB.z) > 8) continue;
      let deepest = 0;
      let normalX = 0;
      let normalZ = 0;
      // Two circles per car, front and rear, approximate its body cheaply.
      for (const endA of CONTACT_ENDS) {
        const offsetA = DRIFTLINE_CAR_SETTINGS.collisionOffsetM * endA;
        const circleAX = carA.x + Math.sin(carA.yaw) * offsetA;
        const circleAZ = carA.z + Math.cos(carA.yaw) * offsetA;
        for (const endB of CONTACT_ENDS) {
          const offsetB = DRIFTLINE_CAR_SETTINGS.collisionOffsetM * endB;
          const offsetX = carB.x + Math.sin(carB.yaw) * offsetB - circleAX;
          const offsetZ = carB.z + Math.cos(carB.yaw) * offsetB - circleAZ;
          const distance = Math.hypot(offsetX, offsetZ);
          const overlap = minimumDistance - distance;
          if (overlap > deepest && distance > 1e-6) {
            deepest = overlap;
            normalX = offsetX / distance;
            normalZ = offsetZ / distance;
          }
        }
      }
      if (deepest <= 0) continue;
      carA.x -= normalX * deepest * 0.5;
      carA.z -= normalZ * deepest * 0.5;
      carB.x += normalX * deepest * 0.5;
      carB.z += normalZ * deepest * 0.5;
      const closingSpeed = (carA.vx - carB.vx) * normalX + (carA.vz - carB.vz) * normalZ;
      if (closingSpeed <= 0) continue;
      const impulse = Math.min(MAX_CONTACT_IMPULSE, closingSpeed * (1 + CONTACT_RESTITUTION) * 0.5);
      carA.vx -= normalX * impulse;
      carA.vz -= normalZ * impulse;
      carB.vx += normalX * impulse;
      carB.vz += normalZ * impulse;
      if (closingSpeed > CONTACT_EVENT_SPEED) race.contactSerial += 1;
    }
  }
}

/**
 * Drafting: a car directly behind another within range loses drag. Strength
 * builds and fades over time so it cannot flicker on and off.
 * @param {DriftlineCar[]} cars
 * @param {number} stepSec
 */
function updateDriftlineSlipstream(cars, stepSec) {
  const skills = DRIFTLINE_SKILL_SETTINGS;
  for (const car of cars) {
    let drafting = false;
    if (!car.finished) {
      for (const leader of cars) {
        if (leader === car || leader.finished) continue;
        const gap = leader.progress - car.progress;
        if (gap > 3 && gap < skills.slipstreamRangeM && Math.abs(leader.lateral - car.lateral) < skills.slipstreamWidthM) {
          drafting = true;
          break;
        }
      }
    }
    const change = skills.slipstreamBuildPerSec * stepSec;
    car.slipstream = drafting ? Math.min(1, car.slipstream + change) : Math.max(0, car.slipstream - change * 2);
  }
}

/**
 * @param {DriftlineRace} race
 * @param {DriftlineCar[]} cars
 * @param {number} lapLengthM
 */
function updateDriftlineLaps(race, cars, lapLengthM) {
  for (const car of cars) {
    if (car.finished) continue;
    const completedLaps = Math.max(0, Math.floor(car.progress / lapLengthM));
    if (completedLaps <= car.lap) continue;
    car.lap = completedLaps;
    car.lastLapSec = race.raceTimeSec - car.lapStartSec;
    car.bestLapSec = car.bestLapSec > 0 ? Math.min(car.bestLapSec, car.lastLapSec) : car.lastLapSec;
    car.lapStartSec = race.raceTimeSec;
    if (car.lap >= race.laps) {
      car.finished = true;
      car.finishTimeSec = race.raceTimeSec;
      race.finishOrder.push(car.id);
      if (race.firstFinishSec < 0) race.firstFinishSec = race.raceTimeSec;
    }
  }
}

/**
 * Finishers keep crossing order; everyone else ranks by distance covered.
 * @param {DriftlineRace} race
 * @param {DriftlineCar[]} cars
 */
function rankDriftlineCars(race, cars) {
  const ranked = [...cars].sort((carA, carB) => {
    const finishA = race.finishOrder.indexOf(carA.id);
    const finishB = race.finishOrder.indexOf(carB.id);
    if (finishA >= 0 || finishB >= 0) {
      if (finishA < 0) return 1;
      if (finishB < 0) return -1;
      return finishA - finishB;
    }
    return carB.progress - carA.progress;
  });
  ranked.forEach((car, index) => { car.position = index + 1; });
  return ranked;
}

/**
 * The race ends when every human has finished, when the grace period after
 * the first finish runs out, or at the hard time limit.
 * @param {DriftlineRace} race
 * @param {DriftlineCar[]} ranked
 */
function decideDriftlineRaceEnd(race, ranked) {
  const humans = Object.values(race.players);
  const humansDone = humans.length > 0 && humans.every((car) => car.finished);
  const graceOver = race.firstFinishSec >= 0 && race.raceTimeSec - race.firstFinishSec >= DRIFTLINE_RACE_SETTINGS.finishGraceSec;
  if (!humansDone && !graceOver && race.raceTimeSec < DRIFTLINE_RACE_SETTINGS.maxRaceSec) return;
  race.gameOver = true;
  race.phase = "finished";
  race.winner = ranked[0]?.id ?? null;
}

/**
 * Advance launches, contacts, drafting, laps, positions and the result once
 * per tick after every car has moved. Authority calls this; prediction does
 * not. Unstarted or finished races are inert.
 * @param {DriftlineRace} race
 * @param {number} dtSec
 */
export function stepDriftlineRace(race, dtSec) {
  if (!race.started || race.gameOver) return;
  const stepSec = getDriftlineStepDuration(dtSec);
  if (stepSec <= 0) return;

  const track = getDriftlineTrack(race.trackId);
  const cars = listDriftlineCars(race, carScratch);
  race.phase = "racing";
  race.timeSec += stepSec;
  race.raceTimeSec += stepSec;
  resolveDriftlineContacts(race, cars);
  updateDriftlineSlipstream(cars, stepSec);
  updateDriftlineLaps(race, cars, track.lengthM);
  decideDriftlineRaceEnd(race, rankDriftlineCars(race, cars));
}

/**
 * Called once when authority starts the race: resolve every car's launch.
 * @param {DriftlineRace} race
 */
export function startDriftlineRace(race) {
  if (race.launchResolved) return;
  race.launchResolved = true;
  for (const car of listDriftlineCars(race, carScratch)) applyDriftlineLaunch(car);
}
