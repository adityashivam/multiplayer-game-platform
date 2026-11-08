import { getGameControls } from "/platform/frontend-engine/gameDom.js";
import { subscribePlatformTouchInput } from "/platform/frontend-engine/touchControlSurface.js";
import { RIFTBALL_GAME_ID, RIFTBALL_INPUT_TEMPLATE } from "../shared/config.js";
import { createRiftballInputState, projectRiftballMovement } from "./inputState.js";

const MOVEMENT_KEYS = Object.freeze({ left: ["KeyA", "ArrowLeft"], right: ["KeyD", "ArrowRight"], up: ["KeyW", "ArrowUp"], down: ["KeyS", "ArrowDown"] });
const ACTION_KEYS = Object.freeze({ strike: ["KeyE"], dash: ["ShiftLeft", "ShiftRight"], jump: ["Space"], feint: ["KeyQ"] });
const SHELL_ACTIONS = Object.freeze({ a: "strike", b: "dash", x: "jump", y: "feint" });
const GAME_KEYS = new Set([...Object.values(MOVEMENT_KEYS).flat(), ...Object.values(ACTION_KEYS).flat(), "KeyR"]);
const LOOK_SENSITIVITY = 0.005;
const STICK_LOOK_SPEED_RAD_SEC = 1.7;

/**
 * Bind game actions to keyboard, mouse, shell and the customizable touch surface.
 * Input capture stays independent of render FPS. No automatic pointer lock or
 * fullscreen is requested; modals release holds and retain platform shortcuts.
 * @param {{canvas:HTMLCanvasElement,getCameraHeading:()=>number,onActivate?:()=>void}} options
 */
