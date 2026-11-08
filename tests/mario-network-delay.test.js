import test from "node:test";
import assert from "node:assert/strict";
import { createInputLatch } from "../public/platform/frontend-engine/inputTimeline.js";
import { createWorkerInterpolator } from "../public/platform/frontend-engine/interpolationWorker.js";
import { INPUT_LIMITS } from "../public/platform/shared/networkProtocol.js";
import { serializeMarioState } from "../server/platform-backend-engine/games/mario.js";
import { MARIO_EDGE_KEYS, MARIO_INPUT_TEMPLATE } from "../public/games/mario/shared/config.js";
import { createMarioTestSession } from "./mario-test-helpers.js";

import * as marioNetworking from "../public/games/mario/networking.js";

/** Simulate an ordered Socket.IO link with variable one-way delay and bursts. */
function simulateDelayedMarioSession(gameId, roundTripMs) {
  const serverSession = createMarioTestSession(gameId);
  const firstClient = serverSession.connectPlayer();
  serverSession.connectPlayer();
  const state = serverSession.getState();
  state.started = true;
  state.startAt = null;
  state.enemies.length = 0;
  const inputLatch = createInputLatch(MARIO_INPUT_TEMPLATE, { edgeKeys: MARIO_EDGE_KEYS });
  const handlers = new Map();
  const commandPackets = [];
  const snapshotPackets = [];
  const oneWayDelayTicks = Math.ceil(roundTripMs / 2 / (1000 / 60));
  let currentTick = 0;
  let previousCommandDeliveryTick = 0;
  let previousSnapshotDeliveryTick = 0;
  let shortJumpSequence = 0;
  let maximumServerQueue = 0;
  let maximumPendingCommands = 0;
  let maximumBurst = 0;
  let maximumJumpHeight = 0;
  let previousMovingX = null;
  const settledIdlePositions = [];
  let latestRenderState = null;
  const socket = {
    onEvent(eventName, callback) {
      if (!handlers.has(eventName)) handlers.set(eventName, new Set());
      handlers.get(eventName).add(callback);
      return () => handlers.get(eventName).delete(callback);
    },
    send(eventName, inputPacket) {
      assert.equal(eventName, "input");
      let deliveryTick = currentTick + oneWayDelayTicks + (currentTick % 4 === 0 ? 2 : 0);
      if (currentTick >= 35 && currentTick <= 44) deliveryTick = 46 + oneWayDelayTicks;
      if (currentTick >= 135 && currentTick <= 143) deliveryTick = 146 + oneWayDelayTicks;
      deliveryTick = Math.max(previousCommandDeliveryTick, deliveryTick);
      previousCommandDeliveryTick = deliveryTick;
      commandPackets.push({ deliveryTick, inputPacket });
      if (inputPacket.state.jump) shortJumpSequence = inputPacket.seq;
    },
    isConnected: () => true,
    getConnectionSnapshot: () => ({ ping: roundTripMs, pingP95Ms: roundTripMs + 35, jitterP95Ms: 35 }),
  };
  const interpolator = createWorkerInterpolator(marioNetworking.createMarioInterpolationOptions());
  const clientSession = marioNetworking.createMarioNetworkSession({
    socket,
    interpolator,
    captureInput: () => inputLatch.capture(),
    getPlayerId: () => "p1",
    canCaptureInput: () => currentTick <= 300,
  });
  const receiveSnapshot = (snapshot) => {
    const retainedSnapshot = structuredClone(snapshot);
    handlers.get("state").forEach((subscriber) => subscriber(snapshot));
    assert.deepEqual(snapshot, retainedSnapshot, "replay cannot mutate retained authority");
  };
  receiveSnapshot(serializeMarioState(state));

  const finalTick = 300 + oneWayDelayTicks * 2 + 8;
  for (currentTick = 1; currentTick <= finalTick; currentTick += 1) {
    while (snapshotPackets.length && snapshotPackets[0].deliveryTick <= currentTick) {
      receiveSnapshot(snapshotPackets.shift().snapshot);
    }
    inputLatch.set("right", currentTick >= 10 && currentTick <= 85);
    inputLatch.set("run", currentTick >= 20 && currentTick <= 50);
    if (currentTick === 43) {
      // A complete 5 ms press fits between two 16.67 ms command captures.
      inputLatch.set("jump", true);
      inputLatch.set("jump", false);
    }
    clientSession.captureAndPredict();
    for (const interpolationAlpha of [0, 0.5]) {
      latestRenderState = clientSession.samplePose({
        nowMs: (currentTick + interpolationAlpha) * 1000 / 60,
        deltaSec: 1 / 120,
        captureInput: false,
        interpolationAlpha,
      });
      const renderPlayer = latestRenderState.players.p1;
      maximumJumpHeight = Math.max(maximumJumpHeight, 192 - renderPlayer.y);
      if (currentTick >= 25 && currentTick <= 80) {
        if (previousMovingX !== null) {
          assert.ok(renderPlayer.x >= previousMovingX - 1e-8,
            `${roundTripMs} ms moving player went backwards at tick ${currentTick}: ${renderPlayer.x} < ${previousMovingX}`);
        }
        previousMovingX = renderPlayer.x;
      }
      if (currentTick >= 250 && currentTick <= 300) settledIdlePositions.push(renderPlayer.x);
      assert.equal(renderPlayer.finished, false, "local commands never predict the finish result");
    }

    let deliveredThisTick = 0;
    while (commandPackets.length && commandPackets[0].deliveryTick <= currentTick) {
      firstClient.socketHandlers.input(commandPackets.shift().inputPacket);
      state.players.p1.__lastInputReceiptMs = currentTick * 1000 / 60;
      maximumServerQueue = Math.max(maximumServerQueue, state.players.p1.__inputBuffer.queue.length);
      deliveredThisTick += 1;
    }
    maximumBurst = Math.max(maximumBurst, deliveredThisTick);
    serverSession.advanceSimulation(currentTick * 1000 / 60);
    if (currentTick % 2 === 0) {
      const snapshot = serializeMarioState(state);
      const deliveryTick = Math.max(previousSnapshotDeliveryTick,
        currentTick + oneWayDelayTicks + (currentTick % 6 === 0 ? 2 : 0));
      previousSnapshotDeliveryTick = deliveryTick;
      snapshotPackets.push({ deliveryTick, snapshot });
    }
    maximumPendingCommands = Math.max(maximumPendingCommands, clientSession.getStats().prediction.pendingCommands);
  }

  assert.ok(maximumJumpHeight > 35, "short action must reach prediction during the delivery burst");
  assert.ok(maximumBurst >= 10, "exercise ordered coalesced delivery");
  assert.ok(maximumServerQueue <= INPUT_LIMITS.MAX_QUEUED_FRAMES);
  assert.ok(maximumServerQueue <= 18, "burst queues drain promptly");
  assert.ok(maximumPendingCommands >= oneWayDelayTicks, "exercise delayed command replay");
  assert.ok(maximumPendingCommands <= INPUT_LIMITS.MAX_PENDING_FRAMES);
  assert.ok(Math.max(...settledIdlePositions) - Math.min(...settledIdlePositions) < 0.00001,
    "settled idle positions cannot vibrate on snapshot receipt");
  assert.ok(shortJumpSequence > 0);
  assert.ok(state.players.p1.lastInputSeqAck >= shortJumpSequence);
  assert.equal(state.players.p1.inputEpoch, 1, "ordinary high latency must not lose ownership");
  assert.equal(commandPackets.length, 0);
  assert.equal(state.players.p1.__inputBuffer.queue.length, 0);
  assert.equal(clientSession.getStats().prediction.pendingCommands, 0);
  assert.equal(clientSession.getStats().prediction.hardSnaps, 0);
  for (const field of ["x", "y", "vx", "vy"]) {
    assert.ok(Math.abs(latestRenderState.players.p1[field] - state.players.p1[field]) < 0.00001,
      `${field} must converge after released input and delayed snapshots drain`);
  }
  clientSession.destroy();
}

for (const gameId of ["mario", "mario-touch"]) {
  for (const roundTripMs of [150, 300, 500]) {
    test(`${gameId} stays smooth and converges through ${roundTripMs} ms RTT, jitter and ordered bursts`, () => {
      simulateDelayedMarioSession(gameId, roundTripMs);
    });
  }
}
