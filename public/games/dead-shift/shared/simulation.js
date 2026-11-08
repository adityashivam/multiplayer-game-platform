import {
  DEAD_SHIFT_EDGE_KEYS,
  DEAD_SHIFT_ENEMY_TYPES,
  DEAD_SHIFT_FIXED_DT_SEC,
  DEAD_SHIFT_INPUT_TEMPLATE,
  DEAD_SHIFT_MAX_ENEMIES,
  DEAD_SHIFT_MAX_EVENTS,
  DEAD_SHIFT_MAX_PROJECTILES,
  DEAD_SHIFT_PLAYER_IDS,
  DEAD_SHIFT_PLAYER_SETTINGS,
  DEAD_SHIFT_RESPAWN_SEC,
  DEAD_SHIFT_ROUND_DURATION_SEC,
  DEAD_SHIFT_SPAWN_POINTS,
  DEAD_SHIFT_WEAPONS,
} from "./config.js";
import {
  clampDeadShiftNumber,
  constrainDeadShiftBody,
  hasDeadShiftLineOfSight,
  moveDeadShiftBody,
  traceDeadShiftWorld,
} from "./collision.js";
import { getDeadShiftNavigationWaypoint } from "./navigation.js";

/** @typedef {import("./config.js").DeadShiftPlayerId} DeadShiftPlayerId */
/** @typedef {import("./config.js").DeadShiftInputState} DeadShiftInputState */
/** @typedef {import("./config.js").DeadShiftEnemyTypeId} DeadShiftEnemyTypeId */
/**
 * Movement fields and jumpHeld are predicted; all combat/inventory fields are
 * authoritative. The input adapter owns queues/epochs outside this pure state.
 * @typedef {object} DeadShiftPlayerState
 * @property {DeadShiftPlayerId} playerId
 * @property {number} x
 * @property {number} y Feet height.
 * @property {number} z
 * @property {number} vx
 * @property {number} vy
 * @property {number} vz
 * @property {number} yaw
 * @property {number} pitch
 * @property {boolean} jumpHeld
 * @property {number} health
 * @property {number} kills
 * @property {number} weapon
 * @property {number} ammo
 * @property {number[]} magazines Per-weapon rounds, with unlimited reserve supply.
 * @property {number} reloadRemaining
 * @property {boolean} reloadHeld
 * @property {number} respawnRemaining
 * @property {number} respawnId Monotonic presentation identity within a round.
 * @property {number} invulnerabilityRemaining
 * @property {number} shotCooldown
 * @property {number} shotId Monotonic within a round, including across respawns.
 * @property {boolean} connected
 */
/**
 * @typedef {object} DeadShiftEnemyState
 * @property {number} id Zero is an unused fixed pool slot.
 * @property {DeadShiftEnemyTypeId} type
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} yaw
 * @property {number} health
 * @property {number} maxHealth
 * @property {"idle" | "windup" | "recovery" | "dead"} attackPhase
 * @property {number} damageId Increments on damage and attack release.
 * @property {DeadShiftPlayerId} targetId
 * @property {number} attackRemaining
 * @property {number} attackTargetX
 * @property {number} attackTargetY
 * @property {number} attackTargetZ
 * @property {number} deathRemaining
 * @property {number} pathX
 * @property {number} pathZ
 * @property {number} pathRemaining
 */
/**
 * @typedef {object} DeadShiftProjectileState
 * @property {number} id
 * @property {"grenade" | "rocket" | "acid"} kind
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} vx
 * @property {number} vy
 * @property {number} vz
 * @property {DeadShiftPlayerId | "enemy"} ownerId
 * @property {number} weapon
 * @property {number} damage
 * @property {number} radius
 * @property {number} splashRadius
 * @property {number} lifeRemaining
 * @property {number} fuseRemaining
 * @property {number} bounces
 */
/**
 * @typedef {"shot" | "hit" | "headshot" | "kill" | "explosion" | "acid" | "damage" | "spawn" | "respawn"} DeadShiftEventKind
 * @typedef {object} DeadShiftEvent
 * @property {number} id
 * @property {DeadShiftEventKind} kind
 * @property {string} actorId
 * @property {string} targetId
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} value
 * @property {number} weapon
 */
/**
 * @typedef {object} DeadShiftRoundState
 * @property {{p1:DeadShiftPlayerState,p2:DeadShiftPlayerState}} players
 * @property {DeadShiftEnemyState[]} enemies
 * @property {DeadShiftProjectileState[]} projectiles
 * @property {DeadShiftEvent[]} events
 * @property {number} nextEntityId
 * @property {number} nextEventId
 * @property {number} spawnRemaining
 * @property {number} spawnIndex
 * @property {number} timer
 * @property {number} durationSec
 * @property {boolean} started
 * @property {number|null} startAt
 * @property {boolean} gameOver
 * @property {DeadShiftPlayerId|"tie"|null} winner
 */

const MAX_PURE_STEP_SEC = 0.1;
const TIME_EPSILON_SEC = 0.000001;
const GRENADE_GRAVITY = 14;
const GRENADE_FUSE_SEC = 1.4;
const ENEMY_DEATH_SEC = 0.55;
const ENEMY_DEFINITIONS = Object.fromEntries(DEAD_SHIFT_ENEMY_TYPES.map((enemyType) => [enemyType.id, enemyType]));

/** @param {DeadShiftPlayerId} playerId @returns {DeadShiftPlayerState} */
export function createDeadShiftPlayer(playerId) {
  return {
    playerId,
    x: playerId === "p1" ? -3 : 3,
    y: 0,
    z: 7,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 0,
    pitch: 0,
    jumpHeld: false,
    health: DEAD_SHIFT_PLAYER_SETTINGS.maxHealth,
    kills: 0,
    weapon: 0,
    ammo: DEAD_SHIFT_WEAPONS[0].magazineSize,
    magazines: DEAD_SHIFT_WEAPONS.map((weapon) => weapon.magazineSize),
    reloadRemaining: 0,
    reloadHeld: false,
    respawnRemaining: 0,
    respawnId: 0,
    invulnerabilityRemaining: 0,
    shotCooldown: 0,
    shotId: 0,
    connected: false,
  };
}

