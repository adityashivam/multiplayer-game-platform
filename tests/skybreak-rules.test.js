import test from "node:test";
import assert from "node:assert/strict";
import { SKYBREAK_ARENA, SKYBREAK_COMBAT_SETTINGS, SKYBREAK_INPUT_TEMPLATE, SKYBREAK_TIME_TRIAL_SETTINGS } from "../public/games/skybreak/shared/config.js";
import { createSkybreakJet, getSkybreakTurnScale, placeSkybreakJet, stepSkybreakFlight } from "../public/games/skybreak/shared/flight.js";
import {
  damageSkybreakJet,
  findSkybreakLockTarget,
  recordSkybreakPoses,
  sampleSkybreakPose,
  stepSkybreakBullets,
  stepSkybreakMissiles,
  stepSkybreakWeapons,
} from "../public/games/skybreak/shared/combat.js";
import {
  applySkybreakRestartInput,
  createSkybreakMatch,
  crossedSkybreakGate,
  listSkybreakJets,
  startSkybreakMatch,
  stepSkybreakWorld,
} from "../public/games/skybreak/shared/match.js";
import { createSkybreakBotBrain, decideSkybreakBotInput, decideSkybreakCourseAutopilot } from "../public/games/skybreak/shared/bot.js";
import { SKYBREAK_COURSE_GATES, getSkybreakGroundClearanceHeight } from "../public/games/skybreak/shared/terrain.js";

const DT_SEC = 1 / 60;
const input = (overrides = {}) => ({ ...SKYBREAK_INPUT_TEMPLATE, ...overrides });

/** A jet high over open air, flying +Z. */
function createHighJet(id = "p1", slot = 0) {
  const jet = createSkybreakJet(id, slot);
  placeSkybreakJet(jet, { x: 0, y: 1200, z: 0, forwardX: 0, forwardZ: 1 });
  return jet;
}

/** A started dogfight with jets placed by the caller. */
function createDogfight(botIds = ["b1"]) {
  const match = createSkybreakMatch({ mode: "dogfight", playerIds: ["p1"], botIds });
  match.started = true;
  match.phase = "playing";
  for (const jet of listSkybreakJets(match)) jet.shieldSec = 0;
  return match;
}

/** Degrees the nose moves in one second of full pull at a held speed. */
function measurePullDegrees(speed) {
  const jet = createHighJet();
  for (let tick = 0; tick < 60; tick += 1) {
    jet.speed = speed;
    stepSkybreakFlight(jet, input({ pitch: 1 }), DT_SEC, { active: true, boundary: false });
  }
  return (Math.acos(Math.max(-1, Math.min(1, jet.forwardZ))) * 180) / Math.PI;
}

test("turn authority peaks at corner speed, so speed management matters", () => {
  assert.ok(getSkybreakTurnScale(165) > getSkybreakTurnScale(90));
  assert.ok(getSkybreakTurnScale(165) > getSkybreakTurnScale(260));
  assert.ok(measurePullDegrees(165) > measurePullDegrees(260));
  assert.ok(measurePullDegrees(165) > measurePullDegrees(90));
});

test("boost burns fuel, and sustained hard pulls end in a blackout", () => {
  const jet = createHighJet();
  for (let tick = 0; tick < 60 * 4; tick += 1) stepSkybreakFlight(jet, input({ boost: true }), DT_SEC, { active: true, boundary: false });
  assert.ok(jet.speed > 200, `boost speed ${jet.speed}`);
  assert.ok(jet.fuel < 0.6);

  const puller = createHighJet();
  let blackedOut = false;
  for (let tick = 0; tick < 60 * 12 && !blackedOut; tick += 1) {
    puller.speed = 220;
    stepSkybreakFlight(puller, input({ pitch: 1, boost: true }), DT_SEC, { active: true, boundary: false });
    blackedOut = puller.blackoutSec > 0;
  }
  assert.equal(blackedOut, true);
});

test("flying into the ground marks a crash; leaving the arena counts time outside", () => {
  const diver = createSkybreakJet("p1", 0);
  placeSkybreakJet(diver, { x: 0, y: getSkybreakGroundClearanceHeight(0, 0) + 20, z: 0, forwardX: 0, forwardZ: 1 });
  for (let tick = 0; tick < 120 && !diver.crashed; tick += 1) stepSkybreakFlight(diver, input({ pitch: -1 }), DT_SEC, { active: true, boundary: false });
  assert.equal(diver.crashed, true);

  const wanderer = createHighJet();
  wanderer.x = SKYBREAK_ARENA.radiusM + 50;
  wanderer.y = 1200;
  stepSkybreakFlight(wanderer, input(), DT_SEC, { active: true, boundary: true });
  assert.ok(wanderer.outsideSec > 0);
});

