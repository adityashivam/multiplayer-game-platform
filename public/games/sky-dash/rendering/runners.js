import * as THREE from "three";
import { SKY_DASH_MAX_RUNNERS, SKY_DASH_RUNNER_COLORS } from "../shared/config.js";
import { createSkyDashActorBatcher } from "./resources.js";
import { createSkyDashRunnerPose, interpolateSkyDashAngle, sampleSkyDashRunnerPose } from "./presentation.js";
import { getKinematicPlatformTopY } from "../../../platform/shared/kinematicCharacter.js";

/**
 * @typedef {object} SkyDashRenderRunner
 * @property {string} id
 * @property {string} [name]
 * @property {boolean} [isBot]
 * @property {number} [colorIndex]
 * @property {number} x
 * @property {number} y Bottom of the authoritative collider.
 * @property {number} z
 * @property {number} [vx]
 * @property {number} [vy]
 * @property {number} [vz]
 * @property {number} [yaw]
 * @property {boolean} [grounded]
 * @property {string} [action]
 * @property {number} [actionTimeSec] Authoritative remaining action time.
 * @property {number} [hitSec]
 * @property {number} [respawnSec]
 * @property {number} [respawnId]
 * @property {boolean} [finished]
 * @property {number} [rank]
 */

/** @param {import("./resources.js").SkyDashResources} resources */
function createRunnerContactMaterial(resources) {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(32, 32, 4, 32, 32, 31);
  gradient.addColorStop(0, "rgba(45,43,91,.4)");
  gradient.addColorStop(0.5, "rgba(45,43,91,.22)");
  gradient.addColorStop(1, "rgba(45,43,91,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  const texture = resources.ownTexture(new THREE.CanvasTexture(canvas));
  texture.colorSpace = THREE.SRGBColorSpace;
  return resources.ownMaterial(new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }));
}

function createRunnerLabel(resources) {
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 80;
  const texture = resources.ownTexture(new THREE.CanvasTexture(canvas));
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = resources.ownMaterial(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, sizeAttenuation: true }));
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(2.1, 0.44, 1);
  sprite.position.y = 2.03;
  let lastLabel = "";
  return {
    sprite,
    update(name, isBot, isLocal) {
      const label = `${isLocal ? "YOU" : String(name || "Runner").slice(0, 18)}${isBot ? "  ·  BOT" : ""}`;
      if (label === lastLabel) return;
      lastLabel = label;
      const context = canvas.getContext("2d");
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.font = "800 35px Manrope, Arial, sans-serif";
      context.textAlign = "center";
      const textWidth = Math.min(356, context.measureText(label).width + 42);
      context.fillStyle = isLocal ? "rgba(53,83,111,.92)" : "rgba(53,66,102,.64)";
      context.beginPath();
      context.roundRect((384 - textWidth) * 0.5, 12, textWidth, 56, 28);
      context.fill();
      context.fillStyle = isBot ? "#e1e7f0" : "#fffbed";
      context.fillText(label, 192, 51, 330);
      texture.needsUpdate = true;
    },
  };
}

/** @param {THREE.Object3D} parent @param {number[]} position */
function createRunnerJoint(parent, position) {
  const joint = new THREE.Group();
  joint.position.fromArray(position);
  parent.add(joint);
  return joint;
}

/**
 * Original "cloud courier" toy: a rounded flight suit, cream face window,
 * oversized eyes, scarf, soft mittens and little racing shoes.
 */
