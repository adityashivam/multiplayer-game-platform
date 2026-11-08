import test from "node:test";
import assert from "node:assert/strict";
import {
  DEAD_SHIFT_FIXED_DT_SEC,
  DEAD_SHIFT_INPUT_TEMPLATE,
  DEAD_SHIFT_COLLIDERS,
} from "../public/games/dead-shift/shared/config.js";
import {
  createDeadShiftPlayer,
  createDeadShiftRound,
  stepDeadShiftPlayer,
  stepDeadShiftCombat,
  stepDeadShiftWorld,
  stepDeadShiftRound,
  spawnDeadShiftEnemy,
  damageDeadShiftPlayer,
} from "../public/games/dead-shift/shared/simulation.js";

const input = (overrides = {}) => ({ ...DEAD_SHIFT_INPUT_TEMPLATE, ...overrides });

function createActiveRound() {
  const round = createDeadShiftRound();
  round.started = true;
  round.players.p1.connected = true;
  round.players.p2.connected = true;
  return round;
}

function advanceWorld(round, seconds, options = { spawnEnemies: false }) {
  const steps = Math.round(seconds / DEAD_SHIFT_FIXED_DT_SEC);
  for (let index = 0; index < steps; index += 1) {
    stepDeadShiftWorld(round, DEAD_SHIFT_FIXED_DT_SEC, options);
  }
}

test("predicted movement uses local forward, normalizes diagonal speed, and never predicts combat", () => {
  const player = createDeadShiftPlayer("p1");
  const combatBefore = [player.health, player.kills, player.weapon, player.ammo, player.shotId];
  stepDeadShiftPlayer(player, input({ moveX: 1, moveZ: 1, fire: true, weapon: 3 }), 1 / 60);
  assert.ok(player.x > -3);
  assert.ok(player.z < 7);
  assert.ok(Math.abs(Math.hypot(player.vx, player.vz) - 4.8) < 0.0001);
  assert.deepEqual([player.health, player.kills, player.weapon, player.ammo, player.shotId], combatBefore);

  const turnedPlayer = createDeadShiftPlayer("p2");
  stepDeadShiftPlayer(turnedPlayer, input({ yaw: Math.PI / 2, pitch: 0.4, moveZ: 1 }), 1 / 60);
  assert.ok(turnedPlayer.x < 3);
  assert.ok(Math.abs(turnedPlayer.z - 7) < 0.0001);
  assert.equal(turnedPlayer.pitch, 0.4);
});

test("players slide around cover, remain inside walls, and jump once per press", () => {
  const player = createDeadShiftPlayer("p1");
  Object.assign(player, { x: 0, z: 2 });
  for (let index = 0; index < 60; index += 1) {
    stepDeadShiftPlayer(player, input({ moveZ: 1 }), 1 / 60);
  }
  assert.ok(player.z >= 0.97, `center barrier must stop feet: ${player.z}`);
  Object.assign(player, { x: 15, z: 10 });
  for (let index = 0; index < 60; index += 1) {
    stepDeadShiftPlayer(player, input({ moveX: 1, sprint: true }), 1 / 60);
  }
  assert.ok(player.x <= 15.62);

  Object.assign(player, { x: -3, z: 7 });
  let highestY = 0;
  for (let index = 0; index < 120; index += 1) {
    stepDeadShiftPlayer(player, input({ jump: true }), 1 / 60);
    highestY = Math.max(highestY, player.y);
  }
  assert.ok(highestY > 0.7);
  assert.equal(player.y, 0);
  stepDeadShiftPlayer(player, input(), 1 / 60);
  stepDeadShiftPlayer(player, input({ jump: true }), 1 / 60);
  assert.ok(player.y > 0);
});

