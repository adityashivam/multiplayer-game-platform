import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  createSkyDashRunnerPose,
  getSkyDashCameraTargets,
  interpolateSkyDashAngle,
  resolveSkyDashQuality,
  sampleSkyDashRunnerPose,
  shouldFadeSkyDashGate,
  writeSkyDashPlatformTransform,
  writeSkyDashSegmentTransform,
} from "../public/games/sky-dash/rendering/presentation.js";
import { createSkyDashResources, createSkyDashStaticBuilder } from "../public/games/sky-dash/rendering/resources.js";
import { createSkyDashCircularGate } from "../public/games/sky-dash/rendering/course.js";

const runner = Object.freeze({ action: "run", grounded: true, vx: 0, vy: 0, vz: -8.6 });
const clocks = Object.freeze({ timeSec: 0.4, gaitPhase: 1.1, actionElapsedSec: 0.2, seed: 0, reducedMotion: false });

test("Sky Dash seesaw geometry preserves projected support corners, pivot and vertical thickness", () => {
  const platform = { x: 2, topY: 1.2, z: -9, slopeX: 0.25, slopeZ: -0.125 };
  const elements = new Array(16);
  const returnedElements = writeSkyDashPlatformTransform(platform, elements);
  const matrix = new THREE.Matrix4().fromArray(elements);
  const topCorner = new THREE.Vector3(3, 0, 2).applyMatrix4(matrix);
  const oppositeCorner = new THREE.Vector3(-3, 0, -2).applyMatrix4(matrix);
  const bottomCorner = new THREE.Vector3(3, -1.25, 2).applyMatrix4(matrix);
  const pivot = new THREE.Vector3().applyMatrix4(matrix);

  assert.equal(returnedElements, elements, "The caller retains a reusable matrix buffer");
  assert.deepEqual(topCorner.toArray(), [5, 1.7, -7]);
  assert.deepEqual(oppositeCorner.toArray(), [-1, 0.7, -11]);
  assert.ok(Math.abs(bottomCorner.y - 0.45) < 1e-12);
  assert.deepEqual(pivot.toArray(), [2, 1.2, -9]);
  assert.equal(topCorner.x, bottomCorner.x);
  assert.equal(topCorner.z, bottomCorner.z);
});

test("Sky Dash flat platform presentation keeps its existing world bounds", () => {
  const matrix = new THREE.Matrix4().fromArray(writeSkyDashPlatformTransform({ x: -2, topY: 0.3, z: -29 }, new Array(16)));
  assert.deepEqual(new THREE.Vector3(-8, 0, -11).applyMatrix4(matrix).toArray(), [-10, 0.3, -40]);
  assert.deepEqual(new THREE.Vector3(8, -1.5, 11).applyMatrix4(matrix).toArray(), [6, -1.2, -18]);
});

test("Sky Dash capsule bars match canonical endpoints in horizontal, vertical and diagonal planes", () => {
  const segments = [
    { ax: -6.4, ay: 0.72, az: -8, bx: 6.4, by: 0.72, bz: -8, radius: 0.25 },
    { ax: 0, ay: 4.95, az: -84, bx: 0, by: 8.1, bz: -84, radius: 0.23 },
    { ax: 0, ay: 4.95, az: -84, bx: -1.89, by: 7.47, bz: -84, radius: 0.23 },
    { ax: 1, ay: 1, az: -20, bx: 1, by: 1, bz: -30, radius: 0.32 },
  ];
  for (const segment of segments) {
    const matrix = new THREE.Matrix4().fromArray(writeSkyDashSegmentTransform(segment, new Array(16)));
    const start = new THREE.Vector3(0, -0.5, 0).applyMatrix4(matrix);
    const end = new THREE.Vector3(0, 0.5, 0).applyMatrix4(matrix);
    const center = new THREE.Vector3().applyMatrix4(matrix);
    const radiusPoint = new THREE.Vector3(1, 0, 0).applyMatrix4(matrix);

    assert.ok(start.distanceTo(new THREE.Vector3(segment.ax, segment.ay, segment.az)) < 1e-10);
    assert.ok(end.distanceTo(new THREE.Vector3(segment.bx, segment.by, segment.bz)) < 1e-10);
    assert.ok(Math.abs(center.distanceTo(radiusPoint) - segment.radius) < 1e-10);
  }
});

