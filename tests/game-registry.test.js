import test from "node:test";
import assert from "node:assert/strict";
import * as engine from "../server/platform-backend-engine/core/index.js";

function createSyntheticPlugin(overrides = {}) {
  return {
    apiVersion: 1,
    meta: {
      id: "relay",
      name: "Relay",
      description: "A synthetic three-player game.",
      path: "/games/relay",
      namespace: "/relay",
      room: { playerIds: ["pilot", "navigator", "engineer"] },
      networking: {
        namespace: "/relay",
        tickRateHz: 30,
        inputProtocol: 2,
        inputTemplate: { accelerate: false, brake: false },
      },
    },
    register() {},
    ...overrides,
  };
}

function createRegistry(plugins) {
  assert.equal(typeof engine.createGameRegistry, "function", "the engine exposes trusted game registration");
  return engine.createGameRegistry(plugins);
}

test("registry advertises owned bounded numeric input capabilities", () => {
  const plugin = createSyntheticPlugin();
  plugin.meta.networking.inputTemplate = { drive: 0, tool: 1, boost: false };
  plugin.meta.networking.numericInputs = {
    drive: { min: -1, max: 1 }, tool: { min: 0, max: 3, integer: true },
  };
  const registry = createRegistry([plugin]);
  plugin.meta.networking.numericInputs.drive.max = 9;

  const catalogGame = registry.getGame("relay");
  assert.deepEqual(catalogGame.networking.inputTemplate, { drive: 0, tool: 1, boost: false });
  assert.deepEqual(catalogGame.networking.numericInputs, {
    drive: { min: -1, max: 1 }, tool: { min: 0, max: 3, integer: true },
  });
  catalogGame.networking.numericInputs.tool.max = 99;
  assert.equal(registry.getGame("relay").networking.numericInputs.tool.max, 3);
});

test("registry rejects numeric capabilities with missing ranges, invalid defaults or passive protocols", () => {
  for (const networking of [
    { inputTemplate: { drive: 0 } },
    { inputTemplate: { drive: 0 }, numericInputs: { drive: { min: -1, max: NaN } } },
    { inputTemplate: { drive: 2 }, numericInputs: { drive: { min: -1, max: 1 } } },
    { inputTemplate: { tool: 0.5 }, numericInputs: { tool: { min: 0, max: 3, integer: true } } },
    { inputTemplate: { drive: 0 }, numericInputs: { drive: { min: -1, max: 1, unknown: true } } },
    { inputTemplate: { boost: false }, numericInputs: { missing: { min: 0, max: 1 } } },
    { inputProtocol: null, inputTemplate: null, numericInputs: { drive: { min: -1, max: 1 } } },
  ]) {
    const plugin = createSyntheticPlugin();
    Object.assign(plugin.meta.networking, networking);
    assert.throws(() => createRegistry([plugin]), { name: "TypeError" });
  }
});

test("registry preserves optional game-owned library presentation", () => {
  const plugin = createSyntheticPlugin();
  plugin.meta.presentation = {
    coverUrl: "/games/relay/assets/cover.svg",
    accentColor: "#123ABC",
    controls: ["keyboard", "touch"],
  };
  const registry = createRegistry([plugin]);
  plugin.meta.presentation.controls.push("pointer");

  assert.deepEqual(registry.listGames()[0].presentation, {
    coverUrl: "/games/relay/assets/cover.svg",
    accentColor: "#123ABC",
    controls: ["keyboard", "touch"],
  });
});

for (const presentation of [
  null,
  [],
  { coverUrl: "javascript:alert(1)" },
  { coverUrl: "//example.com/cover.svg" },
  { accentColor: "red; color: transparent" },
  { controls: ["imaginary-controller"] },
  { controls: "keyboard" },
  { controls: [["keyboard"]] },
]) {
  test(`registry rejects invalid library presentation ${JSON.stringify(presentation)}`, () => {
    const plugin = createSyntheticPlugin();
    plugin.meta.presentation = presentation;

    assert.throws(() => createRegistry([plugin]), /presentation/);
  });
}

test("registry exposes synthetic game capabilities without retaining mutable catalog ownership", () => {
  const plugin = createSyntheticPlugin();
  const registry = createRegistry([plugin, {
    apiVersion: 1,
    meta: { id: "offline", name: "Offline", path: "/games/offline", networked: false },
  }]);

  assert.deepEqual(registry.listGames().map((game) => game.id), ["relay", "offline"]);
  assert.deepEqual(registry.getGame("relay").room.playerIds, ["pilot", "navigator", "engineer"]);
  assert.equal(registry.getGame("relay").networking.tickRateHz, 30);
  assert.equal(registry.getGame("missing"), undefined);

  plugin.meta.room.playerIds.push("intruder");
  registry.listGames()[0].networking.inputTemplate.accelerate = true;
  registry.getGame("relay").room.playerIds.length = 0;

  assert.deepEqual(registry.getGame("relay").room.playerIds, ["pilot", "navigator", "engineer"]);
  assert.equal(registry.getGame("relay").networking.inputTemplate.accelerate, false);
});

