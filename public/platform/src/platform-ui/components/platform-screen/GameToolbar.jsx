import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import ConnectionIndicator from "./ConnectionIndicator.jsx";
import Presence from "./Presence.jsx";
import VoiceChatControls, { isVoiceChatJoined } from "./VoiceChatControls.jsx";
import {
  GAME_MENU_CORNER_INSET_PX,
  readGameMenuPosition,
  resolveGameMenuCornerInsets,
  saveGameMenuPosition,
  snapGameMenuPosition,
} from "../../services/gameMenuPosition.js";
import styles from "./GameChrome.module.scss";

/**
 * @typedef {object} GameToolbarProps
 * @property {boolean} showNetworkUi
 * @property {string} [gameId] Keys the remembered menu position per game.
 * @property {{status?:string,ping?:number}} [connection]
 * @property {boolean} networkPanelOpen
 * @property {React.RefObject<HTMLButtonElement|null>} networkButtonRef
 * @property {() => void} onToggleNetwork
 * @property {boolean} isFullscreen
 * @property {() => void} onToggleFullscreen
 * @property {string} fullscreenIcon
 * @property {{connected?:string,connecting?:string,reconnecting?:string,disconnected?:string}} [connectionIcons]
 * @property {boolean} [allowTouchCustomization]
 * @property {() => void} [onEditControls]
 * @property {boolean} [disabled]
 * @property {boolean} [expandedPlayArea]
 * @property {() => void} [onHome]
 * @property {() => void} [onInvite]
 * @property {import("../../../../shared/voiceProtocol.js").VoiceChatState} voiceState
 * @property {boolean} voiceAvailable
 * @property {boolean} voiceDialogOpen
 * @property {string} voiceUnavailableReason
 * @property {() => void} onOpenVoice
 * @property {() => Promise<void>} onJoinVoice
 * @property {(muted:boolean) => Promise<void>} onMicrophoneMutedChange
 * @property {(deafened:boolean) => void} onDeafenedChange
 * @property {() => Promise<void>} onResumeVoicePlayback
 */

const DRAG_THRESHOLD_PX = 6;
const IDLE_COLLAPSE_MS = 6000;
const CONNECTION_DOT_CLASSES = Object.freeze({
  connected: styles.menuDotConnected,
  connecting: styles.menuDotReconnecting,
  reconnecting: styles.menuDotReconnecting,
  disconnected: styles.menuDotDisconnected,
});

/**
 * Platform controls as one small floating button over the play surface.
 * Tapping it opens a frosted pill of actions; dragging moves it, snapping to
 * the nearest side, and the spot is remembered per game on this device. The
 * corner it occupies is published as `--platform-menu-inset-left/right` on
 * the play surface so game HUDs can step aside.
 * @param {GameToolbarProps} props
 * @returns {React.ReactElement}
 */
