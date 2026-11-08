import assert from "node:assert/strict";
import test from "node:test";
import { clampTouchControlPosition, moveTouchControlByPixels, resetTouchLayoutControl, resetTouchLayoutPreset } from "../public/platform/src/platform-ui/components/touch-controls/touchLayoutGeometry.js";

test("touch controls remain inside the play surface and below its toolbar", () => {
  const position = clampTouchControlPosition(
    { x: -0.2, y: -0.2, size: 80 },
    { width: 390, height: 700, topInset: 56 },
  );

  assert.equal(position.x, 52 / 390);
  assert.equal(position.y, 96 / 700);
  assert.deepEqual(clampTouchControlPosition(
    { x: 1.2, y: 1.2, size: 80 },
    { width: 390, height: 700, topInset: 56 },
  ), { x: 338 / 390, y: 648 / 700 });
});

test("keyboard adjustment uses screen pixels and remains bounded after rotation", () => {
  const control = { x: 0.5, y: 0.5, size: 80 };

  assert.deepEqual(moveTouchControlByPixels(control, 10, -1, {
    width: 844, height: 390, topInset: 56,
  }), { x: 0.5 + 10 / 844, y: 0.5 - 1 / 390 });
  assert.deepEqual(control, { x: 0.5, y: 0.5, size: 80 });

  const position = moveTouchControlByPixels(control, -1000, -1000, {
    width: 844, height: 390, topInset: 56,
  });
  assert.equal(position.x, 52 / 844);
  assert.equal(position.y, 96 / 390);
});

test("a surface smaller than a control still yields a visible centered target", () => {
  const position = clampTouchControlPosition(
    { x: 0, y: 0, size: 160 },
    { width: 150, height: 140, topInset: 56 },
  );

  assert.deepEqual(position, { x: 0.5, y: 0.5 });
});

test("editor drag bounds respect device insets and keep controls clear of editor actions", () => {
  const dimensions = { width: 844, height: 390, topInset: 90, leftInset: 44, rightInset: 22, bottomInset: 48 };

  assert.deepEqual(clampTouchControlPosition({ x: 0, y: 0, size: 80 }, dimensions), {
    x: 84 / 844, y: 130 / 390,
  });
  assert.deepEqual(clampTouchControlPosition({ x: 1, y: 1, size: 80 }, dimensions), {
    x: 782 / 844, y: 302 / 390,
  });
});

test("reset selected keeps other controls and presets without changing the saved profile", () => {
  const savedProfile = {
    presetId: "three-finger",
    mode: "auto",
    layouts: {
      "two-thumb": { fire: { size: 80 } },
      "three-finger": { fire: { x: 0.2 }, move: { opacity: 0.8 } },
    },
  };
  const resetProfile = resetTouchLayoutControl(savedProfile, "fire");

  assert.deepEqual(resetProfile.layouts["three-finger"], { move: { opacity: 0.8 } });
  assert.deepEqual(resetProfile.layouts["two-thumb"], { fire: { size: 80 } });
  assert.deepEqual(savedProfile.layouts["three-finger"].fire, { x: 0.2 });
});

test("reset layout clears only the draft's selected preset and preserves presentation choices", () => {
  const savedProfile = {
    presetId: "two-thumb",
    mode: "on",
    hideShell: true,
    layouts: {
      "two-thumb": { fire: { size: 80 } },
      "three-finger": { fire: { y: 0.2 } },
    },
  };
  const resetProfile = resetTouchLayoutPreset(savedProfile);

  assert.deepEqual(resetProfile.layouts["two-thumb"], {});
  assert.deepEqual(resetProfile.layouts["three-finger"], { fire: { y: 0.2 } });
  assert.equal(resetProfile.mode, "on");
  assert.equal(resetProfile.hideShell, true);
  assert.deepEqual(savedProfile.layouts["two-thumb"], { fire: { size: 80 } });
});
