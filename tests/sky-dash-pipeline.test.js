import test from "node:test";
import assert from "node:assert/strict";
import { registerSkyDashGame, serializeSkyDashState } from "../server/platform-backend-engine/games/sky-dash.js";
import { getGamesStore } from "../server/platform-backend-engine/core/gameStore.js";
import { SKY_DASH_INPUT_TEMPLATE } from "../public/games/sky-dash/shared/config.js";

function createSkyDashTestSession(options) {
  let connectSocket;
  let scheduledTick;
  const roomEvents = [];
  const namespace = {
    adapter: { rooms: new Map() },
    sockets: new Map(),
    on: (_eventName, callback) => { connectSocket = callback; },
    to: (gameId) => ({ emit: (eventName, payload) => roomEvents.push({ gameId, eventName, payload: structuredClone(payload) }) }),
  };
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (callback) => {
    scheduledTick = callback;
    return 0;
  };
  let simulation;
  try {
    simulation = registerSkyDashGame({ of: () => namespace }, options);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
  const games = getGamesStore(namespace);
  let nextSocketId = 1;
  const getState = () => games.get("room");
  function connectPlayer(rejoinToken) {
    const socketHandlers = {};
    const socketEvents = [];
    const socket = {
      id: `socket-${nextSocketId++}`,
      nsp: namespace,
      data: {},
      on: (eventName, callback) => { socketHandlers[eventName] = callback; },
      join: (gameId) => {
        if (!namespace.adapter.rooms.has(gameId)) namespace.adapter.rooms.set(gameId, new Set());
        namespace.adapter.rooms.get(gameId).add(socket.id);
      },
      leave: (gameId) => namespace.adapter.rooms.get(gameId)?.delete(socket.id),
      emit: (eventName, payload) => socketEvents.push({ eventName, payload }),
      to: () => ({ emit() {} }),
    };
    namespace.sockets.set(socket.id, socket);
    connectSocket(socket);
    socketHandlers.joinGame({ gameId: "room", rejoinToken });
    return {
      socket,
      socketHandlers,
      socketEvents,
      disconnect() {
        socketHandlers.disconnect();
        socket.leave("room");
        namespace.sockets.delete(socket.id);
      },
    };
  }
  function advanceSimulation(nowMs = Date.now(), monotonicNowMs = 100) {
    const state = getState();
    state.__loopTick = (state.__loopTick || 0) + 1;
    state.__loopMonotonicNow = monotonicNowMs;
    simulation.step(state, 1 / 60, { nowMs });
  }
  function sendInputFrame(client, seq, overrides = {}) {
    const runner = getState().players[client.socket.data.playerId];
    const inputFrame = {
      type: "inputFrame", protocol: 2, epoch: runner.inputEpoch, seq,
      state: { ...SKY_DASH_INPUT_TEMPLATE, ...overrides },
    };
    client.socketHandlers.input(inputFrame);
    runner.__lastInputReceiptMs = 100;
    return inputFrame;
  }
  function emitSnapshot(wallNowMs = Date.now()) {
    const originalDateNow = Date.now;
    Date.now = () => wallNowMs;
    globalThis.setTimeout = () => 0;
    try {
      scheduledTick();
    } finally {
      Date.now = originalDateNow;
      globalThis.setTimeout = originalSetTimeout;
    }
    return roomEvents.filter((event) => event.eventName === "state").at(-1)?.payload;
  }
  return { getState, connectPlayer, advanceSimulation, sendInputFrame, emitSnapshot, roomEvents };
}

function activateRound(session) {
  const state = session.getState();
  state.started = true;
  state.startAt = null;
  return state;
}

test("Sky Dash countdown requires two humans while bots remain actors outside socket seats", () => {
  const session = createSkyDashTestSession();
  const firstClient = session.connectPlayer();
  const state = session.getState();
  const spawnZ = state.players.p1.z;
  assert.equal(state.startAt, null);
  assert.equal(state.bots.length, 3);
  session.sendInputFrame(firstClient, 1, { moveZ: 1 });
  session.advanceSimulation();
  assert.equal(state.players.p1.z, spawnZ);
  assert.equal(state.timeSec, 0);
  const secondClient = session.connectPlayer();
  assert.equal(secondClient.socket.data.playerId, "p2");
  const startAt = state.startAt;
  session.advanceSimulation(startAt - 1);
  assert.equal(state.started, false);
  session.sendInputFrame(firstClient, 2, { moveZ: 1 });
  session.advanceSimulation(startAt);
  assert.equal(state.started, true);
  assert.ok(state.players.p1.z < spawnZ);
  assert.ok(state.timeSec > 0);
  const snapshot = serializeSkyDashState(state);
  assert.equal(snapshot.players.p1.inputSeqAck, 2);
  assert.equal(snapshot.players.p1.inputEpoch, 1);
  assert.equal(snapshot.inputProtocol, 2);
});

test("Sky Dash rejects malformed movement and server-owned progress updates", () => {
  const session = createSkyDashTestSession();
  const client = session.connectPlayer();
  session.connectPlayer();
  const state = activateRound(session);
  const spawnZ = state.players.p1.z;
  for (const invalidInput of [{ moveX: 2 }, { moveZ: NaN }, { dash: 1 }, { checkpoint: 3 }, { moveZ: true }]) {
    session.sendInputFrame(client, 1, invalidInput);
  }
  session.advanceSimulation();
  assert.equal(state.players.p1.z, spawnZ);
  assert.equal(state.players.p1.checkpoint, 0);
  assert.equal(state.players.p1.lastInputSeqAck, 0);
  session.sendInputFrame(client, 1, { moveZ: 1 });
  session.advanceSimulation();
  assert.ok(state.players.p1.z < spawnZ);
  assert.equal(state.players.p1.lastInputSeqAck, 1);
});

test("Sky Dash disconnect and rejoin preserve course time and checkpoints while advancing input ownership", () => {
  const session = createSkyDashTestSession();
  const client = session.connectPlayer();
  session.connectPlayer();
  const state = activateRound(session);
  const runner = state.players.p1;
  Object.assign(runner, { checkpoint: 2, progress: 2.3, x: 2, y: 1.2, z: -70, supportId: 6 });
  state.timeSec = 28;
  state.timer = 62;
  Object.assign(state.seesaws[0], { angle: 0.17, angularVelocity: -0.2 });
  const pausedSeesaws = structuredClone(state.seesaws);
  const previousFrame = session.sendInputFrame(client, 1, { moveZ: 1, dash: true });
  const token = runner.rejoinToken;
  client.disconnect();
  assert.equal(state.started, false);
  assert.equal(runner.inputEpoch, 2);
  assert.equal(runner.input.moveZ, 0);
  const beforePause = structuredClone(state.bots);
  session.advanceSimulation();
  assert.equal(state.timeSec, 28);
  assert.equal(state.timer, 62);
  assert.deepEqual(state.bots, beforePause);
  assert.deepEqual(state.seesaws, pausedSeesaws);
  const rejoinedClient = session.connectPlayer(token);
  assert.equal(rejoinedClient.socket.data.playerId, "p1");
  assert.equal(runner.inputEpoch, 3);
  assert.equal(runner.checkpoint, 2);
  assert.equal(runner.z, -70);
  assert.equal(state.roundId, 1);
  assert.deepEqual(state.seesaws, pausedSeesaws);
  rejoinedClient.socketHandlers.input(previousFrame);
  session.advanceSimulation(state.startAt);
  assert.equal(runner.lastInputSeqAck, 0);
  assert.equal(runner.dashCooldownSec, 0);
  assert.ok(state.timeSec > 28);
});

test("Sky Dash repeat joins retain ownership and a third client cannot claim a bot", () => {
  const session = createSkyDashTestSession();
  const client = session.connectPlayer();
  session.connectPlayer();
  const runner = session.getState().players.p1;
  const epoch = runner.inputEpoch;
  client.socketHandlers.joinGame({ gameId: "room", rejoinToken: runner.rejoinToken });
  assert.equal(runner.inputEpoch, epoch);
  assert.equal(client.socket.data.playerId, "p1");
  const excessClient = session.connectPlayer();
  assert.ok(excessClient.socketEvents.some((event) => event.eventName === "roomFull"));
  assert.equal(excessClient.socket.data.playerId, undefined);
  assert.equal(session.getState().bots.length, 3);
});

test("Sky Dash rematches clear actions and results, preserve tokens, and increment the round and epochs", () => {
  const session = createSkyDashTestSession();
  const firstClient = session.connectPlayer();
  const secondClient = session.connectPlayer();
  const oldState = activateRound(session);
  const previousFrame = session.sendInputFrame(firstClient, 1, { moveZ: 1, dash: true });
  Object.assign(oldState.players.p1, { checkpoint: 3, action: "dive", actionTimeSec: 0.2, respawnId: 5 });
  Object.assign(oldState.bots[0], { finished: true, finishTimeSec: 23, checkpoint: 3 });
  Object.assign(oldState.seesaws[0], { angle: 0.2, angularVelocity: 0.4 });
  oldState.gameOver = true;
  firstClient.socketHandlers.rematch();
  secondClient.socketHandlers.rematch();
  const state = session.getState();
  assert.notEqual(state, oldState);
  assert.equal(state.roundId, 2);
  assert.equal(state.timeSec, 0);
  assert.equal(state.timer, 90);
  assert.equal(state.players.p1.checkpoint, 0);
  assert.equal(state.players.p1.action, "idle");
  assert.equal(state.players.p1.respawnId, 0);
  assert.equal(state.players.p1.inputEpoch, 2);
  assert.equal(state.players.p2.inputEpoch, 2);
  assert.equal(state.players.p1.rejoinToken, oldState.players.p1.rejoinToken);
  assert.equal(state.players.p2.rejoinToken, oldState.players.p2.rejoinToken);
  assert.ok(state.bots.every((bot) => !bot.finished && bot.checkpoint === 0));
  assert.deepEqual(state.seesaws, [
    { platformId: 3, angle: 0, angularVelocity: 0 },
    { platformId: 4, angle: 0, angularVelocity: 0 },
    { platformId: 5, angle: 0, angularVelocity: 0 },
  ]);
  assert.ok(state.startAt > 0);
  firstClient.socketHandlers.input(previousFrame);
  session.advanceSimulation(state.startAt);
  assert.equal(state.players.p1.lastInputSeqAck, 0);
  assert.equal(state.players.p1.dashCooldownSec, 0);
});

test("Sky Dash packed snapshots keep actor, action and standing leaves stable through full and delta delivery", (testContext) => {
  // Snapshot assertions must not advance physics when the test process is busy.
  testContext.mock.method(performance, "now", () => 100);
  const session = createSkyDashTestSession();
  const client = session.connectPlayer();
  session.connectPlayer();
  const state = activateRound(session);
  const firstPacket = session.emitSnapshot();
  assert.equal(firstPacket.k, "f");
  for (const snapshotPath of ["bots.2.respawnId", "bots.2.finishTimeSec", "players.p1.hitSec", "players.p2.actionTimeSec", "standings.4.id", "seesaws.2.angularVelocity", "seesaws.0.angle", "timeSec"]) {
    assert.ok(firstPacket.p.includes(snapshotPath), snapshotPath);
  }
  const snapshot = serializeSkyDashState(state);
  assert.equal(Object.hasOwn(snapshot.players.p1, "rejoinToken"), false);
  assert.equal(Object.hasOwn(snapshot.players.p1, "input"), false);
  session.sendInputFrame(client, 1, { moveZ: 1, dash: true });
  session.advanceSimulation();
  state.seesaws[0].angle = 0.125;
  const secondPacket = session.emitSnapshot();
  const values = firstPacket.v.slice();
  if (secondPacket.k === "d") {
    for (const [pathIndex, value] of secondPacket.c) values[pathIndex] = value;
  } else {
    assert.deepEqual(secondPacket.p, firstPacket.p);
    values.splice(0, values.length, ...secondPacket.v);
  }
  assert.equal(values[firstPacket.p.indexOf("players.p1.action")], "dash");
  assert.equal(values[firstPacket.p.indexOf("players.p1.inputSeqAck")], 1);
  assert.equal(values[firstPacket.p.indexOf("seesaws.0.angle")], 0.125);
  assert.equal(snapshot.bots.length, 3);
  assert.equal(snapshot.standings.length, 5);
  assert.equal(snapshot.seesaws.length, 3);
  assert.equal(snapshot.seesaws[0].angle, 0);
  assert.equal(typeof snapshot.bots[0].id, "string");
});

test("Sky Dash short jump presses survive coalescing and starvation releases held actions through the SDK", () => {
  const session = createSkyDashTestSession();
  const client = session.connectPlayer();
  session.connectPlayer();
  const state = activateRound(session);
  const runner = state.players.p1;
  runner.inputSimulationTick = 3;
  session.sendInputFrame(client, 1, { jump: true });
  session.sendInputFrame(client, 2, { jump: false });
  session.advanceSimulation();
  assert.ok(runner.y > 0 && runner.vy > 0);
  assert.equal(runner.lastInputSeqAck, 2);
  assert.equal(runner.input.jump, false);
  const previousEpoch = runner.inputEpoch;
  session.sendInputFrame(client, 3, { moveZ: 1, dash: true });
  session.advanceSimulation(Date.now(), 1000);
  assert.equal(runner.inputEpoch, previousEpoch + 1);
  assert.equal(runner.input.moveZ, 0);
  assert.equal(runner.dashHeld, false);
  assert.equal(runner.lastInputSeqAck, 0);
});

test("Sky Dash configured four-human rooms wait for every owner while retaining exactly two bots", () => {
  const session = createSkyDashTestSession({ playerIds: ["red", "green", "blue", "gold"], botCount: 2 });
  const clients = [session.connectPlayer(), session.connectPlayer(), session.connectPlayer()];
  const state = session.getState();
  assert.equal(state.startAt, null);
  clients.push(session.connectPlayer());
  assert.deepEqual(clients.map((client) => client.socket.data.playerId), ["red", "green", "blue", "gold"]);
  assert.equal(state.bots.length, 2);
  assert.ok(state.startAt > 0);
  const snapshot = serializeSkyDashState(state);
  assert.deepEqual(Object.keys(snapshot.players), ["red", "green", "blue", "gold"]);
  assert.equal(snapshot.standings.length, 6);
  assert.ok(session.connectPlayer().socketEvents.some((event) => event.eventName === "roomFull"));
});

test("Sky Dash abandoned rooms freeze and expire after their reconnect grace", () => {
  const session = createSkyDashTestSession();
  const firstClient = session.connectPlayer();
  const secondClient = session.connectPlayer();
  const state = activateRound(session);
  state.timeSec = 45;
  state.timer = 45;
  firstClient.disconnect();
  secondClient.disconnect();
  assert.equal(state.started, false);
  assert.ok(state.abandonedAt > 0);
  session.advanceSimulation();
  assert.equal(state.timeSec, 45);
  session.emitSnapshot(state.abandonedAt + 30001);
  assert.equal(session.getState(), undefined);
});
