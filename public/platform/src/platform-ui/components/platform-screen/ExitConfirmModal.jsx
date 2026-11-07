import React, { useRef } from "react";
import PlatformDialog from "./PlatformDialog.jsx";
import styles from "./PlatformDialog.module.scss";

/**
 * Confirm leaving a game, focusing the safe action before accepting keyboard input.
 * @param {{onConfirm: () => void, onCancel: () => void, icons?: {goHome?: string, stay?: string}}} props
 * @returns {React.ReactElement}
 */
export default function ExitConfirmModal({ onConfirm, onCancel, icons }) {
  const stayButtonRef = useRef(null);

  return (
    <PlatformDialog
      label="Exit game confirmation"
      title="Leave this game?"
      eyebrow="Return to library"
      description="Leave this game and return to your game library."
      icon={icons?.goHome || "home"}
      onClose={onCancel}
      closeLabel="Close exit confirmation"
      initialFocusRef={stayButtonRef}
    >
      <div className={styles.actions}>
        <button type="button" className={styles.primaryAction} onClick={onConfirm}>
          <span className="material-symbols-outlined" aria-hidden="true">{icons?.goHome || "home"}</span>
          Go to Home
        </button>
        <button type="button" className={styles.secondaryAction} onClick={onCancel} ref={stayButtonRef}>
          <span className="material-symbols-outlined" aria-hidden="true">{icons?.stay || "sports_esports"}</span>
          Stay in Game
        </button>
      </div>
    </PlatformDialog>
  );
}
