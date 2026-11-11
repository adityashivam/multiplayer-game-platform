import test from "node:test";
import assert from "node:assert/strict";
import {
  applyLudoServerInput,
  createLudoServerController,
  createLudoServerState,
  ludoGameMeta,
  registerLudoGame,
  serializeLudoState,
} from "../server/platform-backend-engine/games/ludo.js";
import { getGamesStore } from "../server/platform-backend-engine/core/gameStore.js";

function createLudoRoomSession(options = {}) {
  let nowMs = 10000;
  let diceValue = 6;
  let rollCount = 0;
  const diceRequests = [];
  const events = [];
  const controller = createLudoServerController({
    ...options,
    nowFn: () => nowMs,
    rollDie: (diceContext) => {
      rollCount += 1;
      diceRequests.push(diceContext);
      return diceValue;
    },
  });
  const games = new Map([["ludo-room", controller.createState()]]);
  const getState = () => games.get("ludo-room");
  const namespace = {
    to: (gameId) => ({ emit: (type, payload) => events.push({ gameId, type, payload }) }),
  };

  function invokeWithRoomClock(callback) {
    const originalDateNow = Date.now;
    Date.now = () => nowMs;
    try {
      return callback();
    } finally {
      Date.now = originalDateNow;
    }
  }

  function createPlayerSocket(playerId) {
    return {
      data: { gameId: "ludo-room", playerId },
      to: (gameId) => ({ emit: (type, payload) => events.push({ gameId, type, payload }) }),
    };
  }

  const connectPlayer = (playerId) => invokeWithRoomClock(() => controller.onPlayerConnected(getState(), playerId));
  const advanceAt = (nextNowMs) => {
    nowMs = nextNowMs;
    invokeWithRoomClock(() => controller.beforeUpdate(getState()));
  };
  function activate() {
    for (const playerId of getState().playerIds) {
      connectPlayer(playerId);
    }
    advanceAt(getState().startAt);
  }
  function sendInput(playerId, payload) {
    return invokeWithRoomClock(() => controller.handleInput({
      state: getState(), playerId, payload, socket: createPlayerSocket(playerId),
    }));
  }
  const command = (type, extra = {}) => ({
    type, roundId: getState().roundId, revision: getState().revision, ...extra,
  });

  return {
    controller, getState, connectPlayer, advanceAt, activate, sendInput, command, events,
    getRollCount: () => rollCount,
    getDiceRequests: () => diceRequests,
    setDiceValue: (nextValue) => { diceValue = nextValue; },
    setNow: (nextNowMs) => { nowMs = nextNowMs; },
    disconnectPlayer: (playerId) => invokeWithRoomClock(() => controller.handleDisconnect(getState(), playerId)),
    requestRematch: (playerId) => invokeWithRoomClock(() => controller.handleRematch({
      socket: createPlayerSocket(playerId), games, nsp: namespace,
    })),
  };
}

test("Ludo waits for both human owners and starts a full decision clock after the shared countdown", () => {
  const session = createLudoRoomSession();
  session.connectPlayer("p1");
  session.advanceAt(12000);
  assert.equal(session.getState().started, false);
  assert.equal(session.getState().startAt, null);
  session.sendInput("p1", session.command("roll"));
  assert.equal(session.getRollCount(), 0);
  session.connectPlayer("p2");
  assert.equal(session.getState().startAt, 17000);
  assert.equal(session.getState().__roomStart.countdownDurationMs, 5000);
  session.advanceAt(16999);
  session.sendInput("p1", session.command("roll"));
  assert.equal(session.getRollCount(), 0);
  session.advanceAt(17000);
  assert.equal(session.getState().started, true);
  assert.equal(session.getState().startAt, null);
  assert.equal(session.getState().turnEndsAtMs, 47000);
  assert.deepEqual(ludoGameMeta.room.playerIds, ["p1", "p2"]);
  assert.equal(ludoGameMeta.networking.tickRateHz, 10);
  assert.equal(ludoGameMeta.networking.inputProtocol, null);
  assert.equal(ludoGameMeta.runtime.socketIo, true);
  assert.equal(ludoGameMeta.runtime.kaboom, false);
});

