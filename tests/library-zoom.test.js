import test from "node:test";
import assert from "node:assert/strict";
import {
  LIBRARY_ZOOM,
  clampLibraryZoom,
  readLibraryZoom,
  saveLibraryZoom,
  scaleLibraryZoomByFactor,
  stepLibraryZoom,
} from "../public/platform/src/platform-ui/services/libraryZoom.js";
import { captureLayoutBoxes, morphFromLayoutBoxes } from "../public/platform/src/platform-ui/services/layoutMorph.js";

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
  };
}

test("buttons walk the zoom stops and stop at both ends", () => {
  const stopsOut = [];
  for (let scale = 1; stopsOut.length < 10; ) {
    scale = stepLibraryZoom(scale, -1);
    stopsOut.push(scale);
  }
  assert.deepEqual(stopsOut.slice(0, 5), [0.85, 0.7, 0.55, 0.45, 0.45]);
  assert.equal(stepLibraryZoom(0.45, 1), 0.55);
  assert.equal(stepLibraryZoom(1, 1), 1.15);
  assert.equal(stepLibraryZoom(LIBRARY_ZOOM.max, 1), LIBRARY_ZOOM.max);
});

test("zoom offers more room to zoom out than the old fixed steps", () => {
  assert.ok(LIBRARY_ZOOM.min <= 0.5);
  assert.ok(LIBRARY_ZOOM.max >= 1.5);
});

test("a press after a pinch moves to the nearest stop on that side", () => {
  assert.equal(stepLibraryZoom(0.93, 1), 1);
  assert.equal(stepLibraryZoom(0.93, -1), 0.85);
  assert.equal(stepLibraryZoom(1.0004, 1), 1.15);
});

test("pinch factors scale continuously within the range", () => {
  assert.equal(scaleLibraryZoomByFactor(1, 1.1), 1.1);
  assert.equal(scaleLibraryZoomByFactor(1, 10), LIBRARY_ZOOM.max);
  assert.equal(scaleLibraryZoomByFactor(1, 0.01), LIBRARY_ZOOM.min);
  assert.equal(scaleLibraryZoomByFactor(1.2, Number.NaN), 1.2);
  assert.equal(clampLibraryZoom(Number.NaN), LIBRARY_ZOOM.initial);
});

test("the chosen size is remembered, and broken storage falls back", () => {
  const storage = createMemoryStorage();
  assert.equal(readLibraryZoom(storage), 1);
  saveLibraryZoom(0.7, storage);
  assert.equal(readLibraryZoom(storage), 0.7);
  storage.setItem("platform.library-card-scale.v1", "9");
  assert.equal(readLibraryZoom(storage), LIBRARY_ZOOM.max);
  storage.setItem("platform.library-card-scale.v1", "nope");
  assert.equal(readLibraryZoom(storage), 1);
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.equal(readLibraryZoom(blocked), 1);
  assert.doesNotThrow(() => saveLibraryZoom(1.3, blocked));
});

/** A stand-in element whose layout box can be moved between captures. */
function createFakeElement(box) {
  const element = {
    box,
    isConnected: true,
    animations: [],
    getBoundingClientRect: () => ({ ...element.box, right: element.box.left + element.box.width, bottom: element.box.top + element.box.height }),
    animate(keyframes, options) {
      const animation = { keyframes, options, cancelled: false, cancel() { this.cancelled = true; }, addEventListener() {} };
      element.animations.push(animation);
      return animation;
    },
  };
  return element;
}

test("a reflowed card glides from its old box instead of jumping", () => {
  const card = createFakeElement({ left: 100, top: 50, width: 120, height: 160 });
  const before = captureLayoutBoxes([card]);
  card.box = { left: 40, top: 20, width: 60, height: 80 };
  assert.equal(morphFromLayoutBoxes(before, { durationMs: 200 }), 1);
  const [{ keyframes, options }] = card.animations;
  assert.equal(keyframes[0].transform, "translate(60px, 30px) scale(2, 2)");
  assert.equal(keyframes[1].transform, "none");
  assert.equal(options.duration, 200);
});

test("a new change cancels the running glide and skips cards that did not move", () => {
  const moving = createFakeElement({ left: 0, top: 0, width: 100, height: 100 });
  const still = createFakeElement({ left: 200, top: 0, width: 100, height: 100 });
  let before = captureLayoutBoxes([moving, still]);
  moving.box = { left: 50, top: 0, width: 100, height: 100 };
  assert.equal(morphFromLayoutBoxes(before), 1);
  before = captureLayoutBoxes([moving, still]);
  moving.box = { left: 80, top: 0, width: 100, height: 100 };
  morphFromLayoutBoxes(before);
  assert.equal(moving.animations[0].cancelled, true);
  assert.equal(still.animations.length, 0);
});

test("cards far outside the visible grid snap instead of animating", () => {
  const offscreen = createFakeElement({ left: 0, top: 5000, width: 100, height: 100 });
  const before = captureLayoutBoxes([offscreen]);
  offscreen.box = { left: 0, top: 4000, width: 80, height: 80 };
  const viewport = { top: 0, bottom: 600, height: 600, left: 0, right: 800, width: 800 };
  assert.equal(morphFromLayoutBoxes(before, { viewport }), 0);
});
