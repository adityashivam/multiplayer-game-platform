import React from "react";
import ConnectionIndicator from "./ConnectionIndicator.jsx";
import styles from "./GameChrome.module.scss";

/**
 * Keep platform controls separate from the renderer and its game-owned HUD.
 * @param {{showNetworkUi: boolean, connection?: {status?: string, ping?: number}, networkPanelOpen: boolean, networkButtonRef: React.RefObject<HTMLButtonElement|null>, onToggleNetwork: () => void, isFullscreen: boolean, onToggleFullscreen: () => void, fullscreenIcon: string, connectionIcons?: {connected?: string, connecting?: string, reconnecting?: string, disconnected?: string}}} props
 * @returns {React.ReactElement}
 */
export default function GameToolbar({
  showNetworkUi, connection, networkPanelOpen, networkButtonRef, onToggleNetwork,
  isFullscreen, onToggleFullscreen, fullscreenIcon, connectionIcons,
  allowTouchCustomization = false, onEditControls, disabled = false,
  expandedPlayArea = false, onHome, onInvite,
}) {
  return (
    <div className={styles.toolbar} role="group" aria-label="Game session controls">
      {showNetworkUi && <ConnectionIndicator status={connection?.status} ping={connection?.ping} icons={connectionIcons} />}
      <div className={styles.toolbarActions}>
        {expandedPlayArea && <>
          <button type="button" className={styles.networkButton} onClick={onHome} aria-label="Leave game" title="Return to library" disabled={disabled}>
            <span className="material-symbols-outlined" aria-hidden="true">home</span>
          </button>
          {onInvite && <button type="button" className={styles.networkButton} onClick={onInvite} aria-label="Invite players" title="Invite players" disabled={disabled}>
            <span className="material-symbols-outlined" aria-hidden="true">person_add</span>
          </button>}
        </>}
        {allowTouchCustomization && <button type="button" className={styles.networkButton} onClick={onEditControls} aria-label="Customize touch controls" title="Customize touch controls" disabled={disabled}>
          <span className="material-symbols-outlined" aria-hidden="true">tune</span>
          <span className={styles.controlLabel}>Controls</span>
        </button>}
        {showNetworkUi && (
          <button
            type="button"
            className={styles.networkButton}
            onClick={onToggleNetwork}
            aria-label="Network diagnostics"
            aria-expanded={networkPanelOpen}
            aria-controls="network-diagnostics"
            title="Network diagnostics (N)"
            ref={networkButtonRef}
            disabled={disabled}
          >
            <span className="material-symbols-outlined" aria-hidden="true">monitoring</span>
            <span className={styles.controlLabel}>Network</span>
          </button>
        )}
        <button
          type="button"
          className={styles.fullscreenButton}
          onClick={onToggleFullscreen}
          aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          aria-pressed={isFullscreen}
          title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          disabled={disabled}
        >
          <span className="material-symbols-outlined" aria-hidden="true">{fullscreenIcon}</span>
          <span className={styles.controlLabel}>{isFullscreen ? "Exit fullscreen" : "Fullscreen"}</span>
        </button>
      </div>
    </div>
  );
}