test("Ludo validates command shape, authority and revision before consuming server randomness", () => {
  const session = createLudoRoomSession();
  session.activate();
  const state = session.getState();
  const beforeInput = structuredClone(serializeLudoState(state));
  for (const payload of [
    null, [], {}, { ...session.command("roll"), diceValue: 6 },
    { ...session.command("roll"), roundId: 0 },
    { ...session.command("roll"), revision: state.revision - 1 },
    { ...session.command("roll"), revision: String(state.revision) },
    session.command("move", { tokenIndex: 0 }),
  ]) {
    assert.equal(session.sendInput("p1", payload), false);
  }
  assert.equal(session.sendInput("p2", session.command("roll")), false);
  assert.equal(session.sendInput("p3", session.command("roll")), false);
  assert.equal(session.getRollCount(), 0);
  assert.deepEqual(serializeLudoState(state), beforeInput);

  session.setDiceValue(2);
  assert.equal(session.sendInput("p1", session.command("roll")), true);
  assert.equal(session.getRollCount(), 1);
  assert.equal(state.diceValue, 2);
  assert.equal(state.phase, "rolling");
});

test("Ludo chooses entry odds from authoritative board state and rejects forged profiles", () => {
  const session = createLudoRoomSession();
  session.activate();
  session.setDiceValue(2);
  const state = session.getState();
  for (let rollIndex = 0; rollIndex < 6; rollIndex += 1) {
    assert.equal(session.sendInput(state.currentPlayerId, session.command("roll")), true);
    assert.equal(state.diceValue, 2, "no fixed third-roll guarantee remains");
    session.advanceAt(state.phaseEndsAtMs);
    session.advanceAt(state.phaseEndsAtMs);
  }
  assert.ok(session.getDiceRequests().every(request => request.entryBoosted === true));
  const oldCommand = session.command("roll");
  const beforeForged = structuredClone(serializeLudoState(state));
  assert.equal(session.sendInput("p2", oldCommand), false);
  assert.equal(session.sendInput("p1", { ...oldCommand, entryBoosted: true }), false);
  assert.deepEqual(serializeLudoState(state), beforeForged);
  assert.equal(session.getRollCount(), 6);

  session.disconnectPlayer("p2");
  session.connectPlayer("p2");
  session.advanceAt(state.startAt);
  assert.equal(session.sendInput("p1", oldCommand), false);
  session.setDiceValue(6);
  assert.equal(session.sendInput("p1", session.command("roll")), true);
  assert.equal(session.getDiceRequests().at(-1).entryBoosted, true);
  session.advanceAt(state.phaseEndsAtMs);
  assert.equal(session.sendInput("p1", session.command("move", { tokenIndex: 0 })), true);
  session.advanceAt(state.phaseEndsAtMs);
  session.setDiceValue(2);
  assert.equal(session.sendInput("p1", session.command("roll")), true);
  assert.equal(session.getDiceRequests().at(-1).entryBoosted, false, "active pieces restore ordinary odds");
});

test("Ludo accepts delayed discrete commands once and ignores duplicate roll and move packets", () => {
  const session = createLudoRoomSession();
  session.activate();
  const rollCommand = session.command("roll");
  session.setNow(15500);
  assert.equal(session.sendInput("p1", rollCommand), true);
  assert.equal(session.sendInput("p1", rollCommand), false);
  session.advanceAt(16550);
  const state = session.getState();
  assert.equal(state.phase, "choose");
  const moveCommand = session.command("move", { tokenIndex: 0 });
  session.setNow(17050);
  assert.equal(session.sendInput("p1", moveCommand), true);
  assert.equal(session.sendInput("p1", moveCommand), false);
  assert.deepEqual(state.players.p1.tokens, [0, -1, -1, -1]);
  assert.equal(state.lastAction.id, 2);
  assert.equal(session.getRollCount(), 1);
  session.advanceAt(17445);
  assert.equal(state.currentPlayerId, "p1");
  assert.equal(session.sendInput("p1", rollCommand), false);
  assert.equal(session.getRollCount(), 1);
});

