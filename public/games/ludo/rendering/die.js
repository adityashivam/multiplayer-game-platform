import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { LUDO_PALETTE } from "../shared/config.js";
import { LUDO_DIE_FACES, getLudoDieOrientation, getLudoDisplayedDieValue } from "./presentation.js";
import { createLudoCanvasTexture, createLudoContactTexture, easeLudoSmooth } from "./resources.js";

/** @typedef {import("./resources.js").LudoResources} LudoResources */

const DIE_REST_HEIGHT = 0.78;
const DIE_PIPS = Object.freeze({
  1: [[0.5, 0.5]],
  2: [[0.29, 0.29], [0.71, 0.71]],
  3: [[0.29, 0.29], [0.5, 0.5], [0.71, 0.71]],
  4: [[0.29, 0.29], [0.71, 0.29], [0.29, 0.71], [0.71, 0.71]],
  5: [[0.29, 0.29], [0.71, 0.29], [0.5, 0.5], [0.29, 0.71], [0.71, 0.71]],
  6: [[0.29, 0.27], [0.71, 0.27], [0.29, 0.5], [0.71, 0.5], [0.29, 0.73], [0.71, 0.73]],
});

/** @param {LudoResources} resources @param {number} value */
function createLudoDieFace(resources, value) {
  const texture = createLudoCanvasTexture(resources, 256, (context, size) => {
    const faceGradient = context.createRadialGradient(size * 0.3, size * 0.25, 0, size * 0.5, size * 0.5, size * 0.8);
    faceGradient.addColorStop(0, "#fffdf5");
    faceGradient.addColorStop(0.65, "#f8f1df");
    faceGradient.addColorStop(1, "#e5dac3");
    context.fillStyle = faceGradient;
    context.fillRect(0, 0, size, size);

    for (const [normalizedX, normalizedY] of DIE_PIPS[value]) {
      const x = normalizedX * size;
      const y = normalizedY * size;
      const radius = size * 0.076;
      const recessGradient = context.createRadialGradient(x - radius * 0.3, y - radius * 0.4, 0, x, y, radius);
      recessGradient.addColorStop(0, "#344954");
      recessGradient.addColorStop(0.65, "#142b37");
      recessGradient.addColorStop(0.9, "#12222b");
      recessGradient.addColorStop(1, "#56616a");
      context.fillStyle = "rgba(255,255,255,0.9)";
      context.beginPath();
      context.arc(x, y + 1.5, radius + 1.5, 0, Math.PI * 2);
      context.fill();
      context.fillStyle = recessGradient;
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fill();
    }
  });

  return resources.material(new THREE.MeshPhysicalMaterial({
    map: texture, color: "#ffffff", roughness: 0.25, metalness: 0.025,
    clearcoat: 0.85, clearcoatRoughness: 0.16, envMapIntensity: 0.75,
    emissive: "#58cbdc", emissiveIntensity: 0,
  }));
}

/**
 * Six physically authored faces, with a deterministic render-time tumble. The
 * target orientation always comes from the server result; pending input only
 * spins the existing die and cannot choose or commit an outcome.
 * @param {LudoResources} resources
 */
