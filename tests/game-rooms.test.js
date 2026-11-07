import test from "node:test";
import assert from "node:assert/strict";
import { handleJoinGame, handlePlayerDisconnect, joinGameRoom } from "../server/platform-backend-engine/core/rooms.js";
import { bothPlayersConnected, scheduleStart } from "../server/platform-backend-engine/core/state.js";
import { tickGames } from "../server/platform-backend-engine/core/gameLoop.js";

function createRoomSession(playerIds = ["pilot", "navigator", "engineer"], configuredPlayerIds) {
  const games = new Map();
  const roomEvents = [];
  const disconnects = [];
  const namespace = {
    adapter: { rooms: new Map() },
    sockets: new Map(),
    to: (roomId) => ({ emit: (eventName, payload) => roomEvents.push({ roomId, eventName, payload }) }),
  };
  const createState = () => ({
    players: Object.fromEntries(playerIds.map((playerId) => [playerId, { connected: false, inputEpoch: 0 }])),
    startAt: null,
    started: false,
    gameOver: false,
  });
  const onPlayerDisconnect = (state, playerId) => {
    disconnects.push(playerId);
    state.players[playerId].connected = false;
    state.players[playerId].inputEpoch += 1;
    state.started = false;
    state.startAt = null;
  };

  function createSocket(socketId) {
    const socketEvents = [];
    const socket = {
      id: socketId,
      nsp: namespace,
      data: {},
      events: socketEvents,
      join(roomId) {
        if (!namespace.adapter.rooms.has(roomId)) namespace.adapter.rooms.set(roomId, new Set());
        namespace.adapter.rooms.get(roomId).add(socketId);
      },
      leave(roomId) {
        namespace.adapter.rooms.get(roomId)?.delete(socketId);
        if (namespace.adapter.rooms.get(roomId)?.size === 0) namespace.adapter.rooms.delete(roomId);
      },
      emit: (eventName, payload) => socketEvents.push({ eventName, payload }),
      to: (roomId) => ({ emit: (eventName, payload) => roomEvents.push({ roomId, eventName, payload }) }),
    };
    namespace.sockets.set(socketId, socket);
    return socket;
  }

  function join(socket, gameId = "crew", rejoinToken) {
    handleJoinGame({
      nsp: namespace,
      socket,
      games,
      gameId,
      createState,
      playerIds: configuredPlayerIds,
      rejoinToken,
      onPlayerDisconnect,
      onPlayerConnected: (state, playerId) => {
        state.players[playerId].connected = true;
        state.players[playerId].inputEpoch += 1;
        scheduleStart(state, 100, undefined, configuredPlayerIds);
      },
    });
  }

  function disconnect(socket) {
    handlePlayerDisconnect({ socket, games, onPlayerDisconnect });
    socket.leave("crew");
    namespace.sockets.delete(socket.id);
  }

  return { games, namespace, roomEvents, disconnects, createState, createSocket, join, disconnect };
}

function lastJoinedPayload(socket) {
  return socket.events.findLast((event) => event.eventName === "gameJoined")?.payload;
}

for (const playerId of ["team.red", "01", "0", "__proto__", "constructor", "prototype"]) {
  test(`inferred player slot ${playerId} fails before it can corrupt snapshot paths`, () => {
    const session = createRoomSession([playerId]);
    assert.throws(() => session.join(session.createSocket("first")), TypeError);
  });
}

test("snapshot-safe player identifiers retain their exact labels and field values", () => {
  const session = createRoomSession(["crew-01", "01pilot", "_engineer"]);
  const socket = session.createSocket("first");
  session.join(socket);
  session.games.get("crew").players["crew-01"].height = 42;
  session.games.get("crew").players["01pilot"].height = 84;

  tickGames({
    games: session.games,
    nsp: session.namespace,
    tickMs: 1000 / 30,
    serializeState: (state) => ({ players: state.players }),
  });
  const snapshotPacket = session.roomEvents.find((event) => event.eventName === "state").payload;
  assert.equal(lastJoinedPayload(socket).playerId, "crew-01");
  assert.equal(snapshotPacket.v[snapshotPacket.p.indexOf("players.crew-01.height")], 42);
  assert.equal(snapshotPacket.v[snapshotPacket.p.indexOf("players.01pilot.height")], 84);
});

