import * as THREE from "three";
import { DEAD_SHIFT_ENEMY_TYPES, DEAD_SHIFT_MAX_ENEMIES } from "../shared/config.js";
import { createActorBatcher, interpolateAngle } from "./resources.js";

const REMOTE_PLAYER_LIMIT = 4;

/** @typedef {"walker" | "runner" | "brute" | "spitter" | "operator"} ActorKind */

function createActorMaterials(resources) {
  const standard = (options) => resources.ownMaterial(new THREE.MeshStandardMaterial(options));
  return {
    walker: standard({ color: 0x7b8a71, roughness: 0.88, metalness: 0.01 }),
    runner: standard({ color: 0x9a7360, roughness: 0.8 }),
    brute: standard({ color: 0x807668, roughness: 0.9 }),
    spitter: standard({ color: 0x768a4e, roughness: 0.67 }),
    bone: standard({ color: 0xc1b595, roughness: 0.82 }),
    wound: standard({ color: 0x582b24, roughness: 0.5 }),
    jacket: standard({ color: 0x233f3e, roughness: 0.94 }),
    runnerCloth: standard({ color: 0x3f3430, roughness: 0.98 }),
    bruteCloth: standard({ color: 0x4a3830, roughness: 0.98 }),
    spitterCloth: standard({ color: 0x52573b, roughness: 0.95 }),
    trousers: standard({ color: 0x28312d, roughness: 1 }),
    boots: standard({ color: 0x121d1d, roughness: 0.77 }),
    metal: standard({ color: 0x677875, metalness: 0.75, roughness: 0.44 }),
    darkMetal: standard({ color: 0x15262d, metalness: 0.7, roughness: 0.36 }),
    orange: standard({ color: 0xb87435, roughness: 0.8 }),
    eye: standard({ color: 0xefbe6f, emissive: 0xd46121, emissiveIntensity: 2.1 }),
    acid: standard({ color: 0xb4c75b, emissive: 0x7e9b1e, emissiveIntensity: 1.1, roughness: 0.3 }),
    operator: standard({ color: 0x7c9994, roughness: 0.8, metalness: 0.17 }),
    operatorCloth: standard({ color: 0x182c38, roughness: 0.98 }),
    visor: standard({ color: 0x1caaa9, emissive: 0x156f6d, emissiveIntensity: 1.1, roughness: 0.18, metalness: 0.7 }),
    hit: standard({ color: 0xfff1c2, emissive: 0xffc075, emissiveIntensity: 2.6, roughness: 1 }),
  };
}

/**
 * An actor is an ordinary transform hierarchy; its visible shapes are drawn by
 * shared instanced batches. Removing a rig releases its instance slots only.
 */
