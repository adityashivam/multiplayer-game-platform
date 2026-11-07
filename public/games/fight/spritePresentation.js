import { FIGHT_MOVE_CLIPS, FIGHT_MOVE_SHEETS } from "./spriteAtlasManifest.js";

/** @typedef {import("./shared/simulation.js").FightPlayerId} FightPlayerId */
/** @typedef {import("./presentation.js").FightAnimationClipId | "attack"} FightSpriteClipId */
/** @typedef {import("./spriteAtlasManifest.js").FightMoveClipId} FightMoveClipId */
/** @typedef {import("./spriteAtlasManifest.js").FightMoveClip} FightMoveClip */
const ORIGINAL_FIGHT_CELL_SIZE = 200;
const FIGHTER_WORLD_SCALE = 4;
// Preserve the actor origins when artwork changes; simulation owns these poses.
/** @type {Readonly<Record<FightPlayerId, number>>} */
const ORIGINAL_FIGHT_FEET_Y = Object.freeze({ p1: 122, p2: 128 });

/**
 * @typedef {object} FightSpriteGeometry
 * @property {number} cellSize
 * @property {number} feetY Source-pixel foot row for this clip.
 * @property {number} originalFeetY Visible foot row in the original 200px sheets.
 * @property {number} normalizedScale Body-size correction relative to the original art.
 * @property {ReadonlyArray<number>} [frameFeetY] Per-frame source-pixel foot rows.
 * @property {ReadonlyArray<number>} [frameOffsetsX] Signed source-pixel horizontal corrections.
 */

/**
 * Calculate child-sprite placement from measured artwork landmarks. Physics and
 * actor roots remain caller-owned; no artwork metadata is changed.
 * @param {FightSpriteGeometry} spriteGeometry
 * @param {number} localFrame
 * @returns {{scaleX: number, scaleY: number, offsetX: number, offsetY: number}}
 */
export function calculateFightSpritePlacement(spriteGeometry, localFrame) {
  const scale = FIGHTER_WORLD_SCALE * ORIGINAL_FIGHT_CELL_SIZE / spriteGeometry.cellSize * spriteGeometry.normalizedScale;
  const feetY = spriteGeometry.frameFeetY?.[localFrame] ?? spriteGeometry.feetY;
  const originalFeetOffset = (ORIGINAL_FIGHT_CELL_SIZE - spriteGeometry.originalFeetY) * FIGHTER_WORLD_SCALE;

  return {
    scaleX: scale,
    scaleY: scale,
    offsetX: (spriteGeometry.frameOffsetsX?.[localFrame] ?? 0) * scale,
    offsetY: (spriteGeometry.cellSize - feetY) * scale - originalFeetOffset,
  };
}

/** @param {number} localFrame @param {number} frameCount @returns {number} */
function clampFightSpriteFrame(localFrame, frameCount) {
  return Math.max(0, Math.min(frameCount - 1, Math.floor(localFrame)));
}

/**
 * Resolve presentation aliases within the same character art family. Unknown
 * clip names fall back to that fighter's idle instead of another asset style.
 * @param {FightPlayerId} playerId
 * @param {FightSpriteClipId} clipId
 * @returns {Readonly<FightMoveClip>}
 */
function readFightAuthoredMoveClip(playerId, clipId) {
  const authoredClipId = clipId === "landing" ? "jump" : clipId === "attack" ? "light" : clipId;
  const fighterClips = FIGHT_MOVE_CLIPS[playerId];
  return Object.hasOwn(fighterClips, authoredClipId)
    ? fighterClips[/** @type {FightMoveClipId} */ (authoredClipId)] : fighterClips.idle;
}

/**
 * Resolve the selected sequence into a real atlas cell. Frame indices remain
 * local to each clip until this boundary; a landing selects the jump's last
 * frame regardless of the caller's local index.
 * @param {FightPlayerId} playerId
 * @param {FightSpriteClipId} clipId
 * @param {number} localFrame
 * @returns {{spriteName: string, frame: number}}
 */
export function readFightSpriteFrame(playerId, clipId, localFrame) {
  const moveClip = readFightAuthoredMoveClip(playerId, clipId);
  const moveSheet = FIGHT_MOVE_SHEETS[playerId][moveClip.sheet];
  const frame = clipId === "landing" ? moveClip.frameCount - 1 : clampFightSpriteFrame(localFrame, moveClip.frameCount);
  return { spriteName: moveSheet.spriteName, frame: moveClip.startFrame + frame };
}

/**
 * Normalize new artwork on a child sprite while preserving the raw actor pose.
 * Per-clip scale and per-frame pivots pin the visible feet to the original
 * sheet's world row. Horizontal offsets are returned before facing is applied.
 * @param {FightPlayerId} playerId
 * @param {FightSpriteClipId} clipId
 * @param {number} [localFrame=0]
 * @returns {{scaleX: number, scaleY: number, offsetX: number, offsetY: number}}
 */
export function readFightSpritePlacement(playerId, clipId, localFrame = 0) {
  const moveClip = readFightAuthoredMoveClip(playerId, clipId);
  const moveSheet = FIGHT_MOVE_SHEETS[playerId][moveClip.sheet];
  const frame = clipId === "landing" ? moveClip.frameCount - 1 : clampFightSpriteFrame(localFrame, moveClip.frameCount);
  return calculateFightSpritePlacement({
    cellSize: moveSheet.cellSize,
    feetY: moveClip.feetY,
    originalFeetY: ORIGINAL_FIGHT_FEET_Y[playerId],
    normalizedScale: moveClip.normalizedScale,
    frameFeetY: moveClip.frameFeetY,
    frameOffsetsX: moveClip.frameOffsetsX,
  }, frame);
}
