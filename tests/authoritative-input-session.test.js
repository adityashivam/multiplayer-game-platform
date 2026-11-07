import test from "node:test";
import assert from "node:assert/strict";
import { createAuthoritativeInputSession } from "../server/platform-backend-engine/core/authoritativeInputSession.js";

const INPUT_TEMPLATE = { drift: false, ignite: false };

function createSession(options = {}) {
  return createAuthoritativeInputSession({
    inputTemplate: INPUT_TEMPLATE,
    edgeKeys: ["ignite"],
    ...options,
  });
}

function createInputFrame(playerState, sequenceNumber, inputOverrides = {}) {
  return {
    type: "inputFrame",
    protocol: 2,
    epoch: playerState.inputEpoch,
    seq: sequenceNumber,
    state: { ...INPUT_TEMPLATE, ...inputOverrides },
  };
}

function simulateSessionPlayer(session, playerState, options = {}) {
  return session.simulatePlayer({
    player: playerState,
    dtSec: 1 / 60,
    loopTick: 1,
    nowMs: 100,
    droppedSteps: 0,
    simulate() {},
    ...options,
  });
}

test("custom input schemas use a configured fixed step and acknowledge after simulation", () => {
  const session = createSession({ fixedDtSec: 1 / 30 });
  const playerState = { distance: 0 };
  session.resetPlayer(playerState);
  const inputFrame = createInputFrame(playerState, 1, { drift: true });
  assert.equal(session.receiveInput(playerState, inputFrame, 100), true);
  inputFrame.state.drift = false;
  assert.equal(playerState.lastInputSeqAck, 0);

  const consumedFrameCount = simulateSessionPlayer(session, playerState, {
    simulate: (inputState, dtSec, consumedFrame) => {
      assert.deepEqual(inputState, { drift: true, ignite: false });
      assert.equal(playerState.lastInputSeqAck, 0);
      assert.equal(playerState.inputSimulationTick, 0);
      assert.equal(consumedFrame.seq, 1);
      assert.equal(dtSec, 1 / 30);
      playerState.distance += 90 * dtSec;
    },
  });

  assert.equal(consumedFrameCount, 1);
  assert.equal(playerState.distance, 3);
  assert.equal(playerState.lastInputSeqAck, 1);
  assert.equal(playerState.inputSimulationTick, 1);
});

test("invalid, duplicate, stale and wrong-epoch frames cannot take command ownership", () => {
  const session = createSession();
  const playerState = {};
  session.resetPlayer(playerState);
  const validFrame = createInputFrame(playerState, 1);
  const invalidFrames = [
    { ...validFrame, seq: 0 },
    { ...validFrame, seq: 1.5 },
    { ...validFrame, epoch: playerState.inputEpoch - 1 },
    { ...validFrame, state: { drift: true } },
    { ...validFrame, state: { drift: "yes", ignite: false } },
    { ...validFrame, state: { ...INPUT_TEMPLATE, unknown: false } },
  ];
  for (const inputFrame of invalidFrames) {
    assert.equal(session.receiveInput(playerState, inputFrame, 99), false);
  }
  assert.equal(playerState.lastInputSeqAck, 0);
  assert.equal(playerState.inputProtocol, null);

  assert.equal(session.receiveInput(playerState, validFrame, 100), true);
  assert.equal(session.receiveInput(playerState, validFrame, 599), false);
  assert.equal(session.receiveInput(playerState, { type: "drift", value: true, seq: 99 }, 599), false);
  assert.equal(playerState.__lastInputReceiptMs, 100);
  assert.equal(playerState.lastInputSeqAck, 0);

  simulateSessionPlayer(session, playerState);
  assert.equal(session.receiveInput(playerState, validFrame, 100), false);
  assert.equal(playerState.lastInputSeqAck, 1);
});

