import test from "node:test";
import assert from "node:assert/strict";
import {
  createBumperLinksBall,
  resolveBumperLinksBallContacts,
  shootBumperLinksBall,
  stepBumperLinksBall,
} from "../public/games/bumper-links/shared/ball.js";
import {
  createBumperLinksMatch,
  listBumperLinksBalls,
  rankBumperLinksBalls,
  requestBumperLinksShot,
  stepBumperLinksWorld,
} from "../public/games/bumper-links/shared/match.js";
import { BUMPER_LINKS_BALL_SETTINGS, BUMPER_LINKS_MATCH_SETTINGS } from "../public/games/bumper-links/shared/config.js";

const DT = 1 / 60;
const RADIUS = BUMPER_LINKS_BALL_SETTINGS.radius;

/**
 * A 20 m flat green from z=-2 to z=18, railed on three sides and open on
 * the +X edge so balls can be knocked into the water. The cup is far away.
 */
function createFlatTestCourse({ openEast = true } = {}) {
  const solids = [
    { minX: -2, maxX: 2, minY: -1, maxY: 0, minZ: -2, maxZ: 18 },
    { minX: -2, maxX: -1.8, minY: 0, maxY: 0.35, minZ: -2, maxZ: 18 },
    { minX: -2, maxX: 2, minY: 0, maxY: 0.35, minZ: -2, maxZ: -1.8 },
    { minX: -2, maxX: 2, minY: 0, maxY: 0.35, minZ: 17.8, maxZ: 18 },
  ];
  if (!openEast) solids.push({ minX: 1.8, maxX: 2, minY: 0, maxY: 0.35, minZ: -2, maxZ: 18 });
  return {
    seed: 0,
    tiles: [],
    solids,
    tee: { x: 0, y: RADIUS, z: 0 },
    teeYaw: 0,
    cup: { x: 0, y: 0, z: 16 },
    sweepers: [],
    path: [{ x: 0, z: 0 }, { x: 0, z: 16 }],
    bounds: { minX: -2, maxX: 2, minZ: -2, maxZ: 18 },
    waterY: -1.6,
  };
}

function createRestingBall(id, x, z, slotIndex = 0) {
  return createBumperLinksBall(id, slotIndex, { x, y: RADIUS, z }, { human: false });
}

function stepUntilRest(ball, course, maxSteps = 900) {
  for (let step = 0; step < maxSteps && !ball.atRest; step += 1) stepBumperLinksBall(ball, DT, course, step * DT);
}

/** A playing match on the flat course with every ball placed by hand. */
function createPlayingFlatMatch(options = {}) {
  const match = createBumperLinksMatch({ playerIds: ["p1", "p2"], botIds: ["bot1", "bot2"], ...options });
  match.course = createFlatTestCourse(options);
  match.started = true;
  match.phase = "playing";
  const balls = listBumperLinksBalls(match, []);
  balls.forEach((ball, index) => {
    ball.connected = true;
    Object.assign(ball, { x: -1.2 + index * 0.8, y: RADIUS, z: 0, restX: -1.2 + index * 0.8, restY: RADIUS, restZ: 0 });
  });
  return match;
}

test("a shot moves a resting ball and costs one stroke; a second shot while rolling is ignored", () => {
  const course = createFlatTestCourse();
  const ball = createRestingBall("bot1", 0, 0);
  assert.equal(shootBumperLinksBall(ball, 0, 0.5), true);
  assert.equal(ball.strokes, 1);
  stepBumperLinksBall(ball, DT, course, 0);
  assert.ok(ball.z > 0);
  assert.equal(shootBumperLinksBall(ball, Math.PI, 1), false);
  assert.equal(ball.strokes, 1);
  assert.equal(shootBumperLinksBall(createRestingBall("bot2", 0, 0), 0, 0), false);
});