test("player contact separates both bodies without pushing either through cover", () => {
  const round = createActiveRound();
  Object.assign(round.players.p1, { x: -2.45, z: 0 });
  Object.assign(round.players.p2, { x: -2.45, z: 0 });
  stepDeadShiftRound(round, { p1: input(), p2: input() }, 1 / 60, { spawnEnemies: false });
  assert.ok(Math.hypot(round.players.p1.x - round.players.p2.x, round.players.p1.z - round.players.p2.z) >= 0.75);
  for (const player of Object.values(round.players)) {
    assert.ok(player.x <= -2.27 || Math.abs(player.z) >= 0.97);
  }
});

test("hitscan headshots award one kill and opponent bodies do not absorb bullets", () => {
  const round = createActiveRound();
  Object.assign(round.players.p1, { x: -12, z: 7 });
  Object.assign(round.players.p2, { x: -12, z: 5 });
  const enemy = spawnDeadShiftEnemy(round, "walker", -12, 2);
  stepDeadShiftCombat(round, round.players.p1, input({ fire: true }), 1 / 60);
  assert.equal(enemy.health, 0);
  assert.equal(round.players.p1.kills, 1);
  assert.equal(round.players.p2.health, 100);
  round.players.p1.shotCooldown = 0;
  stepDeadShiftCombat(round, round.players.p1, input({ fire: true }), 1 / 60);
  assert.equal(round.players.p1.kills, 1);
  assert.ok(round.events.some((event) => event.id > 0 && event.kind === "headshot"));
});

test("cover occludes hitscan shots and torso hits deal less damage than headshots", () => {
  const round = createActiveRound();
  Object.assign(round.players.p1, { x: -7, z: 5 });
  const coveredEnemy = spawnDeadShiftEnemy(round, "walker", -7, -4);
  stepDeadShiftCombat(round, round.players.p1, input({ fire: true }), 1 / 60);
  assert.equal(coveredEnemy.health, coveredEnemy.maxHealth);

  Object.assign(round.players.p1, { x: -12, z: 7, shotCooldown: 0 });
  const exposedEnemy = spawnDeadShiftEnemy(round, "walker", -12, 2);
  stepDeadShiftCombat(round, round.players.p1, input({ fire: true, pitch: -0.15 }), 1 / 60);
  assert.equal(exposedEnemy.health, exposedEnemy.maxHealth - 34);
  assert.equal(round.players.p1.kills, 0);
});

test("server owns firing cadence, preserves each weapon magazine, and auto reloads", () => {
  const round = createActiveRound();
  const player = round.players.p1;
  Object.assign(player, { x: -12, z: 7 });
  for (let index = 0; index < 60; index += 1) {
    stepDeadShiftCombat(round, player, input({ fire: true }), 1 / 60);
  }
  assert.equal(player.shotId, 10);
  assert.equal(player.ammo, 20);

  stepDeadShiftCombat(round, player, input({ weapon: 1 }), 1 / 60);
  assert.equal(player.ammo, 36);
  stepDeadShiftCombat(round, player, input({ weapon: 0 }), 1 / 60);
  assert.equal(player.ammo, 20);
  player.magazines[0] = 1;
  player.ammo = 1;
  player.shotCooldown = 0;
  stepDeadShiftCombat(round, player, input({ fire: true }), 1 / 60);
  assert.equal(player.ammo, 0);
  assert.ok(player.reloadRemaining > 0);
  for (let index = 0; index < 130; index += 1) {
    stepDeadShiftCombat(round, player, input(), 1 / 60);
  }
  assert.equal(player.ammo, 30);
  assert.equal(player.reloadRemaining, 0);
});

test("manual reload blocks shooting and switching cancels reload without refilling", () => {
  const round = createActiveRound();
  const player = round.players.p1;
  stepDeadShiftCombat(round, player, input({ fire: true }), 1 / 60);
  stepDeadShiftCombat(round, player, input({ reload: true, fire: true }), 1 / 60);
  assert.equal(player.shotId, 1);
  assert.ok(player.reloadRemaining > 0);
  stepDeadShiftCombat(round, player, input({ weapon: 2 }), 1 / 60);
  stepDeadShiftCombat(round, player, input({ weapon: 0 }), 1 / 60);
  assert.equal(player.ammo, 29);
  assert.equal(player.reloadRemaining, 0);
});

