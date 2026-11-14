import test from "node:test";
import assert from "node:assert/strict";
import {
  driftlineGameMeta,
  driftlinePracticeGameMeta,
  registerDriftlineGame,
  registerDriftlinePracticeGame,
  serializeDriftlineState,
} from "../server/platform-backend-engine/games/driftline.js";
import { getGamesStore } from "../server/platform-backend-engine/core/gameStore.js";
import { createRoomLifecycleMetadata } from "../public/platform/shared/roomLifecycle.js";
import { DRIFTLINE_INPUT_TEMPLATE } from "../public/games/driftline/shared/config.js";

const ROOM_ID = "drift-room";

/** Mount a real registration against an in-memory namespace without timers. */
function createDriftlineTestSession(register) {
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

  function connectPlayer() {
    const socketHandlers = {};
    const socketEvents = [];
    const socket = {
      id: `drift-socket-${++socketSerial}`,
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
    socketHandlers.joinGame({ gameId: ROOM_ID });
    return {
      socket,
      socketHandlers,
      socketEvents,
      disconnect() {
        socketHandlers.disconnect();
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
    const car = getState().players[client.socket.data.playerId];
    client.socketHandlers.input({
      type: "inputFrame",
      protocol: 2,
      epoch: car.inputEpoch,
      seq: sequenceNumber,
      state: { ...DRIFTLINE_INPUT_TEMPLATE, ...overrides },
    });
    car.__lastInputReceiptMs = 100;
  }

  function startNow() {
    getState().startAt = Date.now() - 1;
    advance();
  }

  return { getState, connectPlayer, advance, sendInput, startNow };
}

test("the online race waits for both humans and fills the grid with bots", () => {
  const session = createDriftlineTestSession(registerDriftlineGame);
  session.connectPlayer();
  assert.equal(session.getState().startAt, null);
  session.connectPlayer();
  const state = session.getState();
  assert.equal(state.phase, "countdown");
  assert.equal(createRoomLifecycleMetadata(state, ROOM_ID).requiredPlayers, 2);
  assert.equal(state.bots.length, 4);
});

test("practice starts with one human and five bots that drive once racing", () => {
  const session = createDriftlineTestSession(registerDriftlinePracticeGame);
  const human = session.connectPlayer();
  const state = session.getState();
  assert.equal(human.socket.data.playerId, "p1");
  assert.deepEqual(Object.keys(state.players), ["p1"]);
  assert.equal(state.bots.length, 5);
  assert.equal(createRoomLifecycleMetadata(state, ROOM_ID).requiredPlayers, 1);

  session.startNow();
  assert.equal(state.phase, "racing");
  assert.equal(state.launchResolved, true);
  const startProgress = state.bots.map((bot) => bot.progress);
  session.advance(120);
  state.bots.forEach((bot, index) => assert.ok(bot.progress > startProgress[index] + 5, `${bot.id} pulls away from the grid`));
});

test("throttle held during the countdown becomes the human's launch", () => {
  const session = createDriftlineTestSession(registerDriftlinePracticeGame);
  const human = session.connectPlayer();
  const state = session.getState();
  for (let sequence = 1; sequence <= 20; sequence += 1) {
    session.sendInput(human, sequence, { throttle: 1 });
    session.advance(1, state.startAt - 1000);
  }
  assert.equal(state.players.p1.launchHoldTicks, 20);
  assert.equal(state.players.p1.progress, -10, "nobody moves before the start");
  session.startNow();
  assert.equal(state.players.p1.launch, "perfect");
  assert.ok(state.players.p1.boostSec > 0);
});

test("snapshots carry race state and input metadata but no private server fields", () => {
  const session = createDriftlineTestSession(registerDriftlinePracticeGame);
  const human = session.connectPlayer();
  session.startNow();
  session.sendInput(human, 1, { throttle: 1 });
  session.advance(5);
  const snapshot = serializeDriftlineState(session.getState());
  const serialized = JSON.stringify(snapshot);
  assert.equal(snapshot.players.p1.inputSeqAck, 1);
  assert.equal(snapshot.bots.length, 5);
  assert.equal(snapshot.trackId, "sunset-cliffs");
  for (const privateField of ["rejoinToken", "__inputBuffer", "__controlEpoch", "botBrains", "rematchRequests", "seed"]) {
    assert.equal(serialized.includes(privateField), false, `${privateField} stays on the server`);
  }
  assert.deepEqual(JSON.parse(serialized), snapshot);
});

test("a disconnect pauses the race in place and resets every owner", () => {
  const session = createDriftlineTestSession(registerDriftlineGame);
  const left = session.connectPlayer();
  const right = session.connectPlayer();
  session.startNow();
  const state = session.getState();
  state.players.p1.lap = 2;
  session.sendInput(left, 1, { throttle: 1, handbrake: true });
  const epoch = state.players.p1.inputEpoch;
  right.disconnect();
  assert.equal(state.phase, "paused");
  assert.equal(state.started, false);
  assert.ok(state.players.p1.inputEpoch > epoch);
  assert.equal(state.players.p1.handbrake, false);
  assert.equal(state.players.p1.lap, 2);
});

test("practice rematch needs one vote and builds a fresh grid", () => {
  const session = createDriftlineTestSession(registerDriftlinePracticeGame);
  const human = session.connectPlayer();
  session.startNow();
  const finished = session.getState();
  Object.assign(finished, { gameOver: true, phase: "finished", winner: "bot1" });
  human.socketHandlers.rematch();
  const next = session.getState();
  assert.notEqual(next, finished);
  assert.equal(next.matchId, finished.matchId + 1);
  assert.equal(next.phase, "countdown");
  assert.equal(next.players.p1.connected, true);
  assert.equal(next.players.p1.progress, -10);
});

test("both modes advertise one input schema with separate routes and namespaces", () => {
  assert.equal(driftlineGameMeta.networking.inputTemplate, driftlinePracticeGameMeta.networking.inputTemplate);
  assert.notEqual(driftlineGameMeta.namespace, driftlinePracticeGameMeta.namespace);
  assert.deepEqual(driftlineGameMeta.room.playerIds, ["p1", "p2"]);
  assert.deepEqual(driftlinePracticeGameMeta.room.playerIds, ["p1"]);
  assert.equal(driftlineGameMeta.networking.tickRateHz, 60);
});
