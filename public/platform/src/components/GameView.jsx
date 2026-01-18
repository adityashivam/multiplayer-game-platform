import React from "react";
import EndGameModal from "./EndGameModal.jsx";
import ShareModal from "./ShareModal.jsx";
import styles from "../App.module.scss";

export default function GameView({
  shareOpen,
  onCloseShare,
  roomLabel,
  shareUrl,
  copyLabel,
  onCopyShare,
  gameLoadError,
  endGameOpen,
  endGameTitle,
  endGameSubtitle,
  endGameStatus,
  onRematch,
  onBackHome,
  rematchDisabled,
}) {
  return (
    <div id="game-view" className={styles.gameView}>
      <div className={styles.canvasFrame}>
        <canvas id="game-canvas" className={styles.gameCanvas} />
        <div className={styles.canvasOverlay} />
        {endGameOpen && (
          <EndGameModal
            title={endGameTitle}
            subtitle={endGameSubtitle}
            status={endGameStatus}
            onRematch={onRematch}
            onBack={onBackHome}
            rematchDisabled={rematchDisabled}
          />
        )}
        {shareOpen && (
          <ShareModal
            roomLabel={roomLabel}
            shareUrl={shareUrl}
            copyLabel={copyLabel}
            onCopyShare={onCopyShare}
            onClose={onCloseShare}
          />
        )}
        {gameLoadError && <div className={styles.emptyState}>{gameLoadError}</div>}
      </div>
    </div>
  );
}
