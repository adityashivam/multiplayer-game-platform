import React, { useId } from "react";
import PlatformDialog from "./PlatformDialog.jsx";
import { isVoiceChatJoined, VoiceAudioButtons } from "./VoiceChatControls.jsx";
import dialogStyles from "./PlatformDialog.module.scss";
import styles from "./VoiceChatDialog.module.scss";

/** @typedef {import("../../../../shared/voiceProtocol.js").VoiceChatState} VoiceChatState */

/** @type {Readonly<Record<VoiceChatState["status"],string>>} */
const VOICE_STATUS_LABELS = Object.freeze({
  off: "Talk with the players in this room.",
  joining: "Turning on voice…",
  waiting: "Waiting for others to turn on voice.",
  connecting: "Connecting to the other players…",
  connected: "You're connected.",
  error: "Try turning voice on again.",
  unsupported: "Voice isn't available in this browser.",
});

/**
 * Show user-controlled room audio without changing game or canvas ownership.
 * State changes are event-driven; this dialog deliberately has no audio meters.
 * @param {{state:VoiceChatState,onClose:()=>void,onJoin:(options?:{listenOnly?:boolean})=>Promise<unknown>,onMicrophoneMutedChange:(muted:boolean)=>Promise<unknown>,onDeafenedChange:(deafened:boolean)=>void,onVolumeChange:(volume:number)=>void,onResumePlayback:()=>Promise<unknown>,onLeave:()=>void}} props
 * @returns {React.ReactElement}
 */
export default function VoiceChatDialog({
  state, onClose, onJoin, onMicrophoneMutedChange, onDeafenedChange,
  onVolumeChange, onResumePlayback, onLeave,
}) {
  const participantsHeadingId = useId();
  const joined = isVoiceChatJoined(state);
  const joining = state.status === "joining";
  const unsupported = state.status === "unsupported";
  const canLeave = joined || joining || state.status === "error";
  const volumePercent = Math.round(state.volume * 100);

  return (
    <PlatformDialog
      label="Room voice chat"
      title="Voice chat"
      description={<span data-voice-status={state.status} role={state.errorMessage ? "alert" : "status"} className={state.errorMessage ? styles.errorMessage : undefined}>
        {state.errorMessage || VOICE_STATUS_LABELS[state.status]}
      </span>}
      icon="headset_mic"
      onClose={onClose}
      closeLabel="Close voice chat"
    >
      {joined && <>
        <VoiceAudioButtons
          state={state}
          onMicrophoneMutedChange={onMicrophoneMutedChange}
          onDeafenedChange={onDeafenedChange}
          onResumePlayback={onResumePlayback}
        />
        <details className={styles.options} data-voice-options>
          <summary>More options <span className="material-symbols-outlined" aria-hidden="true">expand_more</span></summary>
          <label className={styles.volumeControl}>
            <span>Voice volume <output>{volumePercent}%</output></span>
            <input
              type="range"
              aria-label="Voice volume"
              min="0"
              max="100"
              step="5"
              value={volumePercent}
              onChange={(event) => onVolumeChange(Number(event.target.value) / 100)}
            />
          </label>
          {state.participants.length > 0 && <section className={styles.participants} aria-labelledby={participantsHeadingId}>
            <h3 id={participantsHeadingId}>Players in voice</h3>
            <ul>{state.participants.map((participant) => (
              <li key={participant.id}>
                <span>Player {participant.playerId}</span>
                <span className={styles.participantState}>
                  <span className="material-symbols-outlined" aria-hidden="true">{participant.muted ? "mic_off" : "mic"}</span>
                  {participant.connectionState === "failed" ? "Can't connect"
                    : participant.connectionState === "connecting" ? "Connecting…"
                      : participant.muted ? "Mic off" : "Mic on"}
                </span>
              </li>
            ))}</ul>
          </section>}
        </details>
      </>}

      <div className={dialogStyles.actions}>
        {!joined && !joining && !unsupported && <>
          <button type="button" className={dialogStyles.primaryAction} onClick={() => { void onJoin(); }}>
            <span className="material-symbols-outlined" aria-hidden="true">mic</span>
            Turn on voice
          </button>
          <button type="button" className={dialogStyles.secondaryAction} onClick={() => { void onJoin({ listenOnly: true }); }}>
            <span className="material-symbols-outlined" aria-hidden="true">headphones</span>
            Listen only
          </button>
        </>}
        {canLeave && <button type="button" className={dialogStyles.secondaryAction} onClick={onLeave}>
          <span className="material-symbols-outlined" aria-hidden="true">call_end</span>
          {joining ? "Cancel" : "Turn off voice"}
        </button>}
      </div>
    </PlatformDialog>
  );
}
