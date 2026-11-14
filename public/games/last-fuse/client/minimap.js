import { LAST_FUSE_RUNNER_COLORS } from "../shared/config.js";
import { getLastFuseCityLayout, isLastFuseRoofCollapsed } from "../shared/city.js";

/** @typedef {import("./snapshotPose.js").LastFusePresentedRunner} LastFusePresentedRunner */
/**
 * @typedef {object} LastFuseMinimapFrame
 * @property {Readonly<import("../shared/city.js").LastFuseCityState>} city
 * @property {readonly LastFusePresentedRunner[]} runners
 * @property {string} playerId
 * @property {string|null} holderId
 * @property {number} heading Camera heading; the map turns so forward is up.
 * @property {number} timeSec Pulse clock.
 */

const MAP_SIZE_PX = 156;
/** Wide enough for the city diagonal when the map turns 45 degrees. */
const MAP_SPAN_M = 64;
const REDRAW_INTERVAL_MS = 33;

/**
 * World offset to map pixels for a camera heading: screen right is the
 * camera's right, screen up is the camera's forward.
 * @param {number} worldX
 * @param {number} worldZ
 * @param {number} heading
 * @param {{x:number,y:number}} target Reused output.
 */
export function projectLastFuseMinimapPoint(worldX, worldZ, heading, target) {
  const sin = Math.sin(heading);
  const cos = Math.cos(heading);
  const scale = MAP_SIZE_PX / MAP_SPAN_M;
  target.x = MAP_SIZE_PX / 2 + (-worldX * cos + worldZ * sin) * scale;
  target.y = MAP_SIZE_PX / 2 - (worldX * sin + worldZ * cos) * scale;
  return target;
}

/**
 * Top-down map of the rooftops with every runner and the bomb, so players
 * always know where to run. Redraws at most thirty times a second.
 * @param {HTMLCanvasElement} canvas
 */
export function createLastFuseMinimap(canvas) {
  const pixelRatio = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = MAP_SIZE_PX * pixelRatio;
  canvas.height = MAP_SIZE_PX * pixelRatio;
  const context = canvas.getContext("2d");
  const point = { x: 0, y: 0 };
  const corners = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
  let lastDrawMs = -Infinity;

  /** @param {LastFuseMinimapFrame} frame */
  function drawRoofs(frame) {
    const layout = getLastFuseCityLayout(frame.city.seed);
    for (const roof of layout.roofs) {
      if (isLastFuseRoofCollapsed(frame.city.collapsedMask, roof.id)) continue;
      const halfWidth = roof.width / 2;
      const halfDepth = roof.depth / 2;
      projectLastFuseMinimapPoint(roof.x - halfWidth, roof.z - halfDepth, frame.heading, corners[0]);
      projectLastFuseMinimapPoint(roof.x + halfWidth, roof.z - halfDepth, frame.heading, corners[1]);
      projectLastFuseMinimapPoint(roof.x + halfWidth, roof.z + halfDepth, frame.heading, corners[2]);
      projectLastFuseMinimapPoint(roof.x - halfWidth, roof.z + halfDepth, frame.heading, corners[3]);
      const crumbling = frame.city.crumblingRoofId === roof.id;
      context.fillStyle = crumbling ? `rgba(255, 59, 48, ${0.35 + 0.3 * Math.sin(frame.timeSec * 14)})` : "rgba(176, 184, 206, 0.34)";
      context.beginPath();
      context.moveTo(corners[0].x, corners[0].y);
      for (let index = 1; index < 4; index += 1) context.lineTo(corners[index].x, corners[index].y);
      context.closePath();
      context.fill();
    }
  }

  /** @param {LastFuseMinimapFrame} frame */
  function drawRunners(frame) {
    let local = null;
    for (const runner of frame.runners) {
      if (runner.eliminated) continue;
      if (runner.id === frame.playerId) {
        local = runner;
        continue;
      }
      projectLastFuseMinimapPoint(runner.x, runner.z, frame.heading, point);
      const holder = runner.id === frame.holderId;
      if (holder) {
        context.strokeStyle = "#ff3b30";
        context.lineWidth = 2;
        context.beginPath();
        context.arc(point.x, point.y, 7 + Math.sin(frame.timeSec * 10) * 2, 0, Math.PI * 2);
        context.stroke();
      }
      context.fillStyle = holder ? "#ff3b30" : LAST_FUSE_RUNNER_COLORS[runner.colorIndex % LAST_FUSE_RUNNER_COLORS.length];
      context.globalAlpha = runner.fallen ? 0.35 : 1;
      context.beginPath();
      context.arc(point.x, point.y, holder ? 5 : 4, 0, Math.PI * 2);
      context.fill();
      context.globalAlpha = 1;
    }
    if (!local) return;
    projectLastFuseMinimapPoint(local.x, local.z, frame.heading, point);
    const facing = local.facing - frame.heading;
    context.save();
    context.translate(point.x, point.y);
    context.rotate(-facing);
    context.fillStyle = local.id === frame.holderId ? "#ff3b30" : "#ffffff";
    context.strokeStyle = "#0d0f15";
    context.lineWidth = 1.5;
    context.beginPath();
    context.moveTo(0, -7);
    context.lineTo(5, 5);
    context.lineTo(0, 2.5);
    context.lineTo(-5, 5);
    context.closePath();
    context.fill();
    context.stroke();
    context.restore();
  }

  return {
    /** @param {LastFuseMinimapFrame} frame @param {number} nowMs */
    draw(frame, nowMs) {
      if (nowMs - lastDrawMs < REDRAW_INTERVAL_MS) return;
      lastDrawMs = nowMs;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, MAP_SIZE_PX, MAP_SIZE_PX);
      drawRoofs(frame);
      drawRunners(frame);
    },
  };
}
