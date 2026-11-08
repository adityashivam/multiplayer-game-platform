import test from "node:test";
import assert from "node:assert/strict";
import { registerRiftballGame, serializeRiftballState } from "../server/platform-backend-engine/games/riftball.js";
import { getGamesStore } from "../server/platform-backend-engine/core/gameStore.js";
import { RIFTBALL_INPUT_TEMPLATE } from "../public/games/riftball/shared/config.js";

function createRiftballTestSession() {
  let connectSocket;
  const namespace = {
    adapter: { rooms: new Map() }, sockets: new Map(),
    on: (_event, callback) => { connectSocket = callback; },
    to: () => ({ emit() {} }),
  };
  const previousSetTimeout = globalThis.setTimeout;
  let simulation;
  globalThis.setTimeout = () => 0;
  try {
    simulation = registerRiftballGame({ of: () => namespace });
  } finally {
    globalThis.setTimeout = previousSetTimeout;
  }
  const games = getGamesStore(namespace);
  let socketSerial = 0;
  const getState = () => games.get("rift-room");
  function connectPlayer(rejoinToken) {
    const socketHandlers = {};
    const socketEvents = [];
    const socket = {
      id: `rift-socket-${++socketSerial}`, data: {},
      on: (event, callback) => { socketHandlers[event] = callback; },
      emit: (event, payload) => socketEvents.push([event, payload]),
      to: () => ({ emit() {} }),
      join: (roomId) => {
        if (!namespace.adapter.rooms.has(roomId)) namespace.adapter.rooms.set(roomId, new Set());
        namespace.adapter.rooms.get(roomId).add(socket.id);
      },
      leave: (roomId) => namespace.adapter.rooms.get(roomId)?.delete(socket.id),
    };
    namespace.sockets.set(socket.id, socket);
    connectSocket(socket);
    socketHandlers.joinGame({ gameId: "rift-room", rejoinToken });
    return {
      socket, socketHandlers, socketEvents,
      disconnect() {
        socketHandlers.disconnect();
        socket.leave("rift-room");
        namespace.sockets.delete(socket.id);
      },
    };
  }
  function advance(nowMs = 100) {
    const state = getState();
    state.__loopTick = (state.__loopTick || 0) + 1;
    state.__loopMonotonicNow = nowMs;
    simulation.step(state, 1 / 60);
  }
  function sendInput(client, sequenceNumber, overrides = {}) {
    const player = getState().players[client.socket.data.playerId];
    const inputFrame = {
      type: "inputFrame", protocol: 2, epoch: player.inputEpoch, seq: sequenceNumber,
      state: { ...RIFTBALL_INPUT_TEMPLATE, ...overrides },
    };
    client.socketHandlers.input(inputFrame);
    player.__lastInputReceiptMs = 100;
    return inputFrame;
  }
  function activate() {
    Object.assign(getState(), { started: true, startAt: null, phase: "playing" });
  }
  return { getState, connectPlayer, advance, sendInput, activate };
}

test("Riftball joins use a shared countdown and owned snapshots expose only game state plus input metadata", () => {
  const session = createRiftballTestSession();
  const left = session.connectPlayer();
  session.connectPlayer();
  const state = session.getState();
  assert.equal(state.started, false);
  assert.ok(state.startAt - Date.now() > 4900);
  assert.equal(state.phase, "countdown");
  const initialSnapshot = serializeRiftballState(state);
  session.sendInput(left, 1, { moveX: 1 });
  session.advance();
  assert.equal(state.players.p1.x, 0);
  assert.equal(state.players.p1.lastInputSeqAck, 1);

  state.startAt = Date.now() - 1;
  session.advance();
  assert.equal(state.started, true);
  assert.ok(state.players.p1.x > 0);
  assert.ok(state.timer < 120);
  session.sendInput(left, 2, { score: 5, ball: { x: 99 } });
  session.advance();
  assert.equal(state.players.p1.lastInputSeqAck, 1);
  assert.equal(state.players.p1.score, 0);

  const snapshot = serializeRiftballState(state);
  assert.equal(snapshot.inputProtocol, 2);
  assert.equal(snapshot.players.p1.inputEpoch, 1);
  assert.equal(snapshot.players.p1.inputSeqAck, 1);
  assert.equal(snapshot.players.p1.inputSimulationTick, 3);
  assert.equal(Object.hasOwn(snapshot.players.p1, "rejoinToken"), false);
  assert.equal(Object.hasOwn(snapshot.players.p1, "input"), false);
  assert.equal(Object.hasOwn(snapshot.players.p1, "__inputBuffer"), false);
  assert.deepEqual(Object.keys(snapshot.players.p1), Object.keys(initialSnapshot.players.p1));
  assert.deepEqual(Object.keys(snapshot.ball), Object.keys(initialSnapshot.ball));
  state.players.p1.x = 9;
  state.ball.x = 8;
  assert.notEqual(snapshot.players.p1.x, 9);
  assert.notEqual(snapshot.ball.x, 8);
});

