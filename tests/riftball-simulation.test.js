import test from "node:test";
import assert from "node:assert/strict";
import { RIFTBALL_INPUT_TEMPLATE } from "../public/games/riftball/shared/config.js";
import {
  createRiftballRound,
  stepRiftballPlayer,
  stepRiftballWorld,
} from "../public/games/riftball/shared/simulation.js";
import { stepRiftballContacts } from "../public/games/riftball/shared/contacts.js";

function createActiveRound() {
  const round = createRiftballRound();
  round.started = true;
  round.phase = "playing";
  round.players.p1.connected = true;
  round.players.p2.connected = true;
  return round;
}

function stepPlayer(round, playerId, overrides = {}, dtSec = 1 / 60) {
  stepRiftballPlayer(round.players[playerId], { ...RIFTBALL_INPUT_TEMPLATE, ...overrides }, dtSec, {
    active: round.started && !round.gameOver && round.phase !== "goal",
    timeSec: round.timeSec,
  });
}

function simulateShot(chargeFrames, { aerial = false, behind = false } = {}) {
  const round = createActiveRound();
  const player = round.players.p1;
  Object.assign(player, { x: 0, z: 0, facing: Math.PI });
  if (aerial) Object.assign(player, { y: 1, grounded: false });
  for (let index = 0; index < chargeFrames; index += 1) {
    stepPlayer(round, "p1", { strike: true, aimZ: -1 });
  }
  stepPlayer(round, "p1", { aimZ: -1 });
  Object.assign(round.ball, { x: 0, z: behind ? 1.1 : -1.1, y: player.y + 0.8, vx: 0, vy: 0, vz: 0 });
  for (let index = 0; index < 8; index += 1) {
    stepPlayer(round, "p1", { aimZ: -1 });
    stepRiftballWorld(round, 1 / 60);
  }
  return round;
}

test("released charge changes shot power while a quick release still makes one forward contact", () => {
  const quickRound = simulateShot(1);
  const chargedRound = simulateShot(51);

  assert.equal(quickRound.ball.hitSerial, 1);
  assert.equal(chargedRound.ball.hitSerial, 1);
  assert.equal(quickRound.ball.lastTouchPlayerId, "p1");
  assert.ok(quickRound.ball.vz < -11);
  assert.ok(chargedRound.ball.vz < quickRound.ball.vz - 7);
  assert.ok(chargedRound.players.p1.strikePower > 0.95);
});

test("aerial strikes reach high balls and strikes cannot hit behind the athlete", () => {
  const aerialRound = simulateShot(10, { aerial: true });
  const behindRound = simulateShot(10, { behind: true });
  assert.equal(aerialRound.ball.hitSerial, 1);
  assert.ok(aerialRound.ball.vy > 0);
  assert.equal(behindRound.ball.hitSerial, 0);
});

test("feint cancels a held charge and dash requires stamina plus a fresh cooldown", () => {
  const round = createActiveRound();
  const player = round.players.p1;
  stepPlayer(round, "p1", { strike: true });
  stepPlayer(round, "p1", { strike: true, feint: true });
  assert.equal(player.action, "feint");
  assert.equal(player.chargeSec, 0);
  stepPlayer(round, "p1");
  assert.notEqual(player.action, "strike");
  assert.ok(player.stamina < 94);

  for (let index = 0; index < 15; index += 1) stepPlayer(round, "p1");
  stepPlayer(round, "p1", { dash: true, moveX: 1 });
  const dashActionId = player.actionId;
  assert.equal(player.action, "dash");
  assert.ok(player.vx > 12);
  stepPlayer(round, "p1");
  stepPlayer(round, "p1", { dash: true });
  assert.equal(player.actionId, dashActionId);
  assert.ok(player.dashCooldownSec > 0.9);

  player.dashCooldownSec = 0;
  player.dashHeld = false;
  player.stamina = 1;
  player.dashRemainingSec = 0;
  stepPlayer(round, "p1", { dash: true });
  assert.notEqual(player.action, "dash");
});

test("jump and analog movement use grounded character physics and stay inside court bounds", () => {
  const round = createActiveRound();
  const player = round.players.p1;
  stepPlayer(round, "p1", { moveX: 0.5, jump: true });
  assert.ok(player.y > 0);
  assert.ok(player.vy > 7);
  assert.equal(player.grounded, false);
  for (let index = 0; index < 180; index += 1) stepPlayer(round, "p1", { moveX: 1 });
  assert.ok(player.x <= 9.57 + 1e-8);
  assert.equal(player.y, 0);
  assert.equal(player.grounded, true);
});

