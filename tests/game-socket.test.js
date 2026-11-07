import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

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
