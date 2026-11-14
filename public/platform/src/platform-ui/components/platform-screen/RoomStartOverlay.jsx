import React, { useEffect, useRef } from "react";
import PlatformDialog from "./PlatformDialog.jsx";
import dialogStyles from "./PlatformDialog.module.scss";
import styles from "./RoomStartOverlay.module.scss";

/**
 * Present server-owned readiness without changing the runtime or shell geometry.
 * Voice settings can temporarily replace persistent waiting; countdowns keep focus.
 * @param {{room:import("../../../../frontend-engine/roomLifecycleClient.js").RoomLifecyclePresentation,gameName?:string,isCreatorEntry?:boolean,onInvite?:()=>void,onLeave:()=>void,onOpenVoice?:()=>void}} props
 * @returns {React.ReactElement|null}
 */
export default function RoomStartOverlay({ room, gameName, isCreatorEntry, onInvite, onLeave, onOpenVoice }) {
  const playing = room.phase === "playing";
  const countingDown = room.phase === "countdown";
  const countdownFocusRef = useRef(null);
  useEffect(() => {
    if (!playing) return undefined;
    const frameId = requestAnimationFrame(() => {
      if (!document.querySelector('[aria-modal="true"]')) document.getElementById("game-canvas")?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frameId);
  }, [playing]);

  if (room.showGo) {
    return <div className={styles.goCue} data-platform-room-go="true" role="status"><strong>GO!</strong><span>Game started</span></div>;
  }
  if (playing || room.phase === "finished") return null;

  const failed = room.phase === "error";
  const connecting = room.phase === "connecting" || room.phase === "reconnecting";
  // A brief mid-match reconnect resumes on its own; the toolbar indicator covers it.
  if (room.hasPlayed && room.phase === "reconnecting" && !room.recoveryNoticeDue) return null;
  if (room.hasPlayed && !failed) {
    const recoveryTitle = countingDown
      ? room.secondsRemaining > 0 ? `Resuming in ${room.secondsRemaining}` : "Resuming your match…"
      : connecting ? "Reconnecting…" : "Waiting for players to reconnect…";
    const recoveryDescription = countingDown
      ? "Everyone’s back. Your match will continue."
      : connecting ? "Match paused. Reconnecting automatically." : "Your match is paused until everyone is back.";

    return (
      <div className={styles.recoveryNotice} data-platform-room-recovery={room.phase}>
        <span className={`material-symbols-outlined ${styles.recoveryIcon}`} aria-hidden="true">{countingDown ? "sports_esports" : "wifi_find"}</span>
        <div className={styles.recoveryMessage} role="status" aria-live="polite" aria-atomic="true">
          <strong>{recoveryTitle}</strong>
          <span>{recoveryDescription}</span>
        </div>
        <button type="button" className={styles.recoveryLeaveButton} onClick={onLeave}>Leave room</button>
      </div>
    );
  }

  const title = failed ? "Room is full" : countingDown ? "Get ready" : room.phase === "reconnecting" ? "Rejoining your room" : connecting ? (isCreatorEntry ? "Preparing your room" : "Joining the room") : "Waiting for players";
  const description = failed ? room.errorMessage : countingDown ? "Everyone’s here. Your game is about to start." : connecting ? "Connecting you to the same game." : "The countdown begins when everyone has joined.";
  const remaining = room.secondsRemaining;
  const totalSeconds = Math.max(1, room.countdownDurationMs / 1000);
  const progress = countingDown && remaining !== null ? Math.max(0, Math.min(1, remaining / totalSeconds)) : 1;
  const circumference = 2 * Math.PI * 61;

  return (
    <div data-platform-room-start={room.phase}>
      <PlatformDialog
        label={failed ? "Unable to join room" : countingDown ? "Game starting" : "Room connection"}
        title={title}
        eyebrow={gameName || "MULTIPLAYER"}
        description={description}
        icon={failed ? "meeting_room" : countingDown ? "sports_esports" : "group"}
        initialFocusRef={countingDown ? countdownFocusRef : undefined}
      >
        {countingDown ? (
          <div className={styles.countdown} ref={countdownFocusRef} tabIndex={-1} role="timer" aria-label={remaining > 0 ? `Game starts in ${remaining} seconds` : "Waiting for the server to start"} aria-live="polite" aria-atomic="true">
            <svg viewBox="0 0 140 140" aria-hidden="true"><circle className={styles.track} cx="70" cy="70" r="61" /><circle className={styles.progress} cx="70" cy="70" r="61" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - progress)} /></svg>
            <strong key={remaining}>{remaining > 0 ? remaining : "…"}</strong>
          </div>
        ) : <div className={styles.waitingMark} aria-hidden="true"><span className="material-symbols-outlined">{failed ? "error_outline" : connecting ? "sync" : "group_add"}</span></div>}
        {!failed && <div className={styles.readiness}>
          <i className={countingDown ? styles.ready : ""} aria-hidden="true" />
          <span>{room.requiredPlayers > 0 ? `${room.connectedPlayers} of ${room.requiredPlayers} players connected` : "Connecting to your room"}</span>
        </div>}
        {countingDown && <p className={styles.startHint}>Your controls unlock when the game starts.</p>}
        <div className={dialogStyles.actions}>
          {!failed && !countingDown && !connecting && onInvite && <button type="button" className={dialogStyles.primaryAction} onClick={onInvite}>Invite players</button>}
          {!failed && !countingDown && onOpenVoice && <button type="button" className={dialogStyles.secondaryAction} onClick={onOpenVoice} aria-label="Open room voice settings" aria-haspopup="dialog">
            <span className="material-symbols-outlined" aria-hidden="true">headset_mic</span>
            Voice chat
          </button>}
          <button type="button" className={failed ? dialogStyles.primaryAction : dialogStyles.secondaryAction} onClick={onLeave}>{failed ? "Back to library" : "Leave room"}</button>
        </div>
      </PlatformDialog>
    </div>
  );
}
