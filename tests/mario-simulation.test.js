import test from "node:test";
import assert from "node:assert/strict";
import { createMarioTestSession } from "./mario-test-helpers.js";

import * as marioSimulation from "../public/games/mario/shared/simulation.js";

function createMovementPlayer(overrides = {}) {
  return {
    x: 32,
    y: 192,
    vx: 0,
    vy: 0,
    width: 16,
    height: 16,
    onGround: true,
    facing: 1,
    jumpHeld: false,
    ...overrides,
  };
}

test("Mario shared movement preserves acceleration, release friction and rising-edge jumping", () => {
  const playerState = createMovementPlayer();
  const inputState = { left: false, right: true, run: false, jump: false };
  marioSimulation.stepMarioPlayer(playerState, inputState, 1 / 60);
  assert.ok(Math.abs(playerState.vx - 15.333333333333334) < 1e-10);
  assert.ok(Math.abs(playerState.x - 32.25555555555555) < 1e-10);
  assert.equal(playerState.y, 192);
  assert.equal(playerState.onGround, true);
  inputState.right = false;
  marioSimulation.stepMarioPlayer(playerState, inputState, 1 / 60);
  assert.equal(playerState.vx, 0);
  assert.ok(Math.abs(playerState.x - 32.25555555555555) < 1e-10);
  inputState.jump = true;
  marioSimulation.stepMarioPlayer(playerState, inputState, 1 / 60);
  assert.ok(Math.abs(playerState.vy + 435.8333333333333) < 1e-9);
  assert.ok(Math.abs(playerState.y - 184.73611111111111) < 1e-9);
  for (let tick = 0; tick < 120; tick += 1) marioSimulation.stepMarioPlayer(playerState, inputState, 1 / 60);
  assert.equal(playerState.y, 192, "holding jump must not auto-jump after landing");
  assert.equal(playerState.onGround, true);
  inputState.jump = false;
  marioSimulation.stepMarioPlayer(playerState, inputState, 1 / 60);
  inputState.jump = true;
  marioSimulation.stepMarioPlayer(playerState, inputState, 1 / 60);
  assert.ok(playerState.y < 192, "a fresh press can jump again");
});

test("Mario shared collision stops motion at walls, ceilings and world bounds", () => {
  const solids = [
    { x: 0, y: 208, w: 400, h: 32 },
    { x: 96, y: 120, w: 16, h: 88 },
    { x: 0, y: 144, w: 96, h: 16 },
  ];
  const options = { active: true, solids, worldWidth: 400 };
  const playerState = createMovementPlayer({ x: 79, vx: 175 });
  const inputState = { left: false, right: true, run: true, jump: false };
  marioSimulation.stepMarioPlayer(playerState, inputState, 1 / 60, options);
  assert.equal(playerState.x, 80);
  assert.equal(playerState.vx, 0);
  Object.assign(playerState, { x: 32, y: 161, vy: -460, onGround: false });
  inputState.right = false;
  marioSimulation.stepMarioPlayer(playerState, inputState, 1 / 60, options);
  assert.equal(playerState.y, 160);
  assert.equal(playerState.vy, 0);
  Object.assign(playerState, { x: 0, y: 192, vx: -175, vy: 0, onGround: true });
  inputState.left = true;
  marioSimulation.stepMarioPlayer(playerState, inputState, 1 / 60, options);
  assert.equal(playerState.x, 0);
});

test("Mario browser movement and registered authoritative movement remain identical", () => {
  const session = createMarioTestSession();
  const client = session.connectPlayer();
  session.connectPlayer();
  const state = session.getState();
  state.started = true;
  state.startAt = null;
  state.enemies.length = 0;
  const predictedPlayer = structuredClone(state.players.p1);
  for (let tick = 1; tick <= 150; tick += 1) {
    const inputState = {
      left: tick > 75 && tick < 100,
      right: tick < 70,
      run: tick >= 20 && tick < 55,
      jump: tick === 35 || tick === 115,
    };
    session.sendInputFrame(client, tick, inputState);
    marioSimulation.stepMarioPlayer(predictedPlayer, inputState, 1 / 60);
    session.advanceSimulation();
    for (const field of ["x", "y", "vx", "vy", "onGround", "facing", "jumpHeld"]) {
      assert.equal(predictedPlayer[field], state.players.p1[field], `${field} differs at tick ${tick}`);
    }
    assert.equal(state.players.p1.finished, false);
    assert.equal(state.gameOver, false);
  }
});
