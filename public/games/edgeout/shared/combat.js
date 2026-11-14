import { EDGEOUT_CHARACTER_SETTINGS, EDGEOUT_COMBAT_SETTINGS } from "./config.js";

/** @typedef {import("./simulation.js").EdgeoutFighter} EdgeoutFighter */
/** @typedef {import("./config.js").EdgeoutHitKind} EdgeoutHitKind */
/** @typedef {{attacker:EdgeoutFighter,target:EdgeoutFighter,kind:"shove"|"dash"}} EdgeoutPendingHit */

const DASH_FRONT_COS = 0.3;
const DASH_ATTACKER_RETAINED_SPEED = 0.25;
const BLEND_TOWARD_FACING = 0.5;
const MIN_DISTANCE = 1e-4;
/** Hit records are pooled; at most one shove and one dash per attacker per step. */
const pendingHits = [];
const hitPool = [];
const knockbackDirection = { x: 0, z: 0 };

/** @param {Readonly<EdgeoutFighter>} fighter @returns {boolean} */
function isEdgeoutShoveActive(fighter) {
  const activeFromSec = EDGEOUT_COMBAT_SETTINGS.shoveWindupSec;
  const activeUntilSec = activeFromSec + EDGEOUT_COMBAT_SETTINGS.shoveActiveSec;
  return fighter.action === "shove" && fighter.actionTimeSec >= activeFromSec &&
    fighter.actionTimeSec <= activeUntilSec && fighter.shoveHitId !== fighter.actionId;
}

/** @param {Readonly<EdgeoutFighter>} fighter @returns {boolean} */
function isEdgeoutDashHitReady(fighter) {
  return fighter.action === "dash" && fighter.dashRemainingSec > 0 && fighter.dashHitId !== fighter.actionId;
}

/**
 * Nearest standing rival inside the attacker's reach and frontal arc.
 * @param {Readonly<EdgeoutFighter>} attacker
 * @param {readonly EdgeoutFighter[]} fighters
 * @param {number} reach Centre-to-centre distance.
 * @param {number} arcCos Minimum cosine between facing and the rival direction.
 * @returns {EdgeoutFighter|null}
 */
function findEdgeoutTarget(attacker, fighters, reach, arcCos) {
  const facingX = Math.sin(attacker.facing);
  const facingZ = Math.cos(attacker.facing);
  let nearest = null;
  let nearestDistanceSquared = reach * reach;
  for (const target of fighters) {
    if (target === attacker || target.eliminated || !target.grounded) continue;
    const offsetX = target.x - attacker.x;
    const offsetZ = target.z - attacker.z;
    const distanceSquared = offsetX * offsetX + offsetZ * offsetZ;
    if (distanceSquared > nearestDistanceSquared) continue;
    const distance = Math.sqrt(distanceSquared);
    if (distance > MIN_DISTANCE && (offsetX * facingX + offsetZ * facingZ) / distance < arcCos) continue;
    nearest = target;
    nearestDistanceSquared = distanceSquared;
  }
  return nearest;
}

/**
 * Knockback travels mostly away from the attacker, bent toward its facing so
 * aim matters. Writes the shared direction scratch.
 * @param {Readonly<EdgeoutFighter>} attacker
 * @param {Readonly<EdgeoutFighter>} target
 */
function writeEdgeoutKnockbackDirection(attacker, target) {
  const offsetX = target.x - attacker.x;
  const offsetZ = target.z - attacker.z;
  const distance = Math.hypot(offsetX, offsetZ);
  const awayX = distance > MIN_DISTANCE ? offsetX / distance : Math.sin(attacker.facing);
  const awayZ = distance > MIN_DISTANCE ? offsetZ / distance : Math.cos(attacker.facing);
  const blendedX = awayX * (1 - BLEND_TOWARD_FACING) + Math.sin(attacker.facing) * BLEND_TOWARD_FACING;
  const blendedZ = awayZ * (1 - BLEND_TOWARD_FACING) + Math.cos(attacker.facing) * BLEND_TOWARD_FACING;
  const blendedLength = Math.hypot(blendedX, blendedZ) || 1;
  knockbackDirection.x = blendedX / blendedLength;
  knockbackDirection.z = blendedZ / blendedLength;
}