test("grenades follow gravity, bounce off the floor, and explode on their fuse", () => {
  const round = createActiveRound();
  const player = round.players.p1;
  Object.assign(player, { x: -12, z: 7 });
  stepDeadShiftCombat(round, player, input({ weapon: 3, fire: true }), 1 / 60);
  const grenade = round.projectiles.find((projectile) => projectile.id > 0);
  assert.equal(grenade.kind, "grenade");
  const initialVy = grenade.vy;
  stepDeadShiftWorld(round, 1 / 60, { spawnEnemies: false });
  assert.ok(grenade.vy < initialVy);
  Object.assign(grenade, { x: -12, y: 0.15, z: 5, vy: -3, vx: 0, vz: 0 });
  stepDeadShiftWorld(round, 1 / 60, { spawnEnemies: false });
  assert.ok(grenade.vy > 0, "a grenade must bounce rather than tunnel through the floor");
  advanceWorld(round, 1.6);
  assert.equal(grenade.id, 0);
  assert.ok(round.events.some((event) => event.kind === "explosion"));
});

test("rockets sweep through enemies and walls, splash once, and never hurt players", () => {
  const round = createActiveRound();
  const player = round.players.p1;
  Object.assign(player, { x: -12, z: 7 });
  Object.assign(round.players.p2, { x: -12, z: 3 });
  const enemy = spawnDeadShiftEnemy(round, "walker", -12, 2);
  stepDeadShiftCombat(round, player, input({ weapon: 4, fire: true }), 1 / 60);
  const rocket = round.projectiles.find((projectile) => projectile.id > 0);
  rocket.vz = -900;
  stepDeadShiftWorld(round, 1 / 60, { spawnEnemies: false });
  assert.equal(enemy.health, 0);
  assert.equal(player.kills, 1);
  assert.equal(round.players.p2.health, 100);
  assert.equal(rocket.id, 0);

  const coveredRound = createActiveRound();
  Object.assign(coveredRound.players.p1, { x: -7, z: 5 });
  const coveredEnemy = spawnDeadShiftEnemy(coveredRound, "walker", -7, -3);
  stepDeadShiftCombat(coveredRound, coveredRound.players.p1, input({ weapon: 4, fire: true }), 1 / 60);
  const coveredRocket = coveredRound.projectiles.find((projectile) => projectile.id > 0);
  coveredRocket.vz = -900;
  stepDeadShiftWorld(coveredRound, 1 / 60, { spawnEnemies: false });
  assert.equal(coveredEnemy.health, coveredEnemy.maxHealth);
  assert.equal(coveredRocket.id, 0);
});

test("melee attacks telegraph before damage and can be evaded", () => {
  const round = createActiveRound();
  Object.assign(round.players.p1, { x: -12, z: 7 });
  Object.assign(round.players.p2, { x: 12, z: 7 });
  const enemy = spawnDeadShiftEnemy(round, "brute", -12, 5.5);
  stepDeadShiftWorld(round, 1 / 60, { spawnEnemies: false });
  assert.equal(enemy.attackPhase, "windup");
  assert.equal(round.players.p1.health, 100);
  advanceWorld(round, 0.8);
  assert.equal(round.players.p1.health, 100);
  round.players.p1.z = 10;
  advanceWorld(round, 0.3);
  assert.equal(round.players.p1.health, 100);
});

test("spitters lock a readable ranged windup and launch moving acid at players", () => {
  const round = createActiveRound();
  Object.assign(round.players.p1, { x: -12, z: 7 });
  Object.assign(round.players.p2, { x: 12, z: 7 });
  const enemy = spawnDeadShiftEnemy(round, "spitter", -12, 0);
  stepDeadShiftWorld(round, 1 / 60, { spawnEnemies: false });
  assert.equal(enemy.attackPhase, "windup");
  assert.equal(round.projectiles.some((projectile) => projectile.id > 0), false);
  advanceWorld(round, 1.05);
  const acid = round.projectiles.find((projectile) => projectile.id > 0 && projectile.kind === "acid");
  assert.ok(acid);
  assert.ok(acid.vz > 0);
  advanceWorld(round, 0.7);
  assert.ok(round.players.p1.health < 100);
});

