import test from "node:test";
import assert from "node:assert/strict";
import {
  createSkyDashSeesaws,
  getSkyDashPlatformTopY,
  sampleSkyDashObstacles,
  sampleSkyDashPlatforms,
  sampleSkyDashSeesaws,
} from "../public/games/sky-dash/shared/course.js";
import { SKY_DASH_INPUT_TEMPLATE } from "../public/games/sky-dash/shared/config.js";
import {
  createSkyDashBotInput,
  createSkyDashRound,
  createSkyDashRunner,
  stepSkyDashRunner,
  stepSkyDashWorld,
} from "../public/games/sky-dash/shared/simulation.js";

const STEP_SEC = 1 / 60;
const TEST_DECK = { id: 99, x: 0, z: -84, width: 20, depth: 40, topY: 1.2, thickness: 2, vx: 0, vy: 0, vz: 0 };

function input(overrides = {}) {
  return { ...SKY_DASH_INPUT_TEMPLATE, ...overrides };
}

function createActiveRound(options = { botCount: 0 }) {
  const round = createSkyDashRound(options);
  round.started = true;
  for (const runner of Object.values(round.players)) runner.connected = true;
  return round;
}

function advanceWorld(round, seconds) {
  for (let stepIndex = 0; stepIndex < Math.ceil(seconds / STEP_SEC); stepIndex += 1) {
    for (const runner of Object.values(round.players)) {
      stepSkyDashRunner(runner, input(), STEP_SEC, { active: round.started, timeSec: round.timeSec, seesaws: round.seesaws });
    }
    stepSkyDashWorld(round, STEP_SEC);
  }
}

test("Sky Dash seesaws respond to occupant weight, retain grounded feet, and balance opposite loads", () => {
  const round = createActiveRound();
  const platform = sampleSkyDashPlatforms(0, round.seesaws).find((candidate) => candidate.id === 3);
  const firstRunner = round.players.p1;
  Object.assign(firstRunner, { x: platform.x + 2.4, y: platform.topY, z: platform.z, grounded: true, supportId: 3 });
  advanceWorld(round, 0.8);
  assert.ok(round.seesaws[0].angle < -0.1, `loaded seesaw angle ${round.seesaws[0].angle}`);
  const tiltedPlatform = sampleSkyDashPlatforms(round.timeSec, round.seesaws).find((candidate) => candidate.id === 3);
  assert.ok(Math.abs(firstRunner.y - getSkyDashPlatformTopY(tiltedPlatform, firstRunner.x, firstRunner.z)) < 0.015);
  assert.equal(firstRunner.grounded, true);
  assert.equal(firstRunner.supportId, 3);

  const balancedRound = createActiveRound();
  for (const [runnerIndex, runner] of Object.values(balancedRound.players).entries()) {
    Object.assign(runner, { x: runnerIndex === 0 ? -2 : 2, y: 0.6, z: -45, grounded: true, supportId: 3 });
  }
  advanceWorld(balancedRound, 0.5);
  assert.ok(Math.abs(balancedRound.seesaws[0].angle) < 0.02);
});

test("Sky Dash seesaw extrapolation is immutable, bounded and springs settle after players leave", () => {
  const seesaws = createSkyDashSeesaws();
  Object.assign(seesaws[0], { angle: 0.24, angularVelocity: 0.7 });
  const projected = sampleSkyDashSeesaws(seesaws, 100);
  assert.equal(seesaws[0].angle, 0.24);
  assert.equal(projected[0].angle, 0.25);
  assert.equal(projected[0].angularVelocity, 0);
  assert.deepEqual(sampleSkyDashSeesaws(seesaws, 0).map((seesaw) => seesaw.platformId), [3, 4, 5]);

  const round = createActiveRound();
  Object.assign(round.seesaws[0], { angle: 0.22, angularVelocity: 0.4 });
  for (let stepIndex = 0; stepIndex < 240; stepIndex += 1) {
    stepSkyDashWorld(round, STEP_SEC);
    assert.ok(Math.abs(round.seesaws[0].angle) <= 0.25);
    assert.ok(Math.abs(round.seesaws[0].angularVelocity) <= 0.8);
  }
  assert.ok(Math.abs(round.seesaws[0].angle) < 0.01);
  assert.ok(Math.abs(round.seesaws[0].angularVelocity) < 0.02);
  round.started = false;
  const pausedSeesaws = structuredClone(round.seesaws);
  advanceWorld(round, 1);
  assert.deepEqual(round.seesaws, pausedSeesaws);
});

test("Sky Dash first hurdle blocks running and an ordinary jump clears the authored bar", () => {
  const hurdle = sampleSkyDashObstacles(0).find((obstacle) => obstacle.kind === "hurdle");
  assert.ok(hurdle);
  const runAttempt = createSkyDashRunner("run", 0);
  const jumpAttempt = createSkyDashRunner("jump", 1);
  for (const runner of [runAttempt, jumpAttempt]) Object.assign(runner, { x: 0, y: 0, z: -5, supportId: 1 });
  let sawRunHit = false;
  let sawJumpHit = false;
  for (let stepIndex = 0; stepIndex < 60; stepIndex += 1) {
    stepSkyDashRunner(runAttempt, input({ moveZ: 1 }), STEP_SEC, { active: true, timeSec: stepIndex * STEP_SEC, obstacles: [hurdle] });
    stepSkyDashRunner(jumpAttempt, input({ moveZ: 1, jump: stepIndex === 0 }), STEP_SEC, { active: true, timeSec: stepIndex * STEP_SEC, obstacles: [hurdle] });
    sawRunHit ||= runAttempt.hitSec > 0;
    sawJumpHit ||= jumpAttempt.hitSec > 0;
  }
  assert.equal(sawRunHit, true);
  assert.equal(sawJumpHit, false);
  assert.ok(runAttempt.z > -8);
  assert.ok(jumpAttempt.z < -10);
});

