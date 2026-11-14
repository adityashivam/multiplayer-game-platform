import test from "node:test";
import assert from "node:assert/strict";
import {
  bumperLinksGameMeta,
  bumperLinksPracticeGameMeta,
  registerBumperLinksGame,
  registerBumperLinksPracticeGame,
  serializeBumperLinksState,
} from "../server/platform-backend-engine/games/bumperLinks.js";
import { getGamesStore } from "../server/platform-backend-engine/core/gameStore.js";
import { createRoomLifecycleMetadata } from "../public/platform/shared/roomLifecycle.js";
import { INPUT_PROTOCOL } from "../public/platform/shared/networkProtocol.js";
import { BUMPER_LINKS_INPUT_TEMPLATE, BUMPER_LINKS_MATCH_SETTINGS } from "../public/games/bumper-links/shared/config.js";

import {
  createBumperLinksPresentedBalls,
  extractBumperLinksContinuityKeys,
  extractBumperLinksPositions,
} from "../public/games/bumper-links/client/snapshotPose.js";
import { createBumperLinksEventTracker } from "../public/games/bumper-links/client/matchEvents.js";
import { nameBumperLinksBall } from "../public/games/bumper-links/client/ballNames.js";
import {
  applyBumperLinksAimInput,
  createBumperLinksAimState,
  predictBumperLinksAimLine,
  resolveBumperLinksDragAim,
} from "../public/games/bumper-links/client/aim.js";
import { projectBumperLinksMinimapPoint } from "../public/games/bumper-links/client/minimap.js";

const ROOM_ID = "links-room";

/** Mount a real registration against an in-memory namespace without timers. */
function createBumperLinksTestSession(register) {
  let connectSocket;
  const namespace = {
    adapter: { rooms: new Map() },
    sockets: new Map(),
    on: (_event, callback) => { connectSocket = callback; },
    to: () => ({ emit() {} }),
  };
  const previousSetTimeout = globalThis.setTimeout;
  let simulation;
  globalThis.setTimeout = () => 0;
  try {
    simulation = register({ of: () => namespace });
  } finally {
    globalThis.setTimeout = previousSetTimeout;
  }
  const games = getGamesStore(namespace);
  let socketSerial = 0;
  const getState = () => games.get(ROOM_ID);

  function connectPlayer(rejoinToken) {
    const socketHandlers = {};
    const socketEvents = [];
    const socket = {
      id: `links-socket-${++socketSerial}`,
      data: {},
      on: (event, callback) => { socketHandlers[event] = callback; },
      emit: (event, payload) => socketEvents.push([event, payload]),
      to: () => ({ emit() {} }),
      join(roomId) {
        if (!namespace.adapter.rooms.has(roomId)) namespace.adapter.rooms.set(roomId, new Set());
        namespace.adapter.rooms.get(roomId).add(socket.id);
      },
      leave: (roomId) => namespace.adapter.rooms.get(roomId)?.delete(socket.id),
    };
    namespace.sockets.set(socket.id, socket);
    connectSocket(socket);
    socketHandlers.joinGame({ gameId: ROOM_ID, rejoinToken });
    return {
      socket,
      socketHandlers,
      socketEvents,
      disconnect(reason) {
        socketHandlers.disconnect(reason);
        socket.leave(ROOM_ID);
        namespace.sockets.delete(socket.id);
      },
    };
  }

  /** @param {number} ticks @param {number} [nowMs] */
  function advance(ticks = 1, nowMs = Date.now()) {
    for (let tick = 0; tick < ticks; tick += 1) {
      const state = getState();
      state.__loopTick = (state.__loopTick || 0) + 1;
      state.__loopMonotonicNow = 100 + state.__loopTick;
      simulation.step(state, 1 / 60, { nowMs });
    }
  }

  function sendInput(client, sequenceNumber, overrides = {}) {
    const ball = getState().players[client.socket.data.playerId];
    client.socketHandlers.input({
      type: "inputFrame",
      protocol: 2,
      epoch: ball.inputEpoch,
      seq: sequenceNumber,
      state: { ...BUMPER_LINKS_INPUT_TEMPLATE, ...overrides },
    });
    ball.__lastInputReceiptMs = 100;
  }

  function startNow() {
    getState().startAt = Date.now() - 1;
    advance();
  }

  return { getState, connectPlayer, advance, sendInput, startNow };
}

