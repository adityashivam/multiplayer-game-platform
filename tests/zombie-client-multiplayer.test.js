import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Keep the real networking session, command predictor and interpolator. Replace
// only the live socket boundary; browser-root module URLs resolve to local files.
const multiplayerUrl = new URL("../public/games/dead-shift/client/multiplayer.js", import.meta.url);
const socketModuleUrl = `data:text/javascript,${encodeURIComponent("export function getGameSocket() { return globalThis.__deadShiftClientTestSocket; }")}`;
const multiplayerSource = (await readFile(multiplayerUrl, "utf8")).replace(/from "([^"]+)"/g, (_match, modulePath) => {
  if (modulePath === "/platform/frontend-engine/gameSocket.js") return `from "${socketModuleUrl}"`;
  const resolvedUrl = modulePath.startsWith("/platform/")
    ? new URL(`../public${modulePath}`, import.meta.url)
    : new URL(modulePath, multiplayerUrl);
  return `from "${resolvedUrl.href}"`;
});
const { createDeadShiftMultiplayerSession } = await import(`data:text/javascript,${encodeURIComponent(multiplayerSource)}`);

function createMultiplayerEnvironment(testContext, { pathname = "/games/dead-shift/", fetchRoom } = {}) {
  const previousGlobals = { window: globalThis.window, sessionStorage: globalThis.sessionStorage, fetch: globalThis.fetch, __deadShiftClientTestSocket: globalThis.__deadShiftClientTestSocket };
  const sentPackets = [];
  const socketListeners = new Map();
  let connected = true;
  const socket = {
    send: (eventName, payload) => sentPackets.push({ eventName, payload }),
    isConnected: () => connected,
    getConnectionSnapshot: () => ({ status: connected ? "connected" : "disconnected", ping: null }),
    onConnectionChange(listener) { listener(this.getConnectionSnapshot()); return () => {}; },
    onEvent(eventName, listener) {
      if (!socketListeners.has(eventName)) socketListeners.set(eventName, new Set());
      socketListeners.get(eventName).add(listener);
      return () => socketListeners.get(eventName)?.delete(listener);
    },
    destroy() { connected = false; socketListeners.clear(); },
  };
  const gameWindow = new EventTarget();
  gameWindow.location = { pathname };
  gameWindow.history = { replaceState: (_state, _title, nextPathname) => { gameWindow.location.pathname = nextPathname; } };
  const announcedRooms = [];
  gameWindow.addEventListener("kaboom:room-ready", (event) => announcedRooms.push(event.detail.roomId));
  const storage = new Map();
  globalThis.window = gameWindow;
  globalThis.sessionStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  globalThis.fetch = fetchRoom || (() => assert.fail("A known room must not create another room"));
  globalThis.__deadShiftClientTestSocket = socket;
  const errors = [];
  let resetCount = 0;
  const session = createDeadShiftMultiplayerSession({
    controls: { reset() { resetCount += 1; }, capture() { assert.fail("No authority has been supplied"); } },
    onState() {}, onReset() {}, onJoined() {}, onRematchRequested() {},
    onError: (message, retry) => errors.push({ message, retry }),
  });
  testContext.after(() => {
    session.dispose();
    for (const [globalName, previousValue] of Object.entries(previousGlobals)) {
      if (previousValue === undefined) delete globalThis[globalName];
      else globalThis[globalName] = previousValue;
    }
  });

  return {
    session, errors, sentPackets, announcedRooms, gameWindow, storage,
    getResetCount: () => resetCount,
    emitServerEvent(eventName, payload) {
      if (eventName === "disconnect") connected = false;
      if (eventName === "connect") connected = true;
      for (const listener of socketListeners.get(eventName) || []) listener(payload);
    },
  };
}

test("concurrent create-room retries retain one room and reconnect with its matching token", async (testContext) => {
  let requestCount = 0;
  let resolveRoomRequest;
  const pendingRoomResponse = new Promise((resolve) => { resolveRoomRequest = resolve; });
  const environment = createMultiplayerEnvironment(testContext, {
    fetchRoom: () => {
      requestCount += 1;
      return requestCount === 1 ? Promise.reject(new Error("Temporary create failure")) : pendingRoomResponse;
    },
  });
  await new Promise(setImmediate);
  assert.equal(environment.errors.length, 1);
  const firstRetry = environment.errors[0].retry();
  const secondRetry = environment.errors[0].retry();
  assert.equal(requestCount, 2, "the initial failure and one shared retry are the only room requests");
  resolveRoomRequest({ ok: true, json: async () => ({ roomId: "room123" }) });
  await Promise.all([firstRetry, secondRetry]);
  environment.emitServerEvent("gameJoined", { gameId: "room123", playerId: "p1", rejoinToken: "room123-token" });
  environment.emitServerEvent("disconnect");
  environment.emitServerEvent("connect");

  assert.deepEqual(environment.sentPackets, [
    { eventName: "joinGame", payload: { gameId: "room123", rejoinToken: undefined } },
    { eventName: "joinGame", payload: { gameId: "room123", rejoinToken: "room123-token" } },
  ]);
  assert.equal(environment.gameWindow.location.pathname, "/games/dead-shift/room123");
  assert.ok(environment.announcedRooms.every((roomId) => roomId === "room123"));
  assert.equal(environment.storage.get("rejoinToken:dead-shift:room123"), "room123-token");
});

test("terminal room-full retry sends one new join and disconnect resets input ownership", (testContext) => {
  const environment = createMultiplayerEnvironment(testContext, { pathname: "/games/dead-shift/full123" });
  assert.equal(environment.sentPackets.length, 1);
  environment.emitServerEvent("roomFull", { gameId: "full123" });
  assert.equal(environment.errors.length, 1);
  environment.errors[0].retry();
  environment.errors[0].retry();
  assert.equal(environment.sentPackets.length, 2);
  environment.emitServerEvent("gameJoined", { gameId: "full123", playerId: "p2", rejoinToken: "operator-token" });
  const resetCountBeforeDisconnect = environment.getResetCount();
  environment.emitServerEvent("disconnect");
  assert.ok(environment.getResetCount() > resetCountBeforeDisconnect);
  environment.emitServerEvent("connect");
  assert.deepEqual(environment.sentPackets.at(-1), {
    eventName: "joinGame", payload: { gameId: "full123", rejoinToken: "operator-token" },
  });
});
