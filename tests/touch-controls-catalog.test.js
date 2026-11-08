import test from "node:test";
import assert from "node:assert/strict";
import { createGameCatalog, parseGameCatalogQuery } from "../public/platform/shared/gameCatalog.js";
import { createGameRegistry } from "../server/platform-backend-engine/core/gameRegistry.js";
import { registerGameCatalogRoutes } from "../server/platform-backend-server/gameCatalogRoutes.js";
import { createBuiltInGameRegistry } from "../server/platform-backend-engine/games/builtInGames.js";
import { fallbackGames } from "../public/platform/src/data/games.js";
import { createDefaultTouchProfile, resolveTouchLayout } from "../public/platform/shared/touchControls.js";

function createTouchDescriptor(customizable = true) {
  return {
    apiVersion: 1,
    customizable,
    defaultPreset: "two-thumb",
    allowedPresets: ["two-thumb", "three-finger", "four-finger"],
    controls: [{ id: "paddle", type: "stick", role: "move", label: "Move paddle" }],
  };
}

function createGamePlugins() {
  return Array.from({ length: 125 }, (_, index) => ({
    apiVersion: 1,
    meta: {
      id: `relay-${index}`,
      name: `Relay ${String(index).padStart(3, "0")}`,
      path: `/games/relay-${index}`,
      networked: false,
      ...(index % 3 === 0 ? { touchControls: createTouchDescriptor() } : index % 3 === 1 ? { touchControls: createTouchDescriptor(false) } : {}),
    },
  }));
}

test("registry validates all touch descriptors before any game callback mounts", () => {
  let mounted = false;
  const validPlugin = createGamePlugins()[0];
  validPlugin.register = () => { mounted = true; };
  const invalidPlugin = createGamePlugins()[1];
  invalidPlugin.meta.touchControls.controls[0].defaultLayout = { size: Infinity };
  assert.throws(() => createGameRegistry([validPlugin, invalidPlugin]).registerGames({ of() {} }), TypeError);
  assert.equal(mounted, false);

  const registry = createGameRegistry([validPlugin]);
  validPlugin.meta.touchControls.controls[0].label = "Changed";
  const publicGame = registry.getGame("relay-0");
  assert.equal(publicGame.touchControls.controls[0].label, "Move paddle");
  publicGame.touchControls.controls[0].label = "Changed again";
  assert.equal(registry.getGame("relay-0").touchControls.controls[0].label, "Move paddle");
});

test("customizable filtering covers the complete catalog before bounded pagination", () => {
  const catalog = createGameCatalog(createGamePlugins().map((plugin) => plugin.meta));
  const page = catalog.query({ customizable: true, page: 2, pageSize: 10 });
  assert.equal(page.total, 42);
  assert.equal(page.totalPages, 5);
  assert.equal(page.games.length, 10);
  assert.equal(page.games[0].id, "relay-30");
  assert.ok(page.games.every((game) => game.touchControls.customizable === true));
  assert.deepEqual(catalog.query({ customizable: true, q: "Relay 123" }).games.map((game) => game.id), ["relay-123"]);
  assert.equal(catalog.query({ customizable: false }).total, 125);
  assert.equal(catalog.query().total, 125);
});

test("catalog parses an explicit customizable filter without changing default query fields", () => {
  assert.equal(parseGameCatalogQuery({ customizable: "true" }).customizable, true);
  assert.equal(parseGameCatalogQuery({ customizable: "false" }).customizable, false);
  assert.equal(Object.hasOwn(parseGameCatalogQuery(), "customizable"), false);
  for (const customizable of ["yes", 1, ["true"], null]) {
    assert.throws(() => parseGameCatalogQuery({ customizable }), TypeError);
  }
});

test("catalog page and direct lookup advertise owned optional touch metadata", () => {
  const registry = createGameRegistry(createGamePlugins());
  const handlers = new Map();
  registerGameCatalogRoutes({ get: (path, handler) => handlers.set(path, handler) }, registry);
  const request = { protocol: "https", get: () => "games.example", query: { customizable: "true", pageSize: "3" } };
  const response = { json(body) { this.body = body; return this; }, status(code) { this.statusCode = code; return this; } };
  handlers.get("/api/games")(request, response);
  assert.equal(response.body.total, 42);
  assert.equal(response.body.games.length, 3);
  assert.equal(response.body.games[0].touchControls.customizable, true);
  response.body.games[0].touchControls.controls[0].label = "Changed response";

  handlers.get("/api/games/:gameId")({ ...request, params: { gameId: "relay-0" } }, response);
  assert.equal(response.body.game.touchControls.controls[0].label, "Move paddle");
  handlers.get("/api/games/:gameId")({ ...request, params: { gameId: "relay-2" } }, response);
  assert.equal(Object.hasOwn(response.body.game, "touchControls"), false);
});

test("every bundled catalog entry advertises its supported customizable touch controls", () => {
  const registry = createBuiltInGameRegistry();
  const games = registry.listGames();
  assert.equal(games.length, 11);
  assert.equal(createGameCatalog(games).query({ customizable: true }).total, 11);
  for (const game of games) {
    assert.equal(game.touchControls?.customizable, true, `${game.id} must support touch layout editing`);
    assert.equal(game.touchControls.apiVersion, 1);
    const fallbackGame = fallbackGames.find((candidate) => candidate.id === game.id);
    assert.deepEqual(fallbackGame.touchControls, game.touchControls, `${game.id} offline metadata must match the server`);
    const layout = resolveTouchLayout(game.touchControls, createDefaultTouchProfile(game.touchControls));
    assert.ok(layout.every((control) => control.opacity <= 0.4), `${game.id} controls must start translucent`);
  }

  const expectedBindings = {
    ludo: ["a"],
    fight: ["horizontal", "up", "down", "a", "x", "b", "y"],
    pong: ["vertical"],
    mario: ["horizontal", "a", "b"],
    "mario-touch": ["horizontal", "a", "b"],
    roadrash: ["horizontal", "up", "down", "x", "b"],
    draw: ["x"],
    "webgl-sample": ["horizontal", "a"],
  };
  for (const [gameId, bindings] of Object.entries(expectedBindings)) {
    const game = registry.getGame(gameId);
    assert.deepEqual(game.touchControls.controls.map((control) => control.platformBinding), bindings, `${gameId} should bind only supported inputs`);
  }
  const drawControls = registry.getGame("draw").touchControls.controls;
  assert.equal(drawControls.length, 1);
  assert.equal(drawControls[0].type, "button");
  assert.equal(drawControls[0].label, "Clear");
  for (const gameId of ["dead-shift", "sky-dash", "riftball"]) {
    assert.ok(registry.getGame(gameId).touchControls.controls.every((control) => control.platformBinding === undefined));
  }
});
