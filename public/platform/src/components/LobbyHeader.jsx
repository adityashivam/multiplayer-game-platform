import React from "react";
import classNames from "../utils/classNames.js";
import styles from "../App.module.scss";

export default function LobbyHeader({
  headerLeft,
  title,
  onToggleTheme,
  onToggleFullscreen,
  isFullscreen,
  showInstall,
  onInstall,
}) {
  return (
    <header className={styles.header}>
      <div className={styles.headerTop}>
        {headerLeft}
        <div className={styles.headerActions}>
          {showInstall && (
            <button
              type="button"
              className={styles.themeToggle}
              onClick={onInstall}
              aria-label="Install app"
            >
              <span className={classNames("material-symbols-outlined", styles.themeIcon)}>
                download
              </span>
            </button>
          )}
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
