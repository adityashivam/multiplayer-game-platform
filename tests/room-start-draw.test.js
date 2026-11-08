import test from "node:test";
import assert from "node:assert/strict";
import { registerDrawGame } from "../server/platform-backend-engine/games/draw.js";
import { getGamesStore } from "../server/platform-backend-engine/core/gameStore.js";

/**
 * Exercise registered Socket.IO handlers and the actual scheduled room tick.
 * Every invocation owns its clock/timer override and restores it immediately;
 * no live intervals or real-time countdown waits escape this fixture.
 */
function createDrawRoomSession() {
  const roomEvents = [];
  const opponentDrawEvents = [];
  const snapshotValues = new Map();
  let snapshotPaths = [];
  let connectSocket;
  let scheduledTick;
  let wallNowMs = 10000;
  let monotonicNowMs = 0;
  let nextSocketId = 1;
  const namespace = {
    adapter: { rooms: new Map() },
    sockets: new Map(),
    on: (_eventName, callback) => { connectSocket = callback; },
    to: (roomId) => ({
      emit(eventName, payload) {
        const emittedPayload = structuredClone(payload);
        roomEvents.push({ roomId, eventName, payload: emittedPayload });
        if (eventName !== "state") return;
        if (emittedPayload.k === "f") {
          snapshotPaths = emittedPayload.p;
          snapshotValues.clear();
          for (let pathIndex = 0; pathIndex < snapshotPaths.length; pathIndex += 1) {
            snapshotValues.set(snapshotPaths[pathIndex], emittedPayload.v[pathIndex]);
          }
        } else {
          for (const [pathIndex, value] of emittedPayload.c) snapshotValues.set(snapshotPaths[pathIndex], value);
        }
      },
    }),
  };

  function invokeWithRoomClock(callback) {
    const originalDateNow = Date.now;
    const originalSetTimeout = globalThis.setTimeout;
    const originalPerformanceDescriptor = Object.getOwnPropertyDescriptor(performance, "now");
    Date.now = () => wallNowMs;
    Object.defineProperty(performance, "now", { configurable: true, value: () => monotonicNowMs });
    globalThis.setTimeout = (nextTick) => {
      scheduledTick = nextTick;
      return 0;
    };
    try {
      return callback();
    } finally {
      Date.now = originalDateNow;
      globalThis.setTimeout = originalSetTimeout;
      if (originalPerformanceDescriptor) {
        Object.defineProperty(performance, "now", originalPerformanceDescriptor);
      } else {
        delete performance.now;
      }
    }
  }
  invokeWithRoomClock(() => registerDrawGame({ of: () => namespace }));
  const games = getGamesStore(namespace);

  function connectPlayer(rejoinToken) {
    const socketHandlers = {};
    const socketEvents = [];
    const socket = {
      id: `draw-socket-${nextSocketId++}`,
      nsp: namespace,
      data: {},
      on: (eventName, callback) => { socketHandlers[eventName] = callback; },
      join(roomId) {
        if (!namespace.adapter.rooms.has(roomId)) namespace.adapter.rooms.set(roomId, new Set());
        namespace.adapter.rooms.get(roomId).add(socket.id);
      },
      leave: (roomId) => namespace.adapter.rooms.get(roomId)?.delete(socket.id),
      emit: (eventName, payload) => socketEvents.push({ eventName, payload: structuredClone(payload) }),
      to: (roomId) => ({
        emit(eventName, payload) {
          if (eventName === "drawEvent") opponentDrawEvents.push({ roomId, eventName, payload: structuredClone(payload) });
        },
      }),
    };
    namespace.sockets.set(socket.id, socket);
    invokeWithRoomClock(() => {
      connectSocket(socket);
      socketHandlers.joinGame({ gameId: "drawing-room", rejoinToken });
    });
    return {
      socket,
      socketEvents,
      input: (payload) => invokeWithRoomClock(() => socketHandlers.input(payload)),
      disconnect() {
        invokeWithRoomClock(() => socketHandlers.disconnect());
        socket.leave("drawing-room");
        namespace.sockets.delete(socket.id);
      },
    };
  }

  function tickAt(nextWallNowMs) {
    wallNowMs = nextWallNowMs;
    // Two invocations also initialize a brand-new room's monotonic clock.
    for (let invocation = 0; invocation < 2; invocation += 1) {
      monotonicNowMs += 20;
      invokeWithRoomClock(() => scheduledTick());
    }
    return roomEvents.filter((event) => event.eventName === "state").at(-1)?.payload;
  }

  return {
    connectPlayer,
    tickAt,
    getState: () => games.get("drawing-room"),
    snapshotValue: (path) => snapshotValues.get(path),
    setWallTime: (nextWallNowMs) => { wallNowMs = nextWallNowMs; },
    opponentDrawEvents,
  };
}

