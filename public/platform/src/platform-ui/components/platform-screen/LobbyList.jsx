import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { CATALOG_SORT_OPTIONS } from "../../../../shared/gameCatalog.js";
import { readCatalogColumnCount, readNextCatalogIndex } from "../../services/catalogNavigation.js";
import CatalogPagination from "./CatalogPagination.jsx";
import GameCard from "./GameCard.jsx";
import GameShowcase from "./GameShowcase.jsx";
import GamePreviewDialog from "./GamePreviewDialog.jsx";
import Presence from "./Presence.jsx";
import useMediaQuery from "../../hooks/useMediaQuery.js";
import useLibraryZoomGestures from "../../hooks/useLibraryZoomGestures.js";
import { captureLayoutBoxes, morphFromLayoutBoxes, settleLayoutMorphs } from "../../services/layoutMorph.js";
import styles from "./GameLibrary.module.scss";

const PORTRAIT_CATALOG_QUERY = "(max-width: 900px) and (orientation: portrait)";
const SKELETON_CARD_COUNT = 8;

const GRID_KEY_DIRECTIONS = Object.freeze({
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  Home: "home",
  End: "end",
});

const ZOOM_MORPH_MS = 260;

/**
 * Show a bounded catalog page in a vertical grid with a secondary selected-game preview.
 * `cardScale` sizes the cards; `onCardScaleChange` receives pinch and
 * ctrl+wheel zoom from the grid (a value, or an updater of the current one).
 */
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
  onCardScaleChange,
  registerCardRef,
}) {
  const gridRef = useRef(null);
  const catalogRef = useRef(null);
  const placeRingRef = useRef(() => {});
  const portraitLayout = useMediaQuery(PORTRAIT_CATALOG_QUERY);
  const [previewOpen, setPreviewOpen] = useState(false);
  const selectedGame = games[selectedIndex] || games[0];
  const firstResult = catalogPage.total ? (catalogPage.page - 1) * catalogPage.pageSize + 1 : 0;
  const lastResult = Math.min(catalogPage.total, firstResult + games.length - 1);

  useEffect(() => {
    gridRef.current?.scrollTo({ top: 0, behavior: "instant" });
  }, [games, loading]);

  useLibraryZoomGestures(catalogRef, onCardScaleChange);

  // Resize cards by gliding each one from its old box to its new one, keeping
  // the selected card where it was, instead of letting the grid jump.
  const appliedScaleRef = useRef(null);
  useLayoutEffect(() => {
    const catalog = catalogRef.current;
    if (!catalog) return;
    const grid = gridRef.current;
    const previousScale = appliedScaleRef.current;
    appliedScaleRef.current = cardScale;
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (previousScale === null || !grid || reducedMotion) {
      catalog.style.setProperty("--library-card-scale", String(cardScale));
      placeRingRef.current();
      return;
    }
    const cards = [...grid.querySelectorAll("[data-library-card-id]")];
    const anchor = grid.querySelector(`[data-library-card-id="${CSS.escape(selectedGame?.id ?? "")}"]`);
    const gridBox = grid.getBoundingClientRect();
    const anchorTop = anchor ? anchor.getBoundingClientRect().top - gridBox.top : null;
    const anchorVisible = anchorTop !== null && anchorTop > -anchor.offsetHeight && anchorTop < grid.clientHeight;
    const before = captureLayoutBoxes(cards);

    catalog.style.setProperty("--library-card-scale", String(cardScale));
    settleLayoutMorphs(cards);
    if (anchorVisible) grid.scrollTop += anchor.getBoundingClientRect().top - gridBox.top - anchorTop;
    placeRingRef.current();
    morphFromLayoutBoxes(before, { durationMs: ZOOM_MORPH_MS, viewport: grid.getBoundingClientRect() });
  }, [cardScale]); // eslint-disable-line react-hooks/exhaustive-deps -- only a size change morphs

  // Glide one focus ring onto the selected card; it rides inside the grid,
  // so it scrolls with the cards and follows layout changes.
  const focusGlideRef = useRef(null);
  useLayoutEffect(() => {
    const grid = gridRef.current;
    const ring = focusGlideRef.current;
    if (!grid || !ring) return undefined;
    const placeRing = () => {
      const media = grid.querySelector(`[data-library-card-id="${CSS.escape(selectedGame?.id ?? "")}"] [data-card-media]`);
      if (!media) {
        ring.dataset.ready = "false";
        return;
      }
      // Measure from the card's centre so its own lift or scale can't skew the ring.
      // The edge light hugs the card and takes the game's colour.
      const inset = 0;
      const accent = media.closest("[data-library-card-id]")?.style.getPropertyValue("--game-accent");
      if (accent) ring.style.setProperty("--ring-accent", accent);
      const mediaBounds = media.getBoundingClientRect();
      const gridBounds = grid.getBoundingClientRect();
      const width = media.offsetWidth + inset * 2;
      const height = media.offsetHeight + inset * 2;
      const centreX = mediaBounds.left + mediaBounds.width / 2 - gridBounds.left - grid.clientLeft + grid.scrollLeft;
      const centreY = mediaBounds.top + mediaBounds.height / 2 - gridBounds.top - grid.clientTop + grid.scrollTop;
      ring.style.width = `${width}px`;
      ring.style.height = `${height}px`;
      ring.style.transform = `translate(${centreX - width / 2}px, ${centreY - height / 2}px) scale(1.04)`;
      if (ring.dataset.ready !== "true") requestAnimationFrame(() => { ring.dataset.ready = "true"; });
    };
    placeRingRef.current = placeRing;
    placeRing();
    const resizeObserver = new ResizeObserver(placeRing);
    resizeObserver.observe(grid);
    // Cards rise in on mount; settle the ring once they land.
    grid.addEventListener("animationend", placeRing);
    return () => {
      resizeObserver.disconnect();
      grid.removeEventListener("animationend", placeRing);
    };
  }, [selectedGame?.id, games]);

  function navigateGameGrid(event) {
    if (loading || !Object.hasOwn(GRID_KEY_DIRECTIONS, event.key)) return;
    event.preventDefault();
    const columns = readCatalogColumnCount(gridRef.current);
    onSelectIndex(readNextCatalogIndex(selectedIndex, GRID_KEY_DIRECTIONS[event.key], columns, games.length), true);
  }

  return (
    <section className={styles.catalog} ref={catalogRef} aria-labelledby="catalog-title">
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
              <span className={styles.focusGlide} ref={focusGlideRef} aria-hidden="true" />
              {games.map((game, index) => (
                <GameCard
                  key={game.id}
                  cardIndex={index}
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
          ) : loading ? (
            <div className={styles.gameGrid} role="status" aria-label="Loading your library">
              {Array.from({ length: SKELETON_CARD_COUNT }, (_unused, index) => <span key={index} className={styles.skeletonCard} aria-hidden="true" />)}
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
            <GameShowcase key={selectedGame.id} game={selectedGame} onActivate={onActivate} disabled={loading} />
          </aside>
        )}
      </div>
      <Presence when={Boolean(portraitLayout && previewOpen && selectedGame)}>
        <GamePreviewDialog game={selectedGame} onActivate={onActivate} onClose={() => setPreviewOpen(false)} />
      </Presence>
    </section>
  );
}
