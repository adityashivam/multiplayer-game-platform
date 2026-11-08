import test from "node:test";
import assert from "node:assert/strict";
import {
  createSkyDashBotInput,
  createSkyDashRound,
  createSkyDashRunner,
  stepSkyDashRunner,
  stepSkyDashWorld,
} from "../public/games/sky-dash/shared/simulation.js";
import { SKY_DASH_INPUT_TEMPLATE } from "../public/games/sky-dash/shared/config.js";
import { sampleSkyDashObstacles, sampleSkyDashPlatforms } from "../public/games/sky-dash/shared/course.js";

const STEP_SEC = 1 / 60;
const EMPTY_OBSTACLES = [];
const TEST_PLATFORM = { id: 90, x: 0, z: 0, width: 100, depth: 100, topY: 0, thickness: 2, vx: 0, vy: 0, vz: 0 };

function input(overrides = {}) {
  return { ...SKY_DASH_INPUT_TEMPLATE, ...overrides };
}

function createActiveRound(options) {
  const round = createSkyDashRound(options);
  round.started = true;
  for (const runner of Object.values(round.players)) runner.connected = true;
  return round;
}

function advanceRound(round, seconds, inputs = {}) {
  const stepCount = Math.ceil(seconds / STEP_SEC);
  for (let stepIndex = 0; stepIndex < stepCount && !round.gameOver; stepIndex += 1) {
    for (const [playerId, runner] of Object.entries(round.players)) {
      stepSkyDashRunner(runner, inputs[playerId] || input(), STEP_SEC, { active: runner.connected, timeSec: round.timeSec });
    }
    stepSkyDashWorld(round, STEP_SEC);
  }
}

function moveOnTestDeck(runner, runnerInput, seconds) {
  for (let stepIndex = 0; stepIndex < Math.ceil(seconds / STEP_SEC); stepIndex += 1) {
    stepSkyDashRunner(runner, runnerInput, STEP_SEC, { active: true, timeSec: 0, platforms: [TEST_PLATFORM], obstacles: EMPTY_OBSTACLES });
  }
}

test("Sky Dash accelerates toward negative Z, jumps, and has distinct dash and dive recovery", () => {
  const runner = createSkyDashRunner("p1", 0);
  Object.assign(runner, { x: 0, z: 0, supportId: 90 });
  moveOnTestDeck(runner, input({ moveZ: 1 }), STEP_SEC);
  assert.ok(runner.vz < 0 && runner.vz > -2);
  moveOnTestDeck(runner, input({ moveZ: 1 }), 0.4);
  assert.ok(runner.vz < -8 && runner.vz >= -8.61);
  moveOnTestDeck(runner, input({ moveZ: 1, jump: true }), STEP_SEC);
  assert.equal(runner.grounded, false);
  assert.ok(runner.vy > 8);
  assert.equal(runner.action, "jump");
  moveOnTestDeck(runner, input({ moveZ: 1, dash: true }), STEP_SEC);
  assert.equal(runner.action, "dash");
  assert.ok(runner.actionTimeSec > 0);
  assert.ok(runner.vz < -16);
  moveOnTestDeck(runner, input({ moveZ: 1, dive: true }), STEP_SEC);
  assert.equal(runner.action, "dive");
  assert.ok(runner.vy < 0);
  assert.ok(runner.diveCooldownSec > 1);
  moveOnTestDeck(runner, input(), 1.2);
  assert.equal(runner.grounded, true);
  assert.ok(Math.abs(runner.vx) + Math.abs(runner.vz) < 0.01);
});

test("Sky Dash runner prediction freezes when inactive and bounds direct oversized steps", () => {
  const runner = createSkyDashRunner("p1", 0);
  Object.assign(runner, { action: "dash", actionTimeSec: 0.2, dashCooldownSec: 0.8, hitImmunitySec: 0.3 });
  const before = structuredClone(runner);
  stepSkyDashRunner(runner, input({ jump: true, dash: true }), 1, { active: false, timeSec: 0 });
  assert.deepEqual(runner, before);
  moveOnTestDeck(runner, input({ moveZ: 1 }), STEP_SEC);
  const startZ = runner.z;
  stepSkyDashRunner(runner, input({ moveZ: 1 }), 200, { active: true, timeSec: 0 });
  assert.ok(startZ - runner.z < 1);
  assert.ok(Number.isFinite(runner.y));
});

test("Sky Dash retains a short buffered jump through landing across collision substeps", () => {
  const runner = createSkyDashRunner("p1", 0);
  Object.assign(runner, { x: 0, y: 0.15, z: 0, vy: -3, grounded: false, supportId: 0 });
  moveOnTestDeck(runner, input({ jump: true }), STEP_SEC);
  moveOnTestDeck(runner, input(), 0.08);
  assert.equal(runner.grounded, false);
  assert.ok(runner.vy > 6, `buffered jump velocity was ${runner.vy}`);
  assert.ok(runner.y > 0.2);
});

