import test from "node:test";
import assert from "node:assert/strict";
import { readNextCatalogIndex } from "../public/platform/src/platform-ui/services/catalogNavigation.js";

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
