import test from "node:test";
import assert from "node:assert/strict";
import {
  edgeoutGameMeta,
  edgeoutPracticeGameMeta,
  registerEdgeoutGame,
  registerEdgeoutPracticeGame,
  serializeEdgeoutState,
} from "../server/platform-backend-engine/games/edgeout.js";
import { getGamesStore } from "../server/platform-backend-engine/core/gameStore.js";
import { createRoomLifecycleMetadata } from "../public/platform/shared/roomLifecycle.js";
import { EDGEOUT_INPUT_TEMPLATE } from "../public/games/edgeout/shared/config.js";

const ROOM_ID = "edge-room";

/** Mount a real registration against an in-memory namespace without timers. */
function createEdgeoutTestSession(register) {
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
      id: `edge-socket-${++socketSerial}`,
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
      disconnect() {
        socketHandlers.disconnect();
        socket.leave(ROOM_ID);
        namespace.sockets.delete(socket.id);
      },
    };
  }

  function advance(ticks = 1) {
    for (let tick = 0; tick < ticks; tick += 1) {
      const state = getState();
      state.__loopTick = (state.__loopTick || 0) + 1;
      state.__loopMonotonicNow = 100 + state.__loopTick;
      simulation.step(state, 1 / 60);
    }
  }

  function sendInput(client, sequenceNumber, overrides = {}) {
    const fighter = getState().players[client.socket.data.playerId];
    client.socketHandlers.input({
      type: "inputFrame",
      protocol: 2,
      epoch: fighter.inputEpoch,
      seq: sequenceNumber,
      state: { ...EDGEOUT_INPUT_TEMPLATE, ...overrides },
    });
    fighter.__lastInputReceiptMs = 100;
  }

  function startNow() {
    getState().startAt = Date.now() - 1;
    advance();
  }

  return { getState, connectPlayer, advance, sendInput, startNow };
}

test("the duel waits for both humans, then shares one countdown", () => {
  const session = createEdgeoutTestSession(registerEdgeoutGame);
  session.connectPlayer();
  assert.equal(session.getState().startAt, null);
  assert.equal(createRoomLifecycleMetadata(session.getState(), ROOM_ID).phase, "waiting");

  session.connectPlayer();
  const state = session.getState();
  assert.equal(state.phase, "countdown");
  assert.ok(state.startAt - Date.now() > 4900);
  assert.equal(createRoomLifecycleMetadata(state, ROOM_ID).requiredPlayers, 2);
  assert.equal(state.bots.length, 0);
});

test("practice starts with one human and keeps the CPU outside seat ownership", () => {
  const session = createEdgeoutTestSession(registerEdgeoutPracticeGame);
  const human = session.connectPlayer();
  const state = session.getState();
  assert.equal(human.socket.data.playerId, "p1");
  assert.deepEqual(Object.keys(state.players), ["p1"]);
  assert.equal(state.bots.length, 1);
  assert.equal(state.phase, "countdown");
  assert.equal(createRoomLifecycleMetadata(state, ROOM_ID).requiredPlayers, 1);

  const extra = session.connectPlayer();
  assert.equal(extra.socket.data.playerId, undefined, "the bot's seat is not open to a second human");
  assert.ok(extra.socketEvents.some(([event]) => event === "roomFull"));

  session.startNow();
  const bot = state.bots[0];
  const startDistance = Math.hypot(bot.x - state.players.p1.x, bot.z - state.players.p1.z);
  session.advance(45);
  const laterDistance = Math.hypot(bot.x - state.players.p1.x, bot.z - state.players.p1.z);
  assert.ok(laterDistance < startDistance - 0.5, `the CPU closes in: ${startDistance} -> ${laterDistance}`);
});

test("snapshots carry game state and input metadata but no private server fields", () => {
  const session = createEdgeoutTestSession(registerEdgeoutPracticeGame);
  const human = session.connectPlayer();
  session.startNow();
  session.sendInput(human, 1, { moveX: 1 });
  session.advance(3);
  const snapshot = serializeEdgeoutState(session.getState());
  const serialized = JSON.stringify(snapshot);

  assert.equal(snapshot.players.p1.inputSeqAck, 1);
  assert.ok(snapshot.players.p1.x > 0, "queued input moved the fighter");
  assert.equal(snapshot.bots[0].id, "cpu");
  for (const privateField of ["rejoinToken", "__inputBuffer", "__controlEpoch", "botBrains", "rematchRequests", "seed"]) {
    assert.equal(serialized.includes(privateField), false, `${privateField} stays on the server`);
  }
  assert.deepEqual(JSON.parse(serialized), snapshot, "snapshots are plain JSON");
});

test("a disconnect pauses the duel, resets every owner and keeps progress", () => {
  const session = createEdgeoutTestSession(registerEdgeoutGame);
  const left = session.connectPlayer();
  const right = session.connectPlayer();
  session.startNow();
  const state = session.getState();
  state.players.p1.roundWins = 2;
  state.players.p2.damage = 55;
  session.sendInput(left, 1, { shove: true });
  const leftEpoch = state.players.p1.inputEpoch;

  right.disconnect();
  assert.equal(state.phase, "paused");
  assert.equal(state.started, false);
  assert.ok(state.players.p1.inputEpoch > leftEpoch, "the remaining owner's commands are invalidated");
  assert.equal(state.players.p1.shoveHeld, false);
  assert.equal(state.players.p1.roundWins, 2);
  assert.equal(state.players.p2.damage, 55);
});

test("practice rematch needs only its human vote and carries series wins", () => {
  const session = createEdgeoutTestSession(registerEdgeoutPracticeGame);
  const human = session.connectPlayer();
  session.startNow();
  const finished = session.getState();
  Object.assign(finished, { gameOver: true, phase: "finished", winner: "p1" });
  finished.players.p1.seriesWins = 2;
  finished.bots[0].seriesWins = 1;

  human.socketHandlers.rematch();
  const next = session.getState();
  assert.notEqual(next, finished);
  assert.equal(next.matchId, finished.matchId + 1);
  assert.equal(next.players.p1.seriesWins, 2);
  assert.equal(next.bots[0].seriesWins, 1);
  assert.equal(next.players.p1.connected, true);
  assert.equal(next.phase, "countdown");
  assert.equal(next.gameOver, false);
});

test("both modes advertise the same input schema with separate routes and namespaces", () => {
  assert.equal(edgeoutGameMeta.networking.inputTemplate, edgeoutPracticeGameMeta.networking.inputTemplate);
  assert.notEqual(edgeoutGameMeta.namespace, edgeoutPracticeGameMeta.namespace);
  assert.notEqual(edgeoutGameMeta.path, edgeoutPracticeGameMeta.path);
  assert.deepEqual(edgeoutGameMeta.room.playerIds, ["p1", "p2"]);
  assert.deepEqual(edgeoutPracticeGameMeta.room.playerIds, ["p1"]);
  assert.equal(edgeoutGameMeta.networking.tickRateHz, 60);
});
