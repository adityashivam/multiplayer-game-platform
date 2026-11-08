import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { tickGames } from "../server/platform-backend-engine/core/gameLoop.js";
import { subscribeRoomLifecycle } from "../public/platform/frontend-engine/roomLifecycleBridge.js";

// Resolve browser and relative module imports when loading the client in Node.
const require = createRequire(import.meta.url);
const parserUrl = pathToFileURL(require.resolve("socket.io-msgpack-parser")).href;
const gameSocketUrl = new URL("../public/platform/frontend-engine/gameSocket.js", import.meta.url);
const protocolUrl = new URL("../shared/networkProtocol.js", gameSocketUrl).href;
const roomJoinRecoveryUrl = new URL("./roomJoinRecovery.js", gameSocketUrl).href;
const gameSocketSource = (await readFile(gameSocketUrl, "utf8"))
  .replace('"./roomLifecycleBridge.js"', JSON.stringify(new URL("./roomLifecycleBridge.js", gameSocketUrl).href))
  .replace('"./roomJoinRecovery.js"', JSON.stringify(roomJoinRecoveryUrl))
  .replace('"/platform/frontend-engine/msgpackParser.js"', JSON.stringify(parserUrl))
  .replace('"../shared/networkProtocol.js"', JSON.stringify(protocolUrl));
const { getGameSocket } = await import(`data:text/javascript;base64,${Buffer.from(gameSocketSource).toString("base64")}`);

test("transport publishes countdown state before gameplay subscribes and survives broad game unsubscription", (testContext) => {
  const { rawSocket, socket } = createTestGameConnection(testContext);
  const states = [];
  const unsubscribe = subscribeRoomLifecycle("fight-test", (state) => states.push(state));
  testContext.after(unsubscribe);
  rawSocket.emit("gameJoined", { gameId: "room1", playerId: "p1" });
  const createSnapshot = (sequence, phase) => ({ net: { seq: sequence, serverTime: 100000, room: { apiVersion: 1, roomId: "room1", phase, startAtMs: 105000, countdownDurationMs: 5000, connectedPlayers: 2, requiredPlayers: 2 } } });
  rawSocket.emit("state", createSnapshot(1, "countdown"));
  assert.equal(states.at(-1).phase, "countdown");
  assert.equal(states.at(-1).secondsRemaining, 5);
  socket.offEvent("state");
  socket.offEvent("gameJoined");
  rawSocket.emit("state", createSnapshot(2, "playing"));
  assert.equal(states.at(-1).phase, "playing");
  assert.equal(states.at(-1).showGo, true);
});

function createTestGameConnection(testContext) {
  const rawSocket = new EventEmitter();
  rawSocket.connected = true;
  rawSocket.io = new EventEmitter();
  rawSocket.io.engine = new EventEmitter();
  rawSocket.disconnect = () => {};
  rawSocket.volatile = { emit() {} };

  const previousWindow = globalThis.window;
  globalThis.window = { io: () => rawSocket };
  const socket = getGameSocket("fight-test");
  testContext.after(() => {
    socket.destroy();
    globalThis.window = previousWindow;
  });

  return { rawSocket, socket };
}

test("Engine.IO heartbeat response events cannot fabricate an unmeasured round-trip latency", (testContext) => {
  let nowMs = 100;
  testContext.mock.method(performance, "now", () => nowMs);
  const { rawSocket, socket } = createTestGameConnection(testContext);

  rawSocket.io.engine.emit("ping");
  rawSocket.io.engine.emit("pong");
  nowMs += 25000;
  rawSocket.io.emit("open");
  rawSocket.io.engine.emit("ping");
  rawSocket.io.engine.emit("pong");

  const connectionSnapshot = socket.getConnectionSnapshot();
  assert.equal(socket.getPing(), null);
  assert.equal(connectionSnapshot.ping, null);
  assert.equal(connectionSnapshot.pingP95Ms, null);
  assert.equal(connectionSnapshot.pingP99Ms, null);
});

