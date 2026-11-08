import {
  createGameCatalog,
  GAME_CATALOG_PATH,
  parseGameCatalogQuery,
} from "../../public/platform/shared/gameCatalog.js";

const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;

/** Project trusted game metadata into the public catalog without exposing registration callbacks. */
function readPublicGameMetadata(game) {
  return {
    id: game.id,
    name: game.name,
    description: game.description,
    path: game.path,
    engine: game.engine || "kaboom",
    runtime: game.runtime || null,
    tags: game.tags || [],
    startInLandscape: game.startInLandscape === true,
    platformControlButtons: game.platformControlButtons !== false,
    shareRoom: game.shareRoom !== false,
    networked: game.networked !== false,
    ...(game.namespace !== undefined ? { namespace: game.namespace } : {}),
    ...(game.room !== undefined ? { room: game.room } : {}),
    ...(game.networking !== undefined ? { networking: game.networking } : {}),
    ...(game.presentation !== undefined ? { presentation: game.presentation } : {}),
    ...(game.touchControls !== undefined ? { touchControls: game.touchControls } : {}),
  };
}

/** @param {object} request @param {object} game @returns {object} Metadata with the legacy absolute launch URL. */
function addGameLaunchUrl(request, game) {
  return { ...game, url: `${request.protocol}://${request.get("host")}${game.path}` };
}

/**
 * Register bounded catalog queries and independent game lookup over trusted registration metadata.
 * Unparameterized listing remains compatible with existing diagnostic clients.
 * @param {import("express").Express} app
 * @param {import("../platform-backend-engine/core/gameRegistry.js").GameRegistry} gameRegistry
 * @returns {void}
 */
export function registerGameCatalogRoutes(app, gameRegistry) {
  const publicGames = gameRegistry.listGames().map(readPublicGameMetadata);
  const gameCatalog = createGameCatalog(publicGames);

  app.get(GAME_CATALOG_PATH, (request, response) => {
    if (Object.keys(request.query).length === 0) {
      return response.json({ games: publicGames.map((game) => addGameLaunchUrl(request, game)) });
    }

    try {
      const catalogPage = gameCatalog.query(parseGameCatalogQuery(request.query));
      return response.json({ ...catalogPage, games: catalogPage.games.map((game) => addGameLaunchUrl(request, game)) });
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      return response.status(HTTP_BAD_REQUEST).json({ error: error.message });
    }
  });

  app.get(`${GAME_CATALOG_PATH}/:gameId`, (request, response) => {
    const game = gameRegistry.getGame(request.params.gameId);
    if (!game) return response.status(HTTP_NOT_FOUND).json({ error: "Unknown game" });
    return response.json({ game: addGameLaunchUrl(request, readPublicGameMetadata(game)) });
  });
}
