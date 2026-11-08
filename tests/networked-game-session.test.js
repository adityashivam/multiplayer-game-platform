import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerInterpolator } from "../public/platform/frontend-engine/interpolationWorker.js";
import { createInputLatch } from "../public/platform/frontend-engine/inputTimeline.js";

const sessionModuleUrl = new URL("../public/platform/frontend-engine/networkedGameSession.js", import.meta.url);
const sessionModule = await import(sessionModuleUrl.href).catch((error) => {
  if (error.code === "ERR_MODULE_NOT_FOUND" && error.url === sessionModuleUrl.href) return {};
  throw error;
});

/** A transport boundary with independent subscribers and explicit connection changes. */
function createMemoryTransport() {
  const eventSubscribers = new Map();
  const sentPackets = [];
  const socket = {
    connected: true,
    connectionSnapshotReads: 0,
    connection: { ping: 0, pingP95Ms: 0, jitterP95Ms: 0, packetLossPct: 0 },
    onEvent(eventName, subscriber) {
      if (!eventSubscribers.has(eventName)) eventSubscribers.set(eventName, new Set());
      const subscribers = eventSubscribers.get(eventName);
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },
    send: (eventName, payload) => sentPackets.push({ eventName, payload }),
    isConnected: () => socket.connected,
    getConnectionSnapshot() {
      socket.connectionSnapshotReads += 1;
      return socket.connection;
    },
    deliver(eventName, payload) {
      for (const subscriber of [...(eventSubscribers.get(eventName) ?? [])]) subscriber(payload);
    },
    destroy() {
      socket.connected = false;
      eventSubscribers.clear();
    },
  };
  return { socket, sentPackets };
}

function createSnapshot(overrides = {}) {
  return {
    player: { distance: 0 },
    marker: 100,
    protocol: 2,
    epoch: 7,
    acknowledgement: 0,
    speed: 60,
    active: true,
    net: { seq: 1, serverTime: 0 },
    ...overrides,
  };
}

function createSessionHarness(testContext, sessionOverrides = {}, interpolationOverrides = {}) {
  assert.equal(typeof sessionModule.createNetworkedGameSession, "function", "the SDK exposes a networked game session");
  let arrivalMs = 0;
  testContext.mock.method(performance, "now", () => arrivalMs);
  const transport = createMemoryTransport();
  const interpolator = createWorkerInterpolator({
    extractPositions: (snapshot) => ({ marker: snapshot.marker }),
    adaptive: false,
    interpDelayMs: 0,
    ...interpolationOverrides,
  });
  const resetEvents = [];
  const session = sessionModule.createNetworkedGameSession({
    socket: transport.socket,
    interpolator,
    prediction: {
      captureInput: () => ({ east: true, hop: false }),
      simulate: (playerState, capturedInput, fixedDtSec, context) => {
        if (capturedInput.east) playerState.distance += context.speed * fixedDtSec;
      },
      extractPose: (playerState) => ({ distance: playerState.distance }),
    },
    readAuthority: (snapshot) => snapshot.player ? {
      state: snapshot.player,
      protocol: snapshot.protocol,
      inputEpoch: snapshot.epoch,
      acknowledgedSequence: snapshot.acknowledgement,
      context: { speed: snapshot.speed },
    } : null,
    composeRenderPose: (remotePose, localPose) => remotePose ? {
      ...remotePose,
      distance: localPose?.distance ?? null,
    } : null,
    onReset: (resetOptions) => resetEvents.push(resetOptions),
    ...sessionOverrides,
  });
  testContext.after(() => session.destroy());

  return {
    ...transport,
    session,
    interpolator,
    resetEvents,
    deliver(snapshot, timestampMs = 0) {
      arrivalMs = timestampMs;
      transport.socket.deliver("state", snapshot);
    },
    sample(nowMs = 0, deltaSec = 1 / 60) {
      return session.samplePose({ nowMs, deltaSec });
    },
  };
}

