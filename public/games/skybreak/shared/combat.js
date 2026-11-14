import { SKYBREAK_ARENA, SKYBREAK_COMBAT_SETTINGS } from "./config.js";
import { getSkybreakGroundClearanceHeight } from "./terrain.js";

/** @typedef {import("./flight.js").SkybreakJet} SkybreakJet */
/** @typedef {import("./config.js").SkybreakInputState} SkybreakInputState */
/** @typedef {import("./config.js").SkybreakWeapon} SkybreakWeapon */
/**
 * @typedef {object} SkybreakMissile Authoritative and snapshotted.
 * @property {number} id
 * @property {string} ownerId
 * @property {string|null} targetId Null once decoyed or fired without a lock.
 * @property {number} decoyIndex Flare it chases, or -1.
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} vx
 * @property {number} vy
 * @property {number} vz
 * @property {number} lifeSec
 * @typedef {{active:boolean,x:number,y:number,z:number,vx:number,vy:number,vz:number,lifeSec:number,ownerId:string,lagTicks:number}} SkybreakBullet Server-only.
 * @typedef {{active:boolean,x:number,y:number,z:number,vx:number,vy:number,vz:number,lifeSec:number}} SkybreakFlare Server-only decoy.
 * @typedef {{serial:number,killerId:string|null,victimId:string,cause:SkybreakWeapon}} SkybreakKill
 * @typedef {{x:Float64Array,y:Float64Array,z:Float64Array,alive:Uint8Array}} SkybreakPoseTrack
 *
 * @typedef {object} SkybreakCombatState Fields of a match used by combat.
 * @property {number} tick
 * @property {number} timeSec
 * @property {number} historyHead
 * @property {Record<string,SkybreakPoseTrack>} poseHistory Server-only.
 * @property {SkybreakBullet[]} bullets Server-only pool.
 * @property {SkybreakFlare[]} flareDecoys Server-only pool.
 * @property {SkybreakMissile[]} missiles
 * @property {number} nextMissileId
 * @property {SkybreakKill[]} killFeed Most recent kills, newest last.
 * @property {number} killSerial
 */

const BULLET_POOL_SIZE = 128;
const FLARE_POOL_SIZE = 24;
const KILL_FEED_LENGTH = 5;
const KILL_CREDIT_WINDOW_SEC = 5;
const FLARE_DROP_SPEED = 25;

/** Allocate the server-side pools and history for a match. @param {readonly string[]} jetIds */
export function createSkybreakCombatPools(jetIds) {
  const poseHistory = {};
  for (const jetId of jetIds) {
    const size = SKYBREAK_COMBAT_SETTINGS.poseHistoryTicks;
    poseHistory[jetId] = { x: new Float64Array(size), y: new Float64Array(size), z: new Float64Array(size), alive: new Uint8Array(size) };
  }
  return {
    historyHead: 0,
    poseHistory,
    bullets: Array.from({ length: BULLET_POOL_SIZE }, () => ({ active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, lifeSec: 0, ownerId: "", lagTicks: 0 })),
    flareDecoys: Array.from({ length: FLARE_POOL_SIZE }, () => ({ active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, lifeSec: 0 })),
  };
}

/**
 * Record every jet's pose for this tick so hits can be judged against what
 * a shooter actually saw. A fixed ring: no allocation per tick.
 * @param {SkybreakCombatState} state
 * @param {readonly SkybreakJet[]} jets
 */
export function recordSkybreakPoses(state, jets) {
  const size = SKYBREAK_COMBAT_SETTINGS.poseHistoryTicks;
  state.historyHead = (state.historyHead + 1) % size;
  for (const jet of jets) {
    const track = state.poseHistory[jet.id];
    if (!track) continue;
    track.x[state.historyHead] = jet.x;
    track.y[state.historyHead] = jet.y;
    track.z[state.historyHead] = jet.z;
    track.alive[state.historyHead] = jet.alive && jet.shieldSec <= 0 ? 1 : 0;
  }
}

/**
 * Where a jet was `ticksBack` ticks ago, written into `target`.
 * @param {SkybreakCombatState} state
 * @param {string} jetId
 * @param {number} ticksBack Clamped to the recorded history.
 * @param {{x:number,y:number,z:number,alive:boolean}} target
 * @returns {boolean} False when the jet has no history.
 */
