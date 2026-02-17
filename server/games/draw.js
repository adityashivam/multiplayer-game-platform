import { drawGameMeta } from "./metadata.js";
import { emitEvent, registerGame } from "../utils/utils.js";

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;
const ROOM_CLEANUP_DELAY_MS = 30000;

const MAX_STROKES = 180;
const MAX_POINTS_PER_STROKE = 800;
const MAX_TOTAL_POINTS = 36000;

const DEFAULT_COLORS = {
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

function normalizeColor(color, playerId) {
  if (typeof color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(color.trim())) {
    return color.trim();
  }
  return DEFAULT_COLORS[playerId] || "#ffffff";
}

function findStrokeById(state, strokeId) {
  if (!strokeId) return null;
  for (let i = state.strokes.length - 1; i >= 0; i -= 1) {
    const stroke = state.strokes[i];
    if (stroke?.id === strokeId) return stroke;
  }
  return null;
}

function applyStrokeLimits(state) {
  while (state.strokes.length > MAX_STROKES || state.totalPoints > MAX_TOTAL_POINTS) {
    const removed = state.strokes.shift();
    if (removed?.points?.length) {
      state.totalPoints = Math.max(0, state.totalPoints - removed.points.length);
    }
  }
}

function createInitialGameState() {
  return {
    players: {
      p1: { connected: false, rejoinToken: null },
      p2: { connected: false, rejoinToken: null },
    },
    canvas: {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
    },
    strokes: [],
    totalPoints: 0,
    nextStrokeSeq: 1,
    activeStrokeIds: {
      p1: null,
      p2: null,
    },
    clearVersion: 0,
    abandonedAt: null,
    lastUpdate: Date.now(),
  };
}

function serializeStateForClients(state) {
  return {
    canvas: state.canvas,
    players: {
      p1: { connected: Boolean(state.players.p1.connected) },
      p2: { connected: Boolean(state.players.p2.connected) },
    },
    clearVersion: state.clearVersion,
    strokes: state.strokes.map((stroke) => ({
      id: stroke.id,
      owner: stroke.owner,
      color: stroke.color,
      size: stroke.size,
      completed: Boolean(stroke.completed),
      points: stroke.points,
    })),
  };
}

function createStrokeId(state, playerId, requestedId) {
  if (typeof requestedId === "string") {
    const trimmed = requestedId.trim().slice(0, 64);
    if (trimmed && !findStrokeById(state, trimmed)) {
      return trimmed;
    }
  }

  const generated = `${playerId}-s${state.nextStrokeSeq}`;
  state.nextStrokeSeq += 1;
  return generated;
}

function emitDrawEventToOpponent(socket, payload) {
  const gameId = socket?.data?.gameId;
  if (!gameId) return;
  emitEvent({
    socket,
    gameId,
    type: "drawEvent",
    payload,
    target: "others",
  });
}

function handleStrokeStart({ state, playerId, payload, socket }) {
  const point = normalizePoint(payload?.point || payload);
  if (!point) return;

  const strokeId = createStrokeId(state, playerId, payload?.strokeId);
  const stroke = {
    id: strokeId,
    owner: playerId,
    color: normalizeColor(payload?.color, playerId),
    size: normalizeSize(payload?.size),
    points: [point],
    completed: false,
  };

  state.strokes.push(stroke);
  state.totalPoints += 1;
  state.activeStrokeIds[playerId] = strokeId;
  applyStrokeLimits(state);

  emitDrawEventToOpponent(socket, {
    action: "start",
    strokeId,
    owner: playerId,
    color: stroke.color,
    size: stroke.size,
    point,
  });
}

function handleStrokeMove({ state, playerId, payload, socket }) {
  const point = normalizePoint(payload?.point || payload);
  if (!point) return;

  const strokeId =
    (typeof payload?.strokeId === "string" && payload.strokeId.trim()) ||
    state.activeStrokeIds[playerId];
  const stroke = findStrokeById(state, strokeId);
  if (!stroke || stroke.owner !== playerId || stroke.completed) return;

  if (stroke.points.length >= MAX_POINTS_PER_STROKE) {
    stroke.completed = true;
    state.activeStrokeIds[playerId] = null;
    return;
  }

  const previous = stroke.points[stroke.points.length - 1];
  if (previous) {
    const dx = Math.abs(previous.x - point.x);
    const dy = Math.abs(previous.y - point.y);
    if (dx < 0.0008 && dy < 0.0008) return;
  }

  stroke.points.push(point);
  state.totalPoints += 1;
  applyStrokeLimits(state);

  emitDrawEventToOpponent(socket, {
    action: "move",
    strokeId: stroke.id,
    owner: playerId,
    point,
  });
}

function handleStrokeEnd({ state, playerId, payload, socket }) {
  const strokeId =
    (typeof payload?.strokeId === "string" && payload.strokeId.trim()) ||
    state.activeStrokeIds[playerId];
  const stroke = findStrokeById(state, strokeId);
  if (stroke && stroke.owner === playerId) {
    stroke.completed = true;
  }
  state.activeStrokeIds[playerId] = null;

  emitDrawEventToOpponent(socket, {
    action: "end",
    strokeId: strokeId || null,
    owner: playerId,
  });
}

function handleClear({ state, playerId, socket }) {
  state.strokes = [];
  state.totalPoints = 0;
  state.activeStrokeIds = { p1: null, p2: null };
  state.clearVersion += 1;

  emitDrawEventToOpponent(socket, {
    action: "clear",
    owner: playerId,
    clearVersion: state.clearVersion,
  });
}

function handleInput({ state, playerId, payload, socket }) {
  if (!payload || typeof payload !== "object") return;

  const type = payload.type;
  switch (type) {
    case "strokeStart":
      handleStrokeStart({ state, playerId, payload, socket });
      break;
    case "strokeMove":
      handleStrokeMove({ state, playerId, payload, socket });
      break;
    case "strokeEnd":
      handleStrokeEnd({ state, playerId, payload, socket });
      break;
    case "clear":
      handleClear({ state, playerId, socket });
      break;
    default:
      break;
  }
}

export function registerDrawGame(io) {
  registerGame({
    io,
    meta: drawGameMeta,
    createState: createInitialGameState,
    onPlayerConnected: (state, playerId) => {
      state.players[playerId].connected = true;
      state.abandonedAt = null;
    },
    handleInput,
    handleDisconnect: (state, playerId) => {
      state.players[playerId].connected = false;
      state.activeStrokeIds[playerId] = null;
      const otherId = playerId === "p1" ? "p2" : "p1";
      const bothDisconnected = !state.players[otherId].connected;
      state.abandonedAt = bothDisconnected ? Date.now() : null;
    },
    beforeUpdate: (state) => {
      state.lastUpdate = Date.now();
    },
    shouldCleanup: (state, now) => {
      if (!state.abandonedAt) return false;
      return now - state.abandonedAt > ROOM_CLEANUP_DELAY_MS;
    },
    serializeState: serializeStateForClients,
    tickMs: 1000 / 60,
    dtFallback: 1 / 60,
  });
}
