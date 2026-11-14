import test from "node:test";
import assert from "node:assert/strict";
import { EDGEOUT_ARENA, EDGEOUT_COMBAT_SETTINGS, EDGEOUT_INPUT_TEMPLATE } from "../public/games/edgeout/shared/config.js";
import {
  getEdgeoutArenaHalfExtent,
  getEdgeoutArenaPlatforms,
  getEdgeoutCollapseTimeSec,
  getEdgeoutSafeHalfExtent,
  updateEdgeoutArena,
  createEdgeoutArena,
} from "../public/games/edgeout/shared/arena.js";
import {
  createEdgeoutMatch,
  stepEdgeoutFighter,
  stepEdgeoutWorld,
} from "../public/games/edgeout/shared/simulation.js";

const DT_SEC = 1 / 60;

/** A started duel with both fighters placed by the test. */
function createDuel(placements = {}) {
  const match = createEdgeoutMatch({ playerIds: ["p1", "p2"] });
  Object.assign(match, { started: true, phase: "playing" });
  for (const fighter of Object.values(match.players)) fighter.connected = true;
  Object.assign(match.players.p1, placements.p1);
  Object.assign(match.players.p2, placements.p2);
  return match;
}

/**
 * Step every fighter with its input, then the world, like the server systems.
 * @param {ReturnType<typeof createEdgeoutMatch>} match
 * @param {number} ticks
 * @param {(tick:number)=>Record<string,Partial<typeof EDGEOUT_INPUT_TEMPLATE>>} [inputsForTick]
 */
function advance(match, ticks, inputsForTick = () => ({})) {
  for (let tick = 0; tick < ticks; tick += 1) {
    const inputs = inputsForTick(tick);
    for (const fighter of [...Object.values(match.players), ...match.bots]) {
      stepEdgeoutFighter(fighter, { ...EDGEOUT_INPUT_TEMPLATE, ...inputs[fighter.id] }, DT_SEC, {
        active: match.phase === "playing",
        intactRings: match.arena.intactRings,
      });
    }
    stepEdgeoutWorld(match, DT_SEC);
  }
}

/** Facing -Z, as p1 does from its spawn. */
const FACING_NEGATIVE_Z = Math.PI;

test("a quick shove launches a rival in front, adds damage and stuns it", () => {
  const match = createDuel({ p1: { x: 0, z: 0.8, facing: FACING_NEGATIVE_Z }, p2: { x: 0, z: -0.4 } });
  advance(match, 40, (tick) => ({ p1: { shove: tick === 0 } }));

  const rival = match.players.p2;
  assert.ok(rival.damage >= EDGEOUT_COMBAT_SETTINGS.quickShoveDamage && rival.damage < EDGEOUT_COMBAT_SETTINGS.quickShoveDamage + 1, `a tap deals quick-shove damage, got ${rival.damage}`);
  assert.equal(rival.lastHitKind, "shove");
  assert.ok(rival.z < -1.2, `rival is pushed away along -Z, got ${rival.z}`);
  assert.equal(rival.hitSerial, 1);
  assert.equal(match.players.p1.damage, 0, "the attacker takes nothing");
});

test("each shove lands once per action and charged shoves travel further", () => {
  const quick = createDuel({ p1: { x: 0, z: 0.8, facing: FACING_NEGATIVE_Z }, p2: { x: 0, z: -0.4 } });
  advance(quick, 90, (tick) => ({ p1: { shove: tick === 0 } }));
  const charged = createDuel({ p1: { x: 0, z: 0.8, facing: FACING_NEGATIVE_Z }, p2: { x: 0, z: -0.4 } });
  advance(charged, 120, (tick) => ({ p1: { shove: tick < 42 } }));

  assert.equal(quick.players.p2.hitSerial, 1, "one action identity hits once");
  assert.equal(charged.players.p2.lastHitKind, "charged");
  assert.ok(charged.players.p2.z < quick.players.p2.z - 1, "a full charge pushes at least a unit further");
});

