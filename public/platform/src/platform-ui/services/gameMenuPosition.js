/**
 * Where the floating game menu sits, remembered per game on this device.
 * Positions are a side plus a 0–1 height fraction so they survive rotation
 * and resizing. Storage is a per-viewer convenience: every failure falls back
 * to the default top-left spot.
 */

/** @typedef {{side:"left"|"right",y:number}} GameMenuPosition */

const STORAGE_PREFIX = "platform.game-menu-position.v1:";
const MENU_BUTTON_PX = 40;
/** `edge`: gap from the play surface; `reserve`: corner width game HUDs avoid. */
export const GAME_MENU_CORNER_INSET_PX = Object.freeze({ edge: 10, reserve: 58 });
/** @type {Readonly<GameMenuPosition>} */
const DEFAULT_GAME_MENU_POSITION = Object.freeze({ side: "left", y: 0 });

/** @param {unknown} candidate @returns {GameMenuPosition|null} */
function parseGameMenuPosition(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  const { side, y } = /** @type {Record<string,unknown>} */ (candidate);
  if ((side !== "left" && side !== "right") || typeof y !== "number" || !Number.isFinite(y) || y < 0 || y > 1) return null;
  return { side, y };
}

/**
 * @param {string|undefined} gameId
 * @param {Pick<Storage,"getItem">|undefined} [storage=globalThis.localStorage]
 * @returns {GameMenuPosition}
 */
export function readGameMenuPosition(gameId, storage = globalThis.localStorage) {
  try {
    const stored = storage?.getItem(STORAGE_PREFIX + (gameId || "default"));
    const position = stored ? parseGameMenuPosition(JSON.parse(stored)) : null;
    return position ?? { ...DEFAULT_GAME_MENU_POSITION };
  } catch {
    return { ...DEFAULT_GAME_MENU_POSITION };
  }
}

/**
 * @param {string|undefined} gameId
 * @param {GameMenuPosition} position
 * @param {Pick<Storage,"setItem">|undefined} [storage=globalThis.localStorage]
 */
export function saveGameMenuPosition(gameId, position, storage = globalThis.localStorage) {
  try {
    storage?.setItem(STORAGE_PREFIX + (gameId || "default"), JSON.stringify(position));
  } catch {
    // Private windows and blocked storage simply forget the spot.
  }
}

/**
 * Snap a dropped menu to the nearer side, keeping its height.
 * @param {{x:number,y:number,width:number,height:number,size:number}} drop Top-left of the button in surface pixels.
 * @returns {GameMenuPosition}
 */
export function snapGameMenuPosition({ x, y, width, height, size }) {
  const side = x + size / 2 < width / 2 ? "left" : "right";
  const fraction = height > 0 ? Math.max(0, Math.min(1, y / height)) : 0;
  return { side, y: Math.round(fraction * 1000) / 1000 };
}

/**
 * Corner widths game HUDs should keep clear: only the top corner the menu
 * actually sits in.
 * @param {GameMenuPosition} position
 * @param {number} surfaceHeight
 * @returns {{left:number,right:number}}
 */
export function resolveGameMenuCornerInsets(position, surfaceHeight) {
  const topPx = Math.max(GAME_MENU_CORNER_INSET_PX.edge, position.y * Math.max(0, surfaceHeight));
  const inTopCorner = topPx < GAME_MENU_CORNER_INSET_PX.edge + MENU_BUTTON_PX;
  return {
    left: inTopCorner && position.side === "left" ? GAME_MENU_CORNER_INSET_PX.reserve : 0,
    right: inTopCorner && position.side === "right" ? GAME_MENU_CORNER_INSET_PX.reserve : 0,
  };
}