/** @returns {DeadShiftEnemyState} */
export function createEmptyDeadShiftEnemy() {
  return {
    id: 0, type: "walker", x: 0, y: 0, z: 0, yaw: 0, health: 0, maxHealth: 0,
    attackPhase: "idle", damageId: 0, targetId: "p1", attackRemaining: 0,
    attackTargetX: 0, attackTargetY: 0, attackTargetZ: 0, deathRemaining: 0,
    pathX: 0, pathZ: 0, pathRemaining: 0,
  };
}

/** @returns {DeadShiftProjectileState} */
export function createEmptyDeadShiftProjectile() {
  return {
    id: 0, kind: "rocket", x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
    ownerId: "p1", weapon: 0, damage: 0, radius: 0, splashRadius: 0,
    lifeRemaining: 0, fuseRemaining: 0, bounces: 0,
  };
}

/** @returns {DeadShiftEvent} */
export function createEmptyDeadShiftEvent() {
  return { id: 0, kind: "shot", actorId: "", targetId: "", x: 0, y: 0, z: 0, value: 0, weapon: 0 };
}

/** Create independent fixed pools; an idle room performs no gameplay work. @returns {DeadShiftRoundState} */
export function createDeadShiftRound() {
  return {
    players: { p1: createDeadShiftPlayer("p1"), p2: createDeadShiftPlayer("p2") },
    enemies: Array.from({ length: DEAD_SHIFT_MAX_ENEMIES }, createEmptyDeadShiftEnemy),
    projectiles: Array.from({ length: DEAD_SHIFT_MAX_PROJECTILES }, createEmptyDeadShiftProjectile),
    events: Array.from({ length: DEAD_SHIFT_MAX_EVENTS }, createEmptyDeadShiftEvent),
    nextEntityId: 1,
    nextEventId: 1,
    spawnRemaining: 0.75,
    spawnIndex: 0,
    timer: DEAD_SHIFT_ROUND_DURATION_SEC,
    durationSec: DEAD_SHIFT_ROUND_DURATION_SEC,
    started: false,
    startAt: null,
    gameOver: false,
    winner: null,
  };
}

/**
 * Predict only locomotion, look and the movement-owned jump latch. Combat and
 * authoritative scores, health, inventory and timers remain unchanged.
 * @param {DeadShiftPlayerState} playerState Mutated in place.
 * @param {DeadShiftInputState} inputState Read-only command.
 * @param {number} dtSec
 * @param {{active?:boolean,players?:ReadonlyArray<DeadShiftPlayerState>}} [context]
 * @returns {DeadShiftPlayerState}
 */
export function stepDeadShiftPlayer(playerState, inputState, dtSec, context = {}) {
  const stepSec = clampDeadShiftNumber(Number.isFinite(dtSec) ? dtSec : 0, 0, MAX_PURE_STEP_SEC);
  if (Number.isFinite(inputState.yaw)) playerState.yaw = clampDeadShiftNumber(inputState.yaw, -Math.PI, Math.PI);
  if (Number.isFinite(inputState.pitch)) playerState.pitch = clampDeadShiftNumber(inputState.pitch, -1.3, 1.3);
  if (context.active === false || playerState.health <= 0 || playerState.respawnRemaining > 0) {
    playerState.vx = 0;
    playerState.vy = 0;
    playerState.vz = 0;
    playerState.jumpHeld = Boolean(inputState.jump);
    return playerState;
  }

  let moveX = clampDeadShiftNumber(Number.isFinite(inputState.moveX) ? inputState.moveX : 0, -1, 1);
  let moveZ = clampDeadShiftNumber(Number.isFinite(inputState.moveZ) ? inputState.moveZ : 0, -1, 1);
  const magnitude = Math.hypot(moveX, moveZ);
  if (magnitude > 1) {
    moveX /= magnitude;
    moveZ /= magnitude;
  }
  const speed = inputState.sprint ? DEAD_SHIFT_PLAYER_SETTINGS.sprintSpeed : DEAD_SHIFT_PLAYER_SETTINGS.walkSpeed;
  const sinYaw = Math.sin(playerState.yaw);
  const cosYaw = Math.cos(playerState.yaw);
  playerState.vx = (moveX * cosYaw - moveZ * sinYaw) * speed;
  playerState.vz = (-moveX * sinYaw - moveZ * cosYaw) * speed;
  if (inputState.jump && !playerState.jumpHeld && playerState.y <= 0.001) {
    playerState.vy = DEAD_SHIFT_PLAYER_SETTINGS.jumpSpeed;
  }
  playerState.jumpHeld = Boolean(inputState.jump);
  playerState.vy -= DEAD_SHIFT_PLAYER_SETTINGS.gravity * stepSec;
  playerState.y = Math.max(0, playerState.y + playerState.vy * stepSec);
  if (playerState.y === 0) playerState.vy = 0;
  moveDeadShiftBody(playerState, playerState.vx * stepSec, playerState.vz * stepSec, DEAD_SHIFT_PLAYER_SETTINGS.radius);

  for (const opponent of context.players || []) {
    if (opponent === playerState || opponent.playerId === playerState.playerId ||
        !opponent.connected || opponent.health <= 0 || Math.abs(playerState.y - opponent.y) > 1.6) continue;
    separateDeadShiftBodies(playerState, DEAD_SHIFT_PLAYER_SETTINGS.radius, opponent, DEAD_SHIFT_PLAYER_SETTINGS.radius, false);
  }
  return playerState;
}

/**
 * Correct horizontal contact and then reapply world clearance. Server contact is
 * symmetric; prediction may move only the locally owned body.
 * @param {{x:number,y:number,z:number}} first
 * @param {number} firstRadius
 * @param {{x:number,y:number,z:number}} second
 * @param {number} secondRadius
 * @param {boolean} [symmetric]
 */