test("immediate Engine.IO heartbeats preserve acknowledged application RTT and its quantiles", (testContext) => {
  let nowMs = 100;
  testContext.mock.method(performance, "now", () => nowMs);
  const { rawSocket, socket } = createTestGameConnection(testContext);
  let acknowledgeProbe;
  rawSocket.volatile.emit = (eventName, acknowledgement) => {
    assert.equal(eventName, "__ping");
    acknowledgeProbe = acknowledgement;
  };
  rawSocket.emit("connect");
  nowMs += 500;
  acknowledgeProbe();
  assert.equal(socket.getConnectionSnapshot().ping, 500);

  for (let heartbeat = 0; heartbeat < 25; heartbeat += 1) {
    nowMs += 1000;
    rawSocket.io.engine.emit("ping");
    rawSocket.io.engine.emit("pong");
  }

  const connectionSnapshot = socket.getConnectionSnapshot();
  assert.equal(socket.getPing(), 500);
  assert.equal(connectionSnapshot.ping, 500);
  assert.equal(connectionSnapshot.pingP95Ms, 500);
  assert.equal(connectionSnapshot.pingP99Ms, 500);
});

function createControlledTimeouts(testContext) {
  let currentTimeMs = 0;
  let nextTimerId = 0;
  const pendingTimeouts = new Map();
  testContext.mock.method(globalThis, "setTimeout", (callback, delayMs = 0) => {
    const timerId = ++nextTimerId;
    pendingTimeouts.set(timerId, { callback, dueAtMs: currentTimeMs + delayMs });
    return timerId;
  });
  testContext.mock.method(globalThis, "clearTimeout", (timerId) => {
    pendingTimeouts.delete(timerId);
  });

  return {
    tick(elapsedMs) {
      const targetTimeMs = currentTimeMs + elapsedMs;
      while (true) {
        const nextTimeout = [...pendingTimeouts.entries()]
          .filter(([, timeout]) => timeout.dueAtMs <= targetTimeMs)
          .sort(([, firstTimeout], [, secondTimeout]) => firstTimeout.dueAtMs - secondTimeout.dueAtMs)[0];
        if (!nextTimeout) break;

        const [timerId, timeout] = nextTimeout;
        pendingTimeouts.delete(timerId);
        currentTimeMs = timeout.dueAtMs;
        timeout.callback();
      }
      currentTimeMs = targetTimeMs;
    },
  };
}

function createFullSnapshot(sequenceNumber, inputEpoch) {
  return {
    __packed: 1,
    k: "f",
    s: sequenceNumber,
    p: ["players.p1.inputEpoch"],
    v: [inputEpoch],
    n: { seq: sequenceNumber },
  };
}

function packServerSnapshot(gameState, monotonicNowMs = 0) {
  let snapshotPacket;
  tickGames({
    games: new Map([["snapshot-room", gameState]]),
    nsp: {
      to: () => ({ emit: (_eventName, packet) => { snapshotPacket = packet; } }),
    },
    tickMs: 20,
    nowMs: 1000 + monotonicNowMs,
    monotonicNowMs,
    serializeState: (state) => state.snapshot,
  });

  return snapshotPacket;
}

function preserveObjectProperties(testContext, target, propertyNames) {
  const descriptors = propertyNames.map((propertyName) => [
    propertyName,
    Object.getOwnPropertyDescriptor(target, propertyName),
  ]);
  testContext.after(() => {
    for (const [propertyName, descriptor] of descriptors) {
      if (descriptor) {
        Object.defineProperty(target, propertyName, descriptor);
      } else {
        delete target[propertyName];
      }
    }
  });

  return descriptors;
}

test("server full and delta snapshots retain own objects for inherited player identifiers", (testContext) => {
  const { rawSocket, socket } = createTestGameConnection(testContext);
  const playerIds = ["toString", "valueOf", "hasOwnProperty"];
  const playerFields = ["connected", "inputEpoch", "x", "y"];
  const prototypeDescriptors = playerIds.map((playerId) => preserveObjectProperties(
    testContext,
    Object.prototype[playerId],
    playerFields,
  ));
  const gameState = {
    snapshot: {
      players: {
        toString: { connected: true, inputEpoch: 1, x: 10, y: 20 },
        valueOf: { connected: true, inputEpoch: 2, x: 30, y: 40 },
        hasOwnProperty: { connected: false, inputEpoch: 3, x: 50, y: 60 },
      },
    },
  };
  const receivedSnapshots = [];
  socket.onEvent("state", (serverState) => receivedSnapshots.push(serverState));

  const fullSnapshot = packServerSnapshot(gameState);
  rawSocket.emit("state", fullSnapshot);
  gameState.snapshot.players.valueOf.x = 35;
  const deltaSnapshot = packServerSnapshot(gameState, 20);
  rawSocket.emit("state", deltaSnapshot);

  assert.equal(fullSnapshot.k, "f");
  assert.equal(deltaSnapshot.k, "d");
  assert.equal(receivedSnapshots.length, 2);

  for (const serverState of receivedSnapshots) {
    assert.equal(Object.getPrototypeOf(serverState.players), Object.prototype);
    for (const playerId of playerIds) {
      assert.equal(Object.hasOwn(serverState.players, playerId), true, `${playerId} is an own player slot`);
      assert.equal(typeof serverState.players[playerId], "object");
      assert.equal(Object.getPrototypeOf(serverState.players[playerId]), Object.prototype);
    }
    assert.deepEqual(structuredClone(serverState), serverState);
  }

  assert.deepEqual(receivedSnapshots[0].players, {
    toString: { connected: true, inputEpoch: 1, x: 10, y: 20 },
    valueOf: { connected: true, inputEpoch: 2, x: 30, y: 40 },
    hasOwnProperty: { connected: false, inputEpoch: 3, x: 50, y: 60 },
  });
  assert.deepEqual(receivedSnapshots[1].players, {
    toString: { connected: true, inputEpoch: 1, x: 10, y: 20 },
    valueOf: { connected: true, inputEpoch: 2, x: 35, y: 40 },
    hasOwnProperty: { connected: false, inputEpoch: 3, x: 50, y: 60 },
  });
  playerIds.forEach((playerId, index) => {
    for (const [propertyName, descriptor] of prototypeDescriptors[index]) {
      assert.deepEqual(Object.getOwnPropertyDescriptor(Object.prototype[playerId], propertyName), descriptor);
    }
  });
});

