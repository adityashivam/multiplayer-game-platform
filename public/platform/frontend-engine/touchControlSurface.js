import { normalizeAnalogStick } from "./analogStick.js";
import { createVirtualGameControlSource } from "./virtualGameControls.js";

/** Window event boundary shared by independently bundled shell and game modules. */
export const PLATFORM_TOUCH_INPUT_EVENT = "platformtouchinput";

const TOUCH_CONTROL_SELECTOR = "[data-touch-control-id]";
const TOUCH_SURFACE_SELECTOR = "[data-platform-touch-game]";
const MODAL_INPUT_SELECTOR = '[role="dialog"][aria-modal="true"], dialog[open]';
const INTERACTIVE_INPUT_SELECTOR = [
  "button", "a[href]", "input", "select", "textarea", "summary", '[role="button"]',
  '[contenteditable]:not([contenteditable="false"])', '[role="dialog"]', "dialog",
  '[role="toolbar"]', "[data-platform-chrome]", "[data-platform-touch-editor]",
].join(", ");
const TOUCH_STICK_VISUAL_TRAVEL = 0.28;
const PLATFORM_STICK_DIRECTION_THRESHOLD = 0.25;
const HOST_TOUCH_GESTURE_OWNERS = Symbol.for("platform.touch-control-host-gestures.v1");
const TOUCH_SURFACE_ACTIVE_OWNERS = Symbol.for("platform.touch-control-surface-owners.v1");

/**
 * @typedef {import("../shared/touchControls.js").TouchControlsDescriptor} TouchControlsDescriptor
 * @typedef {import("../shared/touchControls.js").TouchControlDescriptor} TouchControlDescriptor
 * @typedef {import("../shared/touchControls.js").ResolvedTouchControl} ResolvedTouchControl
 * @typedef {{type: "axis", controlId: string, x: number, y: number}|
 * {type: "look", controlId: string, deltaX: number, deltaY: number}|
 * {type: "action", controlId: string, active: boolean}|
 * {type: "reset"}} PlatformTouchInputPayload
 * @typedef {PlatformTouchInputPayload & {gameId: string}} PlatformTouchInput
 * @typedef {object} OwnedTouchPointer
 * @property {number} pointerId
 * @property {TouchControlDescriptor} control
 * @property {HTMLElement|undefined} controlElement
 * @property {number} lastX
 * @property {number} lastY
 * @typedef {object} TouchControlSurfaceOptions
 * @property {HTMLElement} element Runtime touch layer, inside the same parent as the game host.
 * @property {string} gameId
 * @property {TouchControlsDescriptor} descriptor
 * @property {ResolvedTouchControl[]} layout
 * @property {boolean} [disabled=false]
 */

/**
 * Listen across shell/game bundle boundaries. Each subscriber receives its own
 * event object; disposing a game must call the returned unsubscribe function.
 * @param {string} gameId
 * @param {(inputEvent: PlatformTouchInput) => void} listener
 * @returns {() => void}
 */
export function subscribePlatformTouchInput(gameId, listener) {
  const inputWindow = typeof window === "undefined" ? undefined : window;
  if (!inputWindow) {
    return () => {};
  }
  function receivePlatformTouchInput(inputEvent) {
    if (inputEvent.detail?.gameId === gameId) {
      listener({ ...inputEvent.detail });
    }
  }
  inputWindow.addEventListener(PLATFORM_TOUCH_INPUT_EVENT, receivePlatformTouchInput);
  return () => inputWindow.removeEventListener(PLATFORM_TOUCH_INPUT_EVENT, receivePlatformTouchInput);
}

/**
 * Read the current DOM marker instead of module-local state. This works when a
 * game imports SDK files directly while the React shell uses a separate bundle.
 * @param {string} gameId
 * @returns {boolean}
 */
export function isPlatformTouchControlsActive(gameId) {
  const inputDocument = typeof document === "undefined" ? undefined : document;
  if (!inputDocument) {
    return false;
  }
  if (inputDocument.querySelectorAll) {
    return [...inputDocument.querySelectorAll(TOUCH_SURFACE_SELECTOR)].some((surface) =>
      surface.dataset.platformTouchGame === gameId && surface.dataset.active === "true");
  }
  if (!/^[A-Za-z0-9_-]+$/.test(gameId)) {
    return false;
  }
  return Boolean(inputDocument.querySelector?.(`[data-platform-touch-game="${gameId}"][data-active="true"]`));
}

/**
 * Bind independent pointer owners without React state updates. Empty touch-layer
 * space must use pointer-events:none so game HUD buttons remain reachable. The
 * parent captures background look gestures before the underlying game sees them;
 * buttons, editable content and platform chrome retain their ordinary events.
 * Active bindings temporarily disable native host panning and restore it when released.
 *
 * Buttons emit hold/release, press pulses, or simultaneous hold and relative look.
 * Each release neutralizes only its owner. Global cancellation clears every owner.
 * @param {TouchControlSurfaceOptions} options
 * @returns {{reset: () => void, setDisabled: (disabled: boolean) => void, dispose: () => void}}
 */