test("Sky Dash carries grounded runners with a moving platform without doubling its velocity", () => {
  const runner = createSkyDashRunner("p1", 0);
  const platform = { ...TEST_PLATFORM, width: 8, depth: 8, vx: 2 };
  Object.assign(runner, { x: 0, z: 0, supportId: 90 });
  for (let stepIndex = 0; stepIndex < 60; stepIndex += 1) {
    platform.x = stepIndex * STEP_SEC * 2;
    stepSkyDashRunner(runner, input(), STEP_SEC, { active: true, timeSec: stepIndex * STEP_SEC, platforms: [platform], obstacles: EMPTY_OBSTACLES });
  }
  assert.ok(Math.abs(runner.x - 2) < 0.03, `carry reached ${runner.x}`);
  assert.equal(runner.vx, 0);
  assert.equal(runner.supportId, 90);
});

test("Sky Dash obstacle contacts stagger once and still depenetrate during hit immunity", () => {
  for (const kind of ["sweeper", "hammer", "bumper"]) {
    const runner = createSkyDashRunner("p1", 0);
    Object.assign(runner, { x: 0.1, y: 0, z: 0, supportId: 90 });
    const obstacle = { id: 99, kind, x: 0, y: 0.8, z: 0, ax: -2, az: 0, bx: 2, bz: 0, radius: 0.5, vx: 3, vy: 0, vz: 0, angle: 0, angularSpeed: 1 };
    stepSkyDashRunner(runner, input(), STEP_SEC, { active: true, timeSec: 0, platforms: [TEST_PLATFORM], obstacles: [obstacle] });
    assert.equal(runner.action, "hit", kind);
    assert.ok(runner.hitSec > 0 && runner.hitImmunitySec > 0, kind);
    assert.ok(Math.hypot(runner.vx, runner.vz) <= 22.001, kind);
    Object.assign(runner, { x: 0.1, y: 0, z: 0 });
    stepSkyDashRunner(runner, input(), STEP_SEC, { active: true, timeSec: 0, platforms: [TEST_PLATFORM], obstacles: [obstacle] });
    const distance = kind === "sweeper" ? Math.abs(runner.z) : Math.hypot(runner.x, runner.z);
    assert.ok(distance >= 0.88, `${kind} kept overlap during immunity at ${distance}`);
  }
});

test("Sky Dash dash substeps catch a fast approaching obstacle before it passes through the runner", () => {
  const runner = createSkyDashRunner("p1", 0);
  Object.assign(runner, { x: 0, y: 0, z: 0.8, supportId: 90 });
  const obstacle = { id: 99, kind: "bumper", x: 0, y: 0.8, z: 0, ax: 0, az: 0, bx: 0, bz: 0, radius: 0.25, vx: 0, vy: 0, vz: 20, angle: 0, angularSpeed: 0 };
  stepSkyDashRunner(runner, input({ moveZ: 1, dash: true }), 0.05, { active: true, timeSec: 0, platforms: [TEST_PLATFORM], obstacles: [obstacle] });
  assert.equal(runner.action, "hit");
  assert.ok(runner.z > 1, `approaching bumper tunneled to the far side at ${runner.z}`);
  assert.ok(Math.hypot(runner.vx, runner.vz) <= 22.001);
});

test("Sky Dash falls respawn quickly at the earned checkpoint with a new numeric snap identity", () => {
  const round = createActiveRound({ botCount: 0 });
  const runner = round.players.p1;
  Object.assign(runner, { checkpoint: 2, progress: 2.1, y: -13, x: 12, z: -73 });
  const snapIdentity = runner.respawnId;
  advanceRound(round, 0.8);
  assert.equal(runner.respawnId, snapIdentity + 1);
  assert.equal(runner.checkpoint, 2);
  assert.ok(Math.abs(runner.x) < 7 && runner.z > -70 && runner.z < -64);
  assert.ok(runner.y >= 1.19);
  assert.ok(Math.hypot(runner.x - round.players.p2.x, runner.z - round.players.p2.z) > 0.84);
});

