import test from "node:test";
import assert from "node:assert/strict";
import {
  advanceLudoRound,
  applyLudoMove,
  applyLudoRoll,
  createLudoRound,
  getLegalLudoTokenIndices,
  getLudoTokenCell,
  isLudoEntryEligible,
} from "../public/games/ludo/shared/rules.js";

function createPlayingRound(options) {
  const state = createLudoRound(options);
  state.started = true;
  state.turnEndsAtMs = 40000;
  return state;
}

function rollAndChoose(state, diceValue, nowMs = 1000) {
  assert.equal(applyLudoRoll(state, state.currentPlayerId, diceValue, nowMs), true);
  advanceLudoRound(state, nowMs + 1050);
  return nowMs + 1050;
}

test("Ludo creates opposite human seats and maps yard, ring and exact home cells", () => {
  const state = createLudoRound();
  assert.deepEqual(state.playerIds, ["p1", "p2"]);
  assert.equal(state.players.p1.color, "red");
  assert.equal(state.players.p2.color, "yellow");
  assert.deepEqual(state.players.p1.tokens, [-1, -1, -1, -1]);
  assert.equal(state.started, false);
  assert.deepEqual(getLudoTokenCell("red", 0, 0), { column: 1, row: 6 });
  assert.deepEqual(getLudoTokenCell("red", 50, 0), { column: 0, row: 7 });
  assert.deepEqual(getLudoTokenCell("red", 51, 0), { column: 1, row: 7 });
  assert.deepEqual(getLudoTokenCell("red", 56, 0), { column: 6, row: 7 });
  assert.deepEqual(getLudoTokenCell("yellow", 0, 0), { column: 13, row: 8 });
  assert.deepEqual(getLudoTokenCell("red", -1, 2), { column: 1.9, row: 4.1 });
  const fourPlayerRound = createLudoRound({ playerIds: ["p1", "p2", "p3", "p4"] });
  assert.deepEqual(Object.values(fourPlayerRound.players).map((player) => player.color), ["red", "yellow", "green", "blue"]);
  assert.throws(() => createLudoRound({ playerIds: ["p1", "intruder"] }), TypeError);
  assert.throws(() => createLudoRound({ playerIds: ["p1", "p1"] }), TypeError);
  assert.throws(() => createLudoRound({ playerIds: ["p1"] }), TypeError);
});

test("Ludo reveals a server roll before offering yard release and locks movement until landing", () => {
  const state = createPlayingRound();
  assert.equal(applyLudoRoll(state, "p1", 6, 1000), true);
  assert.equal(state.phase, "rolling");
  assert.equal(state.diceValue, 6);
  assert.equal(state.phaseEndsAtMs, 2050);
  assert.deepEqual(state.legalTokenIndices, []);
  assert.equal(applyLudoMove(state, "p1", 0, 1500), false);
  advanceLudoRound(state, 2049);
  assert.equal(state.phase, "rolling");
  advanceLudoRound(state, 2050);
  assert.equal(state.phase, "choose");
  assert.deepEqual(state.legalTokenIndices, [0, 1, 2, 3]);
  assert.equal(state.turnEndsAtMs, 32050);
  assert.equal(applyLudoMove(state, "p1", 0, 2200), true);
  assert.equal(state.players.p1.tokens[0], 0);
  assert.equal(state.phase, "moving");
  assert.equal(state.lastAction.durationMs, 395);
  assert.equal(state.lastAction.from, -1);
  assert.equal(state.lastAction.to, 0);
  assert.equal(applyLudoMove(state, "p1", 1, 2200), false);
  advanceLudoRound(state, 2594);
  assert.equal(state.phase, "moving");
  advanceLudoRound(state, 2595);
  assert.equal(state.phase, "roll");
  assert.equal(state.currentPlayerId, "p1");
});

test("Ludo passes an unusable roll after its brief message and the third six forfeits", () => {
  const state = createPlayingRound();
  rollAndChoose(state, 2);
  assert.equal(state.phase, "pass");
  assert.deepEqual(state.legalTokenIndices, []);
  advanceLudoRound(state, 2899);
  assert.equal(state.currentPlayerId, "p1");
  advanceLudoRound(state, 2900);
  assert.equal(state.currentPlayerId, "p2");
  assert.equal(state.phase, "roll");

  state.currentPlayerId = "p1";
  state.consecutiveSixes = 2;
  rollAndChoose(state, 6, 4000);
  assert.equal(state.phase, "pass");
  assert.equal(state.lastAction.kind, "pass");
  assert.deepEqual(state.players.p1.tokens, [-1, -1, -1, -1]);
  advanceLudoRound(state, 5900);
  assert.equal(state.currentPlayerId, "p2");
  assert.equal(state.consecutiveSixes, 0);
});

