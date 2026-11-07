import test from "node:test";
import assert from "node:assert/strict";
import { createPredictedInputSession } from "../public/platform/frontend-engine/predictedInputSession.js";
import { createAuthoritativeInputSession } from "../server/platform-backend-engine/core/authoritativeInputSession.js";

function createMovementSession(overrides = {}) {
  const sentPackets = [];
  const inputState = { east: true, hop: false };
  const inputSession = createPredictedInputSession({
    captureInput: () => ({ ...inputState }),
    sendInput: (inputPacket) => sentPackets.push(inputPacket),
    simulate: (playerState, capturedInput, dtSec) => {
      if (capturedInput.east) playerState.distance += 60 * dtSec;
      if (capturedInput.hop) playerState.hops += 1;
    },
    extractPose: (playerState) => ({ distance: playerState.distance }),
    ...overrides,
  });
  const receiveAuthority = (overrides = {}) => inputSession.receiveAuthority({
    state: { distance: 0, hops: 0 },
    protocol: 2,
    inputEpoch: 7,
    acknowledgedSequence: 0,
    ...overrides,
  });

  return { inputSession, sentPackets, inputState, receiveAuthority };
}

function createClientServerMovementSession(fixedDtSec = 1 / 60) {
  const queuedPackets = [];
  const sentPackets = [];
  const authoritativePlayer = { distance: 0, hops: 0, input: { east: false, hop: false } };
  const serverInputSession = createAuthoritativeInputSession({
    inputTemplate: { east: false, hop: false },
    edgeKeys: ["hop"],
    fixedDtSec,
  });
  serverInputSession.resetPlayer(authoritativePlayer);
  const { inputSession, inputState } = createMovementSession({
    fixedDtSec,
    sendInput: (inputPacket) => {
      sentPackets.push(inputPacket);
      queuedPackets.push(inputPacket);
    },
  });
  inputState.east = false;
  let worldTick = 0;

  function receiveAuthority() {
    inputSession.receiveAuthority({
      state: { distance: authoritativePlayer.distance, hops: authoritativePlayer.hops },
      protocol: 2,
      inputEpoch: authoritativePlayer.inputEpoch,
      acknowledgedSequence: authoritativePlayer.lastInputSeqAck,
      context: { simulationTick: authoritativePlayer.inputSimulationTick },
    });
  }

  function deliverInputs() {
    while (queuedPackets.length) {
      const accepted = serverInputSession.receiveInput(authoritativePlayer, queuedPackets.shift(), worldTick * fixedDtSec * 1000);
      assert.equal(accepted, true);
    }
  }

  function advanceWorld() {
    worldTick += 1;
    serverInputSession.simulatePlayer({
      player: authoritativePlayer,
      dtSec: fixedDtSec,
      loopTick: worldTick,
      nowMs: worldTick * fixedDtSec * 1000,
      simulate: (input, stepSec) => {
        if (input.east) authoritativePlayer.distance += 60 * stepSec;
        if (input.hop) authoritativePlayer.hops += 1;
      },
    });
    receiveAuthority();
  }

  receiveAuthority();
  inputSession.captureAndPredict();
  deliverInputs();
  advanceWorld();

  return { inputSession, inputState, authoritativePlayer, sentPackets, deliverInputs, advanceWorld };
}

test("a game supplies its own input and state keys while the session owns command encoding", () => {
  const { inputSession, sentPackets, receiveAuthority } = createMovementSession();
  assert.equal(inputSession.captureAndPredict(), null);
  assert.equal(sentPackets.length, 0);

  receiveAuthority();
  inputSession.captureAndPredict();

  assert.deepEqual(inputSession.getState(), { distance: 1, hops: 0 });
  assert.deepEqual(sentPackets, [{
    type: "inputFrame", protocol: 2, epoch: 7, seq: 1,
    state: { east: true, hop: false },
  }]);
  assert.equal(inputSession.getStats().pendingCommands, 1);
});

