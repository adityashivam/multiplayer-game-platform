import { createInputLatch } from "../../../platform/frontend-engine/inputTimeline.js";

/** @typedef {"keyboard"|"shell"|"touch"|"pointer"} RiftballInputSource */
/** @typedef {"strike"|"dash"|"jump"|"feint"} RiftballInputAction */
const ACTION_TEMPLATE = Object.freeze({ strike: false, dash: false, jump: false, feint: false });
const INPUT_SOURCES = Object.freeze(["keyboard", "shell", "touch", "pointer"]);

/**
 * Merge device-owned holds without letting a touch reset release physical keys.
 * Short presses use the SDK latch, including a complete tap between fixed steps.
 */
export function createRiftballInputState() {
  const movement = {
    keyboard: { x: 0, z: 0 }, shell: { x: 0, z: 0 },
    touch: { x: 0, z: 0 }, pointer: { x: 0, z: 0 },
  };
  const actions = {
    keyboard: createActionLatch(), shell: createActionLatch(),
    touch: createActionLatch(), pointer: createActionLatch(),
  };

  /** @param {RiftballInputSource} source */
  function resetSource(source) {
    movement[source].x = 0;
    movement[source].z = 0;
    actions[source].reset();
  }

  return {
    /** @param {RiftballInputSource} source @param {number} x @param {number} z */
    setMovement(source, x, z) {
      movement[source].x = Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0;
      movement[source].z = Number.isFinite(z) ? Math.max(-1, Math.min(1, z)) : 0;
    },
    /** @param {RiftballInputSource} source @param {RiftballInputAction} action @param {boolean} active */
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
        for (const action of /** @type {RiftballInputAction[]} */ (Object.keys(ACTION_TEMPLATE))) {
          capturedInput[action] ||= sourceActions[action];
        }
      }
      const magnitude = Math.max(1, Math.hypot(moveX, moveZ));
      capturedInput.moveX = moveX / magnitude;
      capturedInput.moveZ = moveZ / magnitude;
      return capturedInput;
    },
  };
}

/**
 * Convert local right/forward intent into world axes. Heading zero faces +Z.
 * @param {{moveX:number,moveZ:number}} input @param {number} heading
 * @returns {{moveX:number,moveZ:number}}
 */
export function projectRiftballMovement(input, heading) {
  const safeHeading = Number.isFinite(heading) ? heading : 0;
  const sin = Math.sin(safeHeading);
  const cos = Math.cos(safeHeading);
  return { moveX: -input.moveX * cos + input.moveZ * sin, moveZ: input.moveX * sin + input.moveZ * cos };
}

function createActionLatch() {
  return createInputLatch(ACTION_TEMPLATE, { edgeKeys: Object.keys(ACTION_TEMPLATE) });
}
