import { getGameControls, getGameDomRefs } from "/platform/shared/gameDom.js";
import { getGameSocket } from "/platform/shared/gameSocket.js";
import { hideEndGameModal, registerRematchHandler } from "/platform/shared/endGameBridge.js";
import { openShareModal } from "/platform/shared/shareModalBridge.js";
import { updateConnectionState } from "/platform/shared/connectionBridge.js";

const GAME_SLUG = "draw";
const ROOM_READY_EVENT = "kaboom:room-ready";
const OPPONENT_JOIN_EVENT = "kaboom:opponent-joined";
const DISPOSE_GAME_EVENT = "kaboom:dispose-game";

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;
const MAX_RENDER_STROKES = 220;
const MAX_RENDER_POINTS_PER_STROKE = 900;
const POINT_EPSILON = 0.0008;
const ROOM_STATUS_TTL_MS = 2200;

const PLAYER_COLORS = {
  p1: "#38bdf8",
  p2: "#f97316",
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function quantize(value) {
  return Math.round(value * 10000) / 10000;
}

function normalizePoint(raw) {
  const x = Number(raw?.x);
  const y = Number(raw?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x: quantize(clamp(x, 0, 1)),
    y: quantize(clamp(y, 0, 1)),
  };
}

function normalizeSize(size) {
  const parsed = Number(size);
  if (!Number.isFinite(parsed)) return 4;
  return quantize(clamp(parsed, 1, 24));
}

function sanitizeStroke(rawStroke, fallbackOwner = "p1") {
  if (!rawStroke || typeof rawStroke !== "object") return null;

  const id = typeof rawStroke.id === "string" && rawStroke.id.trim()
    ? rawStroke.id.trim().slice(0, 64)
    : null;
  if (!id) return null;

  const owner = rawStroke.owner === "p2" ? "p2" : fallbackOwner;
  const color =
    typeof rawStroke.color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(rawStroke.color.trim())
      ? rawStroke.color.trim()
      : PLAYER_COLORS[owner] || "#ffffff";

  const points = [];
  const rawPoints = Array.isArray(rawStroke.points) ? rawStroke.points : [];
  for (let i = 0; i < rawPoints.length && points.length < MAX_RENDER_POINTS_PER_STROKE; i += 1) {
    const point = normalizePoint(rawPoints[i]);
    if (!point) continue;
    points.push(point);
  }

  if (points.length === 0) return null;

  return {
    id,
    owner,
    color,
    size: normalizeSize(rawStroke.size),
    completed: Boolean(rawStroke.completed),
    points,
  };
}

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

let roomUrl = "";
let gameId = null;
let hasJoined = false;
let myPlayerId = null;
let myRejoinToken = null;
let readyToPlay = false;
let disposed = false;
let animationFrameId = 0;
let opponentJoined = false;
let currentRoomId = null;
let hasHydratedState = false;
let clearVersion = 0;

let statusMessage = "Joining room...";
let statusUntilMs = Date.now() + 2500;

let activePointerId = null;
let activeStrokeId = null;

const strokes = [];
const strokeById = new Map();

function setStatus(message, ttlMs = ROOM_STATUS_TTL_MS) {
  statusMessage = message;
  statusUntilMs = Date.now() + ttlMs;
}

function getMyColor() {
  if (myPlayerId === "p2") return PLAYER_COLORS.p2;
  return PLAYER_COLORS.p1;
}

function rebuildStrokeIndex() {
  strokeById.clear();
  for (let i = 0; i < strokes.length; i += 1) {
    strokeById.set(strokes[i].id, strokes[i]);
  }
}

function trimRenderStrokes() {
  while (strokes.length > MAX_RENDER_STROKES) {
    const removed = strokes.shift();
    if (removed?.id) {
      strokeById.delete(removed.id);
    }
  }
}

function replaceStrokesFromServer(snapshotStrokes) {
  strokes.length = 0;
  strokeById.clear();

  const list = Array.isArray(snapshotStrokes) ? snapshotStrokes : [];
  for (let i = 0; i < list.length && strokes.length < MAX_RENDER_STROKES; i += 1) {
    const stroke = sanitizeStroke(list[i], "p1");
    if (!stroke) continue;
    strokes.push(stroke);
    strokeById.set(stroke.id, stroke);
  }

  hasHydratedState = true;
}

function createLocalStroke(strokeId, owner, color, size, firstPoint) {
  const stroke = {
    id: strokeId,
    owner,
    color,
    size: normalizeSize(size),
    completed: false,
    points: [firstPoint],
  };
  strokes.push(stroke);
  strokeById.set(strokeId, stroke);
  trimRenderStrokes();
  return stroke;
}

function appendPointToStroke(stroke, point) {
  if (!stroke || !point) return false;
  if (!Array.isArray(stroke.points) || stroke.points.length === 0) {
    stroke.points = [point];
    return true;
  }

  if (stroke.points.length >= MAX_RENDER_POINTS_PER_STROKE) {
    return false;
  }

  const previous = stroke.points[stroke.points.length - 1];
  if (Math.abs(previous.x - point.x) < POINT_EPSILON && Math.abs(previous.y - point.y) < POINT_EPSILON) {
    return false;
  }

  stroke.points.push(point);
  return true;
}

function clearLocalBoard(nextClearVersion = null) {
  strokes.length = 0;
  strokeById.clear();
  activeStrokeId = null;
  activePointerId = null;
  if (Number.isFinite(nextClearVersion)) {
    clearVersion = nextClearVersion;
  } else {
    clearVersion += 1;
  }
}

function applyDrawEvent(eventPayload) {
  if (!eventPayload || typeof eventPayload !== "object") return;

  const action = eventPayload.action;
  if (action === "clear") {
    const nextVersion = Number(eventPayload.clearVersion);
    clearLocalBoard(Number.isFinite(nextVersion) ? nextVersion : null);
    return;
  }

  const strokeId = typeof eventPayload.strokeId === "string" ? eventPayload.strokeId : null;
  const owner = eventPayload.owner === "p2" ? "p2" : "p1";

  if (action === "start") {
    const point = normalizePoint(eventPayload.point);
    if (!strokeId || !point) return;

    const existing = strokeById.get(strokeId);
    if (existing) {
      existing.owner = owner;
      existing.color =
        typeof eventPayload.color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(eventPayload.color.trim())
          ? eventPayload.color.trim()
          : PLAYER_COLORS[owner];
      existing.size = normalizeSize(eventPayload.size);
      existing.points = [point];
      existing.completed = false;
      return;
    }

    createLocalStroke(
      strokeId,
      owner,
      typeof eventPayload.color === "string" ? eventPayload.color : PLAYER_COLORS[owner],
      eventPayload.size,
      point,
    );
    return;
  }

  if (!strokeId) return;
  const stroke = strokeById.get(strokeId);
  if (!stroke) return;

  if (action === "move") {
    const point = normalizePoint(eventPayload.point);
    if (!point) return;
    appendPointToStroke(stroke, point);
    return;
  }

  if (action === "end") {
    stroke.completed = true;
  }
}

function buildRoomUrl(roomId) {
  return `${window.location.origin}/games/${GAME_SLUG}/${roomId}`;
}

function setRoomLink(url) {
  roomUrl = url;
}

function announceRoomReady(roomId) {
  if (!roomId) return;
  if (roomId !== currentRoomId) {
    currentRoomId = roomId;
    opponentJoined = false;
    window.__kaboomOpponentJoined = null;
  }
  window.dispatchEvent(
    new CustomEvent(ROOM_READY_EVENT, { detail: { gameId: GAME_SLUG, roomId } }),
  );
}

function announceOpponentJoined() {
  if (!gameId) return;
  window.__kaboomOpponentJoined = { gameId: GAME_SLUG, roomId: gameId };
  window.dispatchEvent(
    new CustomEvent(OPPONENT_JOIN_EVENT, { detail: { gameId: GAME_SLUG, roomId: gameId } }),
  );
}

function getRoomIdFromPath() {
  const match = window.location.pathname.match(new RegExp(`/games/${GAME_SLUG}/([a-z0-9]+)`, "i"));
  return match && match[1] ? match[1] : null;
}

async function ensureRoomId() {
  const existing = getRoomIdFromPath();
  if (existing) {
    setRoomLink(buildRoomUrl(existing));
    announceRoomReady(existing);
    return existing;
  }

  try {
    const response = await fetch(`/api/games/${GAME_SLUG}/new-room`);
    if (!response.ok) throw new Error("Failed to create room");
    const data = await response.json();
    const roomId = data?.roomId || Math.random().toString(36).slice(2, 8);
    const url = data?.url || buildRoomUrl(roomId);
    window.history.replaceState({}, "", `/games/${GAME_SLUG}/${roomId}`);
    setRoomLink(url);
    announceRoomReady(roomId);
    return roomId;
  } catch {
    const fallback = Math.random().toString(36).slice(2, 8);
    window.history.replaceState({}, "", `/games/${GAME_SLUG}/${fallback}`);
    setRoomLink(buildRoomUrl(fallback));
    announceRoomReady(fallback);
    return fallback;
  }
}

function tryJoinGame() {
  if (!socket.isConnected() || !gameId || hasJoined) return;

  let token = myRejoinToken;
  if (!token) {
    try {
      token = sessionStorage.getItem(`rejoinToken:${GAME_SLUG}:${gameId}`);
    } catch {
      // Ignore sessionStorage failures.
    }
  }

  socket.send("joinGame", { gameId, rejoinToken: token || undefined });
  hasJoined = true;
}

function sendInput(type, payload = {}) {
  if (!readyToPlay) return;
  socket.send("input", { type, ...payload });
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
  if (!readyToPlay || activePointerId != null) return;
  const point = toNormalizedCanvasPoint(event);
  if (!point) return;

  const strokeId = createStrokeId();
  const owner = myPlayerId === "p2" ? "p2" : "p1";
  const color = getMyColor();
  const size = 4;

  createLocalStroke(strokeId, owner, color, size, point);
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
  const stroke = activeStrokeId ? strokeById.get(activeStrokeId) : null;
  if (!stroke) return;

  const point = toNormalizedCanvasPoint(event);
  if (!point) return;

  const appended = appendPointToStroke(stroke, point);
  if (!appended) return;

  sendInput("strokeMove", {
    strokeId: stroke.id,
    point,
  });
}

function endDrawing(event) {
  if (activePointerId == null) return;
  if (event && event.pointerId !== activePointerId) return;

  const stroke = activeStrokeId ? strokeById.get(activeStrokeId) : null;
  if (stroke) {
    stroke.completed = true;
    sendInput("strokeEnd", { strokeId: stroke.id });
  }

  activePointerId = null;
  activeStrokeId = null;
}

function clearBoardAndBroadcast() {
  clearLocalBoard(null);
  sendInput("clear");
  setStatus("Board cleared", 1500);
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
  if (roomUrl) {
    openShareModal();
    return;
  }
  ensureRoomId().finally(() => openShareModal());
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

socket.onEvent("connect", () => {
  hasHydratedState = false;
  hasJoined = false;
  const pathRoomId = getRoomIdFromPath();
  if (pathRoomId && gameId && pathRoomId !== gameId) {
    gameId = null;
    myRejoinToken = null;
  }

  if (gameId) {
    tryJoinGame();
  } else {
    ensureRoomId().then((id) => {
      gameId = id;
      tryJoinGame();
    });
  }
});

socket.onEvent("roomFull", () => {
  setStatus("Room is full", 3500);
});

socket.onEvent("gameJoined", ({ playerId, gameId: joinedGameId, rejoinToken }) => {
  clearLocalBoard(0);
  hasHydratedState = false;
  myPlayerId = playerId;
  myRejoinToken = rejoinToken || null;
  readyToPlay = true;
  gameId = gameId || joinedGameId;

  if (rejoinToken && gameId) {
    try {
      sessionStorage.setItem(`rejoinToken:${GAME_SLUG}:${gameId}`, rejoinToken);
    } catch {
      // Ignore sessionStorage failures.
    }
  }

  setRoomLink(buildRoomUrl(gameId));
  announceRoomReady(gameId);
  setStatus(`Joined as ${playerId.toUpperCase()}`);
});

socket.onEvent("playerJoined", ({ playerId }) => {
  if (playerId !== myPlayerId) {
    setStatus("Rival joined");
    if (!opponentJoined) {
      opponentJoined = true;
      announceOpponentJoined();
    }
  }
});

socket.onEvent("playerLeft", ({ playerId }) => {
  if (playerId !== myPlayerId) {
    setStatus("Rival disconnected", 3200);
    opponentJoined = false;
    window.__kaboomOpponentJoined = null;
  }
});

socket.onEvent("drawEvent", (payload) => {
  applyDrawEvent(payload);
});

socket.onEvent("state", (state) => {
  if (!state || !state.players) return;

  const incomingClearVersion = Number(state.clearVersion);
  const clearChanged = Number.isFinite(incomingClearVersion) && incomingClearVersion !== clearVersion;

  if (!hasHydratedState || clearChanged) {
    replaceStrokesFromServer(state.strokes);
    if (Number.isFinite(incomingClearVersion)) {
      clearVersion = incomingClearVersion;
    }
  }

  if (!opponentJoined && state.players.p1?.connected && state.players.p2?.connected) {
    opponentJoined = true;
    announceOpponentJoined();
  }
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

  socket.offEvent("connect");
  socket.offEvent("roomFull");
  socket.offEvent("gameJoined");
  socket.offEvent("playerJoined");
  socket.offEvent("playerLeft");
  socket.offEvent("drawEvent");
  socket.offEvent("state");
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

ensureRoomId().then((id) => {
  gameId = id;
  tryJoinGame();
});

rebuildStrokeIndex();
renderFrame();
