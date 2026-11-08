import React from "react";
import PlatformDialog from "./PlatformDialog.jsx";
import styles from "./PlatformDialog.module.scss";

/**
 * Present game-supplied results and rematch state using platform-owned controls.
 * Optional voice settings temporarily replace results while preserving the call and match state.
 * @param {{title?: string, subtitle?: string, status?: string, actionLabel?: string, onRematch: () => void, onBack: () => void, rematchDisabled?: boolean, icons?: {rematch?: string, backHome?: string},onOpenVoice?:()=>void}} props
 * @returns {React.ReactElement}
 */
export default function EndGameModal({ title, subtitle, status, actionLabel, onRematch, onBack, rematchDisabled, icons, onOpenVoice }) {
  return (
    <PlatformDialog
      label="Match results"
      title={title || "Match complete"}
      eyebrow="Match results"
      description={subtitle || "Ready for the next round?"}
      icon="sports_esports"
      footer={status && <span role="status">{status}</span>}
    >
      <div className={styles.actions}>
        <button type="button" className={styles.primaryAction} onClick={onRematch} disabled={rematchDisabled}>
          <span className="material-symbols-outlined" aria-hidden="true">{icons?.rematch || "sports_mma"}</span>
          {actionLabel || "Challenge Opponent"}
        </button>
        {onOpenVoice && <button type="button" className={styles.secondaryAction} onClick={onOpenVoice} aria-label="Open room voice settings" aria-haspopup="dialog">
          <span className="material-symbols-outlined" aria-hidden="true">headset_mic</span>
          Voice chat
        </button>}
        <button type="button" className={styles.secondaryAction} onClick={onBack}>
          <span className="material-symbols-outlined" aria-hidden="true">{icons?.backHome || "home"}</span>
          Back to Home
        </button>
      </div>
    </PlatformDialog>
  );
}
