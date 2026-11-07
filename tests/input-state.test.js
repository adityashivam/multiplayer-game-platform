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
