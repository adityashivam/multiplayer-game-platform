import test from "node:test";
import assert from "node:assert/strict";
import { createBuiltInGameRegistry } from "../server/platform-backend-engine/games/builtInGames.js";
import { getGamesStore } from "../server/platform-backend-engine/core/gameStore.js";

/** Mount actual package callbacks without leaving any scheduler timers running. */
function registerCatalogTestNamespaces() {
  const namespaces = new Map();
  const io = {
    of(namespaceName) {
      if (!namespaces.has(namespaceName)) {
        const namespace = {
          sockets: new Map(), adapter: { rooms: new Map() },
          on(_eventName, connectSocket) { this.connectSocket = connectSocket; },
          to: () => ({ emit() {} }),
        };
        namespaces.set(namespaceName, namespace);
      }
      return namespaces.get(namespaceName);
    },
  };
  const registry = createBuiltInGameRegistry();
  const originalSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = () => 0;
  try {
    registry.registerGames(io);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }
  return { namespaces, registry };
}

function connectCatalogPlayer(namespace, socketId) {
  const handlers = {};
  const socket = {
    id: socketId, nsp: namespace, data: {},
    on: (eventName, callback) => { handlers[eventName] = callback; },
    emit() {}, to: () => ({ emit() {} }),
    join(roomId) {
      if (!namespace.adapter.rooms.has(roomId)) namespace.adapter.rooms.set(roomId, new Set());
      namespace.adapter.rooms.get(roomId).add(socketId);
    },
    leave: (roomId) => namespace.adapter.rooms.get(roomId)?.delete(socketId),
  };
  namespace.sockets.set(socketId, socket);
  namespace.connectSocket(socket);
  handlers.joinGame({ gameId: "ownership" });
  return { handlers, socket };
}

test("all continuous multiplayer catalog entries advertise their queued schema and shared cadence", () => {
  const { registry } = registerCatalogTestNamespaces();
  const games = registry.listGames();
  const movementGames = games.filter((game) => game.networked !== false && game.networking?.inputProtocol != null);
  assert.equal(movementGames.length, 8);
  for (const game of movementGames) {
    assert.equal(game.networking.inputProtocol, 2, game.id);
    assert.ok(Object.keys(game.networking.inputTemplate).length > 0, game.id);
    assert.equal(game.networking.tickRateHz, 60, game.id);
  }
  assert.equal(games.find((game) => game.id === "draw").networking.inputProtocol, null);
  assert.equal(games.find((game) => game.id === "ludo").networking.inputProtocol, null);
  assert.equal(games.find((game) => game.id === "webgl-sample").networked, false);
});

for (const gameId of ["fight", "pong", "dead-shift", "sky-dash", "riftball", "mario", "mario-touch", "roadrash"]) {
  test(`${gameId} pauses both command owners and rejects in-flight commands from before a disconnect`, () => {
    const { namespaces, registry } = registerCatalogTestNamespaces();
    const game = registry.getGame(gameId);
    const namespace = namespaces.get(game.namespace);
    const firstClient = connectCatalogPlayer(namespace, `${gameId}-first`);
    const secondClient = connectCatalogPlayer(namespace, `${gameId}-second`);
    const state = getGamesStore(namespace).get("ownership");
    const player = state.players.p1;
    const previousEpoch = player.inputEpoch;
    const heldInput = Object.fromEntries(Object.entries(game.networking.inputTemplate).map(([key, value]) => [key, typeof value === "boolean" ? true : value]));
    const oldFrame = { type: "inputFrame", protocol: 2, epoch: previousEpoch, seq: 1, state: heldInput };
    firstClient.handlers.input(oldFrame);
    assert.ok(player.__inputBuffer.queue.length > 0, "fixture has an outstanding old command");
    secondClient.handlers.disconnect();
    assert.equal(state.started, false);
    assert.ok(player.inputEpoch > previousEpoch, "the remaining owner also receives a new epoch");
    assert.equal(player.__inputBuffer?.queue.length ?? 0, 0);
    firstClient.handlers.input(oldFrame);
    assert.equal(player.__inputBuffer?.queue.length ?? 0, 0, "late old-epoch commands cannot reactivate controls");
    assert.equal(player.lastInputSeqAck, 0);
  });
}
