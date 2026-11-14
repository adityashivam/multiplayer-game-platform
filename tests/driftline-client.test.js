import test from "node:test";
import assert from "node:assert/strict";
import { createInputLatch } from "../public/platform/frontend-engine/inputTimeline.js";
import { createPredictedInputSession } from "../public/platform/frontend-engine/predictedInputSession.js";
import { createAuthoritativeInputSession } from "../server/platform-backend-engine/core/authoritativeInputSession.js";
import { INPUT_LIMITS } from "../public/platform/shared/networkProtocol.js";
import { createOrderedNetworkChannel } from "./helpers/networkScenario.js";
import { DRIFTLINE_EDGE_KEYS, DRIFTLINE_FIXED_DT_SEC, DRIFTLINE_INPUT_TEMPLATE, DRIFTLINE_NUMERIC_INPUTS } from "../public/games/driftline/shared/config.js";
import { createDriftlineRace, startDriftlineRace, stepDriftlineRace } from "../public/games/driftline/shared/race.js";
import { stepDriftlineCar } from "../public/games/driftline/shared/vehicle.js";
import { getDriftlineTrack } from "../public/games/driftline/shared/tracks/index.js";
import { createDriftlinePredictionState, stepDriftlinePrediction } from "../public/games/driftline/shared/prediction.js";
import {
  composeDriftlineRenderPose,
  createDriftlineLocalPresentation,
  createDriftlinePresentedCars,
  extractDriftlineContinuityKeys,
  extractDriftlinePositions,
} from "../public/games/driftline/client/snapshotPose.js";
import { createDriftlineEventTracker } from "../public/games/driftline/client/raceEvents.js";

const track = getDriftlineTrack("sunset-cliffs");

function createRacingSnapshot() {
  const race = createDriftlineRace({ playerIds: ["p1"], botIds: ["bot1"] });
  Object.assign(race, { started: true, phase: "racing" });
  race.players.p1.connected = true;
  return race;
}

test("local prediction replays exactly what authority simulates", () => {
  const snapshot = structuredClone(createRacingSnapshot());
  const predicted = createDriftlinePredictionState(snapshot, "p1");
  const authority = structuredClone(snapshot.players.p1);
  for (let tick = 0; tick < 240; tick += 1) {
    const input = { ...DRIFTLINE_INPUT_TEMPLATE, throttle: 1, steer: tick > 120 ? 0.6 : 0, handbrake: tick > 130 && tick < 150 };
    stepDriftlinePrediction(predicted, input, DRIFTLINE_FIXED_DT_SEC, { active: true });
    stepDriftlineCar(authority, input, DRIFTLINE_FIXED_DT_SEC, { track, active: true });
  }
  for (const field of ["x", "z", "yaw", "vx", "vz", "driftCharge", "progress", "wallHitSerial"]) assert.equal(predicted[field], authority[field], field);
  assert.equal(createDriftlinePredictionState(snapshot, "bot1"), null, "bots are never locally owned");
});

test("a recovery teleport changes only that car's interpolation identity", () => {
  const snapshot = createRacingSnapshot();
  const before = extractDriftlineContinuityKeys(snapshot);
  snapshot.bots[0].respawnId += 1;
  const after = extractDriftlineContinuityKeys(snapshot);
  assert.notEqual(before["bot1.x"], after["bot1.x"]);
  assert.equal(before["p1.x"], after["p1.x"]);
  assert.ok(Number.isFinite(extractDriftlinePositions(snapshot)["bot1.yawSin"]));
});

test("the local car renders from prediction while rivals keep authority", () => {
  const snapshot = createRacingSnapshot();
  const predicted = createDriftlinePredictionState(snapshot, "p1");
  Object.assign(predicted, { x: predicted.x + 3, steer: 0.8, drifting: true, boostSec: 0.4 });
  const localPose = { x: predicted.x, y: predicted.y, z: predicted.z, yawSin: Math.sin(predicted.yaw), yawCos: Math.cos(predicted.yaw) };
  const pose = composeDriftlineRenderPose(extractDriftlinePositions(snapshot), localPose, snapshot, "p1", predicted);
  const cars = createDriftlinePresentedCars(snapshot, pose, createDriftlineLocalPresentation(predicted));
  const local = cars.find((car) => car.id === "p1");
  assert.equal(local.x, predicted.x);
  assert.equal(local.drifting, true);
  assert.equal(local.steer, 0.8);
  assert.equal(cars.find((car) => car.id === "bot1").x, snapshot.bots[0].x);
});

test("race events fire once per change and rebase on a new match", () => {
  const tracker = createDriftlineEventTracker();
  const snapshot = createRacingSnapshot();
  const cars = () => createDriftlinePresentedCars(snapshot, null);
  assert.deepEqual(tracker.update(snapshot, cars()), []);
  snapshot.players.p1.boostSerial = 1;
  snapshot.players.p1.boostTier = 2;
  snapshot.players.p1.launch = "perfect";
  snapshot.bots[0].wallHitSerial = 1;
  assert.deepEqual(tracker.update(snapshot, cars()).map((event) => event.kind).sort(), ["boost", "launch", "wallHit"]);
  assert.deepEqual(tracker.update(snapshot, cars()), []);
  snapshot.matchId += 1;
  snapshot.players.p1.boostSerial = 9;
  assert.deepEqual(tracker.update(snapshot, cars()), [], "a rematch rebases instead of replaying");
});