test("zombies navigate around industrial cover and keep bounded nonoverlapping bodies", () => {
  const round = createActiveRound();
  Object.assign(round.players.p1, { x: -7, z: 5 });
  Object.assign(round.players.p2, { x: 12, z: 9 });
  const enemy = spawnDeadShiftEnemy(round, "runner", -7, -5);
  advanceWorld(round, 5);
  assert.ok(enemy.z > 2.2, `runner got stuck behind cover at ${enemy.x},${enemy.z}`);
  for (const collider of DEAD_SHIFT_COLLIDERS) {
    const nearestX = Math.max(collider.x - collider.width / 2, Math.min(collider.x + collider.width / 2, enemy.x));
    const nearestZ = Math.max(collider.z - collider.depth / 2, Math.min(collider.z + collider.depth / 2, enemy.z));
    assert.ok(Math.hypot(enemy.x - nearestX, enemy.z - nearestZ) >= 0.30);
  }
  for (let index = 0; index < 100; index += 1) spawnDeadShiftEnemy(round, "walker", 0, -9);
  assert.equal(round.enemies.length, 32);
  advanceWorld(round, 1);
  assert.ok(round.enemies.every((enemyState) => Number.isFinite(enemyState.x) && Number.isFinite(enemyState.z)));
});

test("death preserves kills, disables fire, and respawns at full health after three seconds", () => {
  const round = createActiveRound();
  const player = round.players.p1;
  player.kills = 7;
  damageDeadShiftPlayer(round, player, 120, "enemy");
  assert.equal(player.health, 0);
  assert.equal(player.respawnRemaining, 3);
  stepDeadShiftCombat(round, player, input({ fire: true }), 1 / 60);
  assert.equal(player.shotId, 0);
  advanceWorld(round, 2.9);
  assert.equal(player.health, 0);
  advanceWorld(round, 0.1);
  assert.equal(player.health, 100);
  assert.equal(player.kills, 7);
  assert.equal(player.respawnRemaining, 0);
  assert.equal(player.ammo, 30);
});

test("round completion chooses most kills, draws ties, and freezes simulation", () => {
  for (const [p1Kills, p2Kills, winner] of [[3, 2, "p1"], [2, 3, "p2"], [4, 4, "tie"]]) {
    const round = createActiveRound();
    round.players.p1.kills = p1Kills;
    round.players.p2.kills = p2Kills;
    round.timer = 0.01;
    stepDeadShiftWorld(round, 1 / 60, { spawnEnemies: false });
    assert.equal(round.timer, 0);
    assert.equal(round.gameOver, true);
    assert.equal(round.winner, winner);
    const finishedRound = structuredClone(round);
    stepDeadShiftRound(round, { p1: input({ fire: true, moveZ: 1 }), p2: input() }, 1 / 60);
    assert.deepEqual(round, finishedRound);
  }
});

test("SMG fire rate carries fractional tick remainder instead of losing cadence", () => {
  const round = createActiveRound();
  const player = round.players.p1;
  for (let index = 0; index < 60; index += 1) {
    stepDeadShiftCombat(round, player, input({ weapon: 1, fire: true }), 1 / 60);
  }
  assert.equal(player.shotId, 14);
  assert.equal(player.ammo, 22);
});

