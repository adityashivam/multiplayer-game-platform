import test from "node:test";
import assert from "node:assert/strict";
import { createNetworkedGameRuntime } from "../public/platform/frontend-engine/networkedGameRuntime.js";

test("networked runtime captures at 60 Hz while sampling presentation at 144 Hz", () => {
  let captures = 0;
  const samples = [];
  const runtime = createNetworkedGameRuntime({
    fixedDtSec: 1 / 60,
    targetRenderFps: null,
    session: { captureAndPredict: () => { captures += 1; }, samplePose: (options) => { samples.push(options); return { x: captures }; } },
    applyPose() {},
  });
  for (let frame = 0; frame <= 144; frame += 1) runtime.step({ nowMs: frame * 1000 / 144 });
  assert.ok(captures >= 59 && captures <= 60);
  assert.equal(samples.length, 144);
  assert.ok(samples.every((sample) => sample.captureInput === false && sample.interpolationAlpha >= 0 && sample.interpolationAlpha <= 1));
  runtime.destroy();
});

test("networked runtime never numerically blends discrete game identities", () => {
  let identity = 3;
  const presented = [];
  const runtime = createNetworkedGameRuntime({
    fixedDtSec: 1 / 60,
    targetRenderFps: null,
    session: { captureAndPredict() {}, samplePose: () => ({ respawnId: identity }) },
    applyPose: (pose) => presented.push(pose.respawnId),
  });
  runtime.step({ nowMs: 0 });
  runtime.step({ nowMs: 17 });
  identity = 4;
  runtime.step({ nowMs: 25 });
  assert.deepEqual(presented, [3, 4]);
  runtime.destroy();
});

test("networked runtime uses elapsed presentation time when rendering is capped", () => {
  const samples = [];
  const runtime = createNetworkedGameRuntime({
    fixedDtSec: 1 / 60,
    targetRenderFps: 30,
    session: { captureAndPredict() {}, samplePose: (options) => { samples.push(options); return {}; } },
    applyPose() {},
  });
  for (let frame = 0; frame < 20; frame += 1) runtime.step({ nowMs: frame * 1000 / 60 });
  assert.ok(samples.slice(1).every((sample) => Math.abs(sample.deltaSec - 1 / 30) < 1e-9));
  runtime.reset();
  runtime.step({ nowMs: 5000 });
  runtime.step({ nowMs: 5034 });
  assert.ok(samples.at(-1).deltaSec < 0.05, "reset does not decay corrections across an old scene's elapsed time");
  runtime.destroy();
});

test("networked runtime rejects timing that would capture at the wrong cadence or freeze corrections", () => {
  const session = { captureAndPredict() {}, samplePose() {} };
  for (const fixedDtSec of [undefined, 0, -1, NaN, Infinity]) {
    assert.throws(() => createNetworkedGameRuntime({ session, applyPose() {}, fixedDtSec }), /fixedDtSec/);
  }
  for (const maxFrameSec of [0, -1, NaN, Infinity]) {
    assert.throws(() => createNetworkedGameRuntime({ session, applyPose() {}, fixedDtSec: 1 / 60, maxFrameSec }), /maxFrameSec/);
  }
});
