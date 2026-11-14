import test from "node:test";
import assert from "node:assert/strict";
import {
  registerSkybreakGame,
  registerSkybreakPracticeGame,
  registerSkybreakTimeTrialGame,
  serializeSkybreakState,
  skybreakGameMeta,
  skybreakPracticeGameMeta,
  skybreakTimeTrialGameMeta,
} from "../server/platform-backend-engine/games/skybreak.js";
import { getGamesStore } from "../server/platform-backend-engine/core/gameStore.js";
import { createRoomLifecycleMetadata } from "../public/platform/shared/roomLifecycle.js";
import { SKYBREAK_INPUT_TEMPLATE } from "../public/games/skybreak/shared/config.js";
import { SKYBREAK_PRIVATE_JET_FIELDS, createSkybreakPredictionState, stepSkybreakPrediction } from "../public/games/skybreak/shared/prediction.js";
import { stepSkybreakFlight } from "../public/games/skybreak/shared/flight.js";
import { createSkybreakPresentedJets, extractSkybreakContinuityKeys } from "../public/games/skybreak/client/snapshotPose.js";

const ROOM_ID = "sky-room";

/** Mount a real registration against an in-memory namespace without timers. */
function createSkybreakTestSession(register) {
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
      id: `sky-socket-${++socketSerial}`,
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
    const jet = getState().players[client.socket.data.playerId];
    client.socketHandlers.input({
      type: "inputFrame",
      protocol: 2,
      epoch: jet.inputEpoch,
      seq: sequenceNumber,
      state: { ...SKYBREAK_INPUT_TEMPLATE, ...overrides },
    });
    jet.__lastInputReceiptMs = 100;
  }

  function startNow() {
    getState().startAt = Date.now() - 1;
    advance();
  }

  return { getState, connectPlayer, advance, sendInput, startNow };
}

test("the online dogfight waits for both humans and adds four bots", () => {
  const session = createSkybreakTestSession(registerSkybreakGame);
  session.connectPlayer();
  assert.equal(session.getState().startAt, null);
  session.connectPlayer();
  const state = session.getState();
  assert.notEqual(state.startAt, null);
  assert.equal(createRoomLifecycleMetadata(state, ROOM_ID).requiredPlayers, 2);
  assert.equal(state.bots.length, 4);
});

test("practice starts with one pilot and five bots that fly once playing", () => {
  const session = createSkybreakTestSession(registerSkybreakPracticeGame);
  const human = session.connectPlayer();
  const state = session.getState();
  assert.equal(human.socket.data.playerId, "p1");
  assert.equal(state.bots.length, 5);
  assert.equal(createRoomLifecycleMetadata(state, ROOM_ID).requiredPlayers, 1);

  session.startNow();
  assert.equal(state.phase, "playing");
  const start = state.bots.map((bot) => ({ x: bot.x, z: bot.z }));
  session.advance(60);
  state.bots.forEach((bot, index) => assert.ok(Math.hypot(bot.x - start[index].x, bot.z - start[index].z) > 50, `${bot.id} flies`));
});

test("time trial is solo, has no bots, and the restart key restarts the run", () => {
  const session = createSkybreakTestSession(registerSkybreakTimeTrialGame);
  const human = session.connectPlayer();
  session.startNow();
  const state = session.getState();
  assert.equal(state.bots.length, 0);
  const jet = state.players.p1;
  assert.equal(jet.runActive, true);
  session.sendInput(human, 1, { boost: true });
  session.advance(60);
  const serial = jet.runSerial;
  session.sendInput(human, 2, { restart: true });
  session.advance(2);
  assert.equal(jet.runSerial, serial + 1);
  assert.equal(jet.gateIndex, 0);
});

test("snapshots carry jets and missiles but never rounds, decoys, rewind history or private fields", () => {
  const session = createSkybreakTestSession(registerSkybreakPracticeGame);
  const human = session.connectPlayer();
  session.startNow();
  session.sendInput(human, 1, { fire: true, viewLagTicks: 6 });
  session.advance(10);
  const snapshot = serializeSkybreakState(session.getState());
  const serialized = JSON.stringify(snapshot);
  assert.equal(snapshot.players.p1.inputSeqAck, 1);
  assert.equal(snapshot.bots.length, 5);
  assert.ok(Array.isArray(snapshot.missiles));
  for (const privateField of ["rejoinToken", "__inputBuffer", "botBrains", "rematchRequests", "bullets", "decoys", "poseHistory", ...SKYBREAK_PRIVATE_JET_FIELDS]) {
    assert.equal(serialized.includes(`"${privateField}"`), false, `${privateField} stays on the server`);
  }
  assert.deepEqual(JSON.parse(serialized), snapshot);
});

