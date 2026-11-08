import test from "node:test";
import assert from "node:assert/strict";
import { createInterpolator } from "../public/platform/frontend-engine/interpolation.js";
import { createDeadShiftRound, damageDeadShiftPlayer, stepDeadShiftWorld } from "../public/games/dead-shift/shared/simulation.js";
import { extractDeadShiftPositions, extractDeadShiftContinuityKeys, createDeadShiftPresentedPlayer } from "../public/games/dead-shift/client/snapshotPose.js";
import { createSkyDashRound } from "../public/games/sky-dash/shared/simulation.js";
import { extractSkyDashPositions, extractSkyDashContinuityKeys } from "../public/games/sky-dash/client/snapshotPose.js";
import { createRiftballRound } from "../public/games/riftball/shared/simulation.js";
import { extractRiftballPositions, extractRiftballContinuityKeys } from "../public/games/riftball/client/snapshotPose.js";
import { extractPongPositions, extractPongContinuityKeys } from "../public/games/pong/client/snapshotPose.js";

function sampleResetBoundary(previous, current, extractPositions, extractContinuityKeys) {
  const interpolator = createInterpolator({ adaptive: false, interpDelayMs: 0, extrapolateMs: 0, extractContinuityKeys });
  interpolator.pushState(previous, { timestampMs: 0 });
  interpolator.pushState(current, { timestampMs: 100 });
  return interpolator.getInterpolatedPositions(extractPositions, { nowMs: 50 });
}

test("Dead Shift respawns advance identity and never interpolate from a dead body", () => {
  const round = createDeadShiftRound();
  round.roundId = 1;
  round.started = true;
  round.players.p1.connected = true;
  round.players.p2.connected = true;
  const previous = structuredClone(round);
  previous.players.p1.x = -10;
  assert.equal(round.players.p1.respawnId, 0);
  damageDeadShiftPlayer(round, round.players.p1, 1000);
  for (let tick = 0; tick < 300; tick += 1) stepDeadShiftWorld(round, 1 / 60, { spawnEnemies: false });
  assert.equal(round.players.p1.respawnId, 1);
  const pose = sampleResetBoundary(previous, round, extractDeadShiftPositions, extractDeadShiftContinuityKeys);
  assert.equal(pose.p1x, round.players.p1.x);
  assert.equal(pose.p1respawnId, 1);
  assert.equal(createDeadShiftPresentedPlayer(round.players.p1, { p1x: -10, p1respawnId: 0 }, "p1").x, round.players.p1.x);
});

test("Dead Shift recycled projectile/enemy slots keep integer identities and snap to the new actor", () => {
  const previous = createDeadShiftRound();
  previous.roundId = 1;
  Object.assign(previous.enemies[0], { id: 3, x: -12 });
  Object.assign(previous.projectiles[0], { id: 4, x: -10 });
  const current = structuredClone(previous);
  Object.assign(current.enemies[0], { id: 5, x: 12 });
  Object.assign(current.projectiles[0], { id: 6, x: 10 });
  const pose = sampleResetBoundary(previous, current, extractDeadShiftPositions, extractDeadShiftContinuityKeys);
  assert.equal(pose.e0id, 5);
  assert.equal(pose.e0x, 12);
  assert.equal(pose.r0id, 6);
  assert.equal(pose.r0x, 10);
});

test("Sky Dash remote runner respawns skip the gap between checkpoints", () => {
  const previous = createSkyDashRound();
  const current = structuredClone(previous);
  current.players.p2.respawnId += 1;
  current.players.p2.z = -68;
  const pose = sampleResetBoundary(previous, current, extractSkyDashPositions, extractSkyDashContinuityKeys);
  assert.equal(pose["p2.respawnId"], current.players.p2.respawnId);
  assert.equal(pose["p2.z"], -68);
});

test("Riftball new serves keep both player and ball reset identities discrete", () => {
  const previous = createRiftballRound();
  const current = structuredClone(previous);
  current.ball.serveId += 1;
  current.ball.x = 4;
  current.players.p2.x = -2;
  const pose = sampleResetBoundary(previous, current, extractRiftballPositions, extractRiftballContinuityKeys);
  assert.equal(pose["ball.serveId"], current.ball.serveId);
  assert.equal(pose["ball.x"], 4);
  assert.equal(pose["p2.x"], -2);
});

test("Pong ball serves snap independently of continuing paddle interpolation", () => {
  const previous = { players: { p1: { y: 300, inputEpoch: 1 }, p2: { y: 400, inputEpoch: 1 } }, ball: { x: 1290, y: 200, serveId: 0 } };
  const current = { players: { p1: { y: 320, inputEpoch: 1 }, p2: { y: 380, inputEpoch: 1 } }, ball: { x: 640, y: 360, serveId: 1 } };
  const pose = sampleResetBoundary(previous, current, extractPongPositions, extractPongContinuityKeys);
  assert.equal(pose.ballx, 640);
  assert.equal(pose.bally, 360);
  assert.equal(pose.serveId, 1);
  assert.equal(pose.p1y, 310);
});