test("Ludo disconnect freezes its in-flight die and resumes the retained phase after a fresh countdown", () => {
  const session = createLudoRoomSession();
  session.activate();
  session.setNow(16000);
  session.sendInput("p1", session.command("roll"));
  const oldRevision = session.getState().revision;
  session.setNow(16400);
  session.disconnectPlayer("p2");
  const state = session.getState();
  assert.equal(state.started, false);
  assert.equal(state.phase, "rolling");
  assert.equal(state.revision > oldRevision, true);
  session.advanceAt(50000);
  assert.equal(state.phase, "rolling");
  assert.deepEqual(state.players.p1.tokens, [-1, -1, -1, -1]);
  const staleCommand = { type: "roll", roundId: state.roundId, revision: oldRevision };
  session.connectPlayer("p2");
  assert.equal(state.startAt, 55000);
  session.advanceAt(54999);
  assert.equal(state.started, false);
  session.advanceAt(55000);
  assert.equal(state.started, true);
  assert.equal(state.phaseEndsAtMs, 55650);
  assert.equal(state.lastAction.startedAtMs, 54600);
  assert.equal(session.sendInput("p1", staleCommand), false);
  assert.equal(session.getRollCount(), 1);
  session.advanceAt(55649);
  assert.equal(state.phase, "rolling");
  session.advanceAt(55650);
  assert.equal(state.phase, "choose");
});

test("Ludo reconnect preserves choice time, positions, captures and series scores without reviving old commands", () => {
  const session = createLudoRoomSession();
  session.activate();
  const state = session.getState();
  state.players.p1.tokens[0] = 12;
  state.players.p1.captures = 2;
  state.players.p1.seriesWins = 3;
  state.players.p1.rejoinToken = "owned-private-token";
  session.sendInput("p1", session.command("roll"));
  session.advanceAt(16050);
  const staleMove = session.command("move", { tokenIndex: 0 });
  session.setNow(20050);
  session.disconnectPlayer("p1");
  session.advanceAt(80000);
  session.connectPlayer("p1");
  session.advanceAt(85000);
  assert.equal(state.phase, "choose");
  assert.equal(state.turnEndsAtMs, 111000);
  assert.equal(state.players.p1.tokens[0], 12);
  assert.equal(state.players.p1.captures, 2);
  assert.equal(state.players.p1.seriesWins, 3);
  assert.equal(state.players.p1.rejoinToken, "owned-private-token");
  assert.equal(session.sendInput("p1", staleMove), false);
  assert.equal(session.sendInput("p1", session.command("move", { tokenIndex: 0 })), true);
});

test("Ludo snapshots detach complete stable public state and exclude all room ownership and pause metadata", () => {
  const session = createLudoRoomSession();
  session.activate();
  const state = session.getState();
  state.players.p1.rejoinToken = "private";
  const initialSnapshot = serializeLudoState(state);
  session.sendInput("p1", session.command("roll"));
  const rollingSnapshot = serializeLudoState(state);
  session.advanceAt(16050);
  session.sendInput("p1", session.command("move", { tokenIndex: 1 }));
  const movingSnapshot = serializeLudoState(state);
  assert.deepEqual(Object.keys(initialSnapshot), Object.keys(movingSnapshot));
  assert.deepEqual(Object.keys(initialSnapshot.lastAction), Object.keys(movingSnapshot.lastAction));
  assert.deepEqual(Object.keys(initialSnapshot.players.p1), Object.keys(movingSnapshot.players.p1));
  assert.equal(JSON.stringify(movingSnapshot).includes("private"), false);
  assert.equal(Object.hasOwn(movingSnapshot, "legalTokenIndices"), false);
  assert.equal(Object.hasOwn(movingSnapshot, "rematchRequests"), false);
  assert.equal(Object.hasOwn(movingSnapshot, "pausedClock"), false);
  assert.equal(rollingSnapshot.lastAction.kind, "roll");
  assert.equal(initialSnapshot.lastAction.kind, "none");
  movingSnapshot.players.p1.tokens[1] = 44;
  movingSnapshot.playerIds[0] = "p4";
  movingSnapshot.lastAction.to = 44;
  assert.equal(state.players.p1.tokens[1], 0);
  assert.equal(state.playerIds[0], "p1");
  assert.equal(state.lastAction.to, 0);
});