function separateDeadShiftBodies(first, firstRadius, second, secondRadius, symmetric = true) {
  const deltaX = first.x - second.x;
  const deltaZ = first.z - second.z;
  const distance = Math.hypot(deltaX, deltaZ);
  const minimumDistance = firstRadius + secondRadius;
  if (distance >= minimumDistance || Math.abs(first.y - second.y) > 1.6) return;
  const normalX = distance > 0.0001 ? deltaX / distance : 1;
  const normalZ = distance > 0.0001 ? deltaZ / distance : 0;
  const correction = minimumDistance - distance + 0.001;
  const fraction = symmetric ? 0.5 : 1;
  first.x += normalX * correction * fraction;
  first.z += normalZ * correction * fraction;
  constrainDeadShiftBody(first, firstRadius);
  if (symmetric) {
    second.x -= normalX * correction * 0.5;
    second.z -= normalZ * correction * 0.5;
    constrainDeadShiftBody(second, secondRadius);
    // Transfer the displacement a wall removed to the body with free space.
    let blockedDistance = Math.max(0, minimumDistance + 0.001 - Math.hypot(first.x - second.x, first.z - second.z));
    second.x -= normalX * blockedDistance;
    second.z -= normalZ * blockedDistance;
    constrainDeadShiftBody(second, secondRadius);
    blockedDistance = Math.max(0, minimumDistance + 0.001 - Math.hypot(first.x - second.x, first.z - second.z));
    first.x += normalX * blockedDistance;
    first.z += normalZ * blockedDistance;
    constrainDeadShiftBody(first, firstRadius);
  }
}

/**
 * Append an immutable event value into a bounded, chronological fixed array.
 * @param {DeadShiftRoundState} round
 * @param {Omit<DeadShiftEvent,"id">} event
 */
function recordDeadShiftEvent(round, event) {
  round.events.shift();
  round.events.push({ id: round.nextEventId++, ...event });
}

/**
 * Fill a vacant pool slot. Returns null instead of growing the authoritative pool.
 * @param {DeadShiftRoundState} round
 * @param {DeadShiftEnemyTypeId} type
 * @param {number} x
 * @param {number} z
 * @returns {DeadShiftEnemyState|null}
 */
export function spawnDeadShiftEnemy(round, type, x, z) {
  const enemy = round.enemies.find((enemyState) => enemyState.id === 0);
  const definition = ENEMY_DEFINITIONS[type];
  if (!enemy || !definition) return null;
  Object.assign(enemy, createEmptyDeadShiftEnemy(), {
    id: round.nextEntityId++, type, x, z, health: definition.health, maxHealth: definition.health, pathX: x, pathZ: z,
  });
  constrainDeadShiftBody(enemy, definition.radius, definition.height);
  recordDeadShiftEvent(round, { kind: "spawn", actorId: "enemy", targetId: String(enemy.id), x: enemy.x, y: 0, z: enemy.z, value: 0, weapon: -1 });
  return enemy;
}

/** @param {number} yaw @param {number} pitch */
function getDeadShiftAimDirection(yaw, pitch) {
  const cosPitch = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cosPitch, y: Math.sin(pitch), z: -Math.cos(yaw) * cosPitch };
}

/**
 * Return first positive ray/sphere contact, with rays normalized by the caller.
 * @param {{x:number,y:number,z:number}} origin
 * @param {{x:number,y:number,z:number}} direction
 * @param {{x:number,y:number,z:number}} center
 * @param {number} radius
 * @returns {number}
 */
function intersectDeadShiftSphere(origin, direction, center, radius) {
  const deltaX = origin.x - center.x;
  const deltaY = origin.y - center.y;
  const deltaZ = origin.z - center.z;
  const along = deltaX * direction.x + deltaY * direction.y + deltaZ * direction.z;
  const constant = deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ - radius * radius;
  const discriminant = along * along - constant;
  if (discriminant < 0) return Infinity;
  const near = -along - Math.sqrt(discriminant);
  const far = -along + Math.sqrt(discriminant);
  return near >= 0 ? near : far >= 0 ? 0 : Infinity;
}

/**
 * Test an upright torso plus authored head sphere. Expanded radii support swept
 * rockets/acid without sampling endpoints or confusing head and body hits.
 * @param {{x:number,y:number,z:number}} origin
 * @param {{x:number,y:number,z:number}} direction
 * @param {{x:number,y:number,z:number}} body
 * @param {{radius:number,height:number,headHeight:number,headRadius:number}} dimensions
 * @param {number} [padding]
 * @returns {{distance:number,headshot:boolean}}
 */
function intersectDeadShiftCharacter(origin, direction, body, dimensions, padding = 0) {
  const headDistance = intersectDeadShiftSphere(origin, direction, {
    x: body.x, y: body.y + dimensions.headHeight, z: body.z,
  }, dimensions.headRadius + padding);
  const deltaX = origin.x - body.x;
  const deltaZ = origin.z - body.z;
  const horizontalLengthSquared = direction.x * direction.x + direction.z * direction.z;
  const radius = dimensions.radius + padding;
  let torsoDistance = Infinity;
  if (horizontalLengthSquared > 0.000001) {
    const along = deltaX * direction.x + deltaZ * direction.z;
    const constant = deltaX * deltaX + deltaZ * deltaZ - radius * radius;
    const discriminant = along * along - horizontalLengthSquared * constant;
    if (discriminant >= 0) {
      const near = (-along - Math.sqrt(discriminant)) / horizontalLengthSquared;
      const far = (-along + Math.sqrt(discriminant)) / horizontalLengthSquared;
      for (const distance of [Math.max(0, near), far]) {
        const contactY = origin.y + direction.y * distance;
        if (distance >= 0 && contactY >= body.y - padding &&
            contactY <= body.y + dimensions.headHeight - dimensions.headRadius * 0.7 + padding) {
          torsoDistance = Math.min(torsoDistance, distance);
        }
      }
    }
  }
  return headDistance <= torsoDistance ? { distance: headDistance, headshot: true } : { distance: torsoDistance, headshot: false };
}

/**
 * Damage a live enemy exactly once; the corpse retains its identity briefly for
 * death presentation, but cannot be hit, target a player, or grant a second kill.
 * @param {DeadShiftRoundState} round
 * @param {DeadShiftEnemyState} enemy
 * @param {number} damage
 * @param {DeadShiftPlayerId} ownerId
 * @param {number} weapon
 * @param {boolean} [headshot]
 */
