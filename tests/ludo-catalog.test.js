import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createBuiltInGameRegistry } from "../server/platform-backend-engine/games/builtInGames.js";
import { fallbackGames } from "../public/platform/src/data/games.js";
import { LUDO_PLAYER_IDS } from "../public/games/ludo/shared/config.js";

test("Ludo registers a two-player event-driven room using shared platform voice and controls", () => {
  const ludoMetadata = createBuiltInGameRegistry().getGame("ludo");
  assert.ok(ludoMetadata, "Ludo must be discoverable through the normal game registry");
  assert.deepEqual(ludoMetadata.room.playerIds, ["p1", "p2"]);
  assert.deepEqual(ludoMetadata.room.playerIds, LUDO_PLAYER_IDS);
  assert.equal(ludoMetadata.namespace, "/ludo");
  assert.equal(ludoMetadata.runtime.socketIo, true);
  assert.equal(ludoMetadata.runtime.kaboom, false);
  assert.equal(ludoMetadata.runtime.entryUrl, "/games/ludo/dist/main.js");
  assert.equal(ludoMetadata.networking.tickRateHz, 10);
  assert.equal(ludoMetadata.networking.inputProtocol, null);
  assert.equal(ludoMetadata.networking.inputTemplate, null);
  assert.equal(ludoMetadata.touchControls.controls.length, 1);
  assert.equal(ludoMetadata.touchControls.controls[0].platformBinding, "a");
  assert.equal(ludoMetadata.touchControls.controls[0].behavior, "press");
});

test("Ludo offline discovery reuses its game-owned artwork and touch configuration", () => {
  const ludoMetadata = createBuiltInGameRegistry().getGame("ludo");
  const fallbackMetadata = fallbackGames.find((gameMetadata) => gameMetadata.id === "ludo");
  assert.ok(ludoMetadata && fallbackMetadata);
  assert.deepEqual(fallbackMetadata.presentation, ludoMetadata.presentation);
  assert.deepEqual(fallbackMetadata.touchControls, ludoMetadata.touchControls);
  assert.deepEqual(fallbackMetadata.runtime, ludoMetadata.runtime);
});

test("Ludo supplies its own board artwork without an external image dependency", async () => {
  const coverMarkup = await readFile(new URL("../public/games/ludo/cover.svg", import.meta.url), "utf8");
  assert.match(coverMarkup, /<svg\b/);
  assert.doesNotMatch(coverMarkup, /(?:href|src)=["']https?:/);
});