test("Riftball disconnect pauses the existing match and rejoin discards commands from both old owners", () => {
  const session = createRiftballTestSession();
  const left = session.connectPlayer();
  session.connectPlayer();
  session.activate();
  const state = session.getState();
  state.players.p1.score = 2;
  state.timer = 72;
  state.ball.vx = 3;
  const token = state.players.p1.rejoinToken;
  const oldFrame = session.sendInput(left, 1, { strike: true, moveX: 1 });
  session.advance();
  const pausedClock = state.timer;
  const pausedBall = structuredClone(state.ball);
  left.disconnect();
  assert.equal(state.started, false);
  assert.equal(state.phase, "paused");
  assert.equal(state.players.p1.inputEpoch, 2);
  assert.equal(state.players.p2.inputEpoch, 2);
  assert.equal(state.players.p1.chargeSec, 0);
  session.advance();
  assert.equal(state.timer, pausedClock);
  assert.deepEqual(state.ball, pausedBall);

  const rejoined = session.connectPlayer(token);
  assert.equal(rejoined.socket.data.playerId, "p1");
  assert.equal(state.players.p1.inputEpoch, 3);
  assert.equal(state.players.p1.score, 2);
  assert.ok(state.startAt - Date.now() > 4900);
  assert.equal(state.started, false);
  rejoined.socketHandlers.input(oldFrame);
  session.advance();
  assert.equal(state.players.p1.lastInputSeqAck, 0);
  assert.equal(state.players.p1.strikeHeld, false);
});

test("Riftball rematch preserves seats and series wins with new round identity, epochs and countdown", () => {
  const session = createRiftballTestSession();
  const left = session.connectPlayer();
  const right = session.connectPlayer();
  session.activate();
  const previous = session.getState();
  const oldFrame = session.sendInput(left, 1, { dash: true });
  Object.assign(previous, { gameOver: true, winner: "p1", phase: "finished" });
  Object.assign(previous.players.p1, { score: 5, seriesWins: 1 });
  left.socketHandlers.rematch();
  assert.equal(session.getState(), previous);
  right.socketHandlers.rematch();
  const next = session.getState();
  assert.notEqual(next, previous);
  assert.equal(next.roundId, 2);
  assert.equal(next.players.p1.seriesWins, 1);
  assert.equal(next.players.p1.score, 0);
  assert.equal(next.players.p1.rejoinToken, previous.players.p1.rejoinToken);
  assert.equal(next.players.p2.rejoinToken, previous.players.p2.rejoinToken);
  assert.equal(next.players.p1.inputEpoch, 2);
  assert.equal(next.players.p2.inputEpoch, 2);
  assert.equal(next.started, false);
  assert.ok(next.startAt - Date.now() > 4900);
  left.socketHandlers.input(oldFrame);
  session.advance();
  assert.equal(next.players.p1.lastInputSeqAck, 0);
  assert.equal(next.players.p1.action, "idle");
});

test("Riftball queued short strikes survive late press/release delivery and stale sessions cancel charges", () => {
  const session = createRiftballTestSession();
  const left = session.connectPlayer();
  session.connectPlayer();
  session.activate();
  const state = session.getState();
  const player = state.players.p1;
  Object.assign(player, { x: 0, z: 0, inputSimulationTick: 10 });
  Object.assign(state.ball, { x: 0, y: 0.8, z: -1.1 });
  session.sendInput(left, 1, { strike: true, aimZ: -1 });
  session.sendInput(left, 2, { strike: false, aimZ: -1 });
  session.advance();
  assert.equal(player.lastInputSeqAck, 2);
  assert.equal(player.action, "charge");
  session.advance();
  assert.equal(player.action, "strike");
  for (let index = 0; index < 9; index += 1) session.advance();
  assert.equal(state.ball.hitSerial, 1);
  assert.equal(state.ball.lastTouchPlayerId, "p1");

  for (let index = 0; index < 25; index += 1) session.advance();
  session.sendInput(left, 20, { strike: true });
  session.advance();
  assert.equal(player.action, "charge");
  session.advance(601);
  assert.equal(player.inputEpoch, 2);
  assert.equal(player.chargeSec, 0);
  assert.notEqual(player.action, "strike");
  session.advance(700);
  assert.equal(player.inputEpoch, 2);
});
