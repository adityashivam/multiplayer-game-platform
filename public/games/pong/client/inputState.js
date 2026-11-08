import { createInputLatch } from "../../../platform/frontend-engine/inputTimeline.js";
import { PONG_INPUT_TEMPLATE } from "../shared/simulation.js";

/** @typedef {keyof typeof PONG_INPUT_TEMPLATE} PongDirection */
const PONG_KEY_BINDINGS = Object.freeze({
  ArrowUp: "up", KeyW: "up", ArrowLeft: "up", KeyA: "up",
  ArrowDown: "down", KeyS: "down", ArrowRight: "down", KeyD: "down",
});
/** @typedef {keyof typeof PONG_KEY_BINDINGS|"shell:up"|"shell:down"|"shell:left"|"shell:right"} PongHoldSource */

/** @param {string} keyboardCode @returns {PongDirection|null} */
export function readPongKeyboardInput(keyboardCode) {
  return Object.hasOwn(PONG_KEY_BINDINGS, keyboardCode) ? PONG_KEY_BINDINGS[keyboardCode] : null;
}

/** Merge documented key/shell holds; releasing one source leaves other sources held. */
export function createPongInputState() {
  /** @type {{up:Set<PongHoldSource>,down:Set<PongHoldSource>}} */
  const holds = { up: new Set(), down: new Set() };
  const inputLatch = createInputLatch(PONG_INPUT_TEMPLATE);
  return {
    /** @param {PongDirection} direction @param {PongHoldSource} source @param {boolean} active */
    setHeld(direction, source, active) {
      if (!Object.hasOwn(holds, direction)) return;
      if (active) holds[direction].add(source);
      else holds[direction].delete(source);
      inputLatch.set(direction, holds[direction].size > 0);
    },
    capture: () => inputLatch.capture(),
    reset() {
      holds.up.clear();
      holds.down.clear();
      inputLatch.reset();
    },
  };
}
