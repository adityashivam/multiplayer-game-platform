import test from "node:test";
import assert from "node:assert/strict";
import { registerRoadRashGame, serializeRoadRashState } from "../server/platform-backend-engine/games/roadrash.js";
import { getGamesStore } from "../server/platform-backend-engine/core/gameStore.js";
import { stepRoadRashRider } from "../public/games/roadrash/shared/simulation.js";

const NEUTRAL_ROAD_INPUT = {
  left: false,
  right: false,
  throttle: false,
  brake: false,
  kickLeft: false,
  kickRight: false,
};

/** Exercise the real registered room and input handlers without starting timers. */
function createRoadRashTestSession() {
  let connectSocket;
  let scheduledServerTick;
  const roomEvents = [];
  const namespace = {
    adapter: { rooms: new Map() },
    sockets: new Map(),
    on: (_eventName, callback) => { connectSocket = callback; },
    to: (gameId) => ({
      emit: (eventName, payload) => roomEvents.push({ gameId, eventName, payload: structuredClone(payload) }),
    }),
  };
  const originalSetTimeout = globalThis.setTimeout;
  let simulation;
  globalThis.setTimeout = (callback) => {
    scheduledServerTick = callback;
    return 0;
  };
  try {
    simulation = registerRoadRashGame({ of: () => namespace });
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

  function advanceSimulation(nowMs = 100) {
    assert.ok(simulation, "Road Rash registration exposes its simulation for deterministic stepping");
    const state = getState();
    state.__loopTick = (state.__loopTick || 0) + 1;
    state.__loopMonotonicNow = nowMs;
    simulation.step(state, 1 / 60);
  }

  function sendInputFrame(client, sequenceNumber, inputOverrides = {}) {
    const playerState = getState().players[client.socket.data.playerId];
    const inputFrame = {
      type: "inputFrame",
      protocol: 2,
      epoch: playerState.inputEpoch,
      seq: sequenceNumber,
      state: { ...NEUTRAL_ROAD_INPUT, ...inputOverrides },
    };
    client.socketHandlers.input(inputFrame);
    playerState.__lastInputReceiptMs = 100;
    return inputFrame;
  }

  function emitSnapshot() {
    globalThis.setTimeout = () => 0;
    try {
      scheduledServerTick();
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
    return roomEvents.filter((event) => event.eventName === "state").at(-1)?.payload;
  }

  function activateRace() {
    const state = getState();
    state.started = true;
    state.startAt = null;
    state.traffic = [];
    return state;
  }

  return { getState, connectPlayer, advanceSimulation, sendInputFrame, emitSnapshot, activateRace };
}

function readSnapshotField(snapshotPacket, fieldPath) {
  assert.equal(snapshotPacket.k, "f");
  return snapshotPacket.v[snapshotPacket.p.indexOf(fieldPath)];
}

test("Road Rash joins advertise queued ownership and snapshots acknowledge simulated commands", () => {
  const session = createRoadRashTestSession();
  const client = session.connectPlayer();
  session.connectPlayer();
  const state = session.activateRace();
  const joined = client.socketEvents.find((event) => event.eventName === "gameJoined").payload;
  assert.equal(joined.inputEpoch, 1);
  session.sendInputFrame(client, 1, { throttle: true, right: true });
  assert.equal(state.players.p1.lastInputSeqAck, 0);
  session.advanceSimulation();
  assert.equal(state.players.p1.speed, 275);
  assert.equal(state.players.p1.z, 275 / 60);
  assert.equal(state.players.p1.progress, 275 / 60);
  assert.equal(state.players.p1.lastInputSeqAck, 1);

  const snapshot = session.emitSnapshot();
  assert.equal(readSnapshotField(snapshot, "inputProtocol"), 2);
  assert.equal(readSnapshotField(snapshot, "roundId"), 1);
  assert.equal(readSnapshotField(snapshot, "players.p1.inputEpoch"), 1);
  assert.equal(readSnapshotField(snapshot, "players.p1.inputSeqAck"), 1);
  assert.equal(readSnapshotField(snapshot, "players.p1.inputSimulationTick"), 1);
  assert.equal(readSnapshotField(snapshot, "players.p1.progress"), 275 / 60);
});

test("Road Rash authoritative movement preserves acceleration, drag, braking and lap wrapping", () => {
  const session = createRoadRashTestSession();
  const client = session.connectPlayer();
  session.connectPlayer();
  const state = session.activateRace();
  const rider = state.players.p1;
  Object.assign(rider, { x: 0, speed: 12000, z: 119900, lapsCompleted: 0, progress: 119900 });
  session.sendInputFrame(client, 1, { throttle: true });
  session.advanceSimulation();
  assert.equal(rider.speed, 12275);
  assert.ok(Math.abs(rider.z - (12275 / 60 - 100)) < 1e-8);
  assert.equal(rider.lapsCompleted, 1);
  assert.equal(rider.progress, 119900 + 12275 / 60);

  session.sendInputFrame(client, 2, { brake: true });
  session.advanceSimulation();
  assert.ok(Math.abs(rider.speed - (12275 - 23000 / 60)) < 1e-8);
  rider.x = 1.1;
  rider.speed = 1000;
  session.sendInputFrame(client, 3);
  session.advanceSimulation();
  assert.equal(rider.speed, 550);
  assert.equal(rider.integrity, 100);
});

test("Road Rash browser movement and registered server consume the same fixed command trajectory", () => {
  const session = createRoadRashTestSession();
  const client = session.connectPlayer();
  session.connectPlayer();
  const state = session.activateRace();
  const predictedRider = structuredClone(state.players.p1);

  for (let sequenceNumber = 1; sequenceNumber <= 180; sequenceNumber += 1) {
    const inputState = {
      ...NEUTRAL_ROAD_INPUT,
      throttle: sequenceNumber < 100,
      brake: sequenceNumber >= 130,
      left: sequenceNumber >= 30 && sequenceNumber <= 60,
      right: sequenceNumber >= 90 && sequenceNumber <= 120,
    };
    stepRoadRashRider(predictedRider, inputState, 1 / 60, { active: true });
    session.sendInputFrame(client, sequenceNumber, inputState);
    session.advanceSimulation();
    for (const coordinate of ["x", "speed", "progress", "z", "lapsCompleted"]) {
      assert.equal(state.players.p1[coordinate], predictedRider[coordinate],
        `${coordinate} diverged on command ${sequenceNumber}`);
    }
    assert.equal(state.players.p1.lastInputSeqAck, sequenceNumber);
  }
});

test("Road Rash coalesced short kick presses apply once and collisions stay authoritative", () => {
  const session = createRoadRashTestSession();
  const client = session.connectPlayer();
  session.connectPlayer();
  const state = session.activateRace();
  Object.assign(state.players.p1, { x: -0.15, speed: 12000 });
  Object.assign(state.players.p2, { x: 0.15, speed: 12000 });
  session.sendInputFrame(client, 1, { throttle: true });
  session.advanceSimulation();
  session.advanceSimulation();
  session.sendInputFrame(client, 2, { throttle: true, kickRight: true });
  session.sendInputFrame(client, 3, { throttle: true });
  session.advanceSimulation();
  assert.equal(state.players.p1.lastInputSeqAck, 3);
  assert.equal(state.players.p2.integrity, 84);
  assert.equal(state.players.p1.kickSide, 1);
  assert.equal(serializeRoadRashState(state).players.p1.kickActive, true);
  session.advanceSimulation();
  assert.equal(state.players.p2.integrity, 84);

  const traffic = { id: "t0", type: "car", variant: 0, x: state.players.p1.x, z: state.players.p1.z + 200, progress: state.players.p1.progress + 200, speed: 0, phase: 0 };
  state.traffic.push(traffic);
  session.advanceSimulation();
  assert.equal(state.players.p1.integrity, 90);
  assert.ok(state.players.p1.speed < 7000);
});

test("Road Rash rejects a kick below minimum speed without replaying it on held movement steps", () => {
  const session = createRoadRashTestSession();
  const client = session.connectPlayer();
  session.connectPlayer();
  const state = session.activateRace();
  state.players.p1.speed = 2200;
  session.sendInputFrame(client, 1, { throttle: true, kickRight: true });
  for (let tick = 0; tick < 20; tick += 1) session.advanceSimulation(100 + tick * 1000 / 60);
  assert.equal(state.players.p1.kickSide, 0);
  assert.equal(serializeRoadRashState(state).players.p1.kickActive, false);
  assert.equal(state.players.p1.kickCooldown, 0);
  assert.equal(state.players.p1.lastInputSeqAck, 1);
  assert.ok(state.players.p1.speed > 2280);
});

test("Road Rash rejects unknown control fields and previous queued epochs", () => {
  const session = createRoadRashTestSession();
  const client = session.connectPlayer();
  session.connectPlayer();
  const state = session.activateRace();
  for (const overrides of [{ throttle: 1 }, { integrity: 999 }, { progress: 999999 }]) {
    session.sendInputFrame(client, 1, overrides);
  }
  session.advanceSimulation();
  assert.equal(state.players.p1.speed, 0);
  assert.equal(state.players.p1.integrity, 100);
  assert.equal(state.players.p1.lastInputSeqAck, 0);
  session.sendInputFrame(client, 1, { throttle: true });
  client.socketHandlers.input({ type: "brake", value: true });
  session.advanceSimulation();
  assert.equal(state.players.p1.speed, 275);
});

test("Road Rash disconnect pauses progress and clears both riders' queued or held controls", () => {
  const session = createRoadRashTestSession();
  const firstClient = session.connectPlayer();
  const secondClient = session.connectPlayer();
  const state = session.activateRace();
  const firstRider = state.players.p1;
  const secondRider = state.players.p2;
  const rejoinToken = firstRider.rejoinToken;
  const previousFrame = session.sendInputFrame(firstClient, 1, { throttle: true, kickRight: true });
  session.sendInputFrame(secondClient, 1, { throttle: true, left: true });
  Object.assign(firstRider, { x: -0.25, speed: 9000, integrity: 67, progress: 124000, z: 4000, lapsCompleted: 1 });
  firstClient.disconnect();
  assert.equal(state.started, false);
  assert.equal(state.roundId, 1);
  assert.equal(firstRider.inputEpoch, 2);
  assert.equal(secondRider.inputEpoch, 2);
  assert.deepEqual(firstRider.input, NEUTRAL_ROAD_INPUT);
  assert.deepEqual(secondRider.input, NEUTRAL_ROAD_INPUT);
  session.advanceSimulation();
  assert.equal(firstRider.progress, 124000);
  assert.equal(secondRider.x, 0.28);

  const rejoined = session.connectPlayer(rejoinToken);
  assert.equal(rejoined.socket.data.playerId, "p1");
  assert.equal(firstRider.rejoinToken, rejoinToken);
  assert.equal(firstRider.inputEpoch, 3);
  assert.equal(firstRider.integrity, 67);
  assert.equal(firstRider.progress, 124000);
  rejoined.socketHandlers.input(previousFrame);
  session.advanceSimulation();
  assert.equal(firstRider.lastInputSeqAck, 0);
  assert.equal(firstRider.kickSide, 0);
});

test("Road Rash rematches retain seats and tokens with fresh round and input ownership", () => {
  const session = createRoadRashTestSession();
  const firstClient = session.connectPlayer();
  const secondClient = session.connectPlayer();
  const previousState = session.activateRace();
  const staleFrame = session.sendInputFrame(firstClient, 1, { throttle: true });
  previousState.gameOver = true;
  firstClient.socketHandlers.rematch();
  secondClient.socketHandlers.rematch();
  const nextState = session.getState();
  assert.notEqual(nextState, previousState);
  assert.equal(nextState.roundId, 2);
  for (const playerId of ["p1", "p2"]) {
    assert.equal(nextState.players[playerId].connected, true);
    assert.equal(nextState.players[playerId].rejoinToken, previousState.players[playerId].rejoinToken);
    assert.equal(nextState.players[playerId].inputEpoch, 2);
    assert.equal(nextState.players[playerId].progress, 0);
    assert.equal(nextState.players[playerId].integrity, 100);
  }
  firstClient.socketHandlers.input(staleFrame);
  session.advanceSimulation();
  assert.equal(nextState.players.p1.lastInputSeqAck, 0);
});

test("Road Rash both-seat reconnects preserve the paused race until room cleanup", () => {
  const session = createRoadRashTestSession();
  const firstClient = session.connectPlayer();
  const secondClient = session.connectPlayer();
  const state = session.activateRace();
  const firstToken = state.players.p1.rejoinToken;
  const secondToken = state.players.p2.rejoinToken;
  Object.assign(state.players.p1, { z: 4000, lapsCompleted: 2, progress: 244000, integrity: 71 });
  Object.assign(state.players.p2, { z: 8000, lapsCompleted: 1, progress: 128000, integrity: 82 });
  firstClient.disconnect();
  secondClient.disconnect();
  assert.ok(state.abandonedAt > 0);
  assert.equal(state.roundId, 1);
  session.advanceSimulation();
  assert.equal(state.players.p1.progress, 244000);
  assert.equal(state.players.p2.progress, 128000);

  assert.equal(session.connectPlayer(firstToken).socket.data.playerId, "p1");
  assert.equal(session.connectPlayer(secondToken).socket.data.playerId, "p2");
  assert.equal(state.abandonedAt, null);
  assert.equal(state.players.p1.integrity, 71);
  assert.equal(state.players.p2.integrity, 82);
  assert.equal(state.players.p1.progress, 244000);
  assert.equal(state.players.p2.progress, 128000);
  assert.ok(state.startAt > 0);
});

test("Road Rash stale-input recovery clears throttle once and leaves the shared coast rule active", () => {
  const session = createRoadRashTestSession();
  const client = session.connectPlayer();
  session.connectPlayer();
  const state = session.activateRace();
  session.sendInputFrame(client, 1, { throttle: true });
  session.advanceSimulation(100);
  assert.equal(state.players.p1.speed, 275);
  session.advanceSimulation(601);
  assert.equal(state.players.p1.speed, 125);
  assert.equal(state.players.p1.inputEpoch, 2);
  assert.deepEqual(state.players.p1.input, NEUTRAL_ROAD_INPUT);
  session.advanceSimulation(700);
  assert.equal(state.players.p1.speed, 0);
  assert.equal(state.players.p1.inputEpoch, 2);
});

test("Road Rash final lap ends authoritatively without wrapping progress into a new race", () => {
  const session = createRoadRashTestSession();
  const client = session.connectPlayer();
  session.connectPlayer();
  const state = session.activateRace();
  Object.assign(state.players.p1, { speed: 12000, z: 119900, lapsCompleted: 9, progress: 1199900 });
  session.sendInputFrame(client, 1, { throttle: true });
  session.advanceSimulation();
  assert.equal(state.players.p1.progress, 1200000);
  assert.equal(state.players.p1.lapsCompleted, 10);
  assert.equal(state.players.p1.z, 0);
  assert.equal(state.players.p1.speed, 0);
  assert.equal(state.players.p1.finished, true);
  assert.equal(state.gameOver, true);
  assert.equal(state.winner, "p1");
});