test("three arbitrary slots fill in order and readiness waits for all players", () => {
  const session = createRoomSession();
  const sockets = ["first", "second", "third", "fourth"].map(session.createSocket);
  session.join(sockets[0]);
  session.join(sockets[1]);
  const state = session.games.get("crew");
  assert.equal(state.startAt, null);
  assert.equal(bothPlayersConnected(state), false);

  session.join(sockets[2]);
  session.join(sockets[3]);

  assert.deepEqual(sockets.slice(0, 3).map((socket) => lastJoinedPayload(socket).playerId), ["pilot", "navigator", "engineer"]);
  assert.equal(bothPlayersConnected(state), true);
  assert.ok(state.startAt > Date.now() - 100);
  assert.equal(sockets[3].data.playerId, undefined);
  assert.equal(sockets[3].events.at(-1).eventName, "roomFull");
});

test("explicit slots define allocation and readiness while extra state entries stay unallocated", () => {
  const session = createRoomSession(["observer", "engineer", "pilot", "navigator"], ["pilot", "navigator", "engineer"]);
  const sockets = ["first", "second", "third", "fourth"].map(session.createSocket);
  sockets.forEach((socket) => session.join(socket));

  assert.deepEqual(sockets.slice(0, 3).map((socket) => lastJoinedPayload(socket).playerId), ["pilot", "navigator", "engineer"]);
  assert.equal(session.games.get("crew").players.observer.connected, false);
  assert.ok(session.games.get("crew").startAt);
  assert.equal(sockets[3].events.at(-1).eventName, "roomFull");
});

test("rejoin tokens resume disconnected arbitrary slots and cannot displace live owners", () => {
  const session = createRoomSession();
  const sockets = ["first", "second", "third"].map(session.createSocket);
  sockets.forEach((socket) => session.join(socket));
  const navigatorToken = lastJoinedPayload(sockets[1]).rejoinToken;

  const intruder = session.createSocket("intruder");
  session.join(intruder, "crew", navigatorToken);
  assert.equal(intruder.events.at(-1).eventName, "roomFull");
  assert.equal(sockets[1].data.playerId, "navigator");

  session.disconnect(sockets[1]);
  const replacement = session.createSocket("replacement");
  session.join(replacement, "crew", navigatorToken);
  assert.equal(lastJoinedPayload(replacement).playerId, "navigator");
  assert.equal(lastJoinedPayload(replacement).rejoinToken, navigatorToken);
  assert.equal(lastJoinedPayload(replacement).inputEpoch, 3);

  session.join(intruder, "crew", "incorrect-token");
  assert.equal(intruder.events.at(-1).eventName, "roomFull");
});

test("incorrect tokens get ordinary vacant slots and never another player's token", () => {
  const session = createRoomSession();
  const firstSocket = session.createSocket("first");
  session.join(firstSocket);
  const firstToken = lastJoinedPayload(firstSocket).rejoinToken;
  session.disconnect(firstSocket);

  const nextSocket = session.createSocket("next");
  session.join(nextSocket, "crew", "incorrect-token");
  assert.equal(lastJoinedPayload(nextSocket).playerId, "pilot");
  assert.notEqual(lastJoinedPayload(nextSocket).rejoinToken, firstToken);
  assert.notEqual(lastJoinedPayload(nextSocket).rejoinToken, "incorrect-token");

  const previousOwner = session.createSocket("previous-owner");
  session.join(previousOwner, "crew", firstToken);
  assert.equal(lastJoinedPayload(previousOwner).playerId, "navigator");
});

test("repeated joins preserve ownership and input epoch instead of consuming another slot", () => {
  const session = createRoomSession();
  const socket = session.createSocket("first");
  session.join(socket);
  const firstPayload = { ...lastJoinedPayload(socket) };
  session.join(socket);

  assert.deepEqual(lastJoinedPayload(socket), firstPayload);
  assert.equal(session.namespace.adapter.rooms.get("crew").size, 1);
  assert.equal(session.games.get("crew").players.navigator.connected, false);
});