export function createRiftballControls({ canvas, getCameraHeading, onActivate }) {
  const platformControls = getGameControls();
  const inputState = createRiftballInputState();
  const heldKeys = new Set();
  const directions = { up: false, down: false, left: false, right: false };
  const cleanups = [];
  const previousLabel = canvas.getAttribute("aria-label");
  const previousTabIndex = canvas.getAttribute("tabindex");
  const cameraOrbit = { yaw: 0, pitch: 0 };
  let leftStick = { x: 0, y: 0 };
  let rightStick = { x: 0, y: 0 };
  let baseHeading = Math.PI;
  let orbitPointer = null;
  let strikePointerId = null;
  let modalOpen = false;
  let engaged = false;
  let replayBlocked = false;
  let disposed = false;
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", "Riftball Duel. WASD move, E or left mouse charge and release, Shift dash, Space jump, Q feint. Right mouse drag aims, R resets aim.");

  const isBlocked = () => disposed || modalOpen || document.hidden || replayBlocked;
  function listen(target, eventName, listener, options) {
    target.addEventListener(eventName, listener, options);
    cleanups.push(() => target.removeEventListener(eventName, listener, options));
  }

  function reset() {
    heldKeys.clear();
    inputState.reset();
    for (const direction of Object.keys(directions)) directions[direction] = false;
    leftStick = { x: 0, y: 0 };
    rightStick = { x: 0, y: 0 };
    orbitPointer = null;
    strikePointerId = null;
  }

  function activate() {
    if (isBlocked()) return;
    engaged = true;
    canvas.focus({ preventScroll: true });
    onActivate?.();
  }

  function adjustAim(deltaX, deltaY) {
    cameraOrbit.yaw = Math.atan2(Math.sin(cameraOrbit.yaw + deltaX), Math.cos(cameraOrbit.yaw + deltaX));
    cameraOrbit.pitch = Math.max(-0.2, Math.min(0.65, cameraOrbit.pitch + deltaY));
  }

  function synchronizeKeyboard() {
    const pressed = (keys) => keys.some((key) => heldKeys.has(key));
    inputState.setMovement("keyboard", Number(pressed(MOVEMENT_KEYS.right)) - Number(pressed(MOVEMENT_KEYS.left)), Number(pressed(MOVEMENT_KEYS.up)) - Number(pressed(MOVEMENT_KEYS.down)));
    for (const action of /** @type {Array<keyof typeof ACTION_KEYS>} */ (Object.keys(ACTION_KEYS))) {
      inputState.setAction("keyboard", action, pressed(ACTION_KEYS[action]));
    }
  }

  function updateKeyboard(event, active) {
    if (!GAME_KEYS.has(event.code)) return;
    if (!active) {
      heldKeys.delete(event.code);
      synchronizeKeyboard();
      return;
    }
    if (isBlocked() || event.target?.closest?.('input,textarea,select,[contenteditable="true"],[data-stick]')) return;
    if (!engaged && document.activeElement !== canvas) return;
    if (!engaged) activate();
    event.preventDefault();
    if (event.code === "KeyR") {
      cameraOrbit.yaw = 0;
      cameraOrbit.pitch = 0;
    }
    heldKeys.add(event.code);
    synchronizeKeyboard();
  }

  function synchronizeShellMovement() {
    inputState.setMovement("shell", leftStick.x + Number(directions.right) - Number(directions.left), -leftStick.y + Number(directions.up) - Number(directions.down));
  }

  function releasePointer(event) {
    if (strikePointerId === event.pointerId) {
      inputState.setAction("pointer", "strike", false);
      strikePointerId = null;
    }
    if (orbitPointer?.id === event.pointerId) orbitPointer = null;
  }

  listen(window, "keydown", (event) => updateKeyboard(event, true));
  listen(window, "keyup", (event) => updateKeyboard(event, false), { capture: true });
  listen(window, "blur", reset);
  listen(document, "visibilitychange", () => { if (document.hidden) reset(); });
  listen(canvas, "contextmenu", (event) => event.preventDefault());
  listen(canvas, "pointerdown", (event) => {
    if (isBlocked()) return;
    activate();
    if (event.pointerType === "touch") return;
    canvas.setPointerCapture(event.pointerId);
    if (event.button === 0) {
      strikePointerId = event.pointerId;
      inputState.setAction("pointer", "strike", true);
    } else if (event.button === 2) {
      orbitPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    }
  });
  listen(canvas, "pointermove", (event) => {
    if (isBlocked() || orbitPointer?.id !== event.pointerId) return;
    adjustAim(-(event.clientX - orbitPointer.x) * LOOK_SENSITIVITY, (event.clientY - orbitPointer.y) * LOOK_SENSITIVITY);
    orbitPointer.x = event.clientX;
    orbitPointer.y = event.clientY;
  });
  listen(canvas, "pointerup", releasePointer);
  listen(canvas, "pointercancel", releasePointer);
  listen(canvas, "lostpointercapture", releasePointer);

  for (const direction of /** @type {Array<keyof typeof directions>} */ (Object.keys(directions))) {
    cleanups.push(platformControls.dpad[direction].onHold(() => {
      if (isBlocked()) return;
      activate();
      directions[direction] = true;
      synchronizeShellMovement();
    }, () => {
      directions[direction] = false;
      synchronizeShellMovement();
    }));
  }
  for (const [button, action] of Object.entries(SHELL_ACTIONS)) {
    cleanups.push(platformControls.actions[button].onHold(() => {
      if (isBlocked()) return;
      activate();
      inputState.setAction("shell", action, true);
    }, () => inputState.setAction("shell", action, false)));
  }
  cleanups.push(platformControls.sticks.left.onChange((stick) => {
    if (isBlocked()) return;
    leftStick = stick;
    if (Math.hypot(stick.x, stick.y) > 0) activate();
    synchronizeShellMovement();
  }));
  cleanups.push(platformControls.sticks.right.onChange((stick) => {
    if (isBlocked()) return;
    rightStick = stick;
    if (Math.hypot(stick.x, stick.y) > 0) activate();
  }));
  cleanups.push(subscribePlatformTouchInput(RIFTBALL_GAME_ID, (touchInput) => {
    if (touchInput.type === "reset") {
      inputState.resetSource("touch");
      return;
    }
    if (isBlocked()) return;
    activate();
    if (touchInput.type === "axis" && touchInput.controlId === "move") {
      inputState.setMovement("touch", touchInput.x, -touchInput.y);
    } else if (touchInput.type === "look") {
      adjustAim(-touchInput.deltaX * LOOK_SENSITIVITY, touchInput.deltaY * LOOK_SENSITIVITY);
    } else if (touchInput.type === "action" && Object.hasOwn(ACTION_KEYS, touchInput.controlId)) {
      inputState.setAction("touch", touchInput.controlId, touchInput.active);
    }
  }));

  function synchronizeModalState() {
    const nextModalOpen = Boolean(document.querySelector('[aria-modal="true"], dialog[open]'));
    if (nextModalOpen && !modalOpen) reset();
    modalOpen = nextModalOpen;
  }
  const modalObserver = new MutationObserver(synchronizeModalState);
  modalObserver.observe(document.getElementById("game-view") || document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-modal", "open"] });
  synchronizeModalState();

  return {
    activate, reset, isBlocked,
    isEngaged: () => engaged,
    setPlayerId: (playerId) => { baseHeading = playerId === "p2" ? 0 : Math.PI; },
    getCameraOrbit: () => ({ ...cameraOrbit }),
    setReplayBlocked(blocked) { replayBlocked = blocked; if (blocked) reset(); },
    advance(dtSec) {
      if (isBlocked()) return;
      const safeDtSec = Math.max(0, Math.min(0.05, dtSec));
      adjustAim(-rightStick.x * STICK_LOOK_SPEED_RAD_SEC * safeDtSec, rightStick.y * safeDtSec);
    },
    capture() {
      if (isBlocked()) return { ...RIFTBALL_INPUT_TEMPLATE };
      const captured = inputState.capture();
      const heading = getCameraHeading();
      const movement = projectRiftballMovement(captured, Number.isFinite(heading) ? heading : baseHeading);
      const aimHeading = baseHeading + cameraOrbit.yaw;
      return { ...captured, ...movement, aimX: Math.sin(aimHeading), aimZ: Math.cos(aimHeading) };
    },
    dispose() {
      if (disposed) return;
      reset();
      disposed = true;
      modalObserver.disconnect();
      cleanups.forEach((cleanup) => cleanup());
      if (previousLabel === null) canvas.removeAttribute("aria-label");
      else canvas.setAttribute("aria-label", previousLabel);
      if (previousTabIndex === null) canvas.removeAttribute("tabindex");
      else canvas.setAttribute("tabindex", previousTabIndex);
    },
  };
}
