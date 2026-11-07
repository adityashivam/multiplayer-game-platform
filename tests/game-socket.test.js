import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { tickGames } from "../server/platform-backend-engine/core/gameLoop.js";

// Resolve browser and relative module imports when loading the client in Node.
const require = createRequire(import.meta.url);
const parserUrl = pathToFileURL(require.resolve("socket.io-msgpack-parser")).href;
const gameSocketUrl = new URL("../public/platform/frontend-engine/gameSocket.js", import.meta.url);
const protocolUrl = new URL("../shared/networkProtocol.js", gameSocketUrl).href;
const gameSocketSource = (await readFile(gameSocketUrl, "utf8"))
  .replace('"/platform/frontend-engine/msgpackParser.js"', JSON.stringify(parserUrl))
  .replace('"../shared/networkProtocol.js"', JSON.stringify(protocolUrl));
const { getGameSocket } = await import(`data:text/javascript;base64,${Buffer.from(gameSocketSource).toString("base64")}`);

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