test("reset advances ownership and removes queued commands, acknowledgements and held input", () => {
  const session = createSession();
  const playerState = {};
  session.resetPlayer(playerState);
  session.receiveInput(playerState, createInputFrame(playerState, 1, { drift: true }), 100);
  simulateSessionPlayer(session, playerState);
  const oldFrame = createInputFrame(playerState, 2, { drift: true });
  session.receiveInput(playerState, oldFrame, 100);

  session.resetPlayer(playerState);

  assert.equal(playerState.inputEpoch, 2);
  assert.equal(playerState.inputProtocol, null);
  assert.equal(playerState.lastInputSeqAck, 0);
  assert.equal(playerState.inputSimulationTick, 0);
  assert.deepEqual(playerState.input, { drift: false, ignite: false });
  assert.equal(session.receiveInput(playerState, oldFrame, 101), false);
  simulateSessionPlayer(session, playerState, {
    simulate: (inputState) => assert.deepEqual(inputState, { drift: false, ignite: false }),
  });
  assert.equal(playerState.lastInputSeqAck, 0);

  assert.equal(session.receiveInput(playerState, createInputFrame(playerState, 1), 102), true);
  simulateSessionPlayer(session, playerState, { nowMs: 102 });
  assert.equal(playerState.lastInputSeqAck, 1);
});

test("500 ms starvation neutralizes held controls and advances the epoch only once", () => {
  const session = createSession();
  const playerState = {};
  session.resetPlayer(playerState);
  session.receiveInput(playerState, createInputFrame(playerState, 1, { drift: true }), 100);

  simulateSessionPlayer(session, playerState, { nowMs: 600 });
  assert.equal(playerState.inputEpoch, 1);
  assert.equal(playerState.input.drift, true);

  simulateSessionPlayer(session, playerState, {
    loopTick: 2,
    nowMs: 601,
    simulate: (inputState) => assert.equal(inputState.drift, false),
  });
  assert.equal(playerState.inputEpoch, 2);
  assert.equal(playerState.lastInputSeqAck, 0);
  assert.equal(playerState.inputProtocol, null);

  simulateSessionPlayer(session, playerState, { loopTick: 3, nowMs: 1200 });
  assert.equal(playerState.inputEpoch, 2);
});

test("dropped simulation steps invalidate queued ownership once per counter increase", () => {
  const session = createSession();
  const playerState = {};
  session.resetPlayer(playerState);
  session.receiveInput(playerState, createInputFrame(playerState, 1, { drift: true }), 100);
  simulateSessionPlayer(session, playerState);
  const previousEpochFrame = createInputFrame(playerState, 2, { drift: true });
  session.receiveInput(playerState, previousEpochFrame, 101);

  simulateSessionPlayer(session, playerState, { loopTick: 2, droppedSteps: 3 });
  assert.equal(playerState.inputEpoch, 2);
  assert.equal(playerState.input.drift, false);
  assert.equal(playerState.lastInputSeqAck, 0);
  assert.equal(session.receiveInput(playerState, previousEpochFrame, 101), false);

  session.receiveInput(playerState, createInputFrame(playerState, 1), 102);
  simulateSessionPlayer(session, playerState, { loopTick: 3, nowMs: 102, droppedSteps: 3 });
  assert.equal(playerState.inputEpoch, 2);
  assert.equal(playerState.lastInputSeqAck, 1);
});

