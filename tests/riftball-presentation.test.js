import test from "node:test";
import assert from "node:assert/strict";
import { extractRiftballPositions, composeRiftballRenderPose, createRiftballPresentedPlayers, createRiftballPresentedBall, createRiftballLocalPresentation } from "../public/games/riftball/client/snapshotPose.js";
import { createWorkerInterpolator } from "../public/platform/frontend-engine/interpolationWorker.js";

function createSnapshot() {
  const createPlayer = (id, z) => ({ id, slotIndex: id === "p1" ? 0 : 1, x: 0, y: 0, z, vx: 0, vy: 0, vz: 0, facing: Math.PI, action: "idle", actionId: 1, actionTimeSec: 0, chargeSec: 0, strikePower: 0, stamina: 100, grounded: true });
  return { roundId: 1, timeSec: 4, phase: "playing", players: { p1: createPlayer("p1", 4), p2: createPlayer("p2", -4) }, ball: { x: 0, y: 0.4, z: 0, serveId: 1, hitSerial: 1 } };
}

test("local ball and actions use prediction while the opponent keeps interpolation", () => {
  const snapshot = createSnapshot();
  const remote = { ...extractRiftballPositions(snapshot), "p2.x": 3 };
  const prediction = { ...snapshot.players.p1, action: "strike", actionId: 2, actionTimeSec: 0.12, predictionRoundId: 1, predictionTimeSec: 4.1, previewBall: { ...snapshot.ball } };
  const local = { x: 2, y: 0, z: 3, facingSin: 0, facingCos: -1, ballX: 1, ballY: 0.8, ballZ: -2 };
  const pose = composeRiftballRenderPose(remote, local, snapshot, "p1", prediction);
  const players = createRiftballPresentedPlayers(snapshot, pose, createRiftballLocalPresentation(prediction));
  assert.equal(players[0].x, 2);
  assert.equal(players[0].action, "strike");
  assert.equal(players[0].actionId, 2, "Discrete identity does not pass through correction offsets");
  assert.equal(players[1].x, 3);
  assert.equal(createRiftballPresentedBall(snapshot, pose).z, -2);
  assert.equal(snapshot.players.p1.x, 0);
  assert.equal(snapshot.ball.z, 0);
  assert.equal(remote["p1.x"], 0);
});

function sampleTransition(first, second) {
  const interpolator = createWorkerInterpolator({ extractPositions: extractRiftballPositions, adaptive: false, interpDelayMs: 65 });
  interpolator.pushState({ ...first, net: { seq: 1, serverTime: 0 } }, { timestampMs: 0 });
  interpolator.pushState({ ...second, net: { seq: 2, serverTime: 100 } }, { timestampMs: 100 });
  const pose = interpolator.getInterpolatedPositions({ nowMs: 115, pingMs: 0 });
  interpolator.destroy();
  return pose;
}

test("remote action transitions never blend an old run clock into a new strike", () => {
  const first = createSnapshot();
  Object.assign(first.players.p2, { action: "run", actionId: 1, actionTimeSec: 10 });
  const second = structuredClone(first);
  Object.assign(second.players.p2, { x: 6, action: "strike", actionId: 2, actionTimeSec: 0.05 });
  const players = createRiftballPresentedPlayers(second, sampleTransition(first, second));
  assert.ok(players[1].x > 0 && players[1].x < 6, "Positions retain interpolation");
  assert.equal(players[1].action, "strike");
  assert.equal(players[1].actionId, 2);
  assert.equal(players[1].actionTimeSec, 0.05, "The strike clip starts at its own clock");
});

test("remote athletes snap across a new serve with the ball instead of gliding through the court", () => {
  const first = createSnapshot();
  Object.assign(first.players.p2, { x: 8, z: 15 });
  const second = createSnapshot();
  second.ball.serveId = 2;
  second.players.p2.z = -7.5;
  const players = createRiftballPresentedPlayers(second, sampleTransition(first, second));
  assert.equal(players[1].x, 0);
  assert.equal(players[1].z, -7.5);
});

test("serve and round resets never draw a ball crossing the entire court", () => {
  const snapshot = createSnapshot();
  const oldPose = { ...extractRiftballPositions(snapshot), "ball.z": 17, "ball.serveId": 0.8 };
  assert.equal(createRiftballPresentedBall(snapshot, oldPose).z, 0);
  oldPose.roundId = 0;
  oldPose["p1.x"] = 99;
  assert.equal(createRiftballPresentedPlayers(snapshot, oldPose)[0].x, 0);
  const stalePrediction = { ...snapshot.players.p1, predictionRoundId: 0, previewBall: { ...snapshot.ball } };
  const combined = composeRiftballRenderPose(null, { x: 99, y: 0, z: 99 }, snapshot, "p1", stalePrediction);
  assert.equal(combined["p1.x"], 0);
});

test("facing interpolation crosses the angle seam by the short arc", () => {
  const snapshot = createSnapshot();
  const pose = extractRiftballPositions(snapshot);
  pose["p1.facingSin"] = 0;
  pose["p1.facingCos"] = -0.9999;
  assert.ok(Math.abs(createRiftballPresentedPlayers(snapshot, pose)[0].facing) > 3.1);
});
