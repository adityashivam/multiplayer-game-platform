import React from "react";
import classNames from "../utils/classNames.js";
import styles from "../App.module.scss";

export default function ExitConfirmModal({ onConfirm, onCancel }) {
  return (
    <div className={styles.shareOverlay} role="dialog" aria-modal="true" aria-label="Exit game confirmation">
      <div className={classNames(styles.shareModal, styles.endGameModal)}>
        <div className={styles.shareHeader}>
          <div className={styles.sharePattern} aria-hidden="true" />
          <h2 className={styles.shareTitle}>Exit to Home?</h2>
          <p className={styles.shareSubtitle}>Leave this game and return to the home lobby.</p>
        </div>
        <div className={classNames(styles.shareBody, styles.endGameBody)}>
          <button
            type="button"
            className={classNames(styles.shareActionPrimary, styles.endGameAction)}
            onClick={onConfirm}
          >
            <div className={styles.shareActionIcon}>
              <span className="material-symbols-outlined">home</span>
            </div>
            <div className={styles.shareActionText}>
              <span className={styles.shareActionEyebrow}>Confirm</span>
              <span className={styles.shareActionTitle}>Go to Home</span>
            </div>
          </button>

          <button
            type="button"
            className={classNames(styles.shareActionGhost, styles.endGameAction)}
            onClick={onCancel}
          >
            <span className={classNames("material-symbols-outlined", styles.shareGhostIcon)}>
              sports_esports
            </span>
            <span className={styles.shareGhostLabel}>Stay in Game</span>
          </button>
        </div>
      </div>
    </div>
  );
}
