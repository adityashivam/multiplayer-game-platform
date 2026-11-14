import { getGameControls } from "/platform/frontend-engine/gameDom.js";
import { subscribePlatformTouchInput } from "/platform/frontend-engine/touchControlSurface.js";
import { createInputLatch } from "../../../platform/frontend-engine/inputTimeline.js";
import { DRIFTLINE_INPUT_TEMPLATE } from "../shared/config.js";

/** @typedef {"keyboard"|"shell"|"touch"} DriftlineInputSource */
/** @typedef {"throttle"|"brake"|"handbrake"|"recover"} DriftlineControlAction */

const KEY_BINDINGS = Object.freeze({
  steerLeft: ["KeyA", "ArrowLeft"],
  steerRight: ["KeyD", "ArrowRight"],
  throttle: ["KeyW", "ArrowUp"],
  brake: ["KeyS", "ArrowDown"],
  handbrake: ["Space"],
  recover: ["KeyR"],
});
const SHELL_ACTIONS = Object.freeze({ a: "throttle", b: "brake", x: "handbrake", y: "recover" });
const GAME_KEYS = new Set(Object.values(KEY_BINDINGS).flat());
const INPUT_SOURCES = Object.freeze(/** @type {DriftlineInputSource[]} */ (["keyboard", "shell", "touch"]));
const ACTION_TEMPLATE = Object.freeze({ throttle: false, brake: false, handbrake: false, recover: false });
const ACTION_EDGE_KEYS = Object.freeze(["handbrake", "recover"]);
const MODAL_SELECTOR = '[aria-modal="true"], dialog[open]';

/**
 * Bind driving to keyboard, the console shell and the platform touch surface.
 * Each device owns its holds, so releasing one never releases another; short
 * handbrake flicks survive between fixed captures through the SDK latch.
 * @param {{canvas:HTMLCanvasElement,gameId:string,onActivate?:()=>void}} options
 */
export function createDriftlineControls({ canvas, gameId, onActivate }) {
  const platformControls = getGameControls();
  const steering = { keyboard: 0, shell: 0, touch: 0 };
  const actions = Object.fromEntries(INPUT_SOURCES.map((source) => [source, createInputLatch(ACTION_TEMPLATE, { edgeKeys: ACTION_EDGE_KEYS })]));
  const heldKeys = new Set();
  const shellDirections = { left: false, right: false };
  const cleanups = [];
  const previousLabel = canvas.getAttribute("aria-label");
  const previousTabIndex = canvas.getAttribute("tabindex");
  let shellStickX = 0;
  let modalOpen = false;
  let engaged = false;
  let disposed = false;
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", "Driftline. W or up: throttle. S or down: brake and reverse. A and D or arrows: steer. Space: handbrake. R: reset car.");

  const isBlocked = () => disposed || modalOpen || document.hidden;
  function listen(target, eventName, listener, listenerOptions) {
    target.addEventListener(eventName, listener, listenerOptions);
    cleanups.push(() => target.removeEventListener(eventName, listener, listenerOptions));
  }

  /** @param {DriftlineInputSource} source */
  function resetSource(source) {
    steering[source] = 0;
    actions[source].reset();
  }

  function reset() {
    heldKeys.clear();
    shellDirections.left = false;
    shellDirections.right = false;
    shellStickX = 0;
    INPUT_SOURCES.forEach(resetSource);
  }

  function activate() {
    if (isBlocked()) return;
    engaged = true;
    canvas.focus({ preventScroll: true });
    onActivate?.();
  }

  function synchronizeKeyboard() {
    const pressed = (keys) => keys.some((key) => heldKeys.has(key));
    steering.keyboard = Number(pressed(KEY_BINDINGS.steerRight)) - Number(pressed(KEY_BINDINGS.steerLeft));
    for (const action of /** @type {DriftlineControlAction[]} */ (Object.keys(ACTION_TEMPLATE))) {
      actions.keyboard.set(action, pressed(KEY_BINDINGS[action]));
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
    heldKeys.add(event.code);
    synchronizeKeyboard();
  }

  function synchronizeShellSteering() {
    steering.shell = Math.max(-1, Math.min(1, shellStickX + Number(shellDirections.right) - Number(shellDirections.left)));
  }

  listen(window, "keydown", (event) => updateKeyboard(event, true));
  listen(window, "keyup", (event) => updateKeyboard(event, false), { capture: true });
  listen(window, "blur", reset);
  listen(document, "visibilitychange", () => { if (document.hidden) reset(); });
  listen(canvas, "pointerdown", () => activate());

  for (const direction of /** @type {Array<"left"|"right">} */ (["left", "right"])) {
    cleanups.push(platformControls.dpad[direction].onHold(() => {
      if (isBlocked()) return;
      activate();
      shellDirections[direction] = true;
      synchronizeShellSteering();
    }, () => {
      shellDirections[direction] = false;
      synchronizeShellSteering();
    }));
  }
  cleanups.push(platformControls.dpad.up.onHold(() => { if (!isBlocked()) actions.shell.set("throttle", true); }, () => actions.shell.set("throttle", false)));
  cleanups.push(platformControls.dpad.down.onHold(() => { if (!isBlocked()) actions.shell.set("brake", true); }, () => actions.shell.set("brake", false)));
  for (const [button, action] of Object.entries(SHELL_ACTIONS)) {
    cleanups.push(platformControls.actions[button].onHold(() => {
      if (isBlocked()) return;
      activate();
      actions.shell.set(action, true);
    }, () => actions.shell.set(action, false)));
  }
  cleanups.push(platformControls.sticks.left.onChange((stick) => {
    if (isBlocked()) return;
    shellStickX = stick.x;
    if (Math.abs(stick.x) > 0) activate();
    synchronizeShellSteering();
  }));
  cleanups.push(subscribePlatformTouchInput(gameId, (touchInput) => {
    if (touchInput.type === "reset") {
      resetSource("touch");
      return;
    }
    if (isBlocked()) return;
    activate();
    if (touchInput.type === "axis" && touchInput.controlId === "steer") {
      steering.touch = Math.max(-1, Math.min(1, touchInput.x));
    } else if (touchInput.type === "action" && Object.hasOwn(ACTION_TEMPLATE, touchInput.controlId)) {
      actions.touch.set(touchInput.controlId, touchInput.active);
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
    /** @returns {import("../shared/config.js").DriftlineInputState} */
    capture() {
      if (isBlocked()) return { ...DRIFTLINE_INPUT_TEMPLATE };
      const captured = { ...DRIFTLINE_INPUT_TEMPLATE };
      let steer = 0;
      for (const source of INPUT_SOURCES) {
        steer += steering[source];
        const sourceActions = actions[source].capture();
        if (sourceActions.throttle) captured.throttle = 1;
        if (sourceActions.brake) captured.brake = 1;
        captured.handbrake ||= sourceActions.handbrake;
        captured.recover ||= sourceActions.recover;
      }
      captured.steer = Math.max(-1, Math.min(1, steer));
      return captured;
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