export function sampleSkybreakPose(state, jetId, ticksBack, target) {
  const track = state.poseHistory[jetId];
  if (!track) return false;
  const size = SKYBREAK_COMBAT_SETTINGS.poseHistoryTicks;
  const back = Math.max(0, Math.min(size - 1, Math.round(ticksBack)));
  const slot = (state.historyHead - back + size) % size;
  target.x = track.x[slot];
  target.y = track.y[slot];
  target.z = track.z[slot];
  target.alive = track.alive[slot] === 1;
  return true;
}

/** @param {SkybreakCombatState} state @param {SkybreakJet} jet @param {number} lagTicks */
function spawnSkybreakBullet(state, jet, lagTicks) {
  const bullet = state.bullets.find((candidate) => !candidate.active);
  if (!bullet) return;
  const settings = SKYBREAK_COMBAT_SETTINGS;
  bullet.active = true;
  bullet.x = jet.x + jet.forwardX * settings.muzzleForwardM;
  bullet.y = jet.y + jet.forwardY * settings.muzzleForwardM;
  bullet.z = jet.z + jet.forwardZ * settings.muzzleForwardM;
  bullet.vx = jet.forwardX * (settings.bulletSpeed + jet.speed);
  bullet.vy = jet.forwardY * (settings.bulletSpeed + jet.speed);
  bullet.vz = jet.forwardZ * (settings.bulletSpeed + jet.speed);
  bullet.lifeSec = settings.bulletLifeSec;
  bullet.ownerId = jet.id;
  bullet.lagTicks = Math.max(0, Math.min(settings.maxViewLagTicks, Math.round(lagTicks)));
}

/**
 * Best lock candidate: the live rival nearest the nose inside the lock cone.
 * @param {SkybreakJet} jet
 * @param {readonly SkybreakJet[]} jets
 * @returns {SkybreakJet|null}
 */
export function findSkybreakLockTarget(jet, jets) {
  const settings = SKYBREAK_COMBAT_SETTINGS;
  const coneCos = Math.cos(settings.lockConeRad);
  let best = null;
  let bestAlignment = coneCos;
  for (const target of jets) {
    if (target === jet || !target.alive || target.shieldSec > 0) continue;
    const offsetX = target.x - jet.x;
    const offsetY = target.y - jet.y;
    const offsetZ = target.z - jet.z;
    const distance = Math.hypot(offsetX, offsetY, offsetZ);
    if (distance > settings.lockRangeM || distance < 1) continue;
    const alignment = (offsetX * jet.forwardX + offsetY * jet.forwardY + offsetZ * jet.forwardZ) / distance;
    if (alignment > bestAlignment) {
      bestAlignment = alignment;
      best = target;
    }
  }
  return best;
}

/**
 * Cannon heat and fire, missile lock and launch, and flares for one jet.
 * Server-only: spawns authoritative rounds, missiles and decoys.
 * @param {SkybreakJet} jet
 * @param {Readonly<SkybreakInputState>} input
 * @param {number} stepSec
 * @param {SkybreakCombatState} state
 * @param {readonly SkybreakJet[]} jets
 */
