import { drawGameMeta } from "./metadata.js";
import { allPlayersConnected, emitEvent, registerGame, scheduleStart } from "../core/index.js";
import { DRAW_EVENT, DRAW_LIMITS, DRAW_SYNC_INPUT, normalizeDrawPoint, normalizeDrawSize, normalizeDrawColor } from "../../../public/games/draw/shared/drawing.js";

/**
 * @typedef {"p1"|"p2"} DrawPlayerId
 * @typedef {{x:number,y:number}} DrawPoint
 * @typedef {{id:string,owner:DrawPlayerId,color:string,size:number,points:DrawPoint[],completed:boolean}} DrawStroke
 * @typedef {object} DrawRoomState
 * @property {{p1:{connected:boolean,rejoinToken:string|null},p2:{connected:boolean,rejoinToken:string|null}}} players
 * @property {{width:number,height:number}} canvas
 * @property {DrawStroke[]} strokes
 * @property {number} totalPoints
 * @property {number} nextStrokeSeq
 * @property {{p1:string|null,p2:string|null}} activeStrokeIds
 * @property {number} revision
 * @property {number} clearVersion
 * @property {boolean} started
 * @property {number|null} startAt
 * @property {boolean} gameOver
 * @property {number|null} abandonedAt
 * @property {number} lastUpdate
 */

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 720;
const ROOM_CLEANUP_DELAY_MS = 30000;

const MAX_STROKES = DRAW_LIMITS.strokes;
const MAX_POINTS_PER_STROKE = DRAW_LIMITS.pointsPerStroke;
const MAX_TOTAL_POINTS = DRAW_LIMITS.totalPoints;
const normalizePoint = normalizeDrawPoint;
const normalizeSize = normalizeDrawSize;
const normalizeColor = normalizeDrawColor;

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

/** @returns {DrawRoomState} New room-owned drawing and lifecycle state. */
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
    revision: 0,
    started: false,
    startAt: null,
    gameOver: false,
    abandonedAt: null,
    lastUpdate: Date.now(),
  };
}

/** @param {DrawRoomState} state Compact lifecycle/revision state; history is recovered separately. */
function serializeStateForClients(state) {
  return {
    started: state.started,
    startAt: state.startAt,
    gameOver: state.gameOver,
    canvas: state.canvas,
    players: {
      p1: { connected: Boolean(state.players.p1.connected) },
      p2: { connected: Boolean(state.players.p2.connected) },
    },
    clearVersion: state.clearVersion,
    revision: state.revision,
  };
}

/**
 * Send bounded history only for initial/reconnect recovery. Frequent snapshots
 * carry lifecycle/revision metadata; incremental events carry live drawing.
 * @param {DrawRoomState} state
 * @param {import("socket.io").Socket} socket
 * @returns {void}
 */
function sendDrawBoard(state, socket) {
  socket.emit(DRAW_EVENT.BOARD, {
    clearVersion: state.clearVersion,
    revision: state.revision,
    strokes: state.strokes.map((stroke) => ({ ...stroke, points: stroke.points.map((point) => ({ ...point })) })),
  });
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

function emitDrawEvent(state, socket, payload) {
  const gameId = socket?.data?.gameId;
  if (!gameId) return;
  state.revision += 1;
  const drawingEvent = { ...payload, clearVersion: state.clearVersion, revision: state.revision };
  socket.emit(DRAW_EVENT.STROKE, drawingEvent);
  emitEvent({ socket, gameId, type: DRAW_EVENT.STROKE, payload: drawingEvent, target: "others" });
}

function handleStrokeStart({ state, playerId, payload, socket }) {
  const point = normalizePoint(payload?.point || payload);
  if (!point) return;

  // Ordered transport plus stable client IDs makes duplicate starts idempotent.
  if (typeof payload?.strokeId === "string" && findStrokeById(state, payload.strokeId.trim().slice(0, 64))) return;
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

  emitDrawEvent(state, socket, {
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

  emitDrawEvent(state, socket, {
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

  emitDrawEvent(state, socket, {
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

  emitDrawEvent(state, socket, {
    action: "clear",
    owner: playerId,
    clearVersion: state.clearVersion,
  });
}

function handleInput({ state, playerId, payload, socket }) {
  if (!payload || typeof payload !== "object") return;
  if (payload.type === DRAW_SYNC_INPUT) {
    sendDrawBoard(state, socket);
    return;
  }
  if (!state.started || state.gameOver || !allPlayersConnected(state)) return;

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

/**
 * Schedule the shared ready-room countdown and activate drawing only after its
 * authoritative deadline. Existing strokes and drawing limits remain untouched.
 * @param {DrawRoomState} state Mutated room-owned start state and update time.
 * @returns {void}
 */
function advanceDrawRoomStart(state) {
  scheduleStart(state);
  const nowMs = Date.now();
  if (!state.started && !state.gameOver && state.startAt !== null &&
      nowMs >= state.startAt && allPlayersConnected(state)) {
    state.started = true;
    state.startAt = null;
  }
  state.lastUpdate = nowMs;
}

export function registerDrawGame(io) {
  registerGame({
    io,
    meta: drawGameMeta,
    createState: createInitialGameState,
    onPlayerConnected: (state, playerId) => {
      state.players[playerId].connected = true;
      state.abandonedAt = null;
      scheduleStart(state);
    },
    handleInput,
    handleDisconnect: (state, playerId) => {
      state.players[playerId].connected = false;
      state.started = false;
      state.startAt = null;
      for (const ownerId of ["p1", "p2"]) {
        const activeStroke = findStrokeById(state, state.activeStrokeIds[ownerId]);
        if (activeStroke) activeStroke.completed = true;
        state.activeStrokeIds[ownerId] = null;
      }
      const otherId = playerId === "p1" ? "p2" : "p1";
      const bothDisconnected = !state.players[otherId].connected;
      state.abandonedAt = bothDisconnected ? Date.now() : null;
    },
    beforeUpdate: advanceDrawRoomStart,
    shouldCleanup: (state, now) => {
      if (!state.abandonedAt) return false;
      return now - state.abandonedAt > ROOM_CLEANUP_DELAY_MS;
    },
    serializeState: serializeStateForClients,
    tickMs: 1000 / 60,
    dtFallback: 1 / 60,
  });
}
