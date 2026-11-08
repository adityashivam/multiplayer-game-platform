import test from "node:test";
import assert from "node:assert/strict";
import { registerPongGame } from "../server/platform-backend-engine/games/pong.js";
import { getGamesStore } from "../server/platform-backend-engine/core/gameStore.js";

function createPongTestSession() {
  let connectSocket;
  let scheduledServerTick;
  const snapshotPackets = [];
  const namespace = {
    adapter: { rooms: new Map() },
    sockets: new Map(),
    on: (_eventName, callback) => {
      connectSocket = callback;
    },
    to: () => ({
      emit: (eventName, snapshotPacket) => {
        if (eventName === "state") {
          snapshotPackets.push(snapshotPacket);
        }
      },
    }),
  };
  const originalSetTimeout = globalThis.setTimeout;
  let simulation;
  globalThis.setTimeout = (callback) => {
    scheduledServerTick = callback;
    return 0;
  };
  try {
    simulation = registerPongGame({ of: () => namespace });
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }

  const games = getGamesStore(namespace);
  let nextSocketId = 1;
  const getState = () => games.get("room");
  const connectPlayer = (rejoinToken) => {
    const socketHandlers = {};
    const socketEvents = [];
    const socket = {
      id: `socket-${nextSocketId++}`,
      data: {},
      on: (eventName, callback) => {
        socketHandlers[eventName] = callback;
      },
      join: (gameId) => {
        if (!namespace.adapter.rooms.has(gameId)) {
          namespace.adapter.rooms.set(gameId, new Set());
        }
        namespace.adapter.rooms.get(gameId).add(socket.id);
      },
      leave: (gameId) => {
        namespace.adapter.rooms.get(gameId)?.delete(socket.id);
      },
      emit: (eventName, socketPayload) => socketEvents.push([eventName, socketPayload]),
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
  };
  const advanceSimulation = (nowMs = 100) => {
    const state = getState();
    state.__loopTick = (state.__loopTick || 0) + 1;
    state.__loopMonotonicNow = nowMs;
    simulation.step(state, 1 / 60);
  };
  const sendInputFrame = (client, sequenceNumber, inputOverrides = {}) => {
    const playerState = getState().players[client.socket.data.playerId];
    const inputFrame = {
      type: "inputFrame",
      protocol: 2,
      epoch: playerState.inputEpoch,
      seq: sequenceNumber,
      state: { up: false, down: false, ...inputOverrides },
    };
    client.socketHandlers.input(inputFrame);
    playerState.__lastInputReceiptMs = 100;
    return inputFrame;
  };
  const emitSnapshot = () => {
    globalThis.setTimeout = () => 0;
    try {
      scheduledServerTick();
    } finally {
      globalThis.setTimeout = originalSetTimeout;
    }
    return snapshotPackets.at(-1);
  };

  return { getState, connectPlayer, advanceSimulation, sendInputFrame, emitSnapshot };
}

function readFullSnapshotField(snapshotPacket, fieldPath) {
  assert.equal(snapshotPacket.k, "f");
  return snapshotPacket.v[snapshotPacket.p.indexOf(fieldPath)];
}

test("Pong advances ball identity on a point without resetting paddle ownership", () => {
  const session = createPongTestSession();
  session.connectPlayer();
  session.connectPlayer();
  const state = session.getState();
  state.started = true;
  state.startAt = null;
  const previousEpoch = state.players.p1.inputEpoch;
  const previousServeId = state.ball.serveId;
  Object.assign(state.ball, { x: 1350, y: 40, vx: 450, vy: 0 });
  session.advanceSimulation();
  assert.equal(state.players.p1.score, 1);
  assert.equal(state.ball.serveId, previousServeId + 1);
  assert.equal(state.ball.x, 640);
  assert.equal(state.players.p1.inputEpoch, previousEpoch);
  const snapshotPacket = session.emitSnapshot();
  assert.equal(readFullSnapshotField(snapshotPacket, "ball.serveId"), state.ball.serveId);
});

test("Pong joins and snapshots expose queued input ownership and acknowledgements", () => {
  const session = createPongTestSession();
  const client = session.connectPlayer();
  const playerState = session.getState().players.p1;
  const joinedPayload = client.socketEvents.find(([eventName]) => eventName === "gameJoined")[1];
  assert.equal(joinedPayload.inputEpoch, 1);

  session.sendInputFrame(client, 1, { down: true });
  assert.equal(playerState.lastInputSeqAck, 0);
  session.advanceSimulation();
  assert.equal(playerState.y, 375);
  assert.equal(playerState.lastInputSeqAck, 1);

  const snapshotPacket = session.emitSnapshot();
  assert.equal(readFullSnapshotField(snapshotPacket, "inputProtocol"), 2);
  assert.equal(readFullSnapshotField(snapshotPacket, "players.p1.inputEpoch"), 1);
  assert.equal(readFullSnapshotField(snapshotPacket, "players.p1.inputSeqAck"), 1);
  assert.equal(readFullSnapshotField(snapshotPacket, "players.p1.inputSimulationTick"), 1);
  assert.equal(readFullSnapshotField(snapshotPacket, "players.p1.score"), 0);
});

test("Pong queued paddle input continues between packets and legacy controls remain available", () => {
  const session = createPongTestSession();
  const leftClient = session.connectPlayer();
  const rightClient = session.connectPlayer();
  const state = session.getState();
  session.sendInputFrame(leftClient, 1, { down: true });
  rightClient.socketHandlers.input({ type: "up", value: true });
  session.advanceSimulation();
  session.advanceSimulation();

  assert.equal(state.players.p1.y, 390);
  assert.equal(state.players.p1.lastInputSeqAck, 1);
  assert.equal(state.players.p1.inputSimulationTick, 2);
  assert.equal(state.players.p2.y, 330);

  leftClient.socketHandlers.input({ type: "up", value: true });
  rightClient.socketHandlers.input({ type: "up", value: false });
  session.advanceSimulation();
  assert.equal(state.players.p1.y, 405);
  assert.equal(state.players.p2.y, 330);
});

test("Pong disconnect and token rejoin discard commands from the previous owner", () => {
  const session = createPongTestSession();
  const client = session.connectPlayer();
  session.connectPlayer();
  const playerState = session.getState().players.p1;
  const token = playerState.rejoinToken;
  const oldFrame = session.sendInputFrame(client, 1, { down: true });
  client.disconnect();
  assert.equal(playerState.inputEpoch, 2);
  assert.equal(playerState.input.down, false);

  const rejoinedClient = session.connectPlayer(token);
  assert.equal(rejoinedClient.socket.data.playerId, "p1");
  assert.equal(playerState.rejoinToken, token);
  assert.equal(playerState.inputEpoch, 3);
  rejoinedClient.socketHandlers.input(oldFrame);
  session.advanceSimulation();
  assert.equal(playerState.y, 360);
  assert.equal(playerState.lastInputSeqAck, 0);

  session.sendInputFrame(rejoinedClient, 1, { up: true });
  session.advanceSimulation();
  assert.equal(playerState.y, 345);
  assert.equal(playerState.lastInputSeqAck, 1);
});

test("Pong rematch retains rejoin tokens, advances both epochs and removes stale queues", () => {
  const session = createPongTestSession();
  const leftClient = session.connectPlayer();
  const rightClient = session.connectPlayer();
  const previousState = session.getState();
  const oldFrame = session.sendInputFrame(leftClient, 1, { down: true });
  previousState.players.p1.score = 10;
  previousState.gameOver = true;
  leftClient.socketHandlers.rematch();
  rightClient.socketHandlers.rematch();

  const nextState = session.getState();
  assert.notEqual(nextState, previousState);
  assert.equal(nextState.players.p1.rejoinToken, previousState.players.p1.rejoinToken);
  assert.equal(nextState.players.p2.rejoinToken, previousState.players.p2.rejoinToken);
  assert.equal(nextState.players.p1.inputEpoch, 2);
  assert.equal(nextState.players.p2.inputEpoch, 2);
  assert.equal(nextState.players.p1.score, 0);
  assert.equal(nextState.players.p1.connected, true);
  leftClient.socketHandlers.input(oldFrame);
  session.advanceSimulation();
  assert.equal(nextState.players.p1.y, 360);
  assert.equal(nextState.players.p1.lastInputSeqAck, 0);
});

test("Pong starvation and dropped time reset queued movement without repeated epoch changes", () => {
  const session = createPongTestSession();
  const client = session.connectPlayer();
  const state = session.getState();
  const playerState = state.players.p1;
  session.sendInputFrame(client, 1, { down: true });
  session.advanceSimulation(100);
  session.advanceSimulation(601);
  assert.equal(playerState.y, 375);
  assert.equal(playerState.inputEpoch, 2);
  session.advanceSimulation(700);
  assert.equal(playerState.inputEpoch, 2);

  session.sendInputFrame(client, 1, { up: true });
  state.__roomClock = { droppedSteps: 3 };
  session.advanceSimulation(101);
  assert.equal(playerState.inputEpoch, 3);
  assert.equal(playerState.y, 375);
  session.sendInputFrame(client, 1, { up: true });
  session.advanceSimulation(102);
  assert.equal(playerState.inputEpoch, 3);
  assert.equal(playerState.y, 360);
});

test("Pong input predicts only paddle movement while ball and scores stay authoritative", () => {
  const session = createPongTestSession();
  const client = session.connectPlayer();
  session.connectPlayer();
  const state = session.getState();
  state.started = true;
  state.startAt = null;
  state.ball = { x: 640, y: 360, vx: 60, vy: 0, speed: 60 };
  session.sendInputFrame(client, 1, { down: true });
  client.socketHandlers.input({
    type: "inputFrame",
    protocol: 2,
    epoch: state.players.p1.inputEpoch,
    seq: 2,
    state: { up: false, down: false, score: 10, ball: { x: 999 } },
  });
  session.advanceSimulation();
  assert.equal(state.players.p1.y, 375);
  assert.equal(state.players.p1.score, 0);
  assert.equal(state.players.p1.lastInputSeqAck, 1);
  assert.equal(state.ball.x, 641);

  state.ball.x = 1301;
  state.ball.vx = 0;
  session.advanceSimulation();
  assert.equal(state.players.p1.score, 1);
  assert.equal(state.players.p2.score, 0);
  assert.equal(state.ball.x, 640);
});