test("duplicate joins still acknowledge the same owner after every room slot is filled", () => {
  const session = createRoomSession(["left", "right"]);
  const firstSocket = session.createSocket("first");
  session.join(firstSocket);
  const joinedPayload = { ...lastJoinedPayload(firstSocket) };
  session.join(session.createSocket("second"));
  session.join(firstSocket);

  assert.deepEqual(lastJoinedPayload(firstSocket), joinedPayload);
  assert.equal(firstSocket.events.some((socketEvent) => socketEvent.eventName === "roomFull"), false);
  assert.equal(session.namespace.adapter.rooms.get("crew").size, 2);
});

test("a token saved before a server restart can join a fresh room and receives new ownership", () => {
  const session = createRoomSession(["left", "right"]);
  const socket = session.createSocket("new-transport");
  session.join(socket, "restarted-room-fixture", "token-from-previous-server");

  assert.equal(lastJoinedPayload(socket).playerId, "left");
  assert.notEqual(lastJoinedPayload(socket).rejoinToken, "token-from-previous-server");
  assert.equal(lastJoinedPayload(socket).inputEpoch, 1);
  assert.equal(socket.events.some((socketEvent) => socketEvent.eventName === "roomFull"), false);
});

test("a busy rejoin token waits for its owner instead of allocating a different slot", () => {
  const session = createRoomSession();
  const firstSocket = session.createSocket("first");
  session.join(firstSocket);
  const pilotToken = lastJoinedPayload(firstSocket).rejoinToken;
  session.games.get("crew").players.pilot.connected = false;

  const secondSocket = session.createSocket("second");
  session.join(secondSocket, "crew", pilotToken);
  assert.equal(lastJoinedPayload(secondSocket), undefined);
  assert.deepEqual(secondSocket.events.at(-1), {
    eventName: "roomFull",
    payload: { gameId: "crew", rejoinPending: true },
  });
  assert.equal(firstSocket.data.playerId, "pilot");
  assert.equal(session.games.get("crew").players.navigator.connected, false);
});

test("a reconnect arriving before the old transport disconnects can resume the same full-room slot", () => {
  const session = createRoomSession(["left", "right"]);
  const firstSocket = session.createSocket("first");
  const secondSocket = session.createSocket("second");
  session.join(firstSocket);
  session.join(secondSocket);
  const firstToken = lastJoinedPayload(firstSocket).rejoinToken;

  const replacementSocket = session.createSocket("replacement");
  session.join(replacementSocket, "crew", firstToken);
  assert.deepEqual(replacementSocket.events.at(-1), {
    eventName: "roomFull",
    payload: { gameId: "crew", rejoinPending: true },
  });
  assert.equal(session.games.get("crew").players.left.connected, true);
  assert.equal(firstSocket.data.playerId, "left");

  session.disconnect(firstSocket);
  session.join(replacementSocket, "crew", firstToken);
  assert.equal(lastJoinedPayload(replacementSocket).playerId, "left");
  assert.equal(lastJoinedPayload(replacementSocket).rejoinToken, firstToken);
  assert.equal(lastJoinedPayload(replacementSocket).inputEpoch, 3);
});

test("full rooms reject newcomers and invalid tokens without offering reconnect retries", () => {
  const session = createRoomSession(["left", "right"]);
  session.join(session.createSocket("first"));
  session.join(session.createSocket("second"));

  for (const rejoinToken of [undefined, "incorrect-token"]) {
    const visitorSocket = session.createSocket(`visitor-${rejoinToken}`);
    session.join(visitorSocket, "crew", rejoinToken);
    assert.deepEqual(visitorSocket.events, [{ eventName: "roomFull", payload: undefined }]);
    assert.equal(visitorSocket.data.playerId, undefined);
  }
});

