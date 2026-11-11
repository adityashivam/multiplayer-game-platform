import test from "node:test";
import assert from "node:assert/strict";
import { createRoomLifecycleMetadata, ROOM_START_COUNTDOWN_MS } from "../public/platform/shared/roomLifecycle.js";
import { createRoomLifecycleClient } from "../public/platform/frontend-engine/roomLifecycleClient.js";
import { scheduleStart } from "../server/platform-backend-engine/core/state.js";

function createRoomState() {
  return { players: { west: { connected: true }, east: { connected: false }, north: { connected: false } }, started: false, startAt: null, gameOver: false };
}

function createCountdownPacket({ phase = "countdown", startAtMs = 105000, serverTime = 100000, roomId = "room1", connectedPlayers = 2, requiredPlayers = 2 } = {}) {
  return { net: { serverTime, room: { apiVersion: 1, roomId, phase, startAtMs, countdownDurationMs: 5000, connectedPlayers, requiredPlayers } } };
}

test("room lifecycle derives human capacity without consuming bot actors", () => {
  const room = createRoomState();
  room.bots = [{ connected: true }, { connected: true }];
  assert.deepEqual(createRoomLifecycleMetadata(room, "room1"), { apiVersion: 1, roomId: "room1", phase: "waiting", startAtMs: null, countdownDurationMs: 5000, connectedPlayers: 1, requiredPlayers: 3 });
  room.players.east.connected = true;
  room.players.north.connected = true;
  scheduleStart(room);
  assert.equal(ROOM_START_COUNTDOWN_MS, 5000);
  assert.ok(room.startAt - Date.now() > 4900);
  assert.equal(createRoomLifecycleMetadata(room, "room1").phase, "countdown");
  const startAt = room.startAt;
  room.started = true;
  room.startAt = null;
  assert.equal(createRoomLifecycleMetadata(room, "room1").startAtMs, startAt);
  assert.equal(createRoomLifecycleMetadata(room, "room1").phase, "playing");
  room.players.east.connected = false;
  room.started = false;
  assert.equal(createRoomLifecycleMetadata(room, "room1").phase, "waiting");
  room.gameOver = true;
  assert.equal(createRoomLifecycleMetadata(room, "room1").phase, "finished");
});

test("countdown uses server time and a monotonic local anchor, including all five digits", () => {
  let localTime = 300;
  const updates = [];
  const client = createRoomLifecycleClient({ nowFn: () => localTime, onChange: (state) => updates.push(state) });
  client.recordJoined({ gameId: "room1", playerId: "west" });
  client.recordSnapshot(createCountdownPacket());
  const digits = [];
  for (let elapsed = 0; elapsed < 5000; elapsed += 1000) {
    localTime = 300 + elapsed;
    client.refresh();
    digits.push(client.getSnapshot().secondsRemaining);
  }
  assert.deepEqual(digits, [5, 4, 3, 2, 1]);
  localTime = 5300;
  client.refresh();
  assert.equal(client.getSnapshot().secondsRemaining, 0);
  assert.equal(client.getSnapshot().phase, "countdown", "Only authority can start gameplay");
  client.recordSnapshot(createCountdownPacket({ phase: "playing", serverTime: 105000 }));
  assert.equal(client.getSnapshot().showGo, true);
  localTime += 700;
  client.refresh();
  assert.equal(client.getSnapshot().showGo, false);
  assert.ok(updates.length < 12, "UI publications follow meaningful transitions, not frame cadence");
});

test("different monotonic clock origins and skewed device wall clocks produce the same countdown", () => {
  let firstTime = 900;
  let secondTime = 900000;
  const first = createRoomLifecycleClient({ nowFn: () => firstTime });
  const second = createRoomLifecycleClient({ nowFn: () => secondTime });
  for (const client of [first, second]) client.recordJoined({ gameId: "room1", playerId: "seat" });
  first.recordSnapshot(createCountdownPacket(), { pingMs: 100 });
  second.recordSnapshot(createCountdownPacket(), { pingMs: 100 });
  firstTime += 1080;
  secondTime += 1080;
  first.refresh(); second.refresh();
  assert.equal(first.getSnapshot().secondsRemaining, 4);
  assert.equal(second.getSnapshot().secondsRemaining, 4);
});