test("snapshot prototype-named fields remain own data properties without prototype mutation", (testContext) => {
  const { rawSocket, socket } = createTestGameConnection(testContext);
  const originalDescriptors = preserveObjectProperties(testContext, Object.prototype, ["snapshotMarker"]);
  const metadata = {
    ["__proto__"]: "own marker",
    nested: { ["__proto__"]: { snapshotMarker: true } },
  };
  const receivedSnapshots = [];
  socket.onEvent("state", (serverState) => receivedSnapshots.push(serverState));

  rawSocket.emit("state", packServerSnapshot({ snapshot: { metadata } }));

  const serverState = receivedSnapshots[0];
  assert.equal(Object.hasOwn(serverState.metadata, "__proto__"), true);
  assert.equal(Object.hasOwn(serverState.metadata.nested, "__proto__"), true);
  assert.deepEqual(serverState.metadata, metadata);
  assert.equal(Object.getPrototypeOf(serverState.metadata), Object.prototype);
  assert.equal(Object.getPrototypeOf(serverState.metadata.nested), Object.prototype);
  assert.deepEqual(Object.getOwnPropertyDescriptor(Object.prototype, "snapshotMarker"), originalDescriptors[0][1]);
  assert.deepEqual(structuredClone(serverState), serverState);
});

test("full and delta snapshots preserve array lengths alongside numeric paths", (testContext) => {
  const { rawSocket, socket } = createTestGameConnection(testContext);
  const receivedSnapshots = [];
  socket.onEvent("state", (serverState) => receivedSnapshots.push(serverState));

  rawSocket.emit("state", {
    __packed: 1,
    k: "f",
    s: 1,
    p: ["inventory.0", "inventory.length"],
    v: ["item", 1],
    n: { seq: 1 },
  });
  rawSocket.emit("state", {
    __packed: 1,
    k: "d",
    s: 2,
    b: 1,
    c: [[0, "replacement"], [1, 2]],
    n: { seq: 2 },
  });
  rawSocket.emit("state", {
    __packed: 1,
    k: "d",
    s: 3,
    b: 2,
    c: [[1, 0]],
    n: { seq: 3 },
  });

  assert.equal(receivedSnapshots.length, 3);
  assert.deepEqual(receivedSnapshots[0].inventory, ["item"]);
  assert.equal(receivedSnapshots[1].inventory[0], "replacement");
  assert.equal(receivedSnapshots[1].inventory.length, 2);
  assert.deepEqual(Object.keys(receivedSnapshots[1].inventory), ["0"]);
  assert.deepEqual(receivedSnapshots[2].inventory, []);

  for (const serverState of receivedSnapshots) {
    assert.equal(Array.isArray(serverState.inventory), true);
    assert.deepEqual(Object.getOwnPropertyDescriptor(serverState.inventory, "length"), {
      value: serverState.inventory.length,
      writable: true,
      enumerable: false,
      configurable: false,
    });
    assert.deepEqual(structuredClone(serverState), serverState);
  }
});

