import test from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import {
  createRiftballCameraController,
  createRiftballTrailHistory,
  getRiftballCourtBoundaries,
  resolveRiftballQuality,
} from "../public/games/riftball/rendering/presentation.js";

function createCameraFrame(overrides = {}) {
  return {
    dtSec: 1 / 60,
    timeSec: 0,
    roundId: 1,
    playerId: "p1",
    players: {
      p1: { id: "p1", index: 0, x: 0, y: 0, z: 7.5, vx: 0, vy: 0, vz: 0 },
      p2: { id: "p2", index: 1, x: 0, y: 0, z: -7.5, vx: 0, vy: 0, vz: 0 },
    },
    ball: { x: 0, y: 0.4, z: 0, serveId: 1 },
    cameraOrbit: { yaw: 0, pitch: 0 },
    ...overrides,
  };
}

test("Riftball camera follows each seat toward the opposing goal", () => {
  const camera = createRiftballCameraController();
  const firstSeatView = camera.update(createCameraFrame(), 16 / 9);
  assert.ok(firstSeatView.z > 7.5);
  assert.ok(firstSeatView.targetZ < 7.5);
  assert.ok(Math.cos(firstSeatView.heading) < -0.95);

  const secondSeatView = camera.update(createCameraFrame({ playerId: "p2" }), 16 / 9);
  assert.ok(secondSeatView.z < -7.5);
  assert.ok(secondSeatView.targetZ > -7.5);
  assert.ok(Math.cos(secondSeatView.heading) > 0.95);
});

test("Riftball normal follow gives the local athlete an immersive screen presence", () => {
  const view = createRiftballCameraController().update(createCameraFrame(), 16 / 9);
  const camera = new THREE.PerspectiveCamera(view.fov, 16 / 9, 0.12, 105);
  camera.position.set(view.x, view.y, view.z);
  camera.lookAt(view.targetX, view.targetY, view.targetZ);
  camera.updateMatrixWorld();
  const feet = new THREE.Vector3(0, 0, 7.5).project(camera);
  const head = new THREE.Vector3(0, 1.8, 7.5).project(camera);

  assert.ok(head.y - feet.y > 0.4);
  assert.ok(feet.y > -0.95);
});

test("Riftball camera keeps its side when a ball passes behind the athlete", () => {
  const camera = createRiftballCameraController();
  camera.update(createCameraFrame(), 16 / 9);
  const behindFrame = createCameraFrame({ ball: { x: 3, y: 1, z: 16, serveId: 1 } });

  for (let frameIndex = 0; frameIndex < 90; frameIndex += 1) {
    const view = camera.update(behindFrame, 16 / 9);
    assert.ok(view.z > 7.5);
    assert.ok(Math.cos(view.heading) < -0.8);
    assert.ok(Number.isFinite(view.y));
  }
});

test("Riftball camera frames a ball behind the athlete in landscape and portrait", () => {
  for (const [aspect, ball] of [
    [16 / 9, { x: 3, y: 1, z: 16, serveId: 1 }],
    [0.6, { x: 9, y: 4, z: 16, serveId: 1 }],
  ]) {
    const view = createRiftballCameraController().update(createCameraFrame({ ball }), aspect);
    const camera = new THREE.PerspectiveCamera(view.fov, aspect, 0.12, 105);
    camera.position.set(view.x, view.y, view.z);
    camera.lookAt(view.targetX, view.targetY, view.targetZ);
    camera.updateMatrixWorld();
    const ballProjection = new THREE.Vector3(ball.x, ball.y, ball.z).project(camera);
    const athleteProjection = new THREE.Vector3(0, 0.9, 7.5).project(camera);

    assert.ok(Math.abs(ballProjection.x) < 0.95, `ball horizontal projection ${ballProjection.x}`);
    assert.ok(Math.abs(ballProjection.y) < 0.95, `ball vertical projection ${ballProjection.y}`);
    assert.ok(Math.abs(athleteProjection.x) < 0.95, `athlete horizontal projection ${athleteProjection.x}`);
    assert.ok(Math.abs(athleteProjection.y) < 0.95, `athlete vertical projection ${athleteProjection.y}`);
  }
});

test("Riftball camera keeps a long backcourt return visible without turning around", () => {
  const frame = createCameraFrame({
    players: {
      p1: { id: "p1", index: 0, x: -8, y: 0, z: -15 },
      p2: { id: "p2", index: 1, x: 4, y: 0, z: 12 },
    },
    ball: { x: -9, y: 0.4, z: 16, serveId: 1 },
  });
  const view = createRiftballCameraController().update(frame, 16 / 9);
  const camera = new THREE.PerspectiveCamera(view.fov, 16 / 9, 0.12, 105);
  camera.position.set(view.x, view.y, view.z);
  camera.lookAt(view.targetX, view.targetY, view.targetZ);
  camera.updateMatrixWorld();
  const ballProjection = new THREE.Vector3(-9, 0.4, 16).project(camera);
  assert.ok(Math.abs(ballProjection.y) < 0.95);
  assert.ok(Math.cos(view.heading) < -0.8);
});

