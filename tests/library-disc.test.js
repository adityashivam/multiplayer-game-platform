import test from "node:test";
import assert from "node:assert/strict";
import {
  LIBRARY_DISC,
  clampLibraryDiscIndex,
  placeLibraryDiscItem,
  readLibraryDiscGeometry,
  settleLibraryDiscIndex,
} from "../public/platform/src/platform-ui/services/libraryDisc.js";
import { readLibraryLayoutChoice, resolveLibraryLayout, saveLibraryLayoutChoice } from "../public/platform/src/platform-ui/services/libraryLayout.js";

const geometry = readLibraryDiscGeometry({ width: 176, height: 440 });

test("the selected name rests at the disc's leftmost point, on the rim", () => {
  const selected = placeLibraryDiscItem(0, geometry);
  assert.equal(selected.visible, true);
  assert.equal(Math.round(selected.x), LIBRARY_DISC.rimInsetPx);
  assert.equal(selected.y, geometry.centerY);
  assert.equal(selected.angleDeg, 0);
  assert.equal(selected.opacity, 1);
});

test("neighbours follow the curve rightward, shrink and fade, symmetrically", () => {
  const below = placeLibraryDiscItem(2, geometry);
  const above = placeLibraryDiscItem(-2, geometry);
  const selected = placeLibraryDiscItem(0, geometry);
  assert.ok(below.x > selected.x && below.y > selected.y);
  assert.ok(above.y < selected.y);
  assert.equal(Math.round(below.x), Math.round(above.x));
  assert.ok(below.scale < selected.scale && below.opacity < selected.opacity);
  assert.equal(below.angleDeg, -above.angleDeg, "names turn toward the hub");
});

test("names that would leave the column are hidden", () => {
  const far = placeLibraryDiscItem(20, geometry);
  assert.equal(far.visible, false);
  for (let offset = -10; offset <= 10; offset += 1) {
    const placement = placeLibraryDiscItem(offset, geometry);
    if (placement.visible) assert.ok(placement.y >= 0 && placement.y <= 440, `offset ${offset} at ${placement.y}`);
  }
});

test("a shorter column (console deck open) shows fewer names on a tighter arc", () => {
  const tall = readLibraryDiscGeometry({ width: 176, height: 520 });
  const short = readLibraryDiscGeometry({ width: 176, height: 300 });
  const visibleCount = (box) => Array.from({ length: 21 }, (_, index) => placeLibraryDiscItem(index - 10, box)).filter((placement) => placement.visible).length;
  assert.ok(visibleCount(short) < visibleCount(tall));
  assert.ok(visibleCount(short) >= 3, "at least the selection and its neighbours");
});

test("a released disc settles on the nearest game, carried by its speed", () => {
  assert.equal(settleLibraryDiscIndex(3.4, 0, 10), 3);
  assert.equal(settleLibraryDiscIndex(3.4, 3, 10), 4, "a gentle flick carries one game further");
  assert.equal(settleLibraryDiscIndex(3.4, -40, 10), 0, "a hard flick is capped");
  assert.equal(settleLibraryDiscIndex(9.8, 20, 10), 9);
  assert.equal(clampLibraryDiscIndex(-2, 5), 0);
  assert.equal(clampLibraryDiscIndex(3, 0), 0);
});

function createMemoryStorage() {
  const values = new Map();
  return { getItem: (key) => (values.has(key) ? values.get(key) : null), setItem: (key, value) => values.set(key, String(value)) };
}

test("portrait screens default to the disc; landscape always shows the grid", () => {
  assert.equal(resolveLibraryLayout(null, true), "disc");
  assert.equal(resolveLibraryLayout("grid", true), "grid");
  assert.equal(resolveLibraryLayout("disc", false), "grid");
  assert.equal(resolveLibraryLayout(null, false), "grid");
});

test("the layout choice is remembered, and bad or blocked storage is ignored", () => {
  const storage = createMemoryStorage();
  assert.equal(readLibraryLayoutChoice(storage), null);
  saveLibraryLayoutChoice("grid", storage);
  assert.equal(readLibraryLayoutChoice(storage), "grid");
  storage.setItem("platform.library-layout.v1", "carousel");
  assert.equal(readLibraryLayoutChoice(storage), null);
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.equal(readLibraryLayoutChoice(blocked), null);
  assert.doesNotThrow(() => saveLibraryLayoutChoice("disc", blocked));
});
