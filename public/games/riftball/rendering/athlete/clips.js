import * as THREE from "three";

/**
 * @typedef {import("./rig.js").RiftballBoneName} RiftballBoneName
 * @typedef {Readonly<Record<RiftballBoneName, readonly [number,number,number]>>} AthleteBonePose
 * @typedef {{time:number,rotations:Partial<AthleteBonePose>,hipHeight?:number}} AthleteKeyPose
 */

/** Rest angles are shared by every authored move so identities and pivots agree. */
const READY_POSE = Object.freeze({
  Hips: [0, 0, 0], Spine: [-0.035, 0, 0], Chest: [-0.025, 0, 0], Neck: [0, 0, 0], Head: [0.025, 0, 0],
  LeftShoulder: [0, 0, 0], LeftUpperArm: [0.04, 0, 0.13], LeftForeArm: [-0.5, 0, 0], LeftHand: [0.06, 0, 0],
  RightShoulder: [0, 0, 0], RightUpperArm: [0.04, 0, -0.13], RightForeArm: [-0.5, 0, 0], RightHand: [0.06, 0, 0],
  LeftUpperLeg: [-0.08, 0, 0.035], LeftLowerLeg: [0.16, 0, 0], LeftFoot: [-0.08, 0, 0], LeftToe: [0, 0, 0],
  RightUpperLeg: [-0.08, 0, -0.035], RightLowerLeg: [0.16, 0, 0], RightFoot: [-0.08, 0, 0], RightToe: [0, 0, 0],
});

/**
 * Each clip contains authored quaternion keys, including independent elbow/knee
 * articulation. Timings align with game contact windows; playback never affects
 * the authoritative action timer. All values are radians in canonical +Z space.
 * @param {string} name
 * @param {number} durationSec
 * @param {ReadonlyArray<AthleteKeyPose>} keyPoses
 */
function createAuthoredAthleteClip(name, durationSec, keyPoses) {
  const tracks = [];
  const quaternion = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const times = keyPoses.map((keyPose) => keyPose.time);
  for (const boneName of /** @type {RiftballBoneName[]} */ (Object.keys(READY_POSE))) {
    const values = [];
    for (const keyPose of keyPoses) {
      const angles = keyPose.rotations[boneName] || READY_POSE[boneName];
      quaternion.setFromEuler(euler.set(...angles));
      values.push(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, times, values));
  }
  const hipPositions = [];
  for (const keyPose of keyPoses) hipPositions.push(0, keyPose.hipHeight ?? 0.88, 0);
  tracks.push(new THREE.VectorKeyframeTrack("Hips.position", times, hipPositions));
  return new THREE.AnimationClip(name, durationSec, tracks);
}

