import assert from "node:assert/strict";
import test from "node:test";
import { createLudoClientState } from "../public/games/ludo/client/ludoClientState.js";
import { getLudoDisplayedDiceValue, getLudoTurnPresentation } from "../public/games/ludo/client/ludoHud.js";

/** A complete, hand-authored two-player choice snapshot. */
function createChoiceSnapshot(overrides = {}) {
  return {
    roundId: 1,
    revision: 4,
    playerIds: ["p1", "p2"],
    players: {
      p1: { id: "p1", color: "red", tokens: [0, 5, -1, -1], connected: true, finished: 0, captures: 0, seriesWins: 0 },
      p2: { id: "p2", color: "yellow", tokens: [-1, -1, -1, -1], connected: true, finished: 0, captures: 0, seriesWins: 0 },
    },
    started: true,
    startAt: null,
    gameOver: false,
    winner: null,
    currentPlayerId: "p1",
    phase: "choose",
    diceValue: 3,
    rollSerial: 1,
    consecutiveSixes: 0,
    legalTokenIndices: [0, 1],
    phaseEndsAtMs: 0,
    turnEndsAtMs: 40000,
    lastMessage: "Choose a piece.",
    lastAction: { id: 1, kind: "roll", playerId: "p1", tokenIndex: null, from: -1, to: -1, diceValue: 3, startedAtMs: 9000, durationMs: 1050, capturedPlayerId: null, capturedTokenIndex: null },
    net: { seq: 1, serverTime: 10000 },
    ...overrides,
  };
}

test("Ludo sends one revision-bound move and waits through repeated snapshots", () => {
  const clientState = createLudoClientState();
  const serverSnapshot = createChoiceSnapshot();
  clientState.recordJoined("p1");
  clientState.recordSnapshot(serverSnapshot, 100);

  assert.deepEqual(clientState.beginCommand("move", 1, 110), { type: "move", roundId: 1, revision: 4, tokenIndex: 1 });
  assert.equal(clientState.beginCommand("move", 0, 111), null);
  clientState.recordSnapshot({ ...serverSnapshot, net: { seq: 2, serverTime: 10100 } }, 200);
  assert.equal(clientState.getView(201).canChoose, false);
  assert.equal(clientState.beginCommand("move", 1, 202), null);

  clientState.recordSnapshot(createChoiceSnapshot({ revision: 5, phase: "moving", legalTokenIndices: [] }), 250);
  assert.equal(clientState.getView(251).pendingAction, null);
  assert.deepEqual(serverSnapshot.players.p1.tokens, [0, 5, -1, -1]);
});

test("Ludo accepts only the current player's legal actions", () => {
  const clientState = createLudoClientState();
  clientState.recordJoined("p1");
  clientState.recordSnapshot(createChoiceSnapshot(), 0);

  assert.equal(clientState.beginCommand("roll", undefined, 1), null);
  assert.equal(clientState.beginCommand("move", 3, 1), null);
  assert.equal(clientState.beginCommand("move", 0.5, 1), null);

  clientState.recordSnapshot(createChoiceSnapshot({ revision: 5, currentPlayerId: "p2" }), 2);
  assert.equal(clientState.getView(2).canChoose, false);
  assert.equal(clientState.beginCommand("move", 0, 3), null);

  clientState.recordSnapshot(createChoiceSnapshot({ revision: 6, phase: "roll", diceValue: 0, legalTokenIndices: [] }), 4);
  assert.deepEqual(clientState.beginCommand("roll", undefined, 5), { type: "roll", roundId: 1, revision: 6 });
  assert.equal(clientState.getView(6).pendingRoll, true);
});

test("Ludo recovers rejected actions after a bounded wait without replaying them", () => {
  const clientState = createLudoClientState({ pendingTimeoutMs: 1000 });
  clientState.recordJoined("p1");
  clientState.recordSnapshot(createChoiceSnapshot(), 0);
  clientState.beginCommand("move", 0, 10);

  assert.equal(clientState.getView(1009).canChoose, false);
  assert.equal(clientState.getView(1010).pendingAction, null);
  assert.equal(clientState.getView(1010).canChoose, true);
  assert.deepEqual(clientState.beginCommand("move", 1, 1011), { type: "move", roundId: 1, revision: 4, tokenIndex: 1 });
});