export function bindTouchControlSurface({ element, gameId, descriptor, layout, disabled = false }) {
  const inputDocument = element.ownerDocument;
  const inputWindow = inputDocument.defaultView;
  const inputHost = element.parentElement || element;
  const declaredControls = new Map(descriptor.controls.map((control) => [control.id, control]));
  const controlElements = new Map();
  for (const controlElement of element.querySelectorAll(TOUCH_CONTROL_SELECTOR)) {
    const controlId = controlElement.dataset.touchControlId;
    if (declaredControls.has(controlId)) {
      controlElements.set(controlId, controlElement);
    }
  }
  const enabledControlIds = new Set(layout.map((control) => control.id));
  const virtualControlSources = new Map(descriptor.controls
    .filter((control) => control.platformBinding && enabledControlIds.has(control.id))
    .map((control) => [control.id, createVirtualGameControlSource(inputWindow)]));
  const lookControl = descriptor.controls.find((control) => control.type === "look" && enabledControlIds.has(control.id));
  /** @type {Map<number, OwnedTouchPointer>} */
  const ownedPointers = new Map();
  const claimedControls = new Map();
  const hostGestureOwner = Symbol("touch-surface");
  let ownsHostGestures = false;
  let bindingDisabled = Boolean(disabled);
  let disposed = false;
  element.dataset.platformTouchGame = gameId;

  /** Restore the original inline gesture policy only after the final active binding releases it. */
  function updateHostGestureOwnership() {
    const shouldOwnHostGestures = !bindingDisabled && !disposed;
    const surfaceOwners = element[TOUCH_SURFACE_ACTIVE_OWNERS] ?? new Set();
    if (shouldOwnHostGestures) {
      surfaceOwners.add(hostGestureOwner);
      element[TOUCH_SURFACE_ACTIVE_OWNERS] = surfaceOwners;
    } else {
      surfaceOwners.delete(hostGestureOwner);
      if (surfaceOwners.size === 0) {
        delete element[TOUCH_SURFACE_ACTIVE_OWNERS];
      }
    }
    element.dataset.active = String(surfaceOwners.size > 0);

    if (shouldOwnHostGestures === ownsHostGestures) {
      return;
    }

    if (shouldOwnHostGestures) {
      const hostOwnership = inputHost[HOST_TOUCH_GESTURE_OWNERS] ?? {
        previousTouchAction: inputHost.style.touchAction,
        owners: new Set(),
      };
      hostOwnership.owners.add(hostGestureOwner);
      inputHost[HOST_TOUCH_GESTURE_OWNERS] = hostOwnership;
      inputHost.style.touchAction = "none";
    } else {
      const hostOwnership = inputHost[HOST_TOUCH_GESTURE_OWNERS];
      hostOwnership?.owners.delete(hostGestureOwner);
      if (hostOwnership?.owners.size === 0) {
        if (inputHost.style.touchAction === "none") {
          inputHost.style.touchAction = hostOwnership.previousTouchAction;
        }
        delete inputHost[HOST_TOUCH_GESTURE_OWNERS];
      }
    }
    ownsHostGestures = shouldOwnHostGestures;
  }

  updateHostGestureOwnership();

  /**
   * Bound primitives use standard subscriptions; custom game adapters receive
   * the existing intent event. Never deliver the same action through both paths.
   * @param {PlatformTouchInputPayload} inputEvent
   */
  function publishTouchInput(inputEvent) {
    if (inputEvent.type === "reset") {
      for (const virtualSource of virtualControlSources.values()) {
        virtualSource.release();
      }
    } else {
      const control = declaredControls.get(inputEvent.controlId);
      const virtualSource = virtualControlSources.get(inputEvent.controlId);
      if (virtualSource && inputEvent.type === "action" && control.type === "button") {
        virtualSource.setHeld(control.platformBinding, inputEvent.active);
        return;
      }
      if (virtualSource && inputEvent.type === "axis" && control.type === "stick") {
        const acceptsHorizontal = control.platformBinding === "horizontal" || control.platformBinding === "directions";
        const acceptsVertical = control.platformBinding === "vertical" || control.platformBinding === "directions";
        virtualSource.setHeld("up", acceptsVertical && inputEvent.y < -PLATFORM_STICK_DIRECTION_THRESHOLD);
        virtualSource.setHeld("down", acceptsVertical && inputEvent.y > PLATFORM_STICK_DIRECTION_THRESHOLD);
        virtualSource.setHeld("left", acceptsHorizontal && inputEvent.x < -PLATFORM_STICK_DIRECTION_THRESHOLD);
        virtualSource.setHeld("right", acceptsHorizontal && inputEvent.x > PLATFORM_STICK_DIRECTION_THRESHOLD);
        return;
      }
    }
    inputWindow.dispatchEvent(new inputWindow.CustomEvent(PLATFORM_TOUCH_INPUT_EVENT, {
      detail: { gameId, ...inputEvent },
    }));
  }

  /** @param {HTMLElement|undefined} controlElement */
  function clearControlFeedback(controlElement) {
    if (!controlElement) {
      return;
    }
    delete controlElement.dataset.pressed;
    controlElement.style.setProperty("--touch-stick-x", "0px");
    controlElement.style.setProperty("--touch-stick-y", "0px");
  }

  /** @param {OwnedTouchPointer} ownedPointer */
  function releaseOwnedTouchPointer(ownedPointer) {
    ownedPointers.delete(ownedPointer.pointerId);
    claimedControls.delete(ownedPointer.control.id);
    clearControlFeedback(ownedPointer.controlElement);
    try {
      if (inputHost.hasPointerCapture?.(ownedPointer.pointerId)) {
        inputHost.releasePointerCapture(ownedPointer.pointerId);
      }
    } catch {
      // Browser cancellation must not interrupt neutralizing this or other owners.
    }

    if (ownedPointer.control.type === "stick") {
      publishTouchInput({ type: "axis", controlId: ownedPointer.control.id, x: 0, y: 0 });
    } else if (ownedPointer.control.type === "button" && ownedPointer.control.behavior !== "press") {
      publishTouchInput({ type: "action", controlId: ownedPointer.control.id, active: false });
    }
  }

  function reset() {
    for (const ownedPointer of ownedPointers.values()) {
      releaseOwnedTouchPointer(ownedPointer);
    }
    for (const controlElement of controlElements.values()) {
      clearControlFeedback(controlElement);
    }
    publishTouchInput({ type: "reset" });
  }

  /** @returns {boolean} */
  function canCaptureTouchInput() {
    return !disposed && !bindingDisabled && element.dataset.active === "true" && !inputDocument.hidden &&
      !inputDocument.querySelector?.(MODAL_INPUT_SELECTOR);
  }

  /** @param {OwnedTouchPointer} ownedPointer @param {PointerEvent} pointerEvent */
  function publishTouchStickPosition(ownedPointer, pointerEvent) {
    const controlBounds = ownedPointer.controlElement?.getBoundingClientRect();
    const radius = controlBounds ? Math.min(controlBounds.width, controlBounds.height) / 2 : 0;
    const axis = radius > 0 ? normalizeAnalogStick(
      (pointerEvent.clientX - controlBounds.left - controlBounds.width / 2) / radius,
      (pointerEvent.clientY - controlBounds.top - controlBounds.height / 2) / radius,
    ) : { x: 0, y: 0 };

    ownedPointer.controlElement?.style.setProperty("--touch-stick-x", `${axis.x * radius * TOUCH_STICK_VISUAL_TRAVEL * 2}px`);
    ownedPointer.controlElement?.style.setProperty("--touch-stick-y", `${axis.y * radius * TOUCH_STICK_VISUAL_TRAVEL * 2}px`);
    publishTouchInput({ type: "axis", controlId: ownedPointer.control.id, ...axis });
  }

  /** @param {PointerEvent} pointerEvent */
  function startTouchPointer(pointerEvent) {
    if (!canCaptureTouchInput()) {
      if (ownedPointers.size > 0) {
        reset();
      }
      return;
    }
    if (pointerEvent.button !== 0 || ownedPointers.has(pointerEvent.pointerId) ||
        !Number.isFinite(pointerEvent.clientX) || !Number.isFinite(pointerEvent.clientY)) {
      return;
    }

    const targetElement = pointerEvent.target?.closest ? pointerEvent.target : pointerEvent.target?.parentElement;
    const targetControlElement = targetElement?.closest?.(TOUCH_CONTROL_SELECTOR);
    const targetControlId = targetControlElement?.dataset.touchControlId;
    let control = controlElements.get(targetControlId) === targetControlElement ? declaredControls.get(targetControlId) : undefined;
    let controlElement = control ? targetControlElement : undefined;

    if (!control || control.type === "look") {
      if (!lookControl || pointerEvent.pointerType === "mouse" || targetElement?.closest?.(INTERACTIVE_INPUT_SELECTOR)) {
        return;
      }
      const hostBounds = inputHost.getBoundingClientRect();
      if (hostBounds.width <= 0 || hostBounds.height <= 0 ||
          pointerEvent.clientX < hostBounds.left + hostBounds.width / 2 ||
          pointerEvent.clientX > hostBounds.left + hostBounds.width ||
          pointerEvent.clientY < hostBounds.top || pointerEvent.clientY > hostBounds.top + hostBounds.height) {
        return;
      }
      control = lookControl;
      controlElement = undefined;
    }
    if (!enabledControlIds.has(control.id) || claimedControls.has(control.id)) {
      return;
    }

    pointerEvent.preventDefault();
    pointerEvent.stopPropagation();
    const ownedPointer = {
      pointerId: pointerEvent.pointerId,
      control,
      controlElement,
      lastX: pointerEvent.clientX,
      lastY: pointerEvent.clientY,
    };
    ownedPointers.set(pointerEvent.pointerId, ownedPointer);
    claimedControls.set(control.id, pointerEvent.pointerId);
    if (controlElement) {
      controlElement.dataset.pressed = "true";
    }
    try {
      inputHost.setPointerCapture?.(pointerEvent.pointerId);
    } catch {
      // A detached/canceled pointer still gets neutralized by global release/reset.
    }

    if (control.type === "stick") {
      publishTouchStickPosition(ownedPointer, pointerEvent);
    } else if (control.type === "button") {
      publishTouchInput({ type: "action", controlId: control.id, active: true });
      if (control.behavior === "press") {
        publishTouchInput({ type: "action", controlId: control.id, active: false });
      }
    }
  }

  /** @param {PointerEvent} pointerEvent */
  function moveTouchPointer(pointerEvent) {
    const ownedPointer = ownedPointers.get(pointerEvent.pointerId);
    if (!ownedPointer) {
      return;
    }
    if (!canCaptureTouchInput()) {
      reset();
      return;
    }
    pointerEvent.preventDefault();
    pointerEvent.stopPropagation();
    if (!Number.isFinite(pointerEvent.clientX) || !Number.isFinite(pointerEvent.clientY)) {
      return;
    }

    if (ownedPointer.control.type === "stick") {
      publishTouchStickPosition(ownedPointer, pointerEvent);
    } else if (ownedPointer.control.type === "look" || ownedPointer.control.behavior === "hold-look") {
      const deltaX = pointerEvent.clientX - ownedPointer.lastX;
      const deltaY = pointerEvent.clientY - ownedPointer.lastY;
      if (deltaX !== 0 || deltaY !== 0) {
        publishTouchInput({ type: "look", controlId: ownedPointer.control.id, deltaX, deltaY });
      }
    }
    ownedPointer.lastX = pointerEvent.clientX;
    ownedPointer.lastY = pointerEvent.clientY;
  }

  /** @param {PointerEvent} pointerEvent */
  function endTouchPointer(pointerEvent) {
    const ownedPointer = ownedPointers.get(pointerEvent.pointerId);
    if (ownedPointer) {
      pointerEvent.preventDefault();
      pointerEvent.stopPropagation();
      releaseOwnedTouchPointer(ownedPointer);
    }
  }

  function resetHiddenTouchInput() {
    if (inputDocument.hidden) {
      reset();
    }
  }

  const hostListeners = [
    ["pointerdown", startTouchPointer], ["pointermove", moveTouchPointer],
    ["pointerup", endTouchPointer], ["pointercancel", endTouchPointer],
    ["lostpointercapture", endTouchPointer],
  ];
  for (const [eventName, listener] of hostListeners) {
    inputHost.addEventListener(eventName, listener, true);
  }
  inputWindow.addEventListener("pointerup", endTouchPointer);
  inputWindow.addEventListener("pointercancel", endTouchPointer);
  inputWindow.addEventListener("blur", reset);
  inputWindow.addEventListener("resize", reset);
  inputDocument.addEventListener("visibilitychange", resetHiddenTouchInput);
  const hostResizeObserver = inputWindow.ResizeObserver ? new inputWindow.ResizeObserver(reset) : null;
  hostResizeObserver?.observe(inputHost);
  reset();

  return {
    reset,
    setDisabled(nextDisabled) {
      bindingDisabled = Boolean(nextDisabled);
      updateHostGestureOwnership();
      if (bindingDisabled) {
        reset();
      }
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      updateHostGestureOwnership();
      reset();
      for (const virtualSource of virtualControlSources.values()) {
        virtualSource.dispose();
      }
      hostResizeObserver?.disconnect();
      for (const [eventName, listener] of hostListeners) {
        inputHost.removeEventListener(eventName, listener, true);
      }
      inputWindow.removeEventListener("pointerup", endTouchPointer);
      inputWindow.removeEventListener("pointercancel", endTouchPointer);
      inputWindow.removeEventListener("blur", reset);
      inputWindow.removeEventListener("resize", reset);
      inputDocument.removeEventListener("visibilitychange", resetHiddenTouchInput);
    },
  };
}
