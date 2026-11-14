import { BUMPER_LINKS_BALL_COLORS, BUMPER_LINKS_COURSE } from "../shared/config.js";

/** @typedef {import("../shared/course.js").BumperLinksCourse} BumperLinksCourse */
/** @typedef {import("./snapshotPose.js").BumperLinksPresentedBall} BumperLinksPresentedBall */

const MAP_PADDING_PX = 10;
const DRAW_INTERVAL_MS = 50;

/**
 * Fit course bounds into a square map, +Z up, clamped to the map.
 * @param {{minX:number,maxX:number,minZ:number,maxZ:number}} bounds
 * @param {number} x @param {number} z @param {number} sizePx
 * @returns {{x:number,y:number}}
 */
export function projectBumperLinksMinimapPoint(bounds, x, z, sizePx) {
  const span = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ, 1);
  const scale = (sizePx - MAP_PADDING_PX * 2) / span;
  const centreX = (bounds.minX + bounds.maxX) / 2;
  const centreZ = (bounds.minZ + bounds.maxZ) / 2;
  const mapX = sizePx / 2 + (x - centreX) * scale;
  const mapY = sizePx / 2 - (z - centreZ) * scale;
  return {
    x: Math.max(0, Math.min(sizePx, mapX)),
    y: Math.max(0, Math.min(sizePx, mapY)),
  };
}

/**
 * Canvas minimap: greens, the cup and every ball. The course layer is
 * cached per hole; balls redraw at most 20 times a second.
 * @param {HTMLCanvasElement} canvas
 */
export function createBumperLinksMinimap(canvas) {
  const context = canvas.getContext("2d");
  const courseLayer = document.createElement("canvas");
  const courseContext = courseLayer.getContext("2d");
  let cachedSeed = -1;
  let cachedSizePx = 0;
  let lastDrawMs = -Infinity;

  /** @param {Readonly<BumperLinksCourse>} course @param {number} sizePx */
  function drawBumperLinksCourseLayer(course, sizePx) {
    courseLayer.width = sizePx;
    courseLayer.height = sizePx;
    courseContext.clearRect(0, 0, sizePx, sizePx);
    const span = Math.max(course.bounds.maxX - course.bounds.minX, course.bounds.maxZ - course.bounds.minZ, 1);
    const tilePx = (BUMPER_LINKS_COURSE.tileSize * (sizePx - MAP_PADDING_PX * 2)) / span;
    for (const tile of course.tiles) {
      const centre = projectBumperLinksMinimapPoint(course.bounds, tile.col * BUMPER_LINKS_COURSE.tileSize, tile.row * BUMPER_LINKS_COURSE.tileSize, sizePx);
      courseContext.fillStyle = tile.height < 0 ? "#3a9b62" : "#5fd38d";
      courseContext.fillRect(centre.x - tilePx / 2 + 0.5, centre.y - tilePx / 2 + 0.5, tilePx - 1, tilePx - 1);
    }
    const cup = projectBumperLinksMinimapPoint(course.bounds, course.cup.x, course.cup.z, sizePx);
    courseContext.fillStyle = "#0b1a12";
    courseContext.beginPath();
    courseContext.arc(cup.x, cup.y, 3.5, 0, Math.PI * 2);
    courseContext.fill();
    courseContext.fillStyle = "#ff5d73";
    courseContext.fillRect(cup.x, cup.y - 11, 6, 4);
    courseContext.fillStyle = "#e7edf2";
    courseContext.fillRect(cup.x, cup.y - 11, 1, 11);
  }

  return {
    /**
     * @param {{course:Readonly<BumperLinksCourse>,balls:readonly BumperLinksPresentedBall[],playerId:string}} frame
     * @param {number} nowMs
     */
    draw({ course, balls, playerId }, nowMs) {
      if (nowMs - lastDrawMs < DRAW_INTERVAL_MS) return;
      lastDrawMs = nowMs;
      const sizePx = Math.max(1, Math.round(canvas.clientWidth * (window.devicePixelRatio || 1)));
      if (canvas.width !== sizePx) {
        canvas.width = sizePx;
        canvas.height = sizePx;
      }
      if (cachedSeed !== course.seed || cachedSizePx !== sizePx) {
        cachedSeed = course.seed;
        cachedSizePx = sizePx;
        drawBumperLinksCourseLayer(course, sizePx);
      }
      context.clearRect(0, 0, sizePx, sizePx);
      context.drawImage(courseLayer, 0, 0);
      const ballRadiusPx = Math.max(2.5, sizePx / 40);
      for (const ball of balls) {
        if (ball.sunk) continue;
        const point = projectBumperLinksMinimapPoint(course.bounds, ball.x, ball.z, sizePx);
        context.fillStyle = BUMPER_LINKS_BALL_COLORS[ball.slotIndex % BUMPER_LINKS_BALL_COLORS.length];
        context.beginPath();
        context.arc(point.x, point.y, ball.id === playerId ? ballRadiusPx * 1.4 : ballRadiusPx, 0, Math.PI * 2);
        context.fill();
        if (ball.id === playerId) {
          context.strokeStyle = "#0b1a12";
          context.lineWidth = 1.5;
          context.stroke();
        }
      }
    },
  };
}