test("a different game can predict a paddle at 30 Hz and send a legacy frame", () => {
  const sentPackets = [];
  const paddleSession = createPredictedInputSession({
    fixedDtSec: 1 / 30,
    captureInput: () => ({ up: true, down: false }),
    sendInput: (inputPacket) => sentPackets.push(inputPacket),
    simulate: (paddleState, paddleInput, dtSec) => {
      if (paddleInput.up) paddleState.y -= 900 * dtSec;
    },
    extractPose: (paddleState) => ({ y: paddleState.y }),
  });
  paddleSession.receiveAuthority({ state: { y: 360 }, protocol: 1 });
  paddleSession.captureAndPredict();

  assert.deepEqual(paddleSession.getRenderPose(), { y: 330 });
  assert.deepEqual(sentPackets, [{
    type: "inputFrame", seq: 1, dtSec: 1 / 30, state: { up: true, down: false },
  }]);
});

test("acknowledged authority replays only pending commands without changing its source", () => {
  const { inputSession, receiveAuthority } = createMovementSession();
  receiveAuthority();
  inputSession.captureAndPredict();
  inputSession.captureAndPredict();
  inputSession.captureAndPredict();
  const authoritativePlayer = Object.freeze({ distance: 1, hops: 0 });

  receiveAuthority({ state: authoritativePlayer, acknowledgedSequence: 1 });

  assert.deepEqual(authoritativePlayer, { distance: 1, hops: 0 });
  assert.deepEqual(inputSession.getState(), { distance: 3, hops: 0 });
  assert.equal(inputSession.getStats().pendingCommands, 2);
  assert.equal(inputSession.getStats().lastReplayCount, 2);
});

test("new input ownership discards old commands and rejects a delayed previous epoch", () => {
  const { inputSession, receiveAuthority, sentPackets } = createMovementSession();
  receiveAuthority();
  inputSession.captureAndPredict();
  receiveAuthority({ state: { distance: 100, hops: 0 }, inputEpoch: 8 });

  assert.equal(inputSession.getStats().pendingCommands, 0);
  assert.deepEqual(inputSession.getRenderPose(), { distance: 100 });
  assert.equal(receiveAuthority({ state: { distance: -500, hops: 0 } }), false);
  inputSession.captureAndPredict();

  assert.equal(sentPackets.at(-1).epoch, 8);
  assert.equal(sentPackets.at(-1).seq, 1);
  assert.equal(inputSession.getState().distance, 101);
});

test("protocol 2 waits for valid ownership and ignores regressing acknowledgements", () => {
  const { inputSession, receiveAuthority, sentPackets } = createMovementSession();
  receiveAuthority({ inputEpoch: undefined });
  assert.equal(inputSession.captureAndPredict(), null);
  assert.equal(sentPackets.length, 0);

  receiveAuthority();
  inputSession.captureAndPredict();
  receiveAuthority({ state: { distance: 1, hops: 0 }, acknowledgedSequence: 1 });
  assert.equal(receiveAuthority({ state: { distance: -20, hops: 0 }, acknowledgedSequence: 0 }), false);
  assert.equal(inputSession.getState().distance, 1);
});

test("bounded history and simulation ticks prevent replay of elapsed held-input time", () => {
  const { inputSession, receiveAuthority } = createMovementSession({ maxPendingFrames: 3 });
  receiveAuthority();
  for (let commandIndex = 0; commandIndex < 5; commandIndex += 1) {
    inputSession.captureAndPredict();
  }
  assert.equal(inputSession.getStats().pendingCommands, 3);

  receiveAuthority({
    state: { distance: 5, hops: 0 },
    acknowledgedSequence: 3,
    context: { simulationTick: 5 },
  });
  assert.equal(inputSession.getState().distance, 5);
  assert.equal(inputSession.getStats().lastReplayCount, 0);
  inputSession.captureAndPredict({ simulationTick: 5 });
  assert.equal(inputSession.getState().distance, 6);
});

