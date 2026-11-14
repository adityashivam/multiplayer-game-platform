import test from "node:test";
import assert from "node:assert/strict";
import { DRIFTLINE_INPUT_TEMPLATE, DRIFTLINE_SKILL_SETTINGS } from "../public/games/driftline/shared/config.js";
import {
  buildDriftlineTrack,
  createDriftlineTrackPosition,
  getDriftlineTrackPoint,
  getDriftlineTravel,
  locateOnDriftlineTrack,
} from "../public/games/driftline/shared/track.js";
import { getDriftlineTrack } from "../public/games/driftline/shared/tracks/index.js";
import { createDriftlineCar, stepDriftlineCar } from "../public/games/driftline/shared/vehicle.js";

const DT_SEC = 1 / 60;
/** A very wide ring so physics scenarios never touch a barrier. */
const skidpad = buildDriftlineTrack({
  id: "skidpad",
  name: "Skidpad",
  controlPoints: Array.from({ length: 16 }, (_unused, index) => {
    const angle = (index / 16) * Math.PI * 2;
    return [Math.sin(angle) * 900, Math.cos(angle) * 900, 0, 400];
  }),
  defaultWidthM: 400,
  runoffM: 20,
  surfaceGrip: 1,
  runoffGrip: 1,
  sampleSpacingM: 4,
});

/** A car on the skidpad centre line, rolling forward at `speed`. */
function createRollingCar(speed = 0, track = skidpad) {
  const car = createDriftlineCar(track, "p1", 0);
  const point = getDriftlineTrackPoint(track, 100, 0);
  Object.assign(car, { x: point.x, z: point.z, yaw: point.yaw, vx: Math.sin(point.yaw) * speed, vz: Math.cos(point.yaw) * speed, trackIndex: -1 });
  return car;
}

/** @param {object} car @param {number} ticks @param {(tick:number)=>Partial<typeof DRIFTLINE_INPUT_TEMPLATE>} inputForTick */
function drive(car, ticks, inputForTick, track = skidpad) {
  const trace = { maxDriftSec: 0, drifted: false, spun: false, boostTier: 0 };
  for (let tick = 0; tick < ticks; tick += 1) {
    stepDriftlineCar(car, { ...DRIFTLINE_INPUT_TEMPLATE, ...inputForTick(tick) }, DT_SEC, { track, active: true });
    trace.maxDriftSec = Math.max(trace.maxDriftSec, car.driftSec);
    trace.drifted ||= car.drifting;
    trace.spun ||= car.spinSec > 0;
    if (car.boostSec > 0) trace.boostTier = Math.max(trace.boostTier, car.boostTier);
  }
  return trace;
}

const speedOf = (car) => Math.hypot(car.vx, car.vz);

test("the Sunset Cliffs loop is long, smooth and never runs close to itself", () => {
  const track = getDriftlineTrack("sunset-cliffs");
  assert.ok(track.lengthM > 1100 && track.lengthM < 1600, `lap length ${track.lengthM}`);
  let tightestRadius = Infinity;
  for (let index = 0; index < track.sampleCount; index += 1) tightestRadius = Math.min(tightestRadius, 1 / Math.max(1e-6, Math.abs(track.curvature[index])));
  assert.ok(tightestRadius > 10, `hairpins stay drivable: ${tightestRadius}`);

  const clearance = 2 * (Math.max(...track.halfWidth) + track.runoffM);
  for (let first = 0; first < track.sampleCount; first += 3) {
    for (let second = first + 40; second < track.sampleCount; second += 3) {
      if (track.sampleCount - (second - first) < 40) continue;
      const gap = Math.hypot(track.x[first] - track.x[second], track.z[first] - track.z[second]);
      assert.ok(gap > clearance, `sections ${first} and ${second} are ${gap.toFixed(1)} m apart`);
    }
  }
});

test("track queries project positions to lap distance and signed lateral offset", () => {
  const track = getDriftlineTrack("sunset-cliffs");
  const left = getDriftlineTrackPoint(track, 300, 4);
  const position = locateOnDriftlineTrack(track, left.x, left.z, -1, createDriftlineTrackPosition());
  assert.ok(Math.abs(position.along - 300) < 1);
  assert.ok(Math.abs(position.lateral - 4) < 0.2);
  const hinted = locateOnDriftlineTrack(track, left.x, left.z, position.index + 5, createDriftlineTrackPosition());
  assert.equal(hinted.index, position.index, "the local walk finds the same sample as a full scan");
  assert.ok(Math.abs(getDriftlineTravel(track, track.lengthM - 2, 3) - 5) < 1e-9, "crossing the line counts forward");
});

test("an idle car stays parked and a throttled car accelerates to a plausible top speed", () => {
  const parked = createRollingCar();
  drive(parked, 300, () => ({}));
  assert.equal(speedOf(parked), 0);

  const accelerating = createRollingCar();
  let reached100At = null;
  for (let tick = 0; tick < 60 * 12; tick += 1) {
    drive(accelerating, 1, () => ({ throttle: 1 }));
    if (reached100At === null && speedOf(accelerating) >= 100 / 3.6) reached100At = tick * DT_SEC;
  }
  assert.ok(reached100At > 4 && reached100At < 8, `0-100 km/h in ${reached100At}s`);

  const braking = createRollingCar(30);
  let slowest = Infinity;
  for (let tick = 0; tick < 60 * 6; tick += 1) {
    drive(braking, 1, () => ({ brake: 1 }));
    slowest = Math.min(slowest, speedOf(braking));
  }
  assert.ok(slowest < 0.5, "full braking stops the car");
  const forwardSpeed = braking.vx * Math.sin(braking.yaw) + braking.vz * Math.cos(braking.yaw);
  assert.ok(forwardSpeed < -1, "holding the brake once stopped reverses");
});