for (const [description, createRuntime] of [
  ["BigInt", () => ({ minimumScore: 1n })],
  ["circular", () => {
    const runtime = { mode: "relay" };
    runtime.settings = runtime;
    return runtime;
  }],
  ["function-valued", () => ({ createSettings() {} })],
]) {
  test(`registry rejects ${description} catalog metadata before mounting any game`, () => {
    const mountedGames = [];
    const validPlugin = createSyntheticPlugin({
      meta: { id: "valid", name: "Valid", path: "/games/valid", namespace: "/valid" },
      register() { mountedGames.push(this.meta.id); },
    });
    const invalidPlugin = createSyntheticPlugin({
      register() { mountedGames.push(this.meta.id); },
    });
    invalidPlugin.meta.runtime = createRuntime();

    assert.throws(() => {
      createRegistry([validPlugin, invalidPlugin]).registerGames({ of() {} });
    }, (error) => error instanceof TypeError &&
      /serializable catalog metadata/.test(error.message) && error.cause instanceof Error);
    assert.deepEqual(mountedGames, []);
  });
}

test("registry preserves shared acyclic, Date, and optional metadata while keeping the catalog JSON serializable", () => {
  const sharedSettings = { zoom: 2 };
  const publishedAt = new Date("2026-11-07T00:00:00.000Z");
  const plugin = createSyntheticPlugin({
    register() {
      this.meta.runtime.primary.zoom = 99;
    },
  });
  plugin.meta.runtime = {
    primary: sharedSettings,
    secondary: sharedSettings,
    publishedAt,
    optionalMode: undefined,
  };
  const registry = createRegistry([plugin]);
  sharedSettings.zoom = 3;
  publishedAt.setUTCFullYear(2027);
  registry.registerGames({ of() {} });

  const catalogMetadata = registry.listGames()[0];
  assert.deepEqual(JSON.parse(JSON.stringify({ games: [catalogMetadata] })).games[0].runtime, {
    primary: { zoom: 2 },
    secondary: { zoom: 2 },
    publishedAt: "2026-11-07T00:00:00.000Z",
  });
  assert.equal(catalogMetadata.runtime.primary, catalogMetadata.runtime.secondary);
  assert.equal(catalogMetadata.runtime.publishedAt instanceof Date, true);
  assert.equal(Object.hasOwn(catalogMetadata.runtime, "optionalMode"), true);
  catalogMetadata.runtime.primary.zoom = 4;
  catalogMetadata.runtime.publishedAt.setUTCFullYear(2028);

  assert.equal(registry.getGame("relay").runtime.primary.zoom, 2);
  assert.equal(registry.getGame("relay").runtime.publishedAt.toISOString(), "2026-11-07T00:00:00.000Z");
});

test("registry mounts a synthetic game that receives room-owned commands", (testContext) => {
  let connectSocket;
  const namespace = {
    adapter: { rooms: new Map() },
    sockets: new Map(),
    on: (_eventName, callback) => { connectSocket = callback; },
    to: () => ({ emit() {} }),
  };
  const plugin = createSyntheticPlugin({
    register(io) {
      engine.registerGame({
        io,
        meta: this.meta,
        createState: () => ({ players: { observer: {}, pilot: { distance: 0 }, navigator: {}, engineer: {} } }),
        handleInput: ({ state, playerId, payload }) => {
          state.players[playerId].distance += payload.distance;
        },
        handleDisconnect: (state, playerId) => {
          state.players[playerId].distance = 0;
        },
      });
    },
  });
  const registry = createRegistry([plugin]);
  const timerMock = testContext.mock.method(globalThis, "setTimeout", () => 0);
  registry.registerGames({ of: () => namespace });
  timerMock.mock.restore();

  const handlers = {};
  const socketEvents = [];
  const socket = {
    id: "synthetic-socket",
    data: {},
    on: (eventName, callback) => { handlers[eventName] = callback; },
    join() {},
    emit: (eventName, payload) => socketEvents.push([eventName, payload]),
    to: () => ({ emit() {} }),
  };
  connectSocket(socket);
  handlers.joinGame({ gameId: "crew" });
  handlers.input({ distance: 7 });

  assert.equal(socketEvents.find(([eventName]) => eventName === "gameJoined")[1].playerId, "pilot");
  assert.equal(engine.getGamesStore(namespace).get("crew").players.pilot.distance, 7);

  socket.leave = () => {};
  handlers.joinGame({ gameId: "next-crew" });
  assert.equal(engine.getGamesStore(namespace).get("crew").players.pilot.distance, 0);
  assert.equal(engine.getGamesStore(namespace).get("crew").players.pilot.connected, false);
  assert.equal(socket.data.gameId, "next-crew");
});

test("registry allows snapshots-only networking capabilities", () => {
  const plugin = createSyntheticPlugin();
  plugin.meta.networking.inputProtocol = null;
  plugin.meta.networking.inputTemplate = null;

  assert.equal(createRegistry([plugin]).getGame("relay").networking.inputProtocol, null);
});

