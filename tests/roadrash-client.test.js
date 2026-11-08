import test from "node:test";
import assert from "node:assert/strict";
import { createInputLatch } from "../public/platform/frontend-engine/inputTimeline.js";
import { createWorkerInterpolator } from "../public/platform/frontend-engine/interpolationWorker.js";
import { createModularRuntime } from "../public/platform/frontend-engine/modularRuntime.js";
import {
  ROAD_RASH_EDGE_INPUT_KEYS,
  ROAD_RASH_FIXED_DT_SEC,
  ROAD_RASH_INPUT_TEMPLATE,
} from "../public/games/roadrash/shared/simulation.js";
import {
  buildRoadRashRenderState,
  createRoadRashNetworkSession,
  extractRoadRashContinuityKeys,
  extractRoadRashPositions,
  extractRoadRashVelocities,
} from "../public/games/roadrash/client/networkSession.js";

function createRoadRashSnapshot() {
  const createRider = (x) => ({
    x, z: 119900, progress: 119900, lapsCompleted: 0, speed: 12000,
    integrity: 100, connected: true, finished: false, rank: 1,
    kickSide: 0, kickActive: false,
    inputEpoch: 1, inputSeqAck: 0, inputSimulationTick: 0,
  });
  return {
    roundId: 1, inputProtocol: 2,
    players: { p1: createRider(-0.28), p2: createRider(0.28) },
    trackLength: 120000, lapsRequired: 10,
    traffic: [{ id: "t0", type: "car", variant: 0, x: 0.8, z: 119950, progress: 119950, speed: 9000 }],
    started: true, startAt: null, gameOver: false, winner: null,
  };
}

function createSessionTransport() {
  const listeners = new Map();
  const sentCommands = [];
  return {
    sentCommands,
    onEvent(eventName, listener) {
      if (!listeners.has(eventName)) listeners.set(eventName, new Set());
      listeners.get(eventName).add(listener);
      return () => listeners.get(eventName)?.delete(listener);
    },
    send(eventName, inputPacket) {
      assert.equal(eventName, "input");
      sentCommands.push(inputPacket);
    },
    emitEvent(eventName, payload) {
      for (const listener of listeners.get(eventName) || []) listener(payload);
    },
    isConnected: () => true,
    getConnectionSnapshot: () => ({ ping: 300, pingP95Ms: 340, jitterP95Ms: 30, packetLossPct: 0 }),
  };
}

test("Road Rash render poses cross track boundaries in unwrapped distance without mutating authority", () => {
  const snapshot = createRoadRashSnapshot();
  const beforeRender = structuredClone(snapshot);
  const pose = extractRoadRashPositions(snapshot);
  pose.p1progress = 120100;
  pose.p2progress = 240200;
  pose.t0progress = 120050;
  pose.p1x = -0.1;
  const renderState = buildRoadRashRenderState(snapshot, pose);
  assert.equal(renderState.players.p1.z, 100);
  assert.equal(renderState.players.p1.lapsCompleted, 1);
  assert.equal(renderState.players.p1.progress, 120100);
  assert.equal(renderState.players.p2.z, 200);
  assert.equal(renderState.players.p2.lapsCompleted, 2);
  assert.equal(renderState.traffic[0].z, 50);
  assert.equal(renderState.players.p1.x, -0.1);
  assert.deepEqual(snapshot, beforeRender);
  assert.equal(extractRoadRashVelocities(snapshot).p1progress, 12000);
  assert.equal(extractRoadRashVelocities(snapshot).t0progress, 9000);
  assert.equal(extractRoadRashContinuityKeys(snapshot).p1progress, 1);
  snapshot.started = false;
  assert.equal(extractRoadRashVelocities(snapshot).p1progress, 0);
});

test("Road Rash new-race rendering rejects buffered positions from the previous round", () => {
  const previousRace = createRoadRashSnapshot();
  const nextRace = createRoadRashSnapshot();
  nextRace.roundId = 2;
  for (const rider of Object.values(nextRace.players)) {
    Object.assign(rider, { progress: 0, z: 0, speed: 0, lapsCompleted: 0 });
  }
  nextRace.traffic[0].progress = 6000;
  nextRace.traffic[0].z = 6000;
  const renderState = buildRoadRashRenderState(nextRace, extractRoadRashPositions(previousRace));
  assert.equal(renderState.players.p2.progress, 0);
  assert.equal(renderState.traffic[0].z, 6000);
});

test("Road Rash an automatic round reset replaces remote old-lap playback during countdown", () => {
  const socket = createSessionTransport();
  const inputLatch = createInputLatch(ROAD_RASH_INPUT_TEMPLATE, { edgeKeys: ROAD_RASH_EDGE_INPUT_KEYS });
  let arrivalAtMs = 0;
  const interpolationEngine = createWorkerInterpolator({
    extractPositions: extractRoadRashPositions,
    extractContinuityKeys: extractRoadRashContinuityKeys,
    adaptive: false,
    interpDelayMs: 0,
  });
  const interpolator = {
    ...interpolationEngine,
    pushState: (snapshot) => interpolationEngine.pushState(snapshot, { timestampMs: arrivalAtMs }),
  };
  const session = createRoadRashNetworkSession({ socket, interpolator, inputLatch, getPlayerId: () => "p1" });
  socket.emitEvent("state", createRoadRashSnapshot());
  arrivalAtMs = 100;
  socket.emitEvent("state", createRoadRashSnapshot());
  const nextRace = createRoadRashSnapshot();
  nextRace.roundId = 2;
  nextRace.started = false;
  for (const rider of Object.values(nextRace.players)) {
    Object.assign(rider, { inputEpoch: 2, progress: 0, z: 0, speed: 0, lapsCompleted: 0 });
  }
  arrivalAtMs = 200;
  socket.emitEvent("state", nextRace);
  const renderPose = session.samplePose({ nowMs: 50, captureInput: false });
  assert.equal(renderPose.p2progress, 0);
  assert.equal(renderPose.roundId, 2);
  session.destroy();
  interpolationEngine.destroy();
});

