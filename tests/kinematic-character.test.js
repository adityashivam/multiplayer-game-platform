import test from "node:test";
import assert from "node:assert/strict";
import {
  createKinematicCharacterController as createController,
  getKinematicPlatformTopY,
  resolveKinematicCharacterSeparation as resolveSeparation,
} from "../public/platform/shared/kinematicCharacter.js";

const IDLE_INPUT = Object.freeze({ x: 0, z: 0, jump: false });

function createBody(overrides = {}) {
  return {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    grounded: false,
    supportId: 0,
    coyoteSec: 0,
    jumpBufferSec: 0,
    jumpHeld: false,
    ...overrides,
  };
}

function createPlatform(overrides = {}) {
  return {
    id: 1,
    x: 0,
    z: 0,
    width: 20,
    depth: 20,
    topY: 0,
    thickness: 1,
    vx: 0,
    vy: 0,
    vz: 0,
    ...overrides,
  };
}

function assertNear(actualValue, expectedValue, tolerance = 1e-7) {
  assert.ok(Math.abs(actualValue - expectedValue) <= tolerance,
    `expected ${actualValue} to be within ${tolerance} of ${expectedValue}`);
}

test("a falling character lands at bottom-of-collider Y and stays supported without jitter", () => {
  const controller = createController();
  const body = createBody({ y: 4, vy: -5 });
  const platform = Object.freeze(createPlatform());

  for (let tick = 0; tick < 180; tick += 1) {
    assert.equal(controller.step(body, IDLE_INPUT, 1 / 60, { platforms: [platform] }), undefined);
  }

  assertNear(body.y, 0);
  assert.equal(body.vy, 0);
  assert.equal(body.grounded, true);
  assert.equal(body.supportId, 1);
  assert.ok(body.coyoteSec > 0);
});

test("world-space analog intent keeps its magnitude and full diagonals normalize", () => {
  const controller = createController({ moveSpeed: 10, acceleration: 2000, airAcceleration: 2000, gravity: 0 });
  const analogBody = createBody();
  const diagonalBody = createBody();
  const analogInput = Object.freeze({ x: 0.3, z: -0.4, jump: false });

  controller.step(analogBody, analogInput, 0.05, { platforms: [] });
  controller.step(diagonalBody, { x: 1, z: -1, jump: false }, 0.05, { platforms: [] });

  assertNear(analogBody.vx, 3);
  assertNear(analogBody.vz, -4);
  assertNear(Math.hypot(diagonalBody.vx, diagonalBody.vz), 10);
  assertNear(diagonalBody.vx, -diagonalBody.vz);
  assert.deepEqual(analogInput, { x: 0.3, z: -0.4, jump: false });
});

test("ground and air acceleration differ and release applies bounded braking", () => {
  const controller = createController({ moveSpeed: 20, acceleration: 10, airAcceleration: 2, braking: 5, gravity: 0 });
  const groundedBody = createBody({ grounded: true, supportId: 1 });
  const airborneBody = createBody({ y: 3 });

  controller.step(groundedBody, { x: 1, z: 0, jump: false }, 0.1, { platforms: [createPlatform()] });
  controller.step(airborneBody, { x: 1, z: 0, jump: false }, 0.1, { platforms: [] });
  assertNear(groundedBody.vx, 1);
  assertNear(airborneBody.vx, 0.2);

  controller.step(groundedBody, IDLE_INPUT, 0.1, { platforms: [createPlatform()] });
  assertNear(groundedBody.vx, 0.5);
});

test("disabled control preserves external horizontal impulses and dash scale changes target speed", () => {
  const controller = createController({ moveSpeed: 8, acceleration: 1000, airAcceleration: 1000, braking: 1000, gravity: 0 });
  const impulseBody = createBody({ vx: 14, vz: -6 });
  const dashBody = createBody();

  controller.step(impulseBody, { x: -1, z: 1, jump: false }, 0.05, { platforms: [], controlScale: 0 });
  controller.step(dashBody, { x: 0, z: -1, jump: false }, 0.05, { platforms: [], speedScale: 2 });

  assertNear(impulseBody.vx, 14);
  assertNear(impulseBody.vz, -6);
  assertNear(impulseBody.x, 0.7);
  assertNear(impulseBody.z, -0.3);
  assertNear(dashBody.vz, -16);
});

