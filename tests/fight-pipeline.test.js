import test from "node:test";
import assert from "node:assert/strict";
import { registerFightGame, serializeFightState } from "../server/platform-backend-engine/games/fight.js";
import { getGamesStore } from "../server/platform-backend-engine/core/gameStore.js";
import { tickGames } from "../server/platform-backend-engine/core/gameLoop.js";
import { FIGHT_INPUT_TEMPLATE } from "../public/games/fight/shared/simulation.js";

function createFightTestSession() {
  let connectSocket;
  const socketHandlers = {};
  const snapshotPackets = [];
  const namespace = {
    adapter: { rooms: new Map() },
    sockets: new Map(),
    on: (_event, callback) => {
      connectSocket = callback;
    },
    to: () => ({ emit: (event, payload) => {
      if (event === "state") snapshotPackets.push(structuredClone(payload));
    } }),
  };

  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = () => 0;
  let simulation;
  try {
    simulation = registerFightGame({ of: () => namespace });
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }

  const socket = {
    data: {},
    on: (eventName, callback) => {
      socketHandlers[eventName] = callback;
    },
    join() {},
    emit() {},
    to: () => ({ emit() {} }),
  };
  connectSocket(socket);
  socketHandlers.joinGame({ gameId: "room" });

  const games = getGamesStore(namespace);
  const state = games.get("room");
  state.started = true;
  state.startAt = null;
  state.players.p1.y = 870;
  let monotonicNowMs = performance.now();

  const advanceRoomTick = (elapsedMs) => {
    monotonicNowMs += elapsedMs;
    tickGames({
      games,
      nsp: namespace,
      monotonicNowMs,
      tickMs: 1000 / 60,
      updateState: (gameState, dtSec) => simulation.step(gameState, dtSec),
      serializeState: serializeFightState,
    });
  };
  const sendInputFrame = (sequenceNumber, inputOverrides = {}) => {
    socketHandlers.input({
      type: "inputFrame",
      protocol: 2,
      epoch: state.players.p1.inputEpoch,
      seq: sequenceNumber,
      state: { ...FIGHT_INPUT_TEMPLATE, ...inputOverrides },
    });
    state.players.p1.__lastInputReceiptMs = monotonicNowMs;
  };

  advanceRoomTick(0);
  return { state, advanceRoomTick, sendInputFrame, snapshotPackets, socketHandlers };
}

test("Fight continues jump and attack timers without new frames", () => {
  const { state, advanceRoomTick, sendInputFrame } = createFightTestSession();
  sendInputFrame(1, { jump: true, attack: true });
  advanceRoomTick(17);

  const playerState = state.players.p1;
  const previousY = playerState.y;
  const previousAttackTimer = playerState.attackTimer;
  advanceRoomTick(17);

  assert.ok(playerState.y < previousY);
  assert.ok(playerState.attackTimer < previousAttackTimer);
  assert.equal(playerState.lastInputSeqAck, 1);
  assert.equal(playerState.inputSimulationTick, 2);
});

test("Fight resets stale command epoch after dropped world steps", () => {
  const { state, advanceRoomTick, sendInputFrame } = createFightTestSession();
  sendInputFrame(1, { right: true });
  advanceRoomTick(17);

  const playerState = state.players.p1;
  const previousInputEpoch = playerState.inputEpoch;
  for (let sequenceNumber = 2; sequenceNumber <= 30; sequenceNumber += 1) {
    sendInputFrame(sequenceNumber, { right: true });
  }
  advanceRoomTick(500);
  advanceRoomTick(17);

  assert.ok(playerState.inputEpoch > previousInputEpoch);
  assert.equal(playerState.lastInputSeqAck, 0);

  const resetInputEpoch = playerState.inputEpoch;
  sendInputFrame(1, { right: true });
  advanceRoomTick(17);
  assert.equal(playerState.inputEpoch, resetInputEpoch);
  assert.equal(playerState.lastInputSeqAck, 1);
});

