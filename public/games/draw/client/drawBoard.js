import { DRAW_LIMITS, DRAW_POINT_EPSILON, normalizeDrawColor, normalizeDrawPoint, normalizeDrawSize } from "../shared/drawing.js";

/**
 * Own the render board, immediate local strokes and authoritative clear/version
 * recovery. Transport and room ownership remain in the platform SDK. Returned
 * strokes are borrowed for drawing; callers mutate them only through this API.
 * @returns {object} A bounded drawing model; reset requires a fresh board before drawing.
 */
export function createDrawBoard() {
  /** @type {import("../shared/drawing.js").DrawStroke[]} */
  const strokes = [];
  const strokeById = new Map();
  let clearVersion = 0;
  let revision = 0;
  let totalPoints = 0;
  let hydrated = false;
  let waitingForClear = false;
  let pendingClearOwner = null;

  function removeAllStrokes() {
    strokes.length = 0;
    strokeById.clear();
    totalPoints = 0;
  }

  function enforceDrawingLimits() {
    while (strokes.length > DRAW_LIMITS.strokes || totalPoints > DRAW_LIMITS.totalPoints) {
      const removedStroke = strokes.shift();
      strokeById.delete(removedStroke.id);
      totalPoints -= removedStroke.points.length;
    }
  }

  /** @param {Partial<import("../shared/drawing.js").DrawStroke>} candidate @returns {import("../shared/drawing.js").DrawStroke|null} */
  function startStroke(candidate) {
    const strokeId = typeof candidate?.id === "string" ? candidate.id.trim().slice(0, 64) : "";
    if (!strokeId) return null;
    if (strokeById.has(strokeId)) return strokeById.get(strokeId);
    const points = (Array.isArray(candidate.points) ? candidate.points : [])
      .slice(0, DRAW_LIMITS.pointsPerStroke).map(normalizeDrawPoint).filter(Boolean);
    if (!points.length) return null;
    const owner = candidate.owner === "p2" ? "p2" : "p1";
    const stroke = {
      id: strokeId, owner, color: normalizeDrawColor(candidate.color, owner),
      size: normalizeDrawSize(candidate.size), points, completed: Boolean(candidate.completed),
    };
    strokes.push(stroke);
    strokeById.set(strokeId, stroke);
    totalPoints += points.length;
    enforceDrawingLimits();
    return stroke;
  }

  /** @param {string} strokeId @param {import("../shared/drawing.js").DrawPoint} candidate @returns {boolean} Whether a new point was added. */
  function appendPoint(strokeId, candidate) {
    const stroke = strokeById.get(strokeId);
    const point = normalizeDrawPoint(candidate);
    if (!stroke || !point || stroke.completed || stroke.points.length >= DRAW_LIMITS.pointsPerStroke) return false;
    const previousPoint = stroke.points.at(-1);
    if (Math.abs(previousPoint.x - point.x) < DRAW_POINT_EPSILON && Math.abs(previousPoint.y - point.y) < DRAW_POINT_EPSILON) return false;
    stroke.points.push(point);
    totalPoints += 1;
    enforceDrawingLimits();
    return true;
  }

  /** @param {string} strokeId @returns {void} */
  function endStroke(strokeId) {
    const stroke = strokeById.get(strokeId);
    if (stroke) stroke.completed = true;
  }

  /** @param {{clearVersion:number,revision:number,strokes:object[]}} boardSnapshot @returns {boolean} Whether authority was applied. */
  function receiveBoard(boardSnapshot) {
    if (!Number.isSafeInteger(boardSnapshot?.revision) || !Number.isSafeInteger(boardSnapshot.clearVersion) ||
        (hydrated && (boardSnapshot.revision < revision || boardSnapshot.clearVersion < clearVersion))) return false;
    if (waitingForClear) return false;
    removeAllStrokes();
    for (const stroke of boardSnapshot.strokes || []) startStroke(stroke);
    clearVersion = boardSnapshot.clearVersion;
    revision = boardSnapshot.revision;
    hydrated = true;
    waitingForClear = false;
    return true;
  }

  /**
   * Apply ordered server events. Echoes acknowledge local presentation without
   * rewinding its newer points. Old events cannot repaint a cleared board.
   * @param {{action:"start"|"move"|"end"|"clear",revision:number,clearVersion:number,owner:"p1"|"p2",strokeId?:string,point?:object,color?:string,size?:number}} event
   * @param {"p1"|"p2"|null} localPlayerId
   * @returns {void}
   */
  function receiveEvent(event, localPlayerId) {
    if (!hydrated || !Number.isSafeInteger(event?.revision) || event.revision <= revision || event.clearVersion < clearVersion) return;
    revision = event.revision;
    if (event.clearVersion > clearVersion) {
      removeAllStrokes();
      clearVersion = event.clearVersion;
    }
    if (event.action === "clear" && event.owner === pendingClearOwner) {
      waitingForClear = false;
      pendingClearOwner = null;
    }
    if (waitingForClear) return;
    if (event.action === "clear") return;
    // Local presentation already applied every point, including strokes that
    // have since been evicted. An old echo must not resurrect those strokes.
    if (event.owner === localPlayerId) return;
    if (event.action === "start") {
      startStroke({ id: event.strokeId, owner: event.owner, color: event.color, size: event.size, points: [event.point] });
    } else if (event.action === "move") {
      appendPoint(event.strokeId, event.point);
    } else if (event.action === "end") {
      endStroke(event.strokeId);
    }
  }

  return {
    startStroke, appendPoint, endStroke, receiveBoard, receiveEvent,
    getStrokes: () => strokes,
    getStroke: (strokeId) => strokeById.get(strokeId),
    getRevision: () => revision,
    getClearVersion: () => clearVersion,
    isHydrated: () => hydrated,
    isWaitingForClear: () => waitingForClear,
    /** A room pause rejects in-flight actions; the subsequent recovery board wins. */
    cancelPendingClear() {
      waitingForClear = false;
      pendingClearOwner = null;
    },
    /** @param {"p1"|"p2"} localPlayerId */
    clearOptimistically(localPlayerId) {
      removeAllStrokes();
      waitingForClear = true;
      pendingClearOwner = localPlayerId;
    },
    reset() {
      removeAllStrokes();
      hydrated = false;
      waitingForClear = false;
      pendingClearOwner = null;
      revision = 0;
      clearVersion = 0;
    },
  };
}
