import { getGameControls, getGameDomRefs } from "/platform/frontend-engine/gameDom.js";
import { getGameSocket } from "/platform/frontend-engine/gameSocket.js";
import { createGameRoomConnection } from "/platform/frontend-engine/gameRoomConnection.js";
import { updateConnectionState } from "/platform/frontend-engine/connectionBridge.js";
import {
  hideEndGameModal,
  registerRematchHandler,
  showEndGameModal,
  updateEndGameModal,
} from "/platform/frontend-engine/endGameBridge.js";
import { openShareModal } from "/platform/frontend-engine/shareModalBridge.js";
import {
  getRuntimePerformanceProfile,
  subscribeRuntimePerformanceProfile,
} from "/platform/frontend-engine/performanceSettings.js";
import { SOCKET_EVENT } from "/platform/shared/networkProtocol.js";
import { LUDO_ACTION, LUDO_GAME_ID, LUDO_PALETTE } from "./shared/config.js";
import { createLudoRound } from "./shared/rules.js";
import { createLudoClientState } from "./client/ludoClientState.js";
import { createLudoHud } from "./client/ludoHud.js";
import { createLudoRenderer } from "./rendering/ludoRenderer.js";

const DISPOSE_GAME_EVENT = "kaboom:dispose-game";
const OPPONENT_JOINED_EVENT = "kaboom:opponent-joined";
const HUD_REFRESH_MS = 100;
const INTERACTIVE_KEYBOARD_TARGETS = "button,a,summary,input,textarea,select,[contenteditable='true'],[role='dialog']";

/** @typedef {import("./shared/config.js").LudoPlayerId} LudoPlayerId */

initializeLudoGame();