test("shots outside the playing phase are ignored", () => {
  const match = createPlayingFlatMatch();
  match.phase = "holeOver";
  assert.equal(requestBumperLinksShot(match, "p1", 0, 0.6), false);
  assert.equal(match.players.p1.strokes, 0);
  match.phase = "playing";
  assert.equal(requestBumperLinksShot(match, "p1", 0, 0.6), true);
  assert.equal(requestBumperLinksShot(match, "nobody", 0, 0.6), false);
});

test("a rolling ball comes to rest and records its rest point", () => {
  const course = createFlatTestCourse();
  const ball = createRestingBall("bot1", 0, 0);
  shootBumperLinksBall(ball, 0, 0.3);
  stepUntilRest(ball, course);
  assert.equal(ball.atRest, true);
  assert.ok(ball.z > 1);
  assert.deepEqual([ball.restX, ball.restY, ball.restZ], [ball.x, ball.y, ball.z]);
  assert.ok(Math.abs(ball.y - RADIUS) < 0.03);
});

test("a ball stopped against a rail can be shot again", () => {
  const course = createFlatTestCourse();
  const ball = createRestingBall("bot1", 0, 14);
  shootBumperLinksBall(ball, 0, 0.6);
  stepUntilRest(ball, course);
  assert.equal(ball.atRest, true);
  assert.equal(shootBumperLinksBall(ball, Math.PI, 0.4), true);
});

test("overlapping balls separate without launching either", () => {
  const ballA = createRestingBall("bot1", 0, 0);
  const ballB = createRestingBall("bot2", 0.3, 0, 1);
  resolveBumperLinksBallContacts([ballA, ballB]);
  assert.ok(Math.hypot(ballB.x - ballA.x, ballB.z - ballA.z) >= 2 * RADIUS - 1e-9);
  for (const ball of [ballA, ballB]) {
    assert.ok(Math.hypot(ball.vx, ball.vy, ball.vz) < 0.01);
    assert.equal(ball.atRest, true);
  }
});

test("a moving ball knocks a resting ball and the struck ball records its striker", () => {
  const striker = createRestingBall("bot1", 0, 0);
  const struck = createRestingBall("bot2", 0, 0.42, 1);
  striker.vz = 6;
  striker.atRest = false;
  const momentumBefore = striker.vz + struck.vz;
  resolveBumperLinksBallContacts([striker, struck]);
  assert.ok(Math.abs(striker.vz + struck.vz - momentumBefore) < 1e-9);
  assert.ok(struck.vz > striker.vz);
  assert.equal(struck.lastHitById, "bot1");
  assert.equal(striker.lastHitById, null);
  assert.equal(struck.atRest, false);
});

test("a slow ball over the cup sinks and scores by order; a fast ball does not", () => {
  const match = createPlayingFlatMatch();
  const [first, second, fast] = [match.players.p1, match.players.p2, match.bots[0]];
  Object.assign(first, { x: 0, z: 15.9, vz: 1, atRest: false });
  stepBumperLinksWorld(match, DT);
  assert.equal(first.sunk, true);
  assert.equal(first.holePoints, 5);
  Object.assign(second, { x: 0.05, z: 16.1, vz: -0.5, atRest: false });
  stepBumperLinksWorld(match, DT);
  assert.equal(second.holePoints, 3);
  Object.assign(fast, { x: 0, z: 15.7, vz: 9, atRest: false });
  stepBumperLinksWorld(match, DT);
  assert.equal(fast.sunk, false);
});