test("rematch accepts a new full baseline and deltas with restarted sequences", (testContext) => {
  const { rawSocket, socket } = createTestGameConnection(testContext);
  const receivedSnapshots = [];
  socket.onEvent("state", (serverState) => {
    receivedSnapshots.push([serverState.net.seq, serverState.players.p1.inputEpoch]);
  });

  rawSocket.emit("state", createFullSnapshot(3000, 1));
  rawSocket.emit("rematchStarted");
  rawSocket.emit("state", createFullSnapshot(1, 2));
  rawSocket.emit("state", {
    __packed: 1,
    k: "d",
    s: 2,
    b: 1,
    c: [[0, 3]],
    n: { seq: 2 },
  });

  assert.deepEqual(receivedSnapshots, [[3000, 1], [1, 2], [2, 3]]);
});

test("each state subscriber receives each accepted snapshot once", (testContext) => {
  const { rawSocket, socket } = createTestGameConnection(testContext);
  const firstSubscriberSequences = [];
  const secondSubscriberSequences = [];
  socket.onEvent("state", (serverState) => firstSubscriberSequences.push(serverState.net.seq));
  socket.onEvent("state", (serverState) => secondSubscriberSequences.push(serverState.net.seq));

  rawSocket.emit("state", createFullSnapshot(1, 1));
  rawSocket.emit("state", createFullSnapshot(1, 1));

  assert.deepEqual(firstSubscriberSequences, [1]);
  assert.deepEqual(secondSubscriberSequences, [1]);
});

test("a server-confirmed busy rejoin retries the same identity without delivering room-full errors", (testContext) => {
  const timers = createControlledTimeouts(testContext);
  const { rawSocket, socket } = createTestGameConnection(testContext);
  const joinRequests = [];
  const roomFullEvents = [];
  rawSocket.on("joinGame", (joinRequest) => joinRequests.push(joinRequest));
  socket.onEvent("roomFull", (roomFullPayload) => roomFullEvents.push(roomFullPayload));

  socket.send("joinGame", { gameId: "rejoin-fixture", rejoinToken: "saved-owner-token" });
  rawSocket.emit("roomFull", { gameId: "rejoin-fixture", rejoinPending: true });
  assert.deepEqual(roomFullEvents, []);
  timers.tick(499);
  assert.equal(joinRequests.length, 1);
  timers.tick(1);
  assert.deepEqual(joinRequests, [
    { gameId: "rejoin-fixture", rejoinToken: "saved-owner-token" },
    { gameId: "rejoin-fixture", rejoinToken: "saved-owner-token" },
  ]);

  rawSocket.emit("gameJoined", { gameId: "rejoin-fixture", playerId: "left", rejoinToken: "saved-owner-token" });
  timers.tick(25000);
  assert.equal(joinRequests.length, 2);
  assert.deepEqual(roomFullEvents, []);
});

test("a rejoin that stays occupied stops retrying after twenty seconds and reports failure once per subscriber", (testContext) => {
  const timers = createControlledTimeouts(testContext);
  const { rawSocket, socket } = createTestGameConnection(testContext);
  let joinCount = 0;
  const firstSubscriberEvents = [];
  const secondSubscriberEvents = [];
  const pendingPayload = { gameId: "occupied-fixture", rejoinPending: true };
  rawSocket.on("joinGame", () => {
    joinCount += 1;
    rawSocket.emit("roomFull", { ...pendingPayload });
    rawSocket.emit("roomFull", { ...pendingPayload });
  });
  socket.onEvent("roomFull", (roomFullPayload) => firstSubscriberEvents.push(roomFullPayload));
  socket.onEvent("roomFull", (roomFullPayload) => secondSubscriberEvents.push(roomFullPayload));
  socket.send("joinGame", { gameId: "occupied-fixture", rejoinToken: "saved-owner-token" });

  for (let elapsedMs = 0; elapsedMs < 19500; elapsedMs += 500) {
    timers.tick(500);
  }
  assert.deepEqual(firstSubscriberEvents, []);
  assert.deepEqual(secondSubscriberEvents, []);
  assert.equal(joinCount, 40);
  timers.tick(500);
  assert.deepEqual(firstSubscriberEvents, [{ gameId: "occupied-fixture" }]);
  assert.deepEqual(secondSubscriberEvents, [{ gameId: "occupied-fixture" }]);

  rawSocket.emit("roomFull", { ...pendingPayload });
  timers.tick(25000);
  assert.equal(joinCount, 40);
  assert.equal(firstSubscriberEvents.length, 1);
  assert.equal(secondSubscriberEvents.length, 1);
});