test("fast legal goal crossing scores once and celebration resets identities without losing score", () => {
  const round = createActiveRound();
  Object.assign(round.ball, { x: 0, y: 1, z: -17.2, vx: 0, vy: 0, vz: -24 });
  stepRiftballWorld(round, 1 / 60);
  assert.equal(round.players.p1.score, 1);
  assert.equal(round.goalSerial, 1);
  assert.equal(round.lastScorer, "p1");
  assert.equal(round.phase, "goal");
  const serveId = round.ball.serveId;
  const pausedTimer = round.timer;
  stepRiftballWorld(round, 1 / 60);
  assert.equal(round.players.p1.score, 1);
  assert.equal(round.timer, pausedTimer);
  for (let index = 0; index < 100; index += 1) stepRiftballWorld(round, 1 / 60);
  assert.equal(round.phase, "playing");
  assert.equal(round.ball.serveId, serveId + 1);
  assert.equal(round.ball.x, 0);
  assert.equal(round.ball.z, 0);
  assert.equal(round.players.p1.score, 1);
});

test("posts and crossbar rebound maximum-speed shots instead of awarding goals", () => {
  for (const [x, y] of [[3.1, 1], [0, 3.1], [3.5, 1]]) {
    const round = createActiveRound();
    Object.assign(round.ball, { x, y, z: -16.3, vx: 0, vy: 0, vz: -24 });
    stepRiftballWorld(round, 0.05);
    assert.equal(round.players.p1.score, 0, `invalid opening ${x},${y}`);
    assert.ok(round.ball.vz > 0);
    assert.ok(round.ball.bounceSerial >= 1);
  }
});

test("ball contacts bodies and body separation remains safe beside a court wall", () => {
  const round = createActiveRound();
  Object.assign(round.players.p1, { x: 9.55, z: 0 });
  Object.assign(round.players.p2, { x: 9.55, z: 0 });
  stepRiftballWorld(round, 1 / 60);
  assert.ok(Math.hypot(round.players.p1.x - round.players.p2.x, round.players.p1.z - round.players.p2.z) >= 0.86 - 1e-7);
  assert.ok(round.players.p1.x <= 9.57);
  assert.ok(round.players.p2.x <= 9.57);

  Object.assign(round.players.p1, { x: 0, z: 0 });
  Object.assign(round.players.p2, { x: 8, z: 8 });
  Object.assign(round.ball, { x: 0, y: 0.8, z: -1, vx: 0, vy: 0, vz: 24 });
  stepRiftballWorld(round, 0.05);
  assert.ok(round.ball.vz < 0);
  assert.equal(round.ball.lastTouchPlayerId, "p1");
});

test("clock awards a leading athlete, a tie enters golden goal, and fifth goal ends early", () => {
  const leadingRound = createActiveRound();
  leadingRound.timer = 0.01;
  leadingRound.players.p2.score = 2;
  stepRiftballWorld(leadingRound, 1 / 60);
  assert.equal(leadingRound.winner, "p2");
  assert.equal(leadingRound.players.p2.seriesWins, 1);
  assert.equal(leadingRound.players.p1.action, "defeat");
  stepRiftballWorld(leadingRound, 1 / 60);
  assert.equal(leadingRound.players.p2.seriesWins, 1);

  const tiedRound = createActiveRound();
  tiedRound.timer = 0.01;
  stepRiftballWorld(tiedRound, 1 / 60);
  assert.equal(tiedRound.suddenDeath, true);
  assert.equal(tiedRound.phase, "overtime");
  assert.equal(tiedRound.gameOver, false);
  Object.assign(tiedRound.ball, { x: 0, y: 1, z: 17.2, vz: 24 });
  stepRiftballWorld(tiedRound, 1 / 60);
  assert.equal(tiedRound.winner, "p2");

  const fifthRound = createActiveRound();
  fifthRound.players.p1.score = 4;
  Object.assign(fifthRound.ball, { x: 0, y: 1, z: -17.2, vz: -24 });
  stepRiftballWorld(fifthRound, 1 / 60);
  assert.equal(fifthRound.players.p1.score, 5);
  assert.equal(fifthRound.winner, "p1");
});

test("paused rounds retain clock, motion and score without consuming actions", () => {
  const round = createActiveRound();
  round.started = false;
  const previous = structuredClone(round);
  stepRiftballPlayer(round.players.p1, { ...RIFTBALL_INPUT_TEMPLATE, strike: true, jump: true }, 0.05, { active: false, timeSec: 0 });
  stepRiftballWorld(round, 0.05);
  assert.deepEqual(round, previous);
});