/** Compose the game-owned board and controls with platform room/voice ownership. */
function initializeLudoGame() {
  const { canvas } = getGameDomRefs();
  const host = document.getElementById("game-root");
  if (!canvas || !host) throw new Error("Ludo requires the platform game canvas and host.");

  const originalCanvasAttributes = {
    style: canvas.getAttribute("style"),
    tabindex: canvas.getAttribute("tabindex"),
    "aria-label": canvas.getAttribute("aria-label"),
    width: canvas.getAttribute("width"),
    height: canvas.getAttribute("height"),
  };
  Object.assign(canvas.style, {
    width: "100%",
    height: "100%",
    maxWidth: "100%",
    maxHeight: "100%",
    display: "block",
    objectFit: "fill",
    imageRendering: "auto",
    touchAction: "none",
  });
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", "Ludo table. Roll the dice, then select a glowing piece.");

  const clientState = createLudoClientState();
  const initialBoard = createLudoRound();
  const { dpad, actions, menu } = getGameControls();
  const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reducedMotion = reducedMotionQuery.matches;
  let disposed = false;
  let animationFrameId = 0;
  let lastRenderedAtMs = null;
  let lastHudUpdateAtMs = -Infinity;
  let targetRenderFps = getRuntimePerformanceProfile().targetFps;
  let connectionStatus = "connecting";
  let roomErrorMessage = null;
  let retryRoomConnection = null;
  let shownResultRoundId = null;
  let rematchPending = false;
  let rematchStarting = false;
  let rematchFromRoundId = null;
  let needsPresentationBaselineReset = false;
  let opponentPresent = false;
  const cleanupHandlers = [];

  const hud = createLudoHud({
    host,
    onRoll: () => submitLudoAction(LUDO_ACTION.ROLL),
    onTokenPick: selectAndMoveLudoPiece,
    onInvite: inviteLudoOpponent,
    onRetry: () => {
      if (!retryRoomConnection || disposed) return;
      const retry = retryRoomConnection;
      roomErrorMessage = null;
      retryRoomConnection = null;
      refreshLudoHud();
      retry();
    },
  });
  const renderer = createLudoRenderer({
    canvas,
    onPiecePick: (playerId, tokenIndex) => {
      if (playerId === clientState.getView(performance.now()).playerId) selectAndMoveLudoPiece(tokenIndex);
    },
    onDicePick: () => submitLudoAction(LUDO_ACTION.ROLL),
  });
  const socket = getGameSocket(LUDO_GAME_ID);
  cleanupHandlers.push(socket.onConnectionChange((connectionSnapshot) => {
    connectionStatus = connectionSnapshot.status;
    updateConnectionState(connectionSnapshot);
    refreshLudoHud();
  }));

  const roomConnection = createGameRoomConnection({
    gameId: LUDO_GAME_ID,
    socket,
    onJoined({ playerId }) {
      clientState.recordJoined(/** @type {LudoPlayerId} */ (playerId));
      roomErrorMessage = null;
      retryRoomConnection = null;
      rematchStarting = false;
      rematchFromRoundId = null;
      needsPresentationBaselineReset = true;
      refreshLudoHud();
    },
    onError(message, retry) {
      clientState.recordDisconnected();
      roomErrorMessage = message;
      retryRoomConnection = retry;
      refreshLudoHud();
    },
    onRematchRequested(playerId) {
      const view = clientState.getView(performance.now());
      const playerState = view.snapshot?.players[playerId];
      const playerLabel = playerState ? LUDO_PALETTE[playerState.color].label : "Your opponent";
      updateEndGameModal({
        status: `${playerLabel} would like another round.`,
        actionLabel: "Play again",
        phase: rematchPending ? "waiting" : "ready",
      });
    },
  });
  cleanupHandlers.push(
    socket.onEvent(SOCKET_EVENT.DISCONNECT, () => {
      clientState.recordDisconnected();
      opponentPresent = false;
      rematchPending = false;
      shownResultRoundId = null;
      hideEndGameModal();
      clearLudoOpponentAnnouncement();
      refreshLudoHud();
    }),
    socket.onEvent(SOCKET_EVENT.PLAYER_LEFT, () => {
      opponentPresent = false;
      rematchPending = false;
      clientState.resetRoundReadiness();
      clearLudoOpponentAnnouncement();
      refreshLudoHud();
    }),
    socket.onEvent(SOCKET_EVENT.REMATCH_STARTED, () => {
      rematchFromRoundId = clientState.getView(performance.now()).snapshot?.roundId ?? null;
      clientState.resetRoundReadiness();
      shownResultRoundId = null;
      rematchPending = false;
      rematchStarting = true;
      hideEndGameModal();
      refreshLudoHud();
    }),
    socket.onEvent(SOCKET_EVENT.STATE, recordLudoSnapshot),
  );

  registerRematchHandler(() => {
    const view = clientState.getView(performance.now());
    if (disposed || rematchPending || !socket.isConnected() || !view.joined || !view.snapshot?.gameOver) return;
    rematchPending = true;
    updateEndGameModal({ status: "Waiting for the other player…", phase: "waiting", actionLabel: "Play again" });
    roomConnection.requestRematch();
  });
  hideEndGameModal();

  cleanupHandlers.push(
    actions.a.onPress(confirmLudoAction),
    dpad.left.onPress(() => cycleLudoSelection(-1)),
    dpad.right.onPress(() => cycleLudoSelection(1)),
    menu.start.onPress(inviteLudoOpponent),
  );
  window.addEventListener("keydown", pressLudoKeyboardControl);
  cleanupHandlers.push(() => window.removeEventListener("keydown", pressLudoKeyboardControl));

  const resizeObserver = new ResizeObserver(resizeLudoHost);
  resizeObserver.observe(host);
  resizeLudoHost();
  cleanupHandlers.push(subscribeRuntimePerformanceProfile((profile) => {
    targetRenderFps = profile.targetFps;
    lastRenderedAtMs = null;
    renderer.setQuality(profile);
  }));
  const updateReducedMotion = (mediaEvent) => { reducedMotion = mediaEvent.matches; };
  reducedMotionQuery.addEventListener("change", updateReducedMotion);
  cleanupHandlers.push(() => reducedMotionQuery.removeEventListener("change", updateReducedMotion));
  window.addEventListener(DISPOSE_GAME_EVENT, disposeRequestedLudoGame);
  refreshLudoHud();
  animationFrameId = requestAnimationFrame(renderLudoFrame);

  /**
   * Every action is checked locally and once more by the authoritative server.
   * @param {"roll"|"move"} type
   * @param {number} [tokenIndex]
   */
  function submitLudoAction(type, tokenIndex) {
    if (disposed || areLudoControlsBlocked() || !socket.isConnected() || roomErrorMessage) return;
    const command = clientState.beginCommand(type, tokenIndex, performance.now());
    if (!command) return;
    socket.send(SOCKET_EVENT.INPUT, command);
    refreshLudoHud();
  }

  /**
   * Clicking/tapping a legal piece is an explicit immediate move choice.
   * @param {number} tokenIndex
   */
  function selectAndMoveLudoPiece(tokenIndex) {
    if (areLudoControlsBlocked()) return;
    if (!clientState.selectToken(tokenIndex, performance.now())) return;
    submitLudoAction(LUDO_ACTION.MOVE, tokenIndex);
  }

  function confirmLudoAction() {
    if (areLudoControlsBlocked() || isLudoTextInputFocused()) return;
    const view = clientState.getView(performance.now());
    if (view.canRoll) submitLudoAction(LUDO_ACTION.ROLL);
    else if (view.canChoose) submitLudoAction(LUDO_ACTION.MOVE, view.selectedTokenIndex);
  }

  /** @param {-1|1} direction */
  function cycleLudoSelection(direction) {
    if (areLudoControlsBlocked() || isLudoTextInputFocused()) return;
    clientState.cycleSelection(direction, performance.now());
    refreshLudoHud();
  }

  /** One-shot keys create no held action state that can survive a pause/blur. */
  function pressLudoKeyboardControl(event) {
    if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey ||
        areLudoControlsBlocked() || event.target?.closest?.(INTERACTIVE_KEYBOARD_TARGETS)) return;
    if (event.code === "Space" || event.code === "Enter" || event.code === "KeyA") {
      event.preventDefault();
      confirmLudoAction();
    } else if (event.code === "ArrowLeft" || event.code === "ArrowRight") {
      event.preventDefault();
      cycleLudoSelection(event.code === "ArrowLeft" ? -1 : 1);
    } else if (/^[1-4]$/.test(event.key)) {
      event.preventDefault();
      clientState.selectToken(Number(event.key) - 1, performance.now());
      refreshLudoHud();
    }
  }

  function inviteLudoOpponent() {
    if (!disposed && !areLudoControlsBlocked() && roomConnection.getRoomId()) openShareModal();
  }

  /** Complete snapshots recover rejected/stale commands without an action log. */
  function recordLudoSnapshot(snapshot) {
    if (disposed || (rematchStarting && snapshot.roundId === rematchFromRoundId && snapshot.gameOver)) return;
    if (!clientState.recordSnapshot(snapshot, performance.now())) return;
    if (needsPresentationBaselineReset) {
      renderer.resetPresentation();
      needsPresentationBaselineReset = false;
    }
    const view = clientState.getView(performance.now());
    if (rematchStarting && snapshot.roundId !== rematchFromRoundId) rematchStarting = false;
    if (view.allPlayersConnected && !opponentPresent) {
      opponentPresent = true;
      const roomId = roomConnection.getRoomId();
      window.__kaboomOpponentJoined = { gameId: LUDO_GAME_ID, roomId };
      window.dispatchEvent(new CustomEvent(OPPONENT_JOINED_EVENT, { detail: { gameId: LUDO_GAME_ID, roomId } }));
    } else if (!view.allPlayersConnected && opponentPresent) {
      opponentPresent = false;
      clearLudoOpponentAnnouncement();
    }

    if (snapshot.gameOver && shownResultRoundId !== snapshot.roundId) {
      shownResultRoundId = snapshot.roundId;
      rematchPending = false;
      const winnerState = snapshot.players[snapshot.winner];
      const winnerLabel = winnerState ? LUDO_PALETTE[winnerState.color].label : "The winner";
      showEndGameModal({
        gameId: LUDO_GAME_ID,
        title: snapshot.winner === view.playerId ? "You win!" : `${winnerLabel} wins`,
        subtitle: "All four pieces made it home.",
        status: "Ready for another round?",
        actionLabel: "Play again",
        phase: "ready",
        winner: snapshot.winner,
      });
    } else if (!snapshot.gameOver && shownResultRoundId !== null && shownResultRoundId !== snapshot.roundId) {
      shownResultRoundId = null;
      rematchPending = false;
      hideEndGameModal();
    }
    refreshLudoHud();
  }

  function resizeLudoHost() {
    if (disposed) return;
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);
    const reservedRightPx = hud.resize(width, height);
    renderer.resize(width, height, reservedRightPx);
  }

  /** Render cadence changes visual motion only; every logical rule stays server-owned. */
  function renderLudoFrame(nowMs) {
    if (disposed) return;
    animationFrameId = requestAnimationFrame(renderLudoFrame);
    const frameIntervalMs = 1000 / targetRenderFps;
    const elapsedMs = lastRenderedAtMs === null ? frameIntervalMs : nowMs - lastRenderedAtMs;
    if (elapsedMs + 0.2 < frameIntervalMs) return;
    lastRenderedAtMs = nowMs - (elapsedMs % frameIntervalMs);

    const view = clientState.getView(nowMs);
    renderer.render({
      snapshot: view.snapshot ?? initialBoard,
      playerId: view.playerId,
      selectedTokenIndex: view.selectedTokenIndex,
      nowMs,
      serverNowMs: view.serverNowMs,
      reducedMotion,
      pendingRoll: view.pendingRoll,
    });
    if (nowMs - lastHudUpdateAtMs >= HUD_REFRESH_MS) refreshLudoHud(nowMs);
  }

  function refreshLudoHud(nowMs = performance.now()) {
    if (disposed) return;
    lastHudUpdateAtMs = nowMs;
    hud.update({
      ...clientState.getView(nowMs),
      connectionStatus,
      errorMessage: roomErrorMessage,
      retryAvailable: Boolean(retryRoomConnection),
      rematchStarting,
    });
  }

  function disposeRequestedLudoGame(event) {
    if (event?.detail?.gameId !== LUDO_GAME_ID || disposed) return;
    disposed = true;
    cancelAnimationFrame(animationFrameId);
    resizeObserver.disconnect();
    cleanupHandlers.forEach((cleanup) => cleanup());
    roomConnection.dispose();
    registerRematchHandler(null);
    hideEndGameModal();
    clearLudoOpponentAnnouncement();
    renderer.dispose();
    hud.dispose();
    for (const [attribute, value] of Object.entries(originalCanvasAttributes)) {
      if (value === null) canvas.removeAttribute(attribute);
      else canvas.setAttribute(attribute, value);
    }
    updateConnectionState({ status: "disconnected", ping: null });
    socket.destroy();
    window.removeEventListener(DISPOSE_GAME_EVENT, disposeRequestedLudoGame);
  }
}

/** Platform dialogs and hidden tabs own input before the game. */
function areLudoControlsBlocked() {
  return Boolean(document.hidden || document.querySelector('[aria-modal="true"],dialog[open]'));
}

function isLudoTextInputFocused() {
  return Boolean(document.activeElement?.closest?.("input,textarea,select,[contenteditable='true']"));
}

function clearLudoOpponentAnnouncement() {
  if (window.__kaboomOpponentJoined?.gameId === LUDO_GAME_ID) window.__kaboomOpponentJoined = null;
}