test("a handbrake flick starts a drift that a balanced throttle holds without spinning", () => {
  const car = createRollingCar(26);
  const trace = drive(car, 60 * 4, (tick) => ({ steer: 0.6, handbrake: tick >= 6 && tick < 30, throttle: tick > 30 ? 0.85 : 0 }));
  assert.equal(trace.drifted, true);
  assert.equal(trace.spun, false);
  assert.ok(trace.maxDriftSec > 2.5, `drift held for ${trace.maxDriftSec}s`);
});

test("ending a long drift releases a boost tier earned by its length", () => {
  const car = createRollingCar(26);
  const trace = drive(car, 60 * 5, (tick) => ({
    steer: tick < 150 ? 0.7 : 0,
    handbrake: tick >= 6 && tick < 30,
    throttle: tick < 150 ? (tick > 30 ? 0.9 : 0) : 0.4,
  }));
  assert.ok(trace.boostTier >= 2, `boost tier ${trace.boostTier}`);
  assert.ok(car.boostSerial >= 1);
});

test("counter-steering or lifting ends a drift quickly", () => {
  for (const exitInput of [{ steer: -0.6, throttle: 0.5 }, { steer: 0, throttle: 0 }]) {
    const car = createRollingCar(26);
    drive(car, 90, (tick) => ({ steer: 1, handbrake: tick >= 6 && tick < 30, throttle: tick > 30 ? 0.8 : 0 }));
    assert.equal(car.drifting, true);
    let exitTicks = 0;
    while (car.drifting && exitTicks < 120) {
      drive(car, 1, () => exitInput);
      exitTicks += 1;
    }
    assert.ok(exitTicks < 60, `exited after ${exitTicks} ticks with ${JSON.stringify(exitInput)}`);
  }
});

test("barriers contain the car, cost drift charge and count impacts", () => {
  const track = getDriftlineTrack("sunset-cliffs");
  const car = createDriftlineCar(track, "p1", 0);
  const point = getDriftlineTrackPoint(track, 400, 0);
  const sideYaw = point.yaw + Math.PI / 2;
  Object.assign(car, { x: point.x, z: point.z, yaw: sideYaw, vx: Math.sin(sideYaw) * 20, vz: Math.cos(sideYaw) * 20, trackIndex: point.index, along: 400, driftCharge: 2 });
  drive(car, 60, () => ({}), track);
  const limit = car.lateral;
  assert.ok(Math.abs(limit) <= track.halfWidth[car.trackIndex] + track.runoffM, "the car stays inside the barrier");
  assert.equal(car.wallHitSerial, 1);
  assert.ok(car.driftCharge <= 2 - DRIFTLINE_SKILL_SETTINGS.wallChargeLoss + 1e-9);
});

test("recovery teleports to the centre line facing forward with a new identity", () => {
  const track = getDriftlineTrack("sunset-cliffs");
  const car = createDriftlineCar(track, "p1", 0);
  Object.assign(car, { yaw: car.yaw + 2, vx: 5, vz: 5, progress: 200, along: 200 });
  drive(car, 2, (tick) => ({ recover: tick === 0 }), track);
  assert.equal(car.respawnId, 1);
  assert.ok(Math.abs(car.lateral) < 0.01);
  assert.equal(speedOf(car), 0);
  assert.ok(car.progress < 200);
  drive(car, 2, (tick) => ({ recover: tick === 0 }), track);
  assert.equal(car.respawnId, 1, "the cooldown blocks an immediate second recovery");
});

test("the same inputs always produce the same car, and invalid steps do nothing", () => {
  const inputs = (tick) => ({ steer: Math.sin(tick / 20), throttle: tick % 90 < 70 ? 1 : 0, handbrake: tick % 120 === 40 });
  const first = createRollingCar(15);
  const second = createRollingCar(15);
  drive(first, 600, inputs);
  drive(second, 600, inputs);
  assert.deepEqual(first, second);

  const frozen = structuredClone(first);
  for (const dtSec of [Number.NaN, -1, 0]) stepDriftlineCar(first, { ...DRIFTLINE_INPUT_TEMPLATE, throttle: 1 }, dtSec, { track: skidpad, active: true });
  stepDriftlineCar(first, { ...DRIFTLINE_INPUT_TEMPLATE, throttle: 1 }, DT_SEC, { track: skidpad, active: false });
  assert.deepEqual(first, frozen);
});

test("finished cars ignore their driver and roll to a stop", () => {
  const car = createRollingCar(20);
  car.finished = true;
  drive(car, 60 * 8, () => ({ throttle: 1, steer: 1 }));
  assert.ok(speedOf(car) < 0.5);
});