test("a disconnect pauses the dogfight and resets every pilot's triggers", () => {
  const session = createSkybreakTestSession(registerSkybreakGame);
  const left = session.connectPlayer();
  const right = session.connectPlayer();
  session.startNow();
  const state = session.getState();
  state.players.p1.kills = 3;
  session.sendInput(left, 1, { fire: true });
  session.advance(1);
  const epoch = state.players.p1.inputEpoch;
  right.disconnect();
  assert.equal(state.phase, "paused");
  assert.equal(state.started, false);
  assert.ok(state.players.p1.inputEpoch > epoch);
  assert.equal(state.players.p1.cannonFiring, false);
  assert.equal(state.players.p1.kills, 3, "match progress is kept");
});

test("practice rematch needs one vote and starts a fresh sortie", () => {
  const session = createSkybreakTestSession(registerSkybreakPracticeGame);
  const human = session.connectPlayer();
  session.startNow();
  const finished = session.getState();
  Object.assign(finished, { gameOver: true, phase: "finished", winner: "bot1" });
  human.socketHandlers.rematch();
  const next = session.getState();
  assert.notEqual(next, finished);
  assert.equal(next.matchId, finished.matchId + 1);
  assert.equal(next.players.p1.connected, true);
  assert.equal(next.players.p1.kills, 0);
});

test("three modes share one input schema with separate routes and seats", () => {
  assert.equal(skybreakGameMeta.networking.inputTemplate, skybreakPracticeGameMeta.networking.inputTemplate);
  assert.equal(skybreakGameMeta.networking.inputTemplate, skybreakTimeTrialGameMeta.networking.inputTemplate);
  assert.equal(new Set([skybreakGameMeta.namespace, skybreakPracticeGameMeta.namespace, skybreakTimeTrialGameMeta.namespace]).size, 3);
  assert.deepEqual(skybreakGameMeta.room.playerIds, ["p1", "p2"]);
  assert.deepEqual(skybreakPracticeGameMeta.room.playerIds, ["p1"]);
  assert.deepEqual(skybreakTimeTrialGameMeta.room.playerIds, ["p1"]);
});

test("local prediction replays the same flight as authority", () => {
  const session = createSkybreakTestSession(registerSkybreakPracticeGame);
  session.connectPlayer();
  session.startNow();
  const snapshot = serializeSkybreakState(session.getState());
  const predicted = createSkybreakPredictionState(snapshot, "p1");
  const authority = structuredClone(session.getState().players.p1);
  const control = { ...SKYBREAK_INPUT_TEMPLATE, pitch: 0.6, roll: -0.4, boost: true };
  for (let tick = 0; tick < 90; tick += 1) {
    stepSkybreakPrediction(predicted, control, 1 / 60);
    stepSkybreakFlight(authority, control, 1 / 60, { active: true, boundary: true });
  }
  for (const field of ["x", "y", "z", "forwardX", "upY", "speed", "fuel"]) {
    assert.ok(Math.abs(predicted[field] - authority[field]) < 1e-9, `${field} matches`);
  }
});

test("each life is its own interpolation identity and orientation stays orthonormal", () => {
  const session = createSkybreakTestSession(registerSkybreakPracticeGame);
  session.connectPlayer();
  const snapshot = serializeSkybreakState(session.getState());
  const before = extractSkybreakContinuityKeys(snapshot)["p1.x"];
  snapshot.players.p1.respawnId += 1;
  assert.notEqual(extractSkybreakContinuityKeys(snapshot)["p1.x"], before);

  const pose = { matchId: snapshot.matchId, "p1.forwardX": 0.5, "p1.forwardY": 0.5, "p1.forwardZ": 0.5, "p1.upX": 0, "p1.upY": 1, "p1.upZ": 0 };
  const jet = createSkybreakPresentedJets(snapshot, pose).find((candidate) => candidate.id === "p1");
  assert.ok(Math.abs(Math.hypot(jet.forwardX, jet.forwardY, jet.forwardZ) - 1) < 1e-9);
  assert.ok(Math.abs(jet.forwardX * jet.upX + jet.forwardY * jet.upY + jet.forwardZ * jet.upZ) < 1e-9);
});

test("a brief transport drop keeps the match running and a token rejoin resumes without a countdown", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const session = createSkybreakTestSession(registerSkybreakGame);
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
  const session = createSkybreakTestSession(registerSkybreakGame);
  session.connectPlayer();
  const right = session.connectPlayer();
  session.startNow();
  right.disconnect("client namespace disconnect");
  assert.equal(session.getState().phase, "paused");
});