test("Sky Dash checkpoint order prevents finish shortcuts and airborne travel still crosses legitimate gates", () => {
  const round = createActiveRound({ botCount: 0 });
  const runner = round.players.p1;
  Object.assign(runner, { x: 0, y: 1.2, z: -135, supportId: 10 });
  stepSkyDashWorld(round, STEP_SEC);
  assert.equal(runner.finished, false);
  assert.equal(runner.checkpoint, 0);
  for (const [checkpoint, approachZ, gateZ, y, supportId] of [[1, -35.9, -36.1, 0.3, 2], [2, -67.9, -68.1, 1.2, 6], [3, -99.9, -100.1, 1.2, 8]]) {
    Object.assign(runner, { x: 0, y, z: approachZ, supportId, lastProgressZ: approachZ });
    runner.z = gateZ;
    stepSkyDashWorld(round, STEP_SEC);
    assert.equal(runner.checkpoint, checkpoint);
  }
  Object.assign(runner, { x: 0, y: 1.2, z: -134.1, supportId: 10, lastProgressZ: -133.9 });
  stepSkyDashWorld(round, STEP_SEC);
  assert.equal(runner.finished, true);
  assert.ok(runner.finishTimeSec > 0);
});

test("Sky Dash awards a checkpoint crossed by legitimate authority crowd push-out", () => {
  const round = createActiveRound({ botCount: 10 });
  round.timeSec = 15;
  for (const runner of [...Object.values(round.players), ...round.bots]) {
    Object.assign(runner, { x: 0, y: 0.3, z: -35.8, lastProgressZ: -35.8, supportId: 2 });
  }
  stepSkyDashWorld(round, STEP_SEC);
  assert.ok(round.bots[2].z < -36);
  assert.equal(round.bots[2].checkpoint, 1);
});

test("Sky Dash crowd contacts separate humans and bots and preserve finite world contact", () => {
  const round = createActiveRound();
  for (const runner of [...Object.values(round.players), ...round.bots]) {
    Object.assign(runner, { x: 0, z: -5, y: 0, supportId: 1 });
  }
  stepSkyDashWorld(round, STEP_SEC);
  const runners = [...Object.values(round.players), ...round.bots];
  for (let index = 0; index < runners.length; index += 1) {
    assert.ok(Number.isFinite(runners[index].x) && Number.isFinite(runners[index].y));
    for (let otherIndex = index + 1; otherIndex < runners.length; otherIndex += 1) {
      const separation = Math.hypot(runners[index].x - runners[otherIndex].x, runners[index].z - runners[otherIndex].z);
      assert.ok(separation >= 0.83, `overlap ${index}/${otherIndex} at ${separation}`);
    }
  }
});

test("Sky Dash dense crowd push-out does not leave persistent obstacle or runner overlap", () => {
  for (const obstacleIndex of [0, 4]) {
    const round = createActiveRound({ botCount: 10 });
    round.timeSec = 1.2;
    const obstacle = sampleSkyDashObstacles(round.timeSec)[obstacleIndex];
    const runners = [...Object.values(round.players), ...round.bots];
    for (const runner of runners) {
      Object.assign(runner, { x: obstacle.x, z: obstacle.z, y: obstacleIndex === 0 ? 0.3 : 1.2, supportId: obstacleIndex === 0 ? 2 : 9 });
    }
    advanceRound(round, 0.1);
    for (let index = 0; index < runners.length; index += 1) {
      for (let otherIndex = index + 1; otherIndex < runners.length; otherIndex += 1) {
        if (Math.abs(runners[index].y - runners[otherIndex].y) >= 1.45) continue;
        assert.ok(Math.hypot(runners[index].x - runners[otherIndex].x, runners[index].z - runners[otherIndex].z) >= 0.82);
      }
    }
    const sampledObstacle = sampleSkyDashObstacles(round.timeSec)[obstacleIndex];
    for (const runner of runners) {
      let nearestX = sampledObstacle.x;
      let nearestZ = sampledObstacle.z;
      if (obstacleIndex === 0) {
        const segmentX = sampledObstacle.bx - sampledObstacle.ax;
        const segmentZ = sampledObstacle.bz - sampledObstacle.az;
        const segmentFraction = Math.max(0, Math.min(1, ((runner.x - sampledObstacle.ax) * segmentX + (runner.z - sampledObstacle.az) * segmentZ) / (segmentX * segmentX + segmentZ * segmentZ)));
        nearestX = sampledObstacle.ax + segmentX * segmentFraction;
        nearestZ = sampledObstacle.az + segmentZ * segmentFraction;
      }
      const nearestY = Math.max(runner.y + 0.42, Math.min(runner.y + 1.03, sampledObstacle.y));
      assert.ok(Math.hypot(runner.x - nearestX, nearestY - sampledObstacle.y, runner.z - nearestZ) >= sampledObstacle.radius + 0.418);
    }
  }
});

