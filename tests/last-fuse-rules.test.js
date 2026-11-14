import test from "node:test";
import assert from "node:assert/strict";
import { LAST_FUSE_BOMB_SETTINGS, LAST_FUSE_CITY, LAST_FUSE_INPUT_TEMPLATE, LAST_FUSE_MATCH_SETTINGS } from "../public/games/last-fuse/shared/config.js";
import { findLastFuseRoofAt, getLastFuseCityLayout, getLastFusePlatforms } from "../public/games/last-fuse/shared/city.js";
import { placeLastFuseRunner, stepLastFuseRunner } from "../public/games/last-fuse/shared/runner.js";
import {
  createLastFuseMatch,
  getLastFuseMatchPlatforms,
  listLastFuseRunners,
  recordLastFusePoses,
  stepLastFuseWorld,
} from "../public/games/last-fuse/shared/match.js";
import { createLastFuseBotBrain, decideLastFuseBotInput } from "../public/games/last-fuse/shared/bot.js";

const DT_SEC = 1 / 60;
const input = (overrides = {}) => ({ ...LAST_FUSE_INPUT_TEMPLATE, ...overrides });

/** A started match with the bomb already on `p1`. */
function createArmedMatch(botIds = ["b1", "b2"]) {
  const match = createLastFuseMatch({ playerIds: ["p1"], botIds });
  match.started = true;
  match.phase = "playing";
  Object.assign(match.bomb, { holderId: "p1", fuseSec: 10, fuseTotalSec: 10, armSec: 0 });
  return match;
}

/** Stand a runner on a roof at an offset from its centre. */
function standOn(runner, roof, offsetX = 0, offsetZ = 0) {
  placeLastFuseRunner(runner, roof);
  runner.x += offsetX;
  runner.z += offsetZ;
}

test("city layouts are deterministic, connected by jumpable gaps, and spawn runners apart", () => {
  for (let seed = 1; seed <= 60; seed += 1) {
    const layout = getLastFuseCityLayout(seed);
    assert.equal(layout, getLastFuseCityLayout(seed));
    const visited = new Set([1]);
    const queue = [1];
    while (queue.length) {
      for (const neighborId of layout.roofs[queue.shift() - 1].neighborIds) {
        if (!visited.has(neighborId)) {
          visited.add(neighborId);
          queue.push(neighborId);
        }
      }
    }
    assert.equal(visited.size, layout.roofs.length, `seed ${seed} is connected`);
    assert.equal(new Set(layout.spawnRoofIds).size, layout.spawnRoofIds.length);
  }
  assert.notDeepEqual(getLastFuseCityLayout(1).roofs.map((roof) => roof.x), getLastFuseCityLayout(2).roofs.map((roof) => roof.x));
});

test("a running jump clears the gap to a neighbouring roof", () => {
  const layout = getLastFuseCityLayout(7);
  const from = layout.roofs.find((roof) => roof.neighborIds.some((id) => layout.roofs[id - 1].column === roof.column + 1));
  const to = layout.roofs[from.neighborIds.find((id) => layout.roofs[id - 1].column === from.column + 1) - 1];
  const match = createLastFuseMatch({ playerIds: ["p1", "p2"], matchId: 1 });
  const runner = match.players.p1;
  standOn(runner, from, -from.width / 2 + 0.6, (to.z - from.z) / 2);
  const platforms = getLastFusePlatforms(7, 0);
  let landedOn = 0;
  for (let tick = 0; tick < 240 && landedOn !== to.id; tick += 1) {
    const ahead = findLastFuseRoofAt(layout, 0, runner.x + 0.7, runner.z);
    const jump = runner.grounded && runner.supportId === from.id && (!ahead || ahead.id !== from.id);
    stepLastFuseRunner(runner, input({ moveX: 1, jump }), DT_SEC, { active: true, platforms, holder: false });
    if (runner.grounded) landedOn = runner.supportId;
    assert.ok(runner.y > LAST_FUSE_CITY.fallY, "the runner never drops to the street");
  }
  assert.equal(landedOn, to.id);
});

test("touching a runner passes the bomb, burns fuse, staggers the receiver and blocks a tag-back", () => {
  const match = createArmedMatch();
  const [holder, target] = [match.players.p1, match.bots[0]];
  const roof = getLastFuseCityLayout(match.city.seed).roofs[12];
  standOn(holder, roof);
  standOn(target, roof, 0.9, 0);
  stepLastFuseWorld(match, DT_SEC);
  assert.equal(match.bomb.holderId, target.id);
  assert.ok(match.bomb.fuseSec < 10 - LAST_FUSE_BOMB_SETTINGS.passBurnSec + 0.01);
  assert.ok(target.staggerSec > 0);
  assert.equal(holder.passes, 1);

  target.staggerSec = 0;
  stepLastFuseWorld(match, DT_SEC);
  assert.equal(match.bomb.holderId, target.id, "no instant tag-back");
  for (let tick = 0; tick < 70; tick += 1) stepLastFuseWorld(match, DT_SEC);
  assert.equal(match.bomb.holderId, holder.id, "after the immunity the bomb can come back");
});

