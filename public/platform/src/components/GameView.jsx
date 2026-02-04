import React from "react";
import ConnectionIndicator from "./ConnectionIndicator.jsx";
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
  endGameActionLabel,
  onRematch,
  onBackHome,
  rematchDisabled,
  isFullscreen,
  onToggleFullscreen,
  connectionStatus,
  connectionPing,
}) {
  return (
    <div id="game-view" className={styles.gameView}>
      <div className={styles.canvasFrame}>
        <canvas id="game-canvas" className={styles.gameCanvas} />
        <div className={styles.canvasOverlay} />
        <ConnectionIndicator status={connectionStatus} ping={connectionPing} />
        <button
          type="button"
          className={styles.fullscreenButton}
          onClick={onToggleFullscreen}
          aria-pressed={isFullscreen}
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            {isFullscreen ? "fullscreen_exit" : "fullscreen"}
          </span>
          <span className={styles.fullscreenLabel}>
            {isFullscreen ? "Exit" : "Full Screen"}
          </span>
        </button>
        {endGameOpen && (
          <EndGameModal
            title={endGameTitle}
            subtitle={endGameSubtitle}
            status={endGameStatus}
            actionLabel={endGameActionLabel}
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
