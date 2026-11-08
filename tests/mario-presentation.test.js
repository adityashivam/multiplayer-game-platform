import test from "node:test";
import assert from "node:assert/strict";
import { createWorkerInterpolator } from "../public/platform/frontend-engine/interpolationWorker.js";
import { createInputLatch } from "../public/platform/frontend-engine/inputTimeline.js";
import { createMarioInterpolationOptions, createMarioNetworkSession } from "../public/games/mario/networking.js";
import { MARIO_EDGE_KEYS, MARIO_INPUT_TEMPLATE } from "../public/games/mario/shared/config.js";
import { serializeMarioState } from "../server/platform-backend-engine/games/mario.js";
import { createMarioTestSession } from "./mario-test-helpers.js";

function createMarioAuthority() {
  const serverSession = createMarioTestSession();
  serverSession.connectPlayer();
  serverSession.connectPlayer();
  const serverState = serverSession.getState();
  serverState.started = true;
  serverState.startAt = null;
  return serializeMarioState(serverState);
}

function createMarioPresentationSession() {
  const handlers = new Map();
  const sentInputs = [];
  const inputLatch = createInputLatch(MARIO_INPUT_TEMPLATE, { edgeKeys: MARIO_EDGE_KEYS });
  const socket = {
    onEvent(eventName, callback) {
      if (!handlers.has(eventName)) handlers.set(eventName, new Set());
      handlers.get(eventName).add(callback);
      return () => handlers.get(eventName).delete(callback);
    },
    send: (_eventName, inputPacket) => { sentInputs.push(inputPacket); },
    isConnected: () => true,
    getConnectionSnapshot: () => ({ ping: 300 }),
  };
  const networkSession = createMarioNetworkSession({
    socket,
    interpolator: createWorkerInterpolator(createMarioInterpolationOptions()),
    getPlayerId: () => "p1",
    captureInput: () => inputLatch.capture(),
    onInputOwnershipReset: () => inputLatch.reset(),
  });
  return {
    networkSession,
    sentInputs,
    inputLatch,
    receiveAuthority: (snapshot) => handlers.get("state").forEach((subscriber) => subscriber(snapshot)),
  };
}

test("Mario respawn snaps local movement continuity and retains future command replay", () => {
  const session = createMarioPresentationSession();
  const snapshot = createMarioAuthority();
  snapshot.players.p1.x = 180;
  session.receiveAuthority(snapshot);
  session.inputLatch.set("right", true);
  session.inputLatch.set("run", true);
  for (let tick = 0; tick < 5; tick += 1) session.networkSession.captureAndPredict();
  assert.ok(session.networkSession.samplePose({ captureInput: false }).players.p1.x > 180);

  const respawnSnapshot = structuredClone(snapshot);
  Object.assign(respawnSnapshot.players.p1, {
    x: 96,
    movementEpoch: 1,
    inputSeqAck: 3,
    inputSimulationTick: 3,
  });
  session.receiveAuthority(respawnSnapshot);
  for (const interpolationAlpha of [0, 0.5, 1]) {
    const renderState = session.networkSession.samplePose({ captureInput: false, interpolationAlpha });
    assert.ok(Math.abs(renderState.players.p1.x - 97.1) < 1e-9,
      "respawn must discard the previous life's correction and fixed-pose endpoint");
    assert.equal(renderState.players.p1.movementEpoch, 1);
    assert.equal(renderState.players.p1.rank, snapshot.players.p1.rank);
  }
  assert.equal(session.networkSession.getStats().prediction.pendingCommands, 2);
  assert.equal(session.networkSession.getStats().prediction.hardSnaps, 0);
  session.networkSession.captureAndPredict();
  assert.equal(session.sentInputs.at(-1).seq, 6);
  assert.equal(session.sentInputs.at(-1).epoch, 1);
  assert.equal(respawnSnapshot.players.p1.x, 96);
  session.networkSession.destroy();
});

test("Mario remote respawn and stomp skip obsolete poses while other players interpolate", () => {
  const interpolator = createWorkerInterpolator({ ...createMarioInterpolationOptions(), adaptive: false, interpDelayMs: 0 });
  const firstSnapshot = createMarioAuthority();
  firstSnapshot.net = { seq: 1, serverTime: 0 };
  firstSnapshot.players.p1.x = 180;
  firstSnapshot.players.p2.x = 220;
  firstSnapshot.players.p2.vx = 200;
  const respawnSnapshot = structuredClone(firstSnapshot);
  respawnSnapshot.net = { seq: 2, serverTime: 100 };
  respawnSnapshot.players.p1.x = 84;
  respawnSnapshot.players.p1.movementEpoch = 1;
  respawnSnapshot.players.p2.x = 240;
  respawnSnapshot.enemies[0].stomped = true;
  respawnSnapshot.enemies[0].y += 16;
  interpolator.pushState(firstSnapshot, { timestampMs: 0 });
  interpolator.pushState(respawnSnapshot, { timestampMs: 100 });
  const renderPose = interpolator.getInterpolatedPositions({ nowMs: 50 });
  assert.equal(renderPose.p1x, 84, "respawn must never slide backward through the old life");
  assert.equal(renderPose.p2x, 230, "an unrelated racing player keeps smooth buffered playback");
  assert.equal(renderPose.e0y, respawnSnapshot.enemies[0].y, "stomp pose uses its authoritative identity");
  interpolator.destroy();
});

test("Mario new input ownership clears pending controls without losing authority", () => {
  const session = createMarioPresentationSession();
  const snapshot = createMarioAuthority();
  session.receiveAuthority(snapshot);
  session.inputLatch.set("right", true);
  session.inputLatch.set("jump", true);
  session.inputLatch.set("jump", false);
  session.networkSession.captureAndPredict();
  const nextSnapshot = structuredClone(snapshot);
  nextSnapshot.players.p1.inputEpoch = 2;
  session.receiveAuthority(nextSnapshot);
  session.networkSession.captureAndPredict();
  assert.equal(session.sentInputs.at(-1).epoch, 2);
  assert.equal(session.sentInputs.at(-1).seq, 1);
  assert.deepEqual(session.sentInputs.at(-1).state, { left: false, right: false, run: false, jump: false });
  assert.equal(session.networkSession.samplePose({ captureInput: false }).players.p1.x, snapshot.players.p1.x);
  session.networkSession.destroy();
});
