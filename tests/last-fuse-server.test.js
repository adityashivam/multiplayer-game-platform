import test from "node:test";
import assert from "node:assert/strict";
import {
  lastFuseGameMeta,
  lastFusePracticeGameMeta,
  registerLastFuseGame,
  registerLastFusePracticeGame,
  serializeLastFuseState,
} from "../server/platform-backend-engine/games/lastFuse.js";
import { getGamesStore } from "../server/platform-backend-engine/core/gameStore.js";
import { createRoomLifecycleMetadata } from "../public/platform/shared/roomLifecycle.js";
import { LAST_FUSE_INPUT_TEMPLATE } from "../public/games/last-fuse/shared/config.js";
import { getLastFuseMatchPlatforms } from "../public/games/last-fuse/shared/match.js";
import { stepLastFuseRunner } from "../public/games/last-fuse/shared/runner.js";
import { LAST_FUSE_PRIVATE_RUNNER_FIELDS, createLastFusePredictionState, stepLastFusePrediction } from "../public/games/last-fuse/shared/prediction.js";
import { createLastFusePresentedRunners, extractLastFuseContinuityKeys } from "../public/games/last-fuse/client/snapshotPose.js";
import { createLastFuseEventTracker } from "../public/games/last-fuse/client/matchEvents.js";
import { projectLastFuseMovement } from "../public/games/last-fuse/client/inputState.js";
import { projectLastFuseMinimapPoint } from "../public/games/last-fuse/client/minimap.js";

const ROOM_ID = "fuse-room";

/** Mount a real registration against an in-memory namespace without timers. */
function createLastFuseTestSession(register) {
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
      id: `fuse-socket-${++socketSerial}`,
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
    const runner = getState().players[client.socket.data.playerId];
    client.socketHandlers.input({
      type: "inputFrame",
      protocol: 2,
      epoch: runner.inputEpoch,
      seq: sequenceNumber,
      state: { ...LAST_FUSE_INPUT_TEMPLATE, ...overrides },
    });
    runner.__lastInputReceiptMs = 100;
  }

  function startNow() {
    getState().startAt = Date.now() - 1;
    advance();
  }

  return { getState, connectPlayer, advance, sendInput, startNow };
}

test("online waits for both humans and fills the rooftops with four bots", () => {
  const session = createLastFuseTestSession(registerLastFuseGame);
  session.connectPlayer();
  assert.equal(session.getState().startAt, null);
  session.connectPlayer();
  const state = session.getState();
  assert.notEqual(state.startAt, null);
  assert.equal(createRoomLifecycleMetadata(state, ROOM_ID).requiredPlayers, 2);
  assert.equal(state.bots.length, 4);
});

test("practice starts with one runner and five bots that run once playing", () => {
  const session = createLastFuseTestSession(registerLastFusePracticeGame);
  const human = session.connectPlayer();
  const state = session.getState();
  assert.equal(human.socket.data.playerId, "p1");
  assert.equal(state.bots.length, 5);
  assert.equal(createRoomLifecycleMetadata(state, ROOM_ID).requiredPlayers, 1);
  session.startNow();
  assert.equal(state.phase, "playing");
  const start = state.bots.map((bot) => ({ x: bot.x, z: bot.z }));
  session.advance(60 * 4);
  assert.ok(state.bomb.holderId, "a bomb is armed");
  assert.ok(state.bots.some((bot, index) => Math.hypot(bot.x - start[index].x, bot.z - start[index].z) > 2), "bots move");
});

test("human input moves the runner and its view lag reaches the pass check", () => {
  const session = createLastFuseTestSession(registerLastFusePracticeGame);
  const human = session.connectPlayer();
  session.startNow();
  const runner = session.getState().players.p1;
  const startZ = runner.z;
  for (let sequence = 1; sequence <= 20; sequence += 1) {
    session.sendInput(human, sequence, { moveZ: 1, viewLagTicks: 7 });
    session.advance(1);
  }
  assert.ok(Math.abs(runner.z - startZ) > 1);
  assert.equal(runner.viewLagTicks, 7);
});