test("networked prediction sends complete queued commands and replays pending input without mutating snapshots", (testContext) => {
  const harness = createSessionHarness(testContext);
  assert.equal(harness.sample(), null);
  assert.equal(harness.sentPackets.length, 0);
  const initialSnapshot = createSnapshot({ player: Object.freeze({ distance: 0 }) });
  harness.deliver(initialSnapshot);

  assert.deepEqual(harness.sample(0), { marker: 100, distance: 1 });
  harness.sample(17);
  assert.deepEqual(harness.sample(34), { marker: 100, distance: 3 });
  assert.deepEqual(harness.sentPackets, [1, 2, 3].map((sequenceNumber) => ({
    eventName: "input",
    payload: {
      type: "inputFrame", protocol: 2, epoch: 7, seq: sequenceNumber,
      state: { east: true, hop: false },
    },
  })));

  const nextSnapshot = createSnapshot({
    player: Object.freeze({ distance: 1 }),
    acknowledgement: 1,
    net: { seq: 2, serverTime: 17 },
  });
  harness.deliver(nextSnapshot, 50);

  assert.equal(harness.session.getStats().prediction.pendingCommands, 2);
  assert.equal(harness.session.getStats().prediction.lastReplayCount, 2);
  assert.deepEqual(harness.sample(51), { marker: 100, distance: 4 });
  assert.equal(initialSnapshot.player.distance, 0);
  assert.equal(nextSnapshot.player.distance, 1);
  assert.equal(harness.session.getLatestSnapshot(), nextSnapshot);
});

test("interpolation-only games render supplied snapshots without command or authority configuration", (testContext) => {
  const harness = createSessionHarness(testContext, {
    prediction: undefined,
    readAuthority: undefined,
    composeRenderPose: undefined,
  });
  harness.deliver(createSnapshot({ marker: 0 }), 0);
  harness.deliver(createSnapshot({ marker: 100, net: { seq: 2, serverTime: 100 } }), 100);

  assert.deepEqual(harness.sample(50), { marker: 50 });
  assert.equal(harness.sentPackets.length, 0);
  const diagnostics = harness.session.getStats();
  assert.equal(diagnostics.prediction, null);
  assert.equal(diagnostics.interpolation.updateRateHz, 10);
});

test("fixed command capture and render-only samples share ownership and pause guards", (testContext) => {
  const harness = createSessionHarness(testContext, { canCaptureInput: (snapshot) => snapshot.active });
  assert.equal(harness.session.captureAndPredict(), null);
  harness.deliver(createSnapshot({ active: false }));
  assert.equal(harness.session.captureAndPredict(), null);
  harness.session.samplePose({ captureInput: false, nowMs: 0 });
  assert.equal(harness.sentPackets.length, 0);

  harness.deliver(createSnapshot({ net: { seq: 2, serverTime: 17 } }), 17);
  assert.equal(harness.session.captureAndPredict().seq, 1);
  for (let nowMs = 17; nowMs < 34; nowMs += 2) {
    assert.equal(harness.session.samplePose({ captureInput: false, nowMs, deltaSec: 0.002 }).distance, 1);
  }
  assert.equal(harness.sentPackets.length, 1);

  harness.socket.connected = false;
  assert.equal(harness.session.captureAndPredict(), null);
  harness.sample(34);
  assert.equal(harness.sentPackets.length, 1);
  harness.socket.connected = true;
  assert.equal(harness.session.captureAndPredict().seq, 2);
  harness.deliver(createSnapshot({ player: null, net: { seq: 3, serverTime: 50 } }), 50);
  assert.equal(harness.session.captureAndPredict(), null);
  harness.session.destroy();
  assert.equal(harness.session.captureAndPredict(), null);
  assert.equal(harness.session.samplePose({ captureInput: false, nowMs: 51 }), null);
  assert.equal(harness.sentPackets.length, 2);
});