test("accumulated damage scales knockback from the same shove", () => {
  const fresh = createDuel({ p1: { x: 0, z: 0.8, facing: FACING_NEGATIVE_Z }, p2: { x: 0, z: -0.4 } });
  const battered = createDuel({ p1: { x: 0, z: 0.8, facing: FACING_NEGATIVE_Z }, p2: { x: 0, z: -0.4, damage: 120 } });
  for (const match of [fresh, battered]) advance(match, 90, (tick) => ({ p1: { shove: tick === 0 } }));

  const freshTravel = -0.4 - fresh.players.p2.z;
  const batteredTravel = -0.4 - battered.players.p2.z;
  assert.ok(batteredTravel > freshTravel * 1.8, `120% damage roughly doubles travel: ${freshTravel} vs ${batteredTravel}`);
});

test("a frontal block softens a shove, and a block raised just in time parries it", () => {
  const blocked = createDuel({ p1: { x: 0, z: 0.8, facing: FACING_NEGATIVE_Z }, p2: { x: 0, z: -0.4, facing: 0 } });
  advance(blocked, 30, () => ({ p2: { block: true } }));
  advance(blocked, 60, (tick) => ({ p1: { shove: tick === 0 }, p2: { block: true } }));
  assert.equal(blocked.players.p2.lastHitKind, "blocked");
  assert.equal(blocked.players.p2.stunSec, 0, "a held block keeps its footing");
  assert.ok(blocked.players.p2.z > -1.2, "blocked knockback stays short");

  const parried = createDuel({ p1: { x: 0, z: 0.8, facing: FACING_NEGATIVE_Z }, p2: { x: 0, z: -0.4, facing: 0 } });
  advance(parried, 60, (tick) => ({ p1: { shove: tick === 0 }, p2: { block: tick >= 2 } }));
  assert.equal(parried.players.p2.parrySerial, 1);
  assert.equal(parried.players.p2.damage, 0);
  assert.equal(parried.players.p1.lastHitKind, "parried");
  assert.ok(parried.players.p1.z > 0.8, "the attacker recoils backwards");
});

test("a dash breaks a block, but only blocks from the front protect", () => {
  const match = createDuel({ p1: { x: 0, z: 2.2, facing: FACING_NEGATIVE_Z }, p2: { x: 0, z: 0, facing: 0 } });
  advance(match, 20, () => ({ p2: { block: true } }));
  advance(match, 30, (tick) => ({ p1: { dash: tick === 0, moveZ: -1 }, p2: { block: true } }));
  assert.equal(match.players.p2.lastHitKind, "guardBreak");
  assert.equal(match.players.p2.hitSerial, 1);

  const behind = createDuel({ p1: { x: 0, z: 0.8, facing: FACING_NEGATIVE_Z }, p2: { x: 0, z: -0.4, facing: Math.PI } });
  advance(behind, 20, () => ({ p2: { block: true } }));
  advance(behind, 40, (tick) => ({ p1: { shove: tick === 0 }, p2: { block: true } }));
  assert.equal(behind.players.p2.lastHitKind, "shove", "a block facing away does not cover the back");
});

test("simultaneous shoves trade instead of favouring slot order", () => {
  const match = createDuel({ p1: { x: 0, z: 0.6, facing: FACING_NEGATIVE_Z }, p2: { x: 0, z: -0.6, facing: 0 } });
  advance(match, 30, (tick) => ({ p1: { shove: tick === 0 }, p2: { shove: tick === 0 } }));
  assert.equal(match.players.p1.hitSerial, 1);
  assert.equal(match.players.p2.hitSerial, 1);
  assert.equal(match.players.p1.damage, match.players.p2.damage);
});

test("the arena collapses outside-in on schedule and warns before each ring", () => {
  const arena = createEdgeoutArena();
  const firstCollapseSec = getEdgeoutCollapseTimeSec(1);
  updateEdgeoutArena(arena, firstCollapseSec - EDGEOUT_ARENA.warningSec - 0.01);
  assert.equal(arena.warningRing, -1);
  updateEdgeoutArena(arena, firstCollapseSec - 1);
  assert.equal(arena.warningRing, EDGEOUT_ARENA.rings - 1);
  assert.equal(getEdgeoutSafeHalfExtent(arena), getEdgeoutArenaHalfExtent(EDGEOUT_ARENA.rings - 1));
  assert.equal(updateEdgeoutArena(arena, firstCollapseSec), true);
  assert.equal(arena.intactRings, EDGEOUT_ARENA.rings - 1);
  assert.equal(arena.collapseSerial, 1);
  assert.equal(updateEdgeoutArena(arena, getEdgeoutCollapseTimeSec(EDGEOUT_ARENA.rings)), true);
  assert.equal(arena.intactRings, 0);
  assert.equal(getEdgeoutArenaPlatforms(0).length, 0);
  assert.equal(getEdgeoutArenaPlatforms(3), getEdgeoutArenaPlatforms(3), "platform geometry is cached, not reallocated");
});

