export const GAME_CATALOG_PATH = "/api/games";
export const DEFAULT_CATALOG_PAGE_SIZE = 24;
export const MAX_CATALOG_PAGE_SIZE = 60;
export const MAX_CATALOG_SEARCH_LENGTH = 120;
export const CATALOG_SORT_OPTIONS = Object.freeze([
  Object.freeze({ value: "name-asc", label: "Title: A–Z" }),
  Object.freeze({ value: "name-desc", label: "Title: Z–A" }),
]);

const NON_GENRE_TAG_PATTERN = /^(?:\d+\s*players?|single player|fast|demo|preview)$/i;
const SUPPORTED_SORTS = new Set(CATALOG_SORT_OPTIONS.map((option) => option.value));

/**
 * @typedef {object} CatalogGame
 * @property {string} id
 * @property {string} name
 * @property {string} [description]
 * @property {string[]} [tags]
 * @property {import("./touchControls.js").TouchControlsDescriptor} [touchControls]
 * @typedef {object} GameCatalogQuery
 * @property {number} [page]
 * @property {number} [pageSize]
 * @property {string} [q]
 * @property {string} [genre]
 * @property {"name-asc"|"name-desc"} [sort]
 * @property {boolean} [customizable] True restricts results to developer-enabled touch customization.
 * @typedef {object} CatalogGenre
 * @property {string} value
 * @property {string} label
 */

/** @param {string} tag @returns {string} A stable key shared by API and fallback filters. */
export function normalizeCatalogGenre(tag) {
  const genre = tag.trim().toLowerCase().replace(/[-\s]+/g, " ");
  return genre === "real time" ? "realtime" : genre;
}

/** @param {unknown} value @param {number} defaultValue @param {string} fieldName @returns {number} */
function parsePositiveCatalogInteger(value, defaultValue, fieldName) {
  if (value === undefined) return defaultValue;
  if ((typeof value !== "string" && typeof value !== "number") || !/^\d+$/.test(String(value)) ||
      !Number.isSafeInteger(Number(value)) || Number(value) < 1) {
    throw new TypeError(`Catalog ${fieldName} must be a positive integer`);
  }
  return Number(value);
}

/**
 * Parse the supported catalog query fields before querying metadata.
 * @param {{page?: unknown, pageSize?: unknown, q?: unknown, genre?: unknown, sort?: unknown, customizable?: unknown}} [query]
 * @returns {Required<Omit<GameCatalogQuery, "customizable">> & {customizable?: boolean}}
 * @throws {TypeError} For malformed numeric, search, genre, or sort parameters.
 */
export function parseGameCatalogQuery(query = {}) {
  const page = parsePositiveCatalogInteger(query.page, 1, "page");
  const pageSize = Math.min(MAX_CATALOG_PAGE_SIZE,
    parsePositiveCatalogInteger(query.pageSize, DEFAULT_CATALOG_PAGE_SIZE, "pageSize"));
  const q = query.q ?? "";
  const genre = query.genre ?? "all";
  const sort = query.sort ?? "name-asc";
  const customizable = query.customizable;

  if (typeof q !== "string" || q.length > MAX_CATALOG_SEARCH_LENGTH ||
      typeof genre !== "string" || genre.length > MAX_CATALOG_SEARCH_LENGTH || !SUPPORTED_SORTS.has(sort)) {
    throw new TypeError("Catalog search, genre, or sort is invalid");
  }
  if (customizable !== undefined && customizable !== true && customizable !== false &&
      customizable !== "true" && customizable !== "false") {
    throw new TypeError("Catalog customizable must be true or false");
  }

  return {
    page,
    pageSize,
    q: q.trim(),
    genre: normalizeCatalogGenre(genre),
    sort,
    ...(customizable !== undefined ? { customizable: customizable === true || customizable === "true" } : {}),
  };
}

/**
 * Index a static registered catalog once, then clone only the requested bounded page.
 * Search/genre facets cover the entire catalog; pagination never limits their scope.
 * @template {CatalogGame} TGame
 * @param {TGame[]} games Registry-owned metadata or a bundled fallback catalog.
 * @returns {{query: (query?: GameCatalogQuery) => {games: TGame[], total: number, page: number, pageSize: number, totalPages: number, genres: CatalogGenre[]}}}
 */
export function createGameCatalog(games) {
  const ownedGames = structuredClone(games);
  const genreLabels = new Map();
  const indexedGames = ownedGames.map((game) => {
    const tags = Array.isArray(game.tags) ? game.tags.filter((tag) => typeof tag === "string") : [];
    const genres = tags.filter((tag) => !NON_GENRE_TAG_PATTERN.test(tag)).map(normalizeCatalogGenre);
    for (const genre of genres) {
      if (!genreLabels.has(genre)) {
        genreLabels.set(genre, genre === "realtime" ? "Real-time" : genre.replace(/\b\w/g, (letter) => letter.toUpperCase()));
      }
    }
    return {
      game,
      genres,
      searchText: [game.name, game.description, ...tags].filter(Boolean).join(" ").toLowerCase(),
    };
  }).sort((left, right) => left.game.name.localeCompare(right.game.name, "en", { sensitivity: "base" }) ||
    left.game.id.localeCompare(right.game.id, "en"));
  const genres = [...genreLabels].sort(([left], [right]) => left.localeCompare(right))
    .map(([value, label]) => ({ value, label }));

  return {
    query(query = {}) {
      const catalogQuery = parseGameCatalogQuery(query);
      const searchText = catalogQuery.q.toLowerCase();
      const matchingGames = indexedGames.filter((entry) =>
        (catalogQuery.customizable !== true || entry.game.touchControls?.customizable === true) &&
        (catalogQuery.genre === "all" || entry.genres.includes(catalogQuery.genre)) &&
        (!searchText || entry.searchText.includes(searchText)));
      if (catalogQuery.sort === "name-desc") matchingGames.reverse();

      const total = matchingGames.length;
      const totalPages = Math.max(1, Math.ceil(total / catalogQuery.pageSize));
      const page = Math.min(catalogQuery.page, totalPages);
      const startIndex = (page - 1) * catalogQuery.pageSize;

      return {
        games: structuredClone(matchingGames.slice(startIndex, startIndex + catalogQuery.pageSize).map((entry) => entry.game)),
        total,
        page,
        pageSize: catalogQuery.pageSize,
        totalPages,
        genres: structuredClone(genres),
      };
    },
  };
}