export function stepSkybreakWeapons(jet, input, stepSec, state, jets) {
  const settings = SKYBREAK_COMBAT_SETTINGS;
  const missilePressed = Boolean(input.missile) && !jet.missileHeld;
  const flarePressed = Boolean(input.flare) && !jet.flareHeld;
  jet.missileHeld = Boolean(input.missile);
  jet.flareHeld = Boolean(input.flare);
  jet.fireCooldownSec = Math.max(-settings.fireIntervalSec, jet.fireCooldownSec - stepSec);
  jet.overheatSec = Math.max(0, jet.overheatSec - stepSec);
  jet.heat = Math.max(0, jet.heat - settings.heatCoolPerSec * stepSec);
  jet.shieldSec = Math.max(0, jet.shieldSec - stepSec);
  if (!jet.alive) {
    jet.cannonFiring = false;
    jet.lockTargetId = null;
    jet.lockProgress = 0;
    return;
  }

  const firing = Boolean(input.fire) && jet.overheatSec <= 0;
  jet.cannonFiring = firing;
  while (firing && jet.fireCooldownSec <= 0 && jet.overheatSec <= 0) {
    spawnSkybreakBullet(state, jet, input.viewLagTicks);
    jet.fireCooldownSec += settings.fireIntervalSec;
    jet.heat += settings.heatPerShot;
    if (jet.heat >= 1) {
      jet.heat = 1;
      jet.overheatSec = settings.overheatSec;
      jet.cannonFiring = false;
    }
  }
  if (!firing) jet.fireCooldownSec = Math.max(0, jet.fireCooldownSec);

  if (jet.missiles < settings.maxMissiles) {
    jet.missileReloadSec = Math.max(0, jet.missileReloadSec - stepSec);
    if (jet.missileReloadSec <= 0) {
      jet.missiles += 1;
      if (jet.missiles < settings.maxMissiles) jet.missileReloadSec = settings.missileReloadSec;
    }
  }
  const lockTarget = findSkybreakLockTarget(jet, jets);
  if (lockTarget && lockTarget.id === jet.lockTargetId) {
    jet.lockProgress = Math.min(1, jet.lockProgress + stepSec / settings.lockTimeSec);
  } else {
    jet.lockTargetId = lockTarget ? lockTarget.id : null;
    jet.lockProgress = 0;
  }
  if (missilePressed && jet.missiles > 0 && state.missiles.length < settings.maxActiveMissiles) {
    if (jet.missiles === settings.maxMissiles) jet.missileReloadSec = settings.missileReloadSec;
    jet.missiles -= 1;
    const launchSpeed = settings.missileSpeed + jet.speed * 0.5;
    state.missiles.push({
      id: state.nextMissileId,
      ownerId: jet.id,
      targetId: jet.lockProgress >= 1 ? jet.lockTargetId : null,
      decoyIndex: -1,
      x: jet.x - jet.upX * 1.5,
      y: jet.y - jet.upY * 1.5,
      z: jet.z - jet.upZ * 1.5,
      vx: jet.forwardX * launchSpeed,
      vy: jet.forwardY * launchSpeed,
      vz: jet.forwardZ * launchSpeed,
      lifeSec: settings.missileLifeSec,
    });
    state.nextMissileId += 1;
    jet.lockProgress = 0;
  }

  if (jet.flares < settings.maxFlares) {
    jet.flareRechargeSec = Math.max(0, jet.flareRechargeSec - stepSec);
    if (jet.flareRechargeSec <= 0) {
      jet.flares += 1;
      if (jet.flares < settings.maxFlares) jet.flareRechargeSec = settings.flareRechargeSec;
    }
  }
  if (flarePressed && jet.flares > 0) {
    if (jet.flares === settings.maxFlares) jet.flareRechargeSec = settings.flareRechargeSec;
    jet.flares -= 1;
    jet.flareSerial += 1;
    deploySkybreakFlare(state, jet);
  }
}

/**
 * Drop a decoy and pull every missile chasing this jet onto it, if close
 * enough to be fooled.
 * @param {SkybreakCombatState} state
 * @param {SkybreakJet} jet
 */
function deploySkybreakFlare(state, jet) {
  const decoyIndex = state.flareDecoys.findIndex((decoy) => !decoy.active);
  if (decoyIndex < 0) return;
  const decoy = state.flareDecoys[decoyIndex];
  Object.assign(decoy, {
    active: true,
    x: jet.x, y: jet.y, z: jet.z,
    vx: jet.forwardX * jet.speed * 0.4, vy: -FLARE_DROP_SPEED, vz: jet.forwardZ * jet.speed * 0.4,
    lifeSec: SKYBREAK_COMBAT_SETTINGS.flareLifeSec,
  });
  for (const missile of state.missiles) {
    if (missile.targetId !== jet.id) continue;
    if (Math.hypot(missile.x - jet.x, missile.y - jet.y, missile.z - jet.z) > SKYBREAK_COMBAT_SETTINGS.flareDecoyRangeM) continue;
    missile.targetId = null;
    missile.decoyIndex = decoyIndex;
  }
}

/**
 * Apply damage, crediting the attacker. Returns true when this killed the jet.
 * @param {SkybreakCombatState & {players:Record<string,SkybreakJet>,bots:SkybreakJet[]}} state
 * @param {SkybreakJet} victim
 * @param {number} amount
 * @param {SkybreakJet|null} attacker
 * @param {SkybreakWeapon} cause
 */
