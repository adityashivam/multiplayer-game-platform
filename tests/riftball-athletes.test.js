import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";

const athleteModuleUrl = new URL("../public/games/riftball/rendering/athletes.js", import.meta.url);

function createAthletePlayer(overrides = {}) {
  return {
    id: "p1", index: 0, name: "Athlete", connected: true,
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, facing: 0,
    grounded: true, action: "idle", actionId: 0, actionTimeSec: 0,
    chargeSec: 0, strikePower: 0, stamina: 100, score: 0, seriesWins: 0,
    ...overrides,
  };
}

function createAthleteFrame(overrides = {}) {
  return {
    dtSec: 0, timeSec: 0, gameTimeSec: 0, roundId: 1, playerId: "p1",
    ball: { x: 0, y: 1, z: 4 }, phase: "playing", goalSerial: 0,
    lastScorer: null, reducedMotion: false, cameraOrbit: 0, replay: false,
    ...overrides,
  };
}

function getAthleteSkin(scene, playerId = "p1") {
  let athleteSkin;
  scene.getObjectByName(`riftball-athlete-${playerId}`).traverse((node) => {
    if (node.isSkinnedMesh) athleteSkin = node;
  });
  return athleteSkin;
}

function getBonePosition(athleteSkin, name) {
  athleteSkin.updateMatrixWorld(true);
  return athleteSkin.skeleton.getBoneByName(name).getWorldPosition(new THREE.Vector3());
}

test("Riftball athletes have weighted anatomical joints and a grounded full-height silhouette", async () => {
  const { createRiftballAthletes } = await import(athleteModuleUrl);
  const scene = new THREE.Scene();
  const athletes = createRiftballAthletes(scene);
  athletes.update([createAthletePlayer()], createAthleteFrame());

  try {
    const athleteSkin = getAthleteSkin(scene);
    const skinIndices = athleteSkin.geometry.getAttribute("skinIndex");
    const skinWeights = athleteSkin.geometry.getAttribute("skinWeight");
    const influencedBones = new Set();
    let blendedVertices = 0;
    for (let vertexIndex = 0; vertexIndex < skinWeights.count; vertexIndex += 1) {
      const weights = [skinWeights.getX(vertexIndex), skinWeights.getY(vertexIndex), skinWeights.getZ(vertexIndex), skinWeights.getW(vertexIndex)];
      assert.ok(Math.abs(weights.reduce((sum, weight) => sum + weight, 0) - 1) < 1e-5);
      if (weights.filter((weight) => weight > 0.01).length > 1) blendedVertices += 1;
      for (let componentIndex = 0; componentIndex < 4; componentIndex += 1) {
        if (weights[componentIndex] > 0.01) influencedBones.add(skinIndices.getComponent(vertexIndex, componentIndex));
      }
    }

    assert.ok(influencedBones.size >= 16, "The surface actually follows the limb joints, including hands and feet");
    assert.ok(blendedVertices > 120, "Shoulders, elbows, torso and knees blend between joint influences");
    athleteSkin.computeBoundingBox();
    assert.ok(athleteSkin.boundingBox.min.y >= -0.012, "Shoes rest above the court");
    assert.ok(athleteSkin.boundingBox.min.y <= 0.035, "Feet do not hover above the court");
    assert.ok(athleteSkin.boundingBox.max.y >= 1.65 && athleteSkin.boundingBox.max.y < 1.95);

    const forearmBone = athleteSkin.skeleton.getBoneByName("RightForeArm");
    const vertexBefore = new THREE.Vector3();
    const vertexAfter = new THREE.Vector3();
    let largestDeformation = 0;
    const beforePositions = [];
    for (let vertexIndex = 0; vertexIndex < skinWeights.count; vertexIndex += 1) {
      beforePositions.push(athleteSkin.getVertexPosition(vertexIndex, vertexBefore).clone());
    }
    forearmBone.rotation.x -= 0.8;
    athleteSkin.updateMatrixWorld(true);
    for (let vertexIndex = 0; vertexIndex < skinWeights.count; vertexIndex += 1) {
      athleteSkin.getVertexPosition(vertexIndex, vertexAfter);
      largestDeformation = Math.max(largestDeformation, vertexAfter.distanceTo(beforePositions[vertexIndex]));
    }
    assert.ok(largestDeformation > 0.1, "Rotating the rig deforms the actual glove/arm surface");
  } finally {
    athletes.dispose();
  }
});