test("a stale disconnect cannot reset a player slot rebound to a different socket", () => {
  const session = createRoomSession(["left", "right"]);
  const firstSocket = session.createSocket("first");
  session.join(firstSocket);
  const firstToken = lastJoinedPayload(firstSocket).rejoinToken;
  firstSocket.leave("crew");
  session.namespace.sockets.delete(firstSocket.id);
  session.games.get("crew").players.left.connected = false;

  const replacementSocket = session.createSocket("replacement");
  session.join(replacementSocket, "crew", firstToken);
  const inputEpoch = lastJoinedPayload(replacementSocket).inputEpoch;
  const eventCount = session.roomEvents.length;
  handlePlayerDisconnect({ socket: firstSocket, games: session.games, onPlayerDisconnect: () => {
    assert.fail("A stale transport must not run the new owner's disconnect lifecycle");
  } });

  assert.equal(session.games.get("crew").players.left.connected, true);
  assert.equal(session.games.get("crew").players.left.inputEpoch, inputEpoch);
  assert.equal(session.roomEvents.length, eventCount);
  assert.equal(firstSocket.data.playerId, null);
  assert.equal(replacementSocket.data.playerId, "left");
});

test("room switching runs disconnect lifecycle and makes the old slot available", () => {
  const session = createRoomSession();
  const firstSocket = session.createSocket("first");
  session.join(firstSocket);
  const oldState = session.games.get("crew");
  oldState.started = true;
  session.join(firstSocket, "other-room");

  assert.deepEqual(session.disconnects, ["pilot"]);
  assert.equal(oldState.started, false);
  assert.equal(oldState.players.pilot.connected, false);
  assert.equal(oldState.players.pilot.inputEpoch, 2);
  assert.equal(firstSocket.data.gameId, "other-room");
  assert.equal(session.namespace.adapter.rooms.has("crew"), false);
  assert.ok(session.roomEvents.some((event) => event.roomId === "crew" && event.eventName === "playerLeft"));

  const nextSocket = session.createSocket("next");
  session.join(nextSocket);
  assert.equal(lastJoinedPayload(nextSocket).playerId, "pilot");
});

test("core disconnect marks slots offline when no game hook supplies that bookkeeping", () => {
  const session = createRoomSession();
  const socket = session.createSocket("first");
  session.join(socket);
  handlePlayerDisconnect({ socket, games: session.games });

  assert.equal(session.games.get("crew").players.pilot.connected, false);
  assert.equal(socket.data.playerId, null);
});

test("room allocation rejects configured slots absent from the authoritative state", () => {
  const session = createRoomSession();
  assert.throws(() => joinGameRoom({
    nsp: session.namespace,
    socket: session.createSocket("first"),
    games: session.games,
    gameId: "crew",
    createState: session.createState,
    playerIds: ["missing"],
  }), { name: "TypeError" });
});

test("start scheduling keeps the duo signature and invokes setup once for arbitrary capacity", () => {
  const duoState = { players: { p1: { connected: true }, p2: { connected: true } } };
  scheduleStart(duoState, 100);
  assert.ok(duoState.startAt);

  const emptyState = { players: {} };
  scheduleStart(emptyState, 100);
  assert.equal(emptyState.startAt, undefined);

  const state = { players: { a: { connected: true }, b: { connected: true }, c: { connected: true } } };
  let setupCount = 0;
  scheduleStart(state, 100, () => { setupCount += 1; });
  const startAt = state.startAt;
  scheduleStart(state, 100, () => { setupCount += 1; });
  assert.equal(setupCount, 1);
  assert.equal(state.startAt, startAt);
});

test("room snapshots still emit a decodable full baseline after arbitrary-slot joins", () => {
  const session = createRoomSession();
  session.join(session.createSocket("first"));
  tickGames({
    games: session.games,
    nsp: session.namespace,
    monotonicNowMs: 0,
    serializeState: (state) => ({ players: state.players }),
  });

  const snapshotPacket = session.roomEvents.find((event) => event.eventName === "state").payload;
  assert.equal(snapshotPacket.k, "f");
  const epochIndex = snapshotPacket.p.indexOf("players.pilot.inputEpoch");
  assert.ok(epochIndex >= 0);
  assert.equal(snapshotPacket.v[epochIndex], 1);
});