test("rewound hits: a round fired at where the shooter saw the target lands", () => {
  const match = createDogfight(["b1"]);
  const shooter = match.players.p1;
  const target = match.bots[0];
  placeSkybreakJet(shooter, { x: 0, y: 1200, z: 0, forwardX: 0, forwardZ: 1 });
  placeSkybreakJet(target, { x: 0, y: 1200, z: 400, forwardX: 1, forwardZ: 0 });
  const jets = listSkybreakJets(match);
  recordSkybreakPoses(match, jets);
  // The target then moves 40 m sideways; the shooter's view is 10 ticks old.
  for (let tick = 0; tick < 10; tick += 1) {
    target.x += 4;
    recordSkybreakPoses(match, jets);
  }
  const seen = { x: 0, y: 0, z: 0, alive: false };
  assert.equal(sampleSkybreakPose(match, target.id, 10, seen), true);
  assert.equal(seen.x, 0);

  const healthBefore = target.health;
  stepSkybreakWeapons(shooter, input({ fire: true, viewLagTicks: 10 }), DT_SEC, match, jets);
  for (let tick = 0; tick < 40; tick += 1) stepSkybreakBullets(match, jets, DT_SEC);
  assert.ok(target.health < healthBefore, "the rewound target was hit");
  assert.ok(shooter.hitConfirmSerial > 0);

  const lateMatch = createDogfight(["b1"]);
  const lateShooter = lateMatch.players.p1;
  const lateTarget = lateMatch.bots[0];
  placeSkybreakJet(lateShooter, { x: 0, y: 1200, z: 0, forwardX: 0, forwardZ: 1 });
  placeSkybreakJet(lateTarget, { x: 40, y: 1200, z: 400, forwardX: 1, forwardZ: 0 });
  const lateJets = listSkybreakJets(lateMatch);
  for (let tick = 0; tick < 11; tick += 1) recordSkybreakPoses(lateMatch, lateJets);
  stepSkybreakWeapons(lateShooter, input({ fire: true, viewLagTicks: 0 }), DT_SEC, lateMatch, lateJets);
  for (let tick = 0; tick < 40; tick += 1) stepSkybreakBullets(lateMatch, lateJets, DT_SEC);
  assert.equal(lateTarget.health, SKYBREAK_COMBAT_SETTINGS.maxHealth, "without rewind, aiming at an old position misses");
});

test("the cannon overheats when held too long", () => {
  const match = createDogfight([]);
  const jet = match.players.p1;
  placeSkybreakJet(jet, { x: 0, y: 1200, z: 0, forwardX: 0, forwardZ: 1 });
  for (let tick = 0; tick < 60 * 4; tick += 1) stepSkybreakWeapons(jet, input({ fire: true }), DT_SEC, match, [jet]);
  assert.ok(jet.overheatSec > 0 || jet.heat > 0.9);
});

test("a held lock fires a homing missile, and flares spoof it", () => {
  function launchAtTarget(useFlare) {
    const match = createDogfight(["b1"]);
    const shooter = match.players.p1;
    const target = match.bots[0];
    placeSkybreakJet(shooter, { x: 0, y: 1200, z: 0, forwardX: 0, forwardZ: 1 });
    placeSkybreakJet(target, { x: 30, y: 1210, z: 700, forwardX: 1, forwardZ: 0 });
    const jets = listSkybreakJets(match);
    assert.equal(findSkybreakLockTarget(shooter, jets), target);
    for (let tick = 0; tick < 80; tick += 1) stepSkybreakWeapons(shooter, input(), DT_SEC, match, jets);
    assert.equal(shooter.lockProgress, 1);
    stepSkybreakWeapons(shooter, input({ missile: true }), DT_SEC, match, jets);
    assert.equal(match.missiles.length, 1);
    assert.equal(match.missiles[0].targetId, target.id);
    for (let tick = 0; tick < 60 * 6 && match.missiles.length > 0; tick += 1) {
      target.x += target.speed * DT_SEC;
      if (useFlare && tick === 30) stepSkybreakWeapons(target, input({ flare: true }), DT_SEC, match, jets);
      stepSkybreakMissiles(match, jets, DT_SEC);
    }
    return target;
  }
  assert.ok(launchAtTarget(false).health <= SKYBREAK_COMBAT_SETTINGS.maxHealth - SKYBREAK_COMBAT_SETTINGS.missileDamage);
  assert.equal(launchAtTarget(true).health, SKYBREAK_COMBAT_SETTINGS.maxHealth, "a timely flare decoys the missile");
});