test("equally timed opposing strikes produce a neutral clash rather than a last-slot advantage", () => {
  const round = createActiveRound();
  Object.assign(round.players.p1, { x: 0, z: 1.15, facing: Math.PI, strikeFacing: Math.PI,
    action: "strike", actionId: 3, actionTimeSec: 0.12, strikePower: 1 });
  Object.assign(round.players.p2, { x: 0, z: -1.15, facing: 0, strikeFacing: 0,
    action: "strike", actionId: 7, actionTimeSec: 0.12, strikePower: 1 });
  Object.assign(round.ball, { x: 0, y: 0.8, z: 0 });
  stepRiftballWorld(round, 1 / 60);
  assert.ok(Math.abs(round.ball.vz) < 1e-6);
  assert.ok(Math.abs(round.ball.vx) < 1e-6);
  assert.equal(round.players.p1.strikeHitId, 3);
  assert.equal(round.players.p2.strikeHitId, 7);
  assert.equal(round.ball.lastTouchPlayerId, null);
  assert.equal(round.ball.hitSerial, 1);
});

test("a physical body deflection fully into a goal is awarded instead of leaving a dead ball in the net", () => {
  const round = createActiveRound();
  Object.assign(round.players.p2, { x: 0, z: 16.57 });
  Object.assign(round.ball, { x: 0, y: 0.8, z: 17.3, vx: 0, vy: 0, vz: 0 });
  stepRiftballWorld(round, 1 / 60);
  assert.equal(round.players.p2.score, 1);
  assert.equal(round.goalSerial, 1);
  assert.equal(round.lastScorer, "p2");
});

test("opposing physical body contacts clear the ball symmetrically without slot-order energy or touch bias", () => {
  function simulateBodySqueeze(reversed) {
    const round = createActiveRound();
    Object.assign(round.players.p1, { z: 0.43, vz: -5, facing: Math.PI });
    Object.assign(round.players.p2, { z: -0.43, vz: 5, facing: 0 });
    Object.assign(round.ball, { x: 0, y: 0.8, z: 0, vx: 0, vy: 0, vz: 0 });
    const players = Object.values(round.players);
    if (reversed) players.reverse();
    stepRiftballContacts(players, round.ball, 1 / 60);
    return round;
  }

  const orderedRound = simulateBodySqueeze(false);
  const reversedRound = simulateBodySqueeze(true);
  for (const field of ["x", "y", "z", "vx", "vy", "vz", "hitSerial", "lastTouchPlayerId"]) {
    assert.equal(orderedRound.ball[field], reversedRound.ball[field], field);
  }
  assert.ok(Math.abs(orderedRound.ball.z) < 1e-7);
  assert.ok(Math.abs(orderedRound.ball.vz) < 1e-7);
  assert.equal(orderedRound.ball.lastTouchPlayerId, null);
  assert.equal(orderedRound.ball.hitSerial, 1);
  for (const player of Object.values(orderedRound.players)) {
    const axisY = Math.max(player.y + 0.43, Math.min(player.y + 1.37, orderedRound.ball.y));
    assert.ok(Math.hypot(orderedRound.ball.x - player.x, orderedRound.ball.y - axisY,
      orderedRound.ball.z - player.z) >= 0.83 - 1e-7, "the ball must clear both capsules");
    assert.deepEqual(player, reversedRound.players[player.id]);
  }
  const ballSpeedSquared = orderedRound.ball.vx ** 2 + orderedRound.ball.vy ** 2 + orderedRound.ball.vz ** 2;
  const playerSpeedSquared = Object.values(orderedRound.players).reduce((speed, player) => speed + player.vx ** 2 + player.vz ** 2, 0);
  assert.ok(ballSpeedSquared + playerSpeedSquared / 0.06 <= 50 / 0.06 + 0.2,
    "a simultaneous passive collision cannot create kinetic energy beyond gravity integration");
});

test("a body squeeze beside a wall selects a clear escape and keeps a single bounded contact cue", () => {
  const round = createActiveRound();
  Object.assign(round.players.p1, { x: 9.55, z: 0.43, vz: -5 });
  Object.assign(round.players.p2, { x: 9.55, z: -0.43, vz: 5 });
  Object.assign(round.ball, { x: 9.55, y: 0.8 });
  stepRiftballContacts(Object.values(round.players), round.ball, 0.05);
  assert.ok(round.ball.x <= 9.6);
  assert.ok(Math.abs(round.ball.vz) < 1e-7);
  assert.equal(round.ball.lastTouchPlayerId, null);
  assert.equal(round.ball.hitSerial, 1);
  assert.ok(Math.hypot(round.ball.vx, round.ball.vy, round.ball.vz) <= 28);
  for (const player of Object.values(round.players)) {
    const axisY = Math.max(player.y + 0.43, Math.min(player.y + 1.37, round.ball.y));
    assert.ok(Math.hypot(round.ball.x - player.x, round.ball.y - axisY, round.ball.z - player.z) >= 0.83 - 1e-7);
  }
});