test("Ludo rematches require all connected humans and reset the board while preserving seats and series wins", () => {
  const session = createLudoRoomSession();
  session.activate();
  session.requestRematch("p1");
  assert.equal(session.events.length, 0);
  const previous = session.getState();
  previous.players.p1.rejoinToken = "red-seat-token";
  previous.players.p2.rejoinToken = "yellow-seat-token";
  previous.players.p1.tokens = [56, 56, 56, 56];
  previous.players.p1.finished = 4;
  previous.players.p1.seriesWins = 2;
  Object.assign(previous, { phase: "finished", gameOver: true, winner: "p1" });
  const staleRoll = session.command("roll");
  session.requestRematch("p1");
  session.requestRematch("p1");
  assert.equal(session.getState(), previous);
  assert.equal(session.events.filter((event) => event.type === "rematchRequested").length, 1);
  session.requestRematch("p2");
  const next = session.getState();
  assert.notEqual(next, previous);
  assert.equal(next.roundId, 2);
  assert.equal(next.started, false);
  assert.equal(next.startAt, 20000);
  assert.equal(next.gameOver, false);
  assert.deepEqual(next.players.p1.tokens, [-1, -1, -1, -1]);
  assert.equal(next.players.p1.finished, 0);
  assert.equal(next.players.p1.seriesWins, 2);
  assert.equal(next.players.p1.rejoinToken, "red-seat-token");
  assert.equal(next.players.p2.rejoinToken, "yellow-seat-token");
  assert.equal(next.players.p1.connected, true);
  assert.equal(next.players.p2.connected, true);
  assert.equal(session.events.filter((event) => event.type === "rematchStarted").length, 1);
  session.advanceAt(20000);
  assert.equal(session.sendInput("p1", staleRoll), false);
  assert.equal(session.getRollCount(), 0);
});

test("Ludo cleans up abandoned rooms only after retaining their paused match for recovery", () => {
  const session = createLudoRoomSession();
  session.activate();
  const state = session.getState();
  state.players.p2.tokens[0] = 29;
  session.disconnectPlayer("p1");
  assert.equal(session.controller.shouldCleanup(state, 100000), false);
  session.disconnectPlayer("p2");
  assert.equal(session.controller.shouldCleanup(state, 44999), false);
  assert.equal(session.controller.shouldCleanup(state, 45001), true);
  assert.equal(state.players.p2.tokens[0], 29);
});

test("Ludo timeouts do not consume dice and a four-seat server advances to the next configured owner", () => {
  const session = createLudoRoomSession({ playerIds: ["p1", "p2", "p3", "p4"] });
  session.activate();
  const state = session.getState();
  const expiredCommand = session.command("roll");
  session.setNow(45000);
  assert.equal(session.sendInput("p1", expiredCommand), false);
  assert.equal(session.getRollCount(), 0);
  session.advanceAt(45000);
  assert.equal(state.phase, "pass");
  session.advanceAt(45850);
  assert.equal(state.currentPlayerId, "p2");
  assert.equal(state.phase, "roll");
});