test("Ludo disconnect and pause clear selection and require a new complete snapshot", () => {
  const clientState = createLudoClientState();
  clientState.recordJoined("p1");
  clientState.recordSnapshot(createChoiceSnapshot(), 0);
  clientState.selectToken(1, 1);
  clientState.beginCommand("move", 1, 2);
  clientState.recordDisconnected();

  assert.equal(clientState.getView(3).selectedTokenIndex, null);
  assert.equal(clientState.getView(3).pendingAction, null);
  assert.equal(clientState.beginCommand("move", 0, 3), null);

  clientState.recordJoined("p1");
  assert.equal(clientState.getView(4).canChoose, false);
  clientState.recordSnapshot(createChoiceSnapshot({ started: false }), 5);
  assert.equal(clientState.getView(5).canChoose, false);
  clientState.recordSnapshot(createChoiceSnapshot({ revision: 5 }), 6);
  assert.equal(clientState.getView(6).canChoose, true);
});

test("Ludo ignores old rounds and revisions, and new rounds release pending actions", () => {
  const clientState = createLudoClientState();
  clientState.recordJoined("p1");
  clientState.recordSnapshot(createChoiceSnapshot(), 0);
  clientState.beginCommand("move", 0, 1);

  assert.equal(clientState.recordSnapshot(createChoiceSnapshot({ revision: 3 }), 2), false);
  assert.equal(clientState.getView(2).snapshot.revision, 4);
  assert.equal(clientState.recordSnapshot(createChoiceSnapshot({ roundId: 2, revision: 0, phase: "roll", diceValue: 0, legalTokenIndices: [] }), 3), true);
  assert.equal(clientState.getView(3).pendingAction, null);
  assert.equal(clientState.getView(3).selectedTokenIndex, null);
  assert.equal(clientState.recordSnapshot(createChoiceSnapshot({ revision: 100 }), 4), false);
  assert.equal(clientState.getView(4).snapshot.roundId, 2);
});

test("Ludo cycles only legal pieces and keeps the selected piece as snapshots repeat", () => {
  const clientState = createLudoClientState();
  const serverSnapshot = createChoiceSnapshot({ legalTokenIndices: [0, 3] });
  serverSnapshot.players.p1.tokens = [0, -1, -1, 5];
  clientState.recordJoined("p1");
  clientState.recordSnapshot(serverSnapshot, 0);

  assert.equal(clientState.getView(0).selectedTokenIndex, 0);
  assert.equal(clientState.cycleSelection(1, 1), 3);
  assert.equal(clientState.cycleSelection(1, 2), 0);
  assert.equal(clientState.cycleSelection(-1, 3), 3);
  assert.equal(clientState.selectToken(1, 4), false);
  clientState.recordSnapshot(serverSnapshot, 5);
  assert.equal(clientState.getView(5).selectedTokenIndex, 3);
});

test("Ludo estimates server animation time from a monotonic local snapshot anchor", () => {
  const clientState = createLudoClientState();
  clientState.recordJoined("p1");
  clientState.recordSnapshot(createChoiceSnapshot(), 700);

  assert.equal(clientState.getView(950).serverNowMs, 10250);
  clientState.recordSnapshot(createChoiceSnapshot({ net: { seq: 2, serverTime: 10100 } }), 1000);
  assert.equal(clientState.getView(1250).serverNowMs, 10350);
});

test("Ludo rejects incomplete or unbounded snapshots before enabling controls", () => {
  const clientState = createLudoClientState();
  clientState.recordJoined("p1");

  assert.equal(clientState.recordSnapshot({ roundId: 1, revision: 0 }, 0), false);
  assert.equal(clientState.recordSnapshot(createChoiceSnapshot({ legalTokenIndices: [0, 1, 2, 3, 4] }), 0), false);
  assert.equal(clientState.recordSnapshot(createChoiceSnapshot({ players: { p1: {} } }), 0), false);
  assert.equal(clientState.getView(1).canChoose, false);
});

test("Ludo recovers complete legal choices when packed variable lists are sparse or truncated", () => {
  const clientState = createLudoClientState();
  const sparseSnapshot = createChoiceSnapshot({ legalTokenIndices: [undefined, undefined, undefined, undefined] });
  clientState.recordJoined("p1");

  assert.equal(clientState.recordSnapshot(sparseSnapshot, 0), true);
  assert.deepEqual(clientState.getView(0).legalTokenIndices, [0, 1]);
  assert.deepEqual(clientState.getView(0).snapshot.legalTokenIndices, [0, 1]);
  assert.deepEqual(sparseSnapshot.legalTokenIndices, [undefined, undefined, undefined, undefined]);

  const truncatedSnapshot = createChoiceSnapshot({ revision: 5, diceValue: 6, legalTokenIndices: [0] });
  truncatedSnapshot.players.p1.tokens = [-1, -1, -1, -1];
  assert.equal(clientState.recordSnapshot(truncatedSnapshot, 1), true);
  assert.deepEqual(clientState.getView(1).legalTokenIndices, [0, 1, 2, 3]);
});

