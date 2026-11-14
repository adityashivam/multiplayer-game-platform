import test from "node:test";
import assert from "node:assert/strict";
import { DRIFTLINE_INPUT_TEMPLATE, DRIFTLINE_NUMERIC_INPUTS, DRIFTLINE_RACE_SETTINGS, DRIFTLINE_SKILL_SETTINGS } from "../public/games/driftline/shared/config.js";
import {
  applyDriftlineLaunch,
  createDriftlineRace,
  listDriftlineCars,
  recordDriftlineLaunchInput,
  startDriftlineRace,
  stepDriftlineRace,
} from "../public/games/driftline/shared/race.js";
import { getDriftlineTrack } from "../public/games/driftline/shared/tracks/index.js";
import { stepDriftlineCar } from "../public/games/driftline/shared/vehicle.js";
import { createDriftlineBotBrain, decideDriftlineBotInput, decideDriftlineBotLaunchThrottle } from "../public/games/driftline/shared/bot.js";
import { getDriftlineTrackPoint } from "../public/games/driftline/shared/track.js";

const DT_SEC = 1 / 60;
const track = getDriftlineTrack("sunset-cliffs");

function createStartedRace(options) {
  const race = createDriftlineRace(options);
  Object.assign(race, { started: true, phase: "racing" });
  for (const car of Object.values(race.players)) car.connected = true;
  startDriftlineRace(race);
  return race;
}

/** @param {object} car @param {number} along @param {number} [lateral] */
function placeCar(car, along, lateral = 0) {
  const point = getDriftlineTrackPoint(track, along, lateral);
  Object.assign(car, { x: point.x, z: point.z, yaw: point.yaw, along: ((along % track.lengthM) + track.lengthM) % track.lengthM, progress: along, trackIndex: point.index, lateral });
}

test("the countdown hold decides the launch: late is perfect, early bogs", () => {
  const race = createDriftlineRace({ playerIds: ["p1"], botIds: ["late", "early", "idle"] });
  const [human, late, early, idle] = listDriftlineCars(race);
  for (let tick = 0; tick < 120; tick += 1) {
    recordDriftlineLaunchInput(human, tick >= 80 ? 1 : 0);
    recordDriftlineLaunchInput(late, tick >= 100 ? 1 : 0);
    recordDriftlineLaunchInput(early, 1);
    recordDriftlineLaunchInput(idle, 0);
  }
  for (const car of [human, late, early, idle]) applyDriftlineLaunch(car);
  assert.equal(human.launch, "good");
  assert.equal(late.launch, "perfect");
  assert.equal(late.boostSec, DRIFTLINE_SKILL_SETTINGS.launchBoostSec);
  assert.equal(early.launch, "bogged");
  assert.ok(early.bogSec > 0);
  assert.equal(idle.launch, "none");
});

test("laps count only after a full lap, and the third completed lap finishes the race", () => {
  const race = createStartedRace({ playerIds: ["p1"], botIds: [] });
  const car = race.players.p1;
  placeCar(car, track.lengthM - 1);
  stepDriftlineRace(race, DT_SEC);
  assert.equal(car.lap, 0, "crossing the line from the grid is not a lap");

  for (let lap = 1; lap <= DRIFTLINE_RACE_SETTINGS.laps; lap += 1) {
    placeCar(car, lap * track.lengthM + 1);
    race.raceTimeSec = lap * 40;
    stepDriftlineRace(race, DT_SEC);
    assert.equal(car.lap, lap);
  }
  assert.equal(car.finished, true);
  assert.deepEqual(race.finishOrder, ["p1"]);
  assert.ok(car.bestLapSec > 0);
  assert.equal(race.gameOver, true, "the race ends once every human finishes");
  assert.equal(race.winner, "p1");
});

test("positions follow distance covered and finishers keep crossing order", () => {
  const race = createStartedRace({ playerIds: ["p1"], botIds: ["bot1", "bot2"] });
  const [human, bot1, bot2] = listDriftlineCars(race);
  placeCar(human, 100);
  placeCar(bot1, 300);
  placeCar(bot2, 200);
  stepDriftlineRace(race, DT_SEC);
  assert.deepEqual([human.position, bot1.position, bot2.position], [3, 1, 2]);

  bot2.finished = true;
  race.finishOrder.push("bot2");
  stepDriftlineRace(race, DT_SEC);
  assert.equal(bot2.position, 1, "a finisher ranks ahead of anyone still racing");
});