/**
 * A block only covers attacks from the front.
 * @param {Readonly<EdgeoutFighter>} defender
 * @param {Readonly<EdgeoutFighter>} attacker
 * @returns {boolean}
 */
function isEdgeoutGuarding(defender, attacker) {
  if (defender.action !== "block") return false;
  const offsetX = attacker.x - defender.x;
  const offsetZ = attacker.z - defender.z;
  const distance = Math.hypot(offsetX, offsetZ);
  if (distance <= MIN_DISTANCE) return true;
  return (offsetX * Math.sin(defender.facing) + offsetZ * Math.cos(defender.facing)) / distance >= EDGEOUT_COMBAT_SETTINGS.blockArcCos;
}

/** @param {number} damage @returns {number} Knockback multiplier. */
function getEdgeoutDamageScale(damage) {
  return 1 + damage * EDGEOUT_COMBAT_SETTINGS.damageKnockbackScale;
}

/**
 * Launch a fighter, cancel its action and stun it for a duration that grows
 * with the launch speed.
 * @param {EdgeoutFighter} target
 * @param {number} directionX
 * @param {number} directionZ
 * @param {number} speed
 * @param {EdgeoutHitKind} kind
 * @param {number} [stunSec] Fixed stun; derived from speed when omitted.
 */
function launchEdgeoutFighter(target, directionX, directionZ, speed, kind, stunSec) {
  target.vx = directionX * speed;
  target.vz = directionZ * speed;
  target.stunSec = stunSec ?? Math.min(
    EDGEOUT_COMBAT_SETTINGS.maxHitStunSec,
    EDGEOUT_COMBAT_SETTINGS.hitStunBaseSec + EDGEOUT_COMBAT_SETTINGS.hitStunPerSpeedSec * speed,
  );
  target.chargeSec = 0;
  target.dashRemainingSec = 0;
  target.blockSec = 0;
  target.hitSerial += 1;
  target.lastHitKind = kind;
  target.lastHitSpeed = speed;
  target.action = "stunned";
  target.actionId += 1;
  target.actionTimeSec = 0;
}

/** @param {EdgeoutFighter} target @param {number} amount */
function addEdgeoutDamage(target, amount) {
  target.damage = Math.min(EDGEOUT_COMBAT_SETTINGS.maxDamage, target.damage + amount);
}

/**
 * Resolve one connecting shove: parry, blocked push, or full launch.
 * @param {EdgeoutFighter} attacker
 * @param {EdgeoutFighter} target
 */
function applyEdgeoutShove(attacker, target) {
  const power = attacker.shovePower;
  writeEdgeoutKnockbackDirection(attacker, target);
  if (isEdgeoutGuarding(target, attacker)) {
    if (target.blockSec <= EDGEOUT_COMBAT_SETTINGS.parryWindowSec) {
      target.parrySerial += 1;
      launchEdgeoutFighter(attacker, -knockbackDirection.x, -knockbackDirection.z,
        EDGEOUT_COMBAT_SETTINGS.parryRecoilSpeed, "parried", EDGEOUT_COMBAT_SETTINGS.parryStunSec);
      return;
    }
    addEdgeoutDamage(target, EDGEOUT_COMBAT_SETTINGS.blockChipDamage);
    const blockedSpeed = lerpEdgeout(EDGEOUT_COMBAT_SETTINGS.quickShoveKnockback, EDGEOUT_COMBAT_SETTINGS.chargedShoveKnockback, power) *
      EDGEOUT_COMBAT_SETTINGS.blockKnockbackScale * getEdgeoutDamageScale(target.damage);
    target.vx = knockbackDirection.x * blockedSpeed;
    target.vz = knockbackDirection.z * blockedSpeed;
    target.hitSerial += 1;
    target.lastHitKind = "blocked";
    target.lastHitSpeed = blockedSpeed;
    return;
  }

  addEdgeoutDamage(target, lerpEdgeout(EDGEOUT_COMBAT_SETTINGS.quickShoveDamage, EDGEOUT_COMBAT_SETTINGS.chargedShoveDamage, power));
  const speed = lerpEdgeout(EDGEOUT_COMBAT_SETTINGS.quickShoveKnockback, EDGEOUT_COMBAT_SETTINGS.chargedShoveKnockback, power) *
    getEdgeoutDamageScale(target.damage);
  launchEdgeoutFighter(target, knockbackDirection.x, knockbackDirection.z, speed, power >= 0.5 ? "charged" : "shove");
}

