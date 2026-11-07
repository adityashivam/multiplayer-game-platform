import test from "node:test";
import assert from "node:assert/strict";
import {
  FIGHT_FIXED_DT_SEC,
  FIGHT_INPUT_TEMPLATE,
  createFightPlayerState,
  resolveFightExchange,
  resolveFightSeparation,
  stepFightPlayer,
} from "../public/games/fight/shared/simulation.js";

/** Step both fighters from the same facing phase, then resolve contact. */
function stepFightPair(players, inputs) {
  const opponents = players.map(({ x, y }) => ({ x, y }));
  for (let index = 0; index < players.length; index++) {
    stepFightPlayer(players[index], { ...FIGHT_INPUT_TEMPLATE, ...inputs[index] }, FIGHT_FIXED_DT_SEC, {
      active: true, opponent: opponents[1 - index],
    });
  }
  resolveFightSeparation(...players);
}

for (const atRightWall of [false, true]) {
  test(`Fight keeps full body spacing under continuous pressure at the ${atRightWall ? "right" : "left"} wall`, () => {
    const players = atRightWall
      ? [createFightPlayerState(1060, 1), createFightPlayerState(1180, -1)]
      : [createFightPlayerState(100, 1), createFightPlayerState(220, -1)];
    const movingPlayer = atRightWall ? 0 : 1;
    const movement = atRightWall ? { right: true } : { left: true };

    for (let tick = 0; tick < 180; tick++) {
      const inputs = [{}, {}];
      inputs[movingPlayer] = movement;
      stepFightPair(players, inputs);
      assert.ok(players[1].x - players[0].x >= 120 - 1e-8, `penetration at tick ${tick}`);
      assert.ok(players.every(({ x }) => x >= 100 && x <= 1180));
    }
  });

  for (const sliding of [false, true]) {
    test(`Fight ${sliding ? "slide" : "dodge"} cannot penetrate a fighter pinned to the ${atRightWall ? "right" : "left"} wall`, () => {
      const players = atRightWall
        ? [createFightPlayerState(1060, 1), createFightPlayerState(1180, -1)]
        : [createFightPlayerState(100, 1), createFightPlayerState(220, -1)];
      const movingPlayer = atRightWall ? 0 : 1;

      for (let tick = 0; tick < 50; tick++) {
        const inputs = [{}, {}];
        inputs[movingPlayer] = { dash: tick === 0, crouch: sliding };
        stepFightPair(players, inputs);
        assert.ok(players[1].x - players[0].x >= 120 - 1e-8, `penetration at tick ${tick}`);
      }
      assert.equal(players[movingPlayer].dashType, null);
      assert.equal(players[movingPlayer].dashTimer, 0);
    });
  }
}

test("Fight locks attack facing while movement inputs reverse during a swing", () => {
  const attacker = createFightPlayerState(600, 1);
  const opponent = { x: 900, y: 870 };
  stepFightPlayer(attacker, { ...FIGHT_INPUT_TEMPLATE, heavyAttack: true }, FIGHT_FIXED_DT_SEC, { active: true, opponent });

  for (let tick = 0; tick < 20; tick++) {
    stepFightPlayer(attacker, { ...FIGHT_INPUT_TEMPLATE, left: tick % 2 === 0, right: tick % 2 === 1 }, FIGHT_FIXED_DT_SEC, { active: true, opponent });
    assert.equal(attacker.attacking, true);
    assert.equal(attacker.dir, 1, "a swing cannot flip its sword and hit direction mid-animation");
  }
});

test("Fight keeps backward dodge facing and travel direction independent of changed directional input", () => {
  const player = createFightPlayerState(600, 1);
  const opponent = { x: 900, y: 870 };

  for (let tick = 0; tick < 8; tick++) {
    const previousX = player.x;
    stepFightPlayer(player, { ...FIGHT_INPUT_TEMPLATE, block: true, dash: tick === 0, left: tick % 2 === 0, right: tick % 2 === 1 }, FIGHT_FIXED_DT_SEC, { active: true, opponent });
    assert.equal(player.dashType, "dodge");
    assert.equal(player.dir, 1, "the roll should keep facing the opponent");
    assert.equal(player.dashDir, -1);
    assert.ok(player.x < previousX, "changed input must not reverse an ongoing roll");
  }
});

test("a backward dodge immediately after a jump crossover travels away from the current opponent", () => {
  const player = createFightPlayerState(615, 1);
  player.y = 600;
  const opponent = { x: 620, y: 870 };
  stepFightPlayer(player, { ...FIGHT_INPUT_TEMPLATE, right: true }, FIGHT_FIXED_DT_SEC, { active: true, opponent });
  assert.ok(player.x > opponent.x);
  const previousX = player.x;
  stepFightPlayer(player, { ...FIGHT_INPUT_TEMPLATE, block: true, dash: true }, FIGHT_FIXED_DT_SEC, { active: true, opponent });
  assert.equal(player.dir, -1);
  assert.equal(player.dashDir, 1);
  assert.ok(player.x > previousX, "a new back dodge must use current positions, not the previous crossing frame's facing");
});