test("catch-up shares an eight-command loop budget and preserves custom short action edges", () => {
  const session = createSession();
  const playerState = {};
  session.resetPlayer(playerState);
  session.receiveInput(playerState, createInputFrame(playerState, 1), 100);
  for (let loopTick = 1; loopTick <= 20; loopTick += 1) {
    simulateSessionPlayer(session, playerState, { loopTick });
  }
  for (let sequenceNumber = 2; sequenceNumber <= 20; sequenceNumber += 1) {
    session.receiveInput(playerState, createInputFrame(playerState, sequenceNumber, {
      ignite: sequenceNumber === 3,
    }), 100);
  }

  const actionEdges = [];
  const simulate = (inputState) => actionEdges.push(inputState.ignite);
  assert.equal(simulateSessionPlayer(session, playerState, { loopTick: 21, simulate }), 8);
  assert.equal(playerState.lastInputSeqAck, 9);
  assert.equal(playerState.input.ignite, false);
  assert.equal(simulateSessionPlayer(session, playerState, { loopTick: 21, simulate }), 0);
  assert.equal(playerState.lastInputSeqAck, 9);
  assert.equal(simulateSessionPlayer(session, playerState, { loopTick: 22, simulate }), 8);
  assert.equal(playerState.lastInputSeqAck, 17);
  assert.deepEqual(actionEdges, [true, false, false]);
});

test("a failed simulation retains its command and acknowledgement for retry", () => {
  const session = createSession();
  const playerState = {};
  session.resetPlayer(playerState);
  session.receiveInput(playerState, createInputFrame(playerState, 1), 100);

  assert.throws(() => simulateSessionPlayer(session, playerState, {
    simulate: () => {
      throw new Error("game step failed");
    },
  }), /game step failed/);
  assert.equal(playerState.lastInputSeqAck, 0);
  assert.equal(playerState.inputSimulationTick, 0);

  assert.equal(simulateSessionPlayer(session, playerState), 1);
  assert.equal(playerState.lastInputSeqAck, 1);
});

test("legacy controls retain their acknowledgement and movement until queued ownership starts", () => {
  const session = createSession();
  const playerState = {};
  session.resetPlayer(playerState);
  assert.equal(session.receiveInput(playerState, { type: "drift", value: true, seq: 7 }, 100), true);
  assert.equal(playerState.lastInputSeqAck, 7);
  simulateSessionPlayer(session, playerState, {
    dtSec: 1 / 30,
    simulate: (inputState, dtSec) => {
      assert.equal(inputState.drift, true);
      assert.equal(dtSec, 1 / 30);
    },
  });

  session.receiveInput(playerState, createInputFrame(playerState, 8), 101);
  assert.equal(session.receiveInput(playerState, { type: "drift", value: true, seq: 9 }, 101), false);
  simulateSessionPlayer(session, playerState, {
    nowMs: 101,
    simulate: (inputState) => {
      assert.equal(inputState.drift, false);
      assert.equal(playerState.lastInputSeqAck, 7);
    },
  });
  assert.equal(playerState.lastInputSeqAck, 8);
});

test("a configured starvation interval controls queued ownership recovery", () => {
  const session = createSession({ starvationMs: 75 });
  const playerState = {};
  session.resetPlayer(playerState);
  session.receiveInput(playerState, createInputFrame(playerState, 1, { drift: true }), 100);
  simulateSessionPlayer(session, playerState, { nowMs: 175 });
  assert.equal(playerState.inputEpoch, 1);

  simulateSessionPlayer(session, playerState, { nowMs: 176, loopTick: 2 });
  assert.equal(playerState.inputEpoch, 2);
  assert.equal(playerState.input.drift, false);
});

test("invalid timing configuration fails before a player can be simulated", () => {
  for (const fixedDtSec of [0, -1, NaN, Infinity]) {
    assert.throws(() => createSession({ fixedDtSec }), TypeError);
  }
  for (const starvationMs of [-1, NaN, Infinity]) {
    assert.throws(() => createSession({ starvationMs }), TypeError);
  }
});

