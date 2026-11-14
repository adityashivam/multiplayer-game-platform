import * as THREE from "three";
import { EDGEOUT_COMBAT_SETTINGS, EDGEOUT_FIGHTER_COLORS } from "../shared/config.js";

/** @typedef {import("../client/snapshotPose.js").EdgeoutPresentedFighter} EdgeoutPresentedFighter */
/**
 * Joint targets for one pose. Arm rotation X is negative forward because the
 * arms hang along -Y from the shoulder and the fighter faces +Z.
 * @typedef {{lean:number,bob:number,crouch:number,twist:number,roll:number,
 *   leftArmX:number,rightArmX:number,leftArmZ:number,rightArmZ:number,
 *   leftLegX:number,rightLegX:number,reach:number,squash:number}} EdgeoutPose
 */

const JOINT_RESPONSE_PER_SEC = 18;
const LABEL_WIDTH = 128;
const LABEL_HEIGHT = 56;
const MAX_FIGHTER_VIEWS = 8;

/** @returns {EdgeoutPose} */
function createEdgeoutPose() {
  return { lean: 0, bob: 0, crouch: 0, twist: 0, roll: 0, leftArmX: -0.25, rightArmX: -0.25, leftArmZ: 0.12, rightArmZ: -0.12, leftLegX: 0, rightLegX: 0, reach: 0, squash: 1 };
}
const NEUTRAL_POSE = Object.freeze(createEdgeoutPose());
const POSE_JOINTS = Object.freeze(Object.keys(NEUTRAL_POSE));

/** @param {number} edge0 @param {number} edge1 @param {number} value */
function smoothstepEdgeout(edge0, edge1, value) {
  const amount = Math.max(0, Math.min(1, (value - edge0) / (edge1 - edge0)));
  return amount * amount * (3 - 2 * amount);
}

/**
 * Distinct authored poses per action: guard idle, running stride, wound-up
 * charge, full-reach shove, low dash, crossed-arm block, dizzy stun,
 * flailing fall, arms-up victory and slumped defeat.
 * @param {EdgeoutPose} pose Overwritten with this frame's targets.
 * @param {Readonly<EdgeoutPresentedFighter>} fighter
 * @param {number} timeSec Render clock for loops.
 */
