import { ANALOG_STICK_CHANGE_EVENT, getAnalogStickState } from "./analogStick.js";
import { isVirtualGameControlHeld, subscribeVirtualGameControl } from "./virtualGameControls.js";

/**
 * @typedef {object} GameButtonControl
 * @property {(handler: (event?: Event) => void) => () => void} onPress Subscribe to direct clicks and virtual press edges.
 * @property {(onDown: () => void, onUp: () => void) => () => void} onHold Subscribe to aggregate holds; cleanup releases this subscription.
 */

export function getGameDomRefs() {
  const canvas = document.getElementById("game-canvas") || document.querySelector("canvas");

  return {
    canvas,
  };
}

/**
 * Combine direct shell input and optional virtual direction/action ownership.
 * Subscribers must unsubscribe before the game runtime is disposed.
 * @param {NodeListOf<HTMLElement>|HTMLElement[]} elements
 * @param {import("./virtualGameControls.js").PlatformControlBinding} [platformBinding]
 * @returns {GameButtonControl}
 */
function createControl(elements, platformBinding) {
  const list = Array.from(elements || []).filter(Boolean);
  const inputWindow = list[0]?.ownerDocument?.defaultView ?? document.defaultView ??
    (typeof window === "undefined" ? undefined : window);
  return {
    onPress(handler) {
      if (typeof handler !== "function") {
        return () => {};
      }
      list.forEach((el) => el.addEventListener("click", handler));
      const unsubscribeVirtual = platformBinding ? subscribeVirtualGameControl(platformBinding, (controlChange) => {
        if (controlChange.pressed) {
          handler();
        }
      }, inputWindow) : () => {};
      return () => {
        list.forEach((el) => el.removeEventListener("click", handler));
        unsubscribeVirtual();
      };
    },
    onHold(onDown, onUp) {
      if (typeof onDown !== "function" || typeof onUp !== "function") {
        return () => {};
      }
      /** @type {Set<HTMLElement|symbol>} */
      const heldSources = new Set();
      const virtualSource = Symbol("virtual-control-subscription");
      /** @param {HTMLElement|symbol} source @param {boolean} active */
      function updateHeldSource(source, active) {
        const wasHeld = heldSources.size > 0;
        if (active) {
          heldSources.add(source);
        } else {
          heldSources.delete(source);
        }
        if (!wasHeld && heldSources.size > 0) {
          onDown();
        } else if (wasHeld && heldSources.size === 0) {
          onUp();
        }
      }

      const cleanups = list.map((el) => bindHold(el, () => updateHeldSource(el, true), () => updateHeldSource(el, false)));
      const unsubscribeVirtual = platformBinding ? subscribeVirtualGameControl(platformBinding, (controlChange) => {
        updateHeldSource(virtualSource, controlChange.held);
      }, inputWindow) : () => {};
      if (platformBinding && isVirtualGameControlHeld(platformBinding, inputWindow)) {
        updateHeldSource(virtualSource, true);
      }
      return () => {
        cleanups.forEach((cleanup) => cleanup());
        unsubscribeVirtual();
        if (heldSources.size > 0) {
          heldSources.clear();
          onUp();
        }
      };
    },
  };
}

function bindHold(button, onDown, onUp) {
  const start = (event) => {
    event.preventDefault();
    onDown();
  };
  const end = (event) => {
    event.preventDefault();
    onUp();
  };
  button.addEventListener("pointerdown", start);
  button.addEventListener("pointerup", end);
  button.addEventListener("pointerleave", end);
  button.addEventListener("pointercancel", end);
  button.addEventListener("touchstart", start, { passive: false });
  button.addEventListener("touchend", end, { passive: false });
  button.addEventListener("touchcancel", end, { passive: false });
  return () => {
    button.removeEventListener("pointerdown", start);
    button.removeEventListener("pointerup", end);
    button.removeEventListener("pointerleave", end);
    button.removeEventListener("pointercancel", end);
    button.removeEventListener("touchstart", start);
    button.removeEventListener("touchend", end);
    button.removeEventListener("touchcancel", end);
  };
}

/**
 * Subscribe to shell sticks without owning their pointer bindings. Each handler
 * receives a fresh normalized state. Unsubscribe before disposing a game runtime.
 * @param {NodeListOf<HTMLElement>} stickElements
 * @returns {{onChange: (handler: (state: import("./analogStick.js").AnalogStickState) => void) => () => void, getState: () => import("./analogStick.js").AnalogStickState}}
 */
function createStickControl(stickElements) {
  const elements = Array.from(stickElements);
  return {
    onChange(handler) {
      if (typeof handler !== "function") {
        return () => {};
      }
      const stickListener = (stickEvent) => handler({ ...stickEvent.detail });
      for (const stickElement of elements) {
        stickElement.addEventListener(ANALOG_STICK_CHANGE_EVENT, stickListener);
      }
      return () => {
        for (const stickElement of elements) {
          stickElement.removeEventListener(ANALOG_STICK_CHANGE_EVENT, stickListener);
        }
      };
    },
    getState() {
      for (const stickElement of elements) {
        const stickState = getAnalogStickState(stickElement);
        if (stickState.x !== 0 || stickState.y !== 0) {
          return stickState;
        }
      }
      return { x: 0, y: 0 };
    },
  };
}

/** Discover reusable platform buttons and normalized left/right analog sticks. */
export function getGameControls() {
  const homeButtons = document.querySelectorAll('[data-action="home"], [data-action="select"]');
  return {
    sticks: {
      left: createStickControl(document.querySelectorAll('[data-stick="left"]')),
      right: createStickControl(document.querySelectorAll('[data-stick="right"]')),
    },
    dpad: {
      up: createControl(document.querySelectorAll('[data-dir="up"]'), "up"),
      down: createControl(document.querySelectorAll('[data-dir="down"]'), "down"),
      left: createControl(document.querySelectorAll('[data-dir="left"]'), "left"),
      right: createControl(document.querySelectorAll('[data-dir="right"]'), "right"),
    },
    menu: {
      select: createControl(homeButtons),
      home: createControl(homeButtons),
      start: createControl(document.querySelectorAll('[data-action="start"]')),
    },
    actions: {
      x: createControl(document.querySelectorAll('[data-action="x"]'), "x"),
      a: createControl(document.querySelectorAll('[data-action="a"]'), "a"),
      b: createControl(document.querySelectorAll('[data-action="b"]'), "b"),
      y: createControl(document.querySelectorAll('[data-action="y"]'), "y"),
    },
  };
}