test("Sky Dash gate panel has a real circular passage and visible solid wings at canonical bounds", () => {
  const resources = createSkyDashResources();
  const gate = { x: 0, y: 4.95, z: -84, openingRadius: 3.45, radius: 0.24, frameWidth: 16, frameBottomY: 1.2, frameTopY: 9.1, depth: 0.48 };
  try {
    const panel = createSkyDashCircularGate(resources, gate).root;
    panel.updateMatrixWorld();
    const raycaster = new THREE.Raycaster();
    const crossesSolidPanel = (x, y) => {
      raycaster.set(new THREE.Vector3(x, y, -80), new THREE.Vector3(0, 0, -1));
      return raycaster.intersectObject(panel).length > 0;
    };
    assert.equal(crossesSolidPanel(0, 4.95), false, "The center is an actual hole, not a painted circle");
    assert.equal(crossesSolidPanel(0, 1.7), false, "The low part of the opening remains clear for jumps");
    assert.equal(crossesSolidPanel(7, 4.95), true, "The side wings visibly match the physical wall");
    assert.equal(crossesSolidPanel(0, 1.3), true, "The lower rim requires the modeled jump clearance");
    assert.equal(crossesSolidPanel(0, 8.8), true);
    assert.equal(crossesSolidPanel(0, 9.2), false);
    raycaster.set(new THREE.Vector3(7, 4.95, -80), new THREE.Vector3(0, 0, -1));
    assert.ok(Math.abs(raycaster.intersectObject(panel)[0].point.z + 83.76) < 1e-6, "The solid wing has the canonical slab depth");
    const bounds = new THREE.Box3().setFromObject(panel);
    assert.ok(Math.abs(bounds.min.z + 84.24) < 1e-6 && bounds.max.z >= -83.76 && bounds.max.z <= -83.735, "Rim stays inside the slab; thin face paint has a bounded offset");
    assert.ok(Math.abs(bounds.min.x + 8) < 1e-6 && Math.abs(bounds.max.x - 8) < 1e-6);
  } finally {
    resources.dispose();
  }
});

test("Sky Dash gate occlusion fades a wing only when it lies between the camera and local runner", () => {
  const gate = { x: 0, y: 4.95, z: -84, openingRadius: 3.45, frameWidth: 16, frameBottomY: 1.2, frameTopY: 9.1, depth: 0.48 };
  const runner = { x: 0, y: 1.8, z: -86 };
  assert.equal(shouldFadeSkyDashGate(gate, { x: 0, y: 8, z: -75 }, runner), false, "A clear sight line through the opening preserves the gate");
  assert.equal(shouldFadeSkyDashGate(gate, { x: 10, y: 8, z: -75 }, { ...runner, x: 2 }), true, "An angled camera can see through a blocking wing");
  assert.equal(shouldFadeSkyDashGate(gate, { x: 10, y: 8, z: -75 }, { ...runner, x: 2, z: -84.3 }), false, "The full collider must clear the slab before its wing can fade");
  assert.equal(shouldFadeSkyDashGate(gate, { x: 0, y: 8, z: -72 }, { ...runner, z: -78 }), false, "An upcoming challenge remains fully visible");
  assert.equal(shouldFadeSkyDashGate(gate, { x: 0, y: 8, z: -85 }, { ...runner, z: -90 }), false, "A gate behind the camera does not fade");
});

test("Sky Dash batches solid geometry and untextured course paint under a shared material", () => {
  const resources = createSkyDashResources();
  const builder = createSkyDashStaticBuilder(resources);
  const parent = new THREE.Group();
  const material = resources.material("#fff5df");
  const paint = resources.ownGeometry(new THREE.BufferGeometry());
  paint.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 1, 1, 0, 0], 3));
  paint.computeVertexNormals();
  builder.add(resources.roundedBox(3, 1, 4), material, [0, -0.5, 0]);
  builder.add(resources.box, material, [2, 0, 0], [1, 0.01, 1]);
  builder.add(paint, material, [-2, 0.01, 0]);

  try {
    assert.doesNotThrow(() => builder.finish(parent));
    assert.equal(parent.children.length, 1);
    const batchBounds = new THREE.Box3().setFromObject(parent);
    assert.ok(batchBounds.min.x <= -2 && batchBounds.max.x >= 2.5);
    assert.ok(batchBounds.min.z <= -2 && batchBounds.max.z >= 2);
  } finally {
    resources.dispose();
  }
});