test("Draw waits for both owners and publishes fixed lifecycle fields before its five-second countdown", () => {
  const session = createDrawRoomSession();
  const firstClient = session.connectPlayer();
  const state = session.getState();
  assert.equal(state.started, false);
  assert.equal(state.startAt, null);
  assert.equal(state.gameOver, false);
  firstClient.input({ type: "strokeStart", strokeId: "too-early", point: { x: 0.2, y: 0.3 } });
  firstClient.input({ type: "clear" });
  const waitingPacket = session.tickAt(20000);
  assert.equal(state.strokes.length, 0);
  assert.equal(state.clearVersion, 0);
  assert.equal(state.started, false);
  assert.equal(state.startAt, null);
  assert.deepEqual(waitingPacket.n.room, {
    apiVersion: 1,
    roomId: "drawing-room",
    phase: "waiting",
    startAtMs: null,
    countdownDurationMs: 5000,
    connectedPlayers: 1,
    requiredPlayers: 2,
  });
  assert.equal(session.snapshotValue("started"), false);
  assert.equal(session.snapshotValue("startAt"), null);
  assert.equal(session.snapshotValue("gameOver"), false);
  assert.equal(session.snapshotValue("canvas.width"), 1280);
  assert.equal(session.snapshotValue("canvas.height"), 720);
  assert.equal(session.snapshotValue("players.p1.connected"), true);
  assert.equal(session.snapshotValue("players.p2.connected"), false);
  assert.equal(session.opponentDrawEvents.length, 0);

  session.connectPlayer();
  assert.equal(state.startAt, 25000);
  const countdownPacket = session.tickAt(20000);
  assert.equal(countdownPacket.n.room.phase, "countdown");
  assert.equal(countdownPacket.n.room.startAtMs, 25000);
  assert.equal(countdownPacket.n.room.countdownDurationMs, 5000);
  assert.equal(session.snapshotValue("startAt"), 25000);
  assert.equal(session.snapshotValue("started"), false);
});

test("Draw rejects every drawing action before the deadline and keeps authoritative drawing events after start", () => {
  const session = createDrawRoomSession();
  const firstClient = session.connectPlayer();
  const secondClient = session.connectPlayer();
  const state = session.getState();
  assert.equal(state.startAt, 15000);
  session.tickAt(14999);
  for (const type of ["strokeStart", "strokeMove", "strokeEnd", "clear"]) {
    firstClient.input({ type, strokeId: "art-1", point: { x: 0.2, y: 0.3 } });
  }
  assert.equal(state.started, false);
  assert.equal(state.clearVersion, 0);
  assert.equal(state.strokes.length, 0);
  assert.equal(session.opponentDrawEvents.length, 0);

  const startedPacket = session.tickAt(15000);
  assert.equal(state.started, true);
  assert.equal(state.startAt, null);
  assert.equal(state.gameOver, false);
  assert.equal(session.snapshotValue("started"), true);
  assert.equal(session.snapshotValue("startAt"), null);
  assert.equal(startedPacket.n.room.phase, "playing");
  assert.equal(startedPacket.n.room.startAtMs, 15000);
  firstClient.input({ type: "strokeStart", strokeId: "art-1", color: "#abc", size: 7.5, point: { x: 0.1234567, y: 1.2 } });
  firstClient.input({ type: "strokeMove", strokeId: "art-1", point: { x: 0.5, y: 0.6 } });
  firstClient.input({ type: "strokeEnd", strokeId: "art-1" });
  assert.deepEqual(state.strokes, [{
    id: "art-1", owner: "p1", color: "#abc", size: 7.5, completed: true,
    points: [{ x: 0.1235, y: 1 }, { x: 0.5, y: 0.6 }],
  }]);
  assert.equal(state.totalPoints, 2);
  assert.equal(state.activeStrokeIds.p1, null);
  assert.deepEqual(session.opponentDrawEvents.map((event) => { const { clearVersion, revision, ...payload } = event.payload; return { eventName: event.eventName, payload }; }), [
    { eventName: "drawEvent", payload: { action: "start", strokeId: "art-1", owner: "p1", color: "#abc", size: 7.5, point: { x: 0.1235, y: 1 } } },
    { eventName: "drawEvent", payload: { action: "move", strokeId: "art-1", owner: "p1", point: { x: 0.5, y: 0.6 } } },
    { eventName: "drawEvent", payload: { action: "end", strokeId: "art-1", owner: "p1" } },
  ]);
  secondClient.input({ type: "strokeStart", point: { x: 0.3, y: 0.4 } });
  assert.equal(state.strokes[1].owner, "p2");
  assert.equal(state.strokes[1].color, "#f97316");
  secondClient.input({ type: "clear" });
  assert.equal(state.strokes.length, 0);
  assert.equal(state.totalPoints, 0);
  assert.equal(state.clearVersion, 1);
  assert.deepEqual(session.opponentDrawEvents.at(-1).payload, { action: "clear", owner: "p2", clearVersion: 1, revision: 5 });
});

