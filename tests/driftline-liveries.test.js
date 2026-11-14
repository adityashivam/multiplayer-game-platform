import test from "node:test";
import assert from "node:assert/strict";
import { DRIFTLINE_LIVERIES, getDriftlineLivery } from "../public/games/driftline/rendering/liveries.js";

const COSMETIC_FIELDS = ["id", "name", "finish", "stripes", "stripeColor", "accentColor", "rims", "addons"].sort();

test("a full six-car grid shows six different looks, the same on every client", () => {
  const ids = Array.from({ length: 6 }, (_unused, slot) => getDriftlineLivery(slot).id);
  assert.equal(new Set(ids).size, 6);
  assert.deepEqual(ids, Array.from({ length: 6 }, (_unused, slot) => getDriftlineLivery(slot).id));
  assert.equal(getDriftlineLivery(0).id, "muscle", "player one drives the muscle look");
  assert.equal(getDriftlineLivery(6), getDriftlineLivery(0), "larger grids wrap around");
  assert.equal(getDriftlineLivery(-1), getDriftlineLivery(0), "invalid slots fall back safely");
});

test("liveries hold cosmetic fields only, so handling stays identical for everyone", () => {
  for (const livery of DRIFTLINE_LIVERIES) {
    assert.deepEqual(Object.keys(livery).sort(), COSMETIC_FIELDS, livery.id);
    assert.ok(Object.isFrozen(livery) && Object.isFrozen(livery.addons));
  }
});