export default function GameToolbar({
  showNetworkUi, gameId, connection, networkPanelOpen, networkButtonRef, onToggleNetwork,
  isFullscreen, onToggleFullscreen, fullscreenIcon, connectionIcons,
  allowTouchCustomization = false, onEditControls, disabled = false,
  expandedPlayArea = false, onHome, onInvite,
  voiceState, voiceAvailable, voiceDialogOpen, voiceUnavailableReason, onOpenVoice,
  onJoinVoice, onMicrophoneMutedChange, onDeafenedChange, onResumeVoicePlayback,
}) {
  const menuRef = useRef(/** @type {HTMLDivElement|null} */ (null));
  const launcherRef = useRef(/** @type {HTMLButtonElement|null} */ (null));
  const dragRef = useRef(/** @type {{pointerId:number,startX:number,startY:number,offsetX:number,offsetY:number,moved:boolean}|null} */ (null));
  const [expanded, setExpanded] = useState(false);
  const [position, setPosition] = useState(() => readGameMenuPosition(gameId));
  const [dragPoint, setDragPoint] = useState(/** @type {{x:number,y:number}|null} */ (null));
  const [idleSerial, setIdleSerial] = useState(0);

  useEffect(() => setPosition(readGameMenuPosition(gameId)), [gameId]);
  useEffect(() => { if (disabled) setExpanded(false); }, [disabled]);

  // Publish which top corner the button covers so game HUDs can step aside.
  useLayoutEffect(() => {
    const surface = menuRef.current?.parentElement;
    if (!surface) return undefined;
    const publishCornerInsets = () => {
      const insets = resolveGameMenuCornerInsets(position, surface.clientHeight);
      surface.style.setProperty("--platform-menu-inset-left", `${insets.left}px`);
      surface.style.setProperty("--platform-menu-inset-right", `${insets.right}px`);
    };
    publishCornerInsets();
    const resizeObserver = new ResizeObserver(publishCornerInsets);
    resizeObserver.observe(surface);
    return () => {
      resizeObserver.disconnect();
      surface.style.removeProperty("--platform-menu-inset-left");
      surface.style.removeProperty("--platform-menu-inset-right");
    };
  }, [position]);

  // Close on Escape, on a press outside, and after a few idle seconds.
  useEffect(() => {
    if (!expanded) return undefined;
    const closeOnOutsidePress = (event) => {
      if (!menuRef.current?.contains(event.target)) setExpanded(false);
    };
    const closeOnEscape = (event) => {
      if (event.key !== "Escape") return;
      setExpanded(false);
      launcherRef.current?.focus({ preventScroll: true });
    };
    const idleTimer = window.setTimeout(() => setExpanded(false), IDLE_COLLAPSE_MS);
    document.addEventListener("pointerdown", closeOnOutsidePress, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.clearTimeout(idleTimer);
      document.removeEventListener("pointerdown", closeOnOutsidePress, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [expanded, idleSerial]);

  /** Run a menu action and fold the menu away. @param {(() => void)|undefined} action */
  const runMenuAction = (action) => () => {
    setExpanded(false);
    action?.();
  };

  /** @param {React.PointerEvent<HTMLButtonElement>} event */
  function startLauncherPress(event) {
    if (event.button !== 0 || disabled) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      offsetX: event.clientX - bounds.left,
      offsetY: event.clientY - bounds.top,
      moved: false,
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  /** @param {React.PointerEvent<HTMLButtonElement>} event */
  function moveLauncher(event) {
    const drag = dragRef.current;
    const surface = menuRef.current?.parentElement;
    if (!drag || drag.pointerId !== event.pointerId || !surface) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_THRESHOLD_PX) return;
    drag.moved = true;
    setExpanded(false);
    const surfaceBounds = surface.getBoundingClientRect();
    setDragPoint({ x: event.clientX - surfaceBounds.left - drag.offsetX, y: event.clientY - surfaceBounds.top - drag.offsetY });
  }

  /** @param {React.PointerEvent<HTMLButtonElement>} event */
  function finishLauncherPress(event) {
    const drag = dragRef.current;
    const surface = menuRef.current?.parentElement;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    if (!drag.moved || !surface) {
      setExpanded((open) => !open);
      return;
    }
    const surfaceBounds = surface.getBoundingClientRect();
    const launcherSize = event.currentTarget.offsetWidth;
    const nextPosition = snapGameMenuPosition({
      x: event.clientX - surfaceBounds.left - drag.offsetX,
      y: event.clientY - surfaceBounds.top - drag.offsetY,
      width: surfaceBounds.width,
      height: surfaceBounds.height,
      size: launcherSize,
    });
    setDragPoint(null);
    setPosition(nextPosition);
    saveGameMenuPosition(gameId, nextPosition);
  }

  function cancelLauncherPress() {
    dragRef.current = null;
    setDragPoint(null);
  }

  /** Keyboard: Enter/Space toggle (pointer handlers own mouse and touch). @param {React.MouseEvent} event */
  function toggleFromKeyboard(event) {
    if (event.detail === 0) setExpanded((open) => !open);
  }

  const status = connection?.status || "connecting";
  const voiceJoined = isVoiceChatJoined(voiceState);
  const placement = dragPoint
    ? { left: `${dragPoint.x}px`, top: `${dragPoint.y}px` }
    : {
      [position.side]: `${GAME_MENU_CORNER_INSET_PX.edge}px`,
      top: `clamp(${GAME_MENU_CORNER_INSET_PX.edge}px, calc(${position.y} * 100%), calc(100% - ${GAME_MENU_CORNER_INSET_PX.edge + 40}px))`,
    };

  return (
    <div
      ref={menuRef}
      className={styles.toolbar}
      style={placement}
      role="group"
      aria-label="Game session controls"
      data-platform-game-menu
      data-side={position.side}
      data-expanded={expanded}
      data-dragging={Boolean(dragPoint)}
      onPointerMove={expanded ? () => setIdleSerial((serial) => serial + 1) : undefined}
    >
      <button
        ref={launcherRef}
        type="button"
        className={styles.menuLauncher}
        aria-label={expanded ? "Close game menu" : "Game menu"}
        aria-expanded={expanded}
        aria-controls="platform-game-menu-actions"
        title="Game menu · drag to move"
        disabled={disabled}
        data-platform-game-menu-toggle
        onPointerDown={startLauncherPress}
        onPointerMove={moveLauncher}
        onPointerUp={finishLauncherPress}
        onPointerCancel={cancelLauncherPress}
        onClick={toggleFromKeyboard}
      >
        <span className="material-symbols-outlined" aria-hidden="true">{expanded ? "close" : "sports_esports"}</span>
        {showNetworkUi && <span className={`${styles.menuDot} ${CONNECTION_DOT_CLASSES[status] || styles.menuDotReconnecting}`} aria-hidden="true" />}
      </button>

      <Presence when={!expanded && voiceJoined}>
      <button
        type="button"
        className={styles.menuBadge}
        aria-label={voiceState.microphoneMuted ? "Unmute microphone" : "Mute microphone"}
        aria-pressed={!voiceState.microphoneMuted}
        title={voiceState.microphoneMuted ? "Unmute microphone" : "Mute microphone"}
        disabled={disabled}
        onClick={() => { void onMicrophoneMutedChange(!voiceState.microphoneMuted); }}
      >
        <span className="material-symbols-outlined" aria-hidden="true">{voiceState.microphoneMuted ? "mic_off" : "mic"}</span>
      </button>
      </Presence>

      <Presence when={expanded}>
      <div id="platform-game-menu-actions" className={styles.menuPill} onFocus={() => setIdleSerial((serial) => serial + 1)}>
        {expandedPlayArea && <button type="button" className={styles.toolbarButton} onClick={runMenuAction(onHome)} aria-label="Leave game" title="Return to library" disabled={disabled}>
          <span className="material-symbols-outlined" aria-hidden="true">arrow_back</span>
        </button>}
        {showNetworkUi && <ConnectionIndicator status={connection?.status} ping={connection?.ping} icons={connectionIcons} />}
        {expandedPlayArea && onInvite && <button type="button" className={styles.toolbarButton} onClick={runMenuAction(onInvite)} aria-label="Invite players" title="Invite players" disabled={disabled}>
          <span className="material-symbols-outlined" aria-hidden="true">person_add</span>
        </button>}
        {allowTouchCustomization && <button type="button" className={styles.toolbarButton} onClick={runMenuAction(onEditControls)} aria-label="Customize touch controls" title="Customize touch controls" disabled={disabled}>
          <span className="material-symbols-outlined" aria-hidden="true">tune</span>
        </button>}
        {showNetworkUi && <VoiceChatControls
          state={voiceState}
          available={voiceAvailable}
          dialogOpen={voiceDialogOpen}
          unavailableReason={voiceUnavailableReason}
          onOpen={runMenuAction(onOpenVoice)}
          onJoin={onJoinVoice}
          onMicrophoneMutedChange={onMicrophoneMutedChange}
          onDeafenedChange={onDeafenedChange}
          onResumePlayback={onResumeVoicePlayback}
          disabled={disabled}
        />}
        {showNetworkUi && (
          <button
            type="button"
            className={styles.toolbarButton}
            onClick={runMenuAction(onToggleNetwork)}
            aria-label="Network diagnostics"
            aria-expanded={networkPanelOpen}
            aria-controls="network-diagnostics"
            title="Network diagnostics (N)"
            ref={networkButtonRef}
            disabled={disabled}
          >
            <span className="material-symbols-outlined" aria-hidden="true">monitoring</span>
          </button>
        )}
        <button
          type="button"
          className={styles.toolbarButton}
          onClick={runMenuAction(onToggleFullscreen)}
          aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          aria-pressed={isFullscreen}
          title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          disabled={disabled}
        >
          <span className="material-symbols-outlined" aria-hidden="true">{fullscreenIcon}</span>
        </button>
      </div>
      </Presence>
    </div>
  );
}
