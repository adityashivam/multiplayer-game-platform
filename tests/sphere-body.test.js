import test from "node:test";
import assert from "node:assert/strict";
import { createSphereBodyController } from "../public/platform/shared/sphereBody.js";

function createBody(overrides = {}) {
  return { x: 0, y: 1, z: 0, vx: 0, vy: 0, vz: 0, ...overrides };
}

const thinWall = Object.freeze({ minX: 1, maxX: 1.02, minY: 0, maxY: 5, minZ: -4, maxZ: 4 });

test("sphere sweep rebounds from a thin wall at high speed without tunneling", () => {
  const controller = createSphereBodyController({ radius: 0.2, gravity: 0, restitution: 1, linearDamping: 0 });
  const body = createBody({ vx: 24 });
  const report = controller.step(body, 0.05, { solids: [thinWall] });

  assert.ok(body.x < 0.8);
  assert.equal(body.vx, -24);
  assert.equal(report.bounceCount, 1);
});

test("sphere sweep preserves rounded box corners instead of blocking the expanded cube", () => {
  const controller = createSphereBodyController({ radius: 0.4, gravity: 0, restitution: 1, linearDamping: 0 });
  const body = createBody({ x: 0, y: 1.35, z: 1.35, vx: 24 });
  controller.step(body, 0.05, {
    solids: [{ minX: 0.6, maxX: 0.8, minY: 0, maxY: 1, minZ: 0, maxZ: 1 }],
  });

  assert.ok(Math.abs(body.x - 1.2) < 1e-8);
  assert.equal(body.vx, 24);
});

test("sphere resting contact stops vertical chatter while friction slows a rolling body", () => {
  const controller = createSphereBodyController({ radius: 0.4, gravity: 18, restitution: 0.7, groundFriction: 2 });
  const body = createBody({ y: 2, vx: 2 });
  for (let index = 0; index < 600; index += 1) {
    controller.step(body, 1 / 60, { solids: [], floorY: 0 });
  }
  assert.equal(body.y, 0.4);
  assert.equal(body.vy, 0);
  assert.equal(body.vx, 0);
  const settled = structuredClone(body);
  assert.equal(controller.step(body, 1 / 60, { solids: [], floorY: 0 }).bounceCount, 0);
  assert.deepEqual(body, settled);
});

test("sphere movement reports actual travel before rebound for application plane crossings", () => {
  const controller = createSphereBodyController({ radius: 0.2, gravity: 0, restitution: 1, linearDamping: 0 });
  const segments = [];
  const body = createBody({ vx: 24 });
  controller.step(body, 0.05, { solids: [thinWall], onTravel: (segment) => segments.push({ ...segment }) });

  assert.ok(segments.some((segment) => segment.startX < 0.7 && segment.endX >= 0.79));
  assert.ok(segments.some((segment) => segment.endX < segment.startX));
});

test("sphere invalid geometry fails before mutation and bounded contacts discard unchecked movement", () => {
  const controller = createSphereBodyController({ radius: 0.4, gravity: 0, maxContacts: 1, restitution: 1, linearDamping: 0 });
  const body = createBody({ vx: 24 });
  const original = structuredClone(body);
  assert.throws(() => controller.step(body, 0.05, { solids: [{ ...thinWall, minX: NaN }] }), TypeError);
  assert.deepEqual(body, original);

  controller.step(body, 0.05, { solids: [thinWall] });
  assert.ok(body.x <= 0.6 + 1e-6);
  assert.ok(body.x >= -0.001);
});