for (const renderFps of [30, 60, 144]) {
  test(`Road Rash ${renderFps} FPS rendering sends fixed 60 Hz commands and latches a short kick`, () => {
    const socket = createSessionTransport();
    const inputLatch = createInputLatch(ROAD_RASH_INPUT_TEMPLATE, { edgeKeys: ROAD_RASH_EDGE_INPUT_KEYS });
    const interpolator = createWorkerInterpolator({
      extractPositions: extractRoadRashPositions,
      extractVelocities: extractRoadRashVelocities,
      extractContinuityKeys: extractRoadRashContinuityKeys,
    });
    const session = createRoadRashNetworkSession({ socket, interpolator, inputLatch, getPlayerId: () => "p1" });
    socket.emitEvent("state", createRoadRashSnapshot());
    inputLatch.set("throttle", true);
    inputLatch.set("kickRight", true);
    inputLatch.set("kickRight", false);
    let renderSamples = 0;
    const runtime = createModularRuntime({ fixedDtSec: ROAD_RASH_FIXED_DT_SEC, targetRenderFps: null });
    runtime.addSystem({
      onFixedUpdate: () => session.captureAndPredict(),
      onLateUpdate: ({ nowMs, frameDtSec }) => {
        const pose = session.samplePose({ nowMs, deltaSec: frameDtSec, captureInput: false });
        assert.ok(Number.isFinite(pose.p1progress));
        renderSamples += 1;
      },
    });
    for (let frame = 0; frame <= renderFps; frame += 1) runtime.step({ nowMs: frame * 1000 / renderFps });
    assert.ok(Math.abs(socket.sentCommands.length - 60) <= 1, "render cadence cannot change command cadence");
    assert.ok(renderSamples >= renderFps);
    assert.equal(socket.sentCommands.filter((command) => command.state.kickRight).length, 1);
    assert.ok(socket.sentCommands.every((command) => command.protocol === 2 && command.epoch === 1));
    assert.ok(session.getStats().prediction.pendingCommands <= 240);
    session.destroy();
    interpolator.destroy();
    runtime.destroy();
  });
}

test("Road Rash ownership resets drop held controls and stale lap render offsets", () => {
  const socket = createSessionTransport();
  const inputLatch = createInputLatch(ROAD_RASH_INPUT_TEMPLATE, { edgeKeys: ROAD_RASH_EDGE_INPUT_KEYS });
  const interpolator = createWorkerInterpolator({ extractPositions: extractRoadRashPositions });
  const session = createRoadRashNetworkSession({ socket, interpolator, inputLatch, getPlayerId: () => "p1" });
  const snapshot = createRoadRashSnapshot();
  socket.emitEvent("state", snapshot);
  inputLatch.set("throttle", true);
  session.captureAndPredict();
  assert.ok(session.samplePose({ nowMs: 0, captureInput: false }).p1progress > 120000);
  socket.emitEvent("playerLeft", { playerId: "p2" });
  assert.equal(session.getLatestSnapshot(), null);
  snapshot.players.p1.inputEpoch = 2;
  snapshot.started = false;
  socket.emitEvent("state", snapshot);
  session.captureAndPredict();
  assert.equal(socket.sentCommands.at(-1).state.throttle, false);
  assert.equal(socket.sentCommands.at(-1).epoch, 2);
  assert.equal(session.samplePose({ nowMs: 1, captureInput: false }).p1progress, 119900);
  socket.emitEvent("rematchStarted");
  const rematch = createRoadRashSnapshot();
  rematch.roundId = 2;
  for (const rider of Object.values(rematch.players)) {
    Object.assign(rider, { inputEpoch: 3, progress: 0, z: 0, speed: 0, lapsCompleted: 0 });
  }
  socket.emitEvent("state", rematch);
  assert.equal(session.samplePose({ nowMs: 2, captureInput: false }).p1progress, 0);
  assert.equal(session.getStats().prediction.pendingCommands, 0);
  session.destroy();
  interpolator.destroy();
});

test("Road Rash starvation ownership changes clear latched controls while retaining fresh authority", () => {
  const socket = createSessionTransport();
  const inputLatch = createInputLatch(ROAD_RASH_INPUT_TEMPLATE, { edgeKeys: ROAD_RASH_EDGE_INPUT_KEYS });
  const interpolator = createWorkerInterpolator({ extractPositions: extractRoadRashPositions });
  const session = createRoadRashNetworkSession({ socket, interpolator, inputLatch, getPlayerId: () => "p1" });
  socket.emitEvent("state", createRoadRashSnapshot());
  inputLatch.set("throttle", true);
  inputLatch.set("left", true);
  inputLatch.set("kickLeft", true);
  inputLatch.set("kickLeft", false);
  session.captureAndPredict();

  const recoveredSnapshot = createRoadRashSnapshot();
  Object.assign(recoveredSnapshot.players.p1, { inputEpoch: 2, progress: 120500, z: 500, lapsCompleted: 1 });
  socket.emitEvent("state", recoveredSnapshot);
  assert.equal(session.getLatestSnapshot(), recoveredSnapshot);
  session.captureAndPredict();
  assert.deepEqual(socket.sentCommands.at(-1).state, ROAD_RASH_INPUT_TEMPLATE);
  assert.equal(socket.sentCommands.at(-1).epoch, 2);
  assert.equal(socket.sentCommands.at(-1).seq, 1);
  session.destroy();
  interpolator.destroy();
});
