import React from "react";
import PlatformDialog from "./PlatformDialog.jsx";
import dialogStyles from "./PlatformDialog.module.scss";
import styles from "./ShareModal.module.scss";

/**
 * @typedef {object} InviteDialogProps
 * @property {() => void} onClose
 * @property {string} roomLabel
 * @property {string} shareUrl
 * @property {"Copy"|"Copied!"|"Select & copy"} [copyLabel]
 * @property {() => void|Promise<void>} onCopyShare Caller owns clipboard failure and feedback state.
 * @property {{close?: string, invite?: string, copy?: string}} [icons]
 */

/**
 * Present a game-independent room link with caller-owned clipboard behavior.
 * @param {InviteDialogProps} props
 * @returns {React.ReactElement}
 */
export default function ShareModal({ onClose, roomLabel, shareUrl, copyLabel = "Copy", onCopyShare, icons }) {
  const copyActionLabel = copyLabel === "Copy" ? "Copy invite link" : copyLabel;

  return (
    <PlatformDialog
      label="Invite players"
      title="Invite players"
      eyebrow={roomLabel}
      description="Share your room link with the people you want to play with."
      icon={icons?.invite || "person_add"}
      onClose={onClose}
      closeLabel="Close invite dialog"
      closeIcon={icons?.close}
    >
      <div className={styles.linkField}>
        <label htmlFor="invite-room-url">Room link</label>
        <div className={styles.linkInputRow}>
          <span className="material-symbols-outlined" aria-hidden="true">link</span>
          <input
            id="invite-room-url"
            value={shareUrl}
            placeholder="Getting your room link…"
            readOnly
            spellCheck={false}
            onFocus={(event) => event.target.select()}
          />
        </div>
      </div>
      <div className={dialogStyles.actions}>
        <button type="button" className={dialogStyles.primaryAction} onClick={onCopyShare} disabled={!shareUrl} aria-label="Copy room link">
          <span className="material-symbols-outlined" aria-hidden="true">{copyLabel === "Copied!" ? "check" : icons?.copy || "content_copy"}</span>
          <span aria-live="polite">{copyActionLabel}</span>
        </button>
        <button type="button" className={dialogStyles.secondaryAction} onClick={onClose}>Back to game</button>
      </div>
      <p className={styles.hint}>
        <span className="material-symbols-outlined" aria-hidden="true">info</span>
        Keep this tab open while players join.
      </p>
    </PlatformDialog>
  );
}
