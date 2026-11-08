export const DRAW_LIMITS = Object.freeze({ strokes: 180, pointsPerStroke: 800, totalPoints: 36000 });
export const DRAW_POINT_EPSILON = 0.0008;
export const DRAW_PLAYER_COLORS = Object.freeze({ p1: "#38bdf8", p2: "#f97316" });
export const DRAW_EVENT = Object.freeze({ STROKE: "drawEvent", BOARD: "drawBoard" });
export const DRAW_SYNC_INPUT = "syncBoard";

/** @typedef {"p1"|"p2"} DrawPlayerId */
/** @typedef {{x:number,y:number}} DrawPoint */
/** @typedef {{id:string,owner:DrawPlayerId,color:string,size:number,points:DrawPoint[],completed:boolean}} DrawStroke */

/** @param {unknown} rawPoint @returns {DrawPoint|null} Bounded, quantized canvas coordinates. */
export function normalizeDrawPoint(rawPoint) {
  const x = Number(rawPoint?.x);
  const y = Number(rawPoint?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: quantizeDrawValue(Math.max(0, Math.min(1, x))), y: quantizeDrawValue(Math.max(0, Math.min(1, y))) };
}

/** @param {unknown} size @returns {number} Brush size in canvas pixels. */
export function normalizeDrawSize(size) {
  const parsedSize = Number(size);
  return Number.isFinite(parsedSize) ? quantizeDrawValue(Math.max(1, Math.min(24, parsedSize))) : 4;
}

/** @param {unknown} color @param {DrawPlayerId} owner @returns {string} Valid canvas color. */
export function normalizeDrawColor(color, owner) {
  return typeof color === "string" && /^#[0-9a-fA-F]{3,8}$/.test(color.trim())
    ? color.trim() : DRAW_PLAYER_COLORS[owner];
}

/** @param {number} value @returns {number} Four-decimal drawing precision. */
function quantizeDrawValue(value) {
  return Math.round(value * 10000) / 10000;
}
