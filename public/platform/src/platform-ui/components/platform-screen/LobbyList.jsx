import React, { useEffect, useRef, useState } from "react";
import { CATALOG_SORT_OPTIONS } from "../../../../shared/gameCatalog.js";
import { readCatalogColumnCount, readNextCatalogIndex } from "../../services/catalogNavigation.js";
import CatalogPagination from "./CatalogPagination.jsx";
import GameCard from "./GameCard.jsx";
import GameShowcase from "./GameShowcase.jsx";
import GamePreviewDialog from "./GamePreviewDialog.jsx";
import useMediaQuery from "../../hooks/useMediaQuery.js";
import styles from "./GameLibrary.module.scss";

const PORTRAIT_CATALOG_QUERY = "(max-width: 900px) and (orientation: portrait)";

const GRID_KEY_DIRECTIONS = Object.freeze({
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  Home: "home",
  End: "end",
});

/** Show a bounded catalog page in a vertical grid with a secondary selected-game preview. */
export default function LobbyList({
  loading,
  games,
  catalogPage,
  catalogUnavailable,
  sort,
  onSortChange,
  onPageChange,
  emptyMessage,
  selectedIndex,
  onSelectIndex,
  onActivate,
  cardScale = 1,
  registerCardRef,
}) {
  const gridRef = useRef(null);
  const portraitLayout = useMediaQuery(PORTRAIT_CATALOG_QUERY);
  const [previewOpen, setPreviewOpen] = useState(false);
  const selectedGame = games[selectedIndex] || games[0];
  const firstResult = catalogPage.total ? (catalogPage.page - 1) * catalogPage.pageSize + 1 : 0;
  const lastResult = Math.min(catalogPage.total, firstResult + games.length - 1);

  useEffect(() => {
    gridRef.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [games, loading]);

  function navigateGameGrid(event) {
    if (loading || !Object.hasOwn(GRID_KEY_DIRECTIONS, event.key)) return;
    event.preventDefault();
    const columns = readCatalogColumnCount(gridRef.current);
    onSelectIndex(readNextCatalogIndex(selectedIndex, GRID_KEY_DIRECTIONS[event.key], columns, games.length), true);
  }

  return (
    <section className={styles.catalog} style={{ "--library-card-scale": cardScale }} aria-labelledby="catalog-title">
      <div className={styles.catalogWorkspace} aria-busy={loading}>
        <div className={styles.catalogResults}>
          <div className={styles.catalogHeading}>
            <div>
              <h1 id="catalog-title">Game library <span>{catalogPage.total.toLocaleString()}</span></h1>
              <p role="status" aria-live="polite">
                {loading ? "Finding games…" : catalogPage.total
                  ? `${firstResult.toLocaleString()}–${lastResult.toLocaleString()} of ${catalogPage.total.toLocaleString()} games`
                  : "No matching games"}
              </p>
            </div>
            <label className={styles.catalogSort}>
              <span className="material-symbols-outlined" aria-hidden="true">sort</span>
              <select aria-label="Sort games" value={sort} onChange={(event) => onSortChange(event.target.value)}>
                {CATALOG_SORT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>

          {catalogUnavailable && <p className={styles.catalogNotice}>Catalog unavailable. Showing bundled games.</p>}

          {games.length ? (
            <div
              id="game-list"
              className={styles.gameGrid}
              data-game-grid
              onKeyDown={navigateGameGrid}
              ref={gridRef}
            >
              {games.map((game, index) => (
                <GameCard
                  key={game.id}
                  game={game}
                  selected={selectedIndex === index}
                  disabled={loading}
                  onSelect={() => onSelectIndex(index)}
                  onPreview={() => {
                    onSelectIndex(index);
                    if (portraitLayout) setPreviewOpen(true);
                  }}
                  onActivate={() => onActivate(game.path)}
                  ref={(node) => registerCardRef?.(index, node)}
                />
              ))}
            </div>
          ) : (
            <div className={styles.emptyState} role="status">
              <span className="material-symbols-outlined" aria-hidden="true">sports_esports</span>
              <h2>{loading ? "Loading your library" : "No games found"}</h2>
              <p>{loading ? "Getting everything ready to play." : emptyMessage}</p>
            </div>
          )}
          {catalogPage.total > 0 && (
            <CatalogPagination
              page={catalogPage.page}
              totalPages={catalogPage.totalPages}
              loading={loading}
              onPageChange={onPageChange}
            />
          )}
        </div>
        {selectedGame && !portraitLayout && (
          <aside className={styles.catalogPreview} aria-label="Selected game">
            <GameShowcase game={selectedGame} onActivate={onActivate} disabled={loading} />
          </aside>
        )}
      </div>
      {portraitLayout && previewOpen && selectedGame && (
        <GamePreviewDialog game={selectedGame} onActivate={onActivate} onClose={() => setPreviewOpen(false)} />
      )}
    </section>
  );
}
