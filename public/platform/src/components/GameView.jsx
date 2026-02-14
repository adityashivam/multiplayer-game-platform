import React, { useEffect, useMemo, useState } from "react";
import ConnectionIndicator from "./ConnectionIndicator.jsx";
import EndGameModal from "./EndGameModal.jsx";
import ExitConfirmModal from "./ExitConfirmModal.jsx";
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
  exitConfirmOpen,
  onConfirmExit,
  onCancelExit,
  isFullscreen,
  onToggleFullscreen,
  connection,
  icons,
}) {
  const [networkPanelOpen, setNetworkPanelOpen] = useState(false);
  const fullscreenIcon = isFullscreen
    ? icons?.game?.fullscreenOff || "fullscreen_exit"
    : icons?.game?.fullscreenOn || "fullscreen";
  const connectionStatus = connection?.status;
  const connectionPing = connection?.ping;

  useEffect(() => {
    const handleKeydown = (event) => {
      const tag = event?.target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (event.key?.toLowerCase() !== "n" || event.repeat) return;
      event.preventDefault();
      setNetworkPanelOpen((prev) => !prev);
    };
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, []);

  const networkRows = useMemo(
    () => [
      { label: "Status", value: (connectionStatus || "connecting").toUpperCase() },
      { label: "Ping", value: Number.isFinite(connectionPing) ? `${connectionPing} ms` : "--" },
      {
        label: "Jitter",
        value: Number.isFinite(connection?.jitterMs) ? `${connection.jitterMs.toFixed(1)} ms` : "--",
      },
      {
        label: "Packet Loss",
        value: Number.isFinite(connection?.packetLossPct)
          ? `${connection.packetLossPct.toFixed(1)}%`
          : "--",
      },
      {
        label: "Update Rate",
        value: Number.isFinite(connection?.updateRateHz) ? `${connection.updateRateHz.toFixed(1)} Hz` : "--",
      },
      {
        label: "Tick Rate",
        value: Number.isFinite(connection?.serverTickRate) ? `${connection.serverTickRate} Hz` : "--",
      },
      {
        label: "Out-of-order",
        value: Number.isFinite(connection?.outOfOrderCount) ? String(connection.outOfOrderCount) : "--",
      },
    ],
    [
      connection?.jitterMs,
      connection?.outOfOrderCount,
      connection?.packetLossPct,
      connection?.serverTickRate,
      connection?.updateRateHz,
      connectionPing,
      connectionStatus,
    ],
  );

  return (
    <div id="game-view" className={styles.gameView}>
      <div className={styles.canvasFrame}>
        <canvas id="game-canvas" className={styles.gameCanvas} />
        <div className={styles.canvasOverlay} />
        <ConnectionIndicator status={connectionStatus} ping={connectionPing} icons={icons?.connection} />
        <button
          type="button"
          className={styles.networkButton}
          onClick={() => setNetworkPanelOpen((prev) => !prev)}
          aria-pressed={networkPanelOpen}
        >
          NET
        </button>
        {networkPanelOpen && (
          <div className={styles.networkPanel} aria-live="polite">
            {networkRows.map((row) => (
              <div key={row.label} className={styles.networkRow}>
                <span>{row.label}</span>
                <span>{row.value}</span>
              </div>
            ))}
          </div>
        )}
        <button
          type="button"
          className={styles.fullscreenButton}
          onClick={onToggleFullscreen}
          aria-pressed={isFullscreen}
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            {fullscreenIcon}
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
            icons={icons?.endGame}
          />
        )}
        {shareOpen && (
          <ShareModal
            roomLabel={roomLabel}
            shareUrl={shareUrl}
            copyLabel={copyLabel}
            onCopyShare={onCopyShare}
            onClose={onCloseShare}
            icons={icons?.share}
          />
        )}
        {exitConfirmOpen && (
          <ExitConfirmModal onConfirm={onConfirmExit} onCancel={onCancelExit} icons={icons?.exitConfirm} />
        )}
        {gameLoadError && <div className={styles.emptyState}>{gameLoadError}</div>}
      </div>
    </div>
  );
}