test("a short jump press uses coyote time but an expired airborne press cannot jump", () => {
  const controller = createController({ coyoteSec: 0.1, jumpSpeed: 10 });
  const coyoteBody = createBody({ y: 2, coyoteSec: 0.08 });
  const expiredBody = createBody({ y: 2, coyoteSec: 0.03 });

  controller.step(coyoteBody, { x: 0, z: 0, jump: true }, 1 / 60, { platforms: [] });
  controller.step(expiredBody, IDLE_INPUT, 0.05, { platforms: [] });
  controller.step(expiredBody, { x: 0, z: 0, jump: true }, 1 / 60, { platforms: [] });

  assert.ok(coyoteBody.vy > 9);
  assert.equal(coyoteBody.coyoteSec, 0);
  assert.equal(coyoteBody.jumpBufferSec, 0);
  assert.ok(expiredBody.vy < 0);
});

test("a released buffered press jumps on landing without requiring a second press", () => {
  const controller = createController({ jumpBufferSec: 0.15, jumpSpeed: 9, gravity: 20 });
  const body = createBody({ y: 0.3, vy: -4 });
  const context = { platforms: [createPlatform()] };

  controller.step(body, { x: 0, z: 0, jump: true }, 0.025, context);
  assert.ok(body.vy < 0);
  controller.step(body, IDLE_INPUT, 0.05, context);

  assert.ok(body.vy > 8);
  assert.equal(body.grounded, false);
  assert.equal(body.supportId, 0);
  assert.equal(body.jumpBufferSec, 0);
});

test("holding jump through a landing does not retrigger or refill a consumed jump", () => {
  const controller = createController({ jumpSpeed: 8, gravity: 24 });
  const body = createBody({ grounded: true, supportId: 1 });
  const context = { platforms: [createPlatform()] };
  const jumpInput = { x: 0, z: 0, jump: true };

  for (let tick = 0; tick < 120; tick += 1) {
    controller.step(body, jumpInput, 1 / 60, context);
  }

  assert.equal(body.grounded, true);
  assertNear(body.y, 0);
  assert.equal(body.vy, 0);
  assert.equal(body.jumpHeld, true);
});

test("support movement carries each axis exactly once and keeps runner-relative velocity", () => {
  const controller = createController({ gravity: 20 });
  const body = createBody({ grounded: true, supportId: 7 });
  const platform = createPlatform({ id: 7, vx: 3, vy: 2, vz: -4 });
  const originalPlatform = { ...platform };

  controller.step(body, IDLE_INPUT, 0.1, { platforms: [platform] });

  assertNear(body.x, 0.3);
  assertNear(body.y, 0.2);
  assertNear(body.z, -0.4);
  assertNear(body.vx, 0);
  assertNear(body.vy, 0);
  assertNear(body.vz, 0);
  assert.equal(body.supportId, 7);
  assert.deepEqual(platform, originalPlatform);
});

test("landing on a rising platform becomes stable grounded support", () => {
  const controller = createController({ gravity: 20 });
  const body = createBody({ y: 0.2, vy: -2 });
  const platform = createPlatform({ vy: 2 });

  controller.step(body, IDLE_INPUT, 0.1, { platforms: [platform] });

  assertNear(body.y, 0.2);
  assert.equal(body.grounded, true);
  assert.equal(body.supportId, 1);
  assert.equal(body.vy, 0);

  controller.step(body, IDLE_INPUT, 0.1, { platforms: [{ ...platform, topY: 0.2 }] });
  assertNear(body.y, 0.4);
  assert.equal(body.grounded, true);
  assert.equal(body.vy, 0);
});

