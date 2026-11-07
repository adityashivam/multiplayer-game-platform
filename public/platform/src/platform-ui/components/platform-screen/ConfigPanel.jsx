import React from "react";
import classNames from "../../../utils/classNames.js";
import styles from "./ConfigPanel.module.scss";

/**
 * Expose lobby audio preferences with platform controls and caller-owned persistence.
 * @param {{musicVolume: number, muted: boolean, onToggleMute: () => void, onMusicVolumeChange: (volume: number) => void}} props
 * @returns {React.ReactElement}
 */
export default function ConfigPanel({
  musicVolume,
  muted,
  onToggleMute,
  onMusicVolumeChange,
}) {
  const sliderValue = Math.round((musicVolume ?? 0) * 100);

  return (
    <div className={styles.panel}>
      <h1 className={styles.heading}>Settings</h1>
      <p className={styles.sectionLabel}>Audio</p>
      <div className={styles.audioCard}>
        <div className={styles.audioHeader}>
          <div>
            <span className={styles.audioTitle}>Lobby music</span>
            <p className={styles.audioDescription}>Music plays while you browse.</p>
          </div>
          <button
            type="button"
            className={classNames(styles.muteButton, muted && styles.muteButtonMuted)}
            onClick={onToggleMute}
            aria-pressed={muted}
            aria-label={muted ? "Unmute lobby music" : "Mute lobby music"}
          >
            <span className="material-symbols-outlined" aria-hidden="true">{muted ? "volume_off" : "volume_up"}</span>
            <span>{muted ? "Muted" : "On"}</span>
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
