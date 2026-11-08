import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDeadShiftMovement, rotateDeadShiftAim } from "../public/games/dead-shift/client/inputMath.js";
import { extractDeadShiftPositions, readDeadShiftEntityPosition } from "../public/games/dead-shift/client/snapshotPose.js";

test("analog movement keeps partial speed and caps combined diagonal input", () => {
  assert.deepEqual(normalizeDeadShiftMovement({ stickX: 0.25, stickY: -0.5 }), { moveX: 0.25, moveZ: 0.5 });
  const movement = normalizeDeadShiftMovement({ keyboardX: 1, keyboardZ: 1, stickX: 1 });
  assert.ok(Math.abs(Math.hypot(movement.moveX, movement.moveZ) - 1) < 1e-10);
  assert.deepEqual(normalizeDeadShiftMovement({ keyboardZ: 1, stickY: 1 }), { moveX: 0, moveZ: 0 });
});

test("mouse and stick aiming follow the same bounded camera convention", () => {
  const aim = rotateDeadShiftAim({ yaw: 0, pitch: 0 }, 100, -100, 0.002);
  assert.equal(aim.yaw, -0.2);
  assert.equal(aim.pitch, 0.2);
  const wrappedAim = rotateDeadShiftAim({ yaw: Math.PI - 0.01, pitch: 1.2 }, -100, -10000, 0.002);
  assert.ok(wrappedAim.yaw >= -Math.PI && wrappedAim.yaw <= Math.PI);
  assert.equal(wrappedAim.pitch, 1.3);
});

test("reused entity slots snap to their new identity instead of crossing the room", () => {
  const enemy = { id: 21, x: 8, y: 0, z: -6 };
  assert.deepEqual(readDeadShiftEntityPosition(enemy, { e0id: 20.5, e0x: -3, e0y: 0, e0z: 1 }, "e0"), { x: 8, y: 0, z: -6 });
  assert.deepEqual(readDeadShiftEntityPosition(enemy, { e0id: 21, e0x: 7.5, e0y: 0, e0z: -5.5 }, "e0"), { x: 7.5, y: 0, z: -5.5 });
});

test("snapshot extraction retains slot identity and does not mutate authority", () => {
  const snapshot = { players: { p1: { x: 1, y: 0, z: 2 }, p2: { x: 3, y: 0, z: 4 } }, enemies: [{ id: 7, x: 5, y: 0, z: 6 }], projectiles: [{ id: 8, x: 7, y: 2, z: 8 }] };
  const before = structuredClone(snapshot);
  const pose = extractDeadShiftPositions(snapshot);
  assert.equal(pose.p1x, 1);
  assert.equal(pose.e0id, 7);
  assert.equal(pose.r0y, 2);
  assert.deepEqual(snapshot, before);
});
