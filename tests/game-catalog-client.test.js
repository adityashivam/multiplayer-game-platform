import test from "node:test";
import assert from "node:assert/strict";
import { requestGameCatalogPage, requestCatalogGame } from "../public/platform/src/platform-ui/services/gameCatalogClient.js";

test("browser catalog client always requests a bounded page and encodes search parameters", async () => {
  let requestedUrl;
  let requestedSignal;
  const abortController = new AbortController();
  const page = await requestGameCatalogPage({ q: "race & run", genre: "action", page: 2 }, {
    signal: abortController.signal,
    fetchRequest: async (url, options) => {
      requestedUrl = new URL(url, "https://games.example");
      requestedSignal = options.signal;
      return Response.json({ games: [{ id: "relay", name: "Relay", path: "/games/relay" }], total: 25, page: 2, pageSize: 24, totalPages: 2, genres: [] });
    },
  });
  assert.equal(requestedUrl.pathname, "/api/games");
  assert.equal(requestedUrl.searchParams.get("pageSize"), "24");
  assert.equal(requestedUrl.searchParams.get("q"), "race & run");
  assert.equal(requestedSignal, abortController.signal);
  assert.equal(page.games[0].id, "relay");
});

test("catalog client rejects unbounded or malformed page responses", async () => {
  for (const payload of [
    { games: Array(25).fill({ id: "a", name: "A", path: "/games/a" }), total: 25, page: 1, pageSize: 24, totalPages: 2, genres: [] },
    { games: [], total: -1, page: 1, pageSize: 24, totalPages: 1, genres: [] },
    { games: [], total: 0, page: 1, pageSize: 24, totalPages: 1, genres: [{ value: 1, label: "bad" }] },
  ]) {
    await assert.rejects(requestGameCatalogPage({}, { fetchRequest: async () => Response.json(payload) }), /catalog/i);
  }
});

test("individual lookup is independent of pages and distinguishes unknown games from request failures", async () => {
  let requestedUrl;
  const game = await requestCatalogGame("custom-9999", { fetchRequest: async (url) => {
    requestedUrl = url;
    return Response.json({ game: { id: "custom-9999", name: "Faraway Game", path: "/games/custom-9999" } });
  } });
  assert.equal(requestedUrl, "/api/games/custom-9999");
  assert.equal(game.id, "custom-9999");
  assert.equal(await requestCatalogGame("missing", { fetchRequest: async () => new Response(null, { status: 404 }) }), null);
  await assert.rejects(requestCatalogGame("broken", { fetchRequest: async () => new Response(null, { status: 503 }) }), /game/i);
});
