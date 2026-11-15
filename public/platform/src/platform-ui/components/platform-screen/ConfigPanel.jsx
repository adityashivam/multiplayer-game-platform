import React from "react";
import classNames from "../../../utils/classNames.js";
import styles from "./ConfigPanel.module.scss";
import TouchControlSettings from "./TouchControlSettings.jsx";
import ThemeSettings from "./ThemeSettings.jsx";
import { ThemeBackdropLayers } from "./LibraryBackdrop.jsx";

/**
 * The background behind the settings screen: the theme's ambient glow,
 * pattern or image, dimmed further than the library so the cards stay
 * readable. Decorative only.
 * @param {{background?: import("../../services/platformThemes.js").PlatformThemeBackground}} props
 * @returns {React.ReactElement}
 */
export function SettingsBackdrop({ background }) {
  const themed = background && background.style !== "game-art";
  return (
    <div className={styles.settingsBackdrop} aria-hidden="true" style={themed ? { "--backdrop-blur": `${background.blur}px` } : undefined}>
      {themed && <div className={styles.settingsBackdropLayers}><ThemeBackdropLayers background={background} /></div>}
    </div>
  );
}

/**
 * Present developer-enabled game layouts, audio and the platform theme.
 * Wide screens show game controls beside a column of sound and theme.
 * @param {{musicVolume: number, muted: boolean, onToggleMute: () => void, onMusicVolumeChange: (volume: number) => void, onDialogChange?: (open: boolean) => void, theme: ReturnType<typeof import("../../hooks/usePlatformTheme.js").default>}} props
 * @returns {React.ReactElement}
 */
export default function ConfigPanel({
  musicVolume,
  muted,
  onToggleMute,
  onMusicVolumeChange,
  onDialogChange,
  theme,
}) {
  const sliderValue = Math.round((musicVolume ?? 0) * 100);

  return (
    <section className={styles.panel} aria-labelledby="settings-title" tabIndex={0}>
      <h1 id="settings-title" className={styles.heading}>Settings</h1>
      <p className={styles.headingNote}>Controls, sound and theme for this device.</p>
      <div className={styles.settingsLayout}>
        <TouchControlSettings onDialogChange={onDialogChange} />
        <div className={styles.settingsSide}>
          <section className={styles.settingsCard} aria-labelledby="sound-settings-title" data-settings-section="sound">
            <div className={styles.cardIntro}>
              <span className={classNames("material-symbols-outlined", styles.cardIcon)} aria-hidden="true">graphic_eq</span>
              <div>
                <h2 id="sound-settings-title">Sound</h2>
                <p>Music and effects while you browse.</p>
              </div>
            </div>
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
          <ThemeSettings
            themes={theme.themes}
            builtInCount={theme.builtInCount}
            selectedTheme={theme.selectedTheme}
            onSelectTheme={theme.selectTheme}
            onImportTheme={theme.importTheme}
            onCustomizeTheme={theme.customizeTheme}
            onRemoveTheme={theme.removeTheme}
          />
        </div>
      </div>
    </section>
  );
}
