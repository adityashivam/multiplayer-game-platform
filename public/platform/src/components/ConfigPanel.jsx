import React from "react";
import classNames from "../utils/classNames.js";
import styles from "./ConfigPanel.module.scss";

export default function ConfigPanel({
  themes,
  selectedThemeId,
  onSelectTheme,
  icons,
  musicVolume,
  muted,
  onToggleMute,
  onMusicVolumeChange,
}) {
  const selectedIcon = icons?.selectedTheme || "check_circle";
  const sliderValue = Math.round((musicVolume ?? 0) * 100);

  return (
    <div className={styles.panel}>
      <p className={styles.sectionLabel}>Theme</p>
      <div className={styles.themeList}>
        {themes.map((theme) => {
          const isSelected = theme.id === selectedThemeId;
          return (
            <button
              key={theme.id}
              type="button"
              className={classNames(styles.themeCard, isSelected && styles.themeCardSelected)}
              onClick={() => onSelectTheme(theme.id)}
            >
              <div className={styles.swatches}>
                <span className={styles.swatch} style={{ background: theme.preview.primary }} />
                <span className={styles.swatch} style={{ background: theme.preview.secondary }} />
                <span className={styles.swatch} style={{ background: theme.preview.background }} />
              </div>
              <div className={styles.themeInfo}>
                <span className={styles.themeName}>{theme.name}</span>
                <span className={styles.themeDesc}>{theme.description}</span>
              </div>
              {isSelected && (
                <span className={classNames("material-symbols-outlined", styles.checkIcon)}>
                  {selectedIcon}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <p className={styles.sectionLabel}>Audio</p>
      <div className={styles.audioCard}>
        <div className={styles.audioHeader}>
          <span className={styles.audioTitle}>Lobby Music</span>
          <button
            type="button"
            className={classNames(styles.muteButton, muted && styles.muteButtonMuted)}
            onClick={onToggleMute}
          >
            {muted ? "Muted" : "On"}
          </button>
        </div>
        <div className={styles.volumeRow}>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={sliderValue}
            className={styles.volumeSlider}
            aria-label="Lobby music volume"
            onChange={(event) => onMusicVolumeChange?.(Number(event.target.value) / 100)}
          />
          <span className={styles.volumeValue}>{sliderValue}%</span>
        </div>
      </div>
    </div>
  );
}
