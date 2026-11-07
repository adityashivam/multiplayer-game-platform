import test from "node:test";
import assert from "node:assert/strict";
import { registerFightGame } from "../server/platform-backend-engine/games/fight.js";
import { getGamesStore } from "../server/platform-backend-engine/core/gameStore.js";
import { tickGames } from "../server/platform-backend-engine/core/gameLoop.js";
import { FIGHT_INPUT_TEMPLATE } from "../public/platform/shared/fightSimulation.js";

function createFightTestSession() {
  let connectSocket;
  const socketHandlers = {};
  const namespace = {
    adapter: { rooms: new Map() },
    sockets: new Map(),
    on: (_event, callback) => {
      connectSocket = callback;
    },
    to: () => ({ emit() {} }),
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
      serializeState: () => ({}),
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
  return { state, advanceRoomTick, sendInputFrame };
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
