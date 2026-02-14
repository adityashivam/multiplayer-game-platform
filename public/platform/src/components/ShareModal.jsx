import React from "react";
import classNames from "../utils/classNames.js";
import styles from "../App.module.scss";

export default function ShareModal({ onClose, roomLabel, shareUrl, copyLabel, onCopyShare, icons }) {
  const copyDisabled = !shareUrl;

  return (
    <div className={styles.shareOverlay} role="dialog" aria-modal="true" aria-label="Invite players">
      <div className={styles.shareModal}>
        <button
          type="button"
          className={styles.shareClose}
          onClick={onClose}
          aria-label="Close invite dialog"
        >
          <span className={classNames("material-symbols-outlined", styles.shareCloseIcon)}>
            {icons?.close || "close"}
          </span>
        </button>
        <div className={styles.shareHeader}>
          <div className={styles.sharePattern} aria-hidden="true" />
          <h2 className={styles.shareTitle}>Invite Players</h2>
          <p className={styles.shareSubtitle}>{roomLabel} Lobby</p>
        </div>
        <div className={styles.shareBody}>
          <div className={styles.shareField}>
            <label className={styles.shareFieldLabel}>Share Room Link</label>
            <div className={styles.shareInputRow}>
              <input
                className={styles.shareLinkInput}
                value={shareUrl}
                placeholder="Generating room link..."
                readOnly
              />
              <button
                type="button"
                className={styles.shareCopy}
                onClick={onCopyShare}
                aria-label="Copy room link"
                title={copyLabel}
                disabled={copyDisabled}
              >
                <span className="material-symbols-outlined">{icons?.copy || "content_copy"}</span>
              </button>
            </div>
          </div>
          <div className={styles.shareDivider}>
            <span className={styles.shareDividerLine} />
            <span className={styles.shareDividerText}>Or instant share</span>
            <span className={styles.shareDividerLine} />
          </div>
          <button type="button" className={styles.shareActionPrimary}>
            <div className={styles.shareActionIcon}>
              <span className="material-symbols-outlined">{icons?.invite || "person_add"}</span>
            </div>
            <div className={styles.shareActionText}>
              <span className={styles.shareActionEyebrow}>Online</span>
              <span className={styles.shareActionTitle}>Invite Active Friends</span>
            </div>
          </button>
          <button type="button" className={styles.shareActionWhatsApp}>
            <div className={styles.shareActionIcon}>
              <span className="material-symbols-outlined">{icons?.chat || "chat"}</span>
            </div>
            <div className={styles.shareActionText}>
              <span className={styles.shareActionEyebrow}>Send via</span>
              <span className={styles.shareActionTitle}>WhatsApp</span>
            </div>
          </button>
          <div className={styles.shareActionGrid}>
            <button type="button" className={styles.shareActionGhost}>
              <span className={classNames("material-symbols-outlined", styles.shareGhostIcon)}>
                {icons?.sms || "sms"}
              </span>
              <span className={styles.shareGhostLabel}>SMS</span>
            </button>
            <button type="button" className={styles.shareActionGhost}>
              <span className={classNames("material-symbols-outlined", styles.shareGhostIcon)}>
                {icons?.more || "share"}
              </span>
              <span className={styles.shareGhostLabel}>More</span>
            </button>
          </div>
        </div>
        <div className={styles.shareFooter}>Waiting for host to start...</div>
      </div>
    </div>
  );
}
