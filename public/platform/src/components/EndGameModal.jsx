import React from "react";
import classNames from "../utils/classNames.js";
import styles from "../App.module.scss";

export default function EndGameModal({
  title,
  subtitle,
  status,
  actionLabel,
  onRematch,
  onBack,
  rematchDisabled,
}) {
  return (
    <div className={styles.shareOverlay} role="dialog" aria-modal="true" aria-label="Match results">
      <div className={classNames(styles.shareModal, styles.endGameModal)}>
        <div className={styles.shareHeader}>
          <div className={styles.sharePattern} aria-hidden="true" />
          <h2 className={styles.shareTitle}>{title || "Match Complete"}</h2>
          <p className={styles.shareSubtitle}>{subtitle || "Ready for the next round?"}</p>
        </div>
        <div className={classNames(styles.shareBody, styles.endGameBody)}>
          <button
            type="button"
            className={classNames(styles.shareActionPrimary, styles.endGameAction)}
            onClick={onRematch}
            disabled={rematchDisabled}
          >
            <div className={styles.shareActionIcon}>
              <span className="material-symbols-outlined">sports_mma</span>
            </div>
            <div className={styles.shareActionText}>
              <span className={styles.shareActionEyebrow}>Rematch</span>
              <span className={styles.shareActionTitle}>
                {actionLabel || "Challenge Opponent"}
              </span>
            </div>
          </button>

          <button
            type="button"
            className={classNames(styles.shareActionGhost, styles.endGameAction)}
            onClick={onBack}
          >
            <span className={classNames("material-symbols-outlined", styles.shareGhostIcon)}>home</span>
            <span className={styles.shareGhostLabel}>Back to Home</span>
          </button>
        </div>
        {status && <div className={styles.shareFooter}>{status}</div>}
      </div>
    </div>
  );
}