test("room simulation owns timing and visits custom player slots in their declared order", () => {
  const session = createSession({ fixedDtSec: 1 / 30 });
  const state = {
    players: { zulu: { distance: 0 }, alpha: { distance: 0 }, middle: { distance: 0 } },
    __loopTick: 7,
    __loopMonotonicNow: 100,
  };
  for (const playerState of Object.values(state.players)) {
    session.resetPlayer(playerState);
  }
  session.receiveInput(state.players.zulu, createInputFrame(state.players.zulu, 1, { drift: true }), 100);
  session.receiveInput(state.players.alpha, createInputFrame(state.players.alpha, 1, { ignite: true }), 100);
  session.receiveInput(state.players.middle, { type: "drift", value: true }, 100);
  const simulatedPlayers = [];

  const consumedFrameCount = session.simulateRoom({
    state,
    dtSec: 1 / 30,
    simulate: (playerState, inputState, dtSec, playerId, inputFrame) => {
      assert.equal(playerState, state.players[playerId]);
      assert.equal(playerState.lastInputSeqAck, 0);
      assert.equal(dtSec, 1 / 30);
      simulatedPlayers.push([playerId, inputState.drift, inputState.ignite, inputFrame?.seq ?? null]);
      if (inputState.drift) {
        playerState.distance += 90 * dtSec;
      }
    },
  });

  assert.equal(consumedFrameCount, 2);
  assert.deepEqual(simulatedPlayers, [["zulu", true, false, 1], ["alpha", false, true, 1], ["middle", true, false, null]]);
  assert.equal(state.players.zulu.distance, 3);
  assert.equal(state.players.middle.distance, 3);
  assert.equal(state.players.zulu.lastInputSeqAck, 1);
  assert.equal(state.players.alpha.lastInputSeqAck, 1);
});

test("room catch-up shares the SDK loop command budget independently for each custom slot", () => {
  const session = createSession();
  const state = { players: { north: {}, south: {} }, __loopTick: 0, __loopMonotonicNow: 100 };
  for (const playerState of Object.values(state.players)) {
    session.resetPlayer(playerState);
    session.receiveInput(playerState, createInputFrame(playerState, 1), 100);
  }
  const advanceRoom = () => session.simulateRoom({ state, dtSec: 1 / 60, simulate() {} });
  for (let loopTick = 1; loopTick <= 20; loopTick += 1) {
    state.__loopTick = loopTick;
    advanceRoom();
  }
  for (const playerState of Object.values(state.players)) {
    for (let sequenceNumber = 2; sequenceNumber <= 20; sequenceNumber += 1) {
      session.receiveInput(playerState, createInputFrame(playerState, sequenceNumber), 100);
    }
  }

  state.__loopTick = 21;
  assert.equal(advanceRoom(), 16);
  assert.equal(advanceRoom(), 0);
  assert.equal(state.players.north.lastInputSeqAck, 9);
  assert.equal(state.players.south.lastInputSeqAck, 9);
  state.__loopTick = 22;
  assert.equal(advanceRoom(), 16);
  assert.equal(state.players.north.lastInputSeqAck, 17);
  assert.equal(state.players.south.lastInputSeqAck, 17);
});

test("room dropped-step recovery resets every queued owner once and discards stale commands", () => {
  const session = createSession();
  const state = {
    players: { pilot: {}, navigator: {} },
    __loopTick: 1,
    __loopMonotonicNow: 100,
    __roomClock: { droppedSteps: 0 },
  };
  for (const playerState of Object.values(state.players)) {
    session.resetPlayer(playerState);
    session.receiveInput(playerState, createInputFrame(playerState, 1, { drift: true }), 100);
  }
  const advanceRoom = () => session.simulateRoom({ state, dtSec: 1 / 60, simulate() {} });
  assert.equal(advanceRoom(), 2);
  const staleFrames = Object.values(state.players).map((playerState) => createInputFrame(playerState, 2));
  for (const [playerIndex, playerState] of Object.values(state.players).entries()) {
    session.receiveInput(playerState, staleFrames[playerIndex], 100);
  }

  state.__loopTick = 2;
  state.__roomClock.droppedSteps = 4;
  assert.equal(advanceRoom(), 0);
  for (const [playerIndex, playerState] of Object.values(state.players).entries()) {
    assert.equal(playerState.inputEpoch, 2);
    assert.equal(playerState.lastInputSeqAck, 0);
    assert.equal(playerState.input.drift, false);
    assert.equal(session.receiveInput(playerState, staleFrames[playerIndex], 100), false);
    session.receiveInput(playerState, createInputFrame(playerState, 1), 100);
  }

  state.__loopTick = 3;
  assert.equal(advanceRoom(), 2);
  for (const playerState of Object.values(state.players)) {
    assert.equal(playerState.inputEpoch, 2);
    assert.equal(playerState.lastInputSeqAck, 1);
  }
});