test("render-only correction sampling remains smooth at 120 and 144 Hz without sending extra commands", (testContext) => {
  const finalDistances = [];
  for (const renderHz of [120, 144]) {
    const harness = createSessionHarness(testContext);
    harness.deliver(createSnapshot());
    harness.session.captureAndPredict();
    harness.deliver(createSnapshot({
      player: { distance: 11 },
      acknowledgement: 1,
      net: { seq: 2, serverTime: 100 },
    }), 100);

    let previousDistance = 1;
    for (let renderFrame = 1; renderFrame <= renderHz / 2; renderFrame += 1) {
      const renderedPose = harness.session.samplePose({
        captureInput: false,
        nowMs: 100 + renderFrame * 1000 / renderHz,
        deltaSec: 1 / renderHz,
      });
      assert.ok(renderedPose.distance > previousDistance && renderedPose.distance < 11);
      previousDistance = renderedPose.distance;
    }
    assert.equal(harness.sentPackets.length, 1);
    finalDistances.push(previousDistance);
  }

  assert.ok(Math.abs(finalDistances[0] - 10.998765901959134) < 1e-10);
  assert.ok(Math.abs(finalDistances[0] - finalDistances[1]) < 1e-10);
});

test("render alpha interpolates local fixed poses without interpolating discrete action identities", (testContext) => {
  const harness = createSessionHarness(testContext, {
    prediction: {
      captureInput: () => ({ east: true }),
      simulate(player) { player.distance += 1; player.actionId += 1; },
      extractPose: (player) => ({ distance: player.distance }),
    },
    composeRenderPose: (_remote, local, _snapshot, predictedState) => ({
      distance: local?.distance ?? null,
      actionId: predictedState?.actionId ?? null,
    }),
  });
  harness.deliver(createSnapshot({ player: Object.freeze({ distance: 0, actionId: 4 }) }));
  harness.session.captureAndPredict();

  assert.deepEqual(harness.session.samplePose({ captureInput: false, interpolationAlpha: 0.5 }), {
    distance: 0.5,
    actionId: 5,
  });
  assert.equal(harness.sentPackets.length, 1);
});

test("accepted ownership changes reset game input latches without clearing fresh authority or interpolation", (testContext) => {
  const inputLatch = createInputLatch({ east: false, hop: false }, { edgeKeys: ["hop"] });
  const ownershipResets = [];
  const harness = createSessionHarness(testContext, {
    prediction: {
      captureInput: () => inputLatch.capture(),
      simulate(player, input) { if (input.east) player.distance += 1; },
      extractPose: (player) => ({ distance: player.distance }),
    },
    onInputOwnershipReset(ownershipReset) {
      ownershipResets.push(ownershipReset);
      inputLatch.reset();
    },
  });
  harness.deliver(createSnapshot());
  assert.deepEqual(ownershipResets, []);
  harness.deliver(createSnapshot({ epoch: undefined, net: { seq: 2, serverTime: 10 } }), 10);
  harness.deliver(createSnapshot({ epoch: 6, net: { seq: 3, serverTime: 20 } }), 20);
  assert.deepEqual(ownershipResets, []);

  inputLatch.set("east", true);
  inputLatch.set("hop", true);
  inputLatch.set("hop", false);
  const freshSnapshot = createSnapshot({ player: { distance: 50 }, epoch: 8, net: { seq: 4, serverTime: 30 } });
  harness.deliver(freshSnapshot, 30);
  assert.deepEqual(ownershipResets, [{ previousEpoch: 7, inputEpoch: 8 }]);
  assert.equal(harness.session.getLatestSnapshot(), freshSnapshot);
  assert.equal(harness.interpolator.getLatestState(), freshSnapshot);
  harness.session.captureAndPredict();
  assert.deepEqual(harness.sentPackets.at(-1).payload, {
    type: "inputFrame", protocol: 2, epoch: 8, seq: 1,
    state: { east: false, hop: false },
  });
  assert.equal(harness.session.samplePose({ captureInput: false, nowMs: 30 }).distance, 50);
});