test("Ludo requires exact home entry and celebrates the last finish before declaring its winner", () => {
  const state = createPlayingRound();
  state.players.p1.tokens = [54, 56, 56, 56];
  assert.deepEqual(getLegalLudoTokenIndices(state, "p1", 3), []);
  assert.deepEqual(getLegalLudoTokenIndices(state, "p1", 2), [0]);
  const nowMs = rollAndChoose(state, 2);
  assert.equal(applyLudoMove(state, "p1", 0, nowMs), true);
  assert.equal(state.players.p1.tokens[0], 56);
  assert.equal(state.players.p1.finished, 4);
  assert.equal(state.lastAction.kind, "finish");
  assert.equal(state.gameOver, false);
  advanceLudoRound(state, nowMs + 539);
  assert.equal(state.gameOver, false);
  advanceLudoRound(state, nowMs + 540);
  assert.equal(state.phase, "finished");
  assert.equal(state.gameOver, true);
  assert.equal(state.winner, "p1");
  assert.equal(state.players.p1.seriesWins, 1);
  advanceLudoRound(state, nowMs + 10000);
  assert.equal(state.players.p1.seriesWins, 1);
});

test("Ludo captures a lone opponent on an unsafe cell and grants another roll", () => {
  const state = createPlayingRound();
  state.players.p1.tokens[0] = 4;
  state.players.p2.tokens[0] = 33;
  const nowMs = rollAndChoose(state, 3);
  assert.equal(applyLudoMove(state, "p1", 0, nowMs), true);
  assert.equal(state.players.p1.tokens[0], 7);
  assert.equal(state.players.p2.tokens[0], -1);
  assert.equal(state.players.p1.captures, 1);
  assert.equal(state.lastAction.kind, "capture");
  assert.equal(state.lastAction.capturedPlayerId, "p2");
  assert.equal(state.lastAction.capturedTokenIndex, 0);
  advanceLudoRound(state, nowMs + 685);
  assert.equal(state.phase, "roll");
  assert.equal(state.currentPlayerId, "p1");
});

test("Ludo safe stars allow shared occupancy without capture or an opponent blockade", () => {
  const state = createPlayingRound();
  state.players.p1.tokens = [5, 8, 8, -1];
  state.players.p2.tokens = [34, 34, -1, -1];
  assert.deepEqual(getLegalLudoTokenIndices(state, "p1", 3), [0, 1, 2]);
  const nowMs = rollAndChoose(state, 3);
  applyLudoMove(state, "p1", 0, nowMs);
  assert.deepEqual(state.players.p2.tokens, [34, 34, -1, -1]);
  assert.equal(state.players.p1.captures, 0);
  assert.equal(state.lastAction.kind, "move");
  advanceLudoRound(state, nowMs + 685);
  assert.equal(state.currentPlayerId, "p2");
});

test("Ludo opponent blockades stop crossing and landing while own unsafe stacks cannot exceed two", () => {
  const state = createPlayingRound();
  state.players.p1.tokens = [4, 56, 56, 56];
  state.players.p2.tokens = [33, 33, -1, -1];
  assert.deepEqual(getLegalLudoTokenIndices(state, "p1", 2), [0]);
  assert.deepEqual(getLegalLudoTokenIndices(state, "p1", 3), []);
  assert.deepEqual(getLegalLudoTokenIndices(state, "p1", 6), []);

  state.players.p2.tokens = [-1, -1, -1, -1];
  state.players.p1.tokens = [4, 7, 7, -1];
  assert.deepEqual(getLegalLudoTokenIndices(state, "p1", 3), [1, 2]);
  assert.deepEqual(getLegalLudoTokenIndices(state, "p1", 4), [0, 1, 2]);
  state.players.p1.tokens = [51, 53, 53, -1];
  assert.deepEqual(getLegalLudoTokenIndices(state, "p1", 2), [1, 2]);
});

test("Ludo decision timeouts pass rather than awarding a six bonus and inactive rounds never advance", () => {
  const state = createPlayingRound();
  const nowMs = rollAndChoose(state, 6);
  assert.equal(applyLudoMove(state, "p1", 0, nowMs + 30000), false);
  advanceLudoRound(state, nowMs + 30000);
  assert.equal(state.phase, "pass");
  advanceLudoRound(state, nowMs + 30850);
  assert.equal(state.currentPlayerId, "p2");
  assert.equal(state.consecutiveSixes, 0);
  state.started = false;
  const pausedState = structuredClone(state);
  advanceLudoRound(state, nowMs + 100000);
  assert.deepEqual(state, pausedState);
});

test("Ludo preserves the last real die through repeated unrolled turn timeouts", () => {
  const state = createPlayingRound();
  rollAndChoose(state, 4, 1000);
  advanceLudoRound(state, 2900);
  assert.equal(state.currentPlayerId, "p2");
  assert.equal(state.diceValue, 0);
  assert.equal(state.lastAction.diceValue, 4);

  for (const expectedPlayerId of ["p1", "p2"]) {
    const timeoutAtMs = state.turnEndsAtMs;
    advanceLudoRound(state, timeoutAtMs);
    assert.equal(state.phase, "pass");
    assert.equal(state.lastAction.diceValue, 4, "passing without a roll must not replace the visible die result");
    advanceLudoRound(state, timeoutAtMs + 850);
    assert.equal(state.currentPlayerId, expectedPlayerId);
    assert.equal(state.diceValue, 0);
    assert.equal(state.lastAction.diceValue, 4);
  }

  assert.equal(createLudoRound().lastAction.diceValue, 0, "a fresh board starts without a result");
});

