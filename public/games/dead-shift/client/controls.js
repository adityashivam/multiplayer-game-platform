import { getGameControls } from "/platform/frontend-engine/gameDom.js";
import { createInputLatch } from "/platform/frontend-engine/inputTimeline.js";
import { isPlatformTouchControlsActive, subscribePlatformTouchInput } from "/platform/frontend-engine/touchControlSurface.js";
import {
  DEAD_SHIFT_EDGE_KEYS,
  DEAD_SHIFT_GAME_ID,
  DEAD_SHIFT_INPUT_TEMPLATE,
  DEAD_SHIFT_NUMERIC_INPUTS,
} from "../shared/config.js";
import { normalizeDeadShiftMovement, rotateDeadShiftAim } from "./inputMath.js";

/** @typedef {"fire" | "reload" | "jump" | "aim"} DeadShiftHeldAction */
/** @typedef {"keyboard" | "mouse" | "controller" | "touch"} DeadShiftInputSource */
/** @typedef {import("../../../platform/frontend-engine/touchControlSurface.js").PlatformTouchInput} DeadShiftPlatformTouchEvent */

const POINTER_SENSITIVITY = 0.0022;
const TOUCH_SENSITIVITY = 0.004;
const STICK_TURN_RATE_RAD_SEC = 2.3;
const MAX_AIM_FRAME_SEC = 0.05;
const WEAPON_COUNT = 5;
const TOUCH_LOOK_CONTROL_IDS = new Set(["look", "fire", "aim"]);
const TOUCH_HELD_ACTION_IDS = new Set(["fire", "reload", "jump", "aim"]);
const GAME_KEY_CODES = new Set([
  "KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "ShiftLeft", "ShiftRight", "Space", "KeyR", "KeyQ", "KeyE", "KeyG",
  "Digit1", "Digit2", "Digit3", "Digit4", "Digit5",
]);

/**
 * Own local control bindings; network capture consumes the SDK's bounded action latch.
 * @param {{canvas: HTMLCanvasElement, onActivate?: () => void}} options
 * @returns {object} Capture, aiming, selection, engagement, and disposal operations.
 */
