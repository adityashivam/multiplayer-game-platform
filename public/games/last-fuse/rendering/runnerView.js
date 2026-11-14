import * as THREE from "three";
import { LAST_FUSE_RUNNER_COLORS } from "../shared/config.js";
import { nameLastFuseRunner } from "../client/runnerNames.js";

/** @typedef {import("../client/snapshotPose.js").LastFusePresentedRunner} LastFusePresentedRunner */
/**
 * Joint targets for one pose. Limbs hang along -Y; a negative X rotation
 * swings them forward because runners face +Z. Knees bend with positive X,
 * elbows with negative X.
 * @typedef {{lean:number,bob:number,roll:number,leftHip:number,rightHip:number,leftKnee:number,rightKnee:number,
 *   leftShoulder:number,rightShoulder:number,leftElbow:number,rightElbow:number,armSpread:number}} LastFusePose
 */

const JOINT_RESPONSE_PER_SEC = 16;
const LABEL_WIDTH = 160;
const LABEL_HEIGHT = 48;
const MAX_RUNNER_VIEWS = 8;
const SKIN_TONES = Object.freeze(["#c68863", "#8d5a3b", "#e0b190", "#5c3a26", "#d9a074", "#a8704a"]);

/** @returns {LastFusePose} */
function createLastFusePose() {
  return { lean: 0, bob: 0, roll: 0, leftHip: 0, rightHip: 0, leftKnee: 0.05, rightKnee: 0.05, leftShoulder: 0.05, rightShoulder: 0.05, leftElbow: -0.2, rightElbow: -0.2, armSpread: 0.08 };
}
const NEUTRAL_POSE = Object.freeze(createLastFusePose());
const POSE_JOINTS = Object.freeze(Object.keys(NEUTRAL_POSE));

/**
 * Distinct poses per action: relaxed idle, sprint stride, tucked jump,
 * reaching fall, low dash, stumbling stagger and arms-up victory.
 * @param {LastFusePose} pose Overwritten with this frame's targets.
 * @param {Readonly<LastFusePresentedRunner>} runner
 * @param {number} timeSec Render clock for loops.
 */
export function writeLastFuseRunnerPose(pose, runner, timeSec) {
  Object.assign(pose, NEUTRAL_POSE);
  const phase = timeSec * 11 + runner.slotIndex * 1.7;
  switch (runner.action) {
    case "run": {
      const stride = Math.sin(phase);
      pose.lean = 0.22;
      pose.bob = Math.abs(Math.cos(phase)) * 0.07;
      pose.leftHip = -stride * 0.85;
      pose.rightHip = stride * 0.85;
      pose.leftKnee = 0.25 + Math.max(0, stride) * 1.2;
      pose.rightKnee = 0.25 + Math.max(0, -stride) * 1.2;
      pose.leftShoulder = stride * 0.75;
      pose.rightShoulder = -stride * 0.75;
      pose.leftElbow = -1.3;
      pose.rightElbow = -1.3;
      break;
    }
    case "jump":
      pose.lean = 0.1;
      pose.leftHip = -1.1;
      pose.rightHip = -0.3;
      pose.leftKnee = 1.5;
      pose.rightKnee = 0.9;
      pose.leftShoulder = -1.9;
      pose.rightShoulder = -1.6;
      pose.leftElbow = -0.4;
      pose.rightElbow = -0.4;
      pose.armSpread = 0.3;
      break;
    case "fall":
      pose.lean = -0.15;
      pose.leftHip = -0.5 + Math.sin(timeSec * 14) * 0.3;
      pose.rightHip = 0.2 - Math.sin(timeSec * 14) * 0.3;
      pose.leftKnee = 0.8;
      pose.rightKnee = 0.4;
      pose.leftShoulder = -2.4 + Math.sin(timeSec * 16) * 0.4;
      pose.rightShoulder = -2.4 - Math.sin(timeSec * 16) * 0.4;
      pose.armSpread = 0.6;
      break;
    case "dash":
      pose.lean = 0.65;
      pose.bob = -0.08;
      pose.leftHip = -1;
      pose.rightHip = 0.7;
      pose.leftKnee = 0.9;
      pose.rightKnee = 0.6;
      pose.leftShoulder = 0.9;
      pose.rightShoulder = 0.9;
      pose.leftElbow = -0.3;
      pose.rightElbow = -0.3;
      break;
    case "stagger":
      pose.lean = -0.3;
      pose.roll = Math.sin(timeSec * 13) * 0.15;
      pose.leftHip = 0.3;
      pose.rightHip = -0.3;
      pose.leftKnee = 0.5;
      pose.rightKnee = 0.3;
      pose.leftShoulder = -1.2;
      pose.rightShoulder = -0.9;
      pose.armSpread = 0.7;
      break;
    case "victory":
      pose.bob = Math.abs(Math.sin(timeSec * 6)) * 0.12;
      pose.leftShoulder = -2.9;
      pose.rightShoulder = -2.9;
      pose.leftElbow = -0.2;
      pose.rightElbow = -0.2;
      pose.armSpread = 0.25;
      break;
    default:
      pose.bob = Math.sin(timeSec * 2 + runner.slotIndex) * 0.01;
  }
}

