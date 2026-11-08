import test from "node:test";
import assert from "node:assert/strict";
import { createInputLatch } from "../public/platform/frontend-engine/inputTimeline.js";
import { createWorkerInterpolator } from "../public/platform/frontend-engine/interpolationWorker.js";
import { registerRoadRashGame, serializeRoadRashState } from "../server/platform-backend-engine/games/roadrash.js";
import { getGamesStore } from "../server/platform-backend-engine/core/gameStore.js";
import { INPUT_LIMITS } from "../public/platform/shared/networkProtocol.js";
import {
  ROAD_RASH_EDGE_INPUT_KEYS,
  ROAD_RASH_FIXED_DT_SEC,
  ROAD_RASH_INPUT_TEMPLATE,
  stepRoadRashRider,
} from "../public/games/roadrash/shared/simulation.js";
import {
  buildRoadRashRenderState,
  createRoadRashNetworkSession,
  extractRoadRashContinuityKeys,
  extractRoadRashPositions,
  extractRoadRashVelocities,
} from "../public/games/roadrash/client/networkSession.js";

/** Use the actual registered server's handlers and systems on a controlled clock. */
function createDelayedRaceAuthority() {
  let connectSocket;
  const namespace = {
    adapter: { rooms: new Map() },
    sockets: new Map(),
    on: (_eventName, callback) => { connectSocket = callback; },
    to: () => ({ emit() {} }),
  };
  const originalSetTimeout = globalThis.setTimeout;
  let simulation;
  globalThis.setTimeout = () => 0;
  try {
    simulation = registerRoadRashGame({ of: () => namespace });
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
  const clients = [];
  for (let index = 0; index < 2; index += 1) {
    const socketHandlers = {};
    const socket = {
      id: `rider-${index}`, data: {}, nsp: namespace,
      on: (eventName, callback) => { socketHandlers[eventName] = callback; },
      join: (roomId) => {
        if (!namespace.adapter.rooms.has(roomId)) namespace.adapter.rooms.set(roomId, new Set());
        namespace.adapter.rooms.get(roomId).add(socket.id);
      },
      leave: (roomId) => namespace.adapter.rooms.get(roomId)?.delete(socket.id),
      emit() {}, to: () => ({ emit() {} }),
    };
    namespace.sockets.set(socket.id, socket);
    connectSocket(socket);
    socketHandlers.joinGame({ gameId: "room" });
    clients.push({ socket, socketHandlers });
  }
  const state = getGamesStore(namespace).get("room");
  state.started = true;
  state.startAt = null;
  state.traffic = [];
  for (const rider of Object.values(state.players)) {
    Object.assign(rider, { z: 119000, progress: 119000, lapsCompleted: 0 });
  }
  state.players.p2.progress += 20000;
  state.players.p2.z = 19000;
  state.players.p2.lapsCompleted = 1;
  return { state, simulation, clients };
}

/**
 * Capture through the real browser adapter and deliver ordered Socket.IO-style
 * streams with jitter and burst stalls. Server collisions are enabled only for
 * the dedicated correction scenario. A final paused race drains both streams.
 * @param {{rttMs: number, jitter?: boolean, collision?: boolean}} options
 */
function simulateDelayedRoadRashRace({ rttMs, jitter = true, collision = false }) {
  const { state, simulation, clients } = createDelayedRaceAuthority();
  const fixedDtMs = ROAD_RASH_FIXED_DT_SEC * 1000;
  const oneWayTicks = Math.max(1, Math.round(rttMs / 2 / fixedDtMs));
  const captureTicks = 480;
  const settlingTicks = oneWayTicks * 2 + 15;
  const inputLatch = createInputLatch(ROAD_RASH_INPUT_TEMPLATE, { edgeKeys: ROAD_RASH_EDGE_INPUT_KEYS });
  const listeners = new Map();
  const commandPackets = [];
  const snapshotPackets = [];
  let currentTick = 0;
  let previousCommandDeliveryTick = 0;
  let previousSnapshotDeliveryTick = 0;
  let maxServerQueue = 0;
  let maxPendingCommands = 0;
  let maxDeliveryBurst = 0;
  let shortKickSequence = 0;
  let firstServerKickTick = null;
  let serverKickCount = 0;
  let firstVisibleDamageTick = null;
  let maxCorrectionDistance = 0;
  let largestBackwardProgress = 0;
  let largestBackwardSample = null;
  let largestForwardMotionRewind = 0;
  let previousVisibleProgress = state.players.p1.progress;
  let maxIdleLaneDelta = 0;
  let maxSettledProgressDelta = 0;
  let previousSettledProgress = null;
  let previousIdleX = null;
  let parityChecks = 0;
  let crossedTrackBoundary = false;
  let latestSnapshot = serializeRoadRashState(state);

  function queueDeliveryTick(direction, baseDelayTicks) {
    const patternOffset = jitter ? [0, 2, -1, 3, 0, -2][currentTick % 6] : 0;
    let deliveryTick = currentTick + Math.max(1, baseDelayTicks + patternOffset);
    if (jitter && currentTick >= 34 && currentTick <= 43) deliveryTick += 10;
    if (jitter && currentTick >= 182 && currentTick <= 193) deliveryTick += 11;
    if (direction === "command") {
      deliveryTick = Math.max(previousCommandDeliveryTick, deliveryTick);
      previousCommandDeliveryTick = deliveryTick;
    } else {
      deliveryTick = Math.max(previousSnapshotDeliveryTick, deliveryTick);
      previousSnapshotDeliveryTick = deliveryTick;
    }
    return deliveryTick;
  }

  const socket = {
    onEvent(eventName, listener) {
      if (!listeners.has(eventName)) listeners.set(eventName, new Set());
      listeners.get(eventName).add(listener);
      return () => listeners.get(eventName)?.delete(listener);
    },
    send(eventName, inputPacket) {
      assert.equal(eventName, "input");
      commandPackets.push({ deliveryTick: queueDeliveryTick("command", oneWayTicks), inputPacket });
      if (inputPacket.state.kickRight) shortKickSequence = inputPacket.seq;
    },
    isConnected: () => true,
    getConnectionSnapshot: () => ({ ping: rttMs, pingP95Ms: rttMs + 70, jitterP95Ms: jitter ? 45 : 0, packetLossPct: 0 }),
  };
  const interpolationEngine = createWorkerInterpolator({
    extractPositions: extractRoadRashPositions,
    extractVelocities: extractRoadRashVelocities,
    extractContinuityKeys: extractRoadRashContinuityKeys,
    interpDelayMs: 42,
    maxBufferSize: 24,
  });
  const interpolator = {
    ...interpolationEngine,
    pushState: (snapshot) => interpolationEngine.pushState(snapshot, { timestampMs: currentTick * fixedDtMs }),
  };
  const session = createRoadRashNetworkSession({ socket, interpolator, inputLatch, getPlayerId: () => "p1" });

  function receiveSnapshot(snapshot) {
    const beforeReplay = structuredClone(snapshot);
    for (const listener of listeners.get("state") || []) listener(snapshot);
    assert.deepEqual(snapshot, beforeReplay, "reconciliation cannot mutate retained authoritative snapshots");
    latestSnapshot = snapshot;
  }
  receiveSnapshot(latestSnapshot);

  for (currentTick = 1; currentTick <= captureTicks + settlingTicks; currentTick += 1) {
    while (snapshotPackets.length && snapshotPackets[0].deliveryTick <= currentTick) {
      receiveSnapshot(snapshotPackets.shift().snapshot);
    }
    if (currentTick <= captureTicks) {
      inputLatch.set("throttle", currentTick <= 280);
      inputLatch.set("right", currentTick >= 28 && currentTick <= 43);
      inputLatch.set("left", currentTick >= 95 && currentTick <= 110);
      inputLatch.set("brake", currentTick >= 281 && currentTick <= 350);
      if (currentTick === 38) {
        inputLatch.set("kickRight", true);
        inputLatch.set("kickRight", false);
      }
      session.captureAndPredict();
    } else {
      state.started = false;
    }

    let deliveredCommands = 0;
    while (commandPackets.length && commandPackets[0].deliveryTick <= currentTick) {
      const { inputPacket } = commandPackets.shift();
      clients[0].socketHandlers.input(inputPacket);
      state.players.p1.__lastInputReceiptMs = currentTick * fixedDtMs;
      deliveredCommands += 1;
      maxServerQueue = Math.max(maxServerQueue, state.players.p1.__inputBuffer.queue.length);
    }
    maxDeliveryBurst = Math.max(maxDeliveryBurst, deliveredCommands);

    if (collision && currentTick === 160) {
      state.traffic = [{
        id: "t0", type: "car", variant: 0,
        x: state.players.p1.x, z: state.players.p1.z + 400,
        progress: state.players.p1.progress + 400, speed: 0, phase: 0,
      }];
    }
    if (collision && currentTick === 161) state.traffic = [];
    const beforeStep = structuredClone(state.players.p1);
    const heldInput = state.players.p1.__inputBuffer?.queue.at(-1)?.state || state.players.p1.input;
    const parityPlayer = structuredClone(beforeStep);
    if (!state.players.p1.__inputBuffer?.queue.length) {
      stepRoadRashRider(parityPlayer, heldInput, ROAD_RASH_FIXED_DT_SEC, { active: state.started });
    }
    state.__loopTick = currentTick;
    state.__loopMonotonicNow = currentTick * fixedDtMs;
    simulation.step(state, ROAD_RASH_FIXED_DT_SEC, { nowMs: 100000 + currentTick * fixedDtMs });
    if (state.players.p1.kickTimer > 0 && beforeStep.kickTimer <= 0) serverKickCount += 1;
    if (!collision && !beforeStep.__inputBuffer?.queue.length) {
      for (const coordinate of ["x", "speed", "progress", "z", "lapsCompleted"]) {
        assert.equal(state.players.p1[coordinate], parityPlayer[coordinate], `${coordinate} must use the same browser/server movement rule`);
      }
      parityChecks += 1;
    }
    if (state.players.p1.kickTimer > 0 && firstServerKickTick === null) firstServerKickTick = currentTick;
    if (state.players.p1.lapsCompleted > 0) crossedTrackBoundary = true;
    const snapshot = serializeRoadRashState(state);
    snapshot.net = { seq: currentTick, serverTime: 100000 + currentTick * fixedDtMs, simTick: currentTick, tickRate: 60 };
    snapshotPackets.push({ deliveryTick: queueDeliveryTick("snapshot", oneWayTicks), snapshot });

    // Exercise twice the command cadence, including SDK fixed-pose interpolation.
    for (const alpha of [0.5, 1]) {
      const pose = session.samplePose({
        nowMs: (currentTick - 1 + alpha) * fixedDtMs,
        deltaSec: ROAD_RASH_FIXED_DT_SEC / 2,
        interpolationAlpha: alpha,
        captureInput: false,
      });
      const renderState = buildRoadRashRenderState(session.getLatestSnapshot(), pose);
      const visibleRider = renderState.players.p1;
      if (currentTick <= 280) {
        largestForwardMotionRewind = Math.max(largestForwardMotionRewind, previousVisibleProgress - visibleRider.progress);
      }
      if (previousVisibleProgress - visibleRider.progress > largestBackwardProgress) {
        largestBackwardProgress = previousVisibleProgress - visibleRider.progress;
        largestBackwardSample = {
          currentTick, alpha, previousVisibleProgress, visibleProgress: visibleRider.progress,
          visibleSpeed: visibleRider.speed, serverProgress: state.players.p1.progress,
          authorityProgress: latestSnapshot.players.p1.progress,
          authoritySpeed: latestSnapshot.players.p1.speed,
          authorityTick: latestSnapshot.players.p1.inputSimulationTick,
          authorityAck: latestSnapshot.players.p1.inputSeqAck,
        };
      }
      previousVisibleProgress = visibleRider.progress;
      if (currentTick >= 420) {
        if (previousIdleX !== null) maxIdleLaneDelta = Math.max(maxIdleLaneDelta, Math.abs(visibleRider.x - previousIdleX));
        previousIdleX = visibleRider.x;
      }
      if (currentTick >= 460) {
        if (previousSettledProgress !== null) {
          maxSettledProgressDelta = Math.max(maxSettledProgressDelta, Math.abs(visibleRider.progress - previousSettledProgress));
        }
        previousSettledProgress = visibleRider.progress;
      }
      if (visibleRider.integrity < 100 && firstVisibleDamageTick === null) firstVisibleDamageTick = currentTick;
      assert.equal(visibleRider.integrity, latestSnapshot.players.p1.integrity,
        "prediction may never invent authoritative collision damage");
    }
    const predictionStats = session.getStats().prediction;
    maxPendingCommands = Math.max(maxPendingCommands, predictionStats.pendingCommands);
    maxCorrectionDistance = Math.max(maxCorrectionDistance, predictionStats.correctionDistance);
  }

  const finalPose = session.samplePose({ nowMs: currentTick * fixedDtMs, captureInput: false });
  const finalRenderState = buildRoadRashRenderState(session.getLatestSnapshot(), finalPose);
  const predictionStats = session.getStats().prediction;
  session.destroy();
  interpolationEngine.destroy();
  return {
    state, finalRenderState, predictionStats, maxServerQueue, maxPendingCommands, maxDeliveryBurst,
    shortKickSequence, firstServerKickTick, maxCorrectionDistance, largestBackwardProgress,
    maxIdleLaneDelta, parityChecks, crossedTrackBoundary, firstVisibleDamageTick, largestBackwardSample,
    largestForwardMotionRewind, maxSettledProgressDelta, serverKickCount,
    undeliveredCommands: commandPackets.length,
  };
}

for (const rttMs of [150, 300, 500]) {
  test(`Road Rash ${rttMs} ms RTT with jitter and ordered bursts converges without lap or idle vibration`, () => {
    const session = simulateDelayedRoadRashRace({ rttMs });
    assert.ok(session.maxDeliveryBurst >= 8, "exercise coalesced delivery after a genuine ordered stream stall");
    assert.ok(session.maxServerQueue <= INPUT_LIMITS.MAX_QUEUED_FRAMES);
    assert.ok(session.maxServerQueue <= 24);
    assert.ok(session.maxPendingCommands <= 64);
    assert.ok(session.maxPendingCommands >= Math.round(rttMs / (1000 / 60)) - 2);
    assert.equal(session.undeliveredCommands, 0);
    assert.equal(session.predictionStats.pendingCommands, 0);
    assert.equal(session.state.players.p1.__inputBuffer.queue.length, 0);
    assert.ok(session.shortKickSequence > 0);
    assert.ok(session.firstServerKickTick > 38, "the server receives the short kick after transport delay");
    assert.equal(session.serverKickCount, 1, "the coalesced edge must not repeat when held-input physics continues");
    assert.ok(session.state.players.p1.lastInputSeqAck >= session.shortKickSequence);
    assert.equal(session.state.players.p1.inputEpoch, 1, "ordinary delay must preserve input ownership");
    assert.equal(session.predictionStats.hardSnaps, 0);
    assert.ok(session.maxCorrectionDistance < 0.65);
    assert.ok(session.parityChecks >= 20);
    assert.equal(session.crossedTrackBoundary, true);
    assert.ok(session.largestForwardMotionRewind < 1e-7, "unobstructed throttle movement cannot rewind through a lap");
    assert.ok(session.largestBackwardProgress < 6,
      `braking corrections must settle smoothly: ${JSON.stringify(session.largestBackwardSample)}`);
    assert.ok(session.maxIdleLaneDelta < 1e-8, "released steering must settle without alternating corrections");
    assert.ok(session.maxSettledProgressDelta < 1e-7, "a stopped rider must settle without continuing camera vibration");
    for (const coordinate of ["x", "speed", "progress", "z"]) {
      assert.ok(Math.abs(session.finalRenderState.players.p1[coordinate] - session.state.players.p1[coordinate]) < 1e-6,
        `${coordinate} must converge after pending commands and authority drain`);
    }
  });
}

test("Road Rash delayed authoritative traffic collision corrects movement while preserving server-only damage", () => {
  const session = simulateDelayedRoadRashRace({ rttMs: 300, collision: true });
  assert.equal(session.state.players.p1.integrity, 90);
  assert.ok(session.firstVisibleDamageTick >= 169, "collision damage appears after the delayed server snapshot");
  assert.equal(session.finalRenderState.players.p1.integrity, 90);
  assert.equal(session.predictionStats.pendingCommands, 0);
  assert.equal(session.predictionStats.hardSnaps, 0);
  assert.ok(session.maxCorrectionDistance < 0.65);
  assert.ok(Math.abs(session.finalRenderState.players.p1.progress - session.state.players.p1.progress) < 1e-6);
});
