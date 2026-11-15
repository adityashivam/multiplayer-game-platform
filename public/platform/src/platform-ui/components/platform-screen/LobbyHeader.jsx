import React, { useEffect, useMemo, useRef, useState } from "react";
import classNames from "../../../utils/classNames.js";
import styles from "./GameLibrary.module.scss";
import { MAX_CATALOG_SEARCH_LENGTH } from "../../../../shared/gameCatalog.js";
import { LIBRARY_ZOOM } from "../../services/libraryZoom.js";

/**
 * Library search, genre filter and the card-size control.
 * @param {{showZoomControls?:boolean,canZoomIn?:boolean,canZoomOut?:boolean,zoomScale?:number,onZoomChange?:(scale:number)=>void,searchQuery?:string,onSearchChange?:(query:string)=>void,filterOptions?:{value:string,label:string}[],activeFilter?:string,onFilterChange?:(genre:string)=>void,onZoomIn?:()=>void,onZoomOut?:()=>void}} props
 */
export default function LobbyHeader({
  showZoomControls = false,
  canZoomIn = true,
  canZoomOut = true,
  zoomScale = 1,
  onZoomChange,
  searchQuery = "",
  onSearchChange,
  filterOptions = [],
  activeFilter = "all",
  onFilterChange,
  onZoomIn,
  onZoomOut,
}) {
  const [filterOpen, setFilterOpen] = useState(false);
  const filterRef = useRef(null);
  const activeFilterLabel = useMemo(
    () => filterOptions.find((option) => option.value === activeFilter)?.label || "All Genres",
    [activeFilter, filterOptions],
  );

  useEffect(() => {
    const handlePointerDown = (event) => {
      if (!filterRef.current?.contains(event.target)) {
        setFilterOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setFilterOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <header className={styles.header}>
      <div className={styles.libraryBrand}>
        <svg viewBox="0 0 28 28" fill="none" aria-hidden="true">
          <path d="M3 3h9v9H3zM16 3h9v9h-9zM3 16h9v9H3z" fill="currentColor" />
          <path d="m17 16 9 5-9 5z" fill="currentColor" />
        </svg>
        <span>KABOOM</span>
      </div>
      <div className={styles.headerTools}>
        <label className={styles.searchBar}>
          <span className={classNames("material-symbols-outlined", styles.searchIcon)}>search</span>
          <input
            type="text"
            placeholder="Search"
            className={styles.searchInput}
            aria-label="Search games"
            value={searchQuery}
            maxLength={MAX_CATALOG_SEARCH_LENGTH}
            onChange={(event) => onSearchChange?.(event.target.value)}
          />
        </label>

        {/* On phones the filter and size controls share one pill; elsewhere they stand apart. */}
        <div className={styles.headerActions}>
          <div
            className={classNames(styles.filterControl, filterOpen && styles.filterControlOpen, activeFilter !== "all" && styles.filterControlActive)}
            ref={filterRef}
          >
            <span className={classNames("material-symbols-outlined", styles.filterIcon)}>filter_alt</span>
            <button
              type="button"
              className={styles.filterTrigger}
              aria-label="Filter games by genre"
              aria-haspopup="listbox"
              aria-expanded={filterOpen}
              onClick={() => setFilterOpen((current) => !current)}
            >
              <span className={styles.filterTriggerLabel}>{activeFilterLabel}</span>
              <span
                className={classNames(
                  "material-symbols-outlined",
                  styles.filterChevron,
                  filterOpen && styles.filterChevronOpen,
                )}
              >
                expand_more
              </span>
            </button>

            {filterOpen ? (
              <div className={styles.filterMenu} role="listbox" aria-label="Game genre filter">
                {filterOptions.map((option) => {
                  const selected = option.value === activeFilter;

                  return (
                    <button
                      key={option.value}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={classNames(styles.filterOption, selected && styles.filterOptionActive)}
                      onClick={() => {
                        onFilterChange?.(option.value);
                        setFilterOpen(false);
                      }}
                    >
                      <span
                        className={classNames(
                          "material-symbols-outlined",
                          styles.filterOptionCheck,
                          selected ? styles.filterOptionCheckVisible : styles.filterOptionCheckHidden,
                        )}
                        aria-hidden="true"
                      >
                        check_small
                      </span>
                      <span className={styles.filterOptionLabel}>{option.label}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>

          {showZoomControls ? (
            <div className={styles.zoomControl} role="group" aria-label="Card size">
              <button
                type="button"
                className={styles.zoomButton}
                onClick={onZoomOut}
                disabled={!canZoomOut}
                aria-label="Smaller cards"
              >
                <span className="material-symbols-outlined" aria-hidden="true">remove</span>
              </button>
              <input
                type="range"
                className={styles.zoomSlider}
                min={LIBRARY_ZOOM.min}
                max={LIBRARY_ZOOM.max}
                step={0.01}
                value={zoomScale}
                style={{ "--zoom-fill": `${((zoomScale - LIBRARY_ZOOM.min) / (LIBRARY_ZOOM.max - LIBRARY_ZOOM.min)) * 100}%` }}
                aria-label="Card size"
                aria-valuetext={`${Math.round(zoomScale * 100)}%`}
                onChange={(event) => onZoomChange?.(Number(event.target.value))}
              />
              <button
                type="button"
                className={styles.zoomButton}
                onClick={onZoomIn}
                disabled={!canZoomIn}
                aria-label="Bigger cards"
              >
                <span className="material-symbols-outlined" aria-hidden="true">add</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
