import test from "node:test";
import assert from "node:assert/strict";
import {
  FIGHT_COMBAT, FIGHT_MOVEMENT, FIGHT_INPUT_TEMPLATE, FIGHT_ATTACK_DEFINITIONS,
  createFightPlayerState, stepFightPlayer, resolveFightStrike, resolveFightExchange,
} from "../public/games/fight/shared/simulation.js";

const stepMove = (fighter, controls = {}) => stepFightPlayer(fighter, { ...FIGHT_INPUT_TEMPLATE, ...controls }, 1 / 60, { active: true });
function prepareStrike(fighter, attackType) {
  const attack = FIGHT_ATTACK_DEFINITIONS[attackType];
  Object.assign(fighter, { attacking: true, attackType, attackTimer: attack.duration - attack.startupSec - .01 });
}

test("standing dash selects dodge and retains its short evasive window", () => {
  const fighter = createFightPlayerState(500, 1);
  stepMove(fighter, { dash: true, right: true });
  assert.equal(fighter.dashType, "dodge");
  assert.equal(fighter.dashTimer, FIGHT_COMBAT.DASH_DURATION_SEC);
  assert.equal(fighter.guardMeter, 80);
});

test("crouch plus dash starts a distinct resource-limited ground slide", () => {
  const fighter = createFightPlayerState(500, 1);
  stepMove(fighter, { crouch: true, dash: true, right: true });
  assert.equal(fighter.dashType, "slide");
  assert.equal(fighter.dashTimer, FIGHT_COMBAT.SLIDE_DURATION_SEC);
  assert.equal(fighter.vx, FIGHT_COMBAT.SLIDE_SPEED);
  assert.equal(fighter.guardMeter, 100 - FIGHT_COMBAT.SLIDE_GUARD_COST);
  assert.equal(fighter.y, FIGHT_MOVEMENT.GROUND_Y);
});

test("airborne crouch plus dash remains a dodge rather than a ground slide", () => {
  const fighter = createFightPlayerState(500, 1);
  fighter.y -= 100;
  stepMove(fighter, { crouch: true, dash: true });
  assert.equal(fighter.dashType, "dodge");
});

test("guard plus dash is a backward dodge rather than a held block", () => {
  const fighter = createFightPlayerState(500, 1);
  stepMove(fighter, { block: true, dash: true, right: true });
  assert.equal(fighter.dashType, "dodge");
  assert.equal(fighter.dashDir, -1);
  assert.equal(fighter.guarding, false);
  assert.ok(fighter.x < 500);
});

test("a slide needs its full guard cost and expires without lingering low profile", () => {
  const fighter = createFightPlayerState(500, 1);
  fighter.guardMeter = FIGHT_COMBAT.SLIDE_GUARD_COST - 1;
  stepMove(fighter, { crouch: true, dash: true });
  assert.equal(fighter.dashTimer, 0);
  fighter.guardMeter = 100;
  stepMove(fighter, { crouch: true, dash: true });
  for (let tick = 0; tick < 30; tick++) stepMove(fighter);
  assert.equal(fighter.dashType, null);
  assert.equal(fighter.dashTimer, 0);
});

test("slide low profile evades horizontal light cuts but does not grant blanket invulnerability", () => {
  for (const attackType of ["light", "light2", "heavy", "sweep", "launcher", "aerial", "special"]) {
    const attacker = createFightPlayerState(300, 1);
    const defender = createFightPlayerState(450, -1);
    Object.assign(defender, { dashType: "slide", dashTimer: FIGHT_COMBAT.SLIDE_DURATION_SEC });
    prepareStrike(attacker, attackType);
    const hit = resolveFightStrike(attacker, defender);
    if (attackType === "light" || attackType === "light2") assert.equal(hit, null);
    else {
      assert.equal(hit.kind, "hit");
      assert.equal(defender.dashTimer, 0);
      assert.equal(defender.dashType, null);
    }
  }
});

test("an authoritative strike cancels slide in a simultaneous combat exchange", () => {
  const p1 = createFightPlayerState(300, 1);
  const p2 = createFightPlayerState(450, -1);
  prepareStrike(p1, "heavy");
  Object.assign(p2, { dashType: "slide", dashTimer: .2 });
  assert.equal(resolveFightExchange(p1, p2).p1.kind, "hit");
  assert.equal(p2.dashTimer, 0);
  assert.equal(p2.dashType, null);
});
