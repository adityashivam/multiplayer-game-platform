import React from "react";
import classNames from "../../../utils/classNames.js";
import styles from "./ConfigPanel.module.scss";

export default function ConfigPanel({
  musicVolume,
  muted,
  onToggleMute,
  onMusicVolumeChange,
}) {
  const sliderValue = Math.round((musicVolume ?? 0) * 100);

  return (
    <div className={styles.panel}>
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