test("crashing after being hit credits the attacker, and the kill limit ends the dogfight", () => {
  const match = createDogfight(["b1"]);
  const attacker = match.players.p1;
  const victim = match.bots[0];
  damageSkybreakJet(match, victim, 10, attacker, "cannon");
  victim.crashed = true;
  stepSkybreakWorld(match, DT_SEC);
  assert.equal(victim.alive, false);
  assert.equal(attacker.kills, 1);
  assert.equal(match.killFeed.at(-1).killerId, "p1");
  assert.equal(match.killFeed.at(-1).cause, "terrain");

  for (let tick = 0; tick < 60 * 4; tick += 1) stepSkybreakWorld(match, DT_SEC);
  assert.equal(victim.alive, true, "the victim respawns");
  assert.ok(victim.shieldSec > 0 || victim.respawnId > 1);

  attacker.kills = match.killsToWin;
  stepSkybreakWorld(match, DT_SEC);
  assert.equal(match.gameOver, true);
  assert.equal(match.winner, "p1");
});

test("time trial: gates count in order, the run finishes, and restart is instant", () => {
  const match = createSkybreakMatch({ mode: "timeTrial", playerIds: ["p1"] });
  match.started = true;
  startSkybreakMatch(match);
  const jet = match.players.p1;
  assert.equal(jet.runActive, true);
  const control = input();
  for (let tick = 0; tick < 60 * 60 && jet.runActive; tick += 1) {
    decideSkybreakCourseAutopilot(jet, SKYBREAK_COURSE_GATES, control);
    stepSkybreakFlight(jet, control, DT_SEC, { active: true, boundary: false });
    stepSkybreakWorld(match, DT_SEC);
  }
  assert.equal(jet.gateIndex, SKYBREAK_COURSE_GATES.length);
  assert.ok(jet.lastRunSec > 0 && jet.lastRunSec <= SKYBREAK_TIME_TRIAL_SETTINGS.medals.silver, `autopilot run ${jet.lastRunSec}s`);
  assert.ok(SKYBREAK_TIME_TRIAL_SETTINGS.medals.platinum < jet.lastRunSec, "platinum asks for more than the autopilot");

  const serial = jet.runSerial;
  applySkybreakRestartInput(match, jet, input({ restart: true }));
  assert.equal(jet.runSerial, serial + 1);
  assert.equal(jet.gateIndex, 0);
  assert.equal(jet.runActive, true);
});

test("gates only count when crossed forward inside the ring", () => {
  const gate = SKYBREAK_COURSE_GATES[0];
  const jet = createSkybreakJet("p1", 0);
  Object.assign(jet, { previousX: gate.x - gate.forwardX * 5, previousY: gate.y, previousZ: gate.z - gate.forwardZ * 5, x: gate.x + gate.forwardX * 5, y: gate.y, z: gate.z + gate.forwardZ * 5 });
  assert.equal(crossedSkybreakGate(jet, gate), true);
  Object.assign(jet, { previousY: gate.y + gate.radius * 2, y: gate.y + gate.radius * 2 });
  assert.equal(crossedSkybreakGate(jet, gate), false, "over the ring does not count");
  Object.assign(jet, { previousX: gate.x + gate.forwardX * 5, previousY: gate.y, previousZ: gate.z + gate.forwardZ * 5, x: gate.x - gate.forwardX * 5, y: gate.y, z: gate.z - gate.forwardZ * 5 });
  assert.equal(crossedSkybreakGate(jet, gate), false, "backwards does not count");
});

test("bots are deterministic and a bot-only dogfight produces kills", () => {
  function runBots(seed) {
    const match = createSkybreakMatch({ mode: "dogfight", playerIds: [], botIds: ["b1", "b2", "b3", "b4"] });
    match.started = true;
    const brains = match.bots.map((_bot, index) => createSkybreakBotBrain(seed + index));
    const jets = [];
    for (let tick = 0; tick < 60 * 90; tick += 1) {
      listSkybreakJets(match, jets);
      match.bots.forEach((bot, index) => {
        const control = decideSkybreakBotInput(bot, brains[index], match, jets, DT_SEC);
        stepSkybreakFlight(bot, control, DT_SEC, { active: true, boundary: true });
        stepSkybreakWeapons(bot, control, DT_SEC, match, jets);
      });
      stepSkybreakWorld(match, DT_SEC);
    }
    return match;
  }
  const first = runBots(5);
  const second = runBots(5);
  assert.deepEqual(first.killFeed, second.killFeed);
  assert.ok(first.killSerial > 0, "bots shoot each other down");
});
