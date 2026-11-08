import test from "node:test";
import assert from "node:assert/strict";
import { RIFTBALL_INPUT_TEMPLATE } from "../public/games/riftball/shared/config.js";
import { createRiftballRound, stepRiftballPlayer, stepRiftballWorld } from "../public/games/riftball/shared/simulation.js";
import { createRiftballPredictionState, stepRiftballPrediction } from "../public/games/riftball/shared/prediction.js";

function createActiveRound() {
  const round = createRiftballRound();
  round.started = true;
  round.phase = "playing";
  Object.assign(round.players.p1, { connected: true, x: 0, z: 0, facing: Math.PI });
  Object.assign(round.players.p2, { connected: true, x: 7, z: -7 });
  Object.assign(round.ball, { x: 0, y: 0.8, z: -1.1 });
  return round;
}

test("local prediction reproduces authority movement and a short strike without sharing state", () => {
  const round = createActiveRound();
  const snapshot = structuredClone(round);
  const prediction = createRiftballPredictionState(snapshot, "p1");
  for (let index = 0; index < 12; index += 1) {
    const input = { ...RIFTBALL_INPUT_TEMPLATE, aimZ: -1, strike: index < 2 };
    stepRiftballPrediction(prediction, input, 1 / 60, { active: true, timeSec: round.timeSec });
    stepRiftballPlayer(round.players.p1, input, 1 / 60, { active: true, timeSec: round.timeSec });
    stepRiftballWorld(round, 1 / 60);
  }
  assert.equal(prediction.actionId, round.players.p1.actionId);
  assert.equal(prediction.x, round.players.p1.x);
  assert.equal(prediction.z, round.players.p1.z);
  assert.equal(prediction.previewBall.hitSerial, 1);
  assert.deepEqual(prediction.previewBall, round.ball);
  assert.deepEqual(snapshot, createActiveRound());
});

test("prediction never awards speculative points and bounds ball and opponent lookahead", () => {
  const round = createActiveRound();
  Object.assign(round.ball, { x: 0, y: 1, z: -17.2, vz: -24 });
  round.players.p2.vx = 4;
  const prediction = createRiftballPredictionState(round, "p1");
  for (let index = 0; index < 40; index += 1) {
    stepRiftballPrediction(prediction, RIFTBALL_INPUT_TEMPLATE, 1 / 60, { active: true, timeSec: 0 });
  }
  const stoppedBall = structuredClone(prediction.previewBall);
  const opponentX = prediction.previewOpponent.x;
  for (let index = 0; index < 120; index += 1) {
    stepRiftballPrediction(prediction, { ...RIFTBALL_INPUT_TEMPLATE, moveX: -1 }, 1 / 60, { active: true, timeSec: 0 });
  }
  assert.equal(prediction.score, 0);
  assert.equal(prediction.seriesWins, 0);
  assert.equal(round.goalSerial, 0);
  assert.deepEqual(prediction.previewBall, stoppedBall);
  assert.equal(prediction.previewOpponent.x, opponentX);
  assert.ok(opponentX <= 7.61);
  assert.ok(prediction.x < -5);
});

test("prediction reset takes new serve/action identities and paused prediction consumes no input", () => {
  const round = createActiveRound();
  const prediction = createRiftballPredictionState(round, "p1");
  const previous = structuredClone(prediction);
  stepRiftballPrediction(prediction, { ...RIFTBALL_INPUT_TEMPLATE, jump: true, strike: true }, 1 / 60, { active: false, timeSec: 0 });
  assert.deepEqual(prediction, previous);

  round.ball.serveId = 3;
  round.players.p1.actionId = 8;
  round.roundId = 2;
  const resetPrediction = createRiftballPredictionState(round, "p1");
  assert.equal(resetPrediction.previewBall.serveId, 3);
  assert.equal(resetPrediction.actionId, 8);
  assert.equal(resetPrediction.predictionRoundId, 2);
  assert.equal(createRiftballPredictionState(round, "missing"), null);
});
