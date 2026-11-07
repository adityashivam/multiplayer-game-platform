import test from "node:test";
import assert from "node:assert/strict";
import * as spritePresentation from "../public/games/fight/spritePresentation.js";
import { FIGHT_MOVE_CLIPS, FIGHT_MOVE_SHEETS } from "../public/games/fight/spriteAtlasManifest.js";

test("per-frame source pivots pin feet and horizontal corrections after body-size normalization", () => {
  const spriteGeometry = {
    cellSize: 256,
    feetY: 200,
    originalFeetY: 122,
    normalizedScale: 0.5,
    frameFeetY: [200, 210],
    frameOffsetsX: [0, -12],
  };
  const originalGeometry = structuredClone(spriteGeometry);

  assert.deepEqual(spritePresentation.calculateFightSpritePlacement(spriteGeometry, 1), {
    scaleX: 1.5625,
    scaleY: 1.5625,
    offsetX: -18.75,
    offsetY: -240.125,
  });
  assert.deepEqual(spriteGeometry, originalGeometry);
  assert.deepEqual(spritePresentation.calculateFightSpritePlacement(spriteGeometry, 0), {
    scaleX: 1.5625,
    scaleY: 1.5625,
    offsetX: 0,
    offsetY: -224.5,
  });
});

test("missing frame pivots use the named clip pivot without borrowing another clip's offsets", () => {
  assert.deepEqual(spritePresentation.calculateFightSpritePlacement({
    cellSize: 400,
    feetY: 300,
    originalFeetY: 128,
    normalizedScale: 0.75,
  }, 6), {
    scaleX: 1.5,
    scaleY: 1.5,
    offsetX: 0,
    offsetY: -138,
  });
});

test("move clips route to different authored atlas rows instead of sharing attack playback", () => {
  const expectedFrames = { light: 3, light2: 11, finisher: 19, heavy: 27, sweep: 3, launcher: 11, aerial: 19, special: 27 };
  const selectedSequences = new Set();

  for (const [clipId, expectedFrame] of Object.entries(expectedFrames)) {
    const spriteFrame = spritePresentation.readFightSpriteFrame("p1", clipId, 3);
    assert.equal(spriteFrame.frame, expectedFrame);
    selectedSequences.add(`${spriteFrame.spriteName}:${spriteFrame.frame}`);
  }
  assert.equal(selectedSequences.size, 8);
});

test("mobility, guard and landing choose their authored rows and bound local frame indices", () => {
  assert.equal(spritePresentation.readFightSpriteFrame("p2", "jump", 6).frame, 6);
  assert.equal(spritePresentation.readFightSpriteFrame("p2", "landing", 0).frame, 7);
  assert.equal(spritePresentation.readFightSpriteFrame("p2", "slide", 3).frame, 11);
  assert.equal(spritePresentation.readFightSpriteFrame("p2", "dodge", 3).frame, 19);
  assert.equal(spritePresentation.readFightSpriteFrame("p2", "guard", 3).frame, 27);
  assert.equal(spritePresentation.readFightSpriteFrame("p2", "slide", -1).frame, 8);
  assert.equal(spritePresentation.readFightSpriteFrame("p2", "heavy", 100).frame, 31);
  assert.notEqual(
    spritePresentation.readFightSpriteFrame("p1", "heavy", 3).spriteName,
    spritePresentation.readFightSpriteFrame("p2", "heavy", 3).spriteName,
  );
});

test("idle, run and death select matching character artwork and complete eight-frame sequences", () => {
  assert.deepEqual(spritePresentation.readFightSpriteFrame("p1", "idle", 7), { spriteName: "moves-player1-locomotion-v4", frame: 7 });
  assert.deepEqual(spritePresentation.readFightSpriteFrame("p2", "idle", 7), { spriteName: "moves-player2-locomotion-v4", frame: 7 });
  assert.deepEqual(spritePresentation.readFightSpriteFrame("p2", "run", 4), { spriteName: "moves-player2-locomotion-v4", frame: 12 });
  assert.deepEqual(spritePresentation.readFightSpriteFrame("p1", "death", 10), { spriteName: "moves-player1-locomotion-v4", frame: 23 });
});

test("every fighter's authored clip placement uses its own scale and measured frame pivots", () => {
  for (const playerId of ["p1", "p2"]) {
    const originalFeetOffset = playerId === "p1" ? -312 : -288;
    for (const [clipId, moveClip] of Object.entries(FIGHT_MOVE_CLIPS[playerId])) {
      const moveSheet = FIGHT_MOVE_SHEETS[playerId][moveClip.sheet];
      for (let localFrame = 0; localFrame < moveClip.frameCount; localFrame += 1) {
        const spritePlacement = spritePresentation.readFightSpritePlacement(playerId, clipId, localFrame);
        const sourceFeetY = moveClip.frameFeetY?.[localFrame] ?? moveClip.feetY;
        assert.ok(Math.abs(spritePlacement.scaleX - 800 / moveSheet.cellSize * moveClip.normalizedScale) < 1e-9);
        assert.ok(Math.abs(spritePlacement.offsetY + (sourceFeetY - moveSheet.cellSize) * spritePlacement.scaleY - originalFeetOffset) < 1e-9);
        assert.equal(spritePlacement.offsetX, (moveClip.frameOffsetsX?.[localFrame] ?? 0) * spritePlacement.scaleX);
      }
    }
  }
});

test("running keeps a fixed floor pivot so a tucked stride is not dragged down", () => {
  for (const playerId of ["p1", "p2"]) {
    const initialPlacement = spritePresentation.readFightSpritePlacement(playerId, "run", 0);
    for (let frame = 1; frame < 8; frame++) {
      assert.deepEqual(spritePresentation.readFightSpritePlacement(playerId, "run", frame), initialPlacement);
    }
  }
});
