import test from "node:test";
import assert from "node:assert/strict";
import { extractSkyDashPositions, createSkyDashPresentedRunners, createSkyDashPresentedSeesaws, stepSkyDashPrediction, composeSkyDashRenderPose } from "../public/games/sky-dash/client/snapshotPose.js";

function createRunner(id, overrides = {}) {
  return { id, x: 0, y: 0, z: -3, respawnId: 0, ...overrides };
}

test("game interpolation supports variable human slots and independent bot actors", () => {
  const snapshot = { timeSec: 5, players: { west: createRunner("west"), east: createRunner("east") }, bots: [createRunner("bot1", { x: 2 })] };
  const pose = extractSkyDashPositions(snapshot);
  pose["west.x"] = 3;
  pose["bot1.z"] = -6;
  assert.equal(pose.courseTimeSec, 5);
  const runners = createSkyDashPresentedRunners(snapshot, pose);
  assert.deepEqual(runners.map((runner) => runner.id), ["west", "east", "bot1"]);
  assert.equal(runners[0].x, 3);
  assert.equal(runners[2].z, -6);
  assert.equal(snapshot.players.west.x, 0, "Presentation must not mutate authority");
});

test("a respawn never interpolates across the void from the previous identity", () => {
  const snapshot = { timeSec: 5, players: { p1: createRunner("p1", { respawnId: 2, z: -68 }) }, bots: [] };
  const pose = { "p1.x": 40, "p1.y": -8, "p1.z": -90, "p1.respawnId": 1.8 };
  assert.equal(createSkyDashPresentedRunners(snapshot, pose)[0].z, -68);
  assert.equal(createSkyDashPresentedRunners(snapshot, pose)[0].y, 0);
});

test("prediction advances analytic course time for every replayed frame without mutating context", () => {
  const runner = createRunner("p1", { predictionTimeSec: 2 });
  const context = Object.freeze({ active: true, timeSec: 2 });
  const sampledTimes = [];
  const simulate = (_runner, _input, _dt, options) => sampledTimes.push(options.timeSec);
  stepSkyDashPrediction(runner, {}, 1 / 60, context, simulate);
  stepSkyDashPrediction(runner, {}, 1 / 60, context, simulate);
  assert.deepEqual(sampledTimes, [2, 2 + 1 / 60]);
  assert.equal(context.timeSec, 2);
  stepSkyDashPrediction(runner, {}, 1 / 60, { active: false, timeSec: 2 }, simulate);
  assert.equal(runner.predictionTimeSec, 2 + 2 / 60, "Paused rounds do not advance moving obstacles");
});

test("moving obstacle presentation uses local prediction time while remote racers stay interpolated", () => {
  const snapshot = { timeSec: 2, players: { p1: createRunner("p1"), p2: createRunner("p2") }, bots: [] };
  const remotePose = { ...extractSkyDashPositions(snapshot), courseTimeSec: 1.9, "p2.x": 4 };
  const localPose = { x: 1, y: 2, z: -3, courseTimeSec: 2.08 };
  const pose = composeSkyDashRenderPose(remotePose, localPose, snapshot, "p1");
  assert.equal(pose.courseTimeSec, 2.08);
  assert.equal(pose["p1.x"], 1);
  assert.equal(pose["p2.x"], 4);
  assert.equal(remotePose.courseTimeSec, 1.9);
});

test("seesaw prediction extrapolates a bounded authoritative pose without mutating snapshots", () => {
  const baseSeesaws = [{ platformId: 3, angle: 0.1, angularVelocity: 0.2 }];
  const runner = createRunner("p1", { predictionTimeSec: 2, predictionBaseSeesaws: baseSeesaws, predictionSeesawElapsedSec: 0 });
  const context = { active: true, timeSec: 2 };
  const recordedAngles = [];
  for (let index = 0; index < 30; index += 1) {
    stepSkyDashPrediction(runner, {}, 1 / 60, context, (_runner, _input, _dtSec, options) => recordedAngles.push(options.seesaws[0].angle));
  }
  assert.equal(recordedAngles[0], 0.1);
  assert.ok(Math.abs(runner.predictionSeesaws[0].angle - 0.13) < 1e-10, "Lookahead stops at 150 ms");
  assert.deepEqual(baseSeesaws, [{ platformId: 3, angle: 0.1, angularVelocity: 0.2 }]);
  const snapshot = { seesaws: baseSeesaws };
  assert.equal(createSkyDashPresentedSeesaws(snapshot, { "seesaw.3.angle": -0.05 })[0].angle, -0.05);
  assert.equal(snapshot.seesaws[0].angle, 0.1);
});
