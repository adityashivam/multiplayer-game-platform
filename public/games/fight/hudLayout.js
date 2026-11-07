/** @typedef {{x: number, y: number, width: number, height: number}} FightHudRectangle */
/**
 * CSS pixel geometry supplied by the existing game host and rendered canvas.
 * @typedef {object} FightHudViewport
 * @property {number} hostWidth
 * @property {number} hostHeight
 * @property {number} stageLeft
 * @property {number} stageTop
 * @property {number} stageWidth
 * @property {number} stageHeight
 * @property {number} toolbarBottom
 */

const COMPACT_HUD_HEIGHT = 48;
const COMPACT_LEGEND_HEIGHT = 52;
const HUD_HOST_MARGIN = 8;
const HUD_STAGE_GAP = 6;
const MIN_SIDE_HUD_WIDTH = 240;

/**
 * Place readable mobile HUD in spare host space, without resizing the stage.
 * Prefer vertical letterboxes; wide, short hosts may use their side letterboxes.
 * Rectangles use CSS pixels, so typography remains independent of game scale.
 * The supplied geometry is read only.
 * @param {FightHudViewport} viewport
 * @returns {{hud: FightHudRectangle, legend: FightHudRectangle}}
 */
export function readFightCompactHudLayout(viewport) {
  const { hostWidth, hostHeight, stageLeft, stageTop, stageWidth, stageHeight, toolbarBottom } = viewport;
  const latestHudTop = Math.max(0, hostHeight - COMPACT_HUD_HEIGHT - HUD_HOST_MARGIN);
  const safeTop = Math.min(latestHudTop, Math.max(HUD_HOST_MARGIN, toolbarBottom + HUD_HOST_MARGIN));
  const leftSpace = stageLeft - HUD_HOST_MARGIN * 2;
  const rightSpace = hostWidth - stageLeft - stageWidth - HUD_HOST_MARGIN * 2;
  const hasSideLetterboxes = leftSpace >= MIN_SIDE_HUD_WIDTH && rightSpace >= MIN_SIDE_HUD_WIDTH;

  if (hasSideLetterboxes && stageTop < safeTop + COMPACT_HUD_HEIGHT + HUD_STAGE_GAP) {
    return {
      hud: { x: HUD_HOST_MARGIN, y: safeTop, width: leftSpace, height: COMPACT_HUD_HEIGHT },
      legend: {
        x: stageLeft + stageWidth + HUD_HOST_MARGIN,
        y: Math.min(safeTop, Math.max(0, hostHeight - COMPACT_LEGEND_HEIGHT - HUD_HOST_MARGIN)),
        width: rightSpace,
        height: COMPACT_LEGEND_HEIGHT,
      },
    };
  }

  const width = Math.max(0, hostWidth - HUD_HOST_MARGIN * 2);
  return {
    hud: {
      x: HUD_HOST_MARGIN,
      y: Math.min(latestHudTop, Math.max(safeTop, stageTop - COMPACT_HUD_HEIGHT - HUD_STAGE_GAP)),
      width,
      height: COMPACT_HUD_HEIGHT,
    },
    legend: {
      x: HUD_HOST_MARGIN,
      y: Math.max(0, Math.min(stageTop + stageHeight + HUD_STAGE_GAP, hostHeight - COMPACT_LEGEND_HEIGHT - HUD_HOST_MARGIN)),
      width,
      height: COMPACT_LEGEND_HEIGHT,
    },
  };
}