test("metadata registers queued input, two seats online and one in practice", () => {
  assert.equal(bumperLinksGameMeta.networking.inputProtocol, INPUT_PROTOCOL.QUEUED);
  assert.deepEqual(bumperLinksGameMeta.room.playerIds, ["p1", "p2"]);
  assert.deepEqual(bumperLinksPracticeGameMeta.room.playerIds, ["p1"]);
  assert.equal(bumperLinksGameMeta.runtime.entryUrl, "/games/bumper-links/dist/main.js");
  assert.equal(bumperLinksPracticeGameMeta.runtime.entryUrl, "/games/bumper-links/dist/practice.js");
  assert.notEqual(bumperLinksGameMeta.namespace, bumperLinksPracticeGameMeta.namespace);
});

test("online waits for both humans and adds two bots; practice adds three", () => {
  const online = createBumperLinksTestSession(registerBumperLinksGame);
  online.connectPlayer();
  assert.equal(online.getState().startAt, null);
  online.connectPlayer();
  assert.notEqual(online.getState().startAt, null);
  assert.equal(createRoomLifecycleMetadata(online.getState(), ROOM_ID).requiredPlayers, 2);
  assert.equal(online.getState().bots.length, 2);

  const practice = createBumperLinksTestSession(registerBumperLinksPracticeGame);
  practice.connectPlayer();
  assert.equal(practice.getState().bots.length, 3);
  assert.equal(createRoomLifecycleMetadata(practice.getState(), ROOM_ID).requiredPlayers, 1);
});

test("a shot input moves the player's ball and is acknowledged", () => {
  const session = createBumperLinksTestSession(registerBumperLinksPracticeGame);
  const human = session.connectPlayer();
  session.startNow();
  const state = session.getState();
  assert.equal(state.phase, "playing");
  const ball = state.players.p1;
  const start = { x: ball.x, z: ball.z };
  session.sendInput(human, 1, { aimYaw: state.course.teeYaw, power: 0.5, shoot: true });
  session.advance(3);
  assert.equal(ball.strokes, 1, JSON.stringify({ strokes: ball.strokes, atRest: ball.atRest, x: ball.x, y: ball.y, z: ball.z, phase: state.phase, tee: state.course.tee, events: state.recentEvents }));
  assert.ok(Math.hypot(ball.x - start.x, ball.z - start.z) > 0.05);
  assert.ok(serializeBumperLinksState(state).players.p1.inputSeqAck >= 1);
});

test("a shot while the ball rolls is ignored without a stroke", () => {
  const session = createBumperLinksTestSession(registerBumperLinksPracticeGame);
  const human = session.connectPlayer();
  session.startNow();
  const state = session.getState();
  session.sendInput(human, 1, { aimYaw: state.course.teeYaw, power: 0.8, shoot: true });
  session.advance(2);
  session.sendInput(human, 2, { aimYaw: 0, power: 1, shoot: true });
  session.advance(2);
  assert.equal(state.players.p1.strokes, 1);
});

test("bots putt on their own once the hole is playing", () => {
  const session = createBumperLinksTestSession(registerBumperLinksPracticeGame);
  session.connectPlayer();
  session.startNow();
  session.advance(60 * 3);
  assert.ok(session.getState().bots.every((bot) => bot.strokes >= 1));
});

test("snapshots hide rejoin tokens, bot brains, the match seed and course solids", () => {
  const session = createBumperLinksTestSession(registerBumperLinksGame);
  session.connectPlayer();
  session.connectPlayer();
  const snapshot = serializeBumperLinksState(session.getState());
  const text = JSON.stringify(snapshot);
  for (const hidden of ["rejoinToken", "botBrains", "matchSeed", "solids", "lastHitById", "restX"]) {
    assert.equal(text.includes(hidden), false, hidden);
  }
  assert.equal(snapshot.bots.length, 2);
  assert.equal(typeof snapshot.holeSeed, "number");
  assert.ok(snapshot.par >= 2 && snapshot.par <= 5);
});