test("Ludo rejects malformed, late and wrong-owner actions without changing its revision or board", () => {
  const state = createPlayingRound();
  const beforeRoll = structuredClone(state);
  for (const diceValue of [0, 7, 1.5, NaN, "6"]) {
    assert.equal(applyLudoRoll(state, "p1", diceValue, 1000), false);
  }
  assert.equal(applyLudoRoll(state, "p2", 6, 1000), false);
  assert.equal(applyLudoRoll(state, "p1", 6, 40000), false);
  assert.deepEqual(state, beforeRoll);
  const nowMs = rollAndChoose(state, 6);
  const beforeMove = structuredClone(state);
  for (const tokenIndex of [-1, 4, 1.2, "0", null]) {
    assert.equal(applyLudoMove(state, "p1", tokenIndex, nowMs), false);
  }
  assert.equal(applyLudoMove(state, "p2", 0, nowMs), false);
  assert.deepEqual(state, beforeMove);
});

test("Ludo bounded deterministic playthroughs finish with conserved tokens and legal progress", () => {
  for (const playerIds of [["p1", "p2"], ["p1", "p2", "p3"], ["p1", "p2", "p3", "p4"]]) {
    const state = createPlayingRound({ playerIds });
    let randomSeed = 121;
    let nowMs = 1000;
    for (let actionIndex = 0; actionIndex < 18000 && !state.gameOver; actionIndex += 1) {
      if (state.phase === "roll") {
        randomSeed = (randomSeed * 1664525 + 1013904223) >>> 0;
        const diceValue = 1 + (randomSeed % 6);
        assert.equal(applyLudoRoll(state, state.currentPlayerId, diceValue, nowMs), true);
      } else if (state.phase === "choose") {
        const legalIndices = getLegalLudoTokenIndices(state, state.currentPlayerId);
        assert.ok(legalIndices.length > 0);
        assert.equal(applyLudoMove(state, state.currentPlayerId, legalIndices[0], nowMs), true);
      } else {
        nowMs = state.phaseEndsAtMs;
        advanceLudoRound(state, nowMs);
      }
      for (const playerState of Object.values(state.players)) {
        assert.equal(playerState.tokens.length, 4);
        assert.ok(playerState.tokens.every((progress) => Number.isInteger(progress) && progress >= -1 && progress <= 56));
        assert.equal(playerState.finished, playerState.tokens.filter((progress) => progress === 56).length);
      }
      nowMs += 1;
    }
    assert.equal(state.gameOver, true);
    assert.equal(state.players[state.winner].finished, 4);
  }
});

test("Ludo never forces a six after previous entry misses for any configured seat", () => {
  for (const playerIds of [["p1", "p2"], ["p1", "p2", "p3"], ["p1", "p2", "p3", "p4"]]) {
    const state = createPlayingRound({ playerIds });
    let nowMs = 1000;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      for (const playerId of playerIds) {
        assert.equal(state.currentPlayerId, playerId);
        assert.equal(applyLudoRoll(state, playerId, 4, nowMs), true);
        assert.equal(state.diceValue, 4, "previous misses never replace an authoritative random result");
        assert.equal(state.lastAction.diceValue, 4);
        advanceLudoRound(state, state.phaseEndsAtMs);
        assert.equal(state.phase, "pass");
        nowMs = state.phaseEndsAtMs;
        advanceLudoRound(state, nowMs);
        nowMs += 1;
      }
    }
  }
});

test("Ludo preserves each authoritative face in yard, track and home-lane states", () => {
  for (const progress of [-1, 0, 25, 51, 55]) {
    for (let diceValue = 1; diceValue <= 6; diceValue += 1) {
      const state = createPlayingRound();
      state.players.p1.tokens = [progress, -1, -1, 56];
      // A retained pre-upgrade counter cannot force a result after rejoining.
      state.players.p1.entryMisses = 2;
      assert.equal(applyLudoRoll(state, "p1", diceValue, 1000), true);
      assert.equal(state.diceValue, diceValue);
    }
  }
});

test("Ludo entry odds apply to yard pieces with finished teammates and exclude active home lanes", () => {
  const player = createPlayingRound().players.p1;
  for (const [tokens, expectedEligibility] of [
    [[-1, -1, -1, -1], true],
    [[-1, 56, 56, 56], true],
    [[0, -1, -1, -1], false],
    [[51, -1, 56, 56], false],
    [[55, -1, 56, 56], false],
    [[56, 56, 56, 56], false],
  ]) {
    assert.equal(isLudoEntryEligible({ ...player, tokens }), expectedEligibility);
  }
});
