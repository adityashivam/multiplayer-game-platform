import assert from "node:assert/strict";
import test from "node:test";
import { createRenderResources } from "../public/games/dead-shift/rendering/resources.js";
import { createFirstPersonWeapons } from "../public/games/dead-shift/rendering/weapons.js";
import { createDeadShiftPlayer } from "../public/games/dead-shift/shared/simulation.js";

function createWeaponPresentation(testContext) {
  const resources = createRenderResources();
  const weapons = createFirstPersonWeapons(resources);
  const localPlayer = createDeadShiftPlayer("p1");
  const frame = {
    localPlayer,
    input: { weapon: 0, fire: false, aiming: false },
    dtSec: 1 / 60,
    timeSec: 0,
    moving: false,
    reducedMotion: false,
    roundId: null,
  };
  const weaponRoot = weapons.scene.children.find((child) => child.isGroup);
  testContext.after(() => {
    weapons.dispose();
    resources.dispose();
  });
  return { weapons, frame, weaponRoot };
}

test("aiming eases the visible weapon toward the crosshair without changing authority", (testContext) => {
  const { weapons, frame, weaponRoot } = createWeaponPresentation(testContext);
  weapons.update(frame);
  const hipPosition = weaponRoot.position.clone();
  const authorityBefore = structuredClone(frame.localPlayer);
  frame.input.aiming = true;
  weapons.update(frame);
  assert.ok(weaponRoot.position.x < hipPosition.x);
  assert.ok(weaponRoot.position.x > 0);
  assert.ok(weaponRoot.position.y > hipPosition.y);

  for (let frameNumber = 0; frameNumber < 60; frameNumber += 1) weapons.update(frame);
  assert.ok(Math.abs(weaponRoot.position.x) < 0.001);
  frame.input.aiming = false;
  weapons.update(frame);
  assert.ok(weaponRoot.position.x > 0.01);
  assert.ok(weaponRoot.position.x < hipPosition.x);
  assert.deepEqual(frame.localPlayer, authorityBefore);
});

test("reduced motion snaps ADS presentation and reload/death return the weapon to its hip pose", (testContext) => {
  const { weapons, frame, weaponRoot } = createWeaponPresentation(testContext);
  frame.reducedMotion = true;
  frame.input.aiming = true;
  weapons.update(frame);
  assert.equal(weaponRoot.position.x, 0);
  frame.localPlayer.reloadRemaining = 0.5;
  weapons.update(frame);
  assert.equal(weaponRoot.position.x, 0.28);
  frame.localPlayer.reloadRemaining = 0;
  frame.localPlayer.health = 0;
  weapons.update(frame);
  assert.equal(weaponRoot.position.x, 0.28);
  assert.equal(weapons.scene.visible, false);
});