test("walking off a moving support and removing support both release grounding", () => {
  const controller = createController({ radius: 0.3, braking: 0, gravity: 20 });
  const edgeBody = createBody({ x: 0.6, vx: 8, grounded: true, supportId: 1 });
  const edgePlatform = createPlatform({ width: 1, vx: 1 });
  const removedBody = createBody({ grounded: true, supportId: 1 });

  controller.step(edgeBody, IDLE_INPUT, 0.1, { platforms: [edgePlatform] });
  controller.step(removedBody, IDLE_INPUT, 0.05, { platforms: [] });

  assert.equal(edgeBody.grounded, false);
  assert.equal(edgeBody.supportId, 0);
  assert.ok(edgeBody.y < 0);
  assert.ok(edgeBody.vy < 0);
  assert.equal(removedBody.grounded, false);
  assert.equal(removedBody.supportId, 0);
  assert.ok(removedBody.y < 0);
});

test("fast dashes cannot cross a thin wall even with one collision substep", () => {
  const controller = createController({ radius: 0.4, height: 1.5, gravity: 0, maxSubsteps: 1 });
  const body = createBody({ x: -3, y: 0, vx: 300 });
  const wall = createPlatform({ x: 0, width: 0.04, topY: 4, thickness: 5 });

  controller.step(body, IDLE_INPUT, 0.1, { platforms: [wall], controlScale: 0 });

  assertNear(body.x, -0.42);
  assert.equal(body.vx, 0);
  assert.equal(body.grounded, false);
});

test("fast upward motion hits the underside instead of tunneling through a thin ceiling", () => {
  const controller = createController({ height: 1.4, gravity: 0, maxSubsteps: 1 });
  const body = createBody({ y: -3, vy: 200 });
  const ceiling = createPlatform({ topY: 1, thickness: 0.05 });

  controller.step(body, IDLE_INPUT, 0.1, { platforms: [ceiling], controlScale: 0 });

  assertNear(body.y, -0.45);
  assert.equal(body.vy, 0);
  assert.equal(body.grounded, false);
});

test("diagonal wall contact slides along the free axis and rounded corners do not become square walls", () => {
  const controller = createController({ radius: 0.4, height: 1.4, gravity: 0, maxSubsteps: 1 });
  const slideBody = createBody({ x: -2, y: 0, z: -1, vx: 30, vz: 8 });
  const cornerBody = createBody({ x: -0.8, y: 0, z: -0.8, vx: 1, vz: 1 });
  const wall = createPlatform({ width: 1, depth: 20, topY: 3, thickness: 4 });
  const box = createPlatform({ width: 1, depth: 1, topY: 3, thickness: 4 });

  controller.step(slideBody, IDLE_INPUT, 0.1, { platforms: [wall], controlScale: 0 });
  controller.step(cornerBody, IDLE_INPUT, 0.01, { platforms: [box], controlScale: 0 });

  assertNear(slideBody.x, -0.9);
  assertNear(slideBody.z, -0.2);
  assertNear(slideBody.vx, 0);
  assertNear(slideBody.vz, 8);
  assertNear(cornerBody.x, -0.79);
  assertNear(cornerBody.z, -0.79);
});

test("a translating platform side pushes a stationary airborne character clear", () => {
  const controller = createController({ radius: 0.3, gravity: 0, maxSubsteps: 1 });
  const body = createBody({ x: 1.2, y: 1 });
  const platform = createPlatform({ width: 1, topY: 4, thickness: 5, vx: 10 });

  controller.step(body, IDLE_INPUT, 0.1, { platforms: [platform], controlScale: 0 });

  assertNear(body.x, 1.8);
  assertNear(body.vx, 10);
  assert.equal(body.grounded, false);
});

