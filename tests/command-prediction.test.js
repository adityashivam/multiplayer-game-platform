import test from "node:test";
import assert from "node:assert/strict";
import { createCommandPredictor } from "../public/platform/frontend-engine/commandPrediction.js";
import { createInputTimeline } from "../public/platform/frontend-engine/inputTimeline.js";

function createInputFrame(sequenceNumber, right = true) {
  return {
    seq: sequenceNumber,
    dtSec: 1 / 60,
    input: { right },
  };
}

test("fixed-step input capture keeps command duration stable after a render stall", () => {
  let nowMs = 0;
  const inputTimeline = createInputTimeline({ hz: 60, fixedDtSec: 1 / 60, nowFn: () => nowMs });
  const firstFrame = inputTimeline.sendNow();
  nowMs = 150;
  const secondFrame = inputTimeline.sendNow();
  assert.equal(firstFrame.dtSec, 1 / 60);
  assert.equal(secondFrame.dtSec, 1 / 60);
});

function createTestPredictor(options = {}) {
  return createCommandPredictor({
    fixedDtSec: 1 / 60,
    simulate: (playerState, inputState, fixedDtSec) => {
      playerState.x += inputState.right ? 600 * fixedDtSec : 0;
    },
    extractPose: (playerState) => ({ x: playerState.x, y: playerState.y }),
    ...options,
  });
}

test("local input predicts immediately using the canonical simulation step", () => {
  const predictor = createTestPredictor();
  predictor.reset({ x: 100, y: 0 });
  predictor.advance({ ...createInputFrame(1), dtSec: 2 });
  assert.equal(predictor.getState().x, 110);
  assert.equal(predictor.getRenderPose(0).x, 110);
});

test("delayed authority replays pending input without pulling a correct prediction backwards", () => {
  const predictor = createTestPredictor();
  predictor.reset({ x: 100, y: 0 });
  predictor.advance(createInputFrame(1));
  predictor.advance(createInputFrame(2));
  const authoritativeState = { x: 110, y: 0 };
  const pendingFrames = [createInputFrame(2)];
  predictor.reconcile(authoritativeState, pendingFrames, {}, 1);
  assert.equal(predictor.getState().x, 120);
  assert.equal(predictor.getRenderPose(0).x, 120);
  assert.equal(predictor.getStats().correctionDistance, 0);
  assert.deepEqual(authoritativeState, { x: 110, y: 0 });
  assert.equal(pendingFrames.length, 1);
});

test("small authoritative differences are reconciled in simulation and smoothed only in rendering", () => {
  const predictor = createTestPredictor();
  predictor.reset({ x: 100, y: 0 });
  predictor.advance(createInputFrame(1));
  predictor.advance(createInputFrame(2));
  predictor.reconcile({ x: 109, y: 0 }, [createInputFrame(2)], {}, 1);
  assert.equal(predictor.getState().x, 119);
  assert.equal(predictor.getRenderPose(0).x, 120);
  const pose = predictor.getRenderPose(1 / 60);
  assert.ok(pose.x > 119 && pose.x < 120);
  assert.equal(predictor.getState().x, 119);
});

test("each sequence advances at most once and a reconciled pending command is not advanced twice", () => {
  const predictor = createTestPredictor();
  predictor.reset({ x: 100, y: 0 });
  predictor.advance(createInputFrame(1));
  predictor.advance(createInputFrame(1));
  assert.equal(predictor.getState().x, 110);
  predictor.reconcile({ x: 110, y: 0 }, [createInputFrame(2)], {}, 1);
  predictor.advance(createInputFrame(2));
  assert.equal(predictor.getState().x, 120);
  predictor.advance(createInputFrame(3));
  assert.equal(predictor.getState().x, 130);
});

test("replay ignores acknowledged commands even when supplied in pending history", () => {
  const predictor = createTestPredictor();
  predictor.reset({ x: 100, y: 0 });
  predictor.reconcile({ x: 110, y: 0 }, [createInputFrame(1), createInputFrame(2)], {}, 1);
  assert.equal(predictor.getState().x, 120);
});

test("time already simulated during input starvation is not replayed a second time", () => {
  const predictor = createTestPredictor();
  predictor.reset({ x: 100, y: 0 });
  for (let sequenceNumber = 1; sequenceNumber <= 6; sequenceNumber++) {
    predictor.advance(createInputFrame(sequenceNumber));
  }
  predictor.reconcile({ x: 150, y: 0 }, [createInputFrame(3), createInputFrame(4), createInputFrame(5), createInputFrame(6)], { simulationTick: 5 }, 2);
  assert.equal(predictor.getState().x, 160);
  assert.equal(predictor.getStats().correctionDistance, 0);
});

test("visual correction decay is independent of render refresh rate", () => {
  const sampleDecayedPoseX = (renderHz) => {
    const predictor = createTestPredictor();
    predictor.reset({ x: 100, y: 0 });
    predictor.reconcile({ x: 90, y: 0 }, [], {}, 0);
    let pose;
    for (let renderFrame = 0; renderFrame < renderHz; renderFrame++) {
      pose = predictor.getRenderPose(1 / renderHz);
    }
    return pose.x;
  };
  assert.ok(Math.abs(sampleDecayedPoseX(60) - sampleDecayedPoseX(144)) < 1e-8);
});

test("teleports snap while reset clears history and visual offsets", () => {
  const predictor = createTestPredictor({ maxSmoothingDistance: 250 });
  predictor.reset({ x: 100, y: 0 });
  predictor.advance(createInputFrame(10));
  predictor.reconcile({ x: 900, y: 0 }, [], {}, 10);
  assert.equal(predictor.getRenderPose(0).x, 900);
  assert.equal(predictor.getStats().hardSnaps, 1);
  predictor.reset({ x: 100, y: 0 });
  predictor.advance(createInputFrame(1));
  assert.equal(predictor.getRenderPose(0).x, 110);
});
