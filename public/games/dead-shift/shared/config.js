/** Game-owned, browser/server-safe configuration. Distances are meters; time is seconds. */
export const DEAD_SHIFT_GAME_ID = "dead-shift";
export const DEAD_SHIFT_FIXED_DT_SEC = 1 / 60;
export const DEAD_SHIFT_PLAYER_IDS = Object.freeze(["p1", "p2"]);
export const DEAD_SHIFT_ROUND_DURATION_SEC = 90;
export const DEAD_SHIFT_RESPAWN_SEC = 3;
export const DEAD_SHIFT_MAX_ENEMIES = 32;
export const DEAD_SHIFT_MAX_PROJECTILES = 48;
export const DEAD_SHIFT_MAX_EVENTS = 32;

/**
 * @typedef {"p1" | "p2"} DeadShiftPlayerId
 * @typedef {{moveX: number, moveZ: number, yaw: number, pitch: number, weapon: number, fire: boolean, reload: boolean, jump: boolean, sprint: boolean}} DeadShiftInputState
 */
/** @type {Readonly<DeadShiftInputState>} */
export const DEAD_SHIFT_INPUT_TEMPLATE = Object.freeze({
  moveX: 0,
  moveZ: 0,
  yaw: 0,
  pitch: 0,
  weapon: 0,
  fire: false,
  reload: false,
  jump: false,
  sprint: false,
});

export const DEAD_SHIFT_NUMERIC_INPUTS = Object.freeze({
  moveX: Object.freeze({ min: -1, max: 1 }),
  moveZ: Object.freeze({ min: -1, max: 1 }),
  yaw: Object.freeze({ min: -Math.PI, max: Math.PI }),
  pitch: Object.freeze({ min: -1.3, max: 1.3 }),
  weapon: Object.freeze({ min: 0, max: 4, integer: true }),
});
export const DEAD_SHIFT_EDGE_KEYS = Object.freeze(["fire", "reload", "jump"]);

export const DEAD_SHIFT_ARENA = Object.freeze({ width: 32, depth: 24, halfWidth: 16, halfDepth: 12, height: 8 });
export const DEAD_SHIFT_PLAYER_SETTINGS = Object.freeze({
  radius: 0.38,
  height: 1.8,
  eyeHeight: 1.65,
  walkSpeed: 4.8,
  sprintSpeed: 7.2,
  jumpSpeed: 5.7,
  gravity: 17.5,
  maxHealth: 100,
  respawnInvulnerabilitySec: 1,
});

/** Static solid boxes, centered in X/Z, with their base at floor Y=0. */
export const DEAD_SHIFT_COLLIDERS = Object.freeze([
  { id: "crate-west", x: -7, z: 0, width: 3, depth: 3, height: 1.7 },
  { id: "crate-east", x: 7, z: -2, width: 3, depth: 3, height: 1.7 },
  { id: "tank-north", x: -4, z: -6, width: 3, depth: 2.6, height: 2.8 },
  { id: "tank-south", x: 5, z: 5, width: 2.5, depth: 2.5, height: 2.8 },
  { id: "barrier-center", x: 0, z: 0, width: 3.8, depth: 1.2, height: 1.25 },
  { id: "generator-west", x: -10, z: 6, width: 2.5, depth: 2, height: 2.1 },
  { id: "generator-east", x: 10, z: -7, width: 2.5, depth: 2, height: 2.1 },
].map((collider) => Object.freeze(collider)));

/**
 * @typedef {"rifle" | "smg" | "shotgun" | "grenade-launcher" | "rocket-launcher"} DeadShiftWeaponId
 * @typedef {"hitscan" | "grenade" | "rocket"} DeadShiftWeaponKind
 * @typedef {{id: DeadShiftWeaponId, name: string, kind: DeadShiftWeaponKind, damage: number, fireIntervalSec: number, magazineSize: number, reloadSec: number, range: number, pellets: number, spread: number, headshotMultiplier: number, projectileSpeed: number, splashRadius: number}} DeadShiftWeaponDefinition
 */