test("zero time resolves overlap and support without consuming jump state or timers", () => {
  const controller = createController({ radius: 0.4, height: 1.4 });
  const body = createBody({ y: -0.05, vy: -2, jumpHeld: true, jumpBufferSec: 0.08, coyoteSec: 0.04 });

  controller.step(body, IDLE_INPUT, 0, { platforms: [createPlatform()], controlScale: 0 });

  assertNear(body.y, 0);
  assert.equal(body.grounded, true);
  assert.equal(body.supportId, 1);
  assert.equal(body.jumpHeld, true);
  assert.equal(body.jumpBufferSec, 0.08);
  assert.equal(body.coyoteSec, 0.04);
});

test("different character dimensions change landing clearance and long steps stay clamped", () => {
  const controller = createController({ radius: 0.1, height: 0.5, gravity: 0, maxDtSec: 0.04, maxSubsteps: 2 });
  const body = createBody({ x: -2, vx: 50 });
  const wall = createPlatform({ width: 0.2, topY: 1, thickness: 2 });
  const freeBody = createBody({ vx: 5 });

  controller.step(body, IDLE_INPUT, 10, { platforms: [wall], controlScale: 0 });
  controller.step(freeBody, IDLE_INPUT, 10, { platforms: [], controlScale: 0 });

  assertNear(body.x, -0.2);
  assertNear(freeBody.x, 0.2);
});

test("coincident characters separate deterministically without creating velocity", () => {
  const bodies = [createBody(), createBody(), createBody()];
  const replayBodies = structuredClone(bodies);

  resolveSeparation(bodies, { radius: 0.4, height: 1.4, iterations: 12 });
  resolveSeparation(replayBodies, { radius: 0.4, height: 1.4, iterations: 12 });

  assert.deepEqual(bodies, replayBodies);
  for (let firstIndex = 0; firstIndex < bodies.length; firstIndex += 1) {
    assert.equal(bodies[firstIndex].vx, 0);
    assert.equal(bodies[firstIndex].vz, 0);
    for (let secondIndex = firstIndex + 1; secondIndex < bodies.length; secondIndex += 1) {
      assert.ok(Math.hypot(bodies[firstIndex].x - bodies[secondIndex].x,
        bodies[firstIndex].z - bodies[secondIndex].z) > 0.799);
    }
  }
});

test("separation skips vertically distinct characters and preserves existing impulses", () => {
  const firstBody = createBody({ x: 0, vx: 4, vz: 2 });
  const secondBody = createBody({ x: 0.2, vx: -3, vz: 1 });
  const overheadBody = createBody({ x: 0.1, y: 2 });
  const originalOverheadBody = { ...overheadBody };

  resolveSeparation([firstBody, secondBody, overheadBody], { radius: 0.4, height: 1.4 });

  assertNear(secondBody.x - firstBody.x, 0.8);
  assert.deepEqual(overheadBody, originalOverheadBody);
  assert.equal(firstBody.vx, 4);
  assert.equal(firstBody.vz, 2);
  assert.equal(secondBody.vx, -3);
  assert.equal(secondBody.vz, 1);
});

test("a coincident five-character crowd separates within a small explicit iteration budget", () => {
  for (const iterations of [3, 12]) {
    const bodies = Array.from({ length: 5 }, () => createBody());
    resolveSeparation(bodies, { radius: 0.4, height: 1.4, iterations });

    for (let firstIndex = 0; firstIndex < bodies.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < bodies.length; secondIndex += 1) {
        assert.ok(Math.hypot(bodies[firstIndex].x - bodies[secondIndex].x,
          bodies[firstIndex].z - bodies[secondIndex].z) >= 0.8 - 1e-6);
      }
    }
    assertNear(bodies.reduce((sum, body) => sum + body.x, 0), 0);
    assertNear(bodies.reduce((sum, body) => sum + body.z, 0), 0);
  }
});

test("invalid geometry and unbounded work settings fail at controller construction", () => {
  for (const invalidSettings of [
    { radius: 0 }, { height: -1 }, { gravity: -2 }, { moveSpeed: NaN },
    { maxDtSec: Infinity }, { maxSubsteps: 0 }, { maxSubsteps: 1.5 }, { maxSubsteps: 100000 },
    { acceleration: -1 }, { coyoteSec: -0.1 }, { jumpBufferSec: -0.1 },
  ]) {
    assert.throws(() => createController(invalidSettings), TypeError);
  }
});