test("Sky Dash supports configured human slots without assigning socket seats to bots", () => {
  const round = createSkyDashRound({ playerIds: ["red", "green", "blue", "gold"], botCount: 2 });
  assert.deepEqual(Object.keys(round.players), ["red", "green", "blue", "gold"]);
  assert.equal(round.bots.length, 2);
  assert.ok(round.bots.every((bot) => bot.connected && bot.isBot && !Object.hasOwn(round.players, bot.id)));
  assert.throws(() => createSkyDashRound({ playerIds: ["p1", "p1"] }), TypeError);
  assert.throws(() => createSkyDashRound({ playerIds: ["bad.id"] }), TypeError);
  assert.throws(() => createSkyDashRound({ botCount: 11 }), RangeError);
});

test("Sky Dash bots use finite legal inputs, jump moving stones, and complete the actual course before ninety seconds", () => {
  for (const startTimeSec of [0, 2.3, 6.1]) {
    const round = createActiveRound();
    round.timeSec = startTimeSec;
    let sawJump = false;
    let sawMovingSupport = false;
    for (let stepIndex = 0; stepIndex < 5399 && !round.bots.every((bot) => bot.finished); stepIndex += 1) {
      for (const bot of round.bots) {
        const botInput = createSkyDashBotInput(round, bot);
        assert.ok(Math.abs(botInput.moveX) <= 1 && Math.abs(botInput.moveZ) <= 1);
        assert.ok(Object.values(botInput).every((value) => typeof value === "boolean" || Number.isFinite(value)));
        sawJump ||= botInput.jump;
        sawMovingSupport ||= bot.supportId >= 3 && bot.supportId <= 5;
      }
      stepSkyDashWorld(round, STEP_SEC);
    }
    assert.equal(round.bots.every((bot) => bot.finished), true, JSON.stringify(round.bots.map(({ id, checkpoint, z, respawnId }) => ({ id, checkpoint, z, respawnId }))));
    assert.equal(sawJump, true);
    assert.equal(sawMovingSupport, true);
    assert.ok(round.bots.every((bot) => bot.finishTimeSec < 90));
  }
});

test("Sky Dash standings rank bot finish times ahead of unfinished checkpoint progress and freeze results", () => {
  const round = createActiveRound();
  Object.assign(round.bots[0], { finished: true, finishTimeSec: 20, checkpoint: 3, progress: 4 });
  Object.assign(round.players.p1, { checkpoint: 3, progress: 3.9 });
  Object.assign(round.players.p2, { checkpoint: 1, progress: 1.7 });
  round.timer = 0.001;
  stepSkyDashWorld(round, STEP_SEC);
  assert.equal(round.gameOver, true);
  assert.equal(round.winner, round.bots[0].id);
  assert.equal(round.bots[0].rank, 1);
  assert.ok(round.players.p1.rank < round.players.p2.rank);
  const finishedRound = structuredClone(round);
  stepSkyDashWorld(round, STEP_SEC);
  assert.deepEqual(round, finishedRound);
});

test("Sky Dash ends early only after every configured human crosses the ordered finish", () => {
  const round = createActiveRound({ playerIds: ["red", "green", "blue", "gold"], botCount: 2 });
  Object.assign(round.bots[0], { finished: true, finishTimeSec: 8, checkpoint: 3, progress: 4 });
  round.timeSec = 20;
  for (const [runnerIndex, runner] of Object.values(round.players).entries()) {
    Object.assign(runner, { x: (runnerIndex - 1.5) * 3, y: 1.2, z: runnerIndex === 3 ? -130 : -134.1, lastProgressZ: -133.9, checkpoint: 3, supportId: 10 });
  }
  stepSkyDashWorld(round, STEP_SEC);
  assert.equal(round.gameOver, false);
  assert.equal(Object.values(round.players).filter((runner) => runner.finished).length, 3);
  Object.assign(round.players.gold, { z: -134.1, lastProgressZ: -133.9 });
  stepSkyDashWorld(round, STEP_SEC);
  assert.equal(round.gameOver, true);
  assert.equal(round.winner, round.bots[0].id);
  assert.ok(round.timer > 89);
});

test("Sky Dash analytic course sampling never mutates platform and obstacle configuration", () => {
  const firstPlatforms = sampleSkyDashPlatforms(0);
  const firstObstacles = sampleSkyDashObstacles(0);
  const laterPlatforms = sampleSkyDashPlatforms(1);
  const laterObstacles = sampleSkyDashObstacles(1);
  assert.notEqual(firstPlatforms[2].x, laterPlatforms[2].x);
  assert.notEqual(firstObstacles[0].ax, laterObstacles[0].ax);
  assert.equal(firstPlatforms[2].x, 0);
  assert.ok(laterPlatforms.every((platform) => Number.isFinite(platform.vx)));
});
