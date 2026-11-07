import { GAME_CATALOG_PATH, parseGameCatalogQuery } from "../../../shared/gameCatalog.js";

const HTTP_NOT_FOUND = 404;

/** @param {object} game @returns {boolean} Whether a catalog entry can be shown and launched. */
function isLaunchableCatalogGame(game) {
  return game !== null && typeof game === "object" && typeof game.id === "string" &&
    typeof game.name === "string" && typeof game.path === "string" && game.path.startsWith("/");
}

/**
 * Fetch and validate a bounded catalog page. Abort signals belong to the caller.
 * @param {import("../../../shared/gameCatalog.js").GameCatalogQuery} query
 * @param {{signal?: AbortSignal, fetchRequest?: typeof fetch}} [options]
 * @returns {Promise<{games: object[], total: number, page: number, pageSize: number, totalPages: number, genres: {value: string, label: string}[]}>}
 * @throws {Error} For failed requests or a server response outside the requested contract.
 */
export async function requestGameCatalogPage(query, { signal, fetchRequest = fetch } = {}) {
  const catalogQuery = parseGameCatalogQuery(query);
  const queryParams = new URLSearchParams();
  for (const [key, value] of Object.entries(catalogQuery)) queryParams.set(key, String(value));
  const catalogResponse = await fetchRequest(`${GAME_CATALOG_PATH}?${queryParams}`, { signal });
  if (!catalogResponse.ok) throw new Error("Game catalog request failed");
  const catalogPage = await catalogResponse.json();

  if (!catalogPage || !Array.isArray(catalogPage.games) || catalogPage.games.length > catalogQuery.pageSize ||
      !catalogPage.games.every(isLaunchableCatalogGame) || !Number.isSafeInteger(catalogPage.total) ||
      catalogPage.total < catalogPage.games.length || !Number.isSafeInteger(catalogPage.page) || catalogPage.page < 1 ||
      catalogPage.pageSize !== catalogQuery.pageSize || !Number.isSafeInteger(catalogPage.totalPages) ||
      catalogPage.totalPages < 1 || catalogPage.page > catalogPage.totalPages || !Array.isArray(catalogPage.genres) ||
      !catalogPage.genres.every((genre) => typeof genre?.value === "string" && typeof genre?.label === "string")) {
    throw new Error("Invalid game catalog response");
  }
  return catalogPage;
}

/**
 * Fetch one game's metadata so direct links do not depend on the currently browsed page.
 * @param {string} gameId
 * @param {{signal?: AbortSignal, fetchRequest?: typeof fetch}} [options]
 * @returns {Promise<object|null>} Null means the registry explicitly reported an unknown game.
 * @throws {Error} For request failure, invalid metadata, or mismatched game identity.
 */
export async function requestCatalogGame(gameId, { signal, fetchRequest = fetch } = {}) {
  const gameResponse = await fetchRequest(`${GAME_CATALOG_PATH}/${encodeURIComponent(gameId)}`, { signal });
  if (gameResponse.status === HTTP_NOT_FOUND) return null;
  if (!gameResponse.ok) throw new Error("Game metadata request failed");
  const gamePayload = await gameResponse.json();
  if (!isLaunchableCatalogGame(gamePayload?.game) || gamePayload.game.id !== gameId) {
    throw new Error("Invalid game metadata response");
  }
  return gamePayload.game;
}