/** Shared geometry for every runner; materials are per runner. */
function createLastFuseRunnerGeometry() {
  return {
    torso: new THREE.CylinderGeometry(0.2, 0.16, 0.56, 10),
    hips: new THREE.CylinderGeometry(0.16, 0.15, 0.18, 10),
    head: new THREE.SphereGeometry(0.12, 14, 10),
    hood: new THREE.SphereGeometry(0.15, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62),
    upperArm: new THREE.CapsuleGeometry(0.055, 0.2, 4, 8).translate(0, -0.14, 0),
    forearm: new THREE.CapsuleGeometry(0.048, 0.2, 4, 8).translate(0, -0.13, 0),
    hand: new THREE.SphereGeometry(0.05, 8, 6).translate(0, -0.27, 0),
    thigh: new THREE.CapsuleGeometry(0.075, 0.32, 4, 8).translate(0, -0.21, 0),
    shin: new THREE.CapsuleGeometry(0.06, 0.32, 4, 8).translate(0, -0.2, 0),
    shoe: new THREE.BoxGeometry(0.11, 0.08, 0.24).translate(0, -0.4, 0.05),
    bomb: new THREE.SphereGeometry(0.17, 14, 10),
    fuse: new THREE.CylinderGeometry(0.015, 0.015, 0.12, 6).translate(0, 0.2, 0),
    ring: new THREE.RingGeometry(0.45, 0.56, 32),
    label: new THREE.PlaneGeometry(1, LABEL_HEIGHT / LABEL_WIDTH),
  };
}

/**
 * @param {ReturnType<typeof createLastFuseRunnerGeometry>} geometry
 * @param {number} colorIndex
 */