test("ordinary full-room failures reach the client immediately without retries", (testContext) => {
  const timers = createControlledTimeouts(testContext);
  const { rawSocket, socket } = createTestGameConnection(testContext);
  let joinCount = 0;
  const roomFullEvents = [];
  rawSocket.on("joinGame", () => { joinCount += 1; });
  socket.onEvent("roomFull", (roomFullPayload) => roomFullEvents.push(roomFullPayload));
  socket.send("joinGame", { gameId: "full-fixture" });
  rawSocket.emit("roomFull");
  timers.tick(25000);

  assert.deepEqual(roomFullEvents, [undefined]);
  assert.equal(joinCount, 1);
});

test("retry metadata without a submitted rejoin token cannot start a retry loop", (testContext) => {
  const timers = createControlledTimeouts(testContext);
  const { rawSocket, socket } = createTestGameConnection(testContext);
  let joinCount = 0;
  const roomFullEvents = [];
  rawSocket.on("joinGame", () => { joinCount += 1; });
  socket.onEvent("roomFull", (roomFullPayload) => roomFullEvents.push(roomFullPayload));
  socket.send("joinGame", { gameId: "newcomer-fixture" });
  const roomFullPayload = { gameId: "newcomer-fixture", rejoinPending: true, retryAfterMs: 0 };
  rawSocket.emit("roomFull", roomFullPayload);
  timers.tick(25000);

  assert.deepEqual(roomFullEvents, [roomFullPayload]);
  assert.equal(joinCount, 1);
});

test("rejoin recovery expires even if the server stops answering retry requests", (testContext) => {
  const timers = createControlledTimeouts(testContext);
  const { rawSocket, socket } = createTestGameConnection(testContext);
  let joinCount = 0;
  const roomFullEvents = [];
  rawSocket.on("joinGame", () => { joinCount += 1; });
  socket.onEvent("roomFull", (roomFullPayload) => roomFullEvents.push(roomFullPayload));
  socket.send("joinGame", { gameId: "silent-fixture", rejoinToken: "saved-owner-token" });
  rawSocket.emit("roomFull", { gameId: "silent-fixture", rejoinPending: true });
  timers.tick(500);
  assert.equal(joinCount, 2);
  timers.tick(19500);

  assert.deepEqual(roomFullEvents, [{ gameId: "silent-fixture" }]);
  assert.equal(joinCount, 2);
});

test("a final room rejection cannot be restarted by delayed retry metadata", (testContext) => {
  const timers = createControlledTimeouts(testContext);
  const { rawSocket, socket } = createTestGameConnection(testContext);
  let joinCount = 0;
  const roomFullEvents = [];
  rawSocket.on("joinGame", () => { joinCount += 1; });
  socket.onEvent("roomFull", (roomFullPayload) => roomFullEvents.push(roomFullPayload));
  socket.send("joinGame", { gameId: "rejected-fixture", rejoinToken: "saved-owner-token" });
  rawSocket.emit("roomFull", { gameId: "rejected-fixture", rejoinPending: true });
  timers.tick(500);
  rawSocket.emit("roomFull");
  rawSocket.emit("roomFull", { gameId: "rejected-fixture", rejoinPending: true });
  timers.tick(25000);

  assert.deepEqual(roomFullEvents, [undefined]);
  assert.equal(joinCount, 2);
});

for (const cancelAction of ["disconnect", "destroy", "another-room"]) {
  test(`pending room rejoin cancels on ${cancelAction}`, (testContext) => {
    const timers = createControlledTimeouts(testContext);
    const { rawSocket, socket } = createTestGameConnection(testContext);
    const joinRequests = [];
    const roomFullEvents = [];
    rawSocket.on("joinGame", (joinRequest) => joinRequests.push(joinRequest));
    socket.onEvent("roomFull", (roomFullPayload) => roomFullEvents.push(roomFullPayload));
    socket.send("joinGame", { gameId: "cancel-fixture", rejoinToken: "saved-owner-token" });
    rawSocket.emit("roomFull", { gameId: "cancel-fixture", rejoinPending: true });

    if (cancelAction === "disconnect") {
      rawSocket.connected = false;
      rawSocket.emit("disconnect");
    } else if (cancelAction === "destroy") {
      socket.destroy();
    } else {
      socket.send("joinGame", { gameId: "another-fixture" });
      rawSocket.emit("roomFull", { gameId: "cancel-fixture", rejoinPending: true });
    }
    timers.tick(25000);

    assert.deepEqual(roomFullEvents, []);
    assert.deepEqual(joinRequests.map((joinRequest) => joinRequest.gameId), cancelAction === "another-room"
      ? ["cancel-fixture", "another-fixture"]
      : ["cancel-fixture"]);
  });
}
