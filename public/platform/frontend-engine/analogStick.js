export const ANALOG_STICK_CHANGE_EVENT = "platformanalogchange";
const ANALOG_STICK_DEADZONE = 0.14;
const ANALOG_STICK_VISUAL_TRAVEL_PERCENT = 24;
const STICK_ARROW_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"]);

/** @typedef {{x: number, y: number}} AnalogStickState */

/**
 * Apply a rescaled circular deadzone to normalized coordinates. X points right,
 * Y points down. Diagonals have at most unit magnitude; nonfinite input is neutral.
 * @param {number} x
 * @param {number} y
 * @param {number} [deadzone=0.14]
 * @returns {AnalogStickState}
 */
export function normalizeAnalogStick(x, y, deadzone = ANALOG_STICK_DEADZONE) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return { x: 0, y: 0 };
  }
  const radialDeadzone = Number.isFinite(deadzone) ? Math.max(0, Math.min(0.99, deadzone)) : ANALOG_STICK_DEADZONE;
  const distance = Math.hypot(x, y);
  if (distance <= radialDeadzone) {
    return { x: 0, y: 0 };
  }

  const magnitude = (Math.min(1, distance) - radialDeadzone) / (1 - radialDeadzone);
  return { x: x / distance * magnitude, y: y / distance * magnitude };
}

/**
 * Read an owned state copy across independently bundled shell/game modules.
 * Values live on the shared DOM element so the SDK needs no global singleton.
 * @param {HTMLElement} stickElement
 * @returns {AnalogStickState}
 */
export function getAnalogStickState(stickElement) {
  const x = Number(stickElement?.dataset.stickX ?? 0);
  const y = Number(stickElement?.dataset.stickY ?? 0);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : { x: 0, y: 0 };
}

/**
 * Bind one shell stick to one captured pointer or focused arrow keys. Changes
 * update CSS/DOM directly, without React renders. The owner must dispose this
 * binding on unmount and setDisabled when platform dialogs take input focus.
 * @param {HTMLElement} stickElement
 * @param {{disabled?: boolean}} [options]
 * @returns {{reset: () => void, setDisabled: (disabled: boolean) => void, dispose: () => void}}
 */
export function bindAnalogStick(stickElement, { disabled = false } = {}) {
  const stickDocument = stickElement.ownerDocument;
  const stickWindow = stickDocument.defaultView;
  const pressedKeys = new Set();
  /** @type {number | null} */
  let activePointerId = null;
  let bindingDisabled = disabled;
  let disposed = false;

  /** @param {AnalogStickState} stickState */
  function publishStickState(stickState) {
    const previousState = getAnalogStickState(stickElement);
    stickElement.dataset.stickX = String(stickState.x);
    stickElement.dataset.stickY = String(stickState.y);
    stickElement.style.setProperty("--stick-x", `${stickState.x * ANALOG_STICK_VISUAL_TRAVEL_PERCENT}%`);
    stickElement.style.setProperty("--stick-y", `${stickState.y * ANALOG_STICK_VISUAL_TRAVEL_PERCENT}%`);
    if (previousState.x !== stickState.x || previousState.y !== stickState.y) {
      stickElement.dispatchEvent(new stickWindow.CustomEvent(ANALOG_STICK_CHANGE_EVENT, { detail: { ...stickState } }));
    }
  }

  function reset() {
    const capturedPointerId = activePointerId;
    activePointerId = null;
    pressedKeys.clear();
    if (capturedPointerId !== null && stickElement.hasPointerCapture?.(capturedPointerId)) {
      stickElement.releasePointerCapture(capturedPointerId);
    }
    publishStickState({ x: 0, y: 0 });
  }

  /** @param {PointerEvent} pointerEvent */
  function updatePointerPosition(pointerEvent) {
    const stickBounds = stickElement.getBoundingClientRect();
    const radius = Math.min(stickBounds.width, stickBounds.height) / 2;
    if (radius <= 0) {
      reset();
      return;
    }

    publishStickState(normalizeAnalogStick(
      (pointerEvent.clientX - stickBounds.left - stickBounds.width / 2) / radius,
      (pointerEvent.clientY - stickBounds.top - stickBounds.height / 2) / radius,
    ));
  }

  /** @param {PointerEvent} pointerEvent */
  function startPointerInput(pointerEvent) {
    if (bindingDisabled || disposed || stickDocument.hidden || activePointerId !== null || pointerEvent.button !== 0) {
      return;
    }
    pointerEvent.preventDefault();
    pressedKeys.clear();
    activePointerId = pointerEvent.pointerId;
    stickElement.setPointerCapture(activePointerId);
    updatePointerPosition(pointerEvent);
  }

  /** @param {PointerEvent} pointerEvent */
  function movePointerInput(pointerEvent) {
    if (pointerEvent.pointerId !== activePointerId) {
      return;
    }
    pointerEvent.preventDefault();
    updatePointerPosition(pointerEvent);
  }

  /** @param {PointerEvent} pointerEvent */
  function endPointerInput(pointerEvent) {
    if (pointerEvent.pointerId === activePointerId) {
      reset();
    }
  }

  function updateKeyboardInput() {
    publishStickState(normalizeAnalogStick(
      Number(pressedKeys.has("ArrowRight")) - Number(pressedKeys.has("ArrowLeft")),
      Number(pressedKeys.has("ArrowDown")) - Number(pressedKeys.has("ArrowUp")),
    ));
  }

  /** @param {KeyboardEvent} keyboardEvent */
  function startKeyboardInput(keyboardEvent) {
    if (bindingDisabled || disposed || stickDocument.hidden || !STICK_ARROW_KEYS.has(keyboardEvent.key)) {
      return;
    }
    keyboardEvent.preventDefault();
    keyboardEvent.stopPropagation();
    if (activePointerId !== null) {
      return;
    }
    pressedKeys.add(keyboardEvent.key);
    updateKeyboardInput();
  }

  /** @param {KeyboardEvent} keyboardEvent */
  function endKeyboardInput(keyboardEvent) {
    if (!STICK_ARROW_KEYS.has(keyboardEvent.key)) {
      return;
    }
    keyboardEvent.preventDefault();
    keyboardEvent.stopPropagation();
    if (pressedKeys.delete(keyboardEvent.key)) {
      updateKeyboardInput();
    }
  }

  function resetHiddenStick() {
    if (stickDocument.hidden) {
      reset();
    }
  }

  const elementListeners = [
    ["pointerdown", startPointerInput], ["pointermove", movePointerInput],
    ["pointerup", endPointerInput], ["pointercancel", endPointerInput],
    ["lostpointercapture", endPointerInput], ["keydown", startKeyboardInput],
    ["keyup", endKeyboardInput], ["blur", reset],
  ];
  for (const [eventName, eventListener] of elementListeners) {
    stickElement.addEventListener(eventName, eventListener);
  }
  stickWindow.addEventListener("blur", reset);
  stickWindow.addEventListener("resize", reset);
  stickDocument.addEventListener("visibilitychange", resetHiddenStick);
  reset();

  return {
    reset,
    setDisabled(nextDisabled) {
      bindingDisabled = Boolean(nextDisabled);
      if (bindingDisabled) {
        reset();
      }
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      reset();
      for (const [eventName, eventListener] of elementListeners) {
        stickElement.removeEventListener(eventName, eventListener);
      }
      stickWindow.removeEventListener("blur", reset);
      stickWindow.removeEventListener("resize", reset);
      stickDocument.removeEventListener("visibilitychange", resetHiddenStick);
    },
  };
}