export function writeEdgeoutFighterPose(pose, fighter, timeSec) {
  Object.assign(pose, NEUTRAL_POSE);
  const actionSec = fighter.actionTimeSec;
  const loopPhase = timeSec * 2 + fighter.slotIndex;
  switch (fighter.action) {
    case "run": {
      const stride = Math.sin(timeSec * 13 + fighter.slotIndex);
      pose.lean = 0.2;
      pose.bob = Math.abs(stride) * 0.06;
      pose.leftLegX = stride * 0.75;
      pose.rightLegX = -stride * 0.75;
      pose.leftArmX = -0.3 - stride * 0.6;
      pose.rightArmX = -0.3 + stride * 0.6;
      break;
    }
    case "charge": {
      const charge = Math.min(1, fighter.chargeSec / EDGEOUT_COMBAT_SETTINGS.maxChargeSec);
      const tremble = charge > 0.95 ? Math.sin(timeSec * 60) * 0.03 : 0;
      pose.lean = -0.12 - 0.08 * charge;
      pose.crouch = 0.1 * charge;
      pose.twist = 0.25 * charge + tremble;
      pose.leftArmX = 0.7 + 0.5 * charge;
      pose.rightArmX = 0.7 + 0.5 * charge;
      pose.leftArmZ = 0.35;
      pose.rightArmZ = -0.35;
      pose.leftLegX = 0.35;
      pose.rightLegX = -0.25;
      break;
    }
    case "shove": {
      const extend = smoothstepEdgeout(0, EDGEOUT_COMBAT_SETTINGS.shoveWindupSec + 0.04, actionSec) *
        (1 - smoothstepEdgeout(0.2, EDGEOUT_COMBAT_SETTINGS.shoveDurationSec, actionSec));
      pose.lean = 0.42 * extend;
      pose.reach = 0.22 * extend;
      pose.leftArmX = -0.3 - 1.3 * extend;
      pose.rightArmX = -0.3 - 1.3 * extend;
      pose.leftArmZ = 0.12 - 0.1 * extend;
      pose.rightArmZ = -0.12 + 0.1 * extend;
      pose.leftLegX = -0.45 * extend;
      pose.rightLegX = 0.55 * extend;
      break;
    }
    case "dash":
      pose.lean = 0.6;
      pose.crouch = 0.08;
      pose.squash = 0.9;
      pose.leftArmX = 1.1;
      pose.rightArmX = 1.1;
      pose.leftLegX = 0.7;
      pose.rightLegX = -0.4;
      break;
    case "block":
      pose.lean = 0.05;
      pose.crouch = 0.07;
      pose.leftArmX = -1.25;
      pose.rightArmX = -1.25;
      pose.leftArmZ = -0.75;
      pose.rightArmZ = 0.75;
      pose.leftLegX = 0.2;
      pose.rightLegX = -0.2;
      break;
    case "stunned": {
      const wobble = Math.sin(timeSec * 17) * Math.max(0.15, 0.4 - actionSec * 0.4);
      pose.lean = -0.25;
      pose.roll = wobble;
      pose.leftArmX = -2.2 + Math.sin(timeSec * 15) * 0.4;
      pose.rightArmX = -2.2 - Math.sin(timeSec * 15) * 0.4;
      pose.leftArmZ = 0.6;
      pose.rightArmZ = -0.6;
      break;
    }
    case "falling":
      pose.lean = -0.3;
      pose.roll = Math.sin(timeSec * 9) * 0.3;
      pose.leftArmX = -2.8 + Math.sin(timeSec * 22) * 0.35;
      pose.rightArmX = -2.8 - Math.sin(timeSec * 22) * 0.35;
      pose.leftArmZ = 0.5;
      pose.rightArmZ = -0.5;
      pose.leftLegX = Math.sin(timeSec * 18) * 0.7;
      pose.rightLegX = -Math.sin(timeSec * 18) * 0.7;
      break;
    case "victory":
      pose.bob = Math.abs(Math.sin(actionSec * 6)) * 0.28;
      pose.leftArmX = -2.9;
      pose.rightArmX = -2.9;
      pose.leftArmZ = 0.35;
      pose.rightArmZ = -0.35;
      break;
    case "defeat":
      pose.lean = 0.45;
      pose.crouch = 0.12;
      pose.leftArmX = 0.12;
      pose.rightArmX = 0.12;
      break;
    default:
      pose.bob = Math.sin(loopPhase * 1.4) * 0.02;
      pose.leftArmX = -0.55;
      pose.rightArmX = -0.55;
      pose.leftArmZ = 0.2;
      pose.rightArmZ = -0.2;
  }
}

/**
 * Shared geometry for every fighter; materials are per fighter so colours and
 * glow stay independent.
 */
function createEdgeoutFighterGeometry() {
  return {
    torso: new THREE.CapsuleGeometry(0.34, 0.42, 6, 14),
    head: new THREE.SphereGeometry(0.27, 20, 14),
    visor: new THREE.BoxGeometry(0.38, 0.11, 0.1),
    arm: new THREE.CapsuleGeometry(0.085, 0.3, 4, 8).translate(0, -0.22, 0),
    glove: new THREE.SphereGeometry(0.15, 14, 10).translate(0, -0.46, 0),
    leg: new THREE.CapsuleGeometry(0.1, 0.22, 4, 8).translate(0, -0.2, 0),
    foot: new THREE.SphereGeometry(0.13, 12, 8).scale(1, 0.6, 1.4).translate(0, -0.38, 0.04),
    shield: new THREE.CircleGeometry(0.6, 6),
    halo: new THREE.TorusGeometry(0.26, 0.035, 6, 20),
    ring: new THREE.RingGeometry(0.5, 0.62, 36),
    label: new THREE.PlaneGeometry(1, LABEL_HEIGHT / LABEL_WIDTH),
  };
}

/**
 * @param {ReturnType<typeof createEdgeoutFighterGeometry>} geometry
 * @param {number} colorIndex
 */