test("presentation receives discrete predicted state separately from smoothed numeric poses", (testContext) => {
  const harness = createSessionHarness(testContext, {
    prediction: {
      captureInput: () => ({ east: true }),
      simulate(player) { player.distance += 1; player.animation = "serve"; player.actionId += 1; },
      extractPose: (player) => ({ distance: player.distance }),
    },
    composeRenderPose: (_remote, local, _snapshot, predictedState) => ({
      distance: local?.distance ?? null,
      animation: predictedState?.animation ?? null,
      actionId: predictedState?.actionId ?? null,
    }),
  });
  const snapshot = createSnapshot({ player: Object.freeze({ distance: 0, animation: "idle", actionId: 8 }) });
  harness.deliver(snapshot);
  assert.deepEqual(harness.sample(), { distance: 1, animation: "serve", actionId: 9 });
  assert.equal(snapshot.player.actionId, 8, "Presentation sees the prediction clone, never authority");
  harness.socket.deliver("disconnect");
  assert.deepEqual(harness.sample(20), { distance: null, animation: null, actionId: null });
});

for (const eventName of ["gameJoined", "disconnect", "rematchStarted"]) {
  test(`${eventName} clears snapshots and command ownership until fresh authority arrives`, (testContext) => {
    const harness = createSessionHarness(testContext);
    assert.equal(harness.resetEvents.length, 0);
    harness.deliver(createSnapshot());
    harness.sample();
    harness.socket.deliver(eventName);

    assert.equal(harness.session.getLatestSnapshot(), null);
    assert.equal(harness.interpolator.getLatestState(), null);
    assert.equal(harness.sample(17), null);
    assert.equal(harness.sentPackets.length, 1);
    assert.deepEqual(harness.resetEvents, [{ preserveSequence: false }]);

    harness.deliver(createSnapshot({ epoch: 8, player: { distance: 100 } }), 20);
    assert.equal(harness.sample(20).distance, 101);
    assert.equal(harness.sentPackets.at(-1).payload.epoch, 8);
    assert.equal(harness.sentPackets.at(-1).payload.seq, 1);
  });
}

test("player departure preserves sequence ownership and rejects delayed previous epochs", (testContext) => {
  const harness = createSessionHarness(testContext);
  harness.deliver(createSnapshot());
  harness.sample();
  harness.socket.deliver("playerLeft", { playerId: "remote" });

  assert.deepEqual(harness.resetEvents, [{ preserveSequence: true }]);
  assert.equal(harness.sample(17), null);
  harness.deliver(createSnapshot({ epoch: 6, net: { seq: 2, serverTime: 20 } }), 20);
  harness.sample(20);
  assert.equal(harness.sentPackets.length, 1);

  harness.deliver(createSnapshot({ player: { distance: 1 }, acknowledgement: 1, net: { seq: 3, serverTime: 30 } }), 30);
  assert.equal(harness.sample(30).distance, 2);
  assert.equal(harness.sentPackets.at(-1).payload.seq, 2);

  harness.deliver(createSnapshot({ epoch: 8, player: { distance: 100 }, net: { seq: 4, serverTime: 40 } }), 40);
  assert.equal(harness.sample(40).distance, 101);
  harness.deliver(createSnapshot({ epoch: 7, player: { distance: -500 }, speed: 600, net: { seq: 5, serverTime: 50 } }), 50);
  assert.equal(harness.sample(50).distance, 102);
  assert.equal(harness.sentPackets.at(-1).payload.epoch, 8);
  assert.equal(harness.sentPackets.at(-1).payload.seq, 2);
});