test("the direct Ludo server action boundary rejects disconnected and invalid move choices", () => {
  const state = createLudoServerState();
  let rollCount = 0;
  const options = { nowMs: 1000, rollDie: () => { rollCount += 1; return 6; } };
  Object.assign(state, { started: true, turnEndsAtMs: 31000 });
  const input = { type: "roll", roundId: 1, revision: state.revision };
  assert.equal(applyLudoServerInput(state, "p1", input, options), false);
  assert.equal(rollCount, 0);
  state.players.p1.connected = true;
  state.players.p2.connected = true;
  assert.equal(applyLudoServerInput(state, "p1", input, options), true);
  assert.equal(rollCount, 1);
  Object.assign(state, { phase: "choose", turnEndsAtMs: 31000 });
  const beforeMove = serializeLudoState(state);
  for (const tokenIndex of [-1, 4, 0.5, "0"]) {
    assert.equal(applyLudoServerInput(state, "p1", {
      type: "move", roundId: 1, revision: state.revision, tokenIndex,
    }, options), false);
  }
  assert.deepEqual(serializeLudoState(state), beforeMove);
});

function createRegisteredLudoRoomSession({ rollDie = () => 6 } = {}) {
  let connectSocket;
  let scheduledTick;
  let nowMs = 10000;
  let monotonicMs = 0;
  let socketSerial = 0;
  const roomPackets = [];
  const namespace = {
    adapter: { rooms: new Map() },
    sockets: new Map(),
    on: (_eventName, callback) => { connectSocket = callback; },
    to: () => ({ emit: (eventName, payload) => roomPackets.push({ eventName, payload }) }),
  };

  function invokeWithRoomClock(callback) {
    const originalDateNow = Date.now;
    const originalSetTimeout = globalThis.setTimeout;
    const performanceDescriptor = Object.getOwnPropertyDescriptor(performance, "now");
    Date.now = () => nowMs;
    globalThis.setTimeout = (callback) => { scheduledTick = callback; return 0; };
    Object.defineProperty(performance, "now", { configurable: true, value: () => monotonicMs });
    try {
      return callback();
    } finally {
      Date.now = originalDateNow;
      globalThis.setTimeout = originalSetTimeout;
      if (performanceDescriptor) {
        Object.defineProperty(performance, "now", performanceDescriptor);
      } else {
        delete performance.now;
      }
    }
  }

  invokeWithRoomClock(() => registerLudoGame({ of: () => namespace }, { rollDie, nowFn: () => nowMs }));
  const games = getGamesStore(namespace);
  const getState = () => games.get("registered-ludo");
  function connectPlayer(rejoinToken) {
    const handlers = {};
    const events = [];
    const socket = {
      id: `ludo-socket-${++socketSerial}`,
      nsp: namespace,
      connected: true,
      data: {},
      on: (eventName, callback) => { handlers[eventName] = callback; },
      emit: (eventName, payload) => events.push({ eventName, payload }),
      to: () => ({ emit() {} }),
      join(roomId) {
        if (!namespace.adapter.rooms.has(roomId)) namespace.adapter.rooms.set(roomId, new Set());
        namespace.adapter.rooms.get(roomId).add(socket.id);
      },
      leave: (roomId) => namespace.adapter.rooms.get(roomId)?.delete(socket.id),
    };
    namespace.sockets.set(socket.id, socket);
    invokeWithRoomClock(() => {
      connectSocket(socket);
      handlers.joinGame({ gameId: "registered-ludo", rejoinToken });
    });
    return {
      socket, handlers, events,
      invoke: (eventName, payload) => invokeWithRoomClock(() => handlers[eventName](payload)),
      disconnect() {
        invokeWithRoomClock(() => handlers.disconnect());
        socket.connected = false;
        socket.leave("registered-ludo");
        namespace.sockets.delete(socket.id);
      },
    };
  }

  function tickAt(nextNowMs) {
    nowMs = nextNowMs;
    for (let invocation = 0; invocation < 2; invocation += 1) {
      monotonicMs += 100;
      invokeWithRoomClock(() => scheduledTick());
    }
  }

  return { connectPlayer, tickAt, getState, roomPackets };
}

