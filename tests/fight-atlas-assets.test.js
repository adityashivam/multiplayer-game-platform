import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FIGHT_MOVE_SHEETS, FIGHT_MOVE_CLIPS } from "../public/games/fight/spriteAtlasManifest.js";

for (const playerId of ["p1", "p2"]) {
  test(`${playerId} move sheets exist with matching RGBA source grids`, () => {
    for (const sheet of Object.values(FIGHT_MOVE_SHEETS[playerId])) {
      const png = readFileSync(new URL(`../public/games/fight/assets/${sheet.fileName}`, import.meta.url));
      assert.equal(png.subarray(1, 4).toString(), "PNG");
      assert.equal(png.readUInt32BE(16), sheet.columns * sheet.cellSize);
      assert.equal(png.readUInt32BE(20), sheet.rows * sheet.cellSize);
      assert.equal(png[25], 6, "PNG must have a real alpha channel");
    }
  });

  test(`${playerId} every authored move has a unique real atlas sequence`, () => {
    const sequences = new Set();
    for (const [clipId, clip] of Object.entries(FIGHT_MOVE_CLIPS[playerId])) {
      assert.equal(clip.frameCount, 8);
      assert.equal(clip.frameFeetY.length, 8);
      assert.ok(clip.frameFeetY.every(value => Number.isFinite(value) && value > 0));
      const sheet = FIGHT_MOVE_SHEETS[playerId][clip.sheet];
      assert.ok(clip.startFrame + clip.frameCount <= sheet.columns * sheet.rows);
      sequences.add(`${clip.sheet}:${clip.startFrame}`);
    }
    assert.equal(sequences.size, 15, "idle, run and death must join the same character art family as combat");
  });
}
