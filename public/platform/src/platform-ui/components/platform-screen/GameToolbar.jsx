import React from "react";
import ConnectionIndicator from "./ConnectionIndicator.jsx";
import VoiceChatControls from "./VoiceChatControls.jsx";
import styles from "./GameChrome.module.scss";

/**
 * @typedef {object} GameToolbarProps
 * @property {boolean} showNetworkUi
 * @property {{status?:string,ping?:number}} [connection]
 * @property {boolean} networkPanelOpen
 * @property {React.RefObject<HTMLButtonElement|null>} networkButtonRef
 * @property {() => void} onToggleNetwork
 * @property {boolean} isFullscreen
 * @property {() => void} onToggleFullscreen
 * @property {string} fullscreenIcon
 * @property {{connected?:string,connecting?:string,reconnecting?:string,disconnected?:string}} [connectionIcons]
 * @property {boolean} [allowTouchCustomization]
 * @property {() => void} [onEditControls]
 * @property {boolean} [disabled]
 * @property {boolean} [expandedPlayArea]
 * @property {() => void} [onHome]
 * @property {() => void} [onInvite]
 * @property {import("../../../../shared/voiceProtocol.js").VoiceChatState} voiceState
 * @property {boolean} voiceAvailable
 * @property {boolean} voiceDialogOpen
 * @property {string} voiceUnavailableReason
 * @property {() => void} onOpenVoice
 * @property {() => Promise<void>} onJoinVoice
 * @property {(muted:boolean) => Promise<void>} onMicrophoneMutedChange
 * @property {(deafened:boolean) => void} onDeafenedChange
 * @property {() => Promise<void>} onResumeVoicePlayback
 */

/**
 * Keep platform controls separate from the renderer and its game-owned HUD.
 * @param {GameToolbarProps} props
 * @returns {React.ReactElement}
 */
export default function GameToolbar({
  showNetworkUi, connection, networkPanelOpen, networkButtonRef, onToggleNetwork,
  isFullscreen, onToggleFullscreen, fullscreenIcon, connectionIcons,
  allowTouchCustomization = false, onEditControls, disabled = false,
  expandedPlayArea = false, onHome, onInvite,
  voiceState, voiceAvailable, voiceDialogOpen, voiceUnavailableReason, onOpenVoice,
  onJoinVoice, onMicrophoneMutedChange, onDeafenedChange, onResumeVoicePlayback,
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
        {showNetworkUi && <VoiceChatControls
          state={voiceState}
          available={voiceAvailable}
          dialogOpen={voiceDialogOpen}
          unavailableReason={voiceUnavailableReason}
          onOpen={onOpenVoice}
          onJoin={onJoinVoice}
          onMicrophoneMutedChange={onMicrophoneMutedChange}
          onDeafenedChange={onDeafenedChange}
          onResumePlayback={onResumeVoicePlayback}
          disabled={disabled}
        />}
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