function createRunnerRig(scene, resources, batcher, contactMaterial, slotIndex) {
  const root = new THREE.Group();
  root.visible = false;
  scene.add(root);
  const pivot = createRunnerJoint(root, [0, 0.73, 0]);
  const suit = createRunnerJoint(pivot, [0, 0, 0]);
  const whiteMaterial = resources.material("#ffffff", 0.44);
  const creamMaterial = resources.material("#fff5df", 0.64);
  const eyeMaterial = resources.material("#26304a", 0.27);
  const soleMaterial = resources.material("#665488", 0.62);
  const accentMaterial = resources.material("#fff9f0", 0.5);
  const colorParts = [];

  function part(parent, geometry, material, position, scale, rotation = [0, 0, 0], colored = false) {
    const shape = new THREE.Object3D();
    shape.position.fromArray(position);
    shape.scale.fromArray(scale);
    shape.rotation.set(rotation[0], rotation[1], rotation[2]);
    parent.add(shape);
    const instance = batcher.register(root, shape, geometry, material);
    if (colored) colorParts.push(instance);
    return shape;
  }

  part(suit, resources.capsule, whiteMaterial, [0, 0.2, 0.01], [0.82, 0.65, 0.75], [0, 0, 0], true);
  part(suit, resources.sphere, creamMaterial, [0, 0.28, -0.285], [0.314, 0.295, 0.115]);
  // The face window nests into the suit instead of floating off the head.
  const eyes = [];
  for (const side of [-1, 1]) {
    const eye = createRunnerJoint(suit, [side * 0.12, 0.32, -0.386]);
    part(eye, resources.sphere, accentMaterial, [0, 0, 0], [0.102, 0.132, 0.05]);
    part(eye, resources.sphere, eyeMaterial, [0.012, -0.008, -0.038], [0.061, 0.088, 0.032]);
    part(eye, resources.sphere, accentMaterial, [0.027, 0.024, -0.064], [0.018, 0.025, 0.008]);
    eyes.push(eye);
    part(suit, resources.sphere, resources.material("#ee9b9e", 0.67), [side * 0.225, 0.16, -0.37], [0.045, 0.025, 0.013]);
  }
  part(suit, resources.sphere, eyeMaterial, [0, 0.105, -0.39], [0.038, 0.018, 0.012]);
  part(suit, resources.sphere, creamMaterial, [0, 0.102, -0.4], [0.023, 0.01, 0.008]);
  // A cream crown seam and scarf keep all poses recognizably the same courier.
  part(suit, resources.capsule, accentMaterial, [0, 0.648, 0.015], [0.12, 0.045, 0.42], [0, 0, 0]);
  part(suit, resources.sphere, soleMaterial, [0, -0.13, -0.018], [0.385, 0.105, 0.325]);
  part(suit, resources.sphere, creamMaterial, [0, -0.125, -0.295], [0.1, 0.07, 0.04]);
  const scarf = createRunnerJoint(suit, [0.1, -0.12, 0.28]);
  part(scarf, resources.capsule, creamMaterial, [0, -0.005, 0.12], [0.16, 0.04, 0.32], [0, 0.12, 0]);
  part(suit, resources.sphere, whiteMaterial, [0.01, 0.18, 0.34], [0.23, 0.25, 0.12], [0, 0, 0], true);
  part(suit, resources.box, creamMaterial, [0.01, 0.18, 0.455], [0.06, 0.28, 0.025]);

  const arms = [];
  const legs = [];
  for (const side of [-1, 1]) {
    const shoulder = createRunnerJoint(suit, [side * 0.355, 0.22, 0.015]);
    part(shoulder, resources.capsule, whiteMaterial, [side * 0.07, -0.145, 0], [0.21, 0.23, 0.23], [0, 0, side * 0.2], true);
    const wrist = createRunnerJoint(shoulder, [side * 0.09, -0.29, -0.015]);
    part(wrist, resources.sphere, creamMaterial, [0, -0.06, -0.015], [0.135, 0.155, 0.13]);
    part(wrist, resources.sphere, creamMaterial, [-side * 0.105, -0.04, -0.005], [0.052, 0.085, 0.065]);
    arms.push({ shoulder, wrist, side });

    const hip = createRunnerJoint(pivot, [side * 0.17, -0.28, 0]);
    part(hip, resources.capsule, whiteMaterial, [0, -0.11, 0], [0.23, 0.19, 0.23], [0, 0, 0], true);
    const knee = createRunnerJoint(hip, [0, -0.18, 0]);
    part(knee, resources.capsule, creamMaterial, [0, -0.075, 0], [0.17, 0.14, 0.18]);
    const ankle = createRunnerJoint(knee, [0, -0.17, -0.075]);
    part(ankle, resources.sphere, creamMaterial, [0, 0, 0], [0.14, 0.105, 0.23]);
    part(ankle, resources.sphere, soleMaterial, [0, -0.048, 0], [0.143, 0.055, 0.23]);
    legs.push({ hip, knee, ankle, side });
  }

  const localMarker = new THREE.Mesh(resources.ring, resources.ownMaterial(new THREE.MeshBasicMaterial({ color: "#fff7d5", transparent: true, opacity: 0.86, depthWrite: false })));
  localMarker.rotation.x = -Math.PI * 0.5;
  localMarker.position.y = 0.025;
  localMarker.scale.setScalar(0.63);
  root.add(localMarker);
  const label = createRunnerLabel(resources);
  root.add(label.sprite);

  const shadow = new THREE.Mesh(resources.plane, contactMaterial);
  shadow.rotation.x = -Math.PI * 0.5;
  shadow.renderOrder = 1;
  shadow.visible = false;
  scene.add(shadow);

  const pose = createSkyDashRunnerPose();
  const surfaceNormal = new THREE.Vector3(0, 1, 0);
  const localNormal = new THREE.Vector3();
  const inverseParentQuaternion = new THREE.Quaternion();
  const planeNormal = new THREE.Vector3(0, 0, 1);
  const upNormal = new THREE.Vector3(0, 1, 0);
  const clocks = { timeSec: 0, gaitPhase: slotIndex * 2.6, actionElapsedSec: 0, seed: slotIndex, reducedMotion: false };
  let id = "";
  let action = "";
  let respawnId = -1;
  let colorIndex = -1;

  return {
    root,
    shadow,
    update(runnerState, { dtSec, timeSec, isLocal, reducedMotion, platforms, camera }) {
      const nextAction = runnerState.finished ? "finish" : runnerState.respawnSec > 0 ? "respawn" : runnerState.action || "idle";
      const newIdentity = id !== runnerState.id;
      const newRespawn = newIdentity || respawnId !== runnerState.respawnId;
      if (newRespawn || nextAction !== action) clocks.actionElapsedSec = 0;
      clocks.actionElapsedSec += dtSec;
      clocks.timeSec = timeSec;
      clocks.reducedMotion = reducedMotion;
      clocks.gaitPhase += dtSec * (2.5 + Math.hypot(runnerState.vx || 0, runnerState.vz || 0) * 1.8);
      sampleSkyDashRunnerPose(runnerState, clocks, pose);

      const nextColorIndex = Math.abs(Math.trunc(runnerState.colorIndex || 0)) % SKY_DASH_RUNNER_COLORS.length;
      if (nextColorIndex !== colorIndex) {
        colorIndex = nextColorIndex;
        for (const coloredPart of colorParts) coloredPart.setColor(SKY_DASH_RUNNER_COLORS[colorIndex]);
      }
      root.visible = Number.isFinite(runnerState.x) && Number.isFinite(runnerState.y) && Number.isFinite(runnerState.z) && runnerState.y > -11.5;
      root.position.set(runnerState.x, runnerState.y, runnerState.z);
      // Three's +Y rotation turns -Z toward -X; the game heading has +X yaw.
      root.rotation.y = newIdentity || newRespawn ? -(runnerState.yaw || 0) : interpolateSkyDashAngle(root.rotation.y, -(runnerState.yaw || 0), 1 - Math.exp(-dtSec * 18));
      pivot.position.y = 0.73 + pose.bob;
      pivot.rotation.set(pose.bodyX, pose.bodyY, pose.bodyZ);
      suit.scale.set(pose.bodyScaleX, pose.bodyScaleY, pose.bodyScaleZ);
      scarf.rotation.x = reducedMotion ? 0 : Math.sin(clocks.gaitPhase * 0.7) * 0.13;
      scarf.rotation.y = reducedMotion ? 0 : Math.sin(timeSec * 7 + slotIndex) * 0.12;
      for (const eye of eyes) eye.scale.y = pose.eyeScaleY;
      arms[0].shoulder.rotation.set(pose.leftArmX, 0, pose.leftArmZ);
      arms[1].shoulder.rotation.set(pose.rightArmX, 0, pose.rightArmZ);
      legs[0].hip.rotation.x = pose.leftLegX;
      legs[1].hip.rotation.x = pose.rightLegX;
      legs[0].knee.rotation.x = pose.leftKneeX;
      legs[1].knee.rotation.x = pose.rightKneeX;
      localMarker.visible = isLocal && runnerState.grounded && runnerState.y >= -1 && !runnerState.finished;
      label.update(runnerState.name, runnerState.isBot, isLocal);
      label.sprite.visible = root.visible && camera.position.distanceToSquared(root.position) < 38 * 38;
      label.sprite.position.y = 1.97 + pose.bob * 0.25;

      let supportTopY = -Infinity;
      let supportPlatform = null;
      for (const platform of platforms) {
        if (Math.abs(runnerState.x - platform.x) <= platform.width * 0.5 && Math.abs(runnerState.z - platform.z) <= platform.depth * 0.5) {
          const candidateTopY = getKinematicPlatformTopY(platform, runnerState.x, runnerState.z);
          if (candidateTopY <= runnerState.y + 0.12 && candidateTopY > supportTopY) {
            supportTopY = candidateTopY;
            supportPlatform = platform;
          }
        }
      }
      const supportGap = runnerState.y - supportTopY;
      shadow.visible = root.visible && Number.isFinite(supportTopY) && supportGap < 5 && supportGap >= -0.15;
      shadow.position.set(runnerState.x, supportTopY + 0.026, runnerState.z);
      shadow.scale.setScalar(1.3 + Math.min(3, Math.max(0, supportGap)) * 0.2);
      surfaceNormal.set(-(supportPlatform?.slopeX || 0), 1, -(supportPlatform?.slopeZ || 0)).normalize();
      shadow.quaternion.setFromUnitVectors(planeNormal, surfaceNormal);
      inverseParentQuaternion.copy(root.quaternion).invert();
      localNormal.copy(surfaceNormal).applyQuaternion(inverseParentQuaternion);
      localMarker.quaternion.setFromUnitVectors(planeNormal, localNormal);

      const followsSlope = runnerState.grounded && supportPlatform && (supportPlatform.slopeX || supportPlatform.slopeZ) && nextAction !== "dive" && nextAction !== "hit";
      const heading = -root.rotation.y;
      const localSlopeX = followsSlope ? (supportPlatform.slopeX || 0) * Math.cos(heading) + (supportPlatform.slopeZ || 0) * Math.sin(heading) : 0;
      const localSlopeZ = followsSlope ? -(supportPlatform.slopeX || 0) * Math.sin(heading) + (supportPlatform.slopeZ || 0) * Math.cos(heading) : 0;
      for (const leg of legs) {
        leg.hip.position.y = -0.28 + localSlopeX * leg.side * 0.17 - localSlopeZ * 0.075;
        leg.ankle.quaternion.identity();
      }
      root.updateMatrixWorld(true);
      if (followsSlope) {
        for (const leg of legs) {
          leg.knee.getWorldQuaternion(inverseParentQuaternion).invert();
          localNormal.copy(surfaceNormal).applyQuaternion(inverseParentQuaternion);
          leg.ankle.quaternion.setFromUnitVectors(upNormal, localNormal);
        }
      }

      id = runnerState.id;
      action = nextAction;
      respawnId = runnerState.respawnId;
      root.updateMatrixWorld(true);
    },
    hide() {
      root.visible = false;
      shadow.visible = false;
    },
    dispose() {
      scene.remove(root);
      scene.remove(shadow);
    },
  };
}