test("a temporary render reset can preserve command ownership until the next authority", () => {
  const { inputSession, receiveAuthority, sentPackets } = createMovementSession();
  receiveAuthority();
  inputSession.captureAndPredict();
  inputSession.reset({ preserveSequence: true });
  assert.equal(inputSession.captureAndPredict(), null);

  receiveAuthority({ state: { distance: 1, hops: 0 }, acknowledgedSequence: 1 });
  inputSession.captureAndPredict();
  assert.equal(sentPackets.at(-1).seq, 2);

  inputSession.stop();
  assert.equal(inputSession.captureAndPredict(), null);
  inputSession.reset();
  receiveAuthority({ inputEpoch: 9 });
  inputSession.captureAndPredict();
  assert.equal(sentPackets.at(-1).seq, 1);
  assert.equal(sentPackets.at(-1).epoch, 9);
});

test("invalid simulation cadence is rejected before capturing or sending input", () => {
  assert.throws(() => createMovementSession({ fixedDtSec: 0 }), /fixedDtSec/);
  assert.throws(() => createMovementSession({ sendInput: null }), /sendInput/);
});

test("a newly attached client continues after the server's existing acknowledged sequence", () => {
  const { inputSession, receiveAuthority, sentPackets } = createMovementSession();
  receiveAuthority({ state: { distance: 10, hops: 0 }, acknowledgedSequence: 10 });
  inputSession.captureAndPredict();

  assert.equal(sentPackets.at(-1).seq, 11);
  assert.equal(inputSession.getState().distance, 11);
});

test("a newly attached client predicts beyond simulation time already covered by held input", () => {
  const { inputSession, receiveAuthority, sentPackets } = createMovementSession();
  receiveAuthority({
    state: { distance: 10, hops: 0 },
    acknowledgedSequence: 1,
    context: { simulationTick: 10 },
  });
  inputSession.captureAndPredict();

  assert.equal(sentPackets.at(-1).seq, 11);
  assert.equal(inputSession.getState().distance, 11);
});

for (const { tickRateHz, pauseSteps, movementPerStep } of [
  { tickRateHz: 30, pauseSteps: 3, movementPerStep: 2 },
  { tickRateHz: 60, pauseSteps: 6, movementPerStep: 1 },
]) {
  test(`local prediction resumes immediately after a 100 ms capture pause at ${tickRateHz} Hz`, () => {
    const session = createClientServerMovementSession(1 / tickRateHz);
    for (let stepIndex = 0; stepIndex < pauseSteps; stepIndex += 1) session.advanceWorld();
    assert.equal(session.authoritativePlayer.lastInputSeqAck, 1);
    assert.equal(session.authoritativePlayer.inputSimulationTick, pauseSteps + 1);
    const initialEpoch = session.authoritativePlayer.inputEpoch;
    session.inputState.east = true;

    for (let resumedStep = 0; resumedStep < 5; resumedStep += 1) {
      const previousDistance = session.authoritativePlayer.distance;
      session.inputSession.captureAndPredict();
      assert.equal(session.inputSession.getState().distance, previousDistance + movementPerStep);
      session.deliverInputs();
      session.advanceWorld();
      assert.equal(session.authoritativePlayer.distance, previousDistance + movementPerStep);
    }
    assert.equal(session.authoritativePlayer.inputEpoch, initialEpoch);
  });
}

test("aligning future captures retains a late unacknowledged action until server incorporation", () => {
  const session = createClientServerMovementSession();
  session.inputState.hop = true;
  session.inputSession.captureAndPredict();
  session.inputState.hop = false;
  for (let stepIndex = 0; stepIndex < 6; stepIndex += 1) session.advanceWorld();

  assert.equal(session.inputSession.getStats().pendingCommands, 1);
  session.inputSession.captureAndPredict();
  assert.equal(session.sentPackets.at(-1).seq, 8);
  assert.equal(session.inputSession.getStats().pendingCommands, 2);
  session.deliverInputs();
  session.advanceWorld();

  assert.equal(session.authoritativePlayer.hops, 1);
  assert.equal(session.authoritativePlayer.lastInputSeqAck, 8);
  assert.equal(session.inputSession.getStats().pendingCommands, 0);
  session.advanceWorld();
  assert.equal(session.authoritativePlayer.hops, 1);
});