function damageDeadShiftEnemy(round, enemy, damage, ownerId, weapon, headshot = false) {
  if (!enemy.id || enemy.health <= 0 || damage <= 0) return;
  const appliedDamage = Math.min(enemy.health, damage);
  enemy.health = Math.max(0, enemy.health - damage);
  enemy.damageId += 1;
  recordDeadShiftEvent(round, {
    kind: headshot ? "headshot" : "hit", actorId: ownerId, targetId: String(enemy.id),
    x: enemy.x, y: headshot ? ENEMY_DEFINITIONS[enemy.type].headHeight : 1, z: enemy.z,
    value: appliedDamage, weapon,
  });
  if (enemy.health > 0) return;
  enemy.attackPhase = "dead";
  enemy.deathRemaining = ENEMY_DEATH_SEC;
  round.players[ownerId].kills += 1;
  recordDeadShiftEvent(round, { kind: "kill", actorId: ownerId, targetId: String(enemy.id), x: enemy.x, y: 1, z: enemy.z, value: 1, weapon });
}

/**
 * Apply authoritative enemy damage. Players never damage other players, and
 * respawn protection covers immediate contact without affecting kill ownership.
 * @param {DeadShiftRoundState} round
 * @param {DeadShiftPlayerState} player
 * @param {number} damage
 * @param {string} actorId
 */
export function damageDeadShiftPlayer(round, player, damage, actorId) {
  if (!player.connected || player.health <= 0 || player.invulnerabilityRemaining > 0 || damage <= 0) return;
  const appliedDamage = Math.min(player.health, damage);
  player.health = Math.max(0, player.health - damage);
  recordDeadShiftEvent(round, { kind: "damage", actorId, targetId: player.playerId, x: player.x, y: 1, z: player.z, value: appliedDamage, weapon: -1 });
  if (player.health > 0) return;
  player.respawnRemaining = DEAD_SHIFT_RESPAWN_SEC;
  player.vx = 0;
  player.vy = 0;
  player.vz = 0;
  player.reloadRemaining = 0;
  player.shotCooldown = 0;
}

/** @param {DeadShiftPlayerState} player */
function startDeadShiftReload(player) {
  const definition = DEAD_SHIFT_WEAPONS[player.weapon];
  if (player.reloadRemaining <= 0 && player.ammo < definition.magazineSize) {
    player.reloadRemaining = definition.reloadSec;
  }
}

/**
 * Fire one hitscan ray/pellet at the closest unobstructed living enemy.
 * @param {DeadShiftRoundState} round
 * @param {DeadShiftPlayerState} player
 * @param {{x:number,y:number,z:number}} direction
 * @param {import("./config.js").DeadShiftWeaponDefinition} definition
 * @returns {{x:number,y:number,z:number}}
 */
function fireDeadShiftHitscan(round, player, direction, definition) {
  const origin = { x: player.x, y: player.y + DEAD_SHIFT_PLAYER_SETTINGS.eyeHeight, z: player.z };
  let nearestDistance = traceDeadShiftWorld(origin, direction, definition.range)?.distance ?? definition.range;
  let nearestEnemy = null;
  let headshot = false;
  for (const enemy of round.enemies) {
    if (!enemy.id || enemy.health <= 0) continue;
    const contact = intersectDeadShiftCharacter(origin, direction, enemy, ENEMY_DEFINITIONS[enemy.type]);
    if (contact.distance < nearestDistance) {
      nearestDistance = contact.distance;
      nearestEnemy = enemy;
      headshot = contact.headshot;
    }
  }
  if (nearestEnemy) {
    damageDeadShiftEnemy(round, nearestEnemy, definition.damage * (headshot ? definition.headshotMultiplier : 1), player.playerId, player.weapon, headshot);
  }
  return { x: origin.x + direction.x * nearestDistance, y: origin.y + direction.y * nearestDistance, z: origin.z + direction.z * nearestDistance };
}

/**
 * Launch from the eye ray without allowing the muzzle offset to cross cover.
 * @param {DeadShiftRoundState} round
 * @param {DeadShiftPlayerState} player
 * @param {{x:number,y:number,z:number}} direction
 * @param {import("./config.js").DeadShiftWeaponDefinition} definition
 * @returns {DeadShiftProjectileState|null}
 */
function launchDeadShiftPlayerProjectile(round, player, direction, definition) {
  const projectile = round.projectiles.find((projectileState) => projectileState.id === 0);
  if (!projectile) return null;
  const radius = definition.kind === "grenade" ? 0.13 : 0.12;
  const origin = { x: player.x, y: player.y + DEAD_SHIFT_PLAYER_SETTINGS.eyeHeight - 0.08, z: player.z };
  const spawnOffset = Math.min(0.5, Math.max(0, (traceDeadShiftWorld(origin, direction, 0.5, radius)?.distance ?? 0.5) - 0.02));
  Object.assign(projectile, createEmptyDeadShiftProjectile(), {
    id: round.nextEntityId++, kind: definition.kind, ownerId: player.playerId, weapon: player.weapon,
    x: origin.x + direction.x * spawnOffset, y: origin.y + direction.y * spawnOffset, z: origin.z + direction.z * spawnOffset,
    vx: direction.x * definition.projectileSpeed,
    vy: direction.y * definition.projectileSpeed + (definition.kind === "grenade" ? 2.2 : 0),
    vz: direction.z * definition.projectileSpeed,
    radius, damage: definition.damage, splashRadius: definition.splashRadius,
    lifeRemaining: definition.kind === "grenade" ? 2 : 3,
    fuseRemaining: definition.kind === "grenade" ? GRENADE_FUSE_SEC : 0,
  });
  return projectile;
}

/**
 * Server-owned weapon switching, magazines, reloads and fire rate. This is called
 * once by the SDK for each world step, never from client prediction.
 * @param {DeadShiftRoundState} round
 * @param {DeadShiftPlayerState} player
 * @param {DeadShiftInputState} inputState
 * @param {number} dtSec
 */