test("Draw cancels a departing owner's countdown and rejoins with a fresh five seconds while retaining strokes", () => {
  const session = createDrawRoomSession();
  const firstClient = session.connectPlayer();
  const secondClient = session.connectPlayer();
  const state = session.getState();
  session.tickAt(15000);
  firstClient.input({ type: "strokeStart", strokeId: "kept-art", point: { x: 0.2, y: 0.3 } });
  firstClient.input({ type: "strokeEnd", strokeId: "kept-art" });
  const retainedStrokes = structuredClone(state.strokes);
  const secondPlayerToken = state.players.p2.rejoinToken;
  session.setWallTime(16000);
  secondClient.disconnect();
  assert.equal(state.started, false);
  assert.equal(state.startAt, null);
  assert.deepEqual(state.strokes, retainedStrokes);
  firstClient.input({ type: "clear" });
  assert.deepEqual(state.strokes, retainedStrokes);

  session.setWallTime(17000);
  const rejoinedClient = session.connectPlayer(secondPlayerToken);
  assert.equal(rejoinedClient.socket.data.playerId, "p2");
  assert.equal(state.startAt, 22000);
  session.setWallTime(18000);
  rejoinedClient.disconnect();
  assert.equal(state.startAt, null);
  assert.equal(state.started, false);
  const cancelledPacket = session.tickAt(23000);
  assert.equal(cancelledPacket.n.room.phase, "waiting");
  assert.equal(cancelledPacket.n.room.startAtMs, null);
  assert.equal(state.started, false, "an obsolete deadline cannot start an incomplete room");

  session.setWallTime(25000);
  session.connectPlayer(secondPlayerToken);
  assert.equal(state.startAt, 30000);
  session.tickAt(29999);
  firstClient.input({ type: "clear" });
  firstClient.input({ type: "strokeStart", strokeId: "still-early", point: { x: 0.4, y: 0.5 } });
  assert.deepEqual(state.strokes, retainedStrokes);
  assert.equal(state.clearVersion, 0);
  session.tickAt(30000);
  assert.equal(state.started, true);
  firstClient.input({ type: "strokeStart", strokeId: "new-art", point: { x: 0.4, y: 0.5 } });
  assert.deepEqual(state.strokes[0], retainedStrokes[0]);
  assert.equal(state.strokes[1].id, "new-art");
});


test("Draw recovers bounded history before countdown and excludes it from periodic snapshots", () => {
  const session = createDrawRoomSession();
  const firstClient = session.connectPlayer();
  firstClient.input({ type: "syncBoard" });
  assert.deepEqual(firstClient.socketEvents.at(-1), {
    eventName: "drawBoard", payload: { strokes: [], clearVersion: 0, revision: 0 },
  });
  session.connectPlayer();
  session.tickAt(15000);
  firstClient.input({ type: "strokeStart", strokeId: "retained", point: { x: 0.2, y: 0.3 } });
  firstClient.input({ type: "strokeEnd", strokeId: "retained" });
  session.tickAt(15100);
  assert.equal(session.snapshotValue("strokes"), undefined, "full canvas never enters the frequent snapshot schema");
  assert.equal(session.snapshotValue("revision"), 2);
  firstClient.input({ type: "syncBoard" });
  const recoveredBoard = firstClient.socketEvents.at(-1).payload;
  assert.equal(recoveredBoard.strokes[0].id, "retained");
  assert.equal(recoveredBoard.revision, 2);
  recoveredBoard.strokes[0].points[0].x = 0.9;
  assert.equal(session.getState().strokes[0].points[0].x, 0.2, "recovery owns its point copies");
  firstClient.input({ type: "clear" });
  assert.deepEqual(firstClient.socketEvents.at(-1), {
    eventName: "drawEvent", payload: { action: "clear", owner: "p1", clearVersion: 1, revision: 3 },
  });
});

test("Draw ignores duplicate starts and closes both active strokes when a player disconnects", () => {
  const session = createDrawRoomSession();
  const firstClient = session.connectPlayer();
  const secondClient = session.connectPlayer();
  session.tickAt(15000);
  const firstStroke = { type: "strokeStart", strokeId: "same-id", point: { x: 0.2, y: 0.3 } };
  firstClient.input(firstStroke);
  firstClient.input(firstStroke);
  secondClient.input({ type: "strokeStart", strokeId: "other-id", point: { x: 0.3, y: 0.4 } });
  assert.equal(session.getState().strokes.length, 2);
  assert.equal(session.getState().revision, 2);
  secondClient.disconnect();
  assert.ok(session.getState().strokes.every((stroke) => stroke.completed));
  assert.deepEqual(session.getState().activeStrokeIds, { p1: null, p2: null });
});
