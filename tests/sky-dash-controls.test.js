import test from "node:test";
import assert from "node:assert/strict";
import { createSkyDashInputState } from "../public/games/sky-dash/client/inputState.js";

test("short jump/dash/dive presses survive exactly one input capture", () => {
  const inputState = createSkyDashInputState();
  for (const action of ["jump", "dash", "dive"]) {
    inputState.setAction("keyboard", action, true);
    inputState.setAction("keyboard", action, false);
  }
  assert.deepEqual(inputState.capture(), { moveX: 0, moveZ: 0, jump: true, dash: true, dive: true });
  assert.deepEqual(inputState.capture(), { moveX: 0, moveZ: 0, jump: false, dash: false, dive: false });
});

test("platform touch reset preserves keyboard/shell holds and pending edges", () => {
  const inputState = createSkyDashInputState();
  inputState.setMovement("keyboard", 0, 1);
  inputState.setAction("shell", "jump", true);
  inputState.setAction("shell", "jump", false);
  inputState.setAction("touch", "dash", true);
  inputState.resetSource("touch");
  assert.deepEqual(inputState.capture(), { moveX: 0, moveZ: 1, jump: true, dash: false, dive: false });
  inputState.setAction("keyboard", "dive", true);
  inputState.setAction("touch", "dive", true);
  inputState.setAction("touch", "dive", false);
  assert.equal(inputState.capture().dive, true);
  inputState.reset();
  assert.deepEqual(inputState.capture(), { moveX: 0, moveZ: 0, jump: false, dash: false, dive: false });
});

test("movement preserves analog strength, normalizes diagonals and ignores invalid values", () => {
  const inputState = createSkyDashInputState();
  inputState.setMovement("shell", 0.3, 0.4);
  assert.equal(Math.hypot(inputState.capture().moveX, inputState.capture().moveZ), 0.5);
  inputState.setMovement("keyboard", 1, 1);
  const diagonalInput = inputState.capture();
  assert.ok(Math.abs(Math.hypot(diagonalInput.moveX, diagonalInput.moveZ) - 1) < 1e-12);
  inputState.reset();
  inputState.setMovement("touch", NaN, Infinity);
  assert.equal(inputState.capture().moveX, 0);
  assert.equal(inputState.capture().moveZ, 0);
});
