import { createInputLatch } from "../../../platform/frontend-engine/inputTimeline.js";

/** @typedef {"keyboard"|"shell"|"touch"} LastFuseInputSource */
/** @typedef {"jump"|"dash"} LastFuseInputAction */
const ACTION_TEMPLATE = Object.freeze({ jump: false, dash: false });
const ACTION_EDGE_KEYS = Object.freeze(["jump", "dash"]);
const INPUT_SOURCES = Object.freeze(/** @type {LastFuseInputSource[]} */ (["keyboard", "shell", "touch"]));

/**
 * Merge device-owned holds so releasing one device never releases another.
 * Short jump and dash taps use the SDK latch and survive between captures.
 * @returns {{
 *   setMovement(source:LastFuseInputSource,x:number,z:number):void,
 *   setAction(source:LastFuseInputSource,action:LastFuseInputAction,active:boolean):void,
 *   resetSource(source:LastFuseInputSource):void,
 *   reset():void,
 *   capture():{moveX:number,moveZ:number,jump:boolean,dash:boolean}
 * }} Screen right/forward intent plus merged action holds.
 */
export function createLastFuseInputState() {
  const movement = Object.fromEntries(INPUT_SOURCES.map((source) => [source, { x: 0, z: 0 }]));
  const actions = Object.fromEntries(INPUT_SOURCES.map((source) => [source, createInputLatch(ACTION_TEMPLATE, { edgeKeys: ACTION_EDGE_KEYS })]));

  /** @param {LastFuseInputSource} source */
  function resetSource(source) {
    movement[source].x = 0;
    movement[source].z = 0;
    actions[source].reset();
  }

  return {
    setMovement(source, x, z) {
      movement[source].x = Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0;
      movement[source].z = Number.isFinite(z) ? Math.max(-1, Math.min(1, z)) : 0;
    },
    setAction: (source, action, active) => actions[source].set(action, active),
    resetSource,
    reset: () => INPUT_SOURCES.forEach(resetSource),
    capture() {
      let moveX = 0;
      let moveZ = 0;
      const capturedInput = { moveX, moveZ, ...ACTION_TEMPLATE };
      for (const source of INPUT_SOURCES) {
        moveX += movement[source].x;
        moveZ += movement[source].z;
        const sourceActions = actions[source].capture();
        capturedInput.jump ||= sourceActions.jump;
        capturedInput.dash ||= sourceActions.dash;
      }
      const magnitude = Math.max(1, Math.hypot(moveX, moveZ));
      capturedInput.moveX = moveX / magnitude;
      capturedInput.moveZ = moveZ / magnitude;
      return capturedInput;
    },
  };
}

/**
 * Convert screen right/forward intent into world X/Z for a camera heading.
 * Heading zero looks along +Z.
 * @param {{moveX:number,moveZ:number}} input
 * @param {number} heading
 * @returns {{moveX:number,moveZ:number}}
 */
export function projectLastFuseMovement(input, heading) {
  const safeHeading = Number.isFinite(heading) ? heading : 0;
  const sin = Math.sin(safeHeading);
  const cos = Math.cos(safeHeading);
  return {
    moveX: -input.moveX * cos + input.moveZ * sin,
    moveZ: input.moveX * sin + input.moveZ * cos,
  };
}

/**
 * Starting camera heading for a runner: from its spawn roof toward the city
 * centre, so "forward" points into the action.
 * @param {number} x
 * @param {number} z
 * @returns {number}
 */
export function getLastFuseSpawnHeading(x, z) {
  return Math.hypot(x, z) < 0.5 ? 0 : Math.atan2(-x, -z);
}
