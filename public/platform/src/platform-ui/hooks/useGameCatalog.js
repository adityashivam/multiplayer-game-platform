import { useEffect, useMemo, useState } from "react";
import { fallbackGames } from "../../data/games.js";
import { createGameCatalog } from "../../../shared/gameCatalog.js";
import { requestGameCatalogPage } from "../services/gameCatalogClient.js";

const CATALOG_SEARCH_DELAY_MS = 180;
const fallbackCatalog = createGameCatalog(fallbackGames);
const emptyCatalogPage = createGameCatalog([]).query();

/** Load bounded catalog pages, cancel obsolete queries, and debounce only search typing. */
export default function useGameCatalog({ page, q, genre, sort }) {
  const [catalogPage, setCatalogPage] = useState(emptyCatalogPage);
  const [loadingGames, setLoadingGames] = useState(true);
  const [catalogUnavailable, setCatalogUnavailable] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState(q);

  useEffect(() => {
    const timerId = window.setTimeout(() => setDebouncedSearch(q), CATALOG_SEARCH_DELAY_MS);
    return () => window.clearTimeout(timerId);
  }, [q]);

  useEffect(() => {
    setLoadingGames(true);
    if (debouncedSearch !== q) return undefined;

    const abortController = new AbortController();
    const catalogQuery = { page, q: debouncedSearch, genre, sort };
    requestGameCatalogPage(catalogQuery, { signal: abortController.signal }).then((nextPage) => {
      if (abortController.signal.aborted) return;
      setCatalogPage(nextPage);
      setCatalogUnavailable(false);
      setLoadingGames(false);
    }).catch(() => {
      if (abortController.signal.aborted) return;
      setCatalogPage(fallbackCatalog.query(catalogQuery));
      setCatalogUnavailable(true);
      setLoadingGames(false);
    });

    return () => abortController.abort();
  }, [page, q, genre, sort, debouncedSearch]);

  const filterOptions = useMemo(() => [
    { value: "all", label: "All Genres" },
    ...catalogPage.genres,
  ], [catalogPage.genres]);

  return {
    games: catalogPage.games,
    catalogPage,
    filterOptions,
    loadingGames: loadingGames || debouncedSearch !== q,
    catalogUnavailable,
  };
}
