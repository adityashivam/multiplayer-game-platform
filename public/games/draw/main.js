import { getGameControls, getGameDomRefs } from "/platform/frontend-engine/gameDom.js";
import { getGameSocket } from "/platform/frontend-engine/gameSocket.js";
import { hideEndGameModal, registerRematchHandler } from "/platform/frontend-engine/endGameBridge.js";
import { openShareModal } from "/platform/frontend-engine/shareModalBridge.js";
import { updateConnectionState } from "/platform/frontend-engine/connectionBridge.js";
import { createGameRoomConnection } from "/platform/frontend-engine/gameRoomConnection.js";
import { SOCKET_EVENT } from "/platform/shared/networkProtocol.js";
import { createDrawBoard } from "./client/drawBoard.js";
import { DRAW_EVENT, DRAW_SYNC_INPUT, DRAW_PLAYER_COLORS, normalizeDrawPoint, normalizeDrawSize } from "./shared/drawing.js";

const GAME_SLUG = "draw";
const OPPONENT_JOIN_EVENT = "kaboom:opponent-joined";
const DISPOSE_GAME_EVENT = "kaboom:dispose-game";

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;
const ROOM_STATUS_TTL_MS = 2200;
const PLAYER_COLORS = DRAW_PLAYER_COLORS;
const normalizePoint = normalizeDrawPoint;
const normalizeSize = normalizeDrawSize;

const { canvas } = getGameDomRefs();
const { menu, actions } = getGameControls();

if (!canvas) {
  throw new Error("Draw game requires #game-canvas in the platform view.");
}

const ctx = canvas.getContext("2d");
canvas.width = CANVAS_WIDTH;
canvas.height = CANVAS_HEIGHT;
canvas.style.width = "100%";
canvas.style.maxWidth = "100%";
canvas.style.display = "block";
canvas.style.objectFit = "contain";
canvas.style.objectPosition = "center";
canvas.style.height = "auto";
canvas.style.maxHeight = "100%";
canvas.style.touchAction = "none";

const socket = getGameSocket(GAME_SLUG);
let latestConnectionSnapshot = {
  status: socket.getConnectionState(),
  ping: socket.getPing(),
};
const unsubscribeConnection = socket.onConnectionChange((snapshot) => {
  latestConnectionSnapshot = { ...latestConnectionSnapshot, ...snapshot };
  updateConnectionState(snapshot);
});

let myPlayerId = null;
let readyToPlay = false;
let disposed = false;
let animationFrameId = 0;
let opponentJoined = false;
let latestSnapshot = null;
let syncRequested = false;
const board = createDrawBoard();
const strokes = board.getStrokes();

let statusMessage = "Joining room...";
let statusUntilMs = Date.now() + 2500;

let activePointerId = null;
let activeStrokeId = null;

function setStatus(message, ttlMs = ROOM_STATUS_TTL_MS) {
  statusMessage = message;
  statusUntilMs = Date.now() + ttlMs;
}

function getMyColor() {
  return PLAYER_COLORS[myPlayerId === "p2" ? "p2" : "p1"];
}

function cancelActiveStroke() {
  if (activeStrokeId) board.endStroke(activeStrokeId);
  activePointerId = null;
  activeStrokeId = null;
}

function refreshDrawingReadiness() {
  readyToPlay = Boolean(myPlayerId && socket.isConnected() && !syncRequested && board.isHydrated() && !board.isWaitingForClear() &&
    latestSnapshot?.started && !latestSnapshot.gameOver && latestSnapshot.players.p1?.connected && latestSnapshot.players.p2?.connected);
}

function requestBoardRecovery() {
  if (disposed || syncRequested || !myPlayerId || !socket.isConnected()) return;
  syncRequested = true;
  readyToPlay = false;
  socket.send(SOCKET_EVENT.INPUT, { type: DRAW_SYNC_INPUT });
}