/**
 * Resolve a dash body-check. It beats a block: the guard breaks instead.
 * @param {EdgeoutFighter} attacker
 * @param {EdgeoutFighter} target
 */
function applyEdgeoutDashHit(attacker, target) {
  writeEdgeoutKnockbackDirection(attacker, target);
  if (isEdgeoutGuarding(target, attacker)) {
    addEdgeoutDamage(target, EDGEOUT_COMBAT_SETTINGS.dashHitDamage * 0.5);
    launchEdgeoutFighter(target, knockbackDirection.x, knockbackDirection.z,
      EDGEOUT_COMBAT_SETTINGS.guardBreakKnockback * getEdgeoutDamageScale(target.damage), "guardBreak",
      EDGEOUT_COMBAT_SETTINGS.guardBreakStunSec);
  } else {
    addEdgeoutDamage(target, EDGEOUT_COMBAT_SETTINGS.dashHitDamage);
    launchEdgeoutFighter(target, knockbackDirection.x, knockbackDirection.z,
      EDGEOUT_COMBAT_SETTINGS.dashHitKnockback * getEdgeoutDamageScale(target.damage), "dash");
  }
  attacker.dashRemainingSec = 0;
  attacker.vx *= DASH_ATTACKER_RETAINED_SPEED;
  attacker.vz *= DASH_ATTACKER_RETAINED_SPEED;
}

/** @param {number} from @param {number} to @param {number} amount */
function lerpEdgeout(from, to, amount) {
  return from + (to - from) * amount;
}

/** @param {EdgeoutFighter} attacker @param {EdgeoutFighter} target @param {"shove"|"dash"} kind */
function queueEdgeoutHit(attacker, target, kind) {
  const hit = hitPool[pendingHits.length] ?? (hitPool[pendingHits.length] = { attacker, target, kind });
  hit.attacker = attacker;
  hit.target = target;
  hit.kind = kind;
  pendingHits.push(hit);
}

/**
 * Detect every connecting attack from the same pre-hit state, then apply them,
 * so simultaneous shoves trade instead of favouring slot order. Each action
 * identity lands at most once. Mutates attackers and targets in place.
 * @param {readonly EdgeoutFighter[]} fighters
 */
export function resolveEdgeoutCombat(fighters) {
  pendingHits.length = 0;
  const dashReach = EDGEOUT_CHARACTER_SETTINGS.radius * 2 + EDGEOUT_COMBAT_SETTINGS.dashHitReach;
  for (const attacker of fighters) {
    if (attacker.eliminated || attacker.stunSec > 0) continue;
    if (isEdgeoutShoveActive(attacker)) {
      const target = findEdgeoutTarget(attacker, fighters, EDGEOUT_COMBAT_SETTINGS.shoveRange, EDGEOUT_COMBAT_SETTINGS.shoveArcCos);
      if (target) queueEdgeoutHit(attacker, target, "shove");
    }
    if (isEdgeoutDashHitReady(attacker)) {
      const target = findEdgeoutTarget(attacker, fighters, dashReach, DASH_FRONT_COS);
      if (target) queueEdgeoutHit(attacker, target, "dash");
    }
  }

  for (const hit of pendingHits) {
    if (hit.kind === "shove") {
      hit.attacker.shoveHitId = hit.attacker.actionId;
      applyEdgeoutShove(hit.attacker, hit.target);
    } else {
      hit.attacker.dashHitId = hit.attacker.actionId;
      applyEdgeoutDashHit(hit.attacker, hit.target);
    }
  }
  pendingHits.length = 0;
}