for (const roundTripMs of [150, 300, 500]) {
  test(`driftline converges at ${roundTripMs} ms RTT with jitter, ordered bursts and a handbrake flick`, () => {
    const race = createDriftlineRace({ playerIds: ["p1"], botIds: [] });
    Object.assign(race, { started: true, phase: "racing" });
    race.players.p1.connected = true;
    startDriftlineRace(race);
    const inputConfig = { inputTemplate: DRIFTLINE_INPUT_TEMPLATE, edgeKeys: DRIFTLINE_EDGE_KEYS, numericInputs: DRIFTLINE_NUMERIC_INPUTS, fixedDtSec: DRIFTLINE_FIXED_DT_SEC };
    const serverSession = createAuthoritativeInputSession(inputConfig);
    serverSession.resetPlayer(race.players.p1);
    const inputLatch = createInputLatch(DRIFTLINE_INPUT_TEMPLATE, inputConfig);
    const commands = createOrderedNetworkChannel({ oneWayDelayMs: roundTripMs / 2, jitterMs: 60, stalls: [{ startMs: 750, durationMs: 200 }, { startMs: 2100, durationMs: 200 }] });
    const snapshots = createOrderedNetworkChannel({ oneWayDelayMs: roundTripMs / 2, jitterMs: 60, stalls: [{ startMs: 1600, durationMs: 200 }] });
    const pose = (car) => ({ x: car.x, z: car.z });
    let currentTimeMs = 0;
    let maximumPending = 0;
    let maximumQueue = 0;
    let maximumBurst = 0;
    let authorityHandbraked = false;
    let lastPresented = null;
    let restingMovement = 0;

    const clientSession = createPredictedInputSession({
      fixedDtSec: DRIFTLINE_FIXED_DT_SEC,
      captureInput: () => inputLatch.capture(),
      sendInput: (packet) => commands.send(packet, currentTimeMs),
      simulate: stepDriftlinePrediction,
      extractPose: pose,
      maxSmoothingDistance: 3,
    });
    const receiveSnapshot = (snapshot) => {
      const car = snapshot.players.p1;
      clientSession.receiveAuthority({
        state: createDriftlinePredictionState(snapshot, "p1"),
        protocol: 2,
        inputEpoch: car.inputEpoch,
        acknowledgedSequence: car.inputSeqAck,
        context: { active: snapshot.started && snapshot.phase === "racing", simulationTick: car.inputSimulationTick, continuityKey: `${snapshot.matchId}:${car.respawnId}` },
      });
    };
    const createSnapshot = () => {
      const snapshot = structuredClone(race);
      const { __inputBuffer, ...carSnapshot } = snapshot.players.p1;
      snapshot.players.p1 = { ...carSnapshot, ...serverSession.getPlayerSnapshotMetadata(race.players.p1) };
      return snapshot;
    };

    receiveSnapshot(createSnapshot());
    for (let tick = 1; tick <= 440; tick += 1) {
      currentTimeMs = tick * DRIFTLINE_FIXED_DT_SEC * 1000;
      for (const snapshot of snapshots.receive(currentTimeMs)) receiveSnapshot(snapshot);
      if (tick <= 300) {
        inputLatch.set("throttle", tick <= 150 ? 1 : 0);
        inputLatch.set("brake", tick > 150 && tick <= 260 ? 1 : 0);
        inputLatch.set("steer", tick > 90 && tick <= 130 ? 0.5 : 0);
        if (tick === 100) {
          inputLatch.set("handbrake", true);
          inputLatch.set("handbrake", false);
        }
        clientSession.captureAndPredict();
      }
      const delivered = commands.receive(currentTimeMs);
      maximumBurst = Math.max(maximumBurst, delivered.length);
      for (const packet of delivered) serverSession.receiveInput(race.players.p1, packet, currentTimeMs);
      maximumQueue = Math.max(maximumQueue, race.players.p1.__inputBuffer?.queue.length ?? 0);
      if (tick === 340) race.started = false;
      race.__loopTick = tick;
      race.__loopMonotonicNow = currentTimeMs;
      serverSession.simulateRoom({
        state: race,
        dtSec: DRIFTLINE_FIXED_DT_SEC,
        simulate: (car, input, stepSec) => {
          stepDriftlineCar(car, input, stepSec, { track, active: race.started && race.phase === "racing" });
          if (car.handbrake) authorityHandbraked = true;
        },
      });
      stepDriftlineRace(race, DRIFTLINE_FIXED_DT_SEC);
      snapshots.send(createSnapshot(), currentTimeMs);
      const presented = { ...clientSession.getRenderPose(1 / 120, 1) };
      assert.ok(Object.values(presented).every(Number.isFinite));
      if (tick >= 410 && lastPresented) restingMovement = Math.max(restingMovement, Math.hypot(presented.x - lastPresented.x, presented.z - lastPresented.z));
      lastPresented = presented;
      maximumPending = Math.max(maximumPending, clientSession.getStats().pendingCommands);
    }
    assert.equal(authorityHandbraked, true, "a one-capture handbrake flick reaches the server");
    assert.ok(maximumBurst >= 3, "fixture includes ordered delivery bursts");
    assert.ok(maximumPending <= INPUT_LIMITS.MAX_PENDING_FRAMES);
    assert.ok(maximumQueue <= INPUT_LIMITS.MAX_QUEUED_FRAMES);
    assert.equal(clientSession.getStats().pendingCommands, 0);
    assert.equal(clientSession.getStats().hardSnaps, 0, "delay alone must not snap the local car");
    assert.ok(restingMovement < 1e-5, `a stopped car does not vibrate: ${restingMovement}`);
    for (const [key, value] of Object.entries(pose(race.players.p1))) assert.ok(Math.abs(lastPresented[key] - value) < 0.001, `${key} converges`);
  });
}
