import test from "node:test";
import assert from "node:assert/strict";
import { EDGEOUT_INPUT_TEMPLATE, EDGEOUT_NUMERIC_INPUTS } from "../public/games/edgeout/shared/config.js";
import { getEdgeoutArenaHalfExtent } from "../public/games/edgeout/shared/arena.js";
import { createEdgeoutBotBrain, decideEdgeoutBotInput } from "../public/games/edgeout/shared/bot.js";
import { createEdgeoutMatch, listEdgeoutFighters, stepEdgeoutFighter, stepEdgeoutWorld } from "../public/games/edgeout/shared/simulation.js";

const DT_SEC = 1 / 60;

function createPractice() {
  const match = createEdgeoutMatch({ playerIds: ["p1"], botIds: ["cpu"] });
  Object.assign(match, { started: true, phase: "playing" });
  match.players.p1.connected = true;
  return match;
}

/** Run the server's system order: human input, bot decision, then the world. */
function runPractice(match, brain, ticks, humanInput = () => EDGEOUT_INPUT_TEMPLATE) {
  const fighters = [];
  const decisions = [];
  for (let tick = 0; tick < ticks && !match.gameOver; tick += 1) {
    const active = match.phase === "playing";
    stepEdgeoutFighter(match.players.p1, humanInput(tick), DT_SEC, { active, intactRings: match.arena.intactRings });
    if (active) {
      const input = decideEdgeoutBotInput(match.bots[0], brain, match, listEdgeoutFighters(match, fighters), DT_SEC);
      decisions.push({ ...input });
      stepEdgeoutFighter(match.bots[0], input, DT_SEC, { active, intactRings: match.arena.intactRings });
    }
    stepEdgeoutWorld(match, DT_SEC);
  }
  return decisions;
}

test("the same seed replays the same bot decisions", () => {
  const first = runPractice(createPractice(), createEdgeoutBotBrain(11), 600);
  const second = runPractice(createPractice(), createEdgeoutBotBrain(11), 600);
  const otherSeed = runPractice(createPractice(), createEdgeoutBotBrain(12), 600);
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, otherSeed);
});

test("bot inputs always satisfy the advertised input contract", () => {
  for (const decision of runPractice(createPractice(), createEdgeoutBotBrain(3), 1800)) {
    assert.deepEqual(Object.keys(decision).sort(), Object.keys(EDGEOUT_INPUT_TEMPLATE).sort());
    for (const [field, range] of Object.entries(EDGEOUT_NUMERIC_INPUTS)) {
      assert.ok(Number.isFinite(decision[field]) && decision[field] >= range.min && decision[field] <= range.max, `${field} in range`);
    }
    for (const field of ["shove", "dash", "block"]) assert.equal(typeof decision[field], "boolean");
  }
});

test("the bot retreats from an edge before engaging", () => {
  const match = createPractice();
  const edge = getEdgeoutArenaHalfExtent(match.arena.intactRings) - 0.4;
  Object.assign(match.bots[0], { x: edge, z: 0 });
  Object.assign(match.players.p1, { x: edge, z: 3 });
  const input = decideEdgeoutBotInput(match.bots[0], createEdgeoutBotBrain(1), match, listEdgeoutFighters(match), DT_SEC);
  assert.ok(input.moveX < -0.5, `moves back toward the centre, got ${input.moveX}`);
});

test("the bot is a real opponent: it rings out a passive human", () => {
  const match = createPractice();
  runPractice(match, createEdgeoutBotBrain(5), 60 * 30);
  assert.ok(match.bots[0].roundWins >= 1, "the CPU wins at least one round in thirty seconds");
  assert.ok(match.players.p1.hitSerial > 0, "it lands shoves");
});