export function stepDeadShiftCombat(round, player, inputState, dtSec) {
  if (!round.started || round.gameOver || !player.connected || player.health <= 0 || player.respawnRemaining > 0) return;
  const stepSec = clampDeadShiftNumber(Number.isFinite(dtSec) ? dtSec : 0, 0, MAX_PURE_STEP_SEC);
  const requestedWeapon = inputState.weapon;
  if (Number.isInteger(requestedWeapon) && requestedWeapon >= 0 && requestedWeapon < DEAD_SHIFT_WEAPONS.length && requestedWeapon !== player.weapon) {
    player.magazines[player.weapon] = player.ammo;
    player.weapon = requestedWeapon;
    player.ammo = player.magazines[requestedWeapon];
    player.reloadRemaining = 0;
  }
  const definition = DEAD_SHIFT_WEAPONS[player.weapon];
  // Retain sub-tick remainder while firing (the SMG interval is 4.5 ticks).
  // An already-ready trigger starts at zero, so idle time never stores credit.
  player.shotCooldown = player.shotCooldown > 0 ? player.shotCooldown - stepSec : 0;
  if (player.reloadRemaining > 0) {
    player.reloadRemaining = Math.max(0, player.reloadRemaining - stepSec);
    if (player.reloadRemaining < TIME_EPSILON_SEC) {
      player.reloadRemaining = 0;
      player.ammo = definition.magazineSize;
      player.magazines[player.weapon] = player.ammo;
    }
  }
  if (inputState.reload && !player.reloadHeld) startDeadShiftReload(player);
  player.reloadHeld = Boolean(inputState.reload);
  if (!inputState.fire || player.reloadRemaining > 0 || player.shotCooldown > TIME_EPSILON_SEC) {
    player.shotCooldown = Math.max(0, player.shotCooldown);
    return;
  }
  if (player.ammo <= 0) {
    startDeadShiftReload(player);
    return;
  }

  const yaw = Number.isFinite(inputState.yaw) ? inputState.yaw : player.yaw;
  const pitch = Number.isFinite(inputState.pitch) ? inputState.pitch : player.pitch;
  const direction = getDeadShiftAimDirection(yaw, pitch);
  let impact = { x: player.x + direction.x, y: player.y + DEAD_SHIFT_PLAYER_SETTINGS.eyeHeight, z: player.z + direction.z };
  if (definition.kind !== "hitscan") {
    const projectile = launchDeadShiftPlayerProjectile(round, player, direction, definition);
    if (!projectile) return;
    impact = projectile;
  } else {
    for (let pelletIndex = 0; pelletIndex < definition.pellets; pelletIndex += 1) {
      // A deterministic golden-angle pattern avoids random client/server state.
      const spreadRadius = definition.spread * Math.sqrt(pelletIndex / Math.max(1, definition.pellets - 1));
      const spreadAngle = pelletIndex * 2.399963229728653 + player.shotId * 1.618;
      const pelletDirection = getDeadShiftAimDirection(yaw + Math.cos(spreadAngle) * spreadRadius, pitch + Math.sin(spreadAngle) * spreadRadius);
      impact = fireDeadShiftHitscan(round, player, pelletDirection, definition);
    }
  }
  player.shotId += 1;
  player.ammo -= 1;
  player.magazines[player.weapon] = player.ammo;
  player.shotCooldown = Math.max(-stepSec, player.shotCooldown) + definition.fireIntervalSec;
  recordDeadShiftEvent(round, { kind: "shot", actorId: player.playerId, targetId: "", x: impact.x, y: impact.y, z: impact.z, value: 0, weapon: player.weapon });
  if (player.ammo === 0) startDeadShiftReload(player);
}

/**
 * Splash affects enemies only, and solid cover blocks damage at the impact.
 * @param {DeadShiftRoundState} round
 * @param {DeadShiftProjectileState} projectile
 */
function explodeDeadShiftProjectile(round, projectile) {
  if (projectile.ownerId !== "enemy") {
    for (const enemy of round.enemies) {
      if (!enemy.id || enemy.health <= 0) continue;
      const definition = ENEMY_DEFINITIONS[enemy.type];
      const target = { x: enemy.x, y: enemy.y + definition.height * 0.55, z: enemy.z };
      const distance = Math.hypot(target.x - projectile.x, target.y - projectile.y, target.z - projectile.z);
      if (distance > projectile.splashRadius + definition.radius || !hasDeadShiftLineOfSight(projectile, target)) continue;
      const falloff = 1 - Math.min(1, distance / projectile.splashRadius) * 0.6;
      damageDeadShiftEnemy(round, enemy, projectile.damage * falloff, projectile.ownerId, projectile.weapon);
    }
  }
  recordDeadShiftEvent(round, {
    kind: "explosion", actorId: projectile.ownerId, targetId: "", x: projectile.x, y: projectile.y, z: projectile.z,
    value: projectile.splashRadius, weapon: projectile.weapon,
  });
  Object.assign(projectile, createEmptyDeadShiftProjectile());
}

/**
 * Advance physical missiles with swept world/character contact. Grenades retain
 * their fuse through bounces; rockets and acid release on first swept contact.
 * @param {DeadShiftRoundState} round
 * @param {number} dtSec
 */
