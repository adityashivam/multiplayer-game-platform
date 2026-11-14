import { createBumperLinksBall, isBumperLinksBallCapturedByCup, shootBumperLinksBall, stepBumperLinksBall } from "../shared/ball.js";
import { wrapBumperLinksYaw } from "../shared/course.js";

/** @typedef {import("../shared/course.js").BumperLinksCourse} BumperLinksCourse */
/**
 * Local aim and charge. Never sent as-is; `capture` turns a release into one shot.
 * @typedef {{aimYaw:number,power:number,charging:boolean,chargeSec:number}} BumperLinksAimState
 * @typedef {{x:number,y:number,z:number}} BumperLinksAimPoint
 */

const AIM_TURN_RAD_PER_SEC = 1.7;
/** Full charge takes this long; holding longer swings power back down. */
const CHARGE_RISE_SEC = 1.2;
const MIN_RELEASE_POWER = 0.03;
const AIM_LINE_SEC = 0.8;
const AIM_LINE_DT_SEC = 1 / 30;
/** Dragging this share of the shorter screen side is a full-power putt. */
const FULL_DRAG_SHARE = 0.3;
/** Preview-only ball; the aim line never touches simulation state. */
const aimProbe = createBumperLinksBall("aim", 0, { x: 0, y: 0, z: 0 }, { human: false });

/** @param {number} aimYaw @returns {BumperLinksAimState} */
export function createBumperLinksAimState(aimYaw) {
  return { aimYaw: wrapBumperLinksYaw(aimYaw), power: 0, charging: false, chargeSec: 0 };
}

/**
 * Turn and charge at render cadence. Power rises over 1.2 s, then falls,
 * so holding never locks at full. Releasing while charging fires.
 * @param {BumperLinksAimState} aim Mutated.
 * @param {{turn:number,chargeHeld:boolean,dtSec:number}} control `turn` in [-1,1], positive turns right.
 * @returns {{aimYaw:number,power:number,release:boolean}}
 */
export function applyBumperLinksAimInput(aim, { turn, chargeHeld, dtSec }) {
  aim.aimYaw = wrapBumperLinksYaw(aim.aimYaw + turn * AIM_TURN_RAD_PER_SEC * dtSec);
  let release = false;
  if (chargeHeld) {
    aim.charging = true;
    aim.chargeSec += dtSec;
    const phase = (aim.chargeSec % (CHARGE_RISE_SEC * 2)) / CHARGE_RISE_SEC;
    aim.power = phase <= 1 ? phase : 2 - phase;
  } else if (aim.charging) {
    release = aim.power >= MIN_RELEASE_POWER;
    aim.charging = false;
    aim.chargeSec = 0;
  }
  const step = { aimYaw: aim.aimYaw, power: aim.power, release };
  if (!aim.charging) aim.power = 0;
  return step;
}

/**
 * Slingshot drag: pull back from the ball to aim the other way. Screen
 * right maps to the camera's right; dragging down the screen aims forward.
 * @param {{dx:number,dy:number,heading:number,sizePx:number}} drag CSS-pixel drag from the press point.
 * @returns {{aimYaw:number,power:number}}
 */
export function resolveBumperLinksDragAim({ dx, dy, heading, sizePx }) {
  const length = Math.hypot(dx, dy);
  return {
    aimYaw: wrapBumperLinksYaw(heading + Math.atan2(-dx, dy)),
    power: Math.min(1, length / Math.max(1, sizePx * FULL_DRAG_SHARE)),
  };
}

/**
 * Sample the first 0.8 s of a solo putt, so the line bends off rails like
 * the real ball. Other balls and the sweeper's future are ignored.
 * @param {Readonly<BumperLinksCourse>} course
 * @param {{x:number,y:number,z:number}} ball
 * @param {number} aimYaw
 * @param {number} power
 * @param {BumperLinksAimPoint[]} out Grown and reused by the caller.
 * @param {number} [maxPoints=24]
 * @returns {number} Points written to `out`.
 */
export function predictBumperLinksAimLine(course, ball, aimYaw, power, out, maxPoints = 24) {
  Object.assign(aimProbe, { x: ball.x, y: ball.y, z: ball.z, vx: 0, vy: 0, vz: 0, atRest: true, sunk: false, strokes: 0 });
  let count = 0;
  const writePoint = () => {
    if (!out[count]) out[count] = { x: 0, y: 0, z: 0 };
    out[count].x = aimProbe.x;
    out[count].y = aimProbe.y;
    out[count].z = aimProbe.z;
    count += 1;
  };
  writePoint();
  if (!shootBumperLinksBall(aimProbe, aimYaw, Math.max(0.05, power))) return count;
  const steps = Math.min(maxPoints - 1, Math.ceil(AIM_LINE_SEC / AIM_LINE_DT_SEC));
  for (let step = 0; step < steps; step += 1) {
    stepBumperLinksBall(aimProbe, AIM_LINE_DT_SEC, course, 0);
    writePoint();
    if (aimProbe.atRest || aimProbe.y < course.waterY || isBumperLinksBallCapturedByCup(aimProbe, course.cup)) break;
  }
  return count;
}