function createEdgeoutFighterRig(geometry, colorIndex) {
  const teamColor = new THREE.Color(EDGEOUT_FIGHTER_COLORS[colorIndex % EDGEOUT_FIGHTER_COLORS.length]);
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.38, metalness: 0.25 });
  const headMaterial = new THREE.MeshStandardMaterial({ color: teamColor.clone().lerp(new THREE.Color("#ffffff"), 0.55), roughness: 0.35, metalness: 0.1 });
  const visorMaterial = new THREE.MeshStandardMaterial({ color: "#0b0f1a", emissive: teamColor, emissiveIntensity: 1.4, roughness: 0.2 });
  const gloveMaterial = new THREE.MeshStandardMaterial({ color: "#f4f6fb", emissive: teamColor, emissiveIntensity: 0.1, roughness: 0.45 });
  const limbMaterial = new THREE.MeshStandardMaterial({ color: teamColor.clone().multiplyScalar(0.62), roughness: 0.5, metalness: 0.2 });
  const shieldMaterial = new THREE.MeshBasicMaterial({ color: teamColor, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const haloMaterial = new THREE.MeshBasicMaterial({ color: "#ffe066", toneMapped: false });
  const ringMaterial = new THREE.MeshBasicMaterial({ color: teamColor, transparent: true, opacity: 0.75, depthWrite: false, toneMapped: false });
  const labelCanvas = document.createElement("canvas");
  labelCanvas.width = LABEL_WIDTH;
  labelCanvas.height = LABEL_HEIGHT;
  const labelTexture = new THREE.CanvasTexture(labelCanvas);
  labelTexture.colorSpace = THREE.SRGBColorSpace;
  const labelMaterial = new THREE.MeshBasicMaterial({ map: labelTexture, transparent: true, depthWrite: false, toneMapped: false });

  const root = new THREE.Group();
  const turn = new THREE.Group();
  const body = new THREE.Group();
  root.add(turn);
  turn.add(body);
  const torso = new THREE.Mesh(geometry.torso, bodyMaterial);
  torso.position.y = 0.78;
  const head = new THREE.Mesh(geometry.head, headMaterial);
  head.position.y = 1.36;
  const visor = new THREE.Mesh(geometry.visor, visorMaterial);
  visor.position.set(0, 1.38, 0.22);
  body.add(torso, head, visor);

  /** @param {number} side */
  const createArm = (side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(0.4 * side, 1.04, 0);
    const arm = new THREE.Mesh(geometry.arm, limbMaterial);
    const glove = new THREE.Mesh(geometry.glove, gloveMaterial);
    shoulder.add(arm, glove);
    body.add(shoulder);
    return { shoulder, glove };
  };
  /** @param {number} side */
  const createLeg = (side) => {
    const hip = new THREE.Group();
    hip.position.set(0.16 * side, 0.42, 0);
    hip.add(new THREE.Mesh(geometry.leg, limbMaterial), new THREE.Mesh(geometry.foot, limbMaterial));
    body.add(hip);
    return hip;
  };
  const leftArm = createArm(1);
  const rightArm = createArm(-1);
  const leftLeg = createLeg(1);
  const rightLeg = createLeg(-1);

  const shield = new THREE.Mesh(geometry.shield, shieldMaterial);
  shield.position.set(0, 0.95, 0.62);
  shield.visible = false;
  const halo = new THREE.Mesh(geometry.halo, haloMaterial);
  halo.rotation.x = Math.PI / 2;
  halo.position.y = 1.82;
  halo.visible = false;
  body.add(shield, halo);
  const ring = new THREE.Mesh(geometry.ring, ringMaterial);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  const label = new THREE.Mesh(geometry.label, labelMaterial);
  label.position.y = 2.2;
  label.scale.setScalar(1.1);
  root.add(ring, label);
  root.traverse((child) => {
    if (child.isMesh && child !== ring && child !== label && child !== shield && child !== halo) child.castShadow = true;
  });

  return {
    root, turn, body, leftArm, rightArm, leftLeg, rightLeg, shield, halo, ring, label,
    pose: createEdgeoutPose(),
    targetPose: createEdgeoutPose(),
    materials: [bodyMaterial, headMaterial, visorMaterial, gloveMaterial, limbMaterial, shieldMaterial, haloMaterial, ringMaterial, labelMaterial],
    gloveMaterial, shieldMaterial, ringMaterial, labelCanvas, labelTexture, teamColor,
    labelText: "",
  };
}

/** @param {ReturnType<typeof createEdgeoutFighterRig>} rig @param {string} text @param {boolean} local */
function drawEdgeoutLabel(rig, text, local) {
  if (rig.labelText === text) return;
  rig.labelText = text;
  const context = rig.labelCanvas.getContext("2d");
  context.clearRect(0, 0, LABEL_WIDTH, LABEL_HEIGHT);
  context.fillStyle = "rgba(6, 10, 20, 0.72)";
  context.beginPath();
  context.roundRect(10, 6, LABEL_WIDTH - 20, LABEL_HEIGHT - 12, 12);
  context.fill();
  context.font = "700 30px 'Space Grotesk', sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = local ? "#ffffff" : `#${rig.teamColor.getHexString()}`;
  context.fillText(text, LABEL_WIDTH / 2, LABEL_HEIGHT / 2 + 1);
  rig.labelTexture.needsUpdate = true;
}

/**
 * Fighter rigs keyed by fighter ID, created on first sight and bounded. The
 * caller passes borrowed presented values each frame; nothing is retained.
 * @param {THREE.Scene} scene
 * @returns {{update(fighters:readonly EdgeoutPresentedFighter[],playerId:string,camera:THREE.Camera,timeSec:number,dtSec:number,reducedMotion:boolean):void,dispose():void}}
 */
export function createEdgeoutFighterViews(scene) {
  const geometry = createEdgeoutFighterGeometry();
  /** @type {Map<string,ReturnType<typeof createEdgeoutFighterRig>>} */
  const rigs = new Map();
  const seen = new Set();

  /** @param {EdgeoutPose} pose @param {EdgeoutPose} target @param {number} amount */
  function blendPose(pose, target, amount) {
    for (const joint of POSE_JOINTS) pose[joint] += (target[joint] - pose[joint]) * amount;
  }

  return {
    update(fighters, playerId, camera, timeSec, dtSec, reducedMotion) {
      seen.clear();
      const blend = Math.min(1, dtSec * JOINT_RESPONSE_PER_SEC);
      for (const fighter of fighters) {
        let rig = rigs.get(fighter.id);
        if (!rig) {
          if (rigs.size >= MAX_FIGHTER_VIEWS) continue;
          rig = createEdgeoutFighterRig(geometry, fighter.colorIndex);
          rigs.set(fighter.id, rig);
          scene.add(rig.root);
        }
        seen.add(fighter.id);
        rig.root.visible = fighter.y > -30;
        rig.root.position.set(fighter.x, fighter.y, fighter.z);
        rig.turn.rotation.y = fighter.facing;

        writeEdgeoutFighterPose(rig.targetPose, fighter, reducedMotion ? 0 : timeSec);
        blendPose(rig.pose, rig.targetPose, blend);
        const pose = rig.pose;
        rig.body.position.set(0, pose.bob - pose.crouch, pose.reach);
        rig.body.rotation.set(pose.lean, pose.twist, pose.roll);
        rig.body.scale.set(1, pose.squash, 1);
        rig.leftArm.shoulder.rotation.set(pose.leftArmX, 0, pose.leftArmZ);
        rig.rightArm.shoulder.rotation.set(pose.rightArmX, 0, pose.rightArmZ);
        rig.leftLeg.rotation.x = pose.leftLegX;
        rig.rightLeg.rotation.x = pose.rightLegX;

        const charge = fighter.action === "charge" ? Math.min(1, fighter.chargeSec / EDGEOUT_COMBAT_SETTINGS.maxChargeSec) : 0;
        rig.gloveMaterial.emissiveIntensity = 0.1 + charge * 2.4 + (fighter.action === "shove" ? fighter.shovePower * 1.5 : 0);
        const gloveScale = 1 + charge * 0.35;
        rig.leftArm.glove.scale.setScalar(gloveScale);
        rig.rightArm.glove.scale.setScalar(gloveScale);
        rig.shield.visible = fighter.action === "block";
        if (rig.shield.visible) {
          const parryWindow = fighter.blockSec <= EDGEOUT_COMBAT_SETTINGS.parryWindowSec;
          rig.shieldMaterial.opacity = parryWindow ? 0.75 : 0.32;
          rig.shield.scale.setScalar(parryWindow ? 1.12 : 1);
        }
        rig.halo.visible = fighter.action === "stunned";
        if (rig.halo.visible) rig.halo.rotation.z = timeSec * 6;
        const local = fighter.id === playerId;
        rig.ringMaterial.opacity = fighter.grounded && !fighter.eliminated ? (local ? 0.95 : 0.55) : 0;
        rig.ring.scale.setScalar(local ? 1.15 : 1);
        rig.label.visible = !fighter.eliminated;
        rig.label.quaternion.copy(camera.quaternion);
        drawEdgeoutLabel(rig, `${Math.round(fighter.damage)}%`, local);
      }
      for (const [fighterId, rig] of rigs) {
        if (!seen.has(fighterId)) rig.root.visible = false;
      }
    },
    dispose() {
      for (const rig of rigs.values()) {
        scene.remove(rig.root);
        rig.materials.forEach((material) => material.dispose());
        rig.labelTexture.dispose();
      }
      rigs.clear();
      Object.values(geometry).forEach((shape) => shape.dispose());
    },
  };
}
