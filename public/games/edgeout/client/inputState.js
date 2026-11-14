import { createInputLatch } from "../../../platform/frontend-engine/inputTimeline.js";

/** @typedef {"keyboard"|"shell"|"touch"|"pointer"} EdgeoutInputSource */
/** @typedef {"shove"|"dash"|"block"} EdgeoutInputAction */
const ACTION_TEMPLATE = Object.freeze({ shove: false, dash: false, block: false });
const ACTION_EDGE_KEYS = Object.freeze(["shove", "dash"]);
const INPUT_SOURCES = Object.freeze(/** @type {EdgeoutInputSource[]} */ (["keyboard", "shell", "touch", "pointer"]));

/**
 * Merge device-owned holds so releasing one device never releases another.
 * Short shove/dash taps use the SDK latch and survive between fixed captures.
 * @returns {{
 *   setMovement(source:EdgeoutInputSource,x:number,z:number):void,
 *   setAction(source:EdgeoutInputSource,action:EdgeoutInputAction,active:boolean):void,
 *   resetSource(source:EdgeoutInputSource):void,
 *   reset():void,
 *   capture():{moveX:number,moveZ:number,shove:boolean,dash:boolean,block:boolean}
 * }} Local right/forward movement intent plus merged action holds.
 */
export function createEdgeoutInputState() {
  const movement = Object.fromEntries(INPUT_SOURCES.map((source) => [source, { x: 0, z: 0 }]));
  const actions = Object.fromEntries(INPUT_SOURCES.map((source) => [source, createInputLatch(ACTION_TEMPLATE, { edgeKeys: ACTION_EDGE_KEYS })]));

  /** @param {EdgeoutInputSource} source */
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
        capturedInput.shove ||= sourceActions.shove;
        capturedInput.dash ||= sourceActions.dash;
        capturedInput.block ||= sourceActions.block;
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
 * Heading zero looks along +Z; the default duel camera for p1 looks along -Z.
 * @param {{moveX:number,moveZ:number}} input
 * @param {number} heading
 * @returns {{moveX:number,moveZ:number}}
 */
export function projectEdgeoutMovement(input, heading) {
  const safeHeading = Number.isFinite(heading) ? heading : 0;
  const sin = Math.sin(safeHeading);
  const cos = Math.cos(safeHeading);
  return {
    moveX: -input.moveX * cos + input.moveZ * sin,
    moveZ: input.moveX * sin + input.moveZ * cos,
  };
}

/**
 * Camera heading per seat: each player looks across the arena from their own
 * spawn, so "forward" always points at the rival at the start of a round.
 * @param {number} slotIndex
 * @param {number} fighterCount
 * @returns {number}
 */
export function getEdgeoutSeatHeading(slotIndex, fighterCount) {
  return (Math.PI * 2 * slotIndex) / Math.max(1, fighterCount) + Math.PI;
}
