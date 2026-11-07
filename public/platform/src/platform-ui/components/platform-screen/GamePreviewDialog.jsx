import React, { useEffect, useRef } from "react";
import GameShowcase from "./GameShowcase.jsx";
import styles from "./GameLibrary.module.scss";

/** Native modal details keep portrait browsing uncluttered and contain keyboard focus while open. */
export default function GamePreviewDialog({ game, onActivate, onClose }) {
  const dialogRef = useRef(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className={styles.previewDialog}
      aria-labelledby="selected-game-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <button type="button" className={styles.previewBack} onClick={onClose} autoFocus>
        <span className="material-symbols-outlined" aria-hidden="true">arrow_back</span>
        Back to library
      </button>
      <GameShowcase game={game} onActivate={onActivate} />
    </dialog>
  );
}
