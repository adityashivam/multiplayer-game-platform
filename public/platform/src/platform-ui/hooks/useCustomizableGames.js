import { useEffect, useState } from "react";
import { fallbackGames } from "../../data/games.js";
import { createGameCatalog } from "../../../shared/gameCatalog.js";
import { requestGameCatalogPage } from "../services/gameCatalogClient.js";

const GAME_PICKER_PAGE_SIZE = 6;
const SEARCH_DELAY_MS = 160;
const fallbackCatalog = createGameCatalog(fallbackGames);
const emptyPage = { games: [], page: 1, total: 0, totalPages: 1 };

/** Request only a bounded page of games whose developers permit touch editing. */
export default function useCustomizableGames(searchText = "", page = 1) {
  const [catalogState, setCatalogState] = useState({ catalogPage: emptyPage, loading: true, offline: false });

  useEffect(() => {
    const abortController = new AbortController();
    setCatalogState((current) => ({ ...current, loading: true }));
    const catalogQuery = { page, pageSize: GAME_PICKER_PAGE_SIZE, q: searchText, customizable: true };
    const searchTimer = window.setTimeout(() => {
      requestGameCatalogPage(catalogQuery, { signal: abortController.signal }).then((catalogPage) => {
        if (!abortController.signal.aborted) setCatalogState({ catalogPage, loading: false, offline: false });
      }).catch(() => {
        if (!abortController.signal.aborted) setCatalogState({ catalogPage: fallbackCatalog.query(catalogQuery), loading: false, offline: true });
      });
    }, searchText ? SEARCH_DELAY_MS : 0);

    return () => {
      window.clearTimeout(searchTimer);
      abortController.abort();
    };
  }, [searchText, page]);

  return catalogState;
}