test("a brief transport drop keeps the hole running; the hole still ends at its time limit", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const session = createBumperLinksTestSession(registerBumperLinksGame);
  session.connectPlayer();
  const right = session.connectPlayer();
  session.startNow();
  const state = session.getState();
  right.disconnect("transport close");
  assert.equal(state.phase, "playing");
  session.advance(Math.ceil(BUMPER_LINKS_MATCH_SETTINGS.holeTimeSec * 60) + 1);
  assert.equal(state.phase, "holeOver");
  assert.equal(state.players.p2.sunk, false);
});

test("leaving on purpose pauses at once and keeps strokes", () => {
  const session = createBumperLinksTestSession(registerBumperLinksGame);
  const left = session.connectPlayer();
  const right = session.connectPlayer();
  session.startNow();
  session.sendInput(left, 1, { aimYaw: session.getState().course.teeYaw, power: 0.4, shoot: true });
  session.advance(2);
  right.disconnect("client namespace disconnect");
  const state = session.getState();
  assert.equal(state.phase, "paused");
  assert.equal(state.players.p1.strokes, 1);
});

test("practice rematch needs one vote and starts a fresh match", () => {
  const session = createBumperLinksTestSession(registerBumperLinksPracticeGame);
  const human = session.connectPlayer();
  const state = session.getState();
  state.gameOver = true;
  state.phase = "finished";
  human.socketHandlers.rematch();
  const nextState = session.getState();
  assert.notEqual(nextState, state);
  assert.equal(nextState.matchId, 2);
  assert.equal(nextState.players.p1.connected, true);
  assert.notEqual(nextState.startAt, null);
});

/** A started practice room's first snapshot. */
function createPlayingPracticeSnapshot() {
  const session = createBumperLinksTestSession(registerBumperLinksPracticeGame);
  const human = session.connectPlayer();
  session.startNow();
  return { session, human, snapshot: () => structuredClone(serializeBumperLinksState(session.getState())) };
}

test("continuity keys change when a ball returns from the water so it never slides across", () => {
  const { session, snapshot } = createPlayingPracticeSnapshot();
  const before = extractBumperLinksContinuityKeys(snapshot());
  session.getState().players.p1.lifeId += 1;
  const after = extractBumperLinksContinuityKeys(snapshot());
  assert.notEqual(after["p1.x"], before["p1.x"]);
  assert.equal(after["bot1.x"], before["bot1.x"]);
  const positions = extractBumperLinksPositions(snapshot());
  assert.equal(positions["p1.z"], session.getState().players.p1.z);
});

test("the event tracker reports each shot, sink and knockout once and never replays history", () => {
  const { session, snapshot } = createPlayingPracticeSnapshot();
  const state = session.getState();
  state.recentEvents.push({ serial: ++state.eventSerial, type: "splash", ballId: "bot1", byId: null, points: 0, x: 0, z: 0 });
  const tracker = createBumperLinksEventTracker();
  assert.deepEqual(tracker.update(snapshot()), [], "history before joining is not replayed");
  state.recentEvents.push({ serial: ++state.eventSerial, type: "sink", ballId: "p1", byId: null, points: 5, x: 0, z: 0 });
  state.recentEvents.push({ serial: ++state.eventSerial, type: "knockout", ballId: "bot2", byId: "bot1", points: 1, x: 2, z: 3 });
  state.players.p1.shotId += 1;
  const events = tracker.update(snapshot());
  assert.deepEqual(events.map((event) => event.type).sort(), ["knockout", "shot", "sink"]);
  assert.deepEqual(events.filter((event) => event.type === "knockout").map((event) => [event.x, event.z]), [[2, 3]]);
  assert.deepEqual(tracker.update(snapshot()), []);
  state.phase = "holeOver";
  assert.deepEqual(tracker.update(snapshot()).map((event) => event.type), ["holeOver"]);
});

test("presented balls use interpolated positions only for the current hole", () => {
  const { snapshot } = createPlayingPracticeSnapshot();
  const current = snapshot();
  const pose = extractBumperLinksPositions(current);
  pose["p1.x"] += 0.5;
  assert.equal(createBumperLinksPresentedBalls(current, pose).find((ball) => ball.id === "p1").x, current.players.p1.x + 0.5);
  const stalePose = { ...pose, holeIndex: current.holeIndex + 1 };
  assert.equal(createBumperLinksPresentedBalls(current, stalePose).find((ball) => ball.id === "p1").x, current.players.p1.x);
});