test("disconnect cancels presentation, stale room packets are ignored, late joins do not invent a start", () => {
  const client = createRoomLifecycleClient({ nowFn: () => 0 });
  client.recordJoined({ gameId: "room1", playerId: "seat" });
  client.recordSnapshot(createCountdownPacket());
  client.recordDisconnected();
  assert.equal(client.getSnapshot().secondsRemaining, null);
  assert.equal(client.getSnapshot().phase, "reconnecting");
  client.recordSnapshot(createCountdownPacket({ phase: "playing" }));
  assert.equal(client.getSnapshot().phase, "reconnecting");
  client.recordJoined({ gameId: "room2", playerId: "seat" });
  client.recordSnapshot(createCountdownPacket({ roomId: "room1" }));
  assert.equal(client.getSnapshot().phase, "connecting");
  client.recordSnapshot(createCountdownPacket({ roomId: "room2", phase: "playing" }));
  assert.equal(client.getSnapshot().phase, "playing");
  assert.equal(client.getSnapshot().showGo, false);
});

test("a rematch can count down again without changing seat ownership or leaking the previous GO cue", () => {
  let nowMs = 0;
  const client = createRoomLifecycleClient({ nowFn: () => nowMs });
  client.recordJoined({ gameId: "room1", playerId: "west" });
  client.recordSnapshot(createCountdownPacket());
  client.recordSnapshot(createCountdownPacket({ phase: "playing", serverTime: 105000 }));
  client.restartRound();
  assert.equal(client.getSnapshot().playerId, "west");
  assert.equal(client.getSnapshot().showGo, false);
  nowMs = 2000;
  client.recordSnapshot(createCountdownPacket({ serverTime: 200000, startAtMs: 205000 }));
  assert.equal(client.getSnapshot().secondsRemaining, 5);
});

test("ordered delayed packets cannot rewind countdown digits for the same start deadline", () => {
  let nowMs = 0;
  const client = createRoomLifecycleClient({ nowFn: () => nowMs });
  client.recordJoined({ gameId: "room1", playerId: "west" });
  client.recordSnapshot(createCountdownPacket());
  nowMs = 1010;
  client.refresh();
  assert.equal(client.getSnapshot().secondsRemaining, 4);
  nowMs = 1020;
  client.recordSnapshot(createCountdownPacket({ serverTime: 100100 }));
  assert.equal(client.getSnapshot().secondsRemaining, 4, "Late ordered packet cannot return to five");
  client.recordSnapshot(createCountdownPacket({ serverTime: 101030 }));
  assert.equal(client.getSnapshot().secondsRemaining, 4);
  client.recordSnapshot(createCountdownPacket({ phase: "waiting", startAtMs: null, connectedPlayers: 1 }));
  client.recordSnapshot(createCountdownPacket({ startAtMs: 110000, serverTime: 105000 }));
  assert.equal(client.getSnapshot().secondsRemaining, 5, "A fresh deadline starts a fresh countdown");
});

test("terminal room capacity errors replace joining state and clear stale countdowns", () => {
  const client = createRoomLifecycleClient();
  client.recordJoinFailure("roomFull");
  assert.equal(client.getSnapshot().phase, "error");
  assert.match(client.getSnapshot().errorMessage, /occupied/i);
  assert.equal(client.getSnapshot().secondsRemaining, null);
  client.recordJoined({ gameId: "room2", playerId: "seat" });
  assert.equal(client.getSnapshot().errorMessage, null);
});