test("snapshots carry runners, city and bomb but never private server state", () => {
  const session = createLastFuseTestSession(registerLastFusePracticeGame);
  const human = session.connectPlayer();
  session.startNow();
  session.sendInput(human, 1, { moveX: 1, viewLagTicks: 6 });
  session.advance(10);
  const snapshot = serializeLastFuseState(session.getState());
  const serialized = JSON.stringify(snapshot);
  assert.equal(snapshot.players.p1.inputSeqAck, 1);
  assert.equal(snapshot.bots.length, 5);
  assert.equal(typeof snapshot.city.seed, "number");
  for (const privateField of ["rejoinToken", "__inputBuffer", "botBrains", "rematchRequests", "rngState", "poseHistory", "historyTick", ...LAST_FUSE_PRIVATE_RUNNER_FIELDS]) {
    assert.equal(serialized.includes(`"${privateField}"`), false, `${privateField} stays on the server`);
  }
  assert.deepEqual(JSON.parse(serialized), snapshot);
});

test("a disconnect pauses the match and keeps points and the bomb", () => {
  const session = createLastFuseTestSession(registerLastFuseGame);
  const left = session.connectPlayer();
  const right = session.connectPlayer();
  session.startNow();
  const state = session.getState();
  state.players.p1.points = 3;
  Object.assign(state.bomb, { holderId: "p2", fuseSec: 10, fuseTotalSec: 10 });
  session.sendInput(left, 1, { moveX: 1, dash: true });
  session.advance(1);
  const epoch = state.players.p1.inputEpoch;
  right.disconnect();
  assert.equal(state.phase, "paused");
  assert.equal(state.started, false);
  assert.ok(state.players.p1.inputEpoch > epoch);
  assert.equal(state.players.p1.dashHeld, false);
  assert.equal(state.players.p1.points, 3);
  assert.equal(state.bomb.holderId, "p2");
});

test("practice rematch needs one vote and starts a fresh match", () => {
  const session = createLastFuseTestSession(registerLastFusePracticeGame);
  const human = session.connectPlayer();
  session.startNow();
  const finished = session.getState();
  Object.assign(finished, { gameOver: true, phase: "finished", winner: "bot1" });
  finished.players.p1.points = 9;
  human.socketHandlers.rematch();
  const next = session.getState();
  assert.notEqual(next, finished);
  assert.equal(next.matchId, finished.matchId + 1);
  assert.notEqual(next.city.seed, finished.city.seed);
  assert.equal(next.players.p1.connected, true);
  assert.equal(next.players.p1.points, 0);
});

test("both modes share one input schema with separate routes and seats", () => {
  assert.equal(lastFuseGameMeta.networking.inputTemplate, lastFusePracticeGameMeta.networking.inputTemplate);
  assert.notEqual(lastFuseGameMeta.namespace, lastFusePracticeGameMeta.namespace);
  assert.deepEqual(lastFuseGameMeta.room.playerIds, ["p1", "p2"]);
  assert.deepEqual(lastFusePracticeGameMeta.room.playerIds, ["p1"]);
  assert.equal(lastFuseGameMeta.networking.tickRateHz, 60);
});

test("local prediction replays the same running and jumping as authority", () => {
  const session = createLastFuseTestSession(registerLastFusePracticeGame);
  session.connectPlayer();
  session.startNow();
  const state = session.getState();
  const snapshot = serializeLastFuseState(state);
  const predicted = createLastFusePredictionState(snapshot, "p1");
  const authority = structuredClone(state.players.p1);
  const platforms = getLastFuseMatchPlatforms(state);
  for (let tick = 0; tick < 90; tick += 1) {
    const control = { ...LAST_FUSE_INPUT_TEMPLATE, moveX: 0.6, moveZ: -0.4, jump: tick === 20, dash: tick === 50 };
    stepLastFusePrediction(predicted, control, 1 / 60);
    stepLastFuseRunner(authority, control, 1 / 60, { active: true, platforms, holder: false });
  }
  for (const field of ["x", "y", "z", "vx", "vy", "facing", "dashCooldownSec"]) {
    assert.ok(Math.abs(predicted[field] - authority[field]) < 1e-9, `${field} matches`);
  }
});

