import test from "node:test";
import assert from "node:assert/strict";
import { createGameCatalog, parseGameCatalogQuery } from "../public/platform/shared/gameCatalog.js";

const largeCatalogGames = Array.from({ length: 10000 }, (_, index) => ({
  id: `game-${index}`,
  name: `Game ${String(index).padStart(5, "0")}`,
  description: index === 9999 ? "Find the distant orbital relay." : "An arcade game.",
  tags: [index % 2 === 0 ? "Action" : "Strategy", "2 players"],
  path: `/games/game-${index}`,
}));

test("a 10,000-game catalog returns a bounded page with exact global totals", () => {
  const catalog = createGameCatalog(largeCatalogGames);
  const page = catalog.query({ page: 2 });

  assert.equal(page.games.length, 24);
  assert.equal(page.total, 10000);
  assert.equal(page.totalPages, 417);
  assert.equal(page.games[0].id, "game-24");
  assert.equal(page.games[23].id, "game-47");
});

test("catalog search and genre filtering cover games beyond the first page", () => {
  const catalog = createGameCatalog(largeCatalogGames);
  const searchPage = catalog.query({ q: "orbital relay", genre: "strategy" });

  assert.deepEqual(searchPage.games.map((game) => game.id), ["game-9999"]);
  assert.equal(searchPage.total, 1);
  assert.deepEqual(searchPage.genres, [
    { value: "action", label: "Action" },
    { value: "strategy", label: "Strategy" },
  ]);
});

test("catalog caps page size, clamps obsolete pages, and returns the final partial page", () => {
  const catalog = createGameCatalog(largeCatalogGames);
  assert.equal(catalog.query({ pageSize: 10000 }).games.length, 60);
  const lastPage = catalog.query({ page: 99999 });
  assert.equal(lastPage.page, 417);
  assert.equal(lastPage.games.length, 16);
  assert.equal(lastPage.games.at(-1).id, "game-9999");
  assert.equal(catalog.query({ q: "no matching title" }).total, 0);
});

test("catalog title ordering is deterministic and reversed across all pages", () => {
  const catalog = createGameCatalog([
    { id: "z", name: "Same title", tags: ["Real-time"] },
    { id: "a", name: "Same title", tags: ["Arcade"] },
    { id: "b", name: "Another game", tags: ["Single Player"] },
  ]);
  assert.deepEqual(catalog.query().games.map((game) => game.id), ["b", "a", "z"]);
  assert.deepEqual(catalog.query({ sort: "name-desc" }).games.map((game) => game.id), ["z", "a", "b"]);
  assert.equal(catalog.query({ genre: "real-time" }).games[0].id, "z");
});

test("catalog owns metadata and page results cannot change subsequent searches", () => {
  const sourceGame = { id: "relay", name: "Relay", tags: ["Strategy"], presentation: { controls: ["pointer"] } };
  const catalog = createGameCatalog([sourceGame]);
  sourceGame.name = "Mutated source";
  catalog.query().games[0].presentation.controls.push("keyboard");

  assert.equal(catalog.query({ q: "relay" }).games[0].name, "Relay");
  assert.deepEqual(catalog.query().games[0].presentation.controls, ["pointer"]);
});

test("catalog query parser rejects malformed known parameters and normalizes supported values", () => {
  assert.deepEqual(parseGameCatalogQuery({ page: "2", pageSize: "60", q: "  Relay  ", genre: "Real-time", sort: "name-desc" }), {
    page: 2, pageSize: 60, q: "Relay", genre: "realtime", sort: "name-desc",
  });
  for (const query of [{ page: "0" }, { page: "2.5" }, { pageSize: "-1" }, { page: ["1", "2"] }, { sort: "popular" }, { q: "x".repeat(121) }]) {
    assert.throws(() => parseGameCatalogQuery(query), TypeError);
  }
});
