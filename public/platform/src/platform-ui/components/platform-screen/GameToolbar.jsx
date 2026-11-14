import React from "react";
import ConnectionIndicator from "./ConnectionIndicator.jsx";
import VoiceChatControls from "./VoiceChatControls.jsx";
import styles from "./GameChrome.module.scss";

/**
 * @typedef {object} GameToolbarProps
 * @property {boolean} showNetworkUi
 * @property {string} [gameName] Shown next to the leave button when there is room.
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
 * A slim bar in its own row above the play surface, so platform controls
 * never cover a game's HUD. Buttons are icon-only; their accessible names
 * and tooltips carry the labels.
 * @param {GameToolbarProps} props
 * @returns {React.ReactElement}
 */
export default function GameToolbar({
  showNetworkUi, gameName, connection, networkPanelOpen, networkButtonRef, onToggleNetwork,
  isFullscreen, onToggleFullscreen, fullscreenIcon, connectionIcons,
  allowTouchCustomization = false, onEditControls, disabled = false,
  expandedPlayArea = false, onHome, onInvite,
  voiceState, voiceAvailable, voiceDialogOpen, voiceUnavailableReason, onOpenVoice,
  onJoinVoice, onMicrophoneMutedChange, onDeafenedChange, onResumeVoicePlayback,
}) {
  return (
    <div className={styles.toolbar} role="group" aria-label="Game session controls">
      <div className={styles.toolbarIdentity}>
        {expandedPlayArea && <button type="button" className={styles.toolbarButton} onClick={onHome} aria-label="Leave game" title="Return to library" disabled={disabled}>
          <span className="material-symbols-outlined" aria-hidden="true">arrow_back</span>
        </button>}
        {gameName && <span className={styles.toolbarTitle}>{gameName}</span>}
        {showNetworkUi && <ConnectionIndicator status={connection?.status} ping={connection?.ping} icons={connectionIcons} />}
      </div>
      <div className={styles.toolbarActions}>
        {expandedPlayArea && onInvite && <button type="button" className={styles.toolbarButton} onClick={onInvite} aria-label="Invite players" title="Invite players" disabled={disabled}>
          <span className="material-symbols-outlined" aria-hidden="true">person_add</span>
        </button>}
        {allowTouchCustomization && <button type="button" className={styles.toolbarButton} onClick={onEditControls} aria-label="Customize touch controls" title="Customize touch controls" disabled={disabled}>
          <span className="material-symbols-outlined" aria-hidden="true">tune</span>
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
            className={styles.toolbarButton}
            onClick={onToggleNetwork}
            aria-label="Network diagnostics"
            aria-expanded={networkPanelOpen}
            aria-controls="network-diagnostics"
            title="Network diagnostics (N)"
            ref={networkButtonRef}
            disabled={disabled}
          >
            <span className="material-symbols-outlined" aria-hidden="true">monitoring</span>
          </button>
        )}
        <button
          type="button"
          className={styles.toolbarButton}
          onClick={onToggleFullscreen}
          aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          aria-pressed={isFullscreen}
          title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          disabled={disabled}
        >
          <span className="material-symbols-outlined" aria-hidden="true">{fullscreenIcon}</span>
        </button>
      </div>
    </div>
  );
}
