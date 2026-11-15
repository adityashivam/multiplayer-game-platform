import test from "node:test";
import assert from "node:assert/strict";
import { pushLibraryBackdropLayer } from "../public/platform/src/platform-ui/services/libraryBackdrop.js";

test("a new focused game's backdrop crossfades over the previous one", () => {
  let layers = pushLibraryBackdropLayer([], "/games/a/art/backdrop.svg");
  assert.deepEqual(layers.map((layer) => layer.url), ["/games/a/art/backdrop.svg"]);
  layers = pushLibraryBackdropLayer(layers, "/games/b/art/backdrop.svg");
  assert.deepEqual(layers.map((layer) => layer.url), ["/games/a/art/backdrop.svg", "/games/b/art/backdrop.svg"]);
  assert.notEqual(layers[0].id, layers[1].id);
});

test("at most two layers are kept while focus moves quickly", () => {
  let layers = [];
  for (const game of ["a", "b", "c", "d"]) layers = pushLibraryBackdropLayer(layers, `/games/${game}/art/backdrop.svg`);
  assert.deepEqual(layers.map((layer) => layer.url), ["/games/c/art/backdrop.svg", "/games/d/art/backdrop.svg"]);
});

test("the same backdrop again changes nothing, and a game without one clears it", () => {
  const layers = pushLibraryBackdropLayer([], "/games/a/art/backdrop.svg");
  assert.equal(pushLibraryBackdropLayer(layers, "/games/a/art/backdrop.svg"), layers);
  assert.deepEqual(pushLibraryBackdropLayer(layers, null), []);
});