test("registered Ludo rooms recover SDK-owned seats and retain shared voice through rematches", () => {
  const { connectPlayer, tickAt, getState, roomPackets } = createRegisteredLudoRoomSession();
  const red = connectPlayer();
  const yellow = connectPlayer();
  const extra = connectPlayer();
  assert.equal(extra.socket.data.playerId, undefined);
  assert.equal(extra.events.some((event) => event.eventName === "roomFull"), true);
  tickAt(15000);
  assert.equal(getState().started, true);
  const initialPacket = roomPackets.find((packet) => packet.eventName === "state").payload;
  assert.equal(initialPacket.n.tickRate, 10);
  assert.equal(initialPacket.n.room.requiredPlayers, 2);
  assert.equal(initialPacket.p.some((path) => path.includes("rejoinToken")), false);
  const seatToken = getState().players.p1.rejoinToken;
  getState().players.p1.tokens[0] = 17;
  red.disconnect();
  const recoveredRed = connectPlayer(seatToken);
  assert.equal(recoveredRed.socket.data.playerId, "p1");
  assert.equal(getState().players.p1.rejoinToken, seatToken);
  assert.equal(getState().players.p1.tokens[0], 17);
  tickAt(20000);
  recoveredRed.invoke("platform:voice:join", { version: 1, requestId: "red-voice" });
  yellow.invoke("platform:voice:join", { version: 1, requestId: "yellow-voice" });
  const redParticipantId = recoveredRed.events.find((event) => event.eventName === "platform:voice:ready").payload.participantId;
  const previous = getState();
  Object.assign(previous, { gameOver: true, winner: "p1", phase: "finished" });
  recoveredRed.invoke("rematch");
  yellow.invoke("rematch");
  assert.equal(getState().roundId, 2);
  assert.equal(getState().players.p1.rejoinToken, seatToken);
  recoveredRed.invoke("platform:voice:state", { version: 1, muted: false });
  const voiceState = yellow.events.findLast((event) => event.eventName === "platform:voice:state");
  assert.equal(voiceState.payload.participantId, redParticipantId);
  assert.equal(voiceState.payload.muted, false);
});

test("packed Ludo snapshots omit derived choices while selection grows from one piece to four", () => {
  let diceValue = 2;
  const { connectPlayer, tickAt, getState, roomPackets } = createRegisteredLudoRoomSession({ rollDie: () => diceValue });
  const red = connectPlayer();
  const yellow = connectPlayer();
  tickAt(15000);
  const state = getState();
  state.players.p1.tokens[0] = 10;
  red.invoke("input", { type: "roll", roundId: 1, revision: state.revision });
  assert.equal(state.phase, "rolling");
  tickAt(16050);
  assert.deepEqual(state.legalTokenIndices, [0]);
  // Stay in each selection long enough to exercise the platform schema refresh.
  for (let tickIndex = 1; tickIndex <= 65; tickIndex += 1) {
    tickAt(16050 + tickIndex * 100);
  }
  red.invoke("input", { type: "move", roundId: 1, revision: state.revision, tokenIndex: 0 });
  assert.equal(state.phase, "moving");
  tickAt(23090);
  assert.equal(state.currentPlayerId, "p2");
  diceValue = 6;
  yellow.invoke("input", { type: "roll", roundId: 1, revision: state.revision });
  tickAt(24140);
  assert.deepEqual(state.legalTokenIndices, [0, 1, 2, 3]);
  for (let tickIndex = 1; tickIndex <= 65; tickIndex += 1) {
    tickAt(24140 + tickIndex * 100);
  }
  yellow.invoke("input", { type: "move", roundId: 1, revision: state.revision, tokenIndex: 3 });
  tickAt(30740);
  assert.equal(state.phase, "moving");
  assert.deepEqual(state.legalTokenIndices, []);

  const keyframes = roomPackets.filter((packet) => packet.eventName === "state" && packet.payload.k === "f");
  assert.ok(keyframes.length > 10);
  for (const keyframe of keyframes) {
    assert.equal(keyframe.payload.p.some((path) => path.startsWith("legalTokenIndices")), false);
  }
  assert.equal(Object.hasOwn(serializeLudoState(state), "legalTokenIndices"), false);
});
