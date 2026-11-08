import * as THREE from "three";

/**
 * @typedef {"Hips"|"Spine"|"Chest"|"Neck"|"Head"|"LeftShoulder"|"LeftUpperArm"|"LeftForeArm"|"LeftHand"|"RightShoulder"|"RightUpperArm"|"RightForeArm"|"RightHand"|"LeftUpperLeg"|"LeftLowerLeg"|"LeftFoot"|"LeftToe"|"RightUpperLeg"|"RightLowerLeg"|"RightFoot"|"RightToe"} RiftballBoneName
 * @typedef {Record<RiftballBoneName, THREE.Bone>} RiftballBoneMap
 */

/** @type {ReadonlyArray<readonly [RiftballBoneName, RiftballBoneName|null, number, number, number]>} */
const ATHLETE_JOINTS = [
  ["Hips", null, 0, 0.88, 0],
  ["Spine", "Hips", 0, 0.18, 0],
  ["Chest", "Spine", 0, 0.19, 0],
  ["Neck", "Chest", 0, 0.18, 0],
  ["Head", "Neck", 0, 0.055, 0],
  ["LeftShoulder", "Chest", 0.245, 0.095, 0],
  ["LeftUpperArm", "LeftShoulder", 0.065, 0, 0],
  ["LeftForeArm", "LeftUpperArm", 0.075, -0.27, 0],
  ["LeftHand", "LeftForeArm", 0, -0.25, 0],
  ["RightShoulder", "Chest", -0.245, 0.095, 0],
  ["RightUpperArm", "RightShoulder", -0.065, 0, 0],
  ["RightForeArm", "RightUpperArm", -0.075, -0.27, 0],
  ["RightHand", "RightForeArm", 0, -0.25, 0],
  ["LeftUpperLeg", "Hips", 0.15, -0.025, 0],
  ["LeftLowerLeg", "LeftUpperLeg", 0, -0.37, 0],
  ["LeftFoot", "LeftLowerLeg", 0, -0.37, 0],
  ["LeftToe", "LeftFoot", 0, -0.055, 0.14],
  ["RightUpperLeg", "Hips", -0.15, -0.025, 0],
  ["RightLowerLeg", "RightUpperLeg", 0, -0.37, 0],
  ["RightFoot", "RightLowerLeg", 0, -0.37, 0],
  ["RightToe", "RightFoot", 0, -0.055, 0.14],
];

/** Creates a bind-pose skeleton; its owner must dispose the returned skeleton. */
export function createRiftballAthleteRig() {
  /** @type {RiftballBoneMap} */
  const bones = /** @type {RiftballBoneMap} */ ({});
  /** @type {Record<RiftballBoneName, number>} */
  const boneIndices = /** @type {Record<RiftballBoneName, number>} */ ({});
  const orderedBones = [];

  for (const [name, parentName, x, y, z] of ATHLETE_JOINTS) {
    const bone = new THREE.Bone();
    bone.name = name;
    bone.position.set(x, y, z);
    bones[name] = bone;
    boneIndices[name] = orderedBones.length;
    orderedBones.push(bone);
    if (parentName) bones[parentName].add(bone);
  }

  bones.Hips.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(orderedBones);
  skeleton.calculateInverses();
  return { bones, boneIndices, skeleton };
}
