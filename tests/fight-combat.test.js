import test from "node:test";
import assert from "node:assert/strict";
import * as fight from "../public/games/fight/shared/simulation.js";

const neutralInput = (overrides = {}) => ({ ...fight.FIGHT_INPUT_TEMPLATE, ...overrides });
const createFighter = (x = 300, dir = 1) => fight.createFightPlayerState(x, dir);
const stepFighter = (player, input = {}, ticks = 1) => {
  for (let tick = 0; tick < ticks; tick++) {
    fight.stepFightPlayer(player, neutralInput(tick === 0 ? input : {}), 1 / 60, { active: true });
  }
};
const activateStrike = (player, attackType = "light") => {
  const definition = fight.FIGHT_ATTACK_DEFINITIONS[attackType];
  Object.assign(player, { attacking: true, attackType, attackTimer: definition.duration - definition.startupSec - .01, hasHitThisSwing: false });
};

test("a strike cannot damage during startup or recovery", () => {
  const attacker = createFighter();
  const defender = createFighter(450, -1);
  stepFighter(attacker, { attack: true });
  assert.equal(fight.getFightAttackPhase(attacker), "startup");
  assert.equal(fight.resolveFightStrike(attacker, defender), null);
  attacker.attackTimer = .01;
  assert.equal(fight.getFightAttackPhase(attacker), "recovery");
  assert.equal(fight.resolveFightStrike(attacker, defender), null);
  assert.equal(defender.health, fight.FIGHT_COMBAT.MAX_HEALTH);
});

test("an active swing damages one time and earns special meter", () => {
  const attacker = createFighter();
  const defender = createFighter(450, -1);
  activateStrike(attacker);
  const impact = fight.resolveFightStrike(attacker, defender);
  assert.equal(impact.kind, "hit");
  assert.ok(defender.health < fight.FIGHT_COMBAT.MAX_HEALTH);
  assert.ok(attacker.specialMeter > 0 && defender.stunTimer > 0);
  const remainingHealth = defender.health;
  assert.equal(fight.resolveFightStrike(attacker, defender), null);
  assert.equal(defender.health, remainingHealth);
});

test("strikes reject targets behind, above or outside reach", () => {
  for (const [x, y] of [[150, 870], [450, 500], [1100, 870]]) {
    const attacker = createFighter();
    const defender = createFighter(x, -1);
    defender.y = y;
    activateStrike(attacker);
    assert.equal(fight.resolveFightStrike(attacker, defender), null);
    assert.equal(attacker.hasHitThisSwing, false);
  }
});

test("a held frontal guard reduces damage and consumes guard meter", () => {
  const attacker = createFighter();
  const defender = createFighter(450, -1);
  Object.assign(defender, { guarding: true, guardTimer: .5 });
  activateStrike(attacker);
  const impact = fight.resolveFightStrike(attacker, defender);
  assert.equal(impact.kind, "block");
  assert.ok(impact.damage < fight.FIGHT_ATTACK_DEFINITIONS.light.damage);
  assert.ok(defender.guardMeter < 100);
});

test("a precisely timed guard parries without damage", () => {
  const attacker = createFighter();
  const defender = createFighter(450, -1);
  Object.assign(defender, { guarding: true, guardTimer: .04 });
  activateStrike(attacker, "heavy");
  assert.equal(fight.resolveFightStrike(attacker, defender).kind, "parry");
  assert.equal(defender.health, 500);
  assert.ok(attacker.stunTimer > 0 && defender.specialMeter > 0);
  assert.equal(attacker.attacking, false);
});

test("guard exhaustion creates a bounded punish window", () => {
  const attacker = createFighter();
  const defender = createFighter(450, -1);
  Object.assign(defender, { guarding: true, guardTimer: .5, guardMeter: 1 });
  activateStrike(attacker, "heavy");
  assert.equal(fight.resolveFightStrike(attacker, defender).kind, "guard-break");
  assert.equal(defender.guarding, false);
  assert.equal(defender.guardMeter, 0);
  assert.ok(defender.guardBrokenTimer > 0);
});

test("special attacks require and consume earned meter", () => {
  const fighter = createFighter();
  stepFighter(fighter, { specialAttack: true });
  assert.equal(fighter.attacking, false);
  fighter.specialMeter = 100;
  stepFighter(fighter, { specialAttack: true });
  assert.equal(fighter.attackType, "special");
  assert.equal(fighter.specialMeter, 0);
});

test("crouch heavy and air action select distinct attacks", () => {
  const sweep = createFighter();
  stepFighter(sweep, { crouch: true, heavyAttack: true });
  assert.equal(sweep.attackType, "sweep");
  const launcher = createFighter();
  stepFighter(launcher, { aerialAttack: true });
  assert.equal(launcher.attackType, "launcher");
  const aerial = createFighter();
  aerial.y -= 100;
  stepFighter(aerial, { attack: true });
  assert.equal(aerial.attackType, "aerial");
});