test("Sky Dash action clips retain distinct silhouettes without changing the runner", () => {
  const originalRunner = { ...runner };
  const running = sampleSkyDashRunnerPose(runner, clocks, createSkyDashRunnerPose());
  const jumping = sampleSkyDashRunnerPose({ ...runner, action: "jump", grounded: false, vy: 5 }, clocks, createSkyDashRunnerPose());
  const diving = sampleSkyDashRunnerPose({ ...runner, action: "dive", grounded: false }, clocks, createSkyDashRunnerPose());
  const dashing = sampleSkyDashRunnerPose({ ...runner, action: "dash" }, clocks, createSkyDashRunnerPose());
  const tumbling = sampleSkyDashRunnerPose({ ...runner, action: "hit" }, clocks, createSkyDashRunnerPose());
  const cheering = sampleSkyDashRunnerPose({ ...runner, finished: true }, clocks, createSkyDashRunnerPose());

  assert.ok(Math.abs(diving.bodyX) > 1.2, "A dive makes the body visibly horizontal");
  assert.ok(Math.abs(diving.bodyX - dashing.bodyX) > 0.7, "A dive is not a retimed dash");
  assert.ok(jumping.leftKneeX > running.leftKneeX, "Air legs tuck instead of continuing the running cycle");
  assert.ok(tumbling.bodyX < diving.bodyX, "A hit rotates beyond the dive silhouette");
  assert.ok(cheering.leftArmZ > 2 && cheering.rightArmZ < -2, "Finish hands lift above the body");
  assert.deepEqual(runner, originalRunner);
});

test("Sky Dash render clocks continue a tumble between unchanged snapshots and soften it for reduced motion", () => {
  const hitRunner = { ...runner, action: "hit", grounded: false };
  const early = sampleSkyDashRunnerPose(hitRunner, { ...clocks, actionElapsedSec: 0.03 }, createSkyDashRunnerPose());
  const late = sampleSkyDashRunnerPose(hitRunner, { ...clocks, actionElapsedSec: 0.25 }, createSkyDashRunnerPose());
  const reduced = sampleSkyDashRunnerPose(hitRunner, { ...clocks, actionElapsedSec: 0.25, reducedMotion: true }, createSkyDashRunnerPose());

  assert.ok(Math.abs(late.bodyX - early.bodyX) > 2);
  assert.ok(Math.abs(reduced.bodyX) < 0.6);
});

test("Sky Dash headings take the short path through the wrap seam", () => {
  const heading = interpolateSkyDashAngle(Math.PI - 0.02, -Math.PI + 0.02, 0.5);
  assert.ok(Math.abs(heading - Math.PI) < 1e-10);
});

test("Sky Dash camera frames the local runner and course ahead in landscape and portrait", () => {
  for (const aspect of [16 / 9, 4 / 3, 9 / 16, 0.45]) {
    const localRunner = { x: 5, y: 1.2, z: -68 };
    const targets = getSkyDashCameraTargets(localRunner, { aspect, orbit: 0, groundY: 1.2 });
    const camera = new THREE.PerspectiveCamera(56, aspect, 0.1, 330);
    camera.position.set(targets.x, targets.y, targets.z);
    camera.lookAt(targets.targetX, targets.targetY, targets.targetZ);
    camera.updateMatrixWorld();
    const projectedRunner = new THREE.Vector3(localRunner.x, localRunner.y + 0.75, localRunner.z).project(camera);
    const projectedAhead = new THREE.Vector3(localRunner.x, localRunner.y, localRunner.z - 15).project(camera);

    assert.ok(Math.abs(projectedRunner.x) < 0.8 && Math.abs(projectedRunner.y) < 0.8, `Local runner stays visible at aspect ${aspect}`);
    assert.ok(Math.abs(projectedAhead.y) < 0.95, `The next course section remains visible at aspect ${aspect}`);
    assert.ok(targets.z > localRunner.z + 10);
  }
});

test("Sky Dash camera stays above the course when a runner falls and bounds orbit", () => {
  const standing = getSkyDashCameraTargets({ x: 0, y: 1.2, z: -80 }, { aspect: 16 / 9, orbit: 0, groundY: 1.2 });
  const falling = getSkyDashCameraTargets({ x: 0, y: -11, z: -80 }, { aspect: 16 / 9, orbit: 0, groundY: 1.2 });
  const boundedOrbit = getSkyDashCameraTargets({ x: 0, y: 1.2, z: -80 }, { aspect: 16 / 9, orbit: 1000, groundY: 1.2 });

  assert.ok(standing.y - falling.y < 0.4, "The camera does not dive down after a falling player");
  assert.ok(falling.y > 7);
  assert.ok(boundedOrbit.z > -80, "Orbit cannot move the follow camera in front of the runner");
});

test("Sky Dash quality keeps resolution, shadow and particle budgets explicit", () => {
  const high = resolveSkyDashQuality("high");
  const medium = resolveSkyDashQuality({ targetFps: 30, resolutionScale: 0.8 });
  const low = resolveSkyDashQuality({ autoLowEndActive: true, resolutionScale: 0.4 });

  assert.equal(high.particleLimit, 96);
  assert.equal(medium.quality, "medium");
  assert.equal(medium.resolutionScale, 0.8);
  assert.equal(low.quality, "low");
  assert.equal(low.resolutionScale, 0.6);
  assert.equal(low.shadows, false);
  assert.ok(low.particleLimit < medium.particleLimit && medium.particleLimit < high.particleLimit);
});