export function damageSkybreakJet(state, victim, amount, attacker, cause) {
  if (!victim.alive || victim.shieldSec > 0) return false;
  victim.health = Math.max(0, victim.health - amount);
  victim.hitSerial += 1;
  if (attacker) {
    attacker.hitConfirmSerial += 1;
    victim.lastKillerId = attacker.id;
    victim.lastAttackTimeSec = state.timeSec;
  }
  if (victim.health > 0) return false;
  killSkybreakJet(state, victim, attacker, cause);
  return true;
}

/**
 * Destroy a jet. Crashes and boundary deaths credit whoever damaged it
 * within the last few seconds, so forcing a rival into a wall counts.
 * @param {SkybreakCombatState & {players:Record<string,SkybreakJet>,bots:SkybreakJet[]}} state
 * @param {SkybreakJet} victim
 * @param {SkybreakJet|null} attacker
 * @param {SkybreakWeapon} cause
 */
export function killSkybreakJet(state, victim, attacker, cause) {
  if (!victim.alive) return;
  let killer = attacker;
  if (!killer && victim.lastKillerId && state.timeSec - (victim.lastAttackTimeSec ?? -Infinity) <= KILL_CREDIT_WINDOW_SEC) {
    killer = state.players[victim.lastKillerId] ?? state.bots.find((bot) => bot.id === victim.lastKillerId) ?? null;
  }
  victim.alive = false;
  victim.health = 0;
  victim.cannonFiring = false;
  victim.respawnSec = SKYBREAK_COMBAT_SETTINGS.respawnSec;
  victim.deathSerial += 1;
  victim.deaths += 1;
  victim.lastDeathCause = cause;
  victim.lastKillerId = killer ? killer.id : null;
  if (killer && killer !== victim) killer.kills += 1;
  state.killSerial += 1;
  state.killFeed.push({ serial: state.killSerial, killerId: killer && killer !== victim ? killer.id : null, victimId: victim.id, cause });
  if (state.killFeed.length > KILL_FEED_LENGTH) state.killFeed.shift();
}

const segmentTarget = { x: 0, y: 0, z: 0, alive: false };

/**
 * Move rounds and test each against rivals rewound by the shooter's view
 * delay, so a round that hit on the shooter's screen hits on the server.
 * @param {SkybreakCombatState & {players:Record<string,SkybreakJet>,bots:SkybreakJet[]}} state
 * @param {readonly SkybreakJet[]} jets
 * @param {number} stepSec
 */
export function stepSkybreakBullets(state, jets, stepSec) {
  const radius = SKYBREAK_COMBAT_SETTINGS.hitRadiusM;
  for (const bullet of state.bullets) {
    if (!bullet.active) continue;
    const startX = bullet.x;
    const startY = bullet.y;
    const startZ = bullet.z;
    const moveX = bullet.vx * stepSec;
    const moveY = bullet.vy * stepSec;
    const moveZ = bullet.vz * stepSec;
    const lengthSquared = moveX * moveX + moveY * moveY + moveZ * moveZ;
    bullet.x += moveX;
    bullet.y += moveY;
    bullet.z += moveZ;
    bullet.lifeSec -= stepSec;
    if (bullet.lifeSec <= 0 || bullet.y <= getSkybreakGroundClearanceHeight(bullet.x, bullet.z)) {
      bullet.active = false;
      continue;
    }
    for (const target of jets) {
      if (target.id === bullet.ownerId) continue;
      if (!sampleSkybreakPose(state, target.id, bullet.lagTicks, segmentTarget) || !segmentTarget.alive || !target.alive) continue;
      const toX = segmentTarget.x - startX;
      const toY = segmentTarget.y - startY;
      const toZ = segmentTarget.z - startZ;
      const amount = Math.max(0, Math.min(1, (toX * moveX + toY * moveY + toZ * moveZ) / lengthSquared));
      const missX = toX - moveX * amount;
      const missY = toY - moveY * amount;
      const missZ = toZ - moveZ * amount;
      if (missX * missX + missY * missY + missZ * missZ > radius * radius) continue;
      bullet.active = false;
      const shooter = state.players[bullet.ownerId] ?? state.bots.find((bot) => bot.id === bullet.ownerId) ?? null;
      damageSkybreakJet(state, target, SKYBREAK_COMBAT_SETTINGS.bulletDamage, shooter, "cannon");
      break;
    }
  }
}

/**
 * Steer missiles with a turn-rate limit toward their target or decoy, then
 * detonate on proximity, terrain or burnout. Out-turning a missile works.
 * @param {SkybreakCombatState & {players:Record<string,SkybreakJet>,bots:SkybreakJet[]}} state
 * @param {readonly SkybreakJet[]} jets
 * @param {number} stepSec
 */