function createActorRig(scene, resources, batcher, materials, kind) {
  const root = new THREE.Group();
  root.name = `dead-shift-${kind}`;
  root.visible = false;
  const releaseParts = [];
  const enemyDefinition = DEAD_SHIFT_ENEMY_TYPES.find((enemyType) => enemyType.id === kind);
  const actorHeight = kind === "operator" ? 1.82 : enemyDefinition?.height || 1.85;
  const bodyScale = actorHeight / 1.85;
  root.scale.setScalar(bodyScale);
  scene.add(root);
  const skin = materials[kind] || materials.walker;
  const operator = kind === "operator";
  const brute = kind === "brute";
  const runner = kind === "runner";
  const spitter = kind === "spitter";
  const cloth = operator ? materials.operatorCloth : brute ? materials.bruteCloth : runner ? materials.runnerCloth : spitter ? materials.spitterCloth : materials.jacket;
  const breadth = brute ? 1.55 : runner ? 0.83 : spitter ? 1.08 : 1;

  function bone(parent, position) {
    const transform = new THREE.Group();
    transform.position.fromArray(position);
    parent.add(transform);
    return transform;
  }

  function part(parent, geometry, material, position, scale, rotation = [0, 0, 0]) {
    const shape = new THREE.Object3D();
    shape.position.fromArray(position);
    shape.scale.fromArray(scale);
    shape.rotation.set(...rotation);
    parent.add(shape);
    const renderGeometry = geometry === resources.box && scale[0] > 0.1 && scale[1] > 0.1 && scale[2] > 0.05 ? resources.beveledBox : geometry;
    releaseParts.push(batcher.registerPart(root, shape, renderGeometry, material));
    return shape;
  }

  const hips = bone(root, [0, 0.83, 0]);
  part(hips, resources.box, cloth, [0, 0, 0], [0.37 * breadth, 0.23, 0.27]);
  part(hips, resources.box, materials.darkMetal, [0, 0.1, 0], [0.4 * breadth, 0.055, 0.3]);
  part(hips, resources.box, materials.metal, [0, 0.1, -0.16], [0.09, 0.07, 0.04]);
  const torso = bone(hips, [0, 0.13, 0]);
  const torsoWidth = 0.48 * breadth;
  part(torso, resources.box, cloth, [0, 0.25, 0], [torsoWidth, 0.49, 0.29 * breadth]);
  part(torso, resources.sphere, skin, [0, 0.14, -0.035], [0.38 * breadth, 0.42, 0.3 * breadth]);
  part(torso, resources.box, cloth, [-0.15 * breadth, 0.3, -0.155], [0.15 * breadth, 0.44, 0.055], [0, 0, -0.08]);
  part(torso, resources.box, cloth, [0.15 * breadth, 0.3, -0.155], [0.15 * breadth, 0.44, 0.055], [0, 0, 0.09]);

  if (operator) {
    part(torso, resources.box, materials.operator, [0, 0.29, -0.18], [0.41, 0.4, 0.12]);
    for (let index = 0; index < 3; index += 1) {
      part(torso, resources.box, materials.darkMetal, [-0.12 + index * 0.12, 0.19, -0.27], [0.09, 0.16, 0.055]);
    }
    part(torso, resources.box, materials.darkMetal, [0, 0.3, 0.22], [0.32, 0.44, 0.21]);
    part(torso, resources.cylinder, materials.metal, [0.16, 0.64, 0.24], [0.015, 0.45, 0.015]);
    part(torso, resources.box, materials.visor, [0.205, 0.37, -0.265], [0.045, 0.08, 0.025]);
  } else {
    for (let index = 0; index < (brute ? 3 : 4); index += 1) {
      part(torso, resources.box, materials.bone, [0.018, 0.15 + index * 0.061, -0.16 * breadth], [0.2 * breadth, 0.027, 0.028], [0, 0, index % 2 ? 0.12 : -0.12]);
    }
    part(torso, resources.box, materials.wound, [0.12, 0.38, -0.18 * breadth], [0.07, 0.18, 0.025], [0, 0, -0.4]);
    part(torso, resources.box, materials.orange, [-0.19 * breadth, 0.32, -0.195], [0.04, 0.24, 0.02]);
  }

  if (brute) {
    part(torso, resources.sphere, skin, [0, 0.47, 0.08], [0.73, 0.43, 0.52]);
    part(torso, resources.box, materials.wound, [0.3, 0.47, -0.2], [0.22, 0.26, 0.04], [0, 0, -0.3]);
    for (const side of [-1, 1]) {
      part(torso, resources.box, materials.metal, [side * 0.43, 0.46, 0.03], [0.21, 0.2, 0.44], [0, 0, side * 0.35]);
      part(torso, resources.cone, materials.bone, [side * 0.5, 0.64, 0.02], [0.08, 0.22, 0.08], [0, 0, -side * 0.6]);
    }
  }
  const acidSacs = [];
  if (spitter) {
    part(torso, resources.sphere, skin, [0, 0.27, 0.23], [0.58, 0.7, 0.48]);
    acidSacs.push(part(torso, resources.sphere, materials.acid, [-0.12, 0.31, 0.41], [0.3, 0.4, 0.23]));
    acidSacs.push(part(torso, resources.sphere, materials.acid, [0.15, 0.47, 0.36], [0.27, 0.31, 0.27]));
    part(torso, resources.sphere, materials.acid, [0.02, 0.08, -0.15], [0.42, 0.38, 0.3]);
    for (const acidSac of acidSacs) acidSac.userData.baseScale = acidSac.scale.clone();
  }

  const neckElevation = operator ? 0.56 : runner ? 0.49 : brute ? 0.51 : spitter ? 0.48 : 0.54;
  const neckDepth = runner ? 0.13 : brute ? 0.035 : spitter || operator ? -0.025 : 0.035;
  const neck = bone(torso, [0, neckElevation, neckDepth]);
  part(neck, resources.cylinder, skin, [0, 0.015, 0], [0.16 * (spitter ? 1.6 : 1), 0.2, 0.15]);
  const head = bone(neck, [0, 0.17, -0.035]);
  head.name = "head";
  const headMaterial = operator ? materials.operator : skin;
  part(head, resources.sphere, headMaterial, [0, 0, 0], [0.31, 0.35, 0.29]);
  part(head, resources.box, headMaterial, [0, -0.09, -0.1], [0.22, 0.17, 0.15]);
  part(head, resources.box, operator ? materials.visor : materials.wound, [0, -0.08, -0.18], [0.17, spitter ? 0.13 : 0.055, 0.025]);

  if (operator) {
    part(head, resources.sphere, materials.darkMetal, [0, 0.065, 0.015], [0.37, 0.32, 0.35]);
    part(head, resources.box, materials.visor, [0, 0.025, -0.162], [0.29, 0.095, 0.045]);
    part(head, resources.cylinder, materials.darkMetal, [0.1, -0.13, -0.17], [0.09, 0.08, 0.09], [Math.PI / 2, 0, 0]);
  } else {
    for (const side of [-1, 1]) {
      part(head, resources.sphere, materials.darkMetal, [side * 0.071, 0.025, -0.127], [0.095, 0.074, 0.08]);
      part(head, resources.sphere, spitter ? materials.acid : materials.eye, [side * 0.071, 0.027, -0.168], [0.032, 0.032, 0.02]);
      part(head, resources.box, materials.bone, [side * 0.098, -0.046, -0.137], [0.065, 0.03, 0.08], [0, side * 0.32, side * 0.14]);
    }
    for (let index = 0; index < 4; index += 1) {
      part(head, resources.cone, materials.bone, [-0.058 + index * 0.04, -0.078, -0.198], [0.022, spitter ? 0.07 : 0.035, 0.022], [0, 0, Math.PI]);
    }
    part(head, resources.box, materials.wound, [-0.075, 0.11, -0.08], [0.08, 0.12, 0.09], [0, 0, -0.3]);
  }
  const headFlash = part(head, resources.sphere, materials.hit, [0, 0, -0.02], [0, 0, 0]);

  const arms = [];
  const legs = [];
  for (const side of [-1, 1]) {
    const shoulder = bone(torso, [side * (torsoWidth / 2 + 0.045), 0.44, 0]);
    const armWidth = brute ? (side === -1 ? 0.22 : 0.27) : runner ? 0.11 : 0.14;
    const armLength = runner ? 0.38 : 0.31;
    part(shoulder, resources.sphere, cloth, [0, -0.05, 0], [armWidth * 1.4, 0.23, armWidth * 1.5]);
    part(shoulder, resources.cylinder, operator ? materials.operatorCloth : skin, [0, -armLength / 2 - 0.04, 0], [armWidth, armLength, armWidth]);
    const elbow = bone(shoulder, [0, -armLength - 0.03, 0]);
    part(elbow, resources.sphere, operator ? materials.operator : skin, [0, 0, 0], [armWidth * 1.15, armWidth * 1.2, armWidth * 1.1]);
    part(elbow, resources.cylinder, operator ? materials.operatorCloth : skin, [0, -0.15, 0], [armWidth * 0.76, 0.3, armWidth * 0.78]);
    part(elbow, resources.box, operator ? materials.boots : skin, [0, -0.33, -0.015], [armWidth * 1.1, 0.13, armWidth * 0.8]);
    if (!operator) {
      for (let finger = 0; finger < 3; finger += 1) {
        part(elbow, resources.box, materials.bone, [(finger - 1) * armWidth * 0.3, -0.42, -0.025], [0.023, 0.12, 0.025], [0.3, 0, (finger - 1) * -0.1]);
      }
      part(elbow, resources.box, materials.wound, [0, -0.12, -armWidth * 0.39], [armWidth * 0.6, 0.11, 0.03], [0, 0, 0.3]);
    }
    arms.push({ shoulder, elbow, side });

    const thigh = bone(hips, [side * 0.115 * breadth, -0.055, 0]);
    part(thigh, resources.cylinder, materials.trousers, [0, -0.2, 0], [0.19 * breadth, 0.39, 0.2]);
    const knee = bone(thigh, [0, -0.39, 0]);
    part(knee, resources.sphere, operator ? materials.operator : materials.trousers, [0, 0, -0.025], [0.18 * breadth, 0.18, 0.2]);
    part(knee, resources.cylinder, runner ? skin : materials.trousers, [0, -0.16, 0], [0.13 * breadth, 0.31, 0.14]);
    part(knee, resources.box, materials.boots, [0, -0.315, -0.065], [0.17 * breadth, 0.16, 0.31]);
    legs.push({ thigh, knee, side });
  }

  if (operator) {
    const heldGun = bone(torso, [0.18, 0.35, -0.36]);
    part(heldGun, resources.box, materials.darkMetal, [0, 0, -0.1], [0.095, 0.11, 0.5]);
    part(heldGun, resources.cylinder, materials.metal, [0, 0.015, -0.47], [0.035, 0.3, 0.035], [Math.PI / 2, 0, 0]);
    part(heldGun, resources.box, materials.darkMetal, [0, -0.12, -0.04], [0.07, 0.19, 0.11], [-0.18, 0, 0]);
  }

  let lastDamageId = 0;
  let lastHealth = Number.POSITIVE_INFINITY;
  let flashRemainingSec = 0;
  let gaitPhase = 0;
  let deathElapsedSec = 0;
  const neutralLean = operator ? 0 : runner ? -0.24 : brute ? -0.12 : spitter ? 0.08 : -0.16;

  return {
    root,
    kind,
    update(actorState, dtSec, timeSec, speed, reducedMotion, snapPosition) {
      if (snapPosition) {
        flashRemainingSec = 0;
        deathElapsedSec = 0;
      }
      const blend = snapPosition ? 1 : 1 - Math.exp(-dtSec * 17);
      root.visible = true;
      root.position.x += (actorState.x - root.position.x) * blend;
      root.position.y += ((actorState.y || 0) - root.position.y) * blend;
      root.position.z += (actorState.z - root.position.z) * blend;
      root.rotation.y = interpolateAngle(root.rotation.y, actorState.yaw || 0, blend);
      const dead = actorState.attackPhase === "dead" || actorState.health <= 0;
      deathElapsedSec = dead ? deathElapsedSec + dtSec : 0;
      const collapseProgress = Math.min(1, deathElapsedSec / 0.36);
      root.rotation.z = dead ? collapseProgress * -1.42 : 0;
      if (dead) root.position.y = (actorState.y || 0) + collapseProgress * 0.09;

      if (actorState.damageId !== undefined && actorState.damageId !== lastDamageId) {
        if (!snapPosition && actorState.health < lastHealth) flashRemainingSec = 0.1;
        lastDamageId = actorState.damageId;
      }
      lastHealth = actorState.health;
      flashRemainingSec = Math.max(0, flashRemainingSec - dtSec);
      headFlash.scale.setScalar(flashRemainingSec > 0 ? 0.38 : 0);

      const windup = actorState.attackPhase === "windup";
      const recovery = actorState.attackPhase === "recovery";
      const locomotion = dead ? 0 : Math.min(1, speed / (runner ? 2.5 : 1.3));
      gaitPhase += dtSec * (runner ? 13 : brute ? 4.2 : spitter ? 4.8 : operator ? 8 : 6) * Math.max(0.12, locomotion);
      const stride = Math.sin(gaitPhase);
      const actorSeed = typeof actorState.id === "number" ? actorState.id : 2;
      const idleBreath = Math.sin(timeSec * 2.1 + actorSeed * 1.7);
      const motionScale = reducedMotion ? 0.65 : 1;
      hips.position.y = 0.83 + Math.abs(stride) * locomotion * (runner ? 0.045 : 0.025) * motionScale;
      torso.rotation.x = neutralLean + (windup ? -0.17 : recovery ? -0.27 : 0) + idleBreath * 0.012;
      torso.rotation.z = windup ? Math.sin(timeSec * 9) * 0.045 : Math.cos(gaitPhase) * locomotion * 0.025;
      head.rotation.z = operator ? 0 : Math.sin(timeSec * 1.1 + actorSeed) * 0.055;
      head.rotation.x = spitter && windup ? 0.5 : neutralLean * -0.5;
      for (const acidSac of acidSacs) {
        const swelling = windup ? 1.12 + Math.sin(timeSec * 14) * (reducedMotion ? 0.015 : 0.055) : 1 + idleBreath * 0.025;
        acidSac.scale.copy(acidSac.userData.baseScale).multiplyScalar(swelling);
      }

      for (const { thigh, knee, side } of legs) {
        thigh.rotation.x = stride * side * locomotion * (runner ? 0.9 : 0.53);
        knee.rotation.x = -Math.max(0, -stride * side) * locomotion * 0.74;
        thigh.rotation.z = side * (brute ? 0.13 : 0.035);
      }
      for (const { shoulder, elbow, side } of arms) {
        shoulder.rotation.z = operator ? (side === 1 ? -0.14 : 0.5) : side * (brute ? 0.2 : runner ? 0.19 : 0.08);
        shoulder.rotation.y = operator && side === -1 ? -0.35 : 0;
        shoulder.rotation.x = operator ? 1.15 : windup ? (spitter ? 0.75 : 1.7) : recovery ? 1.22 : (runner ? 0.42 : 0.18) - stride * side * locomotion * 0.4;
        elbow.rotation.x = operator ? 0.3 : windup ? 0.65 : runner ? 0.8 : 0.13;
      }
      root.updateMatrixWorld(true);
    },
    dispose() {
      for (const releasePart of releaseParts) releasePart();
      scene.remove(root);
    },
  };
}

