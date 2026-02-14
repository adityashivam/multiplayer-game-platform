import React from "react";
import classNames from "../utils/classNames.js";
import styles from "../App.module.scss";

export default function LobbyHeader({
  headerLeft,
  title,
  icons,
  onToggleTheme,
  onToggleFullscreen,
  isFullscreen,
  muted,
  onToggleMute,
}) {
  const muteIcon = muted ? icons?.muteOff || "volume_off" : icons?.muteOn || "volume_up";
  const fullscreenIcon = isFullscreen
    ? icons?.fullscreenOff || "fullscreen_exit"
    : icons?.fullscreenOn || "fullscreen";
  const themeIcon = icons?.themeToggle || "contrast";

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
              {muteIcon}
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
              {fullscreenIcon}
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
              {themeIcon}
            </span>
          </button>
        </div>
      </div>
      <h1 className={styles.title}>{title}</h1>
    </header>
  );
}