test("sloped platforms land at the local center-foot height for positive, negative and combined gradients", () => {
  const controller = createController({ gravity: 20 });
  for (const slopeCase of [
    { x: 2, z: 0, slopeX: 0.25, slopeZ: 0, expectedY: 2.5 },
    { x: 2, z: 0, slopeX: -0.25, slopeZ: 0, expectedY: 1.5 },
    { x: 0, z: 2, slopeX: 0, slopeZ: 0.3, expectedY: 2.6 },
    { x: 2, z: 1, slopeX: 0.25, slopeZ: -0.2, expectedY: 2.3 },
  ]) {
    const body = createBody({ x: slopeCase.x, z: slopeCase.z, y: 6, vy: -5 });
    const platform = Object.freeze(createPlatform({ topY: 2, slopeX: slopeCase.slopeX, slopeZ: slopeCase.slopeZ }));
    for (let tick = 0; tick < 90; tick += 1) {
      controller.step(body, IDLE_INPUT, 1 / 60, { platforms: [platform] });
    }
    assertNear(body.y, slopeCase.expectedY);
    assert.equal(body.grounded, true);
    assert.equal(body.supportId, 1);
    assert.equal(body.vy, 0);
  }
});

test("walking uphill and downhill follows the surface without changing horizontal speed or losing grounding", () => {
  const controller = createController({ moveSpeed: 4, acceleration: 1000, gravity: 20, maxSubsteps: 1 });
  const body = createBody({ x: -2, y: -0.5, vx: 4, grounded: true, supportId: 1 });
  const platform = createPlatform({ width: 12, slopeX: 0.25, slopeZ: 0 });
  for (const direction of [1, -1]) {
    for (let tick = 0; tick < 10; tick += 1) {
      controller.step(body, { x: direction, z: 0, jump: false }, 0.1, { platforms: [platform] });
      assertNear(body.y, body.x * 0.25);
      assertNear(body.vx, direction * 4);
      assert.equal(body.vy, 0);
      assert.equal(body.grounded, true);
    }
  }
  assertNear(body.x, -2);
  assertNear(body.y, -0.5);
});

test("combined X/Z slopes support diagonal analog walking with different character dimensions", () => {
  const controller = createController({ radius: 0.15, height: 0.6, moveSpeed: 5, acceleration: 1000, gravity: 12 });
  const body = createBody({ grounded: true, supportId: 1 });
  const platform = createPlatform({ slopeX: 0.2, slopeZ: -0.3 });
  for (let tick = 0; tick < 30; tick += 1) {
    controller.step(body, { x: 0.3, z: -0.4, jump: false }, 1 / 60, { platforms: [platform] });
    assertNear(body.y, body.x * 0.2 - body.z * 0.3);
    assert.equal(body.grounded, true);
  }
  assertNear(body.vx, 1.5);
  assertNear(body.vz, -2);
});

test("a fast airborne approach sweeps the actual inclined plane with a single collision substep", () => {
  const controller = createController({ radius: 0.4, height: 1.4, gravity: 0, maxSubsteps: 1 });
  const body = createBody({ x: -3, y: 0.9, vx: 40, vy: -10 });
  const platform = createPlatform({ width: 8, thickness: 0.1, slopeX: 0.25 });

  controller.step(body, IDLE_INPUT, 0.1, { platforms: [platform], controlScale: 0 });

  assertNear(body.x, 1);
  assertNear(body.y, 0.25);
  assertNear(body.vx, 40);
  assert.equal(body.vy, 0);
  assert.equal(body.grounded, true);
});