test("room monotonic timing recovers only owners whose input has starved", () => {
  const session = createSession();
  const state = { players: { old: {}, recent: {} }, __loopTick: 1, __loopMonotonicNow: 601 };
  for (const playerState of Object.values(state.players)) {
    session.resetPlayer(playerState);
  }
  session.receiveInput(state.players.old, createInputFrame(state.players.old, 1, { drift: true }), 100);
  session.receiveInput(state.players.recent, createInputFrame(state.players.recent, 1, { drift: true }), 590);
  const simulatedInput = [];
  session.simulateRoom({
    state,
    dtSec: 1 / 60,
    simulate: (_player, inputState, _dtSec, playerId) => simulatedInput.push([playerId, inputState.drift]),
  });

  assert.deepEqual(simulatedInput, [["old", false], ["recent", true]]);
  assert.equal(state.players.old.inputEpoch, 2);
  assert.equal(state.players.old.lastInputSeqAck, 0);
  assert.equal(state.players.recent.inputEpoch, 1);
  assert.equal(state.players.recent.lastInputSeqAck, 1);
});

test("a room callback failure retains its command and stops later slots without undoing earlier slots", () => {
  const session = createSession();
  const state = { players: { first: {}, second: {}, third: {} }, __loopTick: 1, __loopMonotonicNow: 100 };
  for (const playerState of Object.values(state.players)) {
    session.resetPlayer(playerState);
    session.receiveInput(playerState, createInputFrame(playerState, 1), 100);
  }
  const simulatedPlayers = [];
  const simulationError = new Error("second player's game simulation failed");
  assert.throws(() => session.simulateRoom({
    state,
    dtSec: 1 / 60,
    simulate: (playerState, _inputState, _dtSec, playerId) => {
      simulatedPlayers.push(playerId);
      if (playerId === "second") {
        throw simulationError;
      }
      playerState.score = 7;
    },
  }), (error) => error === simulationError);
  assert.deepEqual(simulatedPlayers, ["first", "second"]);
  assert.equal(state.players.first.score, 7);
  assert.equal(state.players.first.lastInputSeqAck, 1);
  assert.equal(state.players.second.lastInputSeqAck, 0);
  assert.equal(state.players.third.lastInputSeqAck, 0);

  assert.equal(session.simulateRoom({ state, dtSec: 1 / 60, simulate() {} }), 2);
  assert.equal(state.players.second.lastInputSeqAck, 1);
  assert.equal(state.players.third.lastInputSeqAck, 1);
});

test("snapshot metadata retains wire defaults and owns its serialized field values", () => {
  const session = createSession();
  assert.deepEqual(session.getPlayerSnapshotMetadata({}), {
    inputSeqAck: 0,
    inputEpoch: undefined,
    inputSimulationTick: undefined,
  });
  const playerState = { lastInputSeqAck: 7, inputEpoch: 3, inputSimulationTick: 10 };
  const metadata = session.getPlayerSnapshotMetadata(playerState);
  assert.deepEqual(metadata, { inputSeqAck: 7, inputEpoch: 3, inputSimulationTick: 10 });
  playerState.lastInputSeqAck = 8;
  assert.equal(metadata.inputSeqAck, 7);
  metadata.inputEpoch = 9;
  assert.equal(playerState.inputEpoch, 3);
  assert.equal(session.getPlayerSnapshotMetadata({ lastInputSeqAck: NaN }).inputSeqAck, 0);
});
