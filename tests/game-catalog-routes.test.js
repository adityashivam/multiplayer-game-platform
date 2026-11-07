import test from "node:test";
import assert from "node:assert/strict";
import { createGameRegistry } from "../server/platform-backend-engine/core/gameRegistry.js";
import { registerGameCatalogRoutes } from "../server/platform-backend-server/gameCatalogRoutes.js";

function createCatalogHandlers() {
  const gameRegistry = createGameRegistry(Array.from({ length: 30 }, (_, index) => ({
    apiVersion: 1,
    meta: {
      id: `custom-${index}`,
      name: `Custom ${String(index).padStart(2, "0")}`,
      path: `/games/custom-${index}`,
      tags: [index % 2 === 0 ? "Action" : "Strategy"],
      networked: false,
    },
  })));
  const catalogHandlers = new Map();
  registerGameCatalogRoutes({ get: (route, handler) => catalogHandlers.set(route, handler) }, gameRegistry);
  return catalogHandlers;
}

function requestCatalog(handler, overrides = {}) {
  const request = { query: {}, params: {}, protocol: "https", get: () => "games.example", ...overrides };
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
  handler(request, response);
  return response;
}

test("unparameterized catalog remains compatible while paged requests are bounded", () => {
  const handlers = createCatalogHandlers();
  const legacyResponse = requestCatalog(handlers.get("/api/games"));
  assert.equal(legacyResponse.body.games.length, 30);
  assert.equal(legacyResponse.body.games[0].url, "https://games.example/games/custom-0");
  assert.equal(legacyResponse.body.games[0].networked, false);

  const pagedResponse = requestCatalog(handlers.get("/api/games"), { query: { page: "2" } });
  assert.equal(pagedResponse.statusCode, 200);
  assert.equal(pagedResponse.body.games.length, 6);
  assert.equal(pagedResponse.body.total, 30);
  assert.equal(pagedResponse.body.games[0].id, "custom-24");
});

test("a game beyond the first catalog page resolves directly and unknown IDs return 404", () => {
  const handlers = createCatalogHandlers();
  const gameResponse = requestCatalog(handlers.get("/api/games/:gameId"), { params: { gameId: "custom-29" } });
  assert.equal(gameResponse.body.game.id, "custom-29");
  assert.equal(gameResponse.body.game.path, "/games/custom-29");
  const missingResponse = requestCatalog(handlers.get("/api/games/:gameId"), { params: { gameId: "missing" } });
  assert.equal(missingResponse.statusCode, 404);
});

test("invalid catalog query returns a 400 response rather than unbounded data", () => {
  const handlers = createCatalogHandlers();
  const response = requestCatalog(handlers.get("/api/games"), { query: { page: "bad" } });
  assert.equal(response.statusCode, 400);
  assert.equal(typeof response.body.error, "string");
  assert.equal(response.body.games, undefined);
});
