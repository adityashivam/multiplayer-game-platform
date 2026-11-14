import { getGameControls } from "/platform/frontend-engine/gameDom.js";
import { subscribePlatformTouchInput } from "/platform/frontend-engine/touchControlSurface.js";
import { EDGEOUT_INPUT_TEMPLATE } from "../shared/config.js";
import { createEdgeoutInputState, projectEdgeoutMovement } from "./inputState.js";

const MOVEMENT_KEYS = Object.freeze({
  left: ["KeyA", "ArrowLeft"],
  right: ["KeyD", "ArrowRight"],
  up: ["KeyW", "ArrowUp"],
  down: ["KeyS", "ArrowDown"],
});
const ACTION_KEYS = Object.freeze({
  shove: ["Space", "KeyJ"],
  dash: ["ShiftLeft", "ShiftRight", "KeyL"],
  block: ["KeyE", "KeyK"],
});
const SHELL_ACTIONS = Object.freeze({ a: "shove", b: "dash", x: "block" });
const MOVEMENT_KEY_CODES = new Set(Object.values(MOVEMENT_KEYS).flat());
const GAME_KEYS = new Set([...MOVEMENT_KEY_CODES, ...Object.values(ACTION_KEYS).flat()]);
const MOUSE_AIM_DEADZONE = 0.35;
const MODAL_SELECTOR = '[aria-modal="true"], dialog[open]';

/**
 * Bind Edgeout actions to keyboard, mouse, the console shell and the platform
 * touch surface. Capture runs at the fixed simulation cadence. Moving the
 * mouse aims at the floor point under it; any keyboard, shell or stick
 * movement hands aim back to the movement direction until the mouse moves.
 * No pointer lock or fullscreen is requested; modals release every hold.
 * @param {object} options
 * @param {HTMLCanvasElement} options.canvas
 * @param {string} options.gameId Registered ID used by the touch surface.
 * @param {()=>number} options.getCameraHeading
 * @param {(clientX:number,clientY:number)=>{x:number,z:number}|null} options.projectPointerToGround
 * @param {()=>{x:number,z:number}|null} options.getLocalFighterPosition
 * @param {()=>void} [options.onActivate]
 */
export function createEdgeoutControls({ canvas, gameId, getCameraHeading, projectPointerToGround, getLocalFighterPosition, onActivate }) {
  const platformControls = getGameControls();
  const inputState = createEdgeoutInputState();
  const heldKeys = new Set();
  const directions = { up: false, down: false, left: false, right: false };
  const cleanups = [];
  const previousLabel = canvas.getAttribute("aria-label");
  const previousTabIndex = canvas.getAttribute("tabindex");
  /** @type {{clientX:number,clientY:number}|null} */
  let mousePointer = null;
  let leftStick = { x: 0, y: 0 };
  let modalOpen = false;
  let engaged = false;
  let disposed = false;
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", "Edgeout. WASD or arrows move, mouse aims. Space, J or left mouse: hold to charge a shove, release to shove. Shift or L: dash. E, K or right mouse: block; block just before a shove lands to parry.");

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
    if (MOVEMENT_KEY_CODES.has(event.code)) mousePointer = null;
    heldKeys.add(event.code);
    synchronizeKeyboard();
  }

  function synchronizeShellMovement() {
    mousePointer = null;
    inputState.setMovement("shell",
      leftStick.x + Number(directions.right) - Number(directions.left),
      -leftStick.y + Number(directions.up) - Number(directions.down));
  }

  /** @param {PointerEvent} event */
  function releasePointerButtons(event) {
    if (event.pointerType === "touch") return;
    inputState.setAction("pointer", "shove", false);
    inputState.setAction("pointer", "block", false);
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
    if (event.button === 0) inputState.setAction("pointer", "shove", true);
    else if (event.button === 2) inputState.setAction("pointer", "block", true);
  });
  listen(canvas, "pointermove", (event) => {
    if (event.pointerType === "touch" || (event.movementX === 0 && event.movementY === 0)) return;
    mousePointer = { clientX: event.clientX, clientY: event.clientY };
  });
  listen(canvas, "pointerleave", (event) => {
    if (event.pointerType !== "touch" && !canvas.hasPointerCapture(event.pointerId)) mousePointer = null;
  });
  listen(canvas, "pointerup", (event) => {
    if (event.pointerType === "touch") return;
    if (event.button === 0) inputState.setAction("pointer", "shove", false);
    else if (event.button === 2) inputState.setAction("pointer", "block", false);
  });
  listen(canvas, "pointercancel", releasePointerButtons);
  listen(canvas, "lostpointercapture", releasePointerButtons);

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
      mousePointer = null;
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

  /** World-space aim from the mouse, or zero so the fighter faces its movement. */
  function captureMouseAim() {
    if (!mousePointer) return { aimX: 0, aimZ: 0 };
    const floorPoint = projectPointerToGround(mousePointer.clientX, mousePointer.clientY);
    const fighterPosition = getLocalFighterPosition();
    if (!floorPoint || !fighterPosition) return { aimX: 0, aimZ: 0 };
    const offsetX = floorPoint.x - fighterPosition.x;
    const offsetZ = floorPoint.z - fighterPosition.z;
    const distance = Math.hypot(offsetX, offsetZ);
    if (distance < MOUSE_AIM_DEADZONE) return { aimX: 0, aimZ: 0 };
    return { aimX: offsetX / distance, aimZ: offsetZ / distance };
  }

  return {
    activate,
    reset,
    isBlocked,
    isEngaged: () => engaged,
    capture() {
      if (isBlocked()) return { ...EDGEOUT_INPUT_TEMPLATE };
      const captured = inputState.capture();
      const movement = projectEdgeoutMovement(captured, getCameraHeading());
      return { ...captured, ...movement, ...captureMouseAim() };
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