test("a buffered light input links into the next combo strike", () => {
  const fighter = createFighter();
  stepFighter(fighter, { attack: true });
  stepFighter(fighter, {}, 8);
  stepFighter(fighter, { attack: true });
  stepFighter(fighter, {}, 8);
  assert.equal(fighter.attackType, "light2");
  assert.equal(fighter.comboStep, 2);
  assert.equal(fighter.attackId, 2);
});

test("dash is finite, costs guard and cannot cancel an attack", () => {
  const fighter = createFighter();
  stepFighter(fighter, { right: true, dash: true });
  assert.ok(fighter.dashTimer > 0 && fighter.vx > 500 && fighter.guardMeter < 100);
  const xBefore = fighter.x;
  stepFighter(fighter, {}, 30);
  assert.equal(fighter.dashTimer, 0);
  assert.ok(fighter.x > xBefore && fighter.x <= fight.FIGHT_MOVEMENT.MAX_X);
  const attacker = createFighter();
  stepFighter(attacker, { attack: true });
  stepFighter(attacker, { dash: true });
  assert.equal(attacker.dashTimer, 0);
});

test("dash invulnerability protects only the opening part of the dash", () => {
  const attacker = createFighter();
  const defender = createFighter(450, -1);
  activateStrike(attacker);
  defender.dashTimer = fight.FIGHT_COMBAT.DASH_DURATION_SEC;
  assert.equal(fight.resolveFightStrike(attacker, defender), null);
  defender.dashTimer = .01;
  assert.equal(fight.resolveFightStrike(attacker, defender).kind, "hit");
});

test("stun blocks attacks and movement but expires deterministically", () => {
  const fighter = createFighter();
  fighter.stunTimer = .1;
  stepFighter(fighter, { attack: true, right: true });
  assert.equal(fighter.attacking, false);
  assert.equal(fighter.x, 300);
  stepFighter(fighter, {}, 10);
  assert.equal(fighter.stunTimer, 0);
  stepFighter(fighter, { attack: true });
  assert.equal(fighter.attacking, true);
});

test("pausing clears actions without spending resources or moving", () => {
  const fighter = createFighter();
  fight.stepFightPlayer(fighter, neutralInput({ dash: true, specialAttack: true }), 1 / 60, { active: false });
  assert.equal(fighter.x, 300);
  assert.equal(fighter.guardMeter, 100);
  assert.equal(fighter.attacking, false);
  assert.equal(fighter.dashTimer, 0);
});

test("simultaneous active strikes trade without player-slot priority", () => {
  const p1 = createFighter(300, 1);
  const p2 = createFighter(450, -1);
  activateStrike(p1);
  activateStrike(p2);
  const impacts = fight.resolveFightExchange(p1, p2);
  assert.equal(impacts.p1.kind, "hit");
  assert.equal(impacts.p2.kind, "hit");
  assert.equal(p1.health, p2.health);
  assert.ok(p1.health < 500);
});

test("a guard facing away does not protect the fighter", () => {
  const attacker = createFighter();
  const defender = createFighter(450, 1);
  Object.assign(defender, { guarding: true, guardTimer: .5 });
  activateStrike(attacker);
  assert.equal(fight.resolveFightStrike(attacker, defender).kind, "hit");
});

test("a parry retains the original attack identity for presentation", () => {
  const attacker = createFighter();
  const defender = createFighter(450, -1);
  Object.assign(defender, { guarding: true, guardTimer: .02 });
  activateStrike(attacker, "heavy");
  assert.equal(fight.resolveFightStrike(attacker, defender).attackType, "heavy");
});

test("simultaneous lethal strikes produce two dead fighters", () => {
  const p1 = createFighter(300, 1);
  const p2 = createFighter(450, -1);
  p1.health = p2.health = 10;
  activateStrike(p1);
  activateStrike(p2);
  fight.resolveFightExchange(p1, p2);
  assert.ok(p1.dead && p2.dead);
  assert.equal(p1.health, 0);
  assert.equal(p2.health, 0);
});

test("resources and combo scaling remain bounded through extended combat", () => {
  const attacker = createFighter();
  const defender = createFighter(450, -1);
  for (let index = 0; index < 40; index++) {
    Object.assign(defender, { x: 450, health: 500, dead: false });
    activateStrike(attacker);
    fight.resolveFightStrike(attacker, defender);
  }
  assert.ok(attacker.specialMeter <= 100 && defender.specialMeter <= 100);
  assert.ok(defender.health < 500 && defender.health >= 0);
});