export function stepSkybreakMissiles(state, jets, stepSec) {
  const settings = SKYBREAK_COMBAT_SETTINGS;
  for (const jet of jets) jet.incomingMissile = false;
  for (const decoy of state.flareDecoys) {
    if (!decoy.active) continue;
    decoy.lifeSec -= stepSec;
    decoy.vy -= 9.81 * stepSec;
    decoy.x += decoy.vx * stepSec;
    decoy.y += decoy.vy * stepSec;
    decoy.z += decoy.vz * stepSec;
    if (decoy.lifeSec <= 0) decoy.active = false;
  }

  for (let index = state.missiles.length - 1; index >= 0; index -= 1) {
    const missile = state.missiles[index];
    missile.lifeSec -= stepSec;
    const target = missile.targetId ? jets.find((jet) => jet.id === missile.targetId && jet.alive) ?? null : null;
    const decoy = missile.decoyIndex >= 0 && state.flareDecoys[missile.decoyIndex]?.active ? state.flareDecoys[missile.decoyIndex] : null;
    const aim = target ?? decoy;
    const speed = Math.hypot(missile.vx, missile.vy, missile.vz) || settings.missileSpeed;
    if (aim) {
      if (target) target.incomingMissile = true;
      const desiredX = aim.x - missile.x;
      const desiredY = aim.y - missile.y;
      const desiredZ = aim.z - missile.z;
      const desiredLength = Math.hypot(desiredX, desiredY, desiredZ) || 1;
      const currentX = missile.vx / speed;
      const currentY = missile.vy / speed;
      const currentZ = missile.vz / speed;
      const blend = Math.min(1, (settings.missileTurnRateRad * stepSec) / Math.max(1e-3, Math.acos(Math.max(-1, Math.min(1, (currentX * desiredX + currentY * desiredY + currentZ * desiredZ) / desiredLength)))));
      const nextX = currentX + (desiredX / desiredLength - currentX) * blend;
      const nextY = currentY + (desiredY / desiredLength - currentY) * blend;
      const nextZ = currentZ + (desiredZ / desiredLength - currentZ) * blend;
      const nextLength = Math.hypot(nextX, nextY, nextZ) || 1;
      missile.vx = (nextX / nextLength) * speed;
      missile.vy = (nextY / nextLength) * speed;
      missile.vz = (nextZ / nextLength) * speed;
    }
    missile.x += missile.vx * stepSec;
    missile.y += missile.vy * stepSec;
    missile.z += missile.vz * stepSec;

    let detonate = missile.lifeSec <= 0 || missile.y <= getSkybreakGroundClearanceHeight(missile.x, missile.z);
    if (decoy && Math.hypot(decoy.x - missile.x, decoy.y - missile.y, decoy.z - missile.z) < settings.missileProximityM) detonate = true;
    if (!detonate) {
      for (const jet of jets) {
        if (jet.id === missile.ownerId || !jet.alive) continue;
        if (Math.hypot(jet.x - missile.x, jet.y - missile.y, jet.z - missile.z) > settings.missileProximityM) continue;
        const owner = state.players[missile.ownerId] ?? state.bots.find((bot) => bot.id === missile.ownerId) ?? null;
        damageSkybreakJet(state, jet, settings.missileDamage, owner, "missile");
        detonate = true;
        break;
      }
    }
    if (detonate) state.missiles.splice(index, 1);
  }
}

/**
 * Crashes and lingering outside the arena destroy or damage jets.
 * @param {SkybreakCombatState & {players:Record<string,SkybreakJet>,bots:SkybreakJet[]}} state
 * @param {readonly SkybreakJet[]} jets
 * @param {number} stepSec
 */
export function applySkybreakHazards(state, jets, stepSec) {
  for (const jet of jets) {
    if (!jet.alive) continue;
    if (jet.crashed) {
      jet.crashed = false;
      killSkybreakJet(state, jet, null, "terrain");
      continue;
    }
    if (jet.outsideSec > SKYBREAK_ARENA.boundaryGraceSec) {
      jet.health = Math.max(0, jet.health - SKYBREAK_ARENA.boundaryDamagePerSec * stepSec);
      if (jet.health <= 0) killSkybreakJet(state, jet, null, "boundary");
    }
  }
}
