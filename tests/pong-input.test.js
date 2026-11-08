import test from "node:test";
import assert from "node:assert/strict";
import { createPongInputState, readPongKeyboardInput } from "../public/games/pong/client/inputState.js";

test("Pong advertises and supports arrows and WASD without losing simultaneous shell holds", () => {
  for (const code of ["ArrowUp", "ArrowLeft", "KeyW", "KeyA"]) assert.equal(readPongKeyboardInput(code), "up");
  for (const code of ["ArrowDown", "ArrowRight", "KeyS", "KeyD"]) assert.equal(readPongKeyboardInput(code), "down");
  assert.equal(readPongKeyboardInput("Enter"), null);
  assert.equal(readPongKeyboardInput("constructor"), null);
  const controls = createPongInputState();
  controls.setHeld("down", "ArrowDown", true);
  controls.setHeld("down", "shell:down", true);
  controls.setHeld("down", "ArrowDown", false);
  assert.equal(controls.capture().down, true);
  controls.setHeld("down", "shell:down", false);
  assert.equal(controls.capture().down, false);
  controls.setHeld("up", "KeyW", true);
  controls.reset();
  assert.deepEqual(controls.capture(), { up: false, down: false });
});
