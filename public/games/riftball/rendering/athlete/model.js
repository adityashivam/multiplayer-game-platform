import * as THREE from "three";
import { RIFTBALL_TEAM_COLORS } from "../../shared/config.js";
import { createRiftballAthleteRig } from "./rig.js";
import { createAthleteSurfaceBuilder } from "./surface.js";
import { createAthleteFace } from "./face.js";

/** @typedef {import("./rig.js").RiftballBoneName} RiftballBoneName */

/**
 * Original court uniforms: fitted sleeveless jerseys, compression shorts,
 * contoured knee pads, wrapped impact gloves and layered court sneakers.
 * All body surfaces are skinned in the same canonical bind space.
 * @param {number} teamIndex
 */
export function createRiftballAthleteModel(teamIndex) {
  const identityIndex = Math.abs(teamIndex) % RIFTBALL_TEAM_COLORS.length;
  const root = new THREE.Group();
  const { bones, boneIndices, skeleton } = createRiftballAthleteRig();
  const surface = createAthleteSurfaceBuilder(boneIndices);
  const geometries = new Set();
  const materials = new Set();
  const skinColor = identityIndex === 0 ? "#b97750" : "#d9a17b";
  const teamColor = RIFTBALL_TEAM_COLORS[identityIndex];

  /** @param {string} color @param {Partial<THREE.MeshStandardMaterialParameters>} [options] */
  function createMaterial(color, options = {}) {
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0.02, ...options });
    materials.add(material);
    return material;
  }

  const bodyMaterials = [
    createMaterial(skinColor, { roughness: 0.84 }),
    createMaterial(teamColor, { roughness: 0.65 }),
    createMaterial("#152b43"),
    createMaterial("#f4f1e7", { roughness: 0.6 }),
    createMaterial("#263950", { roughness: 0.9 }),
    createMaterial(identityIndex === 0 ? "#221c25" : "#39242b", { roughness: 0.93 }),
    createMaterial("#c6cddd", { metalness: 0.18, roughness: 0.45 }),
    createMaterial(teamColor, { emissive: teamColor, emissiveIntensity: 0.03, roughness: 0.4 }),
  ];
  const [skinMaterial, , , trimMaterial, , hairMaterial] = bodyMaterials;
  const transform = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();

  /** @param {THREE.BufferGeometry} geometry @param {number} materialIndex @param {RiftballBoneName} boneName @param {number[]} position @param {number[]} [scale] @param {number[]} [rotation] */
  function addSurfaceGeometry(geometry, materialIndex, boneName, position, scale = [1, 1, 1], rotation = [0, 0, 0]) {
    quaternion.setFromEuler(new THREE.Euler(...rotation));
    transform.compose(new THREE.Vector3(...position), quaternion, new THREE.Vector3(...scale));
    surface.appendGeometry(geometry, materialIndex, [[boneName, 1]], transform);
  }

  /** @param {number} materialIndex @param {RiftballBoneName} boneName @param {number[]} position @param {number[]} scale */
  function addEllipsoid(materialIndex, boneName, position, scale) {
    addSurfaceGeometry(new THREE.SphereGeometry(1, 16, 10), materialIndex, boneName, position, scale);
  }

  /** @param {number} materialIndex @param {RiftballBoneName} boneName @param {number[]} position @param {number[]} size @param {number[]} [rotation] */
  function addPanel(materialIndex, boneName, position, size, rotation) {
    addSurfaceGeometry(new THREE.BoxGeometry(...size), materialIndex, boneName, position, [1, 1, 1], rotation);
  }

  // Torso rings give the shoulders breadth while tapering the waist.
  surface.appendLoft([
    { center: [0, 0.87, 0], width: 0.196, depth: 0.133, weights: [["Hips", 0.8], ["Spine", 0.2]] },
    { center: [0, 0.98, 0], width: 0.214, depth: 0.142, weights: [["Hips", 0.35], ["Spine", 0.65]] },
    { center: [0, 1.1, 0], width: 0.223, depth: 0.15, weights: [["Spine", 0.8], ["Chest", 0.2]] },
    { center: [0, 1.23, 0], width: 0.273, depth: 0.16, weights: [["Spine", 0.25], ["Chest", 0.75]] },
    { center: [0, 1.33, 0], width: 0.292, depth: 0.148, weights: [["Chest", 1]] },
    { center: [0, 1.38, 0], width: 0.235, depth: 0.12, weights: [["Chest", 0.9], ["Neck", 0.1]] },
    { center: [0, 1.415, 0], width: 0.085, depth: 0.076, weights: [["Chest", 0.6], ["Neck", 0.4]] },
  ], 1, 20);
  surface.appendLoft([
    { center: [0, 1.39, 0], width: 0.069, depth: 0.064, weights: [["Neck", 0.7], ["Chest", 0.3]] },
    { center: [0, 1.48, 0], width: 0.068, depth: 0.064, weights: [["Neck", 0.5], ["Head", 0.5]] },
    { center: [0, 1.51, 0.012], width: 0.08, depth: 0.074, weights: [["Head", 1]] },
  ], 0);

  // A warm face with a shaped jaw, nose, ears and a stable authored haircut.
  addEllipsoid(0, "Head", [0, 1.605, 0.007], [identityIndex === 0 ? 0.177 : 0.168, 0.194, 0.159]);
  addEllipsoid(0, "Head", [0, 1.52, 0.04], [0.134, 0.105, 0.132]);
  addEllipsoid(0, "Head", [0, 1.602, 0.161], [0.033, 0.041, 0.046]);
  for (const side of [-1, 1]) {
    addEllipsoid(0, "Head", [side * 0.174, 1.606, 0], [0.035, 0.056, 0.028]);
    addPanel(4, "Head", [side * 0.181, 1.635, -0.002], [0.02, 0.047, 0.045], [0, 0, side * 0.12]);
  }
  addSurfaceGeometry(new THREE.SphereGeometry(1, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.47), 5, "Head", [0, 1.62, -0.012], [0.182, 0.194, 0.171]);
  if (identityIndex === 0) {
    for (let curlIndex = 0; curlIndex < 11; curlIndex += 1) {
      const angle = curlIndex * 2.39996;
      const radius = Math.sqrt(curlIndex / 11) * 0.132;
      addEllipsoid(5, "Head", [Math.cos(angle) * radius, 1.803 - radius * 0.22, Math.sin(angle) * radius - 0.012], [0.043, 0.035, 0.042]);
    }
  } else {
    addEllipsoid(5, "Head", [-0.042, 1.783, 0.032], [0.146, 0.051, 0.128]);
    addEllipsoid(5, "Head", [0, 1.758, -0.168], [0.064, 0.074, 0.064]);
    for (let braidIndex = 0; braidIndex < 4; braidIndex += 1) {
      addEllipsoid(5, "Head", [Math.sin(braidIndex * 2) * 0.012, 1.72 - braidIndex * 0.055, -0.194 - braidIndex * 0.018], [0.045 - braidIndex * 0.006, 0.043, 0.04]);
    }
    addEllipsoid(1, "Head", [0, 1.745, -0.184], [0.065, 0.013, 0.06]);
  }

  for (const [side, prefix] of /** @type {const} */ ([[1, "Left"], [-1, "Right"]])) {
    const upperArm = /** @type {RiftballBoneName} */ (`${prefix}UpperArm`);
    const forearm = /** @type {RiftballBoneName} */ (`${prefix}ForeArm`);
    const hand = /** @type {RiftballBoneName} */ (`${prefix}Hand`);
    const upperLeg = /** @type {RiftballBoneName} */ (`${prefix}UpperLeg`);
    const lowerLeg = /** @type {RiftballBoneName} */ (`${prefix}LowerLeg`);
    const foot = /** @type {RiftballBoneName} */ (`${prefix}Foot`);
    const toe = /** @type {RiftballBoneName} */ (`${prefix}Toe`);

    surface.appendLoft([
      { center: [side * 0.285, 1.344, 0], width: 0.098, depth: 0.099, weights: [[upperArm, 0.7], ["Chest", 0.3]] },
      { center: [side * 0.333, 1.255, 0], width: 0.1, depth: 0.095, weights: [[upperArm, 1]] },
      { center: [side * 0.37, 1.15, 0], width: 0.084, depth: 0.082, weights: [[upperArm, 0.85], [forearm, 0.15]] },
      { center: [side * 0.385, 1.075, 0], width: 0.071, depth: 0.072, weights: [[upperArm, 0.45], [forearm, 0.55]] },
      { center: [side * 0.385, 0.984, 0], width: 0.076, depth: 0.074, weights: [[forearm, 1]] },
      { center: [side * 0.385, 0.877, 0], width: 0.057, depth: 0.054, weights: [[forearm, 0.8], [hand, 0.2]] },
      { center: [side * 0.385, 0.826, 0], width: 0.052, depth: 0.05, weights: [[hand, 1]] },
    ], 0);
    addEllipsoid(1, upperArm, [side * 0.306, 1.337, -0.003], [0.103, 0.091, 0.107]);
    addPanel(3, upperArm, [side * 0.363, 1.294, 0.065], [0.014, 0.056, 0.1], [0, 0, side * -0.3]);
    addEllipsoid(4, hand, [side * 0.385, 0.776, 0.019], [0.084, 0.104, 0.077]);
    addEllipsoid(7, hand, [side * 0.385, 0.768, 0.074], [0.076, 0.067, 0.028]);
    addEllipsoid(3, hand, [side * 0.32, 0.793, 0.041], [0.037, 0.058, 0.044]);
    addPanel(3, hand, [side * 0.385, 0.845, 0.008], [0.12, 0.038, 0.112]);
    for (let knuckleIndex = 0; knuckleIndex < 3; knuckleIndex += 1) {
      addPanel(6, hand, [side * 0.385 + (knuckleIndex - 1) * 0.034, 0.757, 0.099], [0.022, 0.041, 0.015], [-0.1, 0, 0]);
    }

    surface.appendLoft([
      { center: [side * 0.132, 0.9, 0], width: 0.145, depth: 0.145, weights: [["Hips", 0.5], [upperLeg, 0.5]] },
      { center: [side * 0.146, 0.808, 0], width: 0.147, depth: 0.153, weights: [[upperLeg, 0.9], ["Hips", 0.1]] },
      { center: [side * 0.15, 0.696, 0], width: 0.121, depth: 0.13, weights: [[upperLeg, 1]] },
      { center: [side * 0.15, 0.659, 0], width: 0.116, depth: 0.123, weights: [[upperLeg, 1]] },
    ], 2);
    surface.appendLoft([
      { center: [side * 0.15, 0.685, 0], width: 0.108, depth: 0.116, weights: [[upperLeg, 1]] },
      { center: [side * 0.15, 0.574, 0], width: 0.098, depth: 0.106, weights: [[upperLeg, 0.85], [lowerLeg, 0.15]] },
      { center: [side * 0.15, 0.486, 0], width: 0.084, depth: 0.094, weights: [[upperLeg, 0.5], [lowerLeg, 0.5]] },
      { center: [side * 0.15, 0.405, 0], width: 0.086, depth: 0.091, weights: [[lowerLeg, 0.95], [upperLeg, 0.05]] },
      { center: [side * 0.15, 0.279, -0.005], width: 0.073, depth: 0.078, weights: [[lowerLeg, 1]] },
      { center: [side * 0.15, 0.148, 0], width: 0.052, depth: 0.059, weights: [[lowerLeg, 0.6], [foot, 0.4]] },
      { center: [side * 0.15, 0.115, 0], width: 0.051, depth: 0.055, weights: [[foot, 1]] },
    ], 0);
    addPanel(1, upperLeg, [side * 0.258, 0.751, 0.005], [0.022, 0.16, 0.137], [0, 0, side * -0.08]);
    addPanel(3, upperLeg, [side * 0.272, 0.754, 0.008], [0.008, 0.12, 0.048]);
    addEllipsoid(4, lowerLeg, [side * 0.15, 0.484, 0.083], [0.094, 0.125, 0.041]);
    addEllipsoid(1, lowerLeg, [side * 0.15, 0.493, 0.119], [0.063, 0.075, 0.014]);
    addPanel(6, lowerLeg, [side * 0.15, 0.493, 0.135], [0.066, 0.012, 0.01]);

    const shoeAxis = new THREE.Vector3(0, 1, 0);
    const shoeProfiles = [
      { z: -0.112, width: 0.06, height: 0.043, y: 0.071 },
      { z: -0.071, width: 0.083, height: 0.067, y: 0.085 },
      { z: 0.035, width: 0.094, height: 0.068, y: 0.088 },
      { z: 0.153, width: 0.099, height: 0.046, y: 0.067 },
      { z: 0.228, width: 0.079, height: 0.032, y: 0.052 },
      { z: 0.257, width: 0.035, height: 0.019, y: 0.044 },
    ];
    surface.appendLoft(shoeProfiles.map((profile) => ({
      center: [side * 0.15, profile.y, profile.z], width: profile.width, depth: profile.height,
      weights: [[foot, 1]],
    })), 3, 16, shoeAxis);
    surface.appendLoft(shoeProfiles.map((profile) => ({
      center: [side * 0.15, 0.021, profile.z], width: profile.width + 0.004, depth: 0.021,
      weights: [[foot, 1]],
    })), 4, 16, shoeAxis);
    addPanel(1, foot, [side * 0.15, 0.105, 0.107], [0.16, 0.018, 0.067], [-0.14, 0, 0]);
    addPanel(1, foot, [side * 0.15 + side * 0.092, 0.075, 0.012], [0.013, 0.042, 0.15], [0, 0, side * -0.2]);
    addPanel(6, toe, [side * 0.15, 0.071, 0.195], [0.12, 0.015, 0.036], [0.12, 0, 0]);
    for (let laceIndex = 0; laceIndex < 3; laceIndex += 1) {
      addPanel(4, foot, [side * 0.15, 0.153 - laceIndex * 0.006, 0.025 + laceIndex * 0.026], [0.093, 0.009, 0.011]);
    }
  }

  addPanel(2, "Hips", [0, 0.916, 0], [0.38, 0.055, 0.263]);
  addPanel(3, "Hips", [0, 0.916, 0.137], [0.09, 0.028, 0.01]);
  addPanel(3, "Chest", [-0.169, 1.268, 0.143], [0.036, 0.16, 0.018], [0, 0, -0.37]);
  addPanel(2, "Chest", [0.149, 1.282, 0.151], [0.041, 0.052, 0.015]);
  addPanel(3, "Chest", [0.149, 1.282, 0.163], [0.022, 0.011, 0.007]);
  addSurfaceGeometry(new THREE.TorusGeometry(0.084, 0.014, 6, 24), 2, "Neck", [0, 1.424, 0], [1, 1, 1], [Math.PI / 2, 0, 0]);

  /** @param {number} digit @param {number} centerX @param {number} faceZ */
  function addJerseyNumber(digit, centerX, faceZ) {
    const segments = digit === 0 ? [0, 1, 2, 3, 4, 5] : digit === 1 ? [1, 2] : [0, 1, 6, 4, 3];
    const bars = [
      [0, 0.081, 0.051, 0.014], [0.028, 0.042, 0.013, 0.069],
      [0.028, -0.042, 0.013, 0.069], [0, -0.081, 0.051, 0.014],
      [-0.028, -0.042, 0.013, 0.069], [-0.028, 0.042, 0.013, 0.069],
      [0, 0, 0.051, 0.014],
    ];
    for (const segmentIndex of segments) {
      const [x, y, width, height] = bars[segmentIndex];
      const numberX = (centerX + x) * (faceZ < 0 ? -1 : 1);
      addPanel(3, "Chest", [numberX, 1.18 + y, faceZ], [width, height, 0.011]);
    }
  }
  for (const faceZ of [0.163, -0.163]) {
    addJerseyNumber(0, -0.041, faceZ);
    addJerseyNumber(identityIndex + 1, 0.041, faceZ);
  }

  const geometry = surface.finish();
  geometries.add(geometry);
  const body = new THREE.SkinnedMesh(geometry, bodyMaterials);
  body.name = "RiftballAthleteBody";
  body.castShadow = true;
  body.receiveShadow = true;
  body.frustumCulled = false;
  body.add(bones.Hips);
  body.bind(skeleton);
  root.add(body);
  const face = createAthleteFace({ head: bones.Head, skinMaterial, hairMaterial, trimMaterial, geometries, materials });

  const contactGeometry = new THREE.TorusGeometry(0.46, 0.012, 4, 40);
  const contactMaterial = new THREE.MeshBasicMaterial({ color: teamColor, transparent: true, opacity: 0.42, depthWrite: false });
  geometries.add(contactGeometry);
  materials.add(contactMaterial);
  const contactRing = new THREE.Mesh(contactGeometry, contactMaterial);
  contactRing.rotation.x = Math.PI / 2;
  contactRing.position.y = 0.015;
  root.add(contactRing);

  let disposed = false;
  return {
    root, body, bones, skeleton, face, geometries, materials, contactRing,
    feet: [bones.LeftFoot, bones.RightFoot],
    impactMaterial: bodyMaterials[7],
    dispose() {
      if (disposed) return;
      disposed = true;
      root.removeFromParent();
      skeleton.dispose();
      for (const ownedGeometry of geometries) ownedGeometry.dispose();
      for (const ownedMaterial of materials) ownedMaterial.dispose();
      geometries.clear();
      materials.clear();
      root.clear();
    },
  };
}