test("passes use where the holder saw the target: rewound contact counts, a stale aim without lag does not", () => {
  function tryLatePass(viewLagTicks) {
    const match = createArmedMatch(["b1"]);
    const [holder, target] = [match.players.p1, match.bots[0]];
    const roof = getLastFuseCityLayout(match.city.seed).roofs[12];
    standOn(holder, roof, -1.5, 0);
    standOn(target, roof, -0.8, 0);
    const runners = listLastFuseRunners(match);
    recordLastFusePoses(match, runners);
    for (let tick = 0; tick < 8; tick += 1) {
      target.x += 0.25;
      recordLastFusePoses(match, runners);
    }
    holder.viewLagTicks = viewLagTicks;
    stepLastFuseWorld(match, DT_SEC);
    return match.bomb.holderId;
  }
  assert.equal(tryLatePass(9), "b1");
  assert.equal(tryLatePass(0), "p1");
});

test("when the fuse ends the holder is out, survivors score, neighbours are thrown and a roof crumbles", () => {
  const match = createArmedMatch(["b1", "b2"]);
  const layout = getLastFuseCityLayout(match.city.seed);
  const roof = layout.roofs[12];
  const [holder, near, far] = [match.players.p1, match.bots[0], match.bots[1]];
  standOn(holder, roof);
  standOn(near, roof, 2.5, 0);
  standOn(far, layout.roofs[0]);
  match.bomb.fuseSec = DT_SEC / 2;
  match.bomb.tagBackSec = 99;
  match.bomb.lastPasserId = "b1";
  stepLastFuseWorld(match, DT_SEC);

  assert.equal(holder.eliminated, true);
  assert.equal(match.bomb.blastSerial, 1);
  assert.equal(near.points, LAST_FUSE_MATCH_SETTINGS.survivePoints);
  assert.equal(far.points, LAST_FUSE_MATCH_SETTINGS.survivePoints);
  assert.ok(near.vx > 0 && near.vy > 0 && near.stunSec > 0, "the blast throws nearby runners");
  assert.equal(match.city.crumblingRoofId, roof.id);

  standOn(far, roof, -2, 0);
  for (let tick = 0; tick < 60 * 3; tick += 1) {
    for (const runner of [near, far]) stepLastFuseRunner(runner, input(), DT_SEC, { active: true, platforms: getLastFuseMatchPlatforms(match), holder: false });
    stepLastFuseWorld(match, DT_SEC);
  }
  assert.equal(match.city.collapseSerial, 1);
  assert.ok(far.respawnId > 2, "a runner on the fallen roof drops and respawns");
  assert.notEqual(findLastFuseRoofAt(layout, match.city.collapsedMask, far.x, far.z)?.id, roof.id);
  assert.ok(match.bomb.holderId, "the next bomb arms after the delay");
});

test("the last runner standing scores the bonus; three rounds end the match on points", () => {
  const match = createArmedMatch(["b1"]);
  match.players.p1.points = 4;
  match.bomb.holderId = "b1";
  match.bomb.fuseSec = DT_SEC / 2;
  const firstSeed = match.city.seed;
  stepLastFuseWorld(match, DT_SEC);
  assert.equal(match.roundWinnerId, "p1");
  assert.equal(match.players.p1.points, 4 + LAST_FUSE_MATCH_SETTINGS.survivePoints + LAST_FUSE_MATCH_SETTINGS.lastStandingPoints);
  assert.equal(match.phase, "roundOver");
  for (let tick = 0; tick < 60 * 4; tick += 1) stepLastFuseWorld(match, DT_SEC);
  assert.equal(match.roundNumber, 2);
  assert.notEqual(match.city.seed, firstSeed, "each round builds a new city");
  assert.equal(match.bots[0].eliminated, false);

  match.roundNumber = match.rounds;
  Object.assign(match.bomb, { holderId: "p1", fuseSec: DT_SEC / 2 });
  match.bots[0].points = 0;
  stepLastFuseWorld(match, DT_SEC);
  assert.equal(match.gameOver, true);
  assert.equal(match.winner, "p1", "points decide the match, not the last round");
});

test("bot-only matches are deterministic, pass the bomb and finish", () => {
  function runBots(matchId) {
    const match = createLastFuseMatch({ playerIds: [], botIds: ["b1", "b2", "b3", "b4", "b5", "b6"], matchId });
    match.started = true;
    match.phase = "playing";
    const brains = match.bots.map((_bot, index) => createLastFuseBotBrain(matchId * 31 + index));
    const runners = [];
    for (let tick = 0; tick < 60 * 400 && !match.gameOver; tick += 1) {
      listLastFuseRunners(match, runners);
      const platforms = getLastFuseMatchPlatforms(match);
      match.bots.forEach((bot, index) => {
        const control = decideLastFuseBotInput(bot, brains[index], match, runners, DT_SEC);
        stepLastFuseRunner(bot, control, DT_SEC, { active: true, platforms, holder: match.bomb.holderId === bot.id });
      });
      stepLastFuseWorld(match, DT_SEC);
    }
    return match;
  }
  const first = runBots(4);
  const second = runBots(4);
  assert.equal(first.gameOver, true);
  assert.equal(first.winner, second.winner);
  assert.deepEqual(first.bots.map((bot) => bot.points), second.bots.map((bot) => bot.points));
  assert.ok(first.bomb.passSerial > first.rounds * 5, `bots pass the bomb (${first.bomb.passSerial})`);
});
