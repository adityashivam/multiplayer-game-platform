import test from "node:test";
import assert from "node:assert/strict";
import { createGameRoomConnection } from "../public/platform/frontend-engine/gameRoomConnection.js";

function createRoomEnvironment({ gameId = "sample-race", pathname = "/games/sample-race/abc123", fetchRoom } = {}) {
  const listeners = new Map();
  const packets = [];
  const storageValues = new Map();
  const errors = [];
  const joinedRooms = [];
  const announcedRooms = [];
  let connected = true;
  const socket = {
    isConnected: () => connected,
    send: (eventName, payload) => packets.push({ eventName, payload }),
    onEvent(eventName, listener) {
      if (!listeners.has(eventName)) listeners.set(eventName, new Set());
      listeners.get(eventName).add(listener);
      return () => listeners.get(eventName).delete(listener);
    },
  };
  const windowRef = new EventTarget();
  windowRef.location = { pathname };
  windowRef.history = { replaceState(_state, _title, nextPath) { windowRef.location.pathname = nextPath; } };
  windowRef.addEventListener("kaboom:room-ready", (event) => announcedRooms.push({ ...event.detail, pathname: windowRef.location.pathname }));
  const connection = createGameRoomConnection({
    gameId,
    socket,
    windowRef,
    storage: { getItem: (key) => storageValues.get(key) || null, setItem: (key, value) => storageValues.set(key, value) },
    fetchRoom: fetchRoom || (() => assert.fail("Known room must not create another room")),
    onJoined: (room) => joinedRooms.push(room),
    onError: (message, retry) => errors.push({ message, retry }),
  });
  return {
    connection, packets, storageValues, errors, joinedRooms, announcedRooms, listeners,
    emit(eventName, payload) {
      if (eventName === "disconnect") connected = false;
      if (eventName === "connect") connected = true;
      for (const listener of listeners.get(eventName) || []) listener(payload);
    },
  };
}

test("shared room lifecycle joins once, saves per-game ownership and rejoins its existing seat", () => {
  const environment = createRoomEnvironment();
  assert.deepEqual(environment.packets, [{ eventName: "joinGame", payload: { gameId: "abc123", rejoinToken: undefined } }]);
  environment.emit("gameJoined", { playerId: "runner-west", gameId: "abc123", rejoinToken: "owner-token" });
  assert.equal(environment.connection.getPlayerId(), "runner-west");
  assert.equal(environment.storageValues.get("rejoinToken:sample-race:abc123"), "owner-token");
  environment.emit("connect");
  assert.equal(environment.packets.length, 1, "Duplicate connect cannot request a second seat");
  environment.emit("disconnect");
  environment.emit("connect");
  assert.deepEqual(environment.packets.at(-1).payload, { gameId: "abc123", rejoinToken: "owner-token" });
  environment.connection.dispose();
  assert.ok([...environment.listeners.values()].every((subscribers) => subscribers.size === 0));
});

test("room creation deduplicates retries and publishes the URL before room-ready", async () => {
  let requestCount = 0;
  let resolveRequest;
  const environment = createRoomEnvironment({
    gameId: "other-game", pathname: "/games/other-game",
    fetchRoom: () => {
      requestCount += 1;
      return requestCount === 1 ? Promise.reject(new Error("Offline")) : new Promise((resolve) => { resolveRequest = resolve; });
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(environment.errors.length, 1);
  environment.errors[0].retry();
  environment.errors[0].retry();
  assert.equal(requestCount, 2);
  resolveRequest({ ok: true, json: async () => ({ roomId: "room2" }) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(environment.announcedRooms.at(-1), { gameId: "other-game", roomId: "room2", pathname: "/games/other-game/room2" });
  assert.equal(environment.packets.length, 1);
  environment.connection.dispose();
});

test("disposed room creation cannot join or report a late response", async () => {
  let resolveRequest;
  let requestSignal;
  const environment = createRoomEnvironment({
    pathname: "/games/sample-race",
    fetchRoom: (_url, { signal }) => {
      requestSignal = signal;
      return new Promise((resolve) => { resolveRequest = resolve; });
    },
  });
  environment.connection.dispose();
  assert.equal(requestSignal.aborted, true);
  resolveRequest({ ok: true, json: async () => ({ roomId: "late1" }) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(environment.packets.length, 0);
  assert.equal(environment.announcedRooms.length, 0);
  assert.equal(environment.errors.length, 0);
});

test("invalid room responses and full rooms have a recoverable error without fabricating seats", async () => {
  const environment = createRoomEnvironment({ pathname: "/games/sample-race", fetchRoom: async () => ({ ok: true, json: async () => ({ roomId: "../other" }) }) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(environment.errors[0].message, /invalid room/i);
  assert.equal(environment.packets.length, 0);
  environment.connection.dispose();

  const fullRoom = createRoomEnvironment();
  fullRoom.emit("roomFull");
  assert.match(fullRoom.errors[0].message, /full/i);
  assert.equal(fullRoom.connection.getPlayerId(), null);
  fullRoom.errors[0].retry();
  assert.equal(fullRoom.packets.length, 2);
  fullRoom.connection.dispose();
});

test("room ownership ignores stale joined responses from another room", () => {
  const environment = createRoomEnvironment();
  environment.emit("gameJoined", { playerId: "old-seat", gameId: "old123", rejoinToken: "stale-token" });
  assert.equal(environment.connection.getPlayerId(), null);
  assert.equal(environment.connection.getRoomId(), "abc123");
  assert.equal(environment.storageValues.size, 0);
  assert.equal(environment.joinedRooms.length, 0);
  environment.connection.dispose();
});

test("room connection rejects non-string identifiers rather than coercing them into routes", () => {
  assert.throws(() => createGameRoomConnection({ gameId: undefined }), /identifier/);
  assert.throws(() => createGameRoomConnection({ gameId: null }), /identifier/);
});

test("room connection accepts the registered identifier alphabet including capitals and underscores", () => {
  const environment = createRoomEnvironment({ gameId: "Race_3D", pathname: "/games/Race_3D/abc123" });
  assert.equal(environment.connection.getRoomId(), "abc123");
  assert.equal(environment.packets[0].eventName, "joinGame");
  environment.connection.dispose();
});