function announceOpponentJoined() {
  const roomId = roomConnection.getRoomId();
  if (!roomId) return;
  window.__kaboomOpponentJoined = { gameId: GAME_SLUG, roomId };
  window.dispatchEvent(new CustomEvent(OPPONENT_JOIN_EVENT, { detail: { gameId: GAME_SLUG, roomId } }));
}

function sendInput(type, payload = {}) {
  if (readyToPlay && socket.isConnected()) socket.send(SOCKET_EVENT.INPUT, { type, ...payload });
}

function createStrokeId() {
  return `${myPlayerId || "p1"}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function toNormalizedCanvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  const x = (event.clientX - rect.left) / rect.width;
  const y = (event.clientY - rect.top) / rect.height;
  return normalizePoint({ x, y });
}

function beginDrawing(event) {
  if (!readyToPlay || activePointerId != null || document.hidden || document.querySelector('[aria-modal="true"], dialog[open]')) return;
  const point = toNormalizedCanvasPoint(event);
  if (!point) return;

  const strokeId = createStrokeId();
  const owner = myPlayerId === "p2" ? "p2" : "p1";
  const color = getMyColor();
  const size = 4;

  board.startStroke({ id: strokeId, owner, color, size, points: [point] });
  activePointerId = event.pointerId;
  activeStrokeId = strokeId;

  sendInput("strokeStart", {
    strokeId,
    owner,
    color,
    size,
    point,
  });

  setStatus("Drawing...", 1200);
}

function moveDrawing(event) {
  if (!readyToPlay || activePointerId == null || event.pointerId !== activePointerId) return;
  const stroke = activeStrokeId ? board.getStroke(activeStrokeId) : null;
  if (!stroke) return;

  const point = toNormalizedCanvasPoint(event);
  if (!point) return;

  const appended = board.appendPoint(stroke.id, point);
  if (!appended) return;

  sendInput("strokeMove", {
    strokeId: stroke.id,
    point,
  });
}

function endDrawing(event) {
  if (activePointerId == null) return;
  if (event && event.pointerId !== activePointerId) return;

  const stroke = activeStrokeId ? board.getStroke(activeStrokeId) : null;
  if (stroke) {
    board.endStroke(stroke.id);
    sendInput("strokeEnd", { strokeId: stroke.id });
  }

  activePointerId = null;
  activeStrokeId = null;
}

function clearBoardAndBroadcast() {
  if (!readyToPlay || document.hidden || document.querySelector('[aria-modal="true"], dialog[open]')) return;
  sendInput("clear");
  cancelActiveStroke();
  board.clearOptimistically(myPlayerId);
  refreshDrawingReadiness();
  setStatus("Clearing board...", 1500);
}

function handlePointerDown(event) {
  if (disposed) return;
  if (event.button !== undefined && event.button !== 0 && event.pointerType !== "touch") return;
  event.preventDefault();
  if (typeof canvas.setPointerCapture === "function") {
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Ignore capture failures.
    }
  }
  beginDrawing(event);
}

function handlePointerMove(event) {
  if (disposed) return;
  if (activePointerId == null) return;
  event.preventDefault();
  moveDrawing(event);
}

function handlePointerEnd(event) {
  if (disposed) return;
  if (activePointerId == null) return;
  event.preventDefault();
  endDrawing(event);
}

canvas.addEventListener("pointerdown", handlePointerDown);
canvas.addEventListener("pointermove", handlePointerMove);
canvas.addEventListener("pointerup", handlePointerEnd);
canvas.addEventListener("pointercancel", handlePointerEnd);
canvas.addEventListener("pointerleave", handlePointerEnd);

function drawBoardBackground() {
  const gradient = ctx.createLinearGradient(0, 0, 0, CANVAS_HEIGHT);
  gradient.addColorStop(0, "#0f172a");
  gradient.addColorStop(1, "#111827");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  ctx.strokeStyle = "rgba(148, 163, 184, 0.08)";
  ctx.lineWidth = 1;
  for (let x = 0; x <= CANVAS_WIDTH; x += 80) {
    ctx.beginPath();
    ctx.moveTo(x + 0.5, 0);
    ctx.lineTo(x + 0.5, CANVAS_HEIGHT);
    ctx.stroke();
  }
  for (let y = 0; y <= CANVAS_HEIGHT; y += 80) {
    ctx.beginPath();
    ctx.moveTo(0, y + 0.5);
    ctx.lineTo(CANVAS_WIDTH, y + 0.5);
    ctx.stroke();
  }
}

function drawStroke(stroke) {
  if (!stroke || !Array.isArray(stroke.points) || stroke.points.length === 0) return;

  ctx.strokeStyle = stroke.color || "#ffffff";
  ctx.lineWidth = normalizeSize(stroke.size);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  const first = stroke.points[0];
  const firstX = first.x * CANVAS_WIDTH;
  const firstY = first.y * CANVAS_HEIGHT;

  if (stroke.points.length === 1) {
    ctx.beginPath();
    ctx.arc(firstX, firstY, Math.max(1, ctx.lineWidth * 0.5), 0, Math.PI * 2);
    ctx.fillStyle = stroke.color || "#ffffff";
    ctx.fill();
    return;
  }

  ctx.beginPath();
  ctx.moveTo(firstX, firstY);
  for (let i = 1; i < stroke.points.length; i += 1) {
    const point = stroke.points[i];
    ctx.lineTo(point.x * CANVAS_WIDTH, point.y * CANVAS_HEIGHT);
  }
  ctx.stroke();
}

function drawHud() {
  const rivalId = myPlayerId === "p1" ? "p2" : "p1";
  const myLabel = myPlayerId ? myPlayerId.toUpperCase() : "--";

  ctx.fillStyle = "rgba(2, 6, 23, 0.8)";
  ctx.fillRect(16, 16, 430, 102);

  ctx.fillStyle = "#e2e8f0";
  ctx.font = "bold 22px monospace";
  ctx.fillText("LIVE DRAW DUEL", 30, 45);
  ctx.font = "bold 13px monospace";
  ctx.fillText(`YOU: ${myLabel}  |  RIVAL: ${rivalId.toUpperCase()}`, 30, 68);
  ctx.fillText("ENTER = SHARE  |  C or X = CLEAR", 30, 91);

  if (Date.now() < statusUntilMs && statusMessage) {
    const width = Math.min(620, 26 + ctx.measureText(statusMessage).width + 26);
    const x = CANVAS_WIDTH / 2 - width / 2;
    const y = CANVAS_HEIGHT - 74;
    ctx.fillStyle = "rgba(2, 6, 23, 0.8)";
    ctx.fillRect(x, y, width, 40);
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 18px monospace";
    ctx.fillText(statusMessage, x + 14, y + 26);
  }
}

function renderFrame() {
  if (disposed) return;

  drawBoardBackground();
  for (let i = 0; i < strokes.length; i += 1) {
    drawStroke(strokes[i]);
  }
  drawHud();

  animationFrameId = requestAnimationFrame(renderFrame);
}

function onStartAction() {
  if (roomConnection.getRoomId()) openShareModal();
}

function initControllerBindings() {
  const cleanups = [];
  cleanups.push(menu.start.onPress(() => onStartAction()));
  cleanups.push(actions.x.onPress(() => clearBoardAndBroadcast()));
  cleanups.push(actions.y.onPress(() => clearBoardAndBroadcast()));

  return () => {
    cleanups.forEach((cleanup) => {
      if (typeof cleanup === "function") cleanup();
    });
  };
}

function initKeyboardBindings() {
  const onKeyDown = (event) => {
    if (document.querySelector('[aria-modal="true"], dialog[open]')) return;
    const tag = event.target?.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;

    if (event.key === "Enter") {
      event.preventDefault();
      onStartAction();
      return;
    }

    if (event.key === "c" || event.key === "C") {
      event.preventDefault();
      clearBoardAndBroadcast();
    }
  };

  window.addEventListener("keydown", onKeyDown);
  return () => {
    window.removeEventListener("keydown", onKeyDown);
  };
}

registerRematchHandler(null);
hideEndGameModal();

const socketCleanups = [
  socket.onEvent(SOCKET_EVENT.DISCONNECT, () => {
    readyToPlay = false;
    syncRequested = false;
    latestSnapshot = null;
    cancelActiveStroke();
    board.reset();
    setStatus("Reconnecting...", 10000);
  }),
  socket.onEvent(SOCKET_EVENT.PLAYER_JOINED, ({ playerId }) => {
    if (playerId !== myPlayerId) setStatus("Rival joined");
  }),
  socket.onEvent(SOCKET_EVENT.PLAYER_LEFT, ({ playerId }) => {
    if (playerId === myPlayerId) return;
    readyToPlay = false;
    latestSnapshot = null;
    cancelActiveStroke();
    board.cancelPendingClear();
    requestBoardRecovery();
    setStatus("Rival disconnected", 3200);
    opponentJoined = false;
    window.__kaboomOpponentJoined = null;
  }),
  socket.onEvent(DRAW_EVENT.STROKE, (drawingEvent) => {
    const previousClearVersion = board.getClearVersion();
    board.receiveEvent(drawingEvent, myPlayerId);
    if (board.getClearVersion() !== previousClearVersion) cancelActiveStroke();
    refreshDrawingReadiness();
  }),
  socket.onEvent(DRAW_EVENT.BOARD, (boardSnapshot) => {
    syncRequested = false;
    if (!board.isHydrated()) cancelActiveStroke();
    board.receiveBoard(boardSnapshot);
    refreshDrawingReadiness();
  }),
  socket.onEvent(SOCKET_EVENT.STATE, (snapshot) => {
    if (!snapshot?.players) return;
    latestSnapshot = snapshot;
    if (!board.isHydrated() || snapshot.revision > board.getRevision()) requestBoardRecovery();
    refreshDrawingReadiness();
    if (!opponentJoined && snapshot.players.p1?.connected && snapshot.players.p2?.connected) {
      opponentJoined = true;
      announceOpponentJoined();
    }
  }),
];
const roomConnection = createGameRoomConnection({
  gameId: GAME_SLUG,
  socket,
  onJoined({ playerId }) {
    myPlayerId = playerId;
    latestSnapshot = null;
    readyToPlay = false;
    syncRequested = false;
    cancelActiveStroke();
    board.reset();
    requestBoardRecovery();
    setStatus(`Joined as ${playerId.toUpperCase()}`);
  },
  onError(message) {
    readyToPlay = false;
    cancelActiveStroke();
    setStatus(message, 15000);
  },
});

const cleanupControllerBindings = initControllerBindings();
const cleanupKeyboardBindings = initKeyboardBindings();

function disposeGameRuntime() {
  if (disposed) return;
  disposed = true;

  endDrawing({ pointerId: activePointerId });

  cleanupControllerBindings?.();
  cleanupKeyboardBindings?.();

  canvas.removeEventListener("pointerdown", handlePointerDown);
  canvas.removeEventListener("pointermove", handlePointerMove);
  canvas.removeEventListener("pointerup", handlePointerEnd);
  canvas.removeEventListener("pointercancel", handlePointerEnd);
  canvas.removeEventListener("pointerleave", handlePointerEnd);

  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = 0;
  }

  registerRematchHandler(null);
  hideEndGameModal();
  window.__kaboomOpponentJoined = null;

  unsubscribeConnection?.();
  updateConnectionState({ status: "disconnected", ping: null });

  roomConnection.dispose();
  socketCleanups.forEach((unsubscribe) => unsubscribe());
  socket.destroy?.();

  window.removeEventListener(DISPOSE_GAME_EVENT, handleDisposeEvent);
}

function handleDisposeEvent(event) {
  const targetGameId = event?.detail?.gameId;
  if (!targetGameId || targetGameId === GAME_SLUG) {
    disposeGameRuntime();
  }
}

window.addEventListener(DISPOSE_GAME_EVENT, handleDisposeEvent);

renderFrame();
