import test from "node:test";
import assert from "node:assert/strict";
import {
  BUMPER_LINKS_FALLBACK_HOLES,
  generateSolvableBumperLinksHole,
  planBumperLinksShot,
  solveBumperLinksHole,
} from "../public/games/bumper-links/shared/solver.js";
import { createBumperLinksBotBrain, decideBumperLinksBotShot } from "../public/games/bumper-links/shared/bot.js";
import { createBumperLinksCourse } from "../public/games/bumper-links/shared/course.js";
import { createBumperLinksMatch, getBumperLinksHoleSeed, requestBumperLinksShot, stepBumperLinksWorld } from "../public/games/bumper-links/shared/match.js";
import { BUMPER_LINKS_BOT_SETTINGS, BUMPER_LINKS_MATCH_SETTINGS } from "../public/games/bumper-links/shared/config.js";

const DT = 1 / 60;

test("every generated hole is solvable with par 2 to 5", () => {
  for (let firstSeed = 1; firstSeed <= 20; firstSeed += 1) {
    const hole = generateSolvableBumperLinksHole(firstSeed);
    assert.ok(hole.par >= 2 && hole.par <= 5, `seed ${firstSeed} par ${hole.par}`);
    assert.deepEqual(solveBumperLinksHole(hole.seed), hole);
  }
});

test("a planned tee shot heads down the course", () => {
  const course = createBumperLinksCourse(5);
  const plan = planBumperLinksShot(course, course.tee);
  assert.ok(plan.power > 0 && plan.power <= 1);
  assert.ok(plan.score < Infinity);
});

test("generating a hole stays within its time budget even for slow or unsolvable seeds", () => {
  const durationsMs = [];
  for (let match = 0; match < 40; match += 1) {
    for (let hole = 0; hole < 6; hole += 1) {
      const startedAt = performance.now();
      const generated = generateSolvableBumperLinksHole(getBumperLinksHoleSeed(match * 7919 + 13, hole));
      durationsMs.push(performance.now() - startedAt);
      assert.ok(generated.par >= 2 && generated.par <= 5);
    }
  }
  durationsMs.sort((first, second) => first - second);
  const p99 = durationsMs[Math.floor(durationsMs.length * 0.99)];
  assert.ok(p99 < 60, `p99 ${p99.toFixed(1)} ms, max ${durationsMs.at(-1).toFixed(1)} ms`);
});

test("every fallback hole is proven playable with its stored par", () => {
  for (const hole of BUMPER_LINKS_FALLBACK_HOLES) {
    assert.deepEqual(solveBumperLinksHole(hole.seed), hole);
  }
});

test("an exhausted budget falls back to a proven hole", () => {
  const hole = generateSolvableBumperLinksHole(123, { budgetMs: 0 });
  assert.ok(BUMPER_LINKS_FALLBACK_HOLES.some((fallback) => fallback.seed === hole.seed && fallback.par === hole.par));
});

test("a bot never shoots before its reaction delay and plans across ticks", () => {
  const match = createBumperLinksMatch({ playerIds: [], botIds: ["bot1"], resolveHole: generateSolvableBumperLinksHole });
  match.started = true;
  match.phase = "playing";
  const bot = match.bots[0];
  const brain = createBumperLinksBotBrain(3);
  for (let step = 0; step < Math.floor(BUMPER_LINKS_BOT_SETTINGS.minReactionSec / DT) - 1; step += 1) {
    assert.equal(decideBumperLinksBotShot(bot, brain, match, DT), null);
    assert.ok(brain.candidatesEvaluatedLastCall <= BUMPER_LINKS_BOT_SETTINGS.candidatesPerTick);
  }
  let shot = null;
  for (let step = 0; step < 200 && !shot; step += 1) shot = decideBumperLinksBotShot(bot, brain, match, DT);
  assert.ok(shot && shot.power > 0);
});

test("bots finish a practice hole within the time limit", () => {
  const match = createBumperLinksMatch({ playerIds: [], botIds: ["bot1", "bot2", "bot3"], matchSeed: 42, resolveHole: generateSolvableBumperLinksHole });
  match.started = true;
  match.phase = "playing";
  const brains = match.bots.map((_bot, index) => createBumperLinksBotBrain(index + 1));
  for (let step = 0; step < BUMPER_LINKS_MATCH_SETTINGS.holeTimeSec / DT && match.phase === "playing"; step += 1) {
    match.bots.forEach((bot, index) => {
      const shot = decideBumperLinksBotShot(bot, brains[index], match, DT);
      if (shot) requestBumperLinksShot(match, bot.id, shot.aimYaw, shot.power);
    });
    stepBumperLinksWorld(match, DT, { resolveHole: generateSolvableBumperLinksHole });
  }
  assert.ok(match.bots.filter((bot) => bot.sunk).length >= 2, `sunk ${match.bots.filter((bot) => bot.sunk).length}`);
});
