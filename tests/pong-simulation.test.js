import test from "node:test";
import assert from "node:assert/strict";
import { stepPongPaddle } from "../public/games/pong/shared/simulation.js";

test("Pong paddle movement uses elapsed seconds and opposing controls cancel", () => {
  for (const { input, dtSec, expectedY } of [
    { input: { up: true, down: false }, dtSec: 1 / 60, expectedY: 345 },
    { input: { up: false, down: true }, dtSec: 1 / 30, expectedY: 390 },
    { input: { up: true, down: true }, dtSec: 1 / 60, expectedY: 360 },
    { input: { up: false, down: false }, dtSec: 1 / 60, expectedY: 360 },
  ]) {
    const playerState = { y: 360, score: 4 };
    stepPongPaddle(playerState, input, dtSec);
    assert.equal(playerState.y, expectedY);
    assert.equal(playerState.score, 4);
  }
});

test("Pong paddle bounds keep the entire paddle inside the playfield", () => {
  const playerState = { y: 360 };
  stepPongPaddle(playerState, { up: true, down: false }, 1);
  assert.equal(playerState.y, 80);
  stepPongPaddle(playerState, { up: false, down: true }, 1);
  assert.equal(playerState.y, 640);
});
