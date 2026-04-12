import React, { useEffect, useMemo, useRef, useState } from "react";
import GameCard from "./GameCard.jsx";
import { visualsByGame } from "../../../data/games.js";
import styles from "../../PlatformApp.module.scss";

const COMPACT_PORTRAIT_QUERY = "(max-width: 900px) and (orientation: portrait)";
const COMPACT_LANDSCAPE_QUERY = "(max-height: 540px) and (orientation: landscape)";
const BASE_COMPACT_TILE_SIZE = 96;
const COMPACT_TILE_GAP = 8;
const MIN_PORTRAIT_TILE_SIZE = 64;
const MIN_LANDSCAPE_TILE_SIZE = 60;
const MIN_PORTRAIT_COLUMNS = 2;
const MIN_LANDSCAPE_COLUMNS = 3;
const MAX_PORTRAIT_COLUMNS = 5;
const MAX_LANDSCAPE_COLUMNS = 6;

function resolveCompactLayout(width, zoomIndex, isPortraitCompact) {
  const minTileSize = isPortraitCompact ? MIN_PORTRAIT_TILE_SIZE : MIN_LANDSCAPE_TILE_SIZE;
  const minColumns = isPortraitCompact ? MIN_PORTRAIT_COLUMNS : MIN_LANDSCAPE_COLUMNS;
  const maxColumnsCap = isPortraitCompact ? MAX_PORTRAIT_COLUMNS : MAX_LANDSCAPE_COLUMNS;
  const safeWidth = Math.max(width, minTileSize);
  const maxColumns = Math.max(
    minColumns,
    Math.min(maxColumnsCap, Math.floor((safeWidth + COMPACT_TILE_GAP) / (minTileSize + COMPACT_TILE_GAP))),
  );
  const defaultColumns = Math.max(minColumns, maxColumns - 1);
  const zoomBias = zoomIndex - 1;
  const columns = Math.max(minColumns, Math.min(maxColumns, defaultColumns - zoomBias));
  const tileSize = (safeWidth - COMPACT_TILE_GAP * (columns - 1)) / columns;

  return {
    columns,
    tileSize,
    gap: COMPACT_TILE_GAP,
  };
}

export default function LobbyList({
  loading,
  games,
  emptyMessage = "No games available right now.",
  selectedIndex,
  onSelectIndex,
  onActivate,
  cardScale = 1,
  cardZoomIndex = 0,
  registerCardRef,
}) {
  const listRef = useRef(null);
  const [compactLayout, setCompactLayout] = useState(null);
  const [zoomAnimating, setZoomAnimating] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;

    const portraitMedia = window.matchMedia(COMPACT_PORTRAIT_QUERY);
    const landscapeMedia = window.matchMedia(COMPACT_LANDSCAPE_QUERY);

    const updateLayout = () => {
      const listNode = listRef.current;
      if (!listNode) return;

      const isPortraitCompact = portraitMedia.matches;
      const isLandscapeCompact = landscapeMedia.matches;
      const isCompact = isPortraitCompact || isLandscapeCompact;

      if (!isCompact) {
        setCompactLayout(null);
        return;
      }

      const width = listNode.clientWidth;
      if (!width) return;

      setCompactLayout(resolveCompactLayout(width, cardZoomIndex, isPortraitCompact));
    };

    const resizeObserver = new ResizeObserver(() => {
      updateLayout();
    });

    if (listRef.current) {
      resizeObserver.observe(listRef.current);
    }

    updateLayout();

    portraitMedia.addEventListener("change", updateLayout);
    landscapeMedia.addEventListener("change", updateLayout);

    return () => {
      resizeObserver.disconnect();
      portraitMedia.removeEventListener("change", updateLayout);
      landscapeMedia.removeEventListener("change", updateLayout);
    };
  }, [cardZoomIndex]);

  const lobbyStyle = useMemo(() => {
    if (!compactLayout) {
      return {
        "--library-card-scale": cardScale,
        "--library-tile-size": `${(BASE_COMPACT_TILE_SIZE * cardScale).toFixed(2)}px`,
      };
    }

    return {
      "--library-card-scale": (compactLayout.tileSize / BASE_COMPACT_TILE_SIZE).toFixed(4),
      "--library-tile-size": `${compactLayout.tileSize.toFixed(2)}px`,
      "--library-grid-columns": compactLayout.columns,
      "--library-grid-gap": `${compactLayout.gap}px`,
    };
  }, [cardScale, compactLayout]);

  useEffect(() => {
    if (!compactLayout) return undefined;
    if (typeof window === "undefined") return undefined;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return undefined;

    setZoomAnimating(true);
    const timeoutId = window.setTimeout(() => {
      setZoomAnimating(false);
    }, 240);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [cardZoomIndex, compactLayout?.columns, compactLayout?.tileSize]);

  return (
    <div className={styles.lobbyHome} style={lobbyStyle}>
      <div className={styles.lobbyBackdrop} aria-hidden="true" />
      <div
        id="game-list"
        className={`${styles.lobbyList} ${zoomAnimating ? styles.lobbyListZooming : ""}`.trim()}
        ref={listRef}
      >
        {loading ? (
          <div className={styles.emptyState}>Loading cartridges...</div>
        ) : games.length === 0 ? (
          <div className={styles.emptyState}>{emptyMessage}</div>
        ) : (
          games.map((game, index) => {
            const visuals = visualsByGame[game.id] || {};
            const selected = selectedIndex === index;
            return (
              <GameCard
                key={game.id}
                game={game}
                visuals={visuals}
                selected={selected}
                onSelect={() => onSelectIndex(index)}
                onActivate={() => onActivate(game.path)}
                ref={(node) => {
                  registerCardRef?.(index, node);
                }}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
