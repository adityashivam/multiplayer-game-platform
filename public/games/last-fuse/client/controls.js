import { getGameControls } from "/platform/frontend-engine/gameDom.js";
import { subscribePlatformTouchInput } from "/platform/frontend-engine/touchControlSurface.js";
import { LAST_FUSE_INPUT_TEMPLATE } from "../shared/config.js";
import { createLastFuseInputState, projectLastFuseMovement } from "./inputState.js";

const MOVEMENT_KEYS = Object.freeze({
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  up: ["KeyW", "ArrowUp"],
  down: ["KeyS", "ArrowDown"],
});
const ACTION_KEYS = Object.freeze({
  jump: ["Space", "KeyK"],
  dash: ["ShiftLeft", "ShiftRight", "KeyJ"],
});
const CAMERA_KEYS = Object.freeze({ left: ["KeyQ"], right: ["KeyE"] });
const SHELL_ACTIONS = Object.freeze({ a: "jump", b: "dash" });
const MOVEMENT_KEY_CODES = new Set(Object.values(MOVEMENT_KEYS).flat());
const GAME_KEYS = new Set([...MOVEMENT_KEY_CODES, ...Object.values(ACTION_KEYS).flat(), ...Object.values(CAMERA_KEYS).flat()]);
const MODAL_SELECTOR = '[aria-modal="true"], dialog[open]';

/**
 * Bind running, jumping, dashing and camera turns to keyboard, the console
 * shell and the platform touch surface. Capture runs at the fixed simulation
 * cadence; modals release every hold.
 * @param {object} options
 * @param {HTMLCanvasElement} options.canvas
 * @param {string} options.gameId Registered ID used by the touch surface.
 * @param {()=>number} options.getCameraHeading
 * @param {(direction:-1|1)=>void} options.onTurnCamera
 * @param {()=>void} [options.onActivate]
 */
export function createLastFuseControls({ canvas, gameId, getCameraHeading, onTurnCamera, onActivate }) {
  const platformControls = getGameControls();
  const inputState = createLastFuseInputState();
  const heldKeys = new Set();
  const directions = { up: false, down: false, left: false, right: false };
  const cleanups = [];
  const previousLabel = canvas.getAttribute("aria-label");
  const previousTabIndex = canvas.getAttribute("tabindex");
  let leftStick = { x: 0, y: 0 };
  let modalOpen = false;
  let engaged = false;
  let disposed = false;
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", "Last Fuse. WASD or arrows run, Space or K jumps, Shift or J dashes, Q and E turn the camera. Touch a runner while holding the bomb to pass it.");

  const isBlocked = () => disposed || modalOpen || document.hidden;
  function listen(target, eventName, listener, listenerOptions) {
    target.addEventListener(eventName, listener, listenerOptions);
    cleanups.push(() => target.removeEventListener(eventName, listener, listenerOptions));
  }

  function reset() {
    heldKeys.clear();
    inputState.reset();
    for (const direction of Object.keys(directions)) directions[direction] = false;
    leftStick = { x: 0, y: 0 };
  }

  function activate() {
    if (isBlocked()) return;
    engaged = true;
    canvas.focus({ preventScroll: true });
    onActivate?.();
  }

  function synchronizeKeyboard() {
    const pressed = (keys) => keys.some((key) => heldKeys.has(key));
    inputState.setMovement("keyboard",
      Number(pressed(MOVEMENT_KEYS.right)) - Number(pressed(MOVEMENT_KEYS.left)),
      Number(pressed(MOVEMENT_KEYS.up)) - Number(pressed(MOVEMENT_KEYS.down)));
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
    if (!event.repeat && CAMERA_KEYS.left.includes(event.code)) onTurnCamera(-1);
    if (!event.repeat && CAMERA_KEYS.right.includes(event.code)) onTurnCamera(1);
    heldKeys.add(event.code);
    synchronizeKeyboard();
  }

  function synchronizeShellMovement() {
    inputState.setMovement("shell",
      leftStick.x + Number(directions.right) - Number(directions.left),
      -leftStick.y + Number(directions.up) - Number(directions.down));
  }

  listen(window, "keydown", (event) => updateKeyboard(event, true));
  listen(window, "keyup", (event) => updateKeyboard(event, false), { capture: true });
  listen(window, "blur", reset);
  listen(document, "visibilitychange", () => { if (document.hidden) reset(); });
  listen(canvas, "pointerdown", () => { if (!isBlocked()) activate(); });

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
  cleanups.push(subscribePlatformTouchInput(gameId, (touchInput) => {
    if (touchInput.type === "reset") {
      inputState.resetSource("touch");
      return;
    }
    if (isBlocked()) return;
    activate();
    if (touchInput.type === "axis" && touchInput.controlId === "move") {
      inputState.setMovement("touch", touchInput.x, -touchInput.y);
    } else if (touchInput.type === "action" && Object.hasOwn(ACTION_KEYS, touchInput.controlId)) {
      inputState.setAction("touch", touchInput.controlId, touchInput.active);
    }
  }));

  function synchronizeModalState() {
    const nextModalOpen = Boolean(document.querySelector(MODAL_SELECTOR));
    if (nextModalOpen && !modalOpen) reset();
    modalOpen = nextModalOpen;
  }
  const modalObserver = new MutationObserver(synchronizeModalState);
  modalObserver.observe(document.getElementById("game-view") || document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["aria-modal", "open"],
  });
  synchronizeModalState();

  return {
    activate,
    reset,
    isBlocked,
    isEngaged: () => engaged,
    /**
     * @param {number} viewLagTicks How far behind authority this runner sees rivals.
     * @returns {import("../shared/config.js").LastFuseInputState}
     */
    capture(viewLagTicks) {
      if (isBlocked()) return { ...LAST_FUSE_INPUT_TEMPLATE, viewLagTicks };
      const captured = inputState.capture();
      return { ...captured, ...projectLastFuseMovement(captured, getCameraHeading()), viewLagTicks };
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