function createLastFuseRunnerRig(geometry, colorIndex) {
  const teamColor = new THREE.Color(LAST_FUSE_RUNNER_COLORS[colorIndex % LAST_FUSE_RUNNER_COLORS.length]);
  const jacketMaterial = new THREE.MeshStandardMaterial({ color: teamColor.clone().multiplyScalar(0.8), roughness: 0.75, metalness: 0.05 });
  const hoodMaterial = new THREE.MeshStandardMaterial({ color: teamColor.clone().multiplyScalar(0.55), roughness: 0.8 });
  const pantsMaterial = new THREE.MeshStandardMaterial({ color: "#23252b", roughness: 0.85 });
  const skinMaterial = new THREE.MeshStandardMaterial({ color: SKIN_TONES[colorIndex % SKIN_TONES.length], roughness: 0.6 });
  const shoeMaterial = new THREE.MeshStandardMaterial({ color: "#e9e5dc", roughness: 0.55 });
  const bombMaterial = new THREE.MeshStandardMaterial({ color: "#16171b", roughness: 0.35, metalness: 0.6, emissive: new THREE.Color("#ff2a00"), emissiveIntensity: 0 });
  const fuseMaterial = new THREE.MeshBasicMaterial({ color: "#d9c39a" });
  const ringMaterial = new THREE.MeshBasicMaterial({ color: teamColor, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false });
  const labelCanvas = document.createElement("canvas");
  labelCanvas.width = LABEL_WIDTH;
  labelCanvas.height = LABEL_HEIGHT;
  const labelTexture = new THREE.CanvasTexture(labelCanvas);
  labelTexture.colorSpace = THREE.SRGBColorSpace;
  const labelMaterial = new THREE.MeshBasicMaterial({ map: labelTexture, transparent: true, depthWrite: false, depthTest: false, toneMapped: false });

  const root = new THREE.Group();
  const turn = new THREE.Group();
  const body = new THREE.Group();
  root.add(turn);
  turn.add(body);
  const hips = new THREE.Mesh(geometry.hips, pantsMaterial);
  hips.position.y = 0.98;
  const torso = new THREE.Mesh(geometry.torso, jacketMaterial);
  torso.position.y = 1.33;
  const head = new THREE.Mesh(geometry.head, skinMaterial);
  head.position.set(0, 1.74, 0.02);
  const hood = new THREE.Mesh(geometry.hood, hoodMaterial);
  hood.position.set(0, 1.74, -0.02);
  hood.rotation.x = -0.35;
  body.add(hips, torso, head, hood);

  /** @param {number} side */
  const createArm = (side) => {
    const shoulder = new THREE.Group();
    shoulder.position.set(0.25 * side, 1.56, 0);
    shoulder.add(new THREE.Mesh(geometry.upperArm, jacketMaterial));
    const elbow = new THREE.Group();
    elbow.position.y = -0.3;
    elbow.add(new THREE.Mesh(geometry.forearm, jacketMaterial), new THREE.Mesh(geometry.hand, skinMaterial));
    shoulder.add(elbow);
    body.add(shoulder);
    return { shoulder, elbow };
  };
  /** @param {number} side */
  const createLeg = (side) => {
    const hip = new THREE.Group();
    hip.position.set(0.1 * side, 0.94, 0);
    hip.add(new THREE.Mesh(geometry.thigh, pantsMaterial));
    const knee = new THREE.Group();
    knee.position.y = -0.44;
    knee.add(new THREE.Mesh(geometry.shin, pantsMaterial), new THREE.Mesh(geometry.shoe, shoeMaterial));
    hip.add(knee);
    body.add(hip);
    return { hip, knee };
  };
  const leftArm = createArm(1);
  const rightArm = createArm(-1);
  const leftLeg = createLeg(1);
  const rightLeg = createLeg(-1);

  const bomb = new THREE.Group();
  bomb.add(new THREE.Mesh(geometry.bomb, bombMaterial), new THREE.Mesh(geometry.fuse, fuseMaterial));
  bomb.position.set(0, -0.36, 0.06);
  bomb.visible = false;
  rightArm.elbow.add(bomb);
  const ring = new THREE.Mesh(geometry.ring, ringMaterial);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  const label = new THREE.Mesh(geometry.label, labelMaterial);
  label.position.y = 2.3;
  label.renderOrder = 10;
  root.add(ring, label);
  root.traverse((child) => {
    if (child.isMesh && child !== ring && child !== label) child.castShadow = true;
  });

  return {
    root, turn, body, leftArm, rightArm, leftLeg, rightLeg, bomb, ring, label,
    pose: createLastFusePose(),
    targetPose: createLastFusePose(),
    materials: [jacketMaterial, hoodMaterial, pantsMaterial, skinMaterial, shoeMaterial, bombMaterial, fuseMaterial, ringMaterial, labelMaterial],
    bombMaterial, ringMaterial, labelCanvas, labelTexture, teamColor,
    labelText: "",
  };
}

/** @param {ReturnType<typeof createLastFuseRunnerRig>} rig @param {string} text @param {boolean} holder */
function drawLastFuseLabel(rig, text, holder) {
  const key = `${text}:${holder}`;
  if (rig.labelText === key) return;
  rig.labelText = key;
  const context = rig.labelCanvas.getContext("2d");
  context.clearRect(0, 0, LABEL_WIDTH, LABEL_HEIGHT);
  context.fillStyle = holder ? "rgba(120, 12, 10, 0.85)" : "rgba(8, 9, 13, 0.7)";
  context.beginPath();
  context.roundRect(16, 6, LABEL_WIDTH - 32, LABEL_HEIGHT - 12, 10);
  context.fill();
  context.font = "700 24px 'Space Grotesk', sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = holder ? "#ffffff" : `#${rig.teamColor.getHexString()}`;
  context.fillText(text, LABEL_WIDTH / 2, LABEL_HEIGHT / 2 + 1);
  rig.labelTexture.needsUpdate = true;
}