test("each life is its own interpolation identity, and events never replay after a rematch", () => {
  const session = createLastFuseTestSession(registerLastFusePracticeGame);
  session.connectPlayer();
  const snapshot = serializeLastFuseState(session.getState());
  const before = extractLastFuseContinuityKeys(snapshot)["p1.x"];
  snapshot.players.p1.respawnId += 1;
  assert.notEqual(extractLastFuseContinuityKeys(snapshot)["p1.x"], before);

  const tracker = createLastFuseEventTracker();
  const runners = createLastFusePresentedRunners(snapshot, null);
  assert.deepEqual(tracker.update(snapshot, runners), []);
  const passed = structuredClone(snapshot);
  Object.assign(passed.bomb, { holderId: "bot1", lastPassFromId: "p1", passSerial: snapshot.bomb.passSerial + 1 });
  assert.deepEqual(tracker.update(passed, createLastFusePresentedRunners(passed, null)).map((event) => event.kind), ["pass"]);
  const rematch = structuredClone(passed);
  rematch.matchId += 1;
  rematch.bomb.blastSerial += 3;
  assert.deepEqual(tracker.update(rematch, createLastFusePresentedRunners(rematch, null)), []);
});

test("screen-relative movement follows the camera heading", () => {
  const forward = projectLastFuseMovement({ moveX: 0, moveZ: 1 }, 0);
  assert.ok(Math.abs(forward.moveZ - 1) < 1e-9 && Math.abs(forward.moveX) < 1e-9);
  const turned = projectLastFuseMovement({ moveX: 0, moveZ: 1 }, Math.PI / 2);
  assert.ok(Math.abs(turned.moveX - 1) < 1e-9);
});

test("the minimap turns with the camera so the way you face is up", () => {
  const point = { x: 0, y: 0 };
  const heading = 0.7;
  projectLastFuseMinimapPoint(Math.sin(heading) * 10, Math.cos(heading) * 10, heading, point);
  const center = projectLastFuseMinimapPoint(0, 0, heading, { x: 0, y: 0 });
  assert.ok(Math.abs(point.x - center.x) < 1e-9, "straight ahead stays on the centre line");
  assert.ok(point.y < center.y, "straight ahead is drawn above the centre");
  const right = projectLastFuseMinimapPoint(-Math.cos(heading) * 10, Math.sin(heading) * 10, heading, { x: 0, y: 0 });
  assert.ok(right.x > center.x && Math.abs(right.y - center.y) < 1e-9, "camera right is map right");
  for (const corner of [[-22, -22], [22, 22], [-22, 22], [22, -22]]) {
    const projected = projectLastFuseMinimapPoint(corner[0], corner[1], Math.PI / 4, { x: 0, y: 0 });
    assert.ok(projected.x >= 0 && projected.y >= 0 && projected.x <= 156 && projected.y <= 156, "city corners stay on the map");
  }
});

test("a brief transport drop keeps the match running and a token rejoin resumes without a countdown", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const session = createLastFuseTestSession(registerLastFuseGame);
  session.connectPlayer();
  const right = session.connectPlayer();
  session.startNow();
  const state = session.getState();
  assert.equal(state.phase, "playing");
  const token = right.socketEvents.findLast(([event]) => event === "gameJoined")[1].rejoinToken;

  right.disconnect("transport close");
  assert.equal(state.phase, "playing", "a dropped connection does not pause the match");
  assert.equal(state.started, true);
  const returning = session.connectPlayer(token);
  assert.equal(returning.socket.data.playerId, "p2");
  assert.equal(state.phase, "playing");
  assert.equal(state.startAt, null, "no restart countdown");
  t.mock.timers.tick(10000);
  assert.equal(state.phase, "playing", "the cancelled grace never pauses later");

  returning.disconnect("ping timeout");
  t.mock.timers.tick(10000);
  assert.equal(state.phase, "paused", "a player who does not come back still pauses the match");
  assert.equal(state.players.p2.connected, false);
});

test("leaving on purpose pauses at once, without a grace", () => {
  const session = createLastFuseTestSession(registerLastFuseGame);
  session.connectPlayer();
  const right = session.connectPlayer();
  session.startNow();
  right.disconnect("client namespace disconnect");
  assert.equal(session.getState().phase, "paused");
});
