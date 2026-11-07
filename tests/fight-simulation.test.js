import test from "node:test";
import assert from "node:assert/strict";
import {
  FIGHT_FIXED_DT_SEC,
  FIGHT_INPUT_TEMPLATE,
  stepFightPlayer,
  resolveFightSeparation,
} from "../public/platform/shared/fightSimulation.js";

function createFightPlayerState() {
  return {
    x: 300,
    y: 870,
    vx: 0,
    vy: 0,
    dir: 1,
    attacking: false,
    attackTimer: 0,
    cooldownTimer: 0,
    dead: false,
  };
}

function createFightInputState(inputOverrides = {}) {
  return { ...FIGHT_INPUT_TEMPLATE, ...inputOverrides };
}

test("fixed player step moves, jumps and preserves attack timing", () => {
  const playerState = createFightPlayerState();
  stepFightPlayer(
    playerState,
    createFightInputState({ right: true, jump: true, attack: true }),
    FIGHT_FIXED_DT_SEC,
    { active: true },
  );

  assert.equal(playerState.x, 300 + 500 / 60);
  assert.ok(playerState.y < 870);
  assert.equal(playerState.attackType, "light");
  assert.ok(playerState.attacking && playerState.attackTimer > 0 && playerState.cooldownTimer > playerState.attackTimer);

  stepFightPlayer(playerState, createFightInputState({ right: true }), FIGHT_FIXED_DT_SEC, { active: true });
  assert.equal(playerState.vx, 150);
});

test("inactive player is frozen and contact separation stays bounded", () => {
  const p1 = createFightPlayerState();
  const p2 = { ...createFightPlayerState(), x: 350 };
  stepFightPlayer(p1, createFightInputState({ right: true }), FIGHT_FIXED_DT_SEC, { active: false });
  assert.equal(p1.x, 300);

  resolveFightSeparation(p1, p2);
  assert.equal(Math.abs(p1.x - p2.x), 120);
});