test("input starvation resets epoch once and neutralizes held movement", () => {
  const { state, advanceRoomTick, sendInputFrame } = createFightTestSession();
  sendInputFrame(1, { right: true });
  advanceRoomTick(17);

  const playerState = state.players.p1;
  const previousInputEpoch = playerState.inputEpoch;
  for (let tickIndex = 0; tickIndex < 31; tickIndex += 1) {
    advanceRoomTick(17);
  }
  assert.equal(playerState.inputEpoch, previousInputEpoch + 1);
  assert.equal(playerState.inputProtocol, null);
  assert.equal(playerState.input.right, false);

  const stoppedX = playerState.x;
  for (let tickIndex = 0; tickIndex < 5; tickIndex += 1) {
    advanceRoomTick(17);
  }
  assert.equal(playerState.inputEpoch, previousInputEpoch + 1);
  assert.equal(playerState.x, stoppedX);
});

test("authoritative combat respects startup and resolves after both players move", () => {
  const { state, advanceRoomTick, sendInputFrame } = createFightTestSession();
  Object.assign(state.players.p1, { x: 300, y: 870, dir: 1 });
  Object.assign(state.players.p2, { x: 450, y: 870, dir: -1 });
  sendInputFrame(1, { attack: true });
  advanceRoomTick(17);
  assert.equal(state.players.p2.health, 500);
  for (let tick = 0; tick < 5; tick++) advanceRoomTick(17);
  assert.ok(state.players.p2.health < 500);
  assert.equal(state.combatEvents.length, 1);
  assert.equal(state.combatEvents[0].kind, "hit");
  assert.equal(state.combatEvents[0].attackerId, "p1");
});

test("crossing aerial attacks use the same facing phase for both slots", () => {
  const { state, advanceRoomTick, sendInputFrame } = createFightTestSession();
  Object.assign(state.players.p1, { x: 500, y: 700, dir: 1 });
  Object.assign(state.players.p2, { x: 510, y: 580, dir: -1, input: { ...FIGHT_INPUT_TEMPLATE, left: true, attack: true } });
  sendInputFrame(1, { right: true, attack: true });
  advanceRoomTick(17);
  assert.equal(state.players.p1.dir, 1);
  assert.equal(state.players.p2.dir, -1);
  for (let tick = 0; tick < 4; tick++) advanceRoomTick(17);
  assert.equal(state.players.p1.health, state.players.p2.health);
});

test("a newly appended combat event is visible on the very next packed snapshot", () => {
  const { state, advanceRoomTick, snapshotPackets } = createFightTestSession();
  const event = { id: 1, kind: "hit", attackerId: "p1", defenderId: "p2", attackType: "light", damage: 24, x: 450, y: 870 };
  state.combatEvents.push(event);
  for (let tick = 0; tick < 70; tick++) advanceRoomTick(17);
  state.combatEvents.push({ ...event, id: 2 });
  advanceRoomTick(17);

  let paths = [];
  let values = [];
  for (const packet of snapshotPackets) {
    if (packet.k === "f") {
      paths = packet.p;
      values = packet.v.slice();
    } else {
      for (const [index, value] of packet.c) values[index] = value;
    }
  }
  const receivedIds = paths.flatMap((path, index) => path === "combatEvents"
    ? values[index].map((combatEvent) => combatEvent.id)
    : /^combatEvents\.\d+\.id$/.test(path) ? [values[index]] : []);
  assert.ok(receivedIds.includes(2), "hit events must not wait for a periodic schema refresh");
});

test("a reconnect preserves the remaining duel clock and fighter health", () => {
  const { state, socketHandlers } = createFightTestSession();
  state.players.p2.connected = true;
  state.timer = 42;
  state.players.p1.health = 350;
  const token = state.players.p1.rejoinToken;
  socketHandlers.disconnect();
  socketHandlers.joinGame({ gameId: "room", rejoinToken: token });
  assert.equal(state.timer, 42);
  assert.equal(state.players.p1.health, 350);
});

test("both players disconnecting pauses rather than resetting a live duel", () => {
  const { state, socketHandlers } = createFightTestSession();
  state.timer = 31;
  socketHandlers.disconnect();
  assert.equal(state.started, false);
  assert.equal(state.timer, 31);
  assert.ok(state.abandonedAt > 0);
});