test("Riftball authored quick and power strikes produce different hand paths and torso windups", async () => {
  const { createRiftballAthletes } = await import(athleteModuleUrl);
  const scene = new THREE.Scene();
  const athletes = createRiftballAthletes(scene);
  const quickPlayer = createAthletePlayer({ action: "strike", actionId: 1, strikePower: 0.05 });
  const heavyPlayer = createAthletePlayer({ id: "p2", index: 1, action: "strike", actionId: 1, strikePower: 1 });
  athletes.update([quickPlayer, heavyPlayer], createAthleteFrame());

  try {
    for (let frameIndex = 1; frameIndex <= 8; frameIndex += 1) {
      athletes.update([quickPlayer, heavyPlayer], createAthleteFrame({ dtSec: 1 / 60, timeSec: frameIndex / 60 }));
    }
    const quickSkin = getAthleteSkin(scene);
    const heavySkin = getAthleteSkin(scene, "p2");
    const quickHand = getBonePosition(quickSkin, "RightHand");
    const heavyHand = getBonePosition(heavySkin, "RightHand");
    assert.ok(quickHand.distanceTo(heavyHand) > 0.13, "The heavy strike is a distinct authored arc");
    const quickChest = quickSkin.skeleton.getBoneByName("Chest").quaternion;
    const heavyChest = heavySkin.skeleton.getBoneByName("Chest").quaternion;
    assert.ok(quickChest.angleTo(heavyChest) > 0.15, "Power uses a wider whole-body rotation");
    assert.ok(quickSkin.animations.every((clip) => clip instanceof THREE.AnimationClip));
    assert.ok(quickSkin.animations.length >= 11, "Actions use authored keyed clips");
  } finally {
    athletes.dispose();
  }
});

test("Riftball action animation advances between unchanged snapshots and resets for a new action identity", async () => {
  const { createRiftballAthletes } = await import(athleteModuleUrl);
  const scene = new THREE.Scene();
  const athletes = createRiftballAthletes(scene);
  const playerState = Object.freeze(createAthletePlayer({ action: "strike", actionId: 4, strikePower: 0.1 }));
  athletes.update([playerState], createAthleteFrame());

  try {
    const athleteSkin = getAthleteSkin(scene);
    const initialHand = getBonePosition(athleteSkin, "RightHand");
    for (let frameIndex = 1; frameIndex <= 7; frameIndex += 1) {
      athletes.update([playerState], createAthleteFrame({ dtSec: 1 / 60, timeSec: frameIndex / 60 }));
    }
    const contactHand = getBonePosition(athleteSkin, "RightHand");
    assert.ok(initialHand.distanceTo(contactHand) > 0.2, "A repeated packet must not restart the clip");
    athletes.update([{ ...playerState, actionId: 5 }], createAthleteFrame({ dtSec: 0, timeSec: 0.14 }));
    const newActionHand = getBonePosition(athleteSkin, "RightHand");
    assert.ok(newActionHand.distanceTo(initialHand) < 0.025, "A fresh action begins at its authored windup");
    assert.equal(playerState.actionId, 4, "Visual transforms never change authoritative state");
  } finally {
    athletes.dispose();
  }
});

test("Riftball jump tucks the knees while a dash stays low and a defeat drops the shoulders", async () => {
  const { createRiftballAthletes } = await import(athleteModuleUrl);
  const samplePose = (action, elapsedSec, grounded = true) => {
    const scene = new THREE.Scene();
    const athletes = createRiftballAthletes(scene);
    athletes.update([createAthletePlayer({ action, actionId: 1, actionTimeSec: elapsedSec, grounded })], createAthleteFrame());
    const athleteSkin = getAthleteSkin(scene);
    const sample = {
      knee: getBonePosition(athleteSkin, "LeftLowerLeg"),
      hand: getBonePosition(athleteSkin, "LeftHand"),
      chest: getBonePosition(athleteSkin, "Chest"),
      kneeAngle: athleteSkin.skeleton.getBoneByName("LeftLowerLeg").rotation.x,
    };
    athletes.dispose();
    return sample;
  };
  const idle = samplePose("idle", 0);
  const jump = samplePose("jump", 0.16, false);
  const dash = samplePose("dash", 0.11);
  const defeat = samplePose("defeat", 0.8);

  assert.ok(jump.kneeAngle > idle.kneeAngle + 0.5, "Airborne legs tuck with a dedicated jump clip");
  assert.ok(dash.chest.y < idle.chest.y - 0.08, "A dash lowers the athletic stance");
  assert.ok(defeat.chest.y < idle.chest.y - 0.2, "Defeat has a clearly slumped silhouette");
  assert.ok(jump.hand.y > dash.hand.y + 0.15);
});