test("duplicate seat confirmations cannot reset an active room or its countdown", () => {
  const changes = [];
  const client = createRoomLifecycleClient({ nowFn: () => 0, onChange: (state) => changes.push(state) });
  const joinedRoom = { gameId: "room1", playerId: "west" };
  client.recordJoined(joinedRoom);
  client.recordSnapshot(createCountdownPacket());
  const countdown = client.getSnapshot();
  const countdownChanges = changes.length;
  client.recordJoined({ ...joinedRoom });
  assert.deepEqual(client.getSnapshot(), countdown);
  assert.equal(changes.length, countdownChanges);

  client.recordSnapshot(createCountdownPacket({ phase: "playing", serverTime: 105000 }));
  const playing = client.getSnapshot();
  client.recordJoined({ ...joinedRoom });
  assert.deepEqual(client.getSnapshot(), playing, "An idempotent server acknowledgement cannot pause gameplay");
});

test("same-seat recovery stays distinct from initial joining until authoritative play resumes", () => {
  const client = createRoomLifecycleClient({ nowFn: () => 0 });
  const joinedRoom = { gameId: "room1", playerId: "west" };
  client.recordJoined(joinedRoom);
  client.recordSnapshot(createCountdownPacket({ phase: "playing" }));
  assert.equal(client.getSnapshot().hasPlayed, true);

  client.recordDisconnected();
  client.recordSnapshot(createCountdownPacket({ phase: "playing" }));
  assert.equal(client.getSnapshot().joined, false, "Old packets cannot restore ownership");
  client.recordJoined(joinedRoom);
  assert.equal(client.getSnapshot().phase, "reconnecting", "Rejoin acknowledgement must not reopen the initial join screen");
  assert.equal(client.getSnapshot().joined, true);
  assert.equal(client.getSnapshot().hasPlayed, true);

  client.recordSnapshot(createCountdownPacket({ phase: "waiting", connectedPlayers: 1, startAtMs: null }));
  assert.equal(client.getSnapshot().hasPlayed, true, "Waiting for an opponent is still recovery for this match");
  client.recordSnapshot(createCountdownPacket());
  assert.equal(client.getSnapshot().hasPlayed, true);
  client.recordSnapshot(createCountdownPacket({ phase: "playing", serverTime: 105000 }));
  assert.equal(client.getSnapshot().phase, "playing");
  assert.equal(client.getSnapshot().showGo, false, "Recovery must not announce a new game");

  client.restartRound();
  assert.equal(client.getSnapshot().hasPlayed, false, "A rematch gets its own initial countdown");
  client.recordSnapshot(createCountdownPacket());
  client.recordSnapshot(createCountdownPacket({ phase: "playing", serverTime: 105000 }));
  assert.equal(client.getSnapshot().showGo, true);
  client.recordJoined({ gameId: "room2", playerId: "west" });
  assert.equal(client.getSnapshot().hasPlayed, false, "History cannot leak into a different room");
  client.reset();
  assert.equal(client.getSnapshot().hasPlayed, false);
});

test("a recreated room with a new seat token gets fresh startup instead of old recovery history", () => {
  const client = createRoomLifecycleClient({ nowFn: () => 0 });
  client.recordJoined({ gameId: "room1", playerId: "west", rejoinToken: "old-seat" });
  client.recordSnapshot(createCountdownPacket({ phase: "playing" }));
  client.recordDisconnected();
  client.recordJoined({ gameId: "room1", playerId: "west", rejoinToken: "new-seat" });
  assert.equal(client.getSnapshot().hasPlayed, false);
  assert.equal(client.getSnapshot().phase, "connecting");
  client.recordSnapshot(createCountdownPacket());
  client.recordSnapshot(createCountdownPacket({ phase: "playing", serverTime: 105000 }));
  assert.equal(client.getSnapshot().showGo, true);
  assert.equal(Object.hasOwn(client.getSnapshot(), "rejoinToken"), false, "Private ownership tokens stay out of UI state");
});