test("shotgun pellets hit spread targets and an exhausted missile pool does not consume ammunition", () => {
  const round = createActiveRound();
  const player = round.players.p1;
  Object.assign(player, { x: -12, z: 7 });
  const enemy = spawnDeadShiftEnemy(round, "walker", -12, 3);
  stepDeadShiftCombat(round, player, input({ weapon: 2, fire: true, pitch: -0.1 }), 1 / 60);
  assert.equal(enemy.health, 0);
  assert.equal(player.kills, 1);
  for (const projectile of round.projectiles) Object.assign(projectile, { id: 100, kind: "acid", lifeRemaining: 1 });
  player.shotCooldown = 0;
  stepDeadShiftCombat(round, player, input({ weapon: 4, fire: true }), 1 / 60);
  assert.equal(player.ammo, 3);
  assert.equal(player.shotId, 1);
});

test("standing in a completed melee telegraph takes damage while sidestepping locked acid evades it", () => {
  const meleeRound = createActiveRound();
  Object.assign(meleeRound.players.p1, { x: -12, z: 7 });
  spawnDeadShiftEnemy(meleeRound, "walker", -12, 6);
  advanceWorld(meleeRound, 0.55);
  assert.equal(meleeRound.players.p1.health, 88);

  const acidRound = createActiveRound();
  Object.assign(acidRound.players.p1, { x: -12, z: 7 });
  Object.assign(acidRound.players.p2, { x: 12, z: 7 });
  spawnDeadShiftEnemy(acidRound, "spitter", -12, 0);
  advanceWorld(acidRound, 0.5);
  acidRound.players.p1.x = -8;
  advanceWorld(acidRound, 1.3);
  assert.equal(acidRound.players.p1.health, 100);
});

test("a full 90-second round keeps every entity pool bounded and reaches a result under sustained play", () => {
  const round = createActiveRound();
  const encounteredTypes = new Set();
  let sawDeath = false;
  let sawRespawn = false;
  for (let tickIndex = 0; tickIndex < 5400; tickIndex += 1) {
    const playerInputs = {};
    for (const playerId of ["p1", "p2"]) {
      const player = round.players[playerId];
      const enemy = round.enemies.find((enemyState) => enemyState.id > 0 && enemyState.health > 0);
      const yaw = enemy ? Math.atan2(player.x - enemy.x, player.z - enemy.z) : 0;
      playerInputs[playerId] = input({ yaw, fire: tickIndex % 400 > 180, weapon: Math.floor(tickIndex / 700) % 5 });
    }
    stepDeadShiftRound(round, playerInputs, 1 / 60);
    for (const enemy of round.enemies) {
      if (enemy.id > 0) encounteredTypes.add(enemy.type);
      assert.ok(Number.isFinite(enemy.x) && Number.isFinite(enemy.z));
    }
    if (Object.values(round.players).some((player) => player.health === 0)) sawDeath = true;
    if (round.events.some((event) => event.kind === "respawn")) sawRespawn = true;
    assert.equal(round.enemies.length, 32);
    assert.equal(round.projectiles.length, 48);
    assert.equal(round.events.length, 32);
  }
  assert.equal(round.gameOver, true);
  assert.equal(round.timer, 0);
  assert.ok(["p1", "p2", "tie"].includes(round.winner));
  assert.deepEqual([...encounteredTypes].sort(), ["brute", "runner", "spitter", "walker"]);
  assert.equal(sawDeath, true);
  assert.equal(sawRespawn, true);
  assert.ok(round.players.p1.kills + round.players.p2.kills > 0);
});

test("zombies can reach a player hugging a cover edge or rounded corner", () => {
  for (const [type, targetX, targetZ, spawnX, spawnZ] of [
    ["walker", 2.17, 0.87, 4, -2],
    ["brute", 2.29, 0, 6, 0],
  ]) {
    const round = createActiveRound();
    Object.assign(round.players.p1, { x: targetX, z: targetZ });
    Object.assign(round.players.p2, { x: -12, z: 9 });
    const enemy = spawnDeadShiftEnemy(round, type, spawnX, spawnZ);
    advanceWorld(round, 5);
    assert.ok(round.players.p1.health < 100, `${type} could not route to a player hugging cover at ${enemy.x},${enemy.z}`);
  }
});