test("a collapsing ring drops fighters standing on it and the survivor takes the round", () => {
  const outerTileX = getEdgeoutArenaHalfExtent(EDGEOUT_ARENA.rings) - 0.6;
  const match = createDuel({ p1: { x: 0, z: 0 }, p2: { x: outerTileX, z: 0 } });
  match.roundTimeSec = getEdgeoutCollapseTimeSec(1) - DT_SEC / 2;
  advance(match, 90);

  assert.equal(match.players.p2.eliminated, true);
  assert.equal(match.ringOutSerial, 1);
  assert.equal(match.lastRingOutId, "p2");
  assert.equal(match.phase, "roundOver");
  assert.equal(match.roundWinnerId, "p1");
  assert.equal(match.players.p1.roundWins, 1);
});

test("rounds reset positions and damage, keep wins, and the third win ends the match", () => {
  const outerTileX = getEdgeoutArenaHalfExtent(EDGEOUT_ARENA.rings) - 0.6;
  const match = createDuel({ p1: { x: 0, z: 0 }, p2: { x: outerTileX, z: 0 } });
  for (let round = 1; round <= 3; round += 1) {
    Object.assign(match.players.p2, { x: outerTileX, z: 0 });
    match.players.p1.damage = 40;
    match.roundTimeSec = getEdgeoutCollapseTimeSec(1) - DT_SEC / 2;
    advance(match, 90);
    assert.equal(match.players.p1.roundWins, round);
    if (round < 3) {
      advance(match, Math.ceil(2.5 / DT_SEC));
      assert.equal(match.roundNumber, round + 1);
      assert.equal(match.phase, "playing");
      assert.equal(match.players.p1.damage, 0);
      assert.equal(match.players.p2.eliminated, false);
      assert.equal(match.arena.intactRings, EDGEOUT_ARENA.rings);
      assert.equal(match.players.p1.z, EDGEOUT_ARENA.spawnRadius);
    }
  }
  assert.equal(match.gameOver, true);
  assert.equal(match.winner, "p1");
  assert.equal(match.players.p1.seriesWins, 1);
  assert.equal(match.players.p1.action, "victory");
});

test("inactive, invalid or paused steps consume no edges or timers", () => {
  const match = createDuel({ p1: { x: 0, z: 0.8, facing: FACING_NEGATIVE_Z, dashCooldownSec: 0.5 } });
  const fighter = match.players.p1;
  const before = structuredClone(fighter);
  stepEdgeoutFighter(fighter, { ...EDGEOUT_INPUT_TEMPLATE, shove: true }, DT_SEC, { active: false, intactRings: 4 });
  stepEdgeoutFighter(fighter, { ...EDGEOUT_INPUT_TEMPLATE, shove: true }, Number.NaN, { active: true, intactRings: 4 });
  stepEdgeoutFighter(fighter, { ...EDGEOUT_INPUT_TEMPLATE, shove: true }, -1, { active: true, intactRings: 4 });
  assert.deepEqual(fighter, before);
  match.started = false;
  const matchBefore = structuredClone(match);
  stepEdgeoutWorld(match, DT_SEC);
  assert.deepEqual(match, matchBefore);
});

test("match creation supports any fighter count and rejects duplicate or lonely rosters", () => {
  const crowd = createEdgeoutMatch({ playerIds: ["north", "south", "east"], botIds: ["west"] });
  const spawns = [...Object.values(crowd.players), ...crowd.bots].map((fighter) => Math.hypot(fighter.x, fighter.z));
  spawns.forEach((radius) => assert.ok(Math.abs(radius - EDGEOUT_ARENA.spawnRadius) < 1e-9));
  assert.equal(crowd.bots[0].connected, true);
  assert.equal(crowd.players.north.connected, false);
  assert.throws(() => createEdgeoutMatch({ playerIds: ["p1"] }), TypeError);
  assert.throws(() => createEdgeoutMatch({ playerIds: ["p1"], botIds: ["p1"] }), TypeError);
});
