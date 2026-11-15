import test from "node:test";
import assert from "node:assert/strict";
import {
  GAME_MENU_CORNER_INSET_PX,
  readGameMenuPosition,
  resolveGameMenuCornerInsets,
  saveGameMenuPosition,
  snapGameMenuPosition,
} from "../public/platform/src/platform-ui/services/gameMenuPosition.js";

function createMemoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    values,
  };
}

test("the menu starts in the top-left corner", () => {
  assert.deepEqual(readGameMenuPosition("pong", createMemoryStorage()), { side: "left", y: 0 });
});

test("a dragged spot is remembered per game", () => {
  const storage = createMemoryStorage();
  saveGameMenuPosition("pong", { side: "right", y: 0.4 }, storage);
  assert.deepEqual(readGameMenuPosition("pong", storage), { side: "right", y: 0.4 });
  assert.deepEqual(readGameMenuPosition("fight", storage), { side: "left", y: 0 });
});

test("broken or blocked storage falls back to the default spot", () => {
  const storage = createMemoryStorage();
  storage.setItem("platform.game-menu-position.v1:pong", "{not json");
  assert.deepEqual(readGameMenuPosition("pong", storage), { side: "left", y: 0 });
  storage.setItem("platform.game-menu-position.v1:pong", JSON.stringify({ side: "middle", y: 7 }));
  assert.deepEqual(readGameMenuPosition("pong", storage), { side: "left", y: 0 });
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.deepEqual(readGameMenuPosition("pong", blocked), { side: "left", y: 0 });
  assert.doesNotThrow(() => saveGameMenuPosition("pong", { side: "right", y: 0.5 }, blocked));
  assert.deepEqual(readGameMenuPosition("pong", undefined), { side: "left", y: 0 });
});

test("a drop snaps to the nearer side and keeps its height", () => {
  assert.deepEqual(snapGameMenuPosition({ x: 100, y: 200, width: 800, height: 400, size: 40 }), { side: "left", y: 0.5 });
  assert.deepEqual(snapGameMenuPosition({ x: 600, y: 0, width: 800, height: 400, size: 40 }), { side: "right", y: 0 });
  assert.deepEqual(snapGameMenuPosition({ x: 600, y: -50, width: 800, height: 400, size: 40 }), { side: "right", y: 0 }, "dragging above the top clamps");
  assert.deepEqual(snapGameMenuPosition({ x: 600, y: 900, width: 800, height: 400, size: 40 }), { side: "right", y: 1 });
});

test("only the top corner the menu sits in is reserved for game HUDs", () => {
  const reserve = GAME_MENU_CORNER_INSET_PX.reserve;
  assert.deepEqual(resolveGameMenuCornerInsets({ side: "left", y: 0 }, 400), { left: reserve, right: 0 });
  assert.deepEqual(resolveGameMenuCornerInsets({ side: "right", y: 0.05 }, 400), { left: 0, right: reserve });
  assert.deepEqual(resolveGameMenuCornerInsets({ side: "left", y: 0.5 }, 400), { left: 0, right: 0 }, "a menu halfway down frees the corner");
});