test("balls are named from the local player's point of view", () => {
  assert.equal(nameBumperLinksBall({ id: "p1" }, "p1"), "You");
  assert.equal(nameBumperLinksBall({ id: "p2" }, "p1"), "Rival");
  assert.equal(nameBumperLinksBall({ id: "bot2" }, "p1"), "Bot 2");
});

/** Straight railed lane along +Z, closed at the far end. */
function createAimTestCourse() {
  return {
    solids: [
      { minX: -2, maxX: 2, minY: -1, maxY: 0, minZ: -2, maxZ: 6 },
      { minX: -2, maxX: 2, minY: 0, maxY: 0.35, minZ: 5.8, maxZ: 6 },
      { minX: -2, maxX: -1.8, minY: 0, maxY: 0.35, minZ: -2, maxZ: 6 },
      { minX: 1.8, maxX: 2, minY: 0, maxY: 0.35, minZ: -2, maxZ: 6 },
    ],
    sweepers: [],
    cup: { x: 10, y: 0, z: 10 },
    waterY: -1.6,
  };
}

test("the aim line starts at the ball and bends off a rail", () => {
  const course = createAimTestCourse();
  const ball = { x: 0, y: 0.22, z: 4 };
  const points = [];
  const count = predictBumperLinksAimLine(course, ball, 0, 1, points);
  assert.ok(count >= 4 && count <= 24);
  assert.deepEqual([points[0].x, points[0].z], [0, 4]);
  const farthest = Math.max(...points.slice(0, count).map((point) => point.z));
  assert.ok(farthest < 5.8, "the line never passes through the end rail");
  assert.ok(points[count - 1].z < farthest, "the line comes back after the bounce");
});

test("holding charge ramps power up and down, and releasing fires once", () => {
  const aim = createBumperLinksAimState(0);
  let step = applyBumperLinksAimInput(aim, { turn: 0, chargeHeld: true, dtSec: 0.6 });
  assert.ok(step.power > 0.4 && step.power < 0.6);
  assert.equal(step.release, false);
  step = applyBumperLinksAimInput(aim, { turn: 0, chargeHeld: true, dtSec: 0.6 });
  assert.ok(step.power > 0.95);
  step = applyBumperLinksAimInput(aim, { turn: 0, chargeHeld: true, dtSec: 0.6 });
  assert.ok(step.power < 0.6, "power falls again after the peak");
  step = applyBumperLinksAimInput(aim, { turn: 0, chargeHeld: false, dtSec: 0.016 });
  assert.equal(step.release, true);
  assert.ok(step.power > 0.4);
  step = applyBumperLinksAimInput(aim, { turn: 0, chargeHeld: false, dtSec: 0.016 });
  assert.equal(step.release, false);
  applyBumperLinksAimInput(aim, { turn: 1, chargeHeld: false, dtSec: 0.5 });
  assert.ok(aim.aimYaw > 0.5);
  assert.ok(aim.aimYaw >= -Math.PI && aim.aimYaw <= Math.PI);
});

test("dragging back from the ball aims forward past the camera heading", () => {
  const forward = resolveBumperLinksDragAim({ dx: 0, dy: 120, heading: 0, sizePx: 400 });
  assert.ok(Math.abs(forward.aimYaw) < 1e-9);
  assert.ok(forward.power > 0.9 && forward.power <= 1);
  const right = resolveBumperLinksDragAim({ dx: -60, dy: 0, heading: 0, sizePx: 400 });
  assert.ok(Math.abs(right.aimYaw - Math.PI / 2) < 1e-9);
  assert.ok(right.power > 0.4 && right.power < 0.6);
});

test("minimap points stay inside the map", () => {
  const bounds = { minX: -2, maxX: 10, minZ: -2, maxZ: 22 };
  for (const [x, z] of [[-2, -2], [10, 22], [4, 10], [-30, 40]]) {
    const point = projectBumperLinksMinimapPoint(bounds, x, z, 120);
    assert.ok(point.x >= 0 && point.x <= 120 && point.y >= 0 && point.y <= 120, `${x},${z}`);
  }
  const near = projectBumperLinksMinimapPoint(bounds, 4, -2, 120);
  const far = projectBumperLinksMinimapPoint(bounds, 4, 22, 120);
  assert.ok(far.y < near.y, "further along +Z is higher on the map");
});