test("Riftball render-rate running keeps soles grounded through the gait and follows authoritative feet", async () => {
  const { createRiftballAthletes } = await import(athleteModuleUrl);
  const scene = new THREE.Scene();
  const athletes = createRiftballAthletes(scene);
  const playerState = createAthletePlayer({ action: "run", vx: 0, vz: 7.4, x: 2, z: -3, y: 0.5 });

  try {
    for (let frameIndex = 0; frameIndex < 32; frameIndex += 1) {
      athletes.update([playerState], createAthleteFrame({ dtSec: 1 / 60, timeSec: frameIndex / 60 }));
      const root = scene.getObjectByName("riftball-athlete-p1");
      assert.deepEqual(root.position.toArray(), [2, 0.5, -3]);
      const athleteSkin = getAthleteSkin(scene);
      athleteSkin.computeBoundingBox();
      assert.ok(athleteSkin.boundingBox.min.y > -0.015, "A moving shoe must not cut through the court");
      assert.ok(athleteSkin.boundingBox.min.y < 0.07, "At least one shoe remains in ground contact");
    }
  } finally {
    athletes.dispose();
  }
});

test("Riftball running faces travel direction while strike presentation returns to authoritative aim", async () => {
  const { createRiftballAthletes } = await import(athleteModuleUrl);
  const scene = new THREE.Scene();
  const athletes = createRiftballAthletes(scene);
  const runningPlayer = createAthletePlayer({ action: "run", vx: 7.4, vz: 0, facing: 0 });
  try {
    for (let frameIndex = 0; frameIndex < 32; frameIndex += 1) {
      athletes.update([runningPlayer], createAthleteFrame({ dtSec: 1 / 60, timeSec: frameIndex / 60 }));
    }
    const root = scene.getObjectByName("riftball-athlete-p1");
    assert.ok(Math.abs(root.rotation.y - Math.PI / 2) < 0.03, "The forward gait follows travel instead of moonwalking sideways");
    const strikingPlayer = { ...runningPlayer, action: "strike", actionId: 1, strikePower: 0.2 };
    athletes.update([strikingPlayer], createAthleteFrame({ dtSec: 1 / 60 }));
    assert.ok(Math.abs(root.rotation.y) < 0.03, "The authored contact path immediately faces the authoritative strike direction");
  } finally {
    athletes.dispose();
  }
});

test("Riftball goal identities drive short celebrations without changing player actions", async () => {
  const { createRiftballAthletes } = await import(athleteModuleUrl);
  const scene = new THREE.Scene();
  const athletes = createRiftballAthletes(scene);
  const playerState = Object.freeze(createAthletePlayer());
  try {
    athletes.update([playerState], createAthleteFrame({ phase: "goal", goalSerial: 1, lastScorer: "p1" }));
    const skin = getAthleteSkin(scene);
    const initialHand = getBonePosition(skin, "RightHand");
    for (let frameIndex = 1; frameIndex <= 24; frameIndex += 1) {
      athletes.update([playerState], createAthleteFrame({ phase: "goal", goalSerial: 1, lastScorer: "p1", dtSec: 1 / 60, timeSec: frameIndex / 60 }));
    }
    assert.ok(getBonePosition(skin, "RightHand").y > initialHand.y + 0.7, "A goal raises the scorer's fists even when authority keeps idle");
    assert.equal(playerState.action, "idle");
    athletes.update([playerState], createAthleteFrame({ phase: "goal", goalSerial: 2, lastScorer: "p1" }));
    assert.ok(getBonePosition(skin, "RightHand").distanceTo(initialHand) < 0.03, "A later goal gets a new celebration clock");
  } finally {
    athletes.dispose();
  }
});