function stepDeadShiftProjectiles(round, dtSec) {
  for (const projectile of round.projectiles) {
    if (!projectile.id) continue;
    projectile.lifeRemaining -= dtSec;
    if (projectile.kind === "grenade") {
      projectile.fuseRemaining -= dtSec;
      if (projectile.fuseRemaining <= TIME_EPSILON_SEC || projectile.lifeRemaining <= 0) {
        explodeDeadShiftProjectile(round, projectile);
        continue;
      }
      projectile.vy -= GRENADE_GRAVITY * dtSec;
    } else if (projectile.lifeRemaining <= 0) {
      if (projectile.kind === "rocket") explodeDeadShiftProjectile(round, projectile);
      else Object.assign(projectile, createEmptyDeadShiftProjectile());
      continue;
    }
    const speed = Math.hypot(projectile.vx, projectile.vy, projectile.vz);
    if (speed < 0.00001) continue;
    const direction = { x: projectile.vx / speed, y: projectile.vy / speed, z: projectile.vz / speed };
    const travelDistance = speed * dtSec;
    const worldHit = traceDeadShiftWorld(projectile, direction, travelDistance, projectile.radius);
    let contactDistance = worldHit?.distance ?? travelDistance;
    let playerContact = null;
    let enemyContact = null;
    if (projectile.kind === "rocket") {
      for (const enemy of round.enemies) {
        if (!enemy.id || enemy.health <= 0) continue;
        const contact = intersectDeadShiftCharacter(projectile, direction, enemy, ENEMY_DEFINITIONS[enemy.type], projectile.radius);
        if (contact.distance < contactDistance) {
          contactDistance = contact.distance;
          enemyContact = enemy;
        }
      }
    } else if (projectile.kind === "acid") {
      for (const playerId of DEAD_SHIFT_PLAYER_IDS) {
        const player = round.players[playerId];
        if (!player.connected || player.health <= 0) continue;
        const contact = intersectDeadShiftCharacter(projectile, direction, player, {
          radius: DEAD_SHIFT_PLAYER_SETTINGS.radius, height: DEAD_SHIFT_PLAYER_SETTINGS.height,
          headHeight: DEAD_SHIFT_PLAYER_SETTINGS.eyeHeight, headRadius: 0.23,
        }, projectile.radius);
        if (contact.distance < contactDistance) {
          contactDistance = contact.distance;
          playerContact = player;
        }
      }
    }
    projectile.x += direction.x * Math.max(0, contactDistance - 0.001);
    projectile.y += direction.y * Math.max(0, contactDistance - 0.001);
    projectile.z += direction.z * Math.max(0, contactDistance - 0.001);
    const hitWorld = worldHit && !enemyContact && !playerContact;
    if (projectile.kind === "grenade" && hitWorld) {
      projectile.x += worldHit.nx * 0.003;
      projectile.y += worldHit.ny * 0.003;
      projectile.z += worldHit.nz * 0.003;
      const normalVelocity = projectile.vx * worldHit.nx + projectile.vy * worldHit.ny + projectile.vz * worldHit.nz;
      projectile.vx -= 1.45 * normalVelocity * worldHit.nx;
      projectile.vy -= 1.45 * normalVelocity * worldHit.ny;
      projectile.vz -= 1.45 * normalVelocity * worldHit.nz;
      if (worldHit.ny > 0) {
        projectile.vx *= 0.82;
        projectile.vz *= 0.82;
        if (Math.abs(projectile.vy) < 0.6) projectile.vy = 0;
      }
      projectile.bounces += 1;
    } else if (projectile.kind === "rocket" && (hitWorld || enemyContact)) {
      explodeDeadShiftProjectile(round, projectile);
    } else if (projectile.kind === "acid" && (hitWorld || playerContact)) {
      if (playerContact) damageDeadShiftPlayer(round, playerContact, projectile.damage, "enemy");
      recordDeadShiftEvent(round, {
        kind: "acid", actorId: "enemy", targetId: playerContact?.playerId ?? "", x: projectile.x, y: projectile.y, z: projectile.z,
        value: projectile.damage, weapon: -1,
      });
      Object.assign(projectile, createEmptyDeadShiftProjectile());
    }
  }
}

/** @param {DeadShiftRoundState} round @param {DeadShiftEnemyState} enemy */
function getDeadShiftEnemyTarget(round, enemy) {
  let nearestPlayer = null;
  let nearestDistance = Infinity;
  for (const playerId of DEAD_SHIFT_PLAYER_IDS) {
    const player = round.players[playerId];
    if (!player.connected || player.health <= 0) continue;
    const distance = Math.hypot(player.x - enemy.x, player.z - enemy.z);
    if (distance < nearestDistance) {
      nearestPlayer = player;
      nearestDistance = distance;
    }
  }
  return nearestPlayer;
}

/** @param {DeadShiftRoundState} round @param {DeadShiftEnemyState} enemy */
function launchDeadShiftAcid(round, enemy) {
  const projectile = round.projectiles.find((projectileState) => projectileState.id === 0);
  if (!projectile) return;
  const definition = ENEMY_DEFINITIONS[enemy.type];
  const origin = { x: enemy.x, y: enemy.y + definition.headHeight - 0.14, z: enemy.z };
  const deltaX = enemy.attackTargetX - origin.x;
  const deltaY = enemy.attackTargetY - origin.y;
  const deltaZ = enemy.attackTargetZ - origin.z;
  const distance = Math.hypot(deltaX, deltaY, deltaZ) || 1;
  Object.assign(projectile, createEmptyDeadShiftProjectile(), {
    id: round.nextEntityId++, kind: "acid", ownerId: "enemy", weapon: -1,
    x: origin.x, y: origin.y, z: origin.z,
    vx: deltaX / distance * 9, vy: deltaY / distance * 9, vz: deltaZ / distance * 9,
    damage: definition.damage, radius: 0.16, lifeRemaining: 3.8,
  });
}

/**
 * Complete a locked attack; players can evade its range or telegraphed direction.
 * @param {DeadShiftRoundState} round
 * @param {DeadShiftEnemyState} enemy
 */
function releaseDeadShiftEnemyAttack(round, enemy) {
  const definition = ENEMY_DEFINITIONS[enemy.type];
  enemy.damageId += 1;
  if (enemy.type === "spitter") {
    launchDeadShiftAcid(round, enemy);
    return;
  }
  const player = round.players[enemy.targetId];
  if (!player.connected || player.health <= 0) return;
  const deltaX = player.x - enemy.x;
  const deltaZ = player.z - enemy.z;
  const distance = Math.hypot(deltaX, deltaZ);
  const facingDot = distance < 0.001 ? 1 : (-Math.sin(enemy.yaw) * deltaX - Math.cos(enemy.yaw) * deltaZ) / distance;
  if (distance <= definition.attackRange + 0.15 && facingDot > 0.55 && player.y < 1.2 &&
      hasDeadShiftLineOfSight({ x: enemy.x, y: 1, z: enemy.z }, { x: player.x, y: player.y + 1, z: player.z })) {
    damageDeadShiftPlayer(round, player, definition.damage, "enemy");
  }
}

