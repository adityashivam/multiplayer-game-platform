import React from "react";
import classNames from "../../../utils/classNames.js";
import styles from "./ConfigPanel.module.scss";
import TouchControlSettings from "./TouchControlSettings.jsx";

/**
 * Present developer-enabled game layouts and the platform's audio preferences.
 * @param {{musicVolume: number, muted: boolean, onToggleMute: () => void, onMusicVolumeChange: (volume: number) => void, onDialogChange?: (open: boolean) => void}} props
 * @returns {React.ReactElement}
 */
export default function ConfigPanel({
  musicVolume,
  muted,
  onToggleMute,
  onMusicVolumeChange,
  onDialogChange,
}) {
  const sliderValue = Math.round((musicVolume ?? 0) * 100);

  return (
    <section className={styles.panel} aria-labelledby="settings-title" tabIndex={0}>
      <h1 id="settings-title" className={styles.heading}>Settings</h1>
      <TouchControlSettings onDialogChange={onDialogChange} />
      <h2 className={styles.sectionLabel}>Audio</h2>
      <div className={styles.audioCard}>
        <div className={styles.audioHeader}>
          <div>
            <span className={styles.audioTitle}>Lobby music</span>
            <p className={styles.audioDescription}>Music plays while you browse.</p>
          </div>
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
    </section>
  );
}