test("Riftball head tracking stays stable across repeated frames at different render rates", async () => {
  const { createRiftballAthletes } = await import(athleteModuleUrl);
  for (const renderFps of [30, 60, 120]) {
    const scene = new THREE.Scene();
    const athletes = createRiftballAthletes(scene);
    const players = [
      Object.freeze(createAthletePlayer()),
      Object.freeze(createAthletePlayer({ id: "p2", index: 1, x: 2, facing: Math.PI })),
    ];
    const frame = createAthleteFrame({ ball: { x: 4, y: 1.6, z: 4 }, dtSec: 1 / renderFps });
    athletes.update(players, frame);
    const heads = players.map((player) => getAthleteSkin(scene, player.id).skeleton.getBoneByName("Head"));
    const initialRotations = heads.map((head) => head.quaternion.clone().normalize());

    try {
      for (let frameIndex = 1; frameIndex <= renderFps * 3; frameIndex += 1) {
        athletes.update(players, { ...frame, timeSec: frameIndex / renderFps });
        for (let playerIndex = 0; playerIndex < players.length; playerIndex += 1) {
          const headRotation = heads[playerIndex].quaternion.clone().normalize();
          assert.ok(headRotation.angleTo(initialRotations[playerIndex]) < 0.001, `${players[playerIndex].id} head must not accumulate gaze rotation at ${renderFps} FPS`);
        }
      }
    } finally {
      athletes.dispose();
    }
  }
});

test("Riftball head tracking preserves the authored pose when gaze, action or round changes", async () => {
  const { createRiftballAthletes } = await import(athleteModuleUrl);
  const trackingScene = new THREE.Scene();
  const authoredScene = new THREE.Scene();
  const trackingAthletes = createRiftballAthletes(trackingScene);
  const authoredAthletes = createRiftballAthletes(authoredScene);
  const actions = ["idle", "charge", "strike", "jump", "dash", "feint", "victory", "defeat"];
  let frameIndex = 0;

  try {
    for (const [actionId, action] of actions.entries()) {
      const player = Object.freeze(createAthletePlayer({ action, actionId, strikePower: 1, grounded: action !== "jump" }));
      for (let actionFrame = 0; actionFrame < 40; actionFrame += 1) {
        const ball = actionFrame < 20 ? { x: actionId % 2 ? -4 : 4, y: 2, z: 4 } : undefined;
        const frame = createAthleteFrame({ dtSec: 1 / 60, timeSec: frameIndex++ / 60, ball, roundId: actionId >= 4 ? 2 : 1, reducedMotion: actionId % 2 === 1, replay: action === "strike" });
        trackingAthletes.update([player], frame);
        authoredAthletes.update([player], { ...frame, ball: undefined });
        const trackedHead = getAthleteSkin(trackingScene).skeleton.getBoneByName("Head").quaternion.clone().normalize();
        const authoredHead = getAthleteSkin(authoredScene).skeleton.getBoneByName("Head").quaternion.clone().normalize();
        const gazeAngle = trackedHead.angleTo(authoredHead);
        assert.ok(gazeAngle < 0.35, `${action} gaze must remain a small offset from the authored pose`);
        if (!ball) assert.ok(gazeAngle < 0.001, `${action} restores the authored pose when no gaze target is supplied`);
      }
    }
  } finally {
    trackingAthletes.dispose();
    authoredAthletes.dispose();
  }
});

test("Riftball athlete removal and disposal release geometry, materials and skeleton resources once", async () => {
  const { createRiftballAthletes } = await import(athleteModuleUrl);
  const scene = new THREE.Scene();
  const athletes = createRiftballAthletes(scene);
  athletes.update([createAthletePlayer(), createAthletePlayer({ id: "p2", index: 1 })], createAthleteFrame());
  const disposalEvents = [];
  const geometrySet = new Set();
  const materialSet = new Set();
  const boneTextures = new Set();
  scene.traverse((node) => {
    if (node.geometry) geometrySet.add(node.geometry);
    for (const material of Array.isArray(node.material) ? node.material : node.material ? [node.material] : []) materialSet.add(material);
    if (node.isSkinnedMesh) {
      node.skeleton.computeBoneTexture();
      boneTextures.add(node.skeleton.boneTexture);
    }
  });
  for (const geometry of geometrySet) geometry.addEventListener("dispose", () => disposalEvents.push(geometry));
  for (const material of materialSet) material.addEventListener("dispose", () => disposalEvents.push(material));
  for (const boneTexture of boneTextures) boneTexture.addEventListener("dispose", () => disposalEvents.push(boneTexture));

  athletes.update([createAthletePlayer()], createAthleteFrame());
  assert.equal(athletes.getStats().athletes, 1);
  assert.equal(scene.getObjectByName("riftball-athlete-p2"), undefined);
  athletes.dispose();
  athletes.dispose();
  assert.equal(disposalEvents.length, geometrySet.size + materialSet.size + boneTextures.size);
  assert.equal(new Set(disposalEvents).size, disposalEvents.length);
  assert.equal(scene.getObjectByName("riftball-athletes"), undefined);
  assert.equal(athletes.getStats().athletes, 0);
  assert.equal(athletes.getStats().disposed, true);
});
