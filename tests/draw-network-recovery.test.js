import test from "node:test";
import assert from "node:assert/strict";
import { createDrawBoard } from "../public/games/draw/client/drawBoard.js";

const FIRST_POINT = { x: 0.2, y: 0.3 };
const SECOND_POINT = { x: 0.4, y: 0.5 };

test("Draw preserves immediate local points when its delayed start/move echoes arrive", () => {
  const board = createDrawBoard();
  board.receiveBoard({ clearVersion: 0, revision: 0, strokes: [] });
  board.startStroke({ id: "local", owner: "p1", color: "#38bdf8", size: 4, points: [FIRST_POINT] });
  board.appendPoint("local", SECOND_POINT);
  board.receiveEvent({ action: "start", strokeId: "local", owner: "p1", point: FIRST_POINT, clearVersion: 0, revision: 1 }, "p1");
  board.receiveEvent({ action: "move", strokeId: "local", owner: "p1", point: SECOND_POINT, clearVersion: 0, revision: 2 }, "p1");
  assert.deepEqual(board.getStrokes()[0].points, [FIRST_POINT, SECOND_POINT]);
  assert.equal(board.getRevision(), 2);
});

test("Draw ignores pre-clear events and snapshots while waiting for authoritative clear", () => {
  const board = createDrawBoard();
  board.receiveBoard({ clearVersion: 2, revision: 8, strokes: [] });
  board.clearOptimistically("p1");
  board.receiveEvent({ action: "start", strokeId: "old", owner: "p2", point: FIRST_POINT, clearVersion: 2, revision: 9 }, "p1");
  board.receiveBoard({ clearVersion: 2, revision: 8, strokes: [{ id: "old", owner: "p2", points: [FIRST_POINT] }] });
  assert.equal(board.getStrokes().length, 0);
  assert.equal(board.isWaitingForClear(), true);
  board.receiveEvent({ action: "clear", owner: "p1", clearVersion: 3, revision: 10 }, "p1");
  assert.equal(board.isWaitingForClear(), false);
  board.receiveEvent({ action: "start", strokeId: "stale", owner: "p2", point: FIRST_POINT, clearVersion: 2, revision: 9 }, "p1");
  assert.equal(board.getStrokes().length, 0);
  board.receiveEvent({ action: "start", strokeId: "new", owner: "p2", point: FIRST_POINT, clearVersion: 3, revision: 11 }, "p1");
  assert.equal(board.getStrokes()[0].id, "new");
});

test("a rival's concurrent clear cannot acknowledge the local player's pending clear", () => {
  const board = createDrawBoard();
  board.receiveBoard({ clearVersion: 0, revision: 0, strokes: [] });
  board.clearOptimistically("p1");
  board.receiveEvent({ action: "clear", owner: "p2", clearVersion: 1, revision: 1 }, "p1");
  assert.equal(board.isWaitingForClear(), true);
  board.receiveBoard({ clearVersion: 1, revision: 1, strokes: [] });
  assert.equal(board.isWaitingForClear(), true);
  board.receiveEvent({ action: "clear", owner: "p1", clearVersion: 2, revision: 2 }, "p1");
  assert.equal(board.isWaitingForClear(), false);
  board.startStroke({ id: "after-clear", owner: "p1", points: [FIRST_POINT] });
  board.receiveEvent({ action: "start", owner: "p1", strokeId: "after-clear", point: FIRST_POINT, clearVersion: 2, revision: 3 }, "p1");
  assert.equal(board.getStrokes()[0].id, "after-clear");
});

test("Draw hydrates retained authority after reconnect and rejects duplicate revisions", () => {
  const board = createDrawBoard();
  board.receiveBoard({ clearVersion: 4, revision: 20, strokes: [{ id: "kept", owner: "p1", points: [FIRST_POINT], completed: false }] });
  board.receiveEvent({ action: "move", strokeId: "kept", owner: "p1", point: SECOND_POINT, clearVersion: 4, revision: 19 }, "p2");
  assert.equal(board.getStrokes()[0].points.length, 1);
  board.reset();
  assert.equal(board.isHydrated(), false);
  board.receiveBoard({ clearVersion: 4, revision: 22, strokes: [{ id: "kept", owner: "p1", points: [FIRST_POINT, SECOND_POINT], completed: true }] });
  assert.equal(board.isHydrated(), true);
  assert.equal(board.getStrokes()[0].completed, true);
  assert.equal(board.getStrokes()[0].points.length, 2);
});

test("Draw bounds local and recovered histories to authoritative point limits", () => {
  const board = createDrawBoard();
  board.receiveBoard({ clearVersion: 0, revision: 0, strokes: [] });
  for (let strokeIndex = 0; strokeIndex < 190; strokeIndex += 1) {
    board.startStroke({ id: `stroke-${strokeIndex}`, owner: "p1", points: [FIRST_POINT] });
    for (let pointIndex = 1; pointIndex < 850; pointIndex += 1) {
      board.appendPoint(`stroke-${strokeIndex}`, { x: pointIndex / 1000, y: pointIndex / 1000 });
    }
  }
  const strokes = board.getStrokes();
  assert.ok(strokes.length <= 180);
  assert.ok(strokes.every((stroke) => stroke.points.length <= 800));
  assert.ok(strokes.reduce((count, stroke) => count + stroke.points.length, 0) <= 36000);
});

test("a delayed local echo cannot resurrect a stroke evicted by history limits", () => {
  const board = createDrawBoard();
  board.receiveBoard({ clearVersion: 0, revision: 0, strokes: [] });
  for (let index = 0; index < 181; index += 1) {
    board.startStroke({ id: `stroke-${index}`, owner: "p1", points: [FIRST_POINT] });
    board.endStroke(`stroke-${index}`);
  }
  assert.equal(board.getStrokes()[0].id, "stroke-1");
  board.receiveEvent({ action: "start", strokeId: "stroke-0", owner: "p1", point: FIRST_POINT, clearVersion: 0, revision: 1 }, "p1");
  assert.equal(board.getStrokes()[0].id, "stroke-1");
  assert.equal(board.getStroke("stroke-0"), undefined);
});
