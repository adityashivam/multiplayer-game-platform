import test from "node:test";
import assert from "node:assert/strict";
import { createInputLatch } from "../public/platform/frontend-engine/inputTimeline.js";
import { createPredictedInputSession } from "../public/platform/frontend-engine/predictedInputSession.js";
import { createAuthoritativeInputSession } from "../server/platform-backend-engine/core/authoritativeInputSession.js";
import { serializeRiftballState } from "../server/platform-backend-engine/games/riftball.js";
import {
  RIFTBALL_EDGE_KEYS,
  RIFTBALL_FIXED_DT_SEC,
  RIFTBALL_INPUT_TEMPLATE,
  RIFTBALL_NUMERIC_INPUTS,
} from "../public/games/riftball/shared/config.js";
import { createRiftballRound, stepRiftballPlayer, stepRiftballWorld } from "../public/games/riftball/shared/simulation.js";
import { createRiftballPredictionState, stepRiftballPrediction } from "../public/games/riftball/shared/prediction.js";

test("Riftball legal movement and short actions survive 50/150 ms delivery and ordered bursts", () => {
  const round = createRiftballRound();
  Object.assign(round, { started: true, phase: "playing" });
  round.players.p1.connected = true;
  round.players.p2.connected = true;
  const serverInput = createAuthoritativeInputSession({
    inputTemplate: RIFTBALL_INPUT_TEMPLATE, numericInputs: RIFTBALL_NUMERIC_INPUTS,
    edgeKeys: RIFTBALL_EDGE_KEYS, fixedDtSec: RIFTBALL_FIXED_DT_SEC,
  });
  for (const player of Object.values(round.players)) serverInput.resetPlayer(player);
  const inputLatch = createInputLatch(RIFTBALL_INPUT_TEMPLATE, {
    numericInputs: RIFTBALL_NUMERIC_INPUTS, edgeKeys: RIFTBALL_EDGE_KEYS,
  });
  const commands = [];
  const snapshots = [];
  const actionsStarted = { strike: false, dash: false, jump: false, feint: false };
  let tick = 0;
  let lastDeliveryTick = 0;
  let latestAuthority = serializeRiftballState(round);
  let oldAuthority;
  let maximumPending = 0;
  let maximumQueue = 0;
  let maximumBurst = 0;
  let maximumReplay = 0;
  let totalReplayed = 0;
  let maximumHitSerial = 0;
  let ballPreviewMoved = false;
  const clientInput = createPredictedInputSession({
    fixedDtSec: RIFTBALL_FIXED_DT_SEC,
    maxPendingFrames: 32,
    maxReplayFrames: 32,
    captureInput: () => inputLatch.capture(),
    sendInput(inputPacket) {
      let deliveryTick = tick + 3;
      if (tick >= 44 && tick <= 50) deliveryTick = 59;
      if (tick >= 150 && tick <= 157) deliveryTick = 168;
      deliveryTick = Math.max(lastDeliveryTick, deliveryTick);
      lastDeliveryTick = deliveryTick;
      commands.push({ deliveryTick, inputPacket });
    },
    simulate: stepRiftballPrediction,
    extractPose: (player) => ({ x: player.x, y: player.y, z: player.z }),
  });

  function receiveAuthority(snapshot) {
    const retainedSnapshot = structuredClone(snapshot);
    const context = Object.freeze({
      active: snapshot.started && !snapshot.gameOver && (snapshot.phase === "playing" || snapshot.phase === "overtime"),
      timeSec: snapshot.timeSec,
      simulationTick: snapshot.players.p1.inputSimulationTick,
    });
    const accepted = clientInput.receiveAuthority({
      state: createRiftballPredictionState(snapshot, "p1"),
      protocol: 2,
      inputEpoch: snapshot.players.p1.inputEpoch,
      acknowledgedSequence: snapshot.players.p1.inputSeqAck,
      context,
    });
    assert.deepEqual(snapshot, retainedSnapshot, "replaying local contacts cannot mutate retained authority");
    if (accepted) latestAuthority = snapshot;
    return accepted;
  }
  receiveAuthority(latestAuthority);

  for (tick = 1; tick <= 330; tick += 1) {
    while (snapshots.length && snapshots[0].deliveryTick <= tick) receiveAuthority(snapshots.shift().snapshot);
    if (tick <= 300) {
      const input = { ...RIFTBALL_INPUT_TEMPLATE, aimZ: -1 };
      if (tick <= 50) input.moveZ = -1;
      if (tick >= 44 && tick <= 47) input.strike = true;
      if (tick >= 90 && tick <= 120) input.moveX = 0.65;
      if (tick >= 190 && tick <= 210) input.strike = true;
      for (const key of Object.keys(RIFTBALL_INPUT_TEMPLATE)) inputLatch.set(key, input[key]);
      for (const [action, actionTick] of [["dash", 90], ["jump", 155], ["feint", 198]]) {
        if (tick === actionTick) {
          inputLatch.set(action, true);
          inputLatch.set(action, false);
        }
      }
      clientInput.captureAndPredict();
    }
    let deliveredThisTick = 0;
    while (commands.length && commands[0].deliveryTick <= tick) {
      const command = commands.shift().inputPacket;
      assert.equal(serverInput.receiveInput(round.players.p1, command, tick * 1000 / 60), true);
      maximumQueue = Math.max(maximumQueue, round.players.p1.__inputBuffer.queue.length);
      deliveredThisTick += 1;
    }
    maximumBurst = Math.max(maximumBurst, deliveredThisTick);
    if (tick === 304) round.started = false;
    round.__loopTick = tick;
    round.__loopMonotonicNow = tick * 1000 / 60;
    serverInput.simulateRoom({
      state: round,
      dtSec: RIFTBALL_FIXED_DT_SEC,
      simulate(player, input, stepSec) {
        const previousActionId = player.actionId;
        stepRiftballPlayer(player, input, stepSec, { active: round.started && round.phase !== "goal", timeSec: round.timeSec });
        if (player.id === "p1" && player.actionId !== previousActionId && Object.hasOwn(actionsStarted, player.action)) {
          actionsStarted[player.action] = true;
        }
      },
    });
    stepRiftballWorld(round, RIFTBALL_FIXED_DT_SEC);
    maximumHitSerial = Math.max(maximumHitSerial, round.ball.hitSerial);
    const snapshot = serializeRiftballState(round);
    snapshots.push({ deliveryTick: tick + 9, snapshot });
    if (tick === 40) oldAuthority = snapshot;
    const prediction = clientInput.getState();
    if (prediction.previewBall.hitSerial > 0 && Math.abs(prediction.previewBall.z) > 0.1) ballPreviewMoved = true;
    assert.equal(prediction.score, latestAuthority.players.p1.score, "a predicted goal cannot award a point");
    const stats = clientInput.getStats();
    maximumPending = Math.max(maximumPending, stats.pendingCommands);
    maximumReplay = Math.max(maximumReplay, stats.lastReplayCount);
    totalReplayed = stats.replayedCommands;
  }

  assert.ok(maximumBurst >= 8);
  assert.ok(maximumPending >= 12 && maximumPending <= 32);
  assert.ok(maximumQueue <= 16);
  assert.ok(maximumReplay <= 32 && totalReplayed > 100);
  assert.deepEqual(actionsStarted, { strike: true, dash: true, jump: true, feint: true });
  assert.ok(maximumHitSerial >= 1, "the first legal strike reaches the ball from ordinary spawn movement");
  assert.ok(ballPreviewMoved);
  assert.equal(round.players.p1.inputEpoch, 1);
  assert.equal(clientInput.getStats().pendingCommands, 0);
  assert.equal(commands.length, 0);
  assert.equal(round.players.p1.__inputBuffer.queue.length, 0);
  const prediction = clientInput.getState();
  for (const field of ["x", "y", "z", "vx", "vy", "vz", "actionId", "chargeSec", "strikeHeld", "stamina", "score"]) {
    assert.equal(prediction[field], round.players.p1[field], `${field} converges after the paused room drains`);
  }
  assert.deepEqual(prediction.previewBall, round.ball);
  assert.equal(prediction.predictionTimeSec, round.timeSec);
  const settled = structuredClone(prediction);
  assert.equal(receiveAuthority(oldAuthority), false);
  assert.deepEqual(clientInput.getState(), settled);
});