export function createLudoDie(resources) {
  const group = new THREE.Group();
  const materials = LUDO_DIE_FACES.map(({ value }) => createLudoDieFace(resources, value));
  const mesh = new THREE.Mesh(
    resources.geometry(new RoundedBoxGeometry(0.82, 0.82, 0.82, 5, 0.105)),
    materials,
  );
  mesh.position.y = DIE_REST_HEIGHT;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.ludoPick = { kind: "die" };
  group.add(mesh);

  // A generous invisible hit volume keeps the compact hub easy to tap without
  // covering the adjacent finish cells with oversized visible geometry.
  const pickProxy = new THREE.Mesh(
    resources.geometry(new THREE.SphereGeometry(0.95, 12, 8)),
    resources.material(new THREE.MeshBasicMaterial()),
  );
  pickProxy.userData.ludoPick = mesh.userData.ludoPick;
  pickProxy.visible = false;
  group.add(pickProxy);

  const shadow = new THREE.Mesh(
    resources.geometry(new THREE.PlaneGeometry(2, 2)),
    resources.material(new THREE.MeshBasicMaterial({
      map: createLudoContactTexture(resources), transparent: true, opacity: 0.7, depthWrite: false,
    })),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.367;
  group.add(shadow);

  const ringMaterial = resources.material(new THREE.MeshBasicMaterial({
    color: "#80e8ec", transparent: true, opacity: 0.5, depthWrite: false, toneMapped: false,
  }));
  const rollRing = new THREE.Mesh(resources.geometry(new THREE.RingGeometry(0.62, 0.66, 64)), ringMaterial);
  rollRing.rotation.x = -Math.PI / 2;
  rollRing.position.y = 0.266;
  group.add(rollRing);

  const yawOrientation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 8);
  const orientations = new Map();

  for (let value = 1; value <= 6; value += 1) {
    orientations.set(value, new THREE.Quaternion(...getLudoDieOrientation(value)).premultiply(yawOrientation));
  }

  const spinEuler = new THREE.Euler();
  const spinOrientation = new THREE.Quaternion();
  const rollStartOrientation = new THREE.Quaternion();
  const pendingStartOrientation = new THREE.Quaternion();
  let observedAnimationId = null;
  let pendingStartedAtMs = null;
  let hovered = false;

  return {
    group,
    pickable: pickProxy,
    /** @param {boolean} value */
    setHovered(value) {
      hovered = value;
    },
    resetPresentation() {
      observedAnimationId = null;
      pendingStartedAtMs = null;
      hovered = false;
      rollStartOrientation.identity();
      pendingStartOrientation.identity();
      mesh.quaternion.copy(orientations.get(1));
      mesh.position.set(0, DIE_REST_HEIGHT, 0);
      pickProxy.position.copy(mesh.position);
      shadow.position.set(0, 0.367, 0);
      shadow.scale.setScalar(1);
      rollRing.visible = false;
    },
    /** @param {{snapshot:import("../shared/rules.js").LudoRoundState,animation:import("./presentation.js").LudoActionFrame|null,nowMs:number,reducedMotion:boolean,pendingRoll:boolean,canRoll:boolean}} frame */
    update({ snapshot, animation, nowMs, reducedMotion, pendingRoll, canRoll }) {
      const targetOrientation = orientations.get(getLudoDisplayedDieValue(snapshot)) ?? orientations.get(1);
      const rollAnimation = animation?.action.kind === "roll" ? animation : null;
      const currentColor = snapshot.players[snapshot.currentPlayerId]?.color;
      ringMaterial.color.set(LUDO_PALETTE[currentColor]?.color ?? "#80e8ec");
      rollRing.visible = canRoll || pendingRoll || Boolean(rollAnimation);
      ringMaterial.opacity = reducedMotion ? 0.7 : 0.55 + Math.sin(nowMs * 0.004) * 0.18;
      rollRing.scale.setScalar(hovered ? 1.06 : 1);

      for (const material of materials) {
        material.emissiveIntensity = canRoll ? (hovered ? 0.055 : 0.015) : 0;
      }

      if (rollAnimation && !reducedMotion) {
        pendingStartedAtMs = null;

        if (observedAnimationId !== rollAnimation.identity) {
          observedAnimationId = rollAnimation.identity;
          rollStartOrientation.copy(mesh.quaternion);
        }

        const progress = rollAnimation.progress;
        const angle = Math.PI * 8 * (1 - Math.pow(1 - progress, 3));
        spinEuler.set(angle, angle * 0.75, angle * 0.5);
        spinOrientation.setFromEuler(spinEuler);
        mesh.quaternion.copy(rollStartOrientation).premultiply(spinOrientation);
        mesh.quaternion.slerp(targetOrientation, easeLudoSmooth((progress - 0.58) / 0.42));
        mesh.position.set(
          Math.sin(progress * Math.PI) * 0.32,
          DIE_REST_HEIGHT + Math.abs(Math.sin(progress * Math.PI * 3.5)) * Math.pow(1 - progress, 1.35) * 1.45,
          Math.sin(progress * Math.PI * 2) * 0.22,
        );
      } else if (pendingRoll && !reducedMotion) {
        if (pendingStartedAtMs === null) {
          pendingStartedAtMs = nowMs;
          pendingStartOrientation.copy(mesh.quaternion);
        }

        const elapsedMs = Math.max(0, nowMs - pendingStartedAtMs);
        spinEuler.set(elapsedMs * 0.009, elapsedMs * 0.006, elapsedMs * 0.004);
        mesh.quaternion.copy(pendingStartOrientation).premultiply(spinOrientation.setFromEuler(spinEuler));
        mesh.position.set(0, DIE_REST_HEIGHT + Math.abs(Math.sin(elapsedMs * 0.009)) * 0.25, 0);
      } else {
        pendingStartedAtMs = null;
        mesh.quaternion.copy(targetOrientation);
        mesh.position.set(0, DIE_REST_HEIGHT, 0);
      }

      shadow.position.x = mesh.position.x;
      shadow.position.z = mesh.position.z;
      shadow.scale.setScalar(1 + Math.max(0, mesh.position.y - DIE_REST_HEIGHT) * 0.2);
      pickProxy.position.copy(mesh.position);
    },
  };
}