test("a full jump stays within the measured stage headroom and lands cleanly", () => {
  const player = createFightPlayerState(300, 1);
  let maximumAscent = 0;
  for (let tick = 0; tick < 150; tick++) {
    stepFightPlayer(player, { ...FIGHT_INPUT_TEMPLATE, jump: tick === 0 }, FIGHT_FIXED_DT_SEC, { active: true });
    maximumAscent = Math.max(maximumAscent, 870 - player.y);
  }
  // The visible floor is ~580px and the tallest tucked jump artwork is ~240px.
  // Limit ascent to225px to retain stage headroom above the complete silhouette.
  assert.ok(maximumAscent <= 225, `jump leaves the stage headroom: ${maximumAscent}px`);
  assert.ok(maximumAscent > 150, "the arc must still clear another fighter's contact region");
  assert.equal(player.y, 870);
  assert.equal(player.vy, 0);
});

test("Fight allows a clear jump-over and reestablishes body spacing when the fighters land", () => {
  const players = [createFightPlayerState(500, 1), createFightPlayerState(650, -1)];
  let crossedAboveOpponent = false;
  for (let tick = 0; tick < 150; tick++) {
    stepFightPair(players, [{ right: tick < 55, jump: tick === 0 }, {}]);
    if (players[0].x > players[1].x && players[1].y - players[0].y > 100) crossedAboveOpponent = true;
    if (Math.abs(players[0].y - players[1].y) < 100) {
      assert.ok(Math.abs(players[1].x - players[0].x) >= 120 - 1e-8);
    }
  }
  assert.equal(crossedAboveOpponent, true);
  assert.equal(players[0].y, 870);
  assert.equal(players[1].y, 870);
  assert.equal(players[0].dir, -1);
  assert.equal(players[1].dir, 1);
});

test("same-X landings resolve full contact at either arena wall in one step", () => {
  for (const wallX of [100, 1180]) {
    for (const airborneIndex of [0, 1]) {
      const players = [createFightPlayerState(wallX, 1), createFightPlayerState(wallX, -1)];
      players[airborneIndex].y = 775;
      players[airborneIndex].vy = 600;
      stepFightPair(players, [{}, {}]);
      assert.equal(Math.abs(players[0].x - players[1].x), 120);
      assert.ok(players.every(({ x }) => x >= 100 && x <= 1180));
    }
  }
});

test("seeded mixed fights preserve contact, combat resources and one impact per swing", (testContext) => {
  let randomState = 0x51a7c0de;
  const readRandomFraction = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 0x100000000;
  };
  let impactCount = 0;
  let completedDuels = 0;

  for (let duel = 0; duel < 64; duel++) {
    const leftX = duel % 3 === 0 ? 100 : duel % 3 === 1 ? 1010 : 500;
    const players = [createFightPlayerState(leftX, 1), createFightPlayerState(leftX + 170, -1)];
    const resolvedSwings = new Set();
    for (let tick = 0; tick < 1800; tick++) {
      const inputs = players.map((player, index) => {
        const towardRight = player.x < players[1 - index].x;
        const advance = readRandomFraction() < .7;
        return {
          left: !towardRight && advance, right: towardRight && advance,
          jump: readRandomFraction() < .015, crouch: readRandomFraction() < .08,
          attack: readRandomFraction() < .06, heavyAttack: readRandomFraction() < .04,
          aerialAttack: readRandomFraction() < .025, block: readRandomFraction() < .08,
          dash: readRandomFraction() < .025, specialAttack: readRandomFraction() < .02,
        };
      });
      const previousHealth = players.map(({ health }) => health);
      stepFightPair(players, inputs);
      const impacts = resolveFightExchange(...players);

      for (let index = 0; index < players.length; index++) {
        const player = players[index];
        assert.ok(Number.isFinite(player.x) && Number.isFinite(player.y));
        assert.ok(player.x >= 100 && player.x <= 1180);
        assert.ok(player.y <= 870);
        assert.ok(player.health >= 0 && player.health <= previousHealth[index]);
        assert.equal(player.dead, player.health === 0);
        assert.ok(player.guardMeter >= 0 && player.guardMeter <= 100);
        assert.ok(player.specialMeter >= 0 && player.specialMeter <= 100);
        assert.ok(player.dashTimer >= 0 && player.attackTimer >= 0);
        if (impacts[index === 0 ? "p1" : "p2"]) {
          const swingIdentity = `${index}:${player.attackId}`;
          assert.ok(!resolvedSwings.has(swingIdentity), "one swing cannot hit repeatedly");
          resolvedSwings.add(swingIdentity);
          impactCount++;
        }
      }
      if (Math.abs(players[0].y - players[1].y) < 100) {
        assert.ok(Math.abs(players[0].x - players[1].x) >= 120 - 1e-8);
      }
      if (players.some(({ dead }) => dead)) {
        completedDuels++;
        break;
      }
    }
  }
  assert.ok(impactCount > 500, "the soak must exercise real combat outcomes");
  assert.ok(completedDuels > 30, `the soak must include completed duels; got ${completedDuels}`);
  testContext.diagnostic(`${completedDuels}/64 duels completed, ${impactCount} combat impacts checked`);
});
