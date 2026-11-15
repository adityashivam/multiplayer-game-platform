import test from "node:test";
import assert from "node:assert/strict";
import { readNextCatalogIndex, readSpatialCatalogIndex } from "../public/platform/src/platform-ui/services/catalogNavigation.js";

test("catalog navigation moves vertically by the responsive column count", () => {
  assert.equal(readNextCatalogIndex(1, "down", 3, 24), 4);
  assert.equal(readNextCatalogIndex(7, "up", 3, 24), 4);
  assert.equal(readNextCatalogIndex(1, "down", 2, 24), 3);
  assert.equal(readNextCatalogIndex(1, "right", 3, 24), 2);
});

test("catalog navigation bounds incomplete rows and handles empty results", () => {
  assert.equal(readNextCatalogIndex(5, "down", 3, 7), 6);
  assert.equal(readNextCatalogIndex(0, "left", 3, 7), 0);
  assert.equal(readNextCatalogIndex(6, "end", 3, 7), 6);
  assert.equal(readNextCatalogIndex(6, "home", 3, 7), 0);
  assert.equal(readNextCatalogIndex(0, "right", 3, 0), 0);
});

test("up and down move to the nearest card in the next drawn row", () => {
  // A partial last row: down from the end of a row goes to the nearest card below.
  const box = (left, top) => ({ left, top, width: 100, height: 130 });
  const boxes = [box(0, 0), box(110, 0), box(220, 0), box(0, 180), box(110, 180)];
  assert.equal(readSpatialCatalogIndex(boxes, 2, "down"), 4);
  assert.equal(readSpatialCatalogIndex(boxes, 0, "down"), 3);
  assert.equal(readSpatialCatalogIndex(boxes, 4, "up"), 1);
  assert.equal(readSpatialCatalogIndex(boxes, 3, "down"), 3);
  assert.equal(readSpatialCatalogIndex(boxes, 2, "right"), 3);
  assert.equal(readSpatialCatalogIndex(boxes, 4, "home"), 0);
  assert.equal(readSpatialCatalogIndex([], 0, "down"), 0);
});
