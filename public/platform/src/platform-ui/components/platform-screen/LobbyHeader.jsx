import React, { useEffect, useMemo, useRef, useState } from "react";
import classNames from "../../../utils/classNames.js";
import styles from "../../PlatformApp.module.scss";

export default function LobbyHeader({
  title,
  showZoomControls = false,
  canZoomIn = true,
  canZoomOut = true,
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
      <div className={styles.headerBrand}>
        <span className={classNames("material-symbols-outlined", styles.headerBrandIcon)}>sports_esports</span>
        <h1 className={styles.title}>{title}</h1>
      </div>

      <div className={styles.headerTools}>
        <label className={styles.searchBar}>
          <span className={classNames("material-symbols-outlined", styles.searchIcon)}>search</span>
          <input
            type="text"
            placeholder="FIND GAME OR TAG..."
            className={styles.searchInput}
            aria-label="Find expedition"
            value={searchQuery}
            onChange={(event) => onSearchChange?.(event.target.value)}
          />
        </label>

        <div
          className={classNames(styles.filterControl, filterOpen && styles.filterControlOpen)}
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

        <div className={styles.viewToggle} aria-label="Layout mode">
          <button type="button" className={classNames(styles.viewToggleButton, styles.viewToggleButtonActive)}>
            <span className="material-symbols-outlined">grid_view</span>
          </button>
          <button type="button" className={styles.viewToggleButton}>
            <span className="material-symbols-outlined">format_list_bulleted</span>
          </button>
        </div>

        {showZoomControls ? (
          <div className={styles.zoomControl} aria-label="Resize cards">
            <button
              type="button"
              className={styles.zoomButton}
              onClick={onZoomOut}
              disabled={!canZoomOut}
              aria-label="Zoom out cards"
            >
              <span className="material-symbols-outlined">remove</span>
            </button>
            <button
              type="button"
              className={styles.zoomButton}
              onClick={onZoomIn}
              disabled={!canZoomIn}
              aria-label="Zoom in cards"
            >
              <span className="material-symbols-outlined">add</span>
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}
