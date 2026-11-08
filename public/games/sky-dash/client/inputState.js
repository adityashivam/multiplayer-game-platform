import { createInputLatch } from "../../../platform/frontend-engine/inputTimeline.js";

/** @typedef {"keyboard"|"shell"|"touch"} SkyDashInputSource */
/** @typedef {"jump"|"dash"|"dive"} SkyDashInputAction */
const ACTION_TEMPLATE = Object.freeze({ jump: false, dash: false, dive: false });
const INPUT_SOURCES = Object.freeze(["keyboard", "shell", "touch"]);

/**
 * Preserve independent device holds and short action edges using SDK latches.
 * A surface reset discards only that source, including its unconsumed presses.
 * @returns {{setMovement:(source:SkyDashInputSource,x:number,z:number)=>void,setAction:(source:SkyDashInputSource,action:SkyDashInputAction,active:boolean)=>void,resetSource:(source:SkyDashInputSource)=>void,reset:()=>void,capture:()=>import("../shared/config.js").SkyDashInputState}}
 */
export function createSkyDashInputState() {
  const movement = { keyboard: { x: 0, z: 0 }, shell: { x: 0, z: 0 }, touch: { x: 0, z: 0 } };
  const actions = {
    keyboard: createActionLatch(),
    shell: createActionLatch(),
    touch: createActionLatch(),
  };

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
      const capturedInput = { moveX: 0, moveZ: 0, ...ACTION_TEMPLATE };
      for (const source of INPUT_SOURCES) {
        moveX += movement[source].x;
        moveZ += movement[source].z;
        const sourceActions = actions[source].capture();
        for (const action of /** @type {SkyDashInputAction[]} */ (Object.keys(ACTION_TEMPLATE))) {
          capturedInput[action] ||= sourceActions[action];
        }
      }
      const length = Math.max(1, Math.hypot(moveX, moveZ));
      capturedInput.moveX = moveX / length;
      capturedInput.moveZ = moveZ / length;
      return capturedInput;
    },
  };
}

function createActionLatch() {
  return createInputLatch(ACTION_TEMPLATE, { edgeKeys: ["jump", "dash", "dive"] });
}