/**
 * Runner rigs keyed by runner ID, created on first sight and bounded. The
 * caller passes borrowed presented values each frame; nothing is retained.
 * @param {THREE.Scene} scene
 */
export function createLastFuseRunnerViews(scene) {
  const geometry = createLastFuseRunnerGeometry();
  /** @type {Map<string,ReturnType<typeof createLastFuseRunnerRig>>} */
  const rigs = new Map();
  const seen = new Set();
  const bombWorldPosition = new THREE.Vector3();

  /** @param {LastFusePose} pose @param {LastFusePose} target @param {number} amount */
  function blendPose(pose, target, amount) {
    for (const joint of POSE_JOINTS) pose[joint] += (target[joint] - pose[joint]) * amount;
  }

  return {
    /**
     * @param {readonly LastFusePresentedRunner[]} runners
     * @param {string} playerId
     * @param {string|null} holderId
     * @param {number} fuseFraction Remaining fuse share for the bomb glow.
     * @param {THREE.Camera} camera
     * @param {number} timeSec
     * @param {number} dtSec
     * @param {boolean} reducedMotion
     * @returns {THREE.Vector3|null} World position of the held bomb, borrowed until the next call.
     */
    update(runners, playerId, holderId, fuseFraction, camera, timeSec, dtSec, reducedMotion) {
      seen.clear();
      let bombPosition = null;
      const blend = Math.min(1, dtSec * JOINT_RESPONSE_PER_SEC);
      for (const runner of runners) {
        let rig = rigs.get(runner.id);
        if (!rig) {
          if (rigs.size >= MAX_RUNNER_VIEWS) continue;
          rig = createLastFuseRunnerRig(geometry, runner.colorIndex);
          rigs.set(runner.id, rig);
          scene.add(rig.root);
        }
        seen.add(runner.id);
        rig.root.visible = !runner.eliminated && runner.y > -5;
        if (!rig.root.visible) continue;
        rig.root.position.set(runner.x, runner.y, runner.z);
        rig.turn.rotation.y = runner.facing;

        const holder = runner.id === holderId;
        writeLastFuseRunnerPose(rig.targetPose, runner, reducedMotion ? 0 : timeSec);
        if (holder && runner.action !== "fall" && runner.action !== "victory") {
          rig.targetPose.rightShoulder = -0.75;
          rig.targetPose.rightElbow = -0.9;
        }
        blendPose(rig.pose, rig.targetPose, blend);
        const pose = rig.pose;
        rig.body.position.y = pose.bob;
        rig.body.rotation.set(pose.lean, 0, pose.roll);
        rig.leftArm.shoulder.rotation.set(pose.leftShoulder, 0, pose.armSpread);
        rig.rightArm.shoulder.rotation.set(pose.rightShoulder, 0, -pose.armSpread);
        rig.leftArm.elbow.rotation.x = pose.leftElbow;
        rig.rightArm.elbow.rotation.x = pose.rightElbow;
        rig.leftLeg.hip.rotation.x = pose.leftHip;
        rig.rightLeg.hip.rotation.x = pose.rightHip;
        rig.leftLeg.knee.rotation.x = pose.leftKnee;
        rig.rightLeg.knee.rotation.x = pose.rightKnee;

        rig.bomb.visible = holder;
        if (holder) {
          const urgency = 1 - Math.max(0, Math.min(1, fuseFraction));
          rig.bombMaterial.emissiveIntensity = 0.2 + urgency * (0.8 + Math.sin(timeSec * (6 + urgency * 20)) * 0.6);
          rig.bomb.getWorldPosition(bombWorldPosition);
          bombPosition = bombWorldPosition;
        }
        const local = runner.id === playerId;
        rig.ringMaterial.opacity = local && runner.grounded ? 0.85 : 0;
        rig.label.visible = !local;
        rig.label.quaternion.copy(camera.quaternion);
        drawLastFuseLabel(rig, nameLastFuseRunner(runner, playerId), holder);
      }
      for (const [runnerId, rig] of rigs) {
        if (!seen.has(runnerId)) rig.root.visible = false;
      }
      return bombPosition;
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