test("game registration uses its declared cadence unless the game explicitly overrides it", (testContext) => {
  const scheduledDelays = [];
  const timerMock = testContext.mock.method(globalThis, "setTimeout", (_callback, delayMs) => {
    scheduledDelays.push(delayMs);
    return 0;
  });
  const io = { of: () => ({ on() {} }) };
  const plugin = createSyntheticPlugin();
  try {
    engine.registerGame({ io, meta: plugin.meta, createState: () => ({ players: {} }) });
    engine.registerGame({ io, meta: plugin.meta, tickMs: 20, createState: () => ({ players: {} }) });
  } finally {
    timerMock.mock.restore();
  }

  assert.deepEqual(scheduledDelays, [1000 / 30, 20]);
});

test("invalid scheduler durations fail before taking namespace or timer ownership", () => {
  const io = { of() { assert.fail("invalid timing must not mount a namespace"); } };
  const plugin = createSyntheticPlugin();
  for (const timingOptions of [{ tickMs: 0 }, { tickMs: NaN }, { dtFallback: -1 }]) {
    assert.throws(() => engine.registerGame({
      io, meta: plugin.meta, createState: () => ({ players: {} }), ...timingOptions,
    }), TypeError);
  }
});

for (const playerId of ["team.red", "01", "0", "__proto__", "constructor", "prototype"]) {
  test(`registry rejects player slot ${playerId} before an incompatible snapshot can be produced`, () => {
    const plugin = createSyntheticPlugin();
    plugin.meta.room.playerIds = [playerId];
    assert.throws(() => createRegistry([plugin]), TypeError);
  });
}

for (const [description, makePlugins] of [
  ["unsupported API versions", () => [createSyntheticPlugin({ apiVersion: 2 })]],
  ["module paths instead of trusted callbacks", () => [createSyntheticPlugin({ register: "./untrusted.js" })]],
  ["missing networked registration", () => [createSyntheticPlugin({ register: undefined })]],
  ["missing metadata", () => [createSyntheticPlugin({ meta: undefined })]],
  ["missing IDs", () => {
    const plugin = createSyntheticPlugin();
    delete plugin.meta.id;
    return [plugin];
  }],
  ["relative paths", () => {
    const plugin = createSyntheticPlugin();
    plugin.meta.path = "games/relay";
    return [plugin];
  }],
  ["missing network namespaces", () => {
    const plugin = createSyntheticPlugin();
    delete plugin.meta.namespace;
    delete plugin.meta.networking;
    return [plugin];
  }],
  ["conflicting namespaces", () => {
    const plugin = createSyntheticPlugin();
    plugin.meta.networking.namespace = "/other";
    return [plugin];
  }],
  ["duplicate IDs", () => [createSyntheticPlugin(), createSyntheticPlugin()]],
  ["duplicate namespaces", () => {
    const plugin = createSyntheticPlugin();
    plugin.meta.id = "other";
    plugin.meta.path = "/games/other";
    return [createSyntheticPlugin(), plugin];
  }],
  ["duplicate client paths", () => {
    const plugin = createSyntheticPlugin();
    plugin.meta.id = "other";
    plugin.meta.namespace = "/other";
    plugin.meta.networking.namespace = "/other";
    return [createSyntheticPlugin(), plugin];
  }],
  ["duplicate player slots", () => {
    const plugin = createSyntheticPlugin();
    plugin.meta.room.playerIds = ["pilot", "pilot"];
    return [plugin];
  }],
  ["empty player capacity", () => {
    const plugin = createSyntheticPlugin();
    plugin.meta.room.playerIds = [];
    return [plugin];
  }],
  ["invalid simulation cadence", () => {
    const plugin = createSyntheticPlugin();
    plugin.meta.networking.tickRateHz = 0;
    return [plugin];
  }],
  ["invalid input templates", () => {
    const plugin = createSyntheticPlugin();
    plugin.meta.networking.inputTemplate.accelerate = "yes";
    return [plugin];
  }],
  ["active input without a template", () => {
    const plugin = createSyntheticPlugin();
    delete plugin.meta.networking.inputTemplate;
    return [plugin];
  }],
  ["active input with an empty template", () => {
    const plugin = createSyntheticPlugin();
    plugin.meta.networking.inputTemplate = {};
    return [plugin];
  }],
  ["passive networking with an input template", () => {
    const plugin = createSyntheticPlugin();
    plugin.meta.networking.inputProtocol = null;
    return [plugin];
  }],
]) {
  test(`registry rejects ${description} before any game is mounted`, () => {
    let mounted = false;
    const validPlugin = createSyntheticPlugin({
      meta: { id: "valid", name: "Valid", path: "/games/valid", namespace: "/valid" },
      register() { mounted = true; },
    });

    assert.throws(() => createRegistry([validPlugin, ...makePlugins()]), { name: "TypeError" });
    assert.equal(mounted, false);
  });
}