/** @param {DeadShiftRoundState} round @param {number} dtSec */
function stepDeadShiftEnemies(round, dtSec) {
  for (const enemy of round.enemies) {
    if (!enemy.id) continue;
    if (enemy.health <= 0) {
      enemy.deathRemaining -= dtSec;
      if (enemy.deathRemaining <= 0) Object.assign(enemy, createEmptyDeadShiftEnemy());
      continue;
    }
    const definition = ENEMY_DEFINITIONS[enemy.type];
    if (enemy.attackPhase === "windup") {
      enemy.attackRemaining -= dtSec;
      if (enemy.attackRemaining <= TIME_EPSILON_SEC) {
        releaseDeadShiftEnemyAttack(round, enemy);
        enemy.attackPhase = "recovery";
        enemy.attackRemaining = definition.recoverySec;
      }
      continue;
    }
    if (enemy.attackPhase === "recovery") {
      enemy.attackRemaining = Math.max(0, enemy.attackRemaining - dtSec);
      if (enemy.attackRemaining <= TIME_EPSILON_SEC) enemy.attackPhase = "idle";
    }
    const target = getDeadShiftEnemyTarget(round, enemy);
    if (!target) continue;
    enemy.targetId = target.playerId;
    const deltaX = target.x - enemy.x;
    const deltaZ = target.z - enemy.z;
    const distance = Math.hypot(deltaX, deltaZ);
    const lineOfSight = hasDeadShiftLineOfSight(
      { x: enemy.x, y: enemy.y + definition.headHeight - 0.14, z: enemy.z },
      { x: target.x, y: target.y + 1.1, z: target.z },
    );
    if (enemy.attackPhase === "idle" && distance <= definition.attackRange && lineOfSight &&
        (enemy.type !== "spitter" || distance >= 3.4)) {
      enemy.attackPhase = "windup";
      enemy.attackRemaining = definition.windupSec;
      enemy.attackTargetX = target.x;
      enemy.attackTargetY = target.y + 1.1;
      enemy.attackTargetZ = target.z;
      enemy.yaw = Math.atan2(-deltaX, -deltaZ);
      continue;
    }
    if (enemy.type === "spitter" && lineOfSight && distance >= 4 && distance <= 8.5) {
      enemy.yaw = Math.atan2(-deltaX, -deltaZ);
      continue;
    }
    enemy.pathRemaining -= dtSec;
    const reachedWaypoint = Math.hypot(enemy.x - enemy.pathX, enemy.z - enemy.pathZ) < 0.16;
    if (enemy.pathRemaining <= 0 || reachedWaypoint) {
      const waypoint = getDeadShiftNavigationWaypoint(enemy, target);
      enemy.pathX = waypoint.x;
      enemy.pathZ = waypoint.z;
      enemy.pathRemaining = 0.3 + (enemy.id % 7) * 0.025;
    }
    let moveX = enemy.pathX - enemy.x;
    let moveZ = enemy.pathZ - enemy.z;
    if (enemy.type === "spitter" && distance < 4 && lineOfSight) {
      moveX = -deltaX;
      moveZ = -deltaZ;
    }
    const routeDistance = Math.hypot(moveX, moveZ);
    if (routeDistance > 0.001) {
      const travelDistance = Math.min(routeDistance, definition.speed * dtSec);
      enemy.yaw = Math.atan2(-moveX, -moveZ);
      moveDeadShiftBody(enemy, moveX / routeDistance * travelDistance, moveZ / routeDistance * travelDistance, definition.radius, definition.height);
    }
  }
}

/**
 * Resolve bounded crowd contact after every entity has moved. Players retain
 * control of their own movement; enemy crowd pressure does not move their feet.
 * @param {DeadShiftRoundState} round
 */
function resolveDeadShiftCrowd(round) {
  const firstPlayer = round.players.p1;
  const secondPlayer = round.players.p2;
  for (let pass = 0; pass < 4; pass += 1) {
    if (firstPlayer.connected && secondPlayer.connected && firstPlayer.health > 0 && secondPlayer.health > 0) {
      separateDeadShiftBodies(firstPlayer, DEAD_SHIFT_PLAYER_SETTINGS.radius, secondPlayer, DEAD_SHIFT_PLAYER_SETTINGS.radius);
    }
    for (let index = 0; index < round.enemies.length; index += 1) {
      const enemy = round.enemies[index];
      if (!enemy.id || enemy.health <= 0) continue;
      const radius = ENEMY_DEFINITIONS[enemy.type].radius;
      for (let otherIndex = index + 1; otherIndex < round.enemies.length; otherIndex += 1) {
        const otherEnemy = round.enemies[otherIndex];
        if (!otherEnemy.id || otherEnemy.health <= 0) continue;
        separateDeadShiftBodies(enemy, radius, otherEnemy, ENEMY_DEFINITIONS[otherEnemy.type].radius);
      }
      for (const playerId of DEAD_SHIFT_PLAYER_IDS) {
        const player = round.players[playerId];
        if (player.connected && player.health > 0) {
          separateDeadShiftBodies(enemy, radius, player, DEAD_SHIFT_PLAYER_SETTINGS.radius, false);
        }
      }
    }
  }
}

