import React from "react";
import classNames from "../utils/classNames.js";
import styles from "../App.module.scss";

export default function LobbyHeader({
  headerLeft,
  title,
  onToggleTheme,
  onToggleFullscreen,
  isFullscreen,
  muted,
  onToggleMute,
}) {
  return (
    <header className={styles.header}>
      <div className={styles.headerTop}>
        {headerLeft}
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.themeToggle}
            onClick={onToggleMute}
            aria-label={muted ? "Unmute sounds" : "Mute sounds"}
            aria-pressed={muted}
          >
            <span className={classNames("material-symbols-outlined", styles.themeIcon)}>
              {muted ? "volume_off" : "volume_up"}
            </span>
          </button>
          <button
            type="button"
            className={styles.themeToggle}
            onClick={onToggleFullscreen}
            aria-label="Toggle fullscreen"
            aria-pressed={isFullscreen}
          >
            <span className={classNames("material-symbols-outlined", styles.themeIcon)}>
              {isFullscreen ? "fullscreen_exit" : "fullscreen"}
            </span>
          </button>
          <button
            id="theme-toggle"
            type="button"
            className={styles.themeToggle}
            onClick={onToggleTheme}
            aria-label="Toggle theme"
          >
            <span className={classNames("material-symbols-outlined", styles.themeIcon)}>
              contrast
            </span>
          </button>
        </div>
      </div>
      <h1 className={styles.title}>{title}</h1>
    </header>
  );
}