test("capture requires a live connection, current authority and the optional game guard", (testContext) => {
  const harness = createSessionHarness(testContext, { canCaptureInput: (snapshot) => snapshot.active });
  harness.deliver(createSnapshot({ active: false }));
  harness.sample();
  assert.equal(harness.sentPackets.length, 0);

  harness.deliver(createSnapshot({ player: null, net: { seq: 2, serverTime: 10 } }), 10);
  harness.sample(10);
  assert.equal(harness.sentPackets.length, 0);

  harness.socket.connected = false;
  harness.deliver(createSnapshot({ net: { seq: 3, serverTime: 20 } }), 20);
  harness.sample(20);
  assert.equal(harness.sentPackets.length, 0);

  harness.socket.connected = true;
  harness.sample(30);
  harness.sample(30);
  assert.deepEqual(harness.sentPackets.map((packet) => packet.payload.seq), [1, 2]);
});

test("missing authority renders interpolation and resumes prediction from fresh state without a backward correction", (testContext) => {
  const harness = createSessionHarness(testContext, {
    composeRenderPose: (remotePose, localPose) => remotePose ? {
      distance: localPose?.distance ?? remotePose.marker,
    } : null,
  });
  harness.deliver(createSnapshot({ marker: 0 }));
  assert.deepEqual(harness.sample(0), { distance: 1 });

  harness.deliver(createSnapshot({ player: null, marker: 100, net: { seq: 2, serverTime: 100 } }), 100);
  assert.deepEqual(harness.sample(100), { distance: 100 });
  assert.equal(harness.sentPackets.length, 1);
  assert.equal(harness.session.getStats().prediction.pendingCommands, 1);

  harness.deliver(createSnapshot({ player: { distance: -500 }, epoch: 6, marker: 200, net: { seq: 3, serverTime: 200 } }), 200);
  assert.deepEqual(harness.sample(200), { distance: 200 });
  assert.equal(harness.sentPackets.length, 1);

  harness.deliver(createSnapshot({ player: { distance: 200 }, acknowledgement: 1, marker: 200, net: { seq: 4, serverTime: 300 } }), 300);
  assert.deepEqual(harness.sample(300), { distance: 201 });
  assert.equal(harness.sentPackets.at(-1).payload.seq, 2);
  assert.equal(harness.sentPackets.at(-1).payload.epoch, 7);
});

test("connection tail latency and jitter affect real adaptive interpolation", (testContext) => {
  const harness = createSessionHarness(testContext, { prediction: undefined, composeRenderPose: undefined }, { adaptive: true });
  harness.socket.connection = { ping: 400, pingP95Ms: 500, jitterP95Ms: 50, packetLossPct: 8 };
  for (let sampleIndex = 0; sampleIndex <= 10; sampleIndex += 1) {
    harness.deliver(createSnapshot({ marker: sampleIndex * 10, net: { seq: sampleIndex + 1, serverTime: sampleIndex * 10 } }), sampleIndex * 10);
  }

  assert.deepEqual(harness.sample(100), { marker: 0 });
});

test("connection metrics refresh at the diagnostics interval while disconnection blocks commands immediately", (testContext) => {
  const harness = createSessionHarness(testContext, {}, { adaptive: true });
  for (let sampleIndex = 0; sampleIndex <= 10; sampleIndex += 1) {
    harness.deliver(createSnapshot({ marker: sampleIndex * 10, net: { seq: sampleIndex + 1, serverTime: sampleIndex * 10 } }), sampleIndex * 10);
  }
  harness.sample(0);
  Object.assign(harness.socket.connection, { ping: 400, pingP95Ms: 500, jitterP95Ms: 50, packetLossPct: 8 });
  harness.sample(16);
  harness.socket.connected = false;
  harness.sample(17);
  assert.equal(harness.sentPackets.length, 2);
  harness.socket.connected = true;
  harness.sample(18);
  const beforeRefreshPose = harness.sample(119);

  assert.equal(harness.socket.connectionSnapshotReads, 1);
  assert.ok(beforeRefreshPose.marker > 40, "new tail latency must wait for the metrics refresh");
  const afterRefreshPose = harness.sample(120);
  assert.equal(harness.socket.connectionSnapshotReads, 2);
  assert.ok(Math.abs(afterRefreshPose.marker - beforeRefreshPose.marker - 0.75) < 1e-8,
    "fresh tail latency slows real playback toward its larger buffer delay");
  assert.deepEqual(harness.sentPackets.map((packet) => packet.payload.seq), [1, 2, 3, 4, 5]);
});