test("the race also ends after the grace period following the first finish", () => {
  const race = createStartedRace({ playerIds: ["p1"], botIds: ["bot1"] });
  race.finishOrder.push("bot1");
  race.bots[0].finished = true;
  race.firstFinishSec = 10;
  race.raceTimeSec = 10 + DRIFTLINE_RACE_SETTINGS.finishGraceSec - 0.5;
  stepDriftlineRace(race, DT_SEC);
  assert.equal(race.gameOver, false);
  race.raceTimeSec = 10 + DRIFTLINE_RACE_SETTINGS.finishGraceSec;
  stepDriftlineRace(race, DT_SEC);
  assert.equal(race.gameOver, true);
  assert.equal(race.winner, "bot1");
});

test("a car close behind another builds slipstream; one alongside does not", () => {
  const race = createStartedRace({ playerIds: ["p1"], botIds: ["leader", "beside"] });
  const [follower, leader, beside] = listDriftlineCars(race);
  placeCar(leader, 500, 0);
  placeCar(follower, 490, 0.5);
  placeCar(beside, 491, 6);
  for (let tick = 0; tick < 60; tick += 1) stepDriftlineRace(race, DT_SEC);
  assert.equal(follower.slipstream, 1);
  assert.equal(beside.slipstream, 0);
});

test("overlapping cars separate with a bounded impulse", () => {
  const race = createStartedRace({ playerIds: ["p1"], botIds: ["bot1"] });
  const [carA, carB] = listDriftlineCars(race);
  placeCar(carA, 500, 0);
  placeCar(carB, 501, 0);
  carA.vx = Math.sin(carA.yaw) * 30;
  carA.vz = Math.cos(carA.yaw) * 30;
  stepDriftlineRace(race, DT_SEC);
  assert.ok(Math.hypot(carA.x - carB.x, carA.z - carB.z) > 1.5, "bodies no longer overlap");
  assert.ok(Math.hypot(carB.vx, carB.vz) <= 4 + 1e-9, "a rear-ending car cannot launch the one ahead");
  assert.equal(race.contactSerial, 1);
});

test("bots are deterministic, respect the input contract and lap cleanly alone", () => {
  function runBotLap(seed) {
    const race = createStartedRace({ playerIds: [], botIds: ["bot1"] });
    const brain = createDriftlineBotBrain(seed);
    const car = race.bots[0];
    const inputs = [];
    for (let tick = 0; tick < 60 * 80 && car.lap < 1; tick += 1) {
      const input = decideDriftlineBotInput(car, brain, track, DT_SEC);
      inputs.push({ ...input });
      stepDriftlineCar(car, input, DT_SEC, { track, active: true });
      stepDriftlineRace(race, DT_SEC);
    }
    return { car, inputs };
  }
  const first = runBotLap(4);
  const second = runBotLap(4);
  assert.deepEqual(first.inputs, second.inputs);
  assert.equal(first.car.lap, 1, "the bot completes a lap");
  assert.ok(first.car.wallHitSerial <= 2, `a solo bot keeps off the barriers: ${first.car.wallHitSerial}`);
  for (const input of first.inputs.slice(0, 2000)) {
    assert.deepEqual(Object.keys(input).sort(), Object.keys(DRIFTLINE_INPUT_TEMPLATE).sort());
    for (const [field, range] of Object.entries(DRIFTLINE_NUMERIC_INPUTS)) {
      assert.ok(input[field] >= range.min && input[field] <= range.max, `${field} in range`);
    }
  }
  const brain = createDriftlineBotBrain(1);
  assert.equal(decideDriftlineBotLaunchThrottle(brain, brain.launchTicks + 1), 0);
  assert.equal(decideDriftlineBotLaunchThrottle(brain, brain.launchTicks), 1);
});

test("a race with no human seats never ends on the every-human-finished rule", () => {
  const race = createStartedRace({ playerIds: [], botIds: ["bot1"] });
  stepDriftlineRace(race, DT_SEC);
  assert.equal(race.gameOver, false);
});