/** @type {ReadonlyArray<Readonly<DeadShiftWeaponDefinition>>} */
export const DEAD_SHIFT_WEAPONS = Object.freeze([
  { id: "rifle", name: "Assault rifle", kind: "hitscan", damage: 34, fireIntervalSec: 0.1, magazineSize: 30, reloadSec: 2, range: 48, pellets: 1, spread: 0, headshotMultiplier: 2.5, projectileSpeed: 0, splashRadius: 0 },
  { id: "smg", name: "Submachine gun", kind: "hitscan", damage: 18, fireIntervalSec: 0.075, magazineSize: 36, reloadSec: 1.7, range: 36, pellets: 1, spread: 0.009, headshotMultiplier: 2.5, projectileSpeed: 0, splashRadius: 0 },
  { id: "shotgun", name: "Pump shotgun", kind: "hitscan", damage: 17, fireIntervalSec: 0.7, magazineSize: 8, reloadSec: 2.4, range: 23, pellets: 8, spread: 0.075, headshotMultiplier: 1.7, projectileSpeed: 0, splashRadius: 0 },
  { id: "grenade-launcher", name: "Grenade launcher", kind: "grenade", damage: 125, fireIntervalSec: 0.8, magazineSize: 6, reloadSec: 2.6, range: 40, pellets: 1, spread: 0, headshotMultiplier: 1, projectileSpeed: 15, splashRadius: 4.8 },
  { id: "rocket-launcher", name: "Rocket launcher", kind: "rocket", damage: 175, fireIntervalSec: 0.95, magazineSize: 3, reloadSec: 3, range: 60, pellets: 1, spread: 0, headshotMultiplier: 1, projectileSpeed: 29, splashRadius: 5.2 },
].map((weapon) => Object.freeze(weapon)));

/**
 * @typedef {"walker" | "runner" | "brute" | "spitter"} DeadShiftEnemyTypeId
 * @typedef {{id: DeadShiftEnemyTypeId, name: string, health: number, speed: number, radius: number, height: number, headHeight: number, headRadius: number, damage: number, attackRange: number, windupSec: number, recoverySec: number}} DeadShiftEnemyDefinition
 */
/** @type {ReadonlyArray<Readonly<DeadShiftEnemyDefinition>>} */
export const DEAD_SHIFT_ENEMY_TYPES = Object.freeze([
  { id: "walker", name: "Shambler", health: 72, speed: 1.35, radius: 0.38, height: 1.85, headHeight: 1.65, headRadius: 0.23, damage: 12, attackRange: 1.1, windupSec: 0.5, recoverySec: 1.05 },
  { id: "runner", name: "Runner", health: 48, speed: 2.7, radius: 0.32, height: 1.6, headHeight: 1.4, headRadius: 0.21, damage: 9, attackRange: 1.05, windupSec: 0.3, recoverySec: 0.65 },
  { id: "brute", name: "Brute", health: 250, speed: 0.85, radius: 0.64, height: 2.55, headHeight: 2.25, headRadius: 0.32, damage: 27, attackRange: 1.85, windupSec: 1, recoverySec: 1.5 },
  { id: "spitter", name: "Spitter", health: 86, speed: 1.1, radius: 0.4, height: 1.9, headHeight: 1.65, headRadius: 0.25, damage: 17, attackRange: 10, windupSec: 1, recoverySec: 2.4 },
].map((enemyType) => Object.freeze(enemyType)));

export const DEAD_SHIFT_SPAWN_POINTS = Object.freeze([
  { x: -14, z: -10 }, { x: 14, z: -10 }, { x: -14, z: 1 }, { x: 14, z: 3 },
  { x: -7, z: -10 }, { x: 3, z: -10 }, { x: 14, z: 10 }, { x: -14, z: 10 },
].map((spawnPoint) => Object.freeze(spawnPoint)));