test("diagnostics callbacks are throttled independently of fixed-step command capture", (testContext) => {
  const diagnostics = [];
  const harness = createSessionHarness(testContext, { onDiagnostics: (sessionStats) => diagnostics.push(sessionStats) });
  harness.deliver(createSnapshot());
  for (const nowMs of [0, 10, 119, 120, 239, 240]) harness.sample(nowMs);

  assert.equal(harness.sentPackets.length, 6);
  assert.equal(diagnostics.length, 3);
  assert.deepEqual(diagnostics.map((sessionStats) => sessionStats.prediction.pendingCommands), [1, 4, 6]);
  assert.ok(diagnostics.every((sessionStats) => sessionStats.interpolation !== null));
  assert.equal(harness.session.getStats().prediction.pendingCommands, 6);
});

test("manual reset clears both engines before notifying presentation and honors configured diagnostics cadence", (testContext) => {
  const resetViews = [];
  const diagnostics = [];
  let harness;
  harness = createSessionHarness(testContext, {
    diagnosticsIntervalMs: 50,
    onDiagnostics: (sessionStats) => diagnostics.push(sessionStats),
    onReset: (resetOptions) => resetViews.push({
      ...resetOptions,
      snapshot: harness.session.getLatestSnapshot(),
      interpolationSnapshot: harness.interpolator.getLatestState(),
    }),
  });
  harness.deliver(createSnapshot());
  harness.sample(0);
  harness.sample(49);
  harness.sample(50);
  harness.session.reset();

  assert.deepEqual(resetViews, [{ preserveSequence: false, snapshot: null, interpolationSnapshot: null }]);
  assert.equal(diagnostics.length, 2);
  assert.equal(harness.socket.connectionSnapshotReads, 2);
  assert.equal(harness.session.getStats().prediction.pendingCommands, 0);
});

test("destroy removes exact owned subscriptions while caller resources and unrelated listeners remain usable", (testContext) => {
  const harness = createSessionHarness(testContext);
  const externalSnapshots = [];
  const removeExternalSubscription = harness.socket.onEvent("state", (snapshot) => externalSnapshots.push(snapshot));
  const firstSnapshot = createSnapshot();
  harness.deliver(firstSnapshot);
  harness.sample();
  harness.session.destroy();
  harness.session.destroy();
  harness.session.reset();
  const secondSnapshot = createSnapshot({ marker: 200, net: { seq: 2, serverTime: 100 } });
  harness.deliver(secondSnapshot, 100);
  harness.socket.deliver("rematchStarted");

  assert.equal(harness.sample(100), null);
  assert.equal(harness.sentPackets.length, 1);
  assert.equal(harness.resetEvents.length, 0);
  assert.deepEqual(externalSnapshots, [firstSnapshot, secondSnapshot]);
  assert.equal(harness.interpolator.getLatestState(), firstSnapshot);
  harness.interpolator.pushState(secondSnapshot, { timestampMs: 100 });
  assert.deepEqual(harness.interpolator.getInterpolatedPositions({ nowMs: 100 }), { marker: 200 });
  harness.socket.send("presentation-event", { open: true });
  assert.equal(harness.socket.isConnected(), true);
  assert.deepEqual(harness.sentPackets.at(-1), { eventName: "presentation-event", payload: { open: true } });
  removeExternalSubscription();
});

test("prediction requires an authority mapping and diagnostics require a positive finite interval", (testContext) => {
  assert.throws(() => createSessionHarness(testContext, { readAuthority: undefined }), { name: "TypeError" });
  for (const diagnosticsIntervalMs of [0, -1, Infinity, NaN]) {
    assert.throws(() => createSessionHarness(testContext, { diagnosticsIntervalMs }), { name: "TypeError" });
  }
});
