import test from "node:test";
import assert from "node:assert/strict";
import {
  enqueueInputFrame,
  consumeInputFrames,
  resetInputBuffer,
} from "../server/platform-backend-engine/core/inputProtocol.js";

const INPUT_TEMPLATE = { left: false, jump: false };

function createInputFrame(sequenceNumber, inputOverrides = {}) {
  return {
    type: "inputFrame",
    protocol: 2,
    seq: sequenceNumber,
    state: { ...INPUT_TEMPLATE, ...inputOverrides },
  };
}

function enqueuePlayerInputFrame(playerState, inputFrame) {
  return enqueueInputFrame({
    player: playerState,
    payload: inputFrame,
    inputTemplate: INPUT_TEMPLATE,
  });
}

function consumePlayerInputFrames(playerState, dtSec, simulate) {
  return consumeInputFrames({ player: playerState, dtSec, simulate });
}

test("commands are acknowledged only after ordered fixed steps including short presses", () => {
  const playerState = {};
  assert.ok(enqueuePlayerInputFrame(playerState, createInputFrame(1, { jump: true })));
  assert.ok(enqueuePlayerInputFrame(playerState, createInputFrame(2)));
  assert.equal(playerState.lastInputSeqAck, 0);

  const simulatedCommands = [];
  consumePlayerInputFrames(playerState, 2 / 60, (inputState, dtSec, inputFrame) => {
    simulatedCommands.push([inputState.jump, dtSec, inputFrame.seq, playerState.lastInputSeqAck]);
  });

  assert.deepEqual(simulatedCommands, [[true, 1 / 60, 1, 0], [false, 1 / 60, 2, 1]]);
  assert.equal(playerState.lastInputSeqAck, 2);
});

test("rejects invalid, stale, duplicate and overflow commands", () => {
  const playerState = {};
  assert.equal(enqueuePlayerInputFrame(playerState, createInputFrame(0)), false);
  assert.equal(enqueuePlayerInputFrame(playerState, {
    ...createInputFrame(1),
    state: { left: "yes", jump: false },
  }), false);
  assert.equal(enqueuePlayerInputFrame(playerState, { ...createInputFrame(1), seq: 1.5 }), false);

  for (let sequenceNumber = 1; sequenceNumber <= 120; sequenceNumber += 1) {
    assert.ok(enqueuePlayerInputFrame(playerState, createInputFrame(sequenceNumber)));
  }
  assert.equal(enqueuePlayerInputFrame(playerState, createInputFrame(120)), false);
  assert.equal(enqueuePlayerInputFrame(playerState, createInputFrame(121)), false);

  consumePlayerInputFrames(playerState, 1 / 60, () => {});
  assert.equal(enqueuePlayerInputFrame(playerState, createInputFrame(1)), false);
  assert.ok(enqueuePlayerInputFrame(playerState, createInputFrame(121)));
});

test("credit accumulates during idle but is capped and catch-up per tick is bounded", () => {
  const playerState = {};
  consumePlayerInputFrames(playerState, 10, () => assert.fail("no queued commands"));
  for (let sequenceNumber = 1; sequenceNumber <= 20; sequenceNumber += 1) {
    enqueuePlayerInputFrame(playerState, createInputFrame(sequenceNumber));
  }

  let simulationStepCount = 0;
  const countSimulationStep = () => {
    simulationStepCount += 1;
  };

  consumePlayerInputFrames(playerState, 0, countSimulationStep);
  assert.equal(simulationStepCount, 8);
  consumePlayerInputFrames(playerState, 0, countSimulationStep);
  assert.equal(simulationStepCount, 15);
  consumePlayerInputFrames(playerState, 0, countSimulationStep);
  assert.equal(simulationStepCount, 15);
  consumePlayerInputFrames(playerState, 1 / 60, countSimulationStep);
  assert.equal(simulationStepCount, 16);
});

test("reset clears queued commands, credit and sequence acknowledgement", () => {
  const playerState = {};
  enqueuePlayerInputFrame(playerState, createInputFrame(5));
  resetInputBuffer(playerState);
  assert.equal(playerState.lastInputSeqAck, 0);

  let simulationStepCount = 0;
  consumePlayerInputFrames(playerState, 1 / 60, () => {
    simulationStepCount += 1;
  });
  assert.equal(simulationStepCount, 0);
  assert.ok(enqueuePlayerInputFrame(playerState, createInputFrame(1)));
});

test("failed simulation does not acknowledge or remove a frame", () => {
  const playerState = {};
  enqueuePlayerInputFrame(playerState, createInputFrame(1));
  assert.throws(() => consumePlayerInputFrames(playerState, 1 / 60, () => {
    throw new Error("simulation failed");
  }));
  assert.equal(playerState.lastInputSeqAck, 0);

  consumePlayerInputFrames(playerState, 0, () => {});
  assert.equal(playerState.lastInputSeqAck, 1);
});

test("rejects frames from an earlier player epoch", () => {
  const playerState = { inputEpoch: 4 };
  assert.equal(enqueuePlayerInputFrame(playerState, { ...createInputFrame(1), epoch: 3 }), false);
  assert.ok(enqueuePlayerInputFrame(playerState, { ...createInputFrame(1), epoch: 4 }));
});

test("continuous simulation coalesces late action edges into one fixed step", () => {
  const playerState = {};
  const simulatedSteps = [];
  const advanceContinuousInput = (maxSteps = 8) => consumeInputFrames({
    player: playerState,
    dtSec: 1 / 60,
    continuous: true,
    maxSteps,
    edgeKeys: ["jump"],
    simulate: (inputState, dtSec) => simulatedSteps.push([inputState.jump, dtSec]),
  });

  advanceContinuousInput();
  advanceContinuousInput();
  advanceContinuousInput();
  enqueuePlayerInputFrame(playerState, createInputFrame(1, { jump: true }));
  enqueuePlayerInputFrame(playerState, createInputFrame(2));
  advanceContinuousInput();

  assert.deepEqual(simulatedSteps.at(-1), [true, 1 / 60]);
  assert.equal(playerState.input.jump, false);
  assert.equal(playerState.inputSimulationTick, 4);
  assert.equal(playerState.lastInputSeqAck, 2);

  advanceContinuousInput();
  assert.deepEqual(simulatedSteps.at(-1), [false, 1 / 60]);
});
