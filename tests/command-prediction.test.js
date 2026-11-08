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

test("render interpolation samples consecutive fixed poses and clamps invalid fractions", () => {
  const predictor = createTestPredictor();
  predictor.reset({ x: 100, y: 0 });
  assert.equal(predictor.getRenderPose(0, 0).x, 100);
  predictor.advance(createInputFrame(1));

  assert.equal(predictor.getRenderPose(0, 0).x, 100);
  assert.equal(predictor.getRenderPose(0, 0.5).x, 105);
  assert.equal(predictor.getRenderPose(0, 1).x, 110);
  assert.equal(predictor.getRenderPose(0, -1).x, 100);
  assert.equal(predictor.getRenderPose(0, 2).x, 110);
  assert.equal(predictor.getRenderPose(0, NaN).x, 110);
  assert.equal(predictor.getState().x, 110);
});

test("reconciliation rebases both fixed render endpoints without changing their visible path", () => {
  const predictor = createTestPredictor();
  predictor.reset({ x: 100, y: 0 });
  predictor.advance(createInputFrame(1));
  predictor.advance(createInputFrame(2));
  const authority = Object.freeze({ x: 109, y: 0 });
  predictor.reconcile(authority, [createInputFrame(2)], {}, 1);

  assert.equal(predictor.getState().x, 119);
  assert.equal(predictor.getRenderPose(0, 0).x, 110);
  assert.equal(predictor.getRenderPose(0, 0.5).x, 115);
  assert.equal(predictor.getRenderPose(0, 1).x, 120);
  assert.deepEqual(authority, { x: 109, y: 0 });
});

test("movement identity changes and distance snaps clear both render endpoints", () => {
  const predictor = createTestPredictor();
  predictor.reconcile({ x: 100, y: 0 }, [], { continuityKey: 1 });
  predictor.advance(createInputFrame(1));
  predictor.reconcile({ x: 50, y: 0 }, [], { continuityKey: 2 }, 1);
  assert.equal(predictor.getRenderPose(0, 0).x, 50);

  predictor.advance(createInputFrame(2));
  predictor.reconcile({ x: 900, y: 0 }, [], { continuityKey: 2 }, 2);
  assert.equal(predictor.getRenderPose(0, 0).x, 900);
  predictor.reset({ x: 200, y: 0 });
  assert.equal(predictor.getRenderPose(0, 0).x, 200);
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

test("normalized pose corrections decay smoothly without a world-scale residual snap", () => {
  const predictor = createTestPredictor();
  predictor.reset({ x: 0.001, y: 0 });
  predictor.reconcile({ x: 0.00091, y: 0 }, [], {}, 0);
  assert.equal(predictor.getRenderPose(0).x, 0.001);

  const renderedPose = predictor.getRenderPose(0.1);
  assert.ok(Math.abs(renderedPose.x - 0.0009248768999399428) < 1e-16);
  assert.equal(predictor.getState().x, 0.00091);
});

test("a ball correction snaps only its own group while the player's correction stays smooth", () => {
  const predictor = createTestPredictor({
    maxSmoothingDistance: 0.5,
    correctionGroups: [
      { name: "player", fields: ["x"], maxSmoothingDistance: 1.2 },
      { name: "ball", fields: ["ballX"], maxSmoothingDistance: 1.2 },
    ],
    simulate(player) { player.x += 1; player.ballX += 1; },
    extractPose: (player) => ({ x: player.x, ballX: player.ballX }),
  });
  predictor.reset({ x: 0, ballX: 0 });
  predictor.advance(createInputFrame(1));
  predictor.reconcile(Object.freeze({ x: 0.5, ballX: 10 }), [], {}, 1);

  assert.deepEqual(predictor.getState(), { x: 0.5, ballX: 10 });
  assert.deepEqual(predictor.getRenderPose(0, 1), { x: 1, ballX: 10 });
  assert.deepEqual(predictor.getRenderPose(0, 0), { x: 0, ballX: 10 });
  assert.equal(predictor.getStats().hardSnaps, 1);
  assert.equal(predictor.getStats().corrections, 1);
});

test("facing and course clocks use their declared correction scales independently of positions", () => {
  for (const { field, value, threshold } of [
    { field: "facing", value: 1, threshold: 3 },
    { field: "courseTimeSec", value: 100, threshold: 200 },
  ]) {
    const predictor = createTestPredictor({
      maxSmoothingDistance: 0.5,
      correctionGroups: [
        { fields: ["x"], maxSmoothingDistance: 1.2 },
        { fields: [field], maxSmoothingDistance: threshold },
      ],
      extractPose: (player) => ({ x: player.x, [field]: player[field] }),
    });
    predictor.reset({ x: 0, [field]: 0 });
    predictor.reconcile({ x: 0.1, [field]: value });
    assert.deepEqual(predictor.getRenderPose(0), { x: 0, [field]: 0 });
    assert.equal(predictor.getStats().hardSnaps, 0);
  }
});

test("ungrouped pose fields retain the default distance limit without snapping declared groups", () => {
  const predictor = createTestPredictor({
    maxSmoothingDistance: 5,
    correctionGroups: [{ fields: ["x"], maxSmoothingDistance: 1 }],
  });
  predictor.reset({ x: 0, y: 0 });
  predictor.reconcile({ x: 0.5, y: 10 });

  assert.deepEqual(predictor.getRenderPose(0), { x: 0, y: 10 });
  assert.deepEqual(predictor.getRenderPose(0, 0), { x: 0, y: 10 });
});

test("ambiguous or invalid correction groups are rejected before simulation", () => {
  for (const correctionGroups of [
    {},
    [{ fields: [], maxSmoothingDistance: 1 }],
    [{ fields: ["x", "x"], maxSmoothingDistance: 1 }],
    [{ fields: ["x"], maxSmoothingDistance: 1 }, { fields: ["x"], maxSmoothingDistance: 2 }],
    [{ fields: ["x"], maxSmoothingDistance: -1 }],
    [{ fields: ["x"], maxSmoothingDistance: NaN }],
  ]) {
    assert.throws(() => createTestPredictor({ correctionGroups }), { name: "TypeError" });
  }
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
