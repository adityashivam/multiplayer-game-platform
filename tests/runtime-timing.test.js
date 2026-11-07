import test from "node:test";
import assert from "node:assert/strict";
import { createModularRuntime } from "../public/platform/frontend-engine/modularRuntime.js";
import { createPluggablePoseRuntime } from "../public/platform/frontend-engine/pluggablePoseRuntime.js";

test("60 fps cap preserves remainder with alternating frame intervals", () => {
  const runtime = createModularRuntime({ targetRenderFps: 60 });
  let renderedFrames = 0;
  runtime.addSystem({
    onLateUpdate() {
      renderedFrames++;
    },
  });

  runtime.step({ nowMs: 0 });
  for (let frameIndex = 1; frameIndex <= 600; frameIndex++) {
    runtime.step({ nowMs: frameIndex * 1000 / 60 + (frameIndex % 2 ? -0.05 : 0.05) });
  }

  assert.ok(renderedFrames >= 590, `rendered ${renderedFrames} of 600 frames`);
});

test("render caps maintain cadence on 90, 120 and 144 Hz displays", () => {
  for (const displayHz of [90, 120, 144]) {
    const runtime = createModularRuntime({ targetRenderFps: 60 });
    let renderedFrames = 0;
    runtime.addSystem({
      onLateUpdate() {
        renderedFrames++;
      },
    });

    runtime.step({ nowMs: 0 });
    for (let frameIndex = 1; frameIndex <= displayHz * 5; frameIndex++) {
      runtime.step({ nowMs: frameIndex * 1000 / displayHz });
    }

    assert.ok(renderedFrames >= 299 && renderedFrames <= 300, `${displayHz} Hz rendered ${renderedFrames}`);
  }
});

test("pose runtime honors an uncapped render setting", () => {
  let renderedPoses = 0;
  const runtime = createPluggablePoseRuntime({
    targetRenderFps: null,
    samplePose: () => ({ x: 1 }),
    applyPose: () => renderedPoses++,
  });

  runtime.step({ nowMs: 0 });
  for (let frameIndex = 1; frameIndex <= 120; frameIndex++) {
    runtime.step({ nowMs: frameIndex * 1000 / 120 });
  }

  assert.ok(renderedPoses >= 119, `rendered ${renderedPoses} poses`);
});
