import test from "node:test";
import assert from "node:assert/strict";
import { rollLudoDie } from "../server/platform-backend-engine/games/ludoDice.js";

test("Ludo entry dice give six one-third of the random outcomes and retain all other faces", () => {
  const outcomeCounts = [0, 0, 0, 0, 0, 0];
  for (let ticket = 0; ticket < 15; ticket += 1) {
    const face = rollLudoDie({
      entryBoosted: true,
      drawRandomInt(minimum, maximum) {
        assert.equal(minimum, 0);
        assert.equal(maximum, 15);
        return ticket;
      },
    });
    outcomeCounts[face - 1] += 1;
  }
  assert.deepEqual(outcomeCounts, [2, 2, 2, 2, 2, 5]);
});

test("Ludo ordinary dice keep six equally likely faces", () => {
  const outcomes = [];
  for (let ticket = 0; ticket < 6; ticket += 1) {
    outcomes.push(rollLudoDie({
      entryBoosted: false,
      drawRandomInt(minimum, maximum) {
        assert.equal(minimum, 0);
        assert.equal(maximum, 6);
        return ticket;
      },
    }));
  }
  assert.deepEqual(outcomes, [1, 2, 3, 4, 5, 6]);
});

test("Ludo entry samples have no history-dependent or forced outcome", () => {
  let draws = 0;
  const outcomes = Array.from({ length: 30 }, () => rollLudoDie({
    entryBoosted: true,
    drawRandomInt() {
      draws += 1;
      return 0;
    },
  }));
  assert.equal(draws, 30, "every requested die draws fresh server entropy");
  assert.deepEqual(outcomes, Array(30).fill(1), "even a long run never forces a six");
});

test("Ludo dice reject invalid entropy rather than emitting an invalid face", () => {
  for (const ticket of [-1, 15, 1.5, NaN]) {
    assert.throws(() => rollLudoDie({ entryBoosted: true, drawRandomInt: () => ticket }), RangeError);
  }
});
