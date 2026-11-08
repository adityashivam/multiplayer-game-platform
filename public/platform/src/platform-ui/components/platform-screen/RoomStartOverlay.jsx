import React, { useEffect, useRef } from "react";
import PlatformDialog from "./PlatformDialog.jsx";
import dialogStyles from "./PlatformDialog.module.scss";
import styles from "./RoomStartOverlay.module.scss";

/** Present server-owned readiness without changing the runtime or shell geometry. */
export default function RoomStartOverlay({ room, gameName, isCreatorEntry, onInvite, onLeave }) {
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
          <button type="button" className={failed ? dialogStyles.primaryAction : dialogStyles.secondaryAction} onClick={onLeave}>{failed ? "Back to library" : "Leave room"}</button>
        </div>
      </PlatformDialog>
    </div>
  );
}