export function createDeadShiftControls({ canvas, onActivate }) {
  const previousCanvasTabIndex = canvas.tabIndex;
  const previousCanvasLabel = canvas.getAttribute("aria-label");
  const platformControls = getGameControls();
  const inputLatch = createInputLatch(DEAD_SHIFT_INPUT_TEMPLATE, {
    edgeKeys: DEAD_SHIFT_EDGE_KEYS,
    numericInputs: DEAD_SHIFT_NUMERIC_INPUTS,
  });
  const touchActionLatch = createInputLatch({ fire: false, reload: false, jump: false }, {
    edgeKeys: DEAD_SHIFT_EDGE_KEYS,
  });
  const heldKeys = new Set();
  /** @type {Record<DeadShiftHeldAction, Set<DeadShiftInputSource>>} */
  const heldActionSources = { fire: new Set(), reload: new Set(), jump: new Set(), aim: new Set() };
  const controllerDirections = { up: false, down: false, left: false, right: false };
  const cleanups = [];
  let aim = { yaw: 0, pitch: 0 };
  let weapon = 0;
  let leftStick = { x: 0, y: 0 };
  let touchMovement = { x: 0, y: 0 };
  let rightStick = { x: 0, y: 0 };
  let engaged = false;
  let disposed = false;
  let touchAim = null;
  let modalOpen = false;
  let touchWeaponHeld = false;

  function isBlocked() {
    return disposed || document.hidden || modalOpen;
  }

  function listen(target, eventName, listener, options) {
    target.addEventListener(eventName, listener, options);
    cleanups.push(() => target.removeEventListener(eventName, listener, options));
  }

  /**
   * Keep device holds independent. Touch uses a separate SDK latch so surface
   * resets can discard its pending presses without consuming another device's.
   * ADS is local presentation state and never enters either input latch.
   * @param {DeadShiftHeldAction} action
   * @param {DeadShiftInputSource} source
   * @param {boolean} active
   */
  function setHeldAction(action, source, active) {
    const actionSources = heldActionSources[action];
    if (active) actionSources.add(source);
    else actionSources.delete(source);
    if (action === "aim") return;
    if (source === "touch") {
      touchActionLatch.set(action, active);
    } else {
      inputLatch.set(action, actionSources.has("keyboard") || actionSources.has("mouse") || actionSources.has("controller"));
    }
  }

  /** A surface reset releases only its touch holds and unconsumed touch presses. */
  function resetPlatformTouchInput() {
    touchMovement = { x: 0, y: 0 };
    touchWeaponHeld = false;
    touchAim = null;
    touchActionLatch.reset();
    for (const actionSources of Object.values(heldActionSources)) actionSources.delete("touch");
  }

  /** Clear held actions without moving the camera or changing the selected weapon. */
  function reset() {
    heldKeys.clear();
    inputLatch.reset();
    resetPlatformTouchInput();
    for (const actionSources of Object.values(heldActionSources)) actionSources.clear();
    for (const direction of Object.keys(controllerDirections)) controllerDirections[direction] = false;
    leftStick = { x: 0, y: 0 };
    rightStick = { x: 0, y: 0 };
    touchAim = null;
  }

  function synchronizeModalState() {
    const nextModalOpen = Boolean(document.querySelector('[aria-modal="true"], dialog[open]'));
    if (nextModalOpen && !modalOpen) {
      reset();
      if (document.pointerLockElement === canvas) document.exitPointerLock();
    }
    modalOpen = nextModalOpen;
  }

  /** Capture the mouse only after an explicit player gesture. */
  function activate() {
    if (isBlocked()) return;
    engaged = true;
    onActivate?.();
    canvas.focus({ preventScroll: true });
    if (!window.matchMedia("(pointer: coarse)").matches && canvas.requestPointerLock) {
      try {
        const lockRequest = canvas.requestPointerLock();
        lockRequest?.catch?.(() => {});
      } catch {
        // The player can use the analog controls if pointer capture is unavailable.
      }
    }
  }

  function selectWeapon(weaponIndex) {
    if (Number.isInteger(weaponIndex) && weaponIndex >= 0 && weaponIndex < WEAPON_COUNT) weapon = weaponIndex;
  }

  function cycleWeapon(direction) {
    selectWeapon((weapon + direction + WEAPON_COUNT) % WEAPON_COUNT);
  }

  function updateKeyboardInput(event, active) {
    if (!GAME_KEY_CODES.has(event.code)) return;
    if (!active) {
      heldKeys.delete(event.code);
      if (event.code === "Space") setHeldAction("jump", "keyboard", false);
      if (event.code === "KeyR") setHeldAction("reload", "keyboard", false);
      return;
    }
    const target = event.target;
    if (isBlocked() || target?.closest?.('input,textarea,select,[contenteditable="true"],[data-stick]')) return;
    if (!engaged && document.activeElement !== canvas) return;
    event.preventDefault();

    heldKeys.add(event.code);
    if (event.code === "Space") setHeldAction("jump", "keyboard", active);
    if (event.code === "KeyR") setHeldAction("reload", "keyboard", active);
    if (!active || event.repeat) return;
    if (event.code.startsWith("Digit")) selectWeapon(Number(event.code.slice(-1)) - 1);
    if (event.code === "KeyQ") cycleWeapon(-1);
    if (event.code === "KeyE") cycleWeapon(1);
    if (event.code === "KeyG") selectWeapon(3);
  }

  listen(window, "keydown", (event) => updateKeyboardInput(event, true));
  listen(window, "keyup", (event) => updateKeyboardInput(event, false), { capture: true });
  listen(window, "blur", reset);
  listen(document, "visibilitychange", () => { if (document.hidden) reset(); });
  listen(document, "pointerlockchange", () => {
    if (document.pointerLockElement !== canvas) {
      setHeldAction("fire", "mouse", false);
      setHeldAction("aim", "mouse", false);
    }
  });
  listen(document, "mousemove", (event) => {
    if (document.pointerLockElement === canvas && !isBlocked()) {
      aim = rotateDeadShiftAim(aim, event.movementX, event.movementY, POINTER_SENSITIVITY);
    }
  });
  /**
   * Mouse Events retain additional button presses while a pointer is already down.
   * @param {MouseEvent} event
   */
  function recordMouseButtonPress(event) {
    if (isBlocked() || document.pointerLockElement !== canvas) return;
    if (event.button === 0 || event.button === 2) {
      setHeldAction(event.button === 0 ? "fire" : "aim", "mouse", true);
    }
  }
  listen(canvas, "mousedown", recordMouseButtonPress);
  listen(canvas, "pointerdown", (event) => {
    if (isBlocked()) return;
    if (event.pointerType === "touch") {
      if (isPlatformTouchControlsActive(DEAD_SHIFT_GAME_ID)) {
        touchAim = null;
        return;
      }
      engaged = true;
      onActivate?.();
      const bounds = canvas.getBoundingClientRect();
      if (!touchAim && event.clientX > bounds.left + bounds.width * 0.4) {
        touchAim = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
        canvas.setPointerCapture(event.pointerId);
      }
    } else if (document.pointerLockElement === canvas && (event.button === 0 || event.button === 2)) {
      recordMouseButtonPress(event);
    } else {
      activate();
    }
  });
  listen(canvas, "pointermove", (event) => {
    if (isPlatformTouchControlsActive(DEAD_SHIFT_GAME_ID)) {
      touchAim = null;
      return;
    }
    if (!touchAim || touchAim.pointerId !== event.pointerId || isBlocked()) return;
    aim = rotateDeadShiftAim(aim, event.clientX - touchAim.x, event.clientY - touchAim.y, TOUCH_SENSITIVITY);
    touchAim.x = event.clientX;
    touchAim.y = event.clientY;
  });
  function releasePointer(event) {
    if (event.pointerType !== "touch") {
      if (event.button === 0 || event.type === "pointercancel" || event.type === "lostpointercapture") setHeldAction("fire", "mouse", false);
      if (event.button === 2 || event.type === "pointercancel" || event.type === "lostpointercapture") setHeldAction("aim", "mouse", false);
    }
    if (touchAim?.pointerId === event.pointerId) touchAim = null;
  }
  listen(window, "pointerup", releasePointer);
  listen(window, "pointercancel", releasePointer);
  listen(window, "mouseup", releasePointer);
  listen(canvas, "lostpointercapture", releasePointer);
  listen(canvas, "contextmenu", (event) => event.preventDefault());
  listen(canvas, "wheel", (event) => {
    if (isBlocked() || !engaged) return;
    event.preventDefault();
    cycleWeapon(event.deltaY > 0 ? 1 : -1);
  }, { passive: false });

  for (const direction of ["up", "down", "left", "right"]) {
    cleanups.push(platformControls.dpad[direction].onHold(
      () => { if (!isBlocked()) { engaged = true; controllerDirections[direction] = true; onActivate?.(); } },
      () => { controllerDirections[direction] = false; },
    ));
  }
  for (const [button, action] of [["a", "fire"], ["x", "reload"], ["y", "jump"]]) {
    cleanups.push(platformControls.actions[button].onHold(
      () => { if (!isBlocked()) { engaged = true; setHeldAction(action, "controller", true); onActivate?.(); } },
      () => setHeldAction(action, "controller", false),
    ));
  }
  cleanups.push(platformControls.actions.b.onPress(() => { if (!isBlocked()) cycleWeapon(1); }));
  cleanups.push(platformControls.sticks.left.onChange((axes) => {
    if (!isBlocked()) { engaged = true; leftStick = axes; onActivate?.(); }
  }));
  cleanups.push(platformControls.sticks.right.onChange((axes) => {
    if (!isBlocked()) { engaged = true; rightStick = axes; onActivate?.(); }
  }));

  /**
   * Map game-owned control IDs into existing input and immediate camera motion.
   * The platform surface retains pointer ownership and gesture recognition.
   * @param {DeadShiftPlatformTouchEvent} touchEvent
   */
  function recordPlatformTouchInput(touchEvent) {
    if (touchEvent.type === "reset") {
      resetPlatformTouchInput();
      return;
    }
    if (isBlocked()) return;

    if (touchEvent.type === "axis" && touchEvent.controlId === "move") {
      touchMovement = { x: touchEvent.x, y: touchEvent.y };
    } else if (touchEvent.type === "look" && TOUCH_LOOK_CONTROL_IDS.has(touchEvent.controlId)) {
      aim = rotateDeadShiftAim(aim, touchEvent.deltaX, touchEvent.deltaY, TOUCH_SENSITIVITY);
    } else if (touchEvent.type === "action") {
      if (TOUCH_HELD_ACTION_IDS.has(touchEvent.controlId)) {
        setHeldAction(/** @type {DeadShiftHeldAction} */ (touchEvent.controlId), "touch", touchEvent.active);
      } else if (touchEvent.controlId === "weapon") {
        if (touchEvent.active && !touchWeaponHeld) cycleWeapon(1);
        touchWeaponHeld = touchEvent.active;
      } else {
        return;
      }
      if (!touchEvent.active) return;
    } else {
      return;
    }

    engaged = true;
    onActivate?.();
  }
  cleanups.push(subscribePlatformTouchInput(DEAD_SHIFT_GAME_ID, recordPlatformTouchInput));

  const modalObserver = new MutationObserver(synchronizeModalState);
  modalObserver.observe(document.getElementById("game-view") || document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-modal", "open"],
  });
  synchronizeModalState();
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", "Dead Shift arena. WASD moves, mouse or right stick aims, left click or A fires.");

  return {
    activate,
    selectWeapon,
    reset,
    isBlocked,
    isEngaged: () => engaged,
    isAiming: () => !isBlocked() && heldActionSources.aim.size > 0,
    getAim: () => ({ ...aim }),
    getWeapon: () => weapon,
    /** @param {number} dtSec Render duration; stick turn speed is frame-rate independent. */
    advance(dtSec) {
      if (!isBlocked()) aim = rotateDeadShiftAim(aim, rightStick.x, rightStick.y, STICK_TURN_RATE_RAD_SEC * Math.min(MAX_AIM_FRAME_SEC, dtSec));
    },
    capture() {
      const blocked = isBlocked();
      if (blocked) reset();
      const movement = normalizeDeadShiftMovement({
        keyboardX: Number(heldKeys.has("KeyD") || heldKeys.has("ArrowRight") || controllerDirections.right) - Number(heldKeys.has("KeyA") || heldKeys.has("ArrowLeft") || controllerDirections.left),
        keyboardZ: Number(heldKeys.has("KeyW") || heldKeys.has("ArrowUp") || controllerDirections.up) - Number(heldKeys.has("KeyS") || heldKeys.has("ArrowDown") || controllerDirections.down),
        stickX: leftStick.x + touchMovement.x,
        stickY: leftStick.y + touchMovement.y,
      });
      inputLatch.set("moveX", movement.moveX);
      inputLatch.set("moveZ", movement.moveZ);
      inputLatch.set("yaw", aim.yaw);
      inputLatch.set("pitch", aim.pitch);
      inputLatch.set("weapon", weapon);
      inputLatch.set("sprint", heldKeys.has("ShiftLeft") || heldKeys.has("ShiftRight"));
      const capturedInput = inputLatch.capture();
      const touchActions = touchActionLatch.capture();
      for (const action of DEAD_SHIFT_EDGE_KEYS) capturedInput[action] ||= touchActions[action];
      return capturedInput;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      reset();
      modalObserver.disconnect();
      cleanups.forEach((cleanup) => cleanup());
      if (document.pointerLockElement === canvas) document.exitPointerLock();
      canvas.tabIndex = previousCanvasTabIndex;
      if (previousCanvasLabel === null) canvas.removeAttribute("aria-label");
      else canvas.setAttribute("aria-label", previousCanvasLabel);
    },
  };
}
