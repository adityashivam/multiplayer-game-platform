import test from "node:test";
import assert from "node:assert/strict";
import { createPongCourtView, isPortraitPongHost } from "../public/games/pong/client/courtView.js";

const ARENA = { arenaWidth: 1280, arenaHeight: 720 };

test("a landscape court draws arena coordinates unchanged and keeps the old key mapping", () => {
  const view = createPongCourtView({ portrait: false, ...ARENA });
  assert.deepEqual([view.width, view.height], [1280, 720]);
  assert.deepEqual(view.toView(70, 300, "p1"), { x: 70, y: 300 });
  assert.equal(view.readPaddleDirection("left", "p1"), "up");
  assert.equal(view.readPaddleDirection("right", "p2"), "down");
  assert.equal(view.readEndLabel("p1", "p2"), "Left");
});

test("an upright court puts each viewer's own paddle at the bottom", () => {
  const view = createPongCourtView({ portrait: true, ...ARENA });
  assert.deepEqual([view.width, view.height], [720, 1280]);
  const p1Own = view.toView(70, 360, "p1");
  const p2Own = view.toView(1210, 360, "p2");
  assert.ok(p1Own.y > 1100 && p2Own.y > 1100, "each player sees their own end at the bottom");
  assert.ok(view.toView(1210, 360, "p1").y < 100, "the opponent is at the top");
  assert.equal(view.readEndLabel("p2", "p2"), "Bottom");
  assert.equal(view.readEndLabel("p1", "p2"), "Top");
});

test("upright, a sideways push moves the paddle the way it looks on screen", () => {
  const view = createPongCourtView({ portrait: true, ...ARENA });
  for (const viewerId of ["p1", "p2"]) {
    const arenaY = 360;
    const arenaX = viewerId === "p1" ? 70 : 1210;
    const before = view.toView(arenaX, arenaY, viewerId).x;
    const leftDirection = view.readPaddleDirection("left", viewerId);
    const after = view.toView(arenaX, arenaY + (leftDirection === "up" ? -10 : 10), viewerId).x;
    assert.ok(after < before, `${viewerId}: pushing left moves the paddle left`);
  }
  assert.equal(view.readPaddleDirection("up", "p2"), "up", "after turning back to landscape the stick still moves the paddle");
});

test("upright drawing reuses a supplied point instead of allocating", () => {
  const view = createPongCourtView({ portrait: true, ...ARENA });
  const point = { x: 0, y: 0 };
  assert.equal(view.toView(640, 360, "p1", point), point);
});

test("only a clearly tall host gets the upright court", () => {
  assert.equal(isPortraitPongHost({ width: 390, height: 844 }), true);
  assert.equal(isPortraitPongHost({ width: 844, height: 390 }), false);
  assert.equal(isPortraitPongHost({ width: 600, height: 620 }), false, "a near-square host keeps the classic court");
  assert.equal(isPortraitPongHost(null), false);
});