test("Riftball camera stays inside the physical court at the wall", () => {
  const camera = createRiftballCameraController();
  const frame = createCameraFrame({
    players: {
      p1: { id: "p1", index: 0, x: 9.5, y: 1.2, z: 16.5, vx: 0, vy: 2, vz: 0 },
      p2: { id: "p2", index: 1, x: -9.5, y: 0, z: -16.5 },
    },
    cameraOrbit: { yaw: -0.8, pitch: 0.3 },
  });
  const view = camera.update(frame, 0.6);
  assert.ok(view.x <= 9.4 && view.x >= -9.4);
  assert.ok(view.z <= 16.4 && view.z >= -16.4);
  assert.ok(view.y > 5);
  assert.ok(view.fov >= 60);
});

test("Riftball camera resets on a new round rather than sweeping across spawn", () => {
  const camera = createRiftballCameraController();
  const originalFrame = createCameraFrame();
  const initialView = { ...camera.update(originalFrame, 16 / 9) };
  const displacedPlayers = {
    p1: { ...originalFrame.players.p1, x: -6, z: -10 },
    p2: originalFrame.players.p2,
  };
  for (let frameIndex = 0; frameIndex < 60; frameIndex += 1) {
    camera.update(createCameraFrame({ players: displacedPlayers }), 16 / 9);
  }

  const resetView = camera.update(createCameraFrame({ roundId: 2 }), 16 / 9);
  assert.ok(Math.abs(resetView.x - initialView.x) < 1e-9);
  assert.ok(Math.abs(resetView.z - initialView.z) < 1e-9);
  assert.ok(Math.abs(resetView.targetZ - initialView.targetZ) < 1e-9);
});

test("Riftball court walls leave the authoritative goal mouth open", () => {
  const boundaries = getRiftballCourtBoundaries();
  const northGoal = boundaries.filter((boundary) => boundary.id.startsWith("goal-north"));
  const southGoal = boundaries.filter((boundary) => boundary.id.startsWith("goal-south"));

  assert.equal(northGoal.length, 4);
  assert.equal(southGoal.length, 4);
  for (const endName of ["north", "south"]) {
    const goalLintel = boundaries.find((boundary) => boundary.id === `end-${endName}-lintel`);
    const goalBack = boundaries.find((boundary) => boundary.id === `goal-${endName}-back`);
    assert.ok(Math.abs(goalLintel.position[1] - goalLintel.size[1] / 2 - 3.2) < 1e-9);
    assert.equal(Math.abs(goalBack.position[2]) - goalBack.size[2] / 2, 20);
    assert.equal(goalBack.size[0], 6.4);
  }
  assert.equal(boundaries.find((boundary) => boundary.id === "wall-east").position[0], 10.15);
});

test("Riftball safety net aligns with the physical five-metre ceiling", () => {
  const ceiling = getRiftballCourtBoundaries().find((boundary) => boundary.id === "court-ceiling");
  assert.ok(ceiling);
  assert.equal(ceiling.position[1] - ceiling.size[1] / 2, 5);
  assert.equal(ceiling.size[0], 20);
  assert.equal(ceiling.size[2], 40);
});

test("Riftball quality bounds hostile profiles and preserves reduced effects", () => {
  const quality = resolveRiftballQuality({
    resolutionScale: Infinity,
    targetFps: 10,
    reducedEffects: true,
  });
  assert.equal(quality.resolutionScale, 1);
  assert.equal(quality.targetFps, 30);
  assert.equal(quality.reducedEffects, true);
  assert.ok(quality.particleLimit <= 24);
});

test("Riftball ball trails stay bounded and clear across serve identities", () => {
  const trail = createRiftballTrailHistory();
  const ball = { x: 0, y: 1, z: 0, vx: 16, vy: 0, vz: 0, serveId: 1 };
  for (let frameIndex = 0; frameIndex < 120; frameIndex += 1) {
    ball.x += 0.1;
    trail.update(ball, 1 / 120, { roundId: 1 });
  }
  assert.ok(trail.getCount() > 1);
  assert.ok(trail.getCount() <= 24);
  ball.serveId = 2;
  ball.x = -4;
  trail.update(ball, 1 / 60, { roundId: 1 });
  assert.equal(trail.getCount(), 0);
  trail.update({ ...ball, x: -3.5 }, 1 / 60, { roundId: 1 });
  assert.equal(trail.getCount(), 1);
  assert.equal(trail.getSample(0).x, -3.5);
});

test("Riftball reduced motion removes trails immediately", () => {
  const trail = createRiftballTrailHistory();
  const ball = { x: 0, y: 1, z: 0, vx: 10, vy: 0, vz: 0, serveId: 1 };
  trail.update(ball, 1 / 60, { roundId: 1 });
  trail.update({ ...ball, x: 0.3 }, 1 / 60, { roundId: 1 });
  assert.equal(trail.getCount(), 1);
  trail.update({ ...ball, x: 0.6 }, 1 / 60, { roundId: 1, reducedMotion: true });
  assert.equal(trail.getCount(), 0);
});

test("Riftball fast ball trails remain visible at high render refresh rates", () => {
  const trail = createRiftballTrailHistory();
  const ball = { x: 0, y: 1, z: 0, vx: 12, vy: 0, vz: 0, serveId: 1 };
  for (let frameIndex = 0; frameIndex < 120; frameIndex += 1) {
    ball.x += 0.05;
    trail.update(ball, 1 / 240, { roundId: 1 });
  }
  assert.ok(trail.getCount() > 1);
  assert.ok(trail.getCount() <= 24);
});
