import test from "node:test";
import assert from "node:assert/strict";
import { createRoomInvitePolicy } from "../public/platform/src/platform-ui/services/roomInvitePolicy.js";

const waitingRoom = { phase: "waiting", joined: true, connectedPlayers: 1, requiredPlayers: 2 };

test("only a library-created room opens an automatic invite, once, after its link exists", () => {
  const policy = createRoomInvitePolicy();
  assert.equal(policy.update({ gameId: "racer", roomId: null, ...waitingRoom }).autoInvite, false);
  assert.equal(policy.update({ gameId: "racer", roomId: "room1", ...waitingRoom }).autoInvite, true);
  assert.equal(policy.update({ gameId: "racer", roomId: "room1", ...waitingRoom }).autoInvite, false, "A dismissed invite must stay dismissed");
  const invitee = createRoomInvitePolicy();
  assert.equal(invitee.update({ gameId: "racer", roomId: "room1", ...waitingRoom }).autoInvite, false);
  assert.equal(invitee.update({ gameId: "racer", roomId: "room1", ...waitingRoom }).isCreatorEntry, false);
});

test("both clients close invites for countdown and gameplay, without reopening on reconnect", () => {
  const policy = createRoomInvitePolicy();
  policy.update({ gameId: "duel", roomId: null, ...waitingRoom });
  policy.update({ gameId: "duel", roomId: "duo", ...waitingRoom });
  assert.equal(policy.update({ gameId: "duel", roomId: "duo", ...waitingRoom, phase: "countdown", connectedPlayers: 2 }).closeInvite, true);
  assert.equal(policy.update({ gameId: "duel", roomId: "duo", ...waitingRoom, phase: "playing", connectedPlayers: 2 }).closeInvite, true);
  assert.equal(policy.update({ gameId: "duel", roomId: "duo", ...waitingRoom, phase: "playing", connectedPlayers: 2 }).closeInvite, false, "Manual invites remain available during play");
  assert.equal(policy.update({ gameId: "duel", roomId: "duo", ...waitingRoom }).autoInvite, false);
});

test("a different shared room cannot inherit creator intent; returning home permits a fresh room", () => {
  const policy = createRoomInvitePolicy();
  policy.update({ gameId: "game", roomId: null, ...waitingRoom });
  policy.update({ gameId: "game", roomId: "first", ...waitingRoom });
  assert.equal(policy.update({ gameId: "game", roomId: "second", ...waitingRoom }).isCreatorEntry, false);
  policy.update({ gameId: null, roomId: null, ...waitingRoom });
  policy.update({ gameId: "other", roomId: null, ...waitingRoom });
  assert.equal(policy.update({ gameId: "other", roomId: "new", ...waitingRoom }).autoInvite, true);
});

test("a terminal join failure closes an already-open creator invite", () => {
  const policy = createRoomInvitePolicy();
  policy.update({ gameId: "duel", roomId: null, ...waitingRoom });
  assert.equal(policy.update({ gameId: "duel", roomId: "room", ...waitingRoom }).autoInvite, true);
  assert.equal(policy.update({ gameId: "duel", roomId: "room", ...waitingRoom, phase: "error", joined: false }).closeInvite, true);
});
