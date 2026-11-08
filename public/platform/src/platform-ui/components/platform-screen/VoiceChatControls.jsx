import React from "react";
import styles from "./VoiceChatControls.module.scss";

/** @typedef {import("../../../../shared/voiceProtocol.js").VoiceChatState} VoiceChatState */
/**
 * @typedef {object} VoiceAudioButtonsProps
 * @property {VoiceChatState} state
 * @property {boolean} [compact]
 * @property {boolean} [disabled]
 * @property {() => Promise<unknown>} [onJoin] Only the parent interprets action outcomes.
 * @property {(muted:boolean) => Promise<unknown>} onMicrophoneMutedChange
 * @property {(deafened:boolean) => void} onDeafenedChange
 * @property {() => Promise<unknown>} onResumePlayback
 */

/**
 * Failed peer links retain membership and capture until the user leaves.
 * Setup failures instead clear the participant list and microphone.
 * @param {VoiceChatState} state
 * @returns {boolean} Whether room audio is still joined, including failed links.
 */
export function isVoiceChatJoined(state) {
  return state.status === "waiting" || state.status === "connecting" || state.status === "connected"
    || (state.status === "error" && state.participants.length > 0);
}

/**
 * Share explicit microphone/sound controls between gameplay and voice settings.
 * Joining or unmuting may request browser permission only after a button press.
 * @param {VoiceAudioButtonsProps} props
 * @returns {React.ReactElement}
 */
export function VoiceAudioButtons({
  state, compact = false, disabled = false, onJoin,
  onMicrophoneMutedChange, onDeafenedChange, onResumePlayback,
}) {
  const joined = isVoiceChatJoined(state);
  const joining = state.status === "joining";
  const microphoneAction = joined
    ? state.microphoneMuted ? "Unmute microphone" : "Mute microphone"
    : joining ? "Turning on voice" : "Turn on voice";
  const microphoneLabel = joined ? state.microphoneMuted ? "Mic off" : "Mic on"
    : joining ? "Connecting…" : "Voice off";
  const resumePlayback = state.playbackBlocked && !state.deafened;
  const soundAction = resumePlayback ? "Play voice audio"
    : state.deafened ? "Unmute incoming voice" : "Mute incoming voice";
  const soundLabel = resumePlayback ? "Play audio" : state.deafened ? "Sound off" : "Sound on";

  return (
    <div className={`${styles.audioButtons} ${compact ? styles.compact : ""}`} role="group" aria-label="Microphone and voice audio">
      <button
        type="button"
        className={styles.audioButton}
        aria-label={microphoneAction}
        aria-pressed={joined ? !state.microphoneMuted : undefined}
        aria-busy={joining || undefined}
        title={microphoneAction}
        disabled={disabled || joining || state.status === "unsupported"}
        onClick={() => { void (joined ? onMicrophoneMutedChange(!state.microphoneMuted) : onJoin?.()); }}
      >
        <span className="material-symbols-outlined" aria-hidden="true">
          {joined ? state.microphoneMuted ? "mic_off" : "mic" : joining ? "sync" : "headset_mic"}
        </span>
        <span className={styles.buttonLabel}>{microphoneLabel}</span>
      </button>
      {joined && <button
        type="button"
        className={styles.audioButton}
        aria-label={soundAction}
        aria-pressed={resumePlayback ? undefined : !state.deafened}
        title={soundAction}
        disabled={disabled}
        onClick={() => {
          if (resumePlayback) void onResumePlayback();
          else onDeafenedChange(!state.deafened);
        }}
      >
        <span className="material-symbols-outlined" aria-hidden="true">
          {resumePlayback ? "play_circle" : state.deafened ? "volume_off" : "volume_up"}
        </span>
        <span className={styles.buttonLabel}>{soundLabel}</span>
      </button>}
    </div>
  );
}

/**
 * Keep everyday voice actions available without covering or remounting gameplay.
 * @param {VoiceAudioButtonsProps & {available:boolean,dialogOpen:boolean,unavailableReason:string,onOpen:()=>void}} props
 * @returns {React.ReactElement}
 */
export default function VoiceChatControls({
  state, available, dialogOpen, unavailableReason, onOpen, disabled = false,
  onJoin, onMicrophoneMutedChange, onDeafenedChange, onResumePlayback,
}) {
  return (
    <div className={styles.toolbarControls} role="group" aria-label="Room voice controls">
      <VoiceAudioButtons
        state={state}
        compact
        disabled={disabled || !available}
        onJoin={onJoin}
        onMicrophoneMutedChange={onMicrophoneMutedChange}
        onDeafenedChange={onDeafenedChange}
        onResumePlayback={onResumePlayback}
      />
      <button
        type="button"
        className={`${styles.settingsButton} ${state.errorMessage ? styles.settingsError : ""}`}
        aria-label="Voice chat"
        aria-haspopup="dialog"
        aria-expanded={dialogOpen}
        data-voice-status={state.status}
        title={!available ? unavailableReason : state.errorMessage || "Voice settings"}
        disabled={disabled || !available}
        onClick={onOpen}
      >
        <span className="material-symbols-outlined" aria-hidden="true">{state.errorMessage ? "error_outline" : "expand_more"}</span>
      </button>
    </div>
  );
}
