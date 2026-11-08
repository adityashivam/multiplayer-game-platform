import assert from "node:assert/strict";
import test from "node:test";
import { Quaternion, Vector3 } from "three";
import {
  LUDO_DIE_FACES,
  createLudoActionTimeline,
  getLudoDisplayedDieValue,
  getLudoDieOrientation,
  getLudoStackOffset,
} from "../public/games/ludo/rendering/presentation.js";

function createSnapshot(roundId, id, startedAtMs = 1000, kind = "roll") {
  return {
    roundId,
    lastAction: { id, kind, startedAtMs, durationMs: 1050, diceValue: 4 },
  };
}

test("a settled Ludo die exposes the authoritative face on top for all six outcomes", () => {
  for (let value = 1; value <= 6; value += 1) {
    const orientation = new Quaternion(...getLudoDieOrientation(value));
    const topFaces = LUDO_DIE_FACES.filter(({ normal }) => (
      new Vector3(...normal).applyQuaternion(orientation).y > 0.99999
    ));

    assert.deepEqual(topFaces.map((face) => face.value), [value]);

    const bottomFace = LUDO_DIE_FACES.find(({ normal }) => (
      new Vector3(...normal).applyQuaternion(orientation).y < -0.99999
    ));
    assert.equal(bottomFace.value + value, 7);
  }
});

test("shared safe cells keep up to sixteen Ludo pawns distinct and inside their cell", () => {
  for (let count = 1; count <= 16; count += 1) {
    const positions = [];

    for (let index = 0; index < count; index += 1) {
      const position = getLudoStackOffset(index, count);
      assert.ok(Number.isFinite(position.x) && Number.isFinite(position.z));
      assert.ok(Math.abs(position.x) + 0.36 * position.scale <= 0.48);
      assert.ok(Math.abs(position.z) + 0.36 * position.scale <= 0.48);
      assert.deepEqual(getLudoStackOffset(index, count), position);
      positions.push(`${position.x}:${position.z}`);
    }

    assert.equal(new Set(positions).size, count);
  }
});

test("Ludo animation hydration and an expired action snap to the current board", () => {
  const timeline = createLudoActionTimeline();
  assert.equal(timeline.sample(createSnapshot(1, 2), 1200, 100), null);
  assert.equal(timeline.sample(createSnapshot(1, 3), 4000, 200), null);
});

test("ten-Hertz snapshots never restart an active Ludo action", () => {
  const timeline = createLudoActionTimeline();
  timeline.sample(createSnapshot(1, 1), 900, 0);

  const firstFrame = timeline.sample(createSnapshot(1, 2), 1100, 100);
  assert.equal(firstFrame.identity, "1:2");
  assert.equal(firstFrame.elapsedMs, 100);

  const repeatedFrame = timeline.sample(createSnapshot(1, 2), 1200, 200);
  assert.equal(repeatedFrame.elapsedMs, 200);

  const delayedClockFrame = timeline.sample(createSnapshot(1, 2), 1150, 300);
  assert.equal(delayedClockFrame.elapsedMs, 300);

  assert.equal(timeline.sample(createSnapshot(1, 2), 2100, 1100), null);
  assert.equal(timeline.sample(createSnapshot(1, 2), 2150, 1200), null);
});

test("a new round and reduced motion never replay a previous Ludo action", () => {
  const timeline = createLudoActionTimeline();
  timeline.sample(createSnapshot(1, 4), 900, 0);
  assert.ok(timeline.sample(createSnapshot(1, 5), 1100, 100));
  assert.equal(timeline.sample(createSnapshot(2, 1), 1200, 200), null);
  assert.equal(timeline.sample(createSnapshot(2, 2), 1300, 300, true), null);
  assert.equal(timeline.sample(createSnapshot(2, 2), 1400, 400, false), null);
});

test("late older action identities cannot replay a newer Ludo move", () => {
  const timeline = createLudoActionTimeline();
  timeline.sample(createSnapshot(1, 9), 900, 0);
  assert.equal(timeline.sample(createSnapshot(1, 8), 1100, 100), null);
  assert.ok(timeline.sample(createSnapshot(1, 10), 1100, 100));
  assert.equal(timeline.sample(createSnapshot(1, 8), 1200, 200).identity, "1:10");
});

test("a loading board cannot make the first recovered authoritative action animate", () => {
  const timeline = createLudoActionTimeline();
  timeline.sample({ ...createSnapshot(1, 0), started: false }, 900, 0);
  assert.equal(timeline.sample({ ...createSnapshot(1, 6), started: true }, 1100, 100), null);
  assert.ok(timeline.sample({ ...createSnapshot(1, 7), started: true }, 1200, 200));
});

test("an explicit Ludo presentation reset accepts a recreated room's action IDs", () => {
  const timeline = createLudoActionTimeline();
  timeline.sample({ ...createSnapshot(1, 20), started: true }, 900, 0);
  timeline.sample({ ...createSnapshot(1, 0), started: false }, 1000, 100);
  timeline.sample({ ...createSnapshot(1, 0), started: true }, 1000, 100);
  assert.equal(timeline.sample({ ...createSnapshot(1, 1), started: true }, 1100, 200), null);
  assert.equal(typeof timeline.reset, "function");

  timeline.reset();
  assert.equal(timeline.sample({ ...createSnapshot(1, 0), started: true }, 1000, 300), null);
  assert.equal(timeline.sample({ ...createSnapshot(1, 1), started: true }, 1100, 400).identity, "1:1");
});

test("a new Ludo turn preserves the last authoritative die face until the next roll", () => {
  for (let value = 1; value <= 6; value += 1) {
    assert.equal(getLudoDisplayedDieValue({ diceValue: 0, lastAction: { diceValue: value } }), value);
  }

  assert.equal(getLudoDisplayedDieValue({ diceValue: 3, lastAction: { diceValue: 6 } }), 3);
  assert.equal(getLudoDisplayedDieValue({ diceValue: 0, lastAction: { diceValue: 0 } }), 1);
});