test("walking past a sloped edge releases support and gravity continues without extending the plane", () => {
  const controller = createController({ radius: 0.2, gravity: 20, braking: 0 });
  const body = createBody({ x: 0.8, y: 0.24, vx: 6, grounded: true, supportId: 1 });
  const platform = createPlatform({ width: 2, slopeX: 0.3 });

  controller.step(body, IDLE_INPUT, 0.1, { platforms: [platform] });
  const edgeHeight = body.y;
  controller.step(body, IDLE_INPUT, 0.1, { platforms: [platform] });

  assert.equal(body.grounded, false);
  assert.equal(body.supportId, 0);
  assert.ok(body.y < edgeHeight);
  assert.ok(body.vy < 0);
});

test("small sampled tilt changes carry an existing supported foot upward and downward without timer changes", () => {
  const controller = createController();
  const body = createBody({ x: 2, grounded: true, supportId: 1, coyoteSec: 0.04, jumpBufferSec: 0.03 });
  for (const slopeX of [0.01, 0.02, 0.03, 0.02, 0.01, 0, -0.01, -0.02]) {
    const platform = Object.freeze(createPlatform({ slopeX, slopeZ: 0 }));
    controller.step(body, IDLE_INPUT, 0, { platforms: [platform] });
    assertNear(body.y, slopeX * 2);
    assert.equal(body.grounded, true);
    assert.equal(body.supportId, 1);
    assert.equal(body.vy, 0);
    assert.equal(body.coyoteSec, 0.04);
    assert.equal(body.jumpBufferSec, 0.03);
  }
});

test("jumping and nearby airborne bodies never reattach to a newly sampled slope", () => {
  const controller = createController({ gravity: 0, jumpSpeed: 1 });
  const body = createBody({ x: 2, y: 0.4, grounded: true, supportId: 1 });
  controller.step(body, { x: 0, z: 0, jump: true }, 1 / 60, { platforms: [createPlatform({ slopeX: 0.2 })] });
  const jumpedHeight = body.y;
  assert.ok(jumpedHeight > 0.4);
  controller.step(body, IDLE_INPUT, 0, { platforms: [createPlatform({ slopeX: 0.205 })] });
  assertNear(body.y, jumpedHeight);
  assert.equal(body.grounded, false);
  assert.equal(body.supportId, 0);

  const airborneBody = createBody({ x: 2, y: 0.44, grounded: false, supportId: 1 });
  controller.step(airborneBody, IDLE_INPUT, 0, { platforms: [createPlatform({ slopeX: 0.2 })] });
  assertNear(airborneBody.y, 0.44);
  assert.equal(airborneBody.grounded, false);
});

test("support reattachment is bounded and cannot snap across a large drop or a different platform identity", () => {
  const controller = createController({ gravity: 0 });
  const largeGapBody = createBody({ x: 2, y: 0.3, grounded: true, supportId: 1 });
  const otherSupportBody = createBody({ x: 2, y: 0.03, grounded: true, supportId: 9 });
  const platform = createPlatform({ slopeX: 0, slopeZ: 0 });

  controller.step(largeGapBody, IDLE_INPUT, 0, { platforms: [platform] });
  controller.step(otherSupportBody, IDLE_INPUT, 0, { platforms: [platform] });

  assertNear(largeGapBody.y, 0.3);
  assert.equal(largeGapBody.grounded, false);
  assertNear(otherSupportBody.y, 0.03);
  assert.equal(otherSupportBody.grounded, false);
});

test("sloped undersides use local height and continuously stop fast jumps through thin geometry", () => {
  for (const undersideCase of [
    { x: 2, height: 1.1, expectedY: 1.42 },
    { x: -2, height: 0.5, expectedY: 0.82 },
  ]) {
    const controller = createController({ height: undersideCase.height, gravity: 0, maxSubsteps: 1 });
    const body = createBody({ x: undersideCase.x, y: -2, vy: 100 });
    const platform = createPlatform({ topY: 2, thickness: 0.08, slopeX: 0.3 });
    controller.step(body, IDLE_INPUT, 0.05, { platforms: [platform], controlScale: 0 });
    assertNear(body.y, undersideCase.expectedY);
    assert.equal(body.vy, 0);
    assert.equal(body.grounded, false);
  }
});