/** Original, hand-authored animation library. Each model owns its mixer actions. */
export function createRiftballAthleteClips() {
  const idle = createAuthoredAthleteClip("idle", 2.2, [
    { time: 0, rotations: {} },
    {
      time: 1.1,
      rotations: {
        Chest: [-0.01, 0.012, 0],
        Spine: [-0.02, -0.008, 0],
        LeftShoulder: [0, 0, 0.015],
        RightShoulder: [0, 0, -0.015],
      },
    },
    { time: 2.2, rotations: {} },
  ]);
  const run = createAuthoredAthleteClip("run", 0.62, [
    {
      time: 0,
      rotations: {
        Hips: [0.09, -0.05, 0],
        Chest: [0.1, 0.1, 0],
        LeftUpperLeg: [-0.62, 0, 0.025],
        LeftLowerLeg: [0.3, 0, 0],
        LeftFoot: [0.32, 0, 0],
        RightUpperLeg: [0.5, 0, -0.025],
        RightLowerLeg: [1.05, 0, 0],
        RightFoot: [-0.75, 0, 0],
        LeftUpperArm: [0.5, 0, 0.12],
        LeftForeArm: [-1.05, 0, 0],
        RightUpperArm: [-0.63, 0, -0.12],
        RightForeArm: [-0.85, 0, 0],
      },
    },
    {
      time: 0.155,
      rotations: {
        Hips: [0.09, 0.02, 0],
        Chest: [0.1, -0.04, 0],
        LeftUpperLeg: [0.12, 0, 0.025],
        LeftLowerLeg: [0.2, 0, 0],
        LeftFoot: [-0.32, 0, 0],
        RightUpperLeg: [-0.7, 0, -0.025],
        RightLowerLeg: [1.35, 0, 0],
        RightFoot: [-0.2, 0, 0],
        LeftUpperArm: [-0.13, 0, 0.12],
        LeftForeArm: [-0.9, 0, 0],
        RightUpperArm: [0.05, 0, -0.12],
        RightForeArm: [-1.1, 0, 0],
      },
    },
    {
      time: 0.31,
      rotations: {
        Hips: [0.09, 0.05, 0],
        Chest: [0.1, -0.1, 0],
        RightUpperLeg: [-0.62, 0, -0.025],
        RightLowerLeg: [0.3, 0, 0],
        RightFoot: [0.32, 0, 0],
        LeftUpperLeg: [0.5, 0, 0.025],
        LeftLowerLeg: [1.05, 0, 0],
        LeftFoot: [-0.75, 0, 0],
        RightUpperArm: [0.5, 0, -0.12],
        RightForeArm: [-1.05, 0, 0],
        LeftUpperArm: [-0.63, 0, 0.12],
        LeftForeArm: [-0.85, 0, 0],
      },
    },
    {
      time: 0.465,
      rotations: {
        Hips: [0.09, -0.02, 0],
        Chest: [0.1, 0.04, 0],
        RightUpperLeg: [0.12, 0, -0.025],
        RightLowerLeg: [0.2, 0, 0],
        RightFoot: [-0.32, 0, 0],
        LeftUpperLeg: [-0.7, 0, 0.025],
        LeftLowerLeg: [1.35, 0, 0],
        LeftFoot: [-0.2, 0, 0],
        RightUpperArm: [-0.13, 0, -0.12],
        RightForeArm: [-0.9, 0, 0],
        LeftUpperArm: [0.05, 0, 0.12],
        LeftForeArm: [-1.1, 0, 0],
      },
    },
    {
      time: 0.62,
      rotations: {
        Hips: [0.09, -0.05, 0],
        Chest: [0.1, 0.1, 0],
        LeftUpperLeg: [-0.62, 0, 0.025],
        LeftLowerLeg: [0.3, 0, 0],
        LeftFoot: [0.32, 0, 0],
        RightUpperLeg: [0.5, 0, -0.025],
        RightLowerLeg: [1.05, 0, 0],
        RightFoot: [-0.75, 0, 0],
        LeftUpperArm: [0.5, 0, 0.12],
        LeftForeArm: [-1.05, 0, 0],
        RightUpperArm: [-0.63, 0, -0.12],
        RightForeArm: [-0.85, 0, 0],
      },
    },
  ]);
  const charge = createAuthoredAthleteClip("charge", 0.85, [
    { time: 0, rotations: {} },
    {
      time: 0.15,
      rotations: {
        Hips: [0.07, -0.1, 0],
        Chest: [-0.08, -0.32, 0.03],
        RightUpperArm: [-0.8, 0.1, -0.65],
        RightForeArm: [-1.35, 0, 0],
        LeftUpperArm: [-0.7, 0, 0.25],
        LeftForeArm: [-1, 0, 0],
        LeftUpperLeg: [-0.23, 0, 0.04],
        LeftLowerLeg: [0.45, 0, 0],
        RightUpperLeg: [-0.17, 0, -0.04],
        RightLowerLeg: [0.34, 0, 0],
      },
    },
    {
      time: 0.6,
      rotations: {
        Hips: [0.1, -0.24, 0.04],
        Chest: [-0.16, -0.58, 0.08],
        RightUpperArm: [-1.85, 0.1, -0.55],
        RightForeArm: [-1.15, 0, 0],
        LeftUpperArm: [-0.9, 0, 0.32],
        LeftForeArm: [-1.2, 0, 0],
        LeftUpperLeg: [-0.35, 0, 0.04],
        LeftLowerLeg: [0.61, 0, 0],
        RightUpperLeg: [-0.23, 0, -0.04],
        RightLowerLeg: [0.5, 0, 0],
      },
    },
    {
      time: 0.85,
      rotations: {
        Hips: [0.1, -0.25, 0.04],
        Chest: [-0.17, -0.6, 0.09],
        RightUpperArm: [-2, 0.1, -0.58],
        RightForeArm: [-1.15, 0, 0],
        LeftUpperArm: [-0.92, 0, 0.32],
        LeftForeArm: [-1.2, 0, 0],
        LeftUpperLeg: [-0.35, 0, 0.04],
        LeftLowerLeg: [0.61, 0, 0],
        RightUpperLeg: [-0.23, 0, -0.04],
        RightLowerLeg: [0.5, 0, 0],
      },
    },
  ]);
  const quickStrike = createAuthoredAthleteClip("quickStrike", 0.38, [
    {
      time: 0,
      rotations: {
        Chest: [-0.04, -0.18, 0],
        RightUpperArm: [-0.15, 0, -0.18],
        RightForeArm: [-0.75, 0, 0],
        LeftForeArm: [-0.95, 0, 0],
      },
    },
    {
      time: 0.055,
      rotations: {
        Chest: [0.03, -0.04, 0],
        RightUpperArm: [-0.7, 0, -0.08],
        RightForeArm: [-0.5, 0, 0],
        LeftForeArm: [-1.1, 0, 0],
      },
    },
    {
      time: 0.105,
      rotations: {
        Hips: [0.045, 0.08, 0],
        Chest: [0.09, 0.25, 0],
        RightUpperArm: [-1.5, 0, -0.03],
        RightForeArm: [-0.025, 0, 0],
        RightHand: [-0.08, 0, 0],
        LeftUpperArm: [-0.45, 0, 0.25],
        LeftForeArm: [-1.15, 0, 0],
      },
    },
    {
      time: 0.17,
      rotations: {
        Hips: [0.04, 0.1, 0],
        Chest: [0.06, 0.28, -0.025],
        RightUpperArm: [-1.2, 0, 0.05],
        RightForeArm: [-0.3, 0, 0],
        LeftForeArm: [-1.05, 0, 0],
      },
    },
    { time: 0.28, rotations: { Chest: [-0.02, 0.06, 0], RightUpperArm: [-0.2, 0, -0.13], RightForeArm: [-0.8, 0, 0] } },
    { time: 0.38, rotations: {} },
  ]);
  const powerStrike = createAuthoredAthleteClip("powerStrike", 0.38, [
    {
      time: 0,
      rotations: {
        Hips: [0.1, -0.25, 0.04],
        Chest: [-0.16, -0.6, 0.09],
        RightUpperArm: [-2, 0.1, -0.58],
        RightForeArm: [-1.15, 0, 0],
        LeftUpperArm: [-0.9, 0, 0.32],
        LeftForeArm: [-1.2, 0, 0],
        LeftUpperLeg: [-0.35, 0, 0.04],
        LeftLowerLeg: [0.61, 0, 0],
        RightUpperLeg: [-0.23, 0, -0.04],
        RightLowerLeg: [0.5, 0, 0],
      },
    },
    {
      time: 0.065,
      rotations: {
        Hips: [0.12, -0.1, 0.02],
        Chest: [-0.03, -0.32, 0.06],
        RightUpperArm: [-2.25, 0.05, -0.22],
        RightForeArm: [-0.4, 0, 0],
        LeftUpperArm: [-0.85, 0, 0.35],
        LeftForeArm: [-1.1, 0, 0],
        LeftUpperLeg: [-0.25, 0, 0.04],
        LeftLowerLeg: [0.5, 0, 0],
      },
    },
    {
      time: 0.105,
      rotations: {
        Hips: [0.15, 0.25, -0.02],
        Chest: [0.15, 0.56, -0.04],
        RightUpperArm: [-1.52, 0.1, 0.2],
        RightForeArm: [-0.045, 0, 0],
        RightHand: [0.1, 0, 0],
        LeftUpperArm: [-0.6, 0, 0.32],
        LeftForeArm: [-1.05, 0, 0],
        LeftUpperLeg: [-0.3, 0, 0.04],
        LeftLowerLeg: [0.58, 0, 0],
        RightUpperLeg: [0.15, 0, -0.04],
        RightLowerLeg: [0.3, 0, 0],
      },
    },
    {
      time: 0.19,
      rotations: {
        Hips: [0.12, 0.35, -0.04],
        Chest: [0.18, 0.96, -0.1],
        RightUpperArm: [-0.98, 0, 0.72],
        RightForeArm: [-0.35, 0, 0],
        LeftUpperArm: [0.2, 0, 0.4],
        LeftForeArm: [-0.7, 0, 0],
        LeftUpperLeg: [-0.4, 0, 0.04],
        LeftLowerLeg: [0.7, 0, 0],
        RightUpperLeg: [0.22, 0, -0.04],
        RightLowerLeg: [0.25, 0, 0],
      },
    },
    { time: 0.3, rotations: { Chest: [0.04, 0.4, -0.02], RightUpperArm: [-0.3, 0, 0.15], RightForeArm: [-0.8, 0, 0] } },
    { time: 0.38, rotations: {} },
  ]);
  const jump = createAuthoredAthleteClip("jump", 0.65, [
    {
      time: 0,
      hipHeight: 0.84,
      rotations: {
        Hips: [0.08, 0, 0],
        LeftUpperLeg: [-0.48, 0, 0.04],
        LeftLowerLeg: [0.9, 0, 0],
        RightUpperLeg: [-0.48, 0, -0.04],
        RightLowerLeg: [0.9, 0, 0],
        LeftUpperArm: [0.5, 0, 0.2],
        RightUpperArm: [0.5, 0, -0.2],
      },
    },
    {
      time: 0.12,
      rotations: {
        Hips: [0.06, 0, 0],
        LeftUpperLeg: [-1, 0, 0.09],
        LeftLowerLeg: [1.55, 0, 0],
        LeftFoot: [-0.3, 0, 0],
        RightUpperLeg: [-0.85, 0, -0.09],
        RightLowerLeg: [1.4, 0, 0],
        RightFoot: [-0.3, 0, 0],
        LeftUpperArm: [-1.85, 0, 0.35],
        LeftForeArm: [-0.5, 0, 0],
        RightUpperArm: [-1.7, 0, -0.35],
        RightForeArm: [-0.65, 0, 0],
      },
    },
    {
      time: 0.31,
      rotations: {
        LeftUpperLeg: [-0.9, 0, 0.1],
        LeftLowerLeg: [1.65, 0, 0],
        LeftFoot: [-0.4, 0, 0],
        RightUpperLeg: [-0.7, 0, -0.1],
        RightLowerLeg: [1.35, 0, 0],
        RightFoot: [-0.35, 0, 0],
        LeftUpperArm: [-1.45, 0, 0.48],
        LeftForeArm: [-0.55, 0, 0],
        RightUpperArm: [-1.1, 0, -0.48],
        RightForeArm: [-0.8, 0, 0],
      },
    },
    {
      time: 0.52,
      rotations: {
        LeftUpperLeg: [-0.24, 0, 0.05],
        LeftLowerLeg: [0.55, 0, 0],
        LeftFoot: [-0.25, 0, 0],
        RightUpperLeg: [-0.16, 0, -0.05],
        RightLowerLeg: [0.4, 0, 0],
        RightFoot: [-0.23, 0, 0],
        LeftUpperArm: [-0.6, 0, 0.3],
        RightUpperArm: [-0.5, 0, -0.3],
      },
    },
    { time: 0.65, rotations: {} },
  ]);
  const dash = createAuthoredAthleteClip("dash", 0.2, [
    {
      time: 0,
      rotations: {
        Hips: [0.16, 0, 0],
        Chest: [0.2, 0, 0],
        LeftUpperLeg: [-0.55, 0, 0.04],
        LeftLowerLeg: [1.05, 0, 0],
        LeftFoot: [-0.5, 0, 0],
        RightUpperLeg: [-0.55, 0, -0.04],
        RightLowerLeg: [1.05, 0, 0],
        RightFoot: [-0.5, 0, 0],
      },
    },
    {
      time: 0.07,
      rotations: {
        Hips: [0.15, 0, 0],
        Chest: [0.46, 0, 0],
        Head: [-0.4, 0, 0],
        LeftUpperLeg: [-0.68, 0, 0.04],
        LeftLowerLeg: [1.12, 0, 0],
        LeftFoot: [-0.55, 0, 0],
        RightUpperLeg: [0.5, 0, -0.04],
        RightLowerLeg: [0.58, 0, 0],
        RightFoot: [-1.23, 0, 0],
        LeftUpperArm: [0.72, 0, 0.28],
        LeftForeArm: [-0.45, 0, 0],
        RightUpperArm: [0.72, 0, -0.28],
        RightForeArm: [-0.45, 0, 0],
      },
    },
    {
      time: 0.14,
      rotations: {
        Hips: [0.12, 0, 0],
        Chest: [0.4, 0, 0],
        Head: [-0.34, 0, 0],
        RightUpperLeg: [-0.65, 0, -0.04],
        RightLowerLeg: [1.1, 0, 0],
        RightFoot: [-0.45, 0, 0],
        LeftUpperLeg: [0.4, 0, 0.04],
        LeftLowerLeg: [0.65, 0, 0],
        LeftFoot: [-1.17, 0, 0],
        LeftUpperArm: [0.6, 0, 0.28],
        LeftForeArm: [-0.55, 0, 0],
        RightUpperArm: [0.6, 0, -0.28],
        RightForeArm: [-0.55, 0, 0],
      },
    },
    { time: 0.2, rotations: {} },
  ]);
  const feint = createAuthoredAthleteClip("feint", 0.18, [
    {
      time: 0,
      rotations: {
        Hips: [0.05, -0.15, 0.04],
        Chest: [-0.08, -0.45, 0.12],
        RightUpperArm: [-1.3, 0, -0.3],
        RightForeArm: [-1.15, 0, 0],
      },
    },
    {
      time: 0.065,
      rotations: {
        Hips: [0.1, 0.15, -0.08],
        Chest: [0.2, 0.4, -0.16],
        Head: [-0.1, -0.2, 0],
        RightUpperArm: [-0.6, 0, 0.12],
        RightForeArm: [-1.7, 0, 0],
        LeftUpperArm: [-0.4, 0, 0.5],
        LeftForeArm: [-1.2, 0, 0],
        LeftUpperLeg: [-0.3, 0, 0.08],
        LeftLowerLeg: [0.65, 0, 0],
        RightUpperLeg: [-0.15, 0, -0.06],
        RightLowerLeg: [0.4, 0, 0],
      },
    },
    { time: 0.18, rotations: {} },
  ]);
  const land = createAuthoredAthleteClip("land", 0.2, [
    {
      time: 0,
      rotations: {
        Hips: [0.12, 0, 0],
        Chest: [0.12, 0, 0],
        LeftUpperLeg: [-0.6, 0, 0.07],
        LeftLowerLeg: [1.2, 0, 0],
        LeftFoot: [-0.6, 0, 0],
        RightUpperLeg: [-0.6, 0, -0.07],
        RightLowerLeg: [1.2, 0, 0],
        RightFoot: [-0.6, 0, 0],
        LeftUpperArm: [-0.45, 0, 0.4],
        RightUpperArm: [-0.45, 0, -0.4],
      },
    },
    {
      time: 0.065,
      rotations: {
        Hips: [0.08, 0, 0],
        Chest: [0.08, 0, 0],
        LeftUpperLeg: [-0.7, 0, 0.07],
        LeftLowerLeg: [1.4, 0, 0],
        LeftFoot: [-0.7, 0, 0],
        RightUpperLeg: [-0.7, 0, -0.07],
        RightLowerLeg: [1.4, 0, 0],
        RightFoot: [-0.7, 0, 0],
        LeftUpperArm: [0.1, 0, 0.4],
        RightUpperArm: [0.1, 0, -0.4],
      },
    },
    { time: 0.2, rotations: {} },
  ]);
  const hit = createAuthoredAthleteClip("hit", 0.36, [
    { time: 0, rotations: {} },
    {
      time: 0.07,
      rotations: {
        Hips: [-0.1, 0, 0.08],
        Spine: [-0.22, 0, 0],
        Chest: [-0.27, -0.12, 0.1],
        Head: [-0.2, 0, 0.1],
        LeftUpperArm: [-0.1, 0, 0.85],
        LeftForeArm: [-1.1, 0, 0],
        RightUpperArm: [0.15, 0, -0.75],
        RightForeArm: [-0.8, 0, 0],
        RightUpperLeg: [-0.3, 0, -0.04],
        RightLowerLeg: [0.65, 0, 0],
      },
    },
    {
      time: 0.19,
      rotations: {
        Chest: [0.14, 0.08, -0.06],
        Head: [0.16, 0, 0],
        LeftUpperArm: [-0.1, 0, 0.35],
        RightUpperArm: [-0.2, 0, -0.35],
        LeftUpperLeg: [-0.25, 0, 0.04],
        LeftLowerLeg: [0.5, 0, 0],
        RightUpperLeg: [-0.25, 0, -0.04],
        RightLowerLeg: [0.5, 0, 0],
      },
    },
    { time: 0.36, rotations: {} },
  ]);
  const victory = createAuthoredAthleteClip("victory", 1.4, [
    { time: 0, rotations: {} },
    {
      time: 0.26,
      rotations: {
        Chest: [-0.15, 0, 0],
        Head: [-0.18, 0, 0],
        LeftUpperArm: [-2.65, 0, 0.42],
        LeftForeArm: [-0.6, 0, 0],
        RightUpperArm: [-2.65, 0, -0.42],
        RightForeArm: [-0.6, 0, 0],
      },
    },
    {
      time: 0.55,
      rotations: {
        Chest: [-0.12, 0.1, 0],
        Head: [-0.15, 0, 0],
        LeftUpperArm: [-2.15, 0, 0.55],
        LeftForeArm: [-1.1, 0, 0],
        RightUpperArm: [-2.75, 0, -0.38],
        RightForeArm: [-0.4, 0, 0],
      },
    },
    {
      time: 0.85,
      rotations: {
        Chest: [-0.12, -0.1, 0],
        Head: [-0.15, 0, 0],
        RightUpperArm: [-2.15, 0, -0.55],
        RightForeArm: [-1.1, 0, 0],
        LeftUpperArm: [-2.75, 0, 0.38],
        LeftForeArm: [-0.4, 0, 0],
      },
    },
    {
      time: 1.4,
      rotations: {
        Chest: [-0.1, 0, 0],
        Head: [-0.12, 0, 0],
        LeftUpperArm: [-2.6, 0, 0.4],
        LeftForeArm: [-0.7, 0, 0],
        RightUpperArm: [-2.6, 0, -0.4],
        RightForeArm: [-0.7, 0, 0],
      },
    },
  ]);
  const defeat = createAuthoredAthleteClip("defeat", 1.1, [
    { time: 0, rotations: {} },
    {
      time: 0.35,
      rotations: {
        Spine: [0.14, 0, 0],
        Chest: [0.16, 0, 0],
        Head: [0.2, 0, 0],
        LeftUpperLeg: [-0.55, 0, 0.05],
        LeftLowerLeg: [1.1, 0, 0],
        LeftFoot: [-0.55, 0, 0],
        RightUpperLeg: [-0.55, 0, -0.05],
        RightLowerLeg: [1.1, 0, 0],
        RightFoot: [-0.55, 0, 0],
        LeftUpperArm: [-0.65, 0, 0.05],
        LeftForeArm: [-0.7, 0, 0],
        RightUpperArm: [-0.65, 0, -0.05],
        RightForeArm: [-0.7, 0, 0],
      },
    },
    {
      time: 0.8,
      rotations: {
        Hips: [0.08, 0, 0],
        Spine: [0.25, 0, 0],
        Chest: [0.22, 0, 0],
        Head: [0.35, 0, 0],
        LeftUpperLeg: [-1.25, 0, 0.1],
        LeftLowerLeg: [2.2, 0, 0],
        LeftFoot: [-0.95, 0, 0],
        RightUpperLeg: [-1.25, 0, -0.1],
        RightLowerLeg: [2.2, 0, 0],
        RightFoot: [-0.95, 0, 0],
        LeftUpperArm: [-0.85, 0, 0.1],
        LeftForeArm: [-0.75, 0, 0],
        RightUpperArm: [-0.85, 0, -0.1],
        RightForeArm: [-0.75, 0, 0],
      },
    },
    {
      time: 1.1,
      rotations: {
        Hips: [0.08, 0, 0],
        Spine: [0.25, 0, 0],
        Chest: [0.25, 0, 0],
        Head: [0.42, 0, 0],
        LeftUpperLeg: [-1.25, 0, 0.1],
        LeftLowerLeg: [2.2, 0, 0],
        LeftFoot: [-0.95, 0, 0],
        RightUpperLeg: [-1.25, 0, -0.1],
        RightLowerLeg: [2.2, 0, 0],
        RightFoot: [-0.95, 0, 0],
        LeftUpperArm: [-0.85, 0, 0.1],
        LeftForeArm: [-0.75, 0, 0],
        RightUpperArm: [-0.85, 0, -0.1],
        RightForeArm: [-0.75, 0, 0],
      },
    },
  ]);

  return { idle, run, charge, quickStrike, powerStrike, jump, dash, feint, land, hit, victory, defeat };
}
