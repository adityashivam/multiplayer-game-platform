import test from "node:test";
import assert from "node:assert/strict";
import { registerDeadShiftGame, serializeDeadShiftState } from "../server/platform-backend-engine/games/dead-shift.js";
import { getGamesStore } from "../server/platform-backend-engine/core/gameStore.js";
import { DEAD_SHIFT_INPUT_TEMPLATE } from "../public/games/dead-shift/shared/config.js";
import { spawnDeadShiftEnemy } from "../public/games/dead-shift/shared/simulation.js";

function createDeadShiftTestSession() {
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
    simulation = registerDeadShiftGame({ of: () => namespace });
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
      socket, socketHandlers, socketEvents,
      disconnect() {
        socketHandlers.disconnect();
        socket.leave("room");
        namespace.sockets.delete(socket.id);
      },
    };
  }
  function advanceSimulation(nowMs = Date.now()) {
    const state = getState();
    state.__loopTick = (state.__loopTick || 0) + 1;
    state.__loopMonotonicNow = 100;
    simulation.step(state, 1 / 60, { nowMs });
  }
  function sendInputFrame(client, seq, overrides = {}) {
    const player = getState().players[client.socket.data.playerId];
    const frame = {
      type: "inputFrame", protocol: 2, epoch: player.inputEpoch, seq,
      state: { ...DEAD_SHIFT_INPUT_TEMPLATE, ...overrides },
    };
    client.socketHandlers.input(frame);
    player.__lastInputReceiptMs = 100;
    return frame;
  }
  function emitSnapshot(wallNowMs = Date.now()) {
    const originalDateNow = Date.now;
    Date.now = () => wallNowMs;
    globalThis.setTimeout = () => 0;
    try { scheduledTick(); } finally {
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

test("Dead Shift countdown waits for two players and consumes numeric queued input with SDK acknowledgements", () => {
  const session = createDeadShiftTestSession();
  const firstClient = session.connectPlayer();
  const state = session.getState();
  assert.equal(state.startAt, null);
  session.sendInputFrame(firstClient, 1, { moveZ: 1 });
  session.advanceSimulation();
  assert.equal(state.players.p1.z, 7);
  session.connectPlayer();
  const startAt = state.startAt;
  assert.ok(startAt > 0);
  session.advanceSimulation(startAt - 1);
  assert.equal(state.started, false);
  session.sendInputFrame(firstClient, 2, { moveZ: 1, yaw: 0.2, weapon: 1 });
  session.advanceSimulation(startAt);
  assert.equal(state.started, true);
  assert.equal(state.startAt, null);
  assert.ok(state.players.p1.z < 7);
  assert.equal(state.players.p1.weapon, 1);
  const snapshot = serializeDeadShiftState(state);
  assert.equal(snapshot.roundId, 1);
  assert.equal(snapshot.inputProtocol, 2);
  assert.equal(snapshot.players.p1.inputSeqAck, 2);
  assert.equal(snapshot.players.p1.inputEpoch, 1);
  assert.equal(snapshot.players.p1.connected, true);
});

test("Dead Shift rejects malformed numeric commands and keeps kills server-owned", () => {
  const session = createDeadShiftTestSession();
  const client = session.connectPlayer();
  session.connectPlayer();
  const state = activateRound(session);
  for (const invalidInput of [{ moveX: 2 }, { yaw: NaN }, { weapon: 1.5 }, { kills: 900 }, { moveZ: true }]) {
    session.sendInputFrame(client, 1, invalidInput);
  }
  session.advanceSimulation();
  assert.equal(state.players.p1.z, 7);
  assert.equal(state.players.p1.kills, 0);
  assert.equal(state.players.p1.lastInputSeqAck, 0);
  session.sendInputFrame(client, 1, { moveZ: 1 });
  session.advanceSimulation();
  assert.ok(state.players.p1.z < 7);
  assert.equal(state.players.p1.lastInputSeqAck, 1);
});

test("Dead Shift disconnect/rejoin preserves the round and rejects previous ownership frames", () => {
  const session = createDeadShiftTestSession();
  const client = session.connectPlayer();
  session.connectPlayer();
  const state = activateRound(session);
  state.timer = 42;
  Object.assign(state.players.p1, { health: 63, kills: 5 });
  const enemy = spawnDeadShiftEnemy(state, "walker", -12, -2);
  const previousFrame = session.sendInputFrame(client, 1, { moveZ: 1, fire: true });
  const token = state.players.p1.rejoinToken;
  client.disconnect();
  assert.equal(state.started, false);
  assert.equal(state.players.p1.inputEpoch, 2);
  assert.equal(state.players.p1.input.moveZ, 0);
  const rejoinedClient = session.connectPlayer(token);
  assert.equal(rejoinedClient.socket.data.playerId, "p1");
  assert.equal(state.players.p1.inputEpoch, 3);
  assert.equal(state.players.p1.health, 63);
  assert.equal(state.players.p1.kills, 5);
  assert.equal(state.timer, 42);
  assert.equal(state.roundId, 1);
  assert.equal(serializeDeadShiftState(state).roundId, 1);
  assert.ok(state.enemies.some((enemyState) => enemyState.id === enemy.id));
  rejoinedClient.socketHandlers.input(previousFrame);
  session.advanceSimulation(state.startAt);
  assert.equal(state.players.p1.z, 7);
  assert.equal(state.players.p1.shotId, 0);
  assert.equal(state.players.p1.lastInputSeqAck, 0);
});

test("Dead Shift repeated room joins keep their slot and epoch while a third client sees roomFull", () => {
  const session = createDeadShiftTestSession();
  const firstClient = session.connectPlayer();
  session.connectPlayer();
  const state = session.getState();
  const token = state.players.p1.rejoinToken;
  const epoch = state.players.p1.inputEpoch;
  firstClient.socketHandlers.joinGame({ gameId: "room", rejoinToken: token });
  assert.equal(firstClient.socket.data.playerId, "p1");
  assert.equal(state.players.p1.inputEpoch, epoch);
  assert.equal(state.players.p1.rejoinToken, token);
  const thirdClient = session.connectPlayer();
  assert.ok(thirdClient.socketEvents.some((event) => event.eventName === "roomFull"));
  assert.equal(thirdClient.socket.data.playerId, undefined);
});

test("Dead Shift rematches clear entities and scores, preserve tokens, and advance both epochs", () => {
  const session = createDeadShiftTestSession();
  const firstClient = session.connectPlayer();
  const secondClient = session.connectPlayer();
  const oldState = activateRound(session);
  const previousFrame = session.sendInputFrame(firstClient, 1, { fire: true });
  spawnDeadShiftEnemy(oldState, "brute", 0, -9);
  oldState.players.p1.kills = 12;
  oldState.gameOver = true;
  firstClient.socketHandlers.rematch();
  secondClient.socketHandlers.rematch();
  const state = session.getState();
  assert.notEqual(state, oldState);
  assert.equal(state.roundId, 2);
  assert.equal(serializeDeadShiftState(state).roundId, 2);
  assert.equal(state.timer, 90);
  assert.equal(state.players.p1.kills, 0);
  assert.equal(state.players.p1.inputEpoch, 2);
  assert.equal(state.players.p2.inputEpoch, 2);
  assert.equal(state.players.p1.connected, true);
  assert.equal(state.players.p1.rejoinToken, oldState.players.p1.rejoinToken);
  assert.equal(state.players.p2.rejoinToken, oldState.players.p2.rejoinToken);
  assert.ok(state.enemies.every((enemy) => enemy.id === 0));
  assert.ok(state.startAt > 0);
  firstClient.socketHandlers.input(previousFrame);
  session.advanceSimulation(state.startAt);
  assert.equal(state.players.p1.shotId, 0);
  assert.equal(state.players.p1.lastInputSeqAck, 0);
});

test("Dead Shift fixed pools keep packed snapshot paths stable before and after combat", () => {
  const session = createDeadShiftTestSession();
  const client = session.connectPlayer();
  session.connectPlayer();
  const state = activateRound(session);
  const firstPacket = session.emitSnapshot();
  assert.equal(firstPacket.k, "f");
  assert.ok(firstPacket.p.includes("enemies.31.health"));
  assert.ok(firstPacket.p.includes("projectiles.47.ownerId"));
  assert.ok(firstPacket.p.includes("events.31.kind"));
  Object.assign(state.players.p1, { x: -12, z: 7 });
  const enemy = spawnDeadShiftEnemy(state, "walker", -12, 2);
  session.sendInputFrame(client, 1, { fire: true });
  session.advanceSimulation();
  const snapshot = serializeDeadShiftState(state);
  assert.equal(snapshot.players.p1.kills, 1);
  assert.equal(snapshot.enemies.find((enemyState) => enemyState.id === enemy.id).health, 0);
  const secondPacket = session.emitSnapshot();
  const values = firstPacket.v.slice();
  if (secondPacket.k === "d") {
    for (const [index, value] of secondPacket.c) values[index] = value;
  } else {
    assert.deepEqual(secondPacket.p, firstPacket.p);
    values.splice(0, values.length, ...secondPacket.v);
  }
  assert.equal(values[firstPacket.p.indexOf("players.p1.kills")], 1);
  assert.ok(firstPacket.p.some((path, index) => /^events\.\d+\.kind$/.test(path) && values[index] === "kill"));
  assert.equal(snapshot.enemies.length, 32);
  assert.equal(snapshot.projectiles.length, 48);
  assert.equal(snapshot.events.length, 32);
});

test("Dead Shift abandoned rooms stop simulation and are removed after bounded grace", () => {
  const session = createDeadShiftTestSession();
  const firstClient = session.connectPlayer();
  const secondClient = session.connectPlayer();
  const state = activateRound(session);
  state.timer = 31;
  firstClient.disconnect();
  secondClient.disconnect();
  assert.equal(state.started, false);
  assert.ok(state.abandonedAt > 0);
  session.advanceSimulation();
  assert.equal(state.timer, 31);
  session.emitSnapshot(state.abandonedAt + 30001);
  assert.equal(session.getState(), undefined);
});

test("a short fire press survives coalesced commands and stops after the released frame", () => {
  const session = createDeadShiftTestSession();
  const client = session.connectPlayer();
  session.connectPlayer();
  const state = activateRound(session);
  const player = state.players.p1;
  player.inputSimulationTick = 3;
  session.sendInputFrame(client, 1, { fire: true });
  session.sendInputFrame(client, 2, { fire: false });
  session.advanceSimulation();
  assert.equal(player.shotId, 1);
  assert.equal(player.lastInputSeqAck, 2);
  assert.equal(player.input.fire, false);
  for (let index = 0; index < 20; index += 1) session.advanceSimulation();
  assert.equal(player.shotId, 1);
  assert.equal(player.ammo, 29);
});
