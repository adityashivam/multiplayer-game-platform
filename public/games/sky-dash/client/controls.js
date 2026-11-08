import { getGameControls } from "/platform/frontend-engine/gameDom.js";
import { subscribePlatformTouchInput } from "/platform/frontend-engine/touchControlSurface.js";
import { SKY_DASH_GAME_ID, SKY_DASH_INPUT_TEMPLATE } from "../shared/config.js";
import { createSkyDashInputState } from "./inputState.js";

const MOVEMENT_KEYS = Object.freeze({ left: ["KeyA", "ArrowLeft"], right: ["KeyD", "ArrowRight"], up: ["KeyW", "ArrowUp"], down: ["KeyS", "ArrowDown"] });
const ACTION_KEYS = Object.freeze({ jump: ["Space"], dash: ["ShiftLeft", "ShiftRight"], dive: ["KeyE", "KeyX"] });
const GAME_KEYS = new Set([...Object.values(MOVEMENT_KEYS).flat(), ...Object.values(ACTION_KEYS).flat(), "KeyR"]);
const CAMERA_RETURN_RATE = 3.5;

/**
 * Bind keyboard, standard console controls and the generic platform touch surface.
 * Camera orbit is presentation-only; it never alters the authoritative input shape.
 * @param {{canvas:HTMLCanvasElement,onActivate?:()=>void}} options
 */
export function createSkyDashControls({ canvas, onActivate }) {
  const platformControls = getGameControls();
  const inputState = createSkyDashInputState();
  const heldKeys = new Set();
  const directions = { up: false, down: false, left: false, right: false };
  const cleanups = [];
  const previousLabel = canvas.getAttribute("aria-label");
  const previousTabIndex = canvas.getAttribute("tabindex");
  let leftStick = { x: 0, y: 0 };
  let rightStick = { x: 0, y: 0 };
  let cameraOrbit = 0;
  let modalOpen = false;
  let engaged = false;
  let disposed = false;
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", "Sky Dash obstacle race. WASD to move, Space to jump, Shift to dash, E to dive.");

  const isBlocked = () => disposed || modalOpen || document.hidden;
  const listen = (target, eventName, listener, options) => {
    target.addEventListener(eventName, listener, options);
    cleanups.push(() => target.removeEventListener(eventName, listener, options));
  };

  function reset() {
    heldKeys.clear();
    inputState.reset();
    for (const direction of Object.keys(directions)) directions[direction] = false;
    leftStick = { x: 0, y: 0 };
    rightStick = { x: 0, y: 0 };
  }

  function activate() {
    if (isBlocked()) return;
    engaged = true;
    canvas.focus({ preventScroll: true });
    onActivate?.();
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
    if (event.code === "KeyR") cameraOrbit = 0;
    heldKeys.add(event.code);
    synchronizeKeyboard();
  }

  function synchronizeShellMovement() {
    inputState.setMovement("shell", leftStick.x + Number(directions.right) - Number(directions.left), -leftStick.y + Number(directions.up) - Number(directions.down));
  }

  listen(window, "keydown", (event) => updateKeyboard(event, true));
  listen(window, "keyup", (event) => updateKeyboard(event, false), { capture: true });
  listen(window, "blur", reset);
  listen(document, "visibilitychange", () => { if (document.hidden) reset(); });
  listen(canvas, "pointerdown", activate);

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
  const shellActions = { a: "jump", b: "dash", x: "dive" };
  for (const [button, action] of Object.entries(shellActions)) {
    cleanups.push(platformControls.actions[button].onHold(() => {
      if (isBlocked()) return;
      activate();
      inputState.setAction("shell", action, true);
    }, () => inputState.setAction("shell", action, false)));
  }
  cleanups.push(platformControls.actions.y.onPress(() => { if (!isBlocked()) cameraOrbit = 0; }));
  cleanups.push(platformControls.sticks.left.onChange((stick) => {
    if (isBlocked()) return;
    leftStick = stick;
    if (Math.hypot(stick.x, stick.y) > 0) activate();
    synchronizeShellMovement();
  }));
  cleanups.push(platformControls.sticks.right.onChange((stick) => { if (!isBlocked()) rightStick = stick; }));
  cleanups.push(subscribePlatformTouchInput(SKY_DASH_GAME_ID, (touchInput) => {
    if (touchInput.type === "reset") {
      inputState.resetSource("touch");
      return;
    }
    if (isBlocked()) return;
    if (touchInput.type === "axis" && touchInput.controlId === "move") {
      activate();
      inputState.setMovement("touch", touchInput.x, -touchInput.y);
    } else if (touchInput.type === "action" && Object.hasOwn(ACTION_KEYS, touchInput.controlId)) {
      activate();
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
    getCameraOrbit: () => cameraOrbit,
    advance(dtSec) {
      if (isBlocked()) return;
      const safeDtSec = Math.max(0, Math.min(0.05, dtSec));
      cameraOrbit = Math.max(-0.55, Math.min(0.55, cameraOrbit + rightStick.x * safeDtSec));
      if (Math.abs(rightStick.x) < 0.01) cameraOrbit *= Math.exp(-CAMERA_RETURN_RATE * safeDtSec);
    },
    capture: () => isBlocked() ? { ...SKY_DASH_INPUT_TEMPLATE } : inputState.capture(),
    dispose() {
      if (disposed) return;
      disposed = true;
      reset();
      modalObserver.disconnect();
      cleanups.forEach((cleanup) => cleanup());
      if (previousLabel === null) canvas.removeAttribute("aria-label");
      else canvas.setAttribute("aria-label", previousLabel);
      if (previousTabIndex === null) canvas.removeAttribute("tabindex");
      else canvas.setAttribute("tabindex", previousTabIndex);
    },
  };
}