/** Rigs and labels are allocated once in bounded slots, including reconnects. */
export function createSkyDashRunners(scene, resources) {
  const batcher = createSkyDashActorBatcher(scene);
  const contactMaterial = createRunnerContactMaterial(resources);
  const slots = Array.from({ length: SKY_DASH_MAX_RUNNERS }, () => ({ id: "", rig: null, active: false }));

  return {
    /** @param {{runners:SkyDashRenderRunner[],playerId:string,dtSec:number,timeSec:number,reducedMotion:boolean,platforms:import("../shared/course.js").SkyDashPlatform[],camera:THREE.Camera}} frame */
    update(frame) {
      for (const slot of slots) slot.active = false;
      for (const runnerState of frame.runners.slice(0, SKY_DASH_MAX_RUNNERS)) {
        let slot = slots.find((candidate) => candidate.id === runnerState.id);
        if (!slot) {
          slot = slots.find((candidate) => !candidate.active && !frame.runners.some((runner) => runner.id === candidate.id));
          if (!slot) continue;
          slot.id = runnerState.id;
        }
        if (!slot.rig) slot.rig = createRunnerRig(scene, resources, batcher, contactMaterial, slots.indexOf(slot));
        slot.rig.update(runnerState, { ...frame, isLocal: runnerState.id === frame.playerId });
        slot.active = true;
      }
      for (const slot of slots) {
        if (!slot.active) slot.rig?.hide();
      }
      batcher.flush();
    },
    setQuality(quality) {
      batcher.setShadows(quality !== "low");
    },
    dispose() {
      for (const slot of slots) slot.rig?.dispose();
      batcher.dispose();
    },
  };
}