/** @param {DeadShiftRoundState} round @param {DeadShiftPlayerState} player */
function respawnDeadShiftPlayer(round, player) {
  const defaultSpawn = { x: player.playerId === "p1" ? -3 : 3, z: 7 };
  const spawnCandidates = [defaultSpawn, { x: -12, z: 9 }, { x: 12, z: 9 }, { x: -12, z: -9 }, { x: 12, z: -9 }, { x: 0, z: -9 }];
  let selectedSpawn = defaultSpawn;
  let greatestClearance = -Infinity;
  for (const candidate of spawnCandidates) {
    let minimumDistance = Infinity;
    for (const enemy of round.enemies) {
      if (enemy.id && enemy.health > 0) minimumDistance = Math.min(minimumDistance, Math.hypot(enemy.x - candidate.x, enemy.z - candidate.z));
    }
    const opponent = round.players[player.playerId === "p1" ? "p2" : "p1"];
    if (opponent.health > 0 && opponent.connected && Math.hypot(opponent.x - candidate.x, opponent.z - candidate.z) < 1) continue;
    if (minimumDistance > greatestClearance) {
      greatestClearance = minimumDistance;
      selectedSpawn = candidate;
    }
    if (candidate === defaultSpawn && minimumDistance > 4) break;
  }
  Object.assign(player, {
    respawnId: player.respawnId + 1,
    x: selectedSpawn.x, y: 0, z: selectedSpawn.z, vx: 0, vy: 0, vz: 0,
    health: DEAD_SHIFT_PLAYER_SETTINGS.maxHealth, respawnRemaining: 0,
    invulnerabilityRemaining: DEAD_SHIFT_PLAYER_SETTINGS.respawnInvulnerabilitySec,
    reloadRemaining: 0, reloadHeld: false, jumpHeld: false, shotCooldown: 0,
    magazines: DEAD_SHIFT_WEAPONS.map((weapon) => weapon.magazineSize),
    ammo: DEAD_SHIFT_WEAPONS[player.weapon].magazineSize,
  });
  recordDeadShiftEvent(round, { kind: "respawn", actorId: player.playerId, targetId: player.playerId, x: player.x, y: 0, z: player.z, value: 100, weapon: player.weapon });
}

/** @param {DeadShiftRoundState} round @param {number} dtSec */
function stepDeadShiftRespawns(round, dtSec) {
  for (const playerId of DEAD_SHIFT_PLAYER_IDS) {
    const player = round.players[playerId];
    player.invulnerabilityRemaining = Math.max(0, player.invulnerabilityRemaining - dtSec);
    if (player.respawnRemaining <= 0 || !player.connected) continue;
    player.respawnRemaining = Math.max(0, player.respawnRemaining - dtSec);
    if (player.respawnRemaining <= TIME_EPSILON_SEC) respawnDeadShiftPlayer(round, player);
  }
}

/** @param {DeadShiftRoundState} round @param {number} dtSec */
function stepDeadShiftSpawning(round, dtSec) {
  round.spawnRemaining -= dtSec;
  if (round.spawnRemaining > 0) return;
  const elapsedSec = round.durationSec - round.timer;
  const activeEnemyCount = round.enemies.reduce((count, enemy) => count + (enemy.id > 0 && enemy.health > 0 ? 1 : 0), 0);
  const targetEnemyCount = Math.min(22, 8 + Math.floor(elapsedSec / 7));
  round.spawnRemaining = Math.max(0.35, 0.75 - elapsedSec * 0.004);
  if (activeEnemyCount >= targetEnemyCount) return;
  const spawnPoint = DEAD_SHIFT_SPAWN_POINTS[round.spawnIndex % DEAD_SHIFT_SPAWN_POINTS.length];
  const spawnPattern = ["walker", "runner", "walker", "spitter", "walker", "brute", "runner", "walker"];
  const type = /** @type {DeadShiftEnemyTypeId} */ (spawnPattern[round.spawnIndex % spawnPattern.length]);
  const nearestPlayerDistance = Math.min(...DEAD_SHIFT_PLAYER_IDS.map((playerId) => {
    const player = round.players[playerId];
    return player.connected && player.health > 0 ? Math.hypot(player.x - spawnPoint.x, player.z - spawnPoint.z) : Infinity;
  }));
  round.spawnIndex += 1;
  if (nearestPlayerDistance >= 3.5) spawnDeadShiftEnemy(round, type, spawnPoint.x, spawnPoint.z);
}

/**
 * Advance only the authoritative shared world after both player commands. The
 * host scheduler supplies fixed 60 Hz steps; defensive clamping bounds direct
 * callers. Idle/finished rounds remain unchanged.
 * @param {DeadShiftRoundState} round
 * @param {number} dtSec
 * @param {{spawnEnemies?:boolean}} [options]
 */
export function stepDeadShiftWorld(round, dtSec, { spawnEnemies = true } = {}) {
  if (!round.started || round.gameOver) return;
  const stepSec = clampDeadShiftNumber(Number.isFinite(dtSec) ? dtSec : 0, 0, MAX_PURE_STEP_SEC);
  if (stepSec <= 0) return;
  stepDeadShiftRespawns(round, stepSec);
  if (spawnEnemies) stepDeadShiftSpawning(round, stepSec);
  stepDeadShiftEnemies(round, stepSec);
  stepDeadShiftProjectiles(round, stepSec);
  resolveDeadShiftCrowd(round);
  round.timer = Math.max(0, round.timer - stepSec);
  if (round.timer <= TIME_EPSILON_SEC) {
    round.timer = 0;
    round.gameOver = true;
    const difference = round.players.p1.kills - round.players.p2.kills;
    round.winner = difference > 0 ? "p1" : difference < 0 ? "p2" : "tie";
  }
}

/**
 * Pure convenience entry for deterministic tests and game-owned offline tools.
 * Production networking uses the SDK to call player/combat, then world once.
 * @param {DeadShiftRoundState} round
 * @param {Partial<Record<DeadShiftPlayerId,DeadShiftInputState>>} inputs
 * @param {number} [dtSec]
 * @param {{spawnEnemies?:boolean}} [options]
 */
export function stepDeadShiftRound(round, inputs, dtSec = DEAD_SHIFT_FIXED_DT_SEC, options = {}) {
  if (!round.started || round.gameOver) return;
  for (const playerId of DEAD_SHIFT_PLAYER_IDS) {
    const player = round.players[playerId];
    const inputState = inputs[playerId] || DEAD_SHIFT_INPUT_TEMPLATE;
    stepDeadShiftPlayer(player, inputState, dtSec, { active: player.connected });
    stepDeadShiftCombat(round, player, inputState, dtSec);
  }
  stepDeadShiftWorld(round, dtSec, options);
}