test("a ball knocked into the water returns to its rest point with a penalty and credits the striker", () => {
  const match = createPlayingFlatMatch();
  const striker = match.players.p1;
  const victim = match.players.p2;
  Object.assign(victim, { x: 1.2, z: 5, restX: 0, restZ: 10 });
  Object.assign(striker, { x: 0.6, z: 5, vx: 7, atRest: false });
  const victimLife = victim.lifeId;
  for (let step = 0; step < 240 && victim.lifeId === victimLife; step += 1) stepBumperLinksWorld(match, DT);
  assert.equal(victim.lifeId, victimLife + 1);
  assert.equal(victim.strokes, 1);
  assert.equal(victim.splashes, 1);
  assert.deepEqual([victim.x, victim.z], [0, 10]);
  assert.equal(striker.knockouts, 1);
  assert.equal(striker.holePoints, BUMPER_LINKS_MATCH_SETTINGS.knockoutPoints);
  const knockout = match.recentEvents.find((event) => event.type === "knockout");
  assert.equal(knockout.ballId, "p2");
  assert.equal(knockout.byId, "p1");
  assert.ok(knockout.x > 1.8, "the splash is placed where the ball left the green");
});

test("the hole ends at the time limit, away balls score zero, and the next hole loads", () => {
  const match = createPlayingFlatMatch();
  match.players.p2.connected = false;
  match.players.p1.holePoints = 5;
  match.players.p1.sunk = true;
  match.holeTimeSec = BUMPER_LINKS_MATCH_SETTINGS.holeTimeSec - DT / 2;
  stepBumperLinksWorld(match, DT);
  assert.equal(match.phase, "holeOver");
  assert.equal(match.players.p1.points, 5);
  assert.equal(match.players.p2.points, 0);
  const holeSerial = match.holeSerial;
  for (let step = 0; step < Math.ceil(BUMPER_LINKS_MATCH_SETTINGS.holeResetSec / DT) + 1; step += 1) stepBumperLinksWorld(match, DT);
  assert.equal(match.phase, "playing");
  assert.equal(match.holeIndex, 1);
  assert.equal(match.holeSerial, holeSerial + 1);
  assert.equal(match.players.p1.sunk, false);
  assert.equal(match.players.p1.strokes, 0);
});

test("a hole ends early once every connected ball has sunk", () => {
  const match = createPlayingFlatMatch();
  match.players.p2.connected = false;
  for (const ball of [match.players.p1, ...match.bots]) ball.sunk = true;
  stepBumperLinksWorld(match, DT);
  assert.equal(match.phase, "holeOver");
});

test("six holes then a winner by points", () => {
  const match = createPlayingFlatMatch();
  for (let hole = 0; hole < BUMPER_LINKS_MATCH_SETTINGS.holes; hole += 1) {
    assert.equal(match.holeIndex, hole);
    match.bots[1].holePoints = 2;
    match.holeTimeSec = BUMPER_LINKS_MATCH_SETTINGS.holeTimeSec;
    stepBumperLinksWorld(match, DT);
    assert.equal(match.phase, "holeOver");
    for (let step = 0; step < 200 && match.phase === "holeOver"; step += 1) stepBumperLinksWorld(match, DT);
  }
  assert.equal(match.phase, "finished");
  assert.equal(match.gameOver, true);
  assert.equal(match.winner, "bot2");
  assert.equal(rankBumperLinksBalls(listBumperLinksBalls(match, []))[0].points, 12);
});

test("a ball that putts itself into the water after being bumped is a splash, not a knockout", () => {
  const match = createPlayingFlatMatch();
  const bumper = match.players.p1;
  const ball = match.players.p2;
  Object.assign(ball, { x: 1.2, z: 5, restX: 1.2, restZ: 5, atRest: true });
  ball.lastHitById = bumper.id;
  ball.lastHitAgeSec = 0.4;
  assert.equal(requestBumperLinksShot(match, ball.id, Math.PI / 2, 0.6), true);
  const life = ball.lifeId;
  for (let step = 0; step < 240 && ball.lifeId === life; step += 1) stepBumperLinksWorld(match, DT);
  assert.equal(ball.lifeId, life + 1, "the ball went into the water");
  assert.equal(bumper.knockouts, 0);
  assert.equal(bumper.holePoints, 0);
  assert.equal(match.recentEvents.at(-1).type, "splash");
});