test("Ludo derives legal choices when the server omits the redundant variable list", () => {
  const clientState = createLudoClientState();
  const serverSnapshot = createChoiceSnapshot();
  delete serverSnapshot.legalTokenIndices;
  clientState.recordJoined("p1");

  assert.equal(clientState.recordSnapshot(serverSnapshot, 0), true);
  assert.deepEqual(clientState.getView(0).legalTokenIndices, [0, 1]);
  assert.deepEqual(clientState.beginCommand("move", 1, 1), { type: "move", roundId: 1, revision: 4, tokenIndex: 1 });
});

test("Ludo accepts a fresh joined room baseline after the abandoned room is recreated", () => {
  const clientState = createLudoClientState();
  clientState.recordJoined("p1");
  clientState.recordSnapshot(createChoiceSnapshot({ roundId: 3, revision: 100 }), 0);
  clientState.recordDisconnected();
  clientState.recordJoined("p1");

  assert.equal(clientState.getView(1).snapshot.roundId, 3);
  assert.equal(clientState.getView(1).canChoose, false);
  assert.equal(clientState.recordSnapshot(createChoiceSnapshot({ roundId: 1, revision: 0, phase: "roll", diceValue: 0, legalTokenIndices: [], started: false }), 2), true);
  assert.equal(clientState.getView(2).snapshot.roundId, 1);
  assert.equal(clientState.getView(2).snapshot.revision, 0);
  assert.equal(clientState.recordSnapshot(createChoiceSnapshot({ roundId: 1, revision: 2 }), 3), true);
  assert.equal(clientState.recordSnapshot(createChoiceSnapshot({ roundId: 1, revision: 1 }), 4), false);
  assert.equal(clientState.getView(4).snapshot.revision, 2);
});

test("Ludo HUD retains the authoritative last die face between turns and clears it for a fresh round", () => {
  const settledRollSnapshot = createChoiceSnapshot({ diceValue: 0 });
  settledRollSnapshot.lastAction.diceValue = 6;
  const freshRoundSnapshot = createChoiceSnapshot({ roundId: 2, revision: 0, diceValue: 0 });
  freshRoundSnapshot.lastAction.diceValue = 0;

  assert.equal(getLudoDisplayedDiceValue(settledRollSnapshot), 6);
  assert.equal(getLudoDisplayedDiceValue({ ...settledRollSnapshot, diceValue: 2 }), 2);
  assert.equal(getLudoDisplayedDiceValue(freshRoundSnapshot), 0);
  assert.equal(getLudoDisplayedDiceValue(null), 0);
});

test("Ludo HUD offers movement guidance once a piece has left the yard", () => {
  const clientState = createLudoClientState();
  const serverSnapshot = createChoiceSnapshot({ phase: "roll", diceValue: 0 });
  clientState.recordJoined("p1");
  clientState.recordSnapshot(serverSnapshot, 0);
  const view = { ...clientState.getView(0), connectionStatus: "connected", errorMessage: null, retryAvailable: false, rematchStarting: false };

  assert.equal(getLudoTurnPresentation(view).description, "Roll to move a piece.");
  serverSnapshot.players.p1.tokens = [-1, -1, -1, -1];
  clientState.recordSnapshot(serverSnapshot, 1);
  assert.equal(getLudoTurnPresentation({ ...view, ...clientState.getView(1) }).description, "Entry boost: better odds of a 6.");
});

test("Ludo HUD discloses entry assistance without predicting the next result", () => {
  const clientState = createLudoClientState();
  clientState.recordJoined("p1");
  const snapshot = createChoiceSnapshot({ phase: "roll", diceValue: 0 });
  snapshot.players.p1.tokens = [-1, -1, -1, -1];
  for (let previousMisses = 0; previousMisses <= 2; previousMisses += 1) {
    snapshot.players.p1.entryMisses = previousMisses;
    clientState.recordSnapshot(snapshot, previousMisses);
    const view = { ...clientState.getView(previousMisses), connectionStatus: "connected", errorMessage: null };
    assert.equal(getLudoTurnPresentation(view).description, "Entry boost: better odds of a 6.");
  }
  snapshot.currentPlayerId = "p2";
  clientState.recordSnapshot(snapshot, 4);
  const opponentTurn = { ...clientState.getView(4), connectionStatus: "connected", errorMessage: null };
  assert.equal(getLudoTurnPresentation(opponentTurn).description, "Your next roll is coming up.");
});