test("inclined platform sides block at their local height while the low end has no invisible tall wall", () => {
  const controller = createController({ radius: 0.4, height: 0.5, gravity: 0, maxSubsteps: 1 });
  const lowSideBody = createBody({ x: -6, y: 0.2, vx: 100 });
  const highSideBody = createBody({ x: 6, y: 1.3, vx: -100 });
  const platform = createPlatform({ width: 8, thickness: 1, slopeX: 0.5 });

  controller.step(lowSideBody, IDLE_INPUT, 0.02, { platforms: [platform], controlScale: 0 });
  controller.step(highSideBody, IDLE_INPUT, 0.02, { platforms: [platform], controlScale: 0 });

  assertNear(lowSideBody.x, -4);
  assertNear(lowSideBody.vx, 100);
  assertNear(highSideBody.x, 4.4);
  assert.equal(highSideBody.vx, 0);
});

test("translating sloped support carries once while preserving the runner's relative surface height", () => {
  const controller = createController({ gravity: 20 });
  const body = createBody({ x: 2, z: -1, y: 0.7, grounded: true, supportId: 1 });
  const platform = createPlatform({ slopeX: 0.25, slopeZ: -0.2, vx: 3, vy: 2, vz: -4 });

  controller.step(body, IDLE_INPUT, 0.1, { platforms: [platform] });

  assertNear(body.x, 2.3);
  assertNear(body.z, -1.4);
  assertNear(body.y, 0.9);
  assert.equal(body.grounded, true);
  assert.equal(body.vx, 0);
  assert.equal(body.vy, 0);
  assert.equal(body.vz, 0);
});

test("invalid or excessive platform slope gradients fail before mutating character state", () => {
  const controller = createController();
  for (const slopeOverrides of [{ slopeX: NaN }, { slopeZ: Infinity }, { slopeX: 1.1 }, { slopeZ: -1.1 }]) {
    const body = createBody();
    const originalBody = { ...body };
    assert.throws(() => controller.step(body, IDLE_INPUT, 1 / 60, {
      platforms: [createPlatform(slopeOverrides)],
    }), TypeError);
    assert.deepEqual(body, originalBody);
  }
});

test("a wall stops uphill or downhill movement without launching a supported foot off its slope", () => {
  for (const gravity of [0, 20]) {
    for (const slopeX of [-0.25, 0.25]) {
      const controller = createController({ radius: 0.4, gravity, maxSubsteps: 1 });
      const body = createBody({ x: -2, y: -2 * slopeX, vx: 20, grounded: true, supportId: 1 });
      const ramp = createPlatform({ slopeX });
      const wall = createPlatform({ id: 2, width: 0.1, topY: 3, thickness: 8 });
      controller.step(body, IDLE_INPUT, 0.1, { platforms: [ramp, wall], controlScale: 0 });
      assertNear(body.x, -0.45);
      assertNear(body.y, body.x * slopeX);
      assert.equal(body.vx, 0);
      assert.equal(body.vy, 0);
      assert.equal(body.grounded, true);
      assert.equal(body.supportId, 1);
    }
  }
});

test("the shared surface sampler uses projected centers and leaves caller-owned geometry unchanged", () => {
  const platform = Object.freeze(createPlatform({
    x: 1, z: 2, topY: 3, slopeX: 0.5, slopeZ: -0.25, vx: 2, vy: 1, vz: -4,
  }));
  assertNear(getKinematicPlatformTopY(platform, 3, 0), 4.5);
  assertNear(getKinematicPlatformTopY(platform, 3.5, -1, 0.25), 4.75);
  assertNear(getKinematicPlatformTopY(createPlatform({ topY: 3, vy: 1 }), 8, -6, 0.25), 3.25);
  assert.deepEqual(platform, {
    id: 1, x: 1, z: 2, width: 20, depth: 20, topY: 3, thickness: 1,
    vx: 2, vy: 1, vz: -4, slopeX: 0.5, slopeZ: -0.25,
  });
});