test("Sky Dash hurdles cover both walkable deck edges so running cannot bypass their bars", () => {
  const hurdle = sampleSkyDashObstacles(0).find((obstacle) => obstacle.kind === "hurdle");
  for (const x of [-7.5, 7.5]) {
    const runner = createSkyDashRunner("edge", 0);
    Object.assign(runner, { x, y: 0, z: -5, supportId: 1 });
    let nearestZ = runner.z;
    for (let stepIndex = 0; stepIndex < 60; stepIndex += 1) {
      stepSkyDashRunner(runner, input({ moveZ: 1 }), STEP_SEC, { active: true, timeSec: 0, obstacles: [hurdle] });
      nearestZ = Math.min(nearestZ, runner.z);
    }
    assert.ok(nearestZ > -8, `walked around the hurdle at x=${x}, z=${nearestZ}`);
  }
});

test("Sky Dash circular frames physically block outside the hole without sending a runner through the far face", () => {
  const gate = sampleSkyDashObstacles(0).find((obstacle) => obstacle.kind === "gate");
  assert.ok(gate);
  const runner = createSkyDashRunner("outside", 0);
  Object.assign(runner, { x: 4.5, y: 1.2, z: gate.z + 2, supportId: 99 });
  let nearestZ = runner.z;
  for (let stepIndex = 0; stepIndex < 120; stepIndex += 1) {
    stepSkyDashRunner(runner, input({ moveZ: 1, dash: stepIndex === 0 }), STEP_SEC, { active: true, timeSec: 0, platforms: [TEST_DECK], obstacles: [gate] });
    nearestZ = Math.min(nearestZ, runner.z);
  }
  assert.ok(nearestZ >= gate.z + 0.64, `outside frame crossing reached ${nearestZ}`);
});

test("Sky Dash a centered ordinary jump passes the circular opening while the rotating spoke remains solid", () => {
  const samples = sampleSkyDashObstacles(0);
  const gate = samples.find((obstacle) => obstacle.kind === "gate");
  const spoke = samples.find((obstacle) => obstacle.kind === "gate-spoke");
  assert.ok(gate && spoke);
  const jumper = createSkyDashRunner("jumper", 0);
  Object.assign(jumper, { x: 0, y: 1.2, z: gate.z + 3, supportId: 99 });
  for (let stepIndex = 0; stepIndex < 60; stepIndex += 1) {
    stepSkyDashRunner(jumper, input({ moveZ: 1, jump: stepIndex === 0 }), STEP_SEC, { active: true, timeSec: 0, platforms: [TEST_DECK], obstacles: [gate] });
  }
  assert.ok(jumper.z < gate.z - 2);
  assert.equal(jumper.hitSec, 0);

  const blocked = createSkyDashRunner("blocked", 1);
  Object.assign(blocked, { x: 0, y: 1.2, z: gate.z + 1, supportId: 99 });
  const loweredSpoke = { ...spoke, ax: gate.x, ay: gate.y, az: gate.z, bx: gate.x, by: gate.y - 3.15, bz: gate.z };
  let hitSpoke = false;
  for (let stepIndex = 0; stepIndex < 30; stepIndex += 1) {
    stepSkyDashRunner(blocked, input({ moveZ: 1 }), STEP_SEC, { active: true, timeSec: 0, platforms: [TEST_DECK], obstacles: [loweredSpoke] });
    hitSpoke ||= blocked.hitSec > 0;
  }
  assert.equal(hitSpoke, true);
  const laterSpoke = sampleSkyDashObstacles(1).find((obstacle) => obstacle.kind === "gate-spoke");
  assert.notEqual(spoke.by, laterSpoke.by);
});

test("Sky Dash harder-course bots finish with ordinary input under varied phases and twelve-runner traffic", () => {
  for (const [playerIds, botCount, phaseSec] of [[undefined, 3, 0], [["red", "green", "blue", "gold"], 8, 2.3], [["p1", "p2"], 10, 6.1]]) {
    const round = createActiveRound({ playerIds, botCount });
    round.timeSec = phaseSec;
    for (let stepIndex = 0; stepIndex < 5399 && !round.bots.every((bot) => bot.finished); stepIndex += 1) {
      for (const [runnerIndex, runner] of Object.values(round.players).entries()) {
        const runnerInput = runnerIndex === 0 ? input() : createSkyDashBotInput(round, runner);
        stepSkyDashRunner(runner, runnerInput, STEP_SEC, { active: true, timeSec: round.timeSec, seesaws: round.seesaws });
      }
      stepSkyDashWorld(round, STEP_SEC);
    }
    assert.equal(round.bots.every((bot) => bot.finished), true, JSON.stringify(round.bots.map(({ id, checkpoint, z, respawnId }) => ({ id, checkpoint, z, respawnId }))));
    assert.ok(round.bots.every((bot) => bot.finishTimeSec - phaseSec < 90));
    assert.equal(round.seesaws.length, 3);
    assert.ok(round.seesaws.every((seesaw) => Math.abs(seesaw.angle) <= 0.25));
  }
});