/**
 * Snapshot slots retain their rigs, but every new entity ID snaps its transform.
 * @param {THREE.Scene} scene
 * @param {import("./resources.js").DeadShiftRenderResources} resources
 */
export function createArenaActors(scene, resources) {
  const materials = createActorMaterials(resources);
  const batcher = createActorBatcher(scene, resources);
  const enemySlots = Array.from({ length: DEAD_SHIFT_MAX_ENEMIES }, () => ({ id: 0, rig: null, x: 0, z: 0, speed: 0 }));
  const playerSlots = new Map();

  return {
    update({ enemies, players, playerId, dtSec, timeSec, reducedMotion }) {
      const enemyStates = Array.isArray(enemies) ? enemies : Object.values(enemies || {});
      for (let index = 0; index < enemySlots.length; index += 1) {
        const slot = enemySlots[index];
        const enemyState = enemyStates[index];
        if (!enemyState?.id || (enemyState.health <= 0 && enemyState.attackPhase !== "dead")) {
          if (slot.rig) slot.rig.root.visible = false;
          slot.id = 0;
          continue;
        }
        const kind = typeof enemyState.type === "string" ? enemyState.type : DEAD_SHIFT_ENEMY_TYPES[enemyState.type]?.id || "walker";
        if (!slot.rig || slot.rig.kind !== kind) {
          slot.rig?.dispose();
          slot.rig = createActorRig(scene, resources, batcher, materials, kind);
          slot.id = 0;
        }
        const newIdentity = slot.id !== enemyState.id;
        const displacement = Math.hypot(enemyState.x - slot.x, enemyState.z - slot.z);
        const targetSpeed = newIdentity ? 0 : Math.min(8, displacement / Math.max(0.001, dtSec));
        slot.speed = newIdentity ? 0 : slot.speed + (targetSpeed - slot.speed) * (1 - Math.exp(-dtSec * 8));
        slot.rig.update(enemyState, dtSec, timeSec, slot.speed, reducedMotion, newIdentity || displacement > 5);
        slot.id = enemyState.id;
        slot.x = enemyState.x;
        slot.z = enemyState.z;
      }

      const playerStates = Array.isArray(players) ? players.map((playerState, index) => [playerState.id || `p${index + 1}`, playerState]) : Object.entries(players || {});
      const activePlayerIds = new Set();
      for (const [remotePlayerId, playerState] of playerStates) {
        if (remotePlayerId === playerId || playerState.connected === false || playerState.health <= 0 || playerState.respawnRemaining > 0) continue;
        if (activePlayerIds.size >= REMOTE_PLAYER_LIMIT) break;
        activePlayerIds.add(remotePlayerId);
        let slot = playerSlots.get(remotePlayerId);
        if (!slot) {
          slot = { rig: createActorRig(scene, resources, batcher, materials, "operator"), x: playerState.x, z: playerState.z, active: false };
          playerSlots.set(remotePlayerId, slot);
        }
        const speed = Math.hypot(playerState.vx || 0, playerState.vz || 0);
        slot.rig.update(playerState, dtSec, timeSec, speed, reducedMotion, !slot.active || Math.hypot(playerState.x - slot.x, playerState.z - slot.z) > 5);
        slot.active = true;
        slot.x = playerState.x;
        slot.z = playerState.z;
      }
      for (const [remotePlayerId, slot] of playerSlots) {
        if (!activePlayerIds.has(remotePlayerId)) {
          slot.rig.root.visible = false;
          slot.active = false;
        }
      }
      batcher.flush();
    },
    setQuality(profile) {
      batcher.setShadows(profile !== "low");
    },
    dispose() {
      for (const slot of enemySlots) slot.rig?.dispose();
      for (const slot of playerSlots.values()) slot.rig.dispose();
      enemySlots.length = 0;
      playerSlots.clear();
      batcher.dispose();
    },
  };
}
