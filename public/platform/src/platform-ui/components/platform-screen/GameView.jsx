import React, { useEffect, useMemo, useRef, useState } from "react";
import GameToolbar from "./GameToolbar.jsx";
import NetworkPanel from "./NetworkPanel.jsx";
import EndGameModal from "./EndGameModal.jsx";
import ExitConfirmModal from "./ExitConfirmModal.jsx";
import ShareModal from "./ShareModal.jsx";
import RoomStartOverlay from "./RoomStartOverlay.jsx";
import GameOrientationPrompt from "./GameOrientationPrompt.jsx";
import { TOGGLE_NETWORK_PANEL_EVENT } from "../../constants/events.js";
import styles from "../../PlatformApp.module.scss";
import { TouchControlSurface, TouchLayoutEditor } from "../touch-controls/index.js";

const FRAME_SAMPLE_WINDOW = 120;
const FRAME_METRIC_PUSH_MS = 1000;
const TARGET_FRAME_MS = 1000 / 60;
const JANK_FRAME_MS = 25;
const DROPPED_FRAME_MS = 33.4;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function quantileFromSamples(samples, q) {
  if (!Array.isArray(samples) || samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * clamp(q, 0, 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  const t = idx - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * t;
}

export default function GameView({
  gameOrientation,
  roomLifecycle,
  roomCreatorEntry,
  runtimeSpec,
  game,
  touchProfile,
  touchOrientation = "landscape",
  touchControlsEnabled = false,
  expandedPlayArea = false,
  onSaveTouchProfile,
  touchProfileStatus = "",
  touchEditorOpen = false,
  onTouchEditorChange,
  onOpenInvite,
  onRequestHome,
  shareOpen,
  showNetworkUi = true,
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
  const [touchNotice, setTouchNotice] = useState("");
  const networkButtonRef = useRef(null);
  const roomStartBlocking = Boolean(roomLifecycle && !["playing", "finished"].includes(roomLifecycle.phase));
  const roomStartHasPriority = roomLifecycle?.phase === "countdown" || roomLifecycle?.phase === "error";
  const landscapePromptOpen = Boolean(gameOrientation?.needsLandscape && !gameLoadError);
  const platformDialogOpen = landscapePromptOpen || roomStartBlocking || shareOpen || endGameOpen || exitConfirmOpen || touchEditorOpen;
  const allowTouchCustomization = Boolean(game?.touchControls?.customizable && touchProfile);
  useEffect(() => {
    if (touchEditorOpen || !touchProfileStatus) return undefined;
    setTouchNotice(touchProfileStatus);
    const noticeTimer = window.setTimeout(() => setTouchNotice(""), 2800);
    return () => window.clearTimeout(noticeTimer);
  }, [touchProfileStatus, touchEditorOpen]);
  const runtimeKind = runtimeSpec?.kind || "module";
  const runtimeMount = runtimeSpec?.mount || "canvas";
  const showModuleCanvas = runtimeKind === "module" && runtimeMount !== "dom";
  const showModuleDom = runtimeKind === "module" && runtimeMount === "dom";
  const showUnity = runtimeKind === "unity-webgl";
  const showIframe = runtimeKind === "iframe";
  const fullscreenIcon = isFullscreen
    ? icons?.game?.fullscreenOff || "fullscreen_exit"
    : icons?.game?.fullscreenOn || "fullscreen";
  const connectionStatus = connection?.status;
  const connectionPing = connection?.ping;
  // Use ref for render metrics to avoid triggering React re-renders on every publish.
  // Only copy to state when the network panel is open (to update the display).
  const renderMetricsRef = useRef({
    fps: null,
    frameMs: null,
    frameP95Ms: null,
    jankPct: null,
    droppedPct: null,
  });
  const [renderMetrics, setRenderMetrics] = useState(renderMetricsRef.current);
  const networkPanelOpenRef = useRef(false);

  useEffect(() => {
    networkPanelOpenRef.current = networkPanelOpen;
    // When panel opens, push latest metrics to state so display is current
    if (networkPanelOpen) {
      setRenderMetrics({ ...renderMetricsRef.current });
    }
  }, [networkPanelOpen]);

  useEffect(() => {
    if (!showNetworkUi && networkPanelOpen) {
      setNetworkPanelOpen(false);
    }
  }, [networkPanelOpen, showNetworkUi]);

  useEffect(() => {
    if (!showNetworkUi) return undefined;

    const handleKeydown = (event) => {
      if (event.defaultPrevented || platformDialogOpen || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key === "Escape" && networkPanelOpen) {
        event.preventDefault();
        event.stopPropagation();
        setNetworkPanelOpen(false);
        networkButtonRef.current?.focus({ preventScroll: true });
        return;
      }
      const tag = event?.target?.tagName?.toLowerCase();
      if (tag === "input" || tag === "textarea" || tag === "select") return;
      if (event.key?.toLowerCase() !== "n" || event.repeat) return;
      event.preventDefault();
      event.stopPropagation();
      setNetworkPanelOpen((prev) => !prev);
    };

    const handleToggleNetworkPanel = () => {
      if (platformDialogOpen) return;
      setNetworkPanelOpen((prev) => !prev);
    };

    window.addEventListener("keydown", handleKeydown, true);
    window.addEventListener(TOGGLE_NETWORK_PANEL_EVENT, handleToggleNetworkPanel);
    return () => {
      window.removeEventListener("keydown", handleKeydown, true);
      window.removeEventListener(TOGGLE_NETWORK_PANEL_EVENT, handleToggleNetworkPanel);
    };
  }, [showNetworkUi, networkPanelOpen, platformDialogOpen]);

  useEffect(() => {
    let rafId = 0;
    let lastTimestamp = null;
    let lastPublished = 0;
    let ewmaFrameMs = TARGET_FRAME_MS;
    const frameSamples = [];

    const publishMetrics = (nowTs) => {
      const sampleCount = frameSamples.length;
      if (sampleCount === 0) return;
      const frameP95Ms = quantileFromSamples(frameSamples, 0.95);
      let jankCount = 0;
      let droppedCount = 0;
      for (let i = 0; i < sampleCount; i++) {
        if (frameSamples[i] > DROPPED_FRAME_MS) droppedCount++;
        if (frameSamples[i] > JANK_FRAME_MS) jankCount++;
      }
      const next = {
        fps: ewmaFrameMs > 0 ? 1000 / ewmaFrameMs : null,
        frameMs: ewmaFrameMs,
        frameP95Ms,
        jankPct: (jankCount / sampleCount) * 100,
        droppedPct: (droppedCount / sampleCount) * 100,
      };
      renderMetricsRef.current = next;
      // Only trigger React re-render when the network panel is visible
      if (networkPanelOpenRef.current) {
        setRenderMetrics(next);
      }
      lastPublished = nowTs;
    };

    const step = (timestampMs) => {
      if (lastTimestamp != null) {
        const frameDeltaMs = clamp(timestampMs - lastTimestamp, 0, 250);
        ewmaFrameMs += (frameDeltaMs - ewmaFrameMs) * 0.12;
        frameSamples.push(frameDeltaMs);
        if (frameSamples.length > FRAME_SAMPLE_WINDOW) {
          frameSamples.shift();
        }
        if (timestampMs - lastPublished >= FRAME_METRIC_PUSH_MS) {
          publishMetrics(timestampMs);
        }
      } else {
        lastPublished = timestampMs;
      }

      lastTimestamp = timestampMs;
      rafId = window.requestAnimationFrame(step);
    };

    rafId = window.requestAnimationFrame(step);
    return () => {
      if (rafId) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, []);

  const networkRows = useMemo(
    () => [
      { section: "Connection", label: "Status", value: connectionStatus || "connecting" },
      { label: "Ping", value: Number.isFinite(connectionPing) ? `${connectionPing} ms` : "--" },
      {
        label: "Ping p95/p99",
        value:
          Number.isFinite(connection?.pingP95Ms) && Number.isFinite(connection?.pingP99Ms)
            ? `${connection.pingP95Ms.toFixed(0)} / ${connection.pingP99Ms.toFixed(0)} ms`
            : "--",
      },
      {
        label: "Jitter",
        value: Number.isFinite(connection?.jitterMs) ? `${connection.jitterMs.toFixed(1)} ms` : "--",
      },
      {
        label: "Jitter p95/p99",
        value:
          Number.isFinite(connection?.jitterP95Ms) && Number.isFinite(connection?.jitterP99Ms)
            ? `${connection.jitterP95Ms.toFixed(1)} / ${connection.jitterP99Ms.toFixed(1)} ms`
            : "--",
      },
      {
        label: "Snapshot gaps",
        value: Number.isFinite(connection?.packetLossPct)
          ? `${connection.packetLossPct.toFixed(1)}%`
          : "--",
      },
      {
        label: "Snapshot gaps p95/p99",
        value:
          Number.isFinite(connection?.packetLossP95Pct) && Number.isFinite(connection?.packetLossP99Pct)
            ? `${connection.packetLossP95Pct.toFixed(1)} / ${connection.packetLossP99Pct.toFixed(1)}%`
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
        section: "Synchronization",
        label: "Prediction correction",
        value: Number.isFinite(connection?.prediction?.correctionDistance)
          ? `${connection.prediction.correctionDistance.toFixed(1)} px` : "--",
      },
      {
        label: "Pending inputs",
        value: Number.isFinite(connection?.prediction?.pendingCommands)
          ? String(connection.prediction.pendingCommands) : "--",
      },
      {
        label: "Remote display delay",
        value: Number.isFinite(connection?.interpolation?.effectiveDelayMs)
          ? `${connection.interpolation.effectiveDelayMs.toFixed(1)} ms` : "--",
      },
      {
        label: "Buffer underruns",
        value: Number.isFinite(connection?.interpolation?.underrunCount)
          ? String(connection.interpolation.underrunCount) : "--",
      },
      {
        label: "Out-of-order",
        value: Number.isFinite(connection?.outOfOrderCount) ? String(connection.outOfOrderCount) : "--",
      },
      {
        section: "Browser",
        label: "Render FPS",
        value: Number.isFinite(renderMetrics.fps) ? `${renderMetrics.fps.toFixed(1)} fps` : "--",
      },
      {
        label: "Frame Time",
        value: Number.isFinite(renderMetrics.frameMs) ? `${renderMetrics.frameMs.toFixed(1)} ms` : "--",
      },
      {
        label: "Frame p95",
        value: Number.isFinite(renderMetrics.frameP95Ms) ? `${renderMetrics.frameP95Ms.toFixed(1)} ms` : "--",
      },
      {
        label: "Jank >25ms",
        value: Number.isFinite(renderMetrics.jankPct) ? `${renderMetrics.jankPct.toFixed(1)}%` : "--",
      },
      {
        label: "Dropped >33ms",
        value: Number.isFinite(renderMetrics.droppedPct)
          ? `${renderMetrics.droppedPct.toFixed(1)}%`
          : "--",
      },
      {
        section: "Server",
        label: "Loop Lag",
        value: Number.isFinite(connection?.server?.eventLoopLagMs)
          ? `${connection.server.eventLoopLagMs.toFixed(2)} ms`
          : "--",
      },
      {
        label: "Server dropped steps",
        value: Number.isFinite(connection?.server?.droppedSteps)
          ? String(connection.server.droppedSteps)
          : "--",
      },
      {
        label: "Tick Drift",
        value: Number.isFinite(connection?.server?.tickDriftMs)
          ? `${connection.server.tickDriftMs.toFixed(2)} ms`
          : "--",
      },
      {
        label: "Room CPU",
        value: Number.isFinite(connection?.server?.roomCpuMs)
          ? `${connection.server.roomCpuMs.toFixed(2)} ms`
          : "--",
      },
      {
        label: "Room CPU p95/p99",
        value:
          Number.isFinite(connection?.server?.roomCpuP95Ms) &&
          Number.isFinite(connection?.server?.roomCpuP99Ms)
            ? `${connection.server.roomCpuP95Ms.toFixed(2)} / ${connection.server.roomCpuP99Ms.toFixed(2)} ms`
            : "--",
      },
    ],
    [
      connection?.prediction,
      connection?.interpolation,
      connection?.jitterMs,
      connection?.jitterP95Ms,
      connection?.jitterP99Ms,
      connection?.outOfOrderCount,
      connection?.packetLossPct,
      connection?.packetLossP95Pct,
      connection?.packetLossP99Pct,
      connection?.pingP95Ms,
      connection?.pingP99Ms,
      renderMetrics.droppedPct,
      renderMetrics.fps,
      renderMetrics.frameMs,
      renderMetrics.frameP95Ms,
      renderMetrics.jankPct,
      connection?.server?.eventLoopLagMs,
      connection?.server?.droppedSteps,
      connection?.server?.roomCpuMs,
      connection?.server?.roomCpuP95Ms,
      connection?.server?.roomCpuP99Ms,
      connection?.server?.tickDriftMs,
      connection?.serverTickRate,
      connection?.updateRateHz,
      connectionPing,
      connectionStatus,
    ],
  );

  return (
    <div id="game-view" className={styles.gameView}>
      <div className={styles.canvasFrame}>
        <div id="game-root" className={styles.gameRuntimeRoot}>
          <div
            id="dom-game-container"
            className={`${styles.gameDomContainer} ${showModuleDom ? styles.gameSurfaceVisible : styles.gameSurfaceHidden}`}
          />
          <canvas
            id="game-canvas"
            className={`${styles.gameCanvas} ${showModuleCanvas ? styles.gameSurfaceVisible : styles.gameSurfaceHidden}`}
          />
          <div
            id="unity-game-container"
            className={`${styles.unityGameContainer} ${showUnity ? styles.gameSurfaceVisible : styles.gameSurfaceHidden}`}
          >
            <canvas id="unity-game-canvas" className={styles.unityGameCanvas} />
          </div>
          <iframe
            id="game-iframe"
            title="Embedded game"
            className={`${styles.gameIframe} ${showIframe ? styles.gameSurfaceVisible : styles.gameSurfaceHidden}`}
            allow="autoplay; fullscreen; gamepad; clipboard-read; clipboard-write"
          />
        </div>
        {game?.touchControls && touchProfile && <TouchControlSurface
          game={game}
          profile={touchProfile}
          orientation={touchOrientation}
          enabled={touchControlsEnabled}
          disabled={Boolean(platformDialogOpen || gameLoadError)}
        />}
        <GameToolbar
          showNetworkUi={showNetworkUi}
          connection={connection}
          connectionIcons={icons?.connection}
          networkPanelOpen={networkPanelOpen}
          networkButtonRef={networkButtonRef}
          onToggleNetwork={() => setNetworkPanelOpen((prev) => !prev)}
          isFullscreen={isFullscreen}
          onToggleFullscreen={onToggleFullscreen}
          fullscreenIcon={fullscreenIcon}
          allowTouchCustomization={allowTouchCustomization}
          onEditControls={() => { setNetworkPanelOpen(false); onTouchEditorChange?.(true); }}
          disabled={Boolean(platformDialogOpen)}
          expandedPlayArea={expandedPlayArea}
          onHome={onRequestHome}
          onInvite={onOpenInvite}
        />
        {showNetworkUi && networkPanelOpen && (
          <NetworkPanel rows={networkRows} onClose={() => {
            setNetworkPanelOpen(false);
            networkButtonRef.current?.focus({ preventScroll: true });
          }} />
        )}
        {touchEditorOpen && allowTouchCustomization && <TouchLayoutEditor
          game={game}
          profile={touchProfile}
          orientation={touchOrientation}
          inGame
          onCancel={() => onTouchEditorChange?.(false)}
          onSave={(nextProfile, orientation) => { onSaveTouchProfile?.(nextProfile, orientation); onTouchEditorChange?.(false); }}
        />}
        {!touchEditorOpen && touchNotice && <div className={styles.touchProfileFeedback} role="status">{touchNotice}</div>}
        {endGameOpen && !exitConfirmOpen && (
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
        {roomLifecycle && !landscapePromptOpen && (!shareOpen || roomStartHasPriority) && !endGameOpen && !exitConfirmOpen && !touchEditorOpen && !gameLoadError && (
          <RoomStartOverlay room={roomLifecycle} gameName={game?.name} isCreatorEntry={roomCreatorEntry} onInvite={onOpenInvite} onLeave={roomLifecycle.phase === "error" ? onBackHome : onRequestHome} />
        )}
        {shareOpen && !landscapePromptOpen && !endGameOpen && !exitConfirmOpen && !roomStartHasPriority && (
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
        {landscapePromptOpen && !exitConfirmOpen && <GameOrientationPrompt
          gameName={game?.name}
          canLockOrientation={gameOrientation.canLockOrientation}
          requesting={gameOrientation.requesting}
          requestFailed={gameOrientation.requestFailed}
          onLandscapeFullscreen={gameOrientation.requestLandscapeFullscreen}
          onBack={onBackHome}
        />}
        {gameLoadError && <div className={styles.gameError} role="alert">
          <span className="material-symbols-outlined" aria-hidden="true">error_outline</span>
          <h2>Unable to start this game</h2>
          <p>{gameLoadError}</p>
          <button type="button" onClick={onBackHome}>Back to library</button>
        </div>}
      </div>
    </div>
  );
}
