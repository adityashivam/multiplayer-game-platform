import test from "node:test";
import assert from "node:assert/strict";
import * as inputTimeline from "../public/platform/frontend-engine/inputTimeline.js";

test("a short action press survives release before the next simulation capture", () => {
  const inputLatch = inputTimeline.createInputLatch({ right: false, jump: false }, { edgeKeys: ["jump"] });
  inputLatch.set("jump", true);
  inputLatch.set("jump", false);
  assert.equal(inputLatch.capture().jump, true);
  assert.equal(inputLatch.capture().jump, false);
});

test("held movement remains held and reset clears pending action edges", () => {
  const inputLatch = inputTimeline.createInputLatch({ right: false, jump: false }, { edgeKeys: ["jump"] });
  inputLatch.set("right", true);
  assert.equal(inputLatch.capture().right, true);
  assert.equal(inputLatch.capture().right, true);
  inputLatch.set("jump", true);
  inputLatch.reset();
  assert.deepEqual(inputLatch.capture(), { right: false, jump: false });
});

test("numeric input values retain their magnitude and reset to configured neutral defaults", () => {
  const inputTemplate = { move: 0, heading: 0.5, tool: 2, jump: false };
  const inputLatch = inputTimeline.createInputLatch(inputTemplate, {
    numericInputs: {
      move: { min: -1, max: 1 },
      heading: { min: -3.2, max: 3.2 },
      tool: { min: 0, max: 4, integer: true },
    },
    edgeKeys: ["jump"],
  });

  inputLatch.set("move", -0.4);
  inputLatch.set("heading", 1.25);
  inputLatch.set("tool", 3);
  inputLatch.set("jump", true);
  inputLatch.set("jump", false);
  assert.deepEqual(inputLatch.capture(), { move: -0.4, heading: 1.25, tool: 3, jump: true });
  inputLatch.reset();
  assert.deepEqual(inputLatch.capture(), { move: 0, heading: 0.5, tool: 2, jump: false });
  assert.deepEqual(inputTemplate, { move: 0, heading: 0.5, tool: 2, jump: false });
});

test("numeric latch ignores invalid values instead of coercing or clamping them", () => {
  const inputLatch = inputTimeline.createInputLatch({ axis: 0, tool: 1 }, {
    numericInputs: { axis: { min: -1, max: 1 }, tool: { min: 0, max: 3, integer: true } },
  });

  for (const inputValue of [NaN, Infinity, -Infinity, 1.01, -1.01, true, "0.5", undefined]) {
    inputLatch.set("axis", inputValue);
  }
  inputLatch.set("tool", 1.5);
  inputLatch.set("unknown", 0.5);
  assert.deepEqual(inputLatch.capture(), { axis: 0, tool: 1 });
});

test("numeric input configuration rejects missing ranges and numeric action edges", () => {
  assert.throws(() => inputTimeline.createInputLatch({ axis: 0 }), /numeric|input/i);
  assert.throws(() => inputTimeline.createInputLatch({ axis: 0 }, {
    numericInputs: { axis: { min: -1, max: 1 } }, edgeKeys: ["axis"],
  }), /edge|boolean/i);
});
