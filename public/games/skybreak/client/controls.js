import { getGameControls } from "/platform/frontend-engine/gameDom.js";
import { subscribePlatformTouchInput } from "/platform/frontend-engine/touchControlSurface.js";
import { createInputLatch } from "../../../platform/frontend-engine/inputTimeline.js";
import { SKYBREAK_INPUT_TEMPLATE } from "../shared/config.js";

/** @typedef {"keyboard"|"pointer"|"shell"|"touch"} SkybreakInputSource */

const AXIS_KEYS = Object.freeze({
  pitchDown: ["KeyW", "ArrowUp"],
  pitchUp: ["KeyS", "ArrowDown"],
  rollLeft: ["KeyA", "ArrowLeft"],
  rollRight: ["KeyD", "ArrowRight"],
  yawLeft: ["KeyQ"],
  yawRight: ["KeyE"],
});
const ACTION_KEYS = Object.freeze({
  fire: ["Space", "KeyJ"],
  missile: ["KeyF", "KeyK"],
  flare: ["KeyC"],
  boost: ["ShiftLeft", "ShiftRight"],
  brake: ["KeyX"],
  restart: ["KeyR"],
});
const SHELL_ACTIONS = Object.freeze({ a: "fire", b: "missile", x: "boost", y: "flare" });
const TOUCH_ACTIONS = Object.freeze(["fire", "missile", "flare", "boost", "brake"]);
const ACTION_TEMPLATE = Object.freeze({ fire: false, missile: false, flare: false, boost: false, brake: false, restart: false });
const ACTION_EDGE_KEYS = Object.freeze(["missile", "flare", "restart"]);
const GAME_KEYS = new Set([...Object.values(AXIS_KEYS).flat(), ...Object.values(ACTION_KEYS).flat()]);
const INPUT_SOURCES = Object.freeze(/** @type {SkybreakInputSource[]} */ (["keyboard", "pointer", "shell", "touch"]));
const MODAL_SELECTOR = '[aria-modal="true"], dialog[open]';

/**
 * Bind flight to keyboard, mouse buttons, the console shell and the platform
 * touch surface. Each device owns its holds; short missile, flare and
 * restart taps survive between fixed captures through the SDK latch.
 * @param {{canvas:HTMLCanvasElement,gameId:string,onActivate?:()=>void}} options
 */
export function createSkybreakControls({ canvas, gameId, onActivate }) {
  const platformControls = getGameControls();
  const axes = Object.fromEntries(INPUT_SOURCES.map((source) => [source, { pitch: 0, roll: 0, yaw: 0 }]));
  const actions = Object.fromEntries(INPUT_SOURCES.map((source) => [source, createInputLatch(ACTION_TEMPLATE, { edgeKeys: ACTION_EDGE_KEYS })]));
  const heldKeys = new Set();
  const shellDirections = { left: false, right: false, up: false, down: false };
  const cleanups = [];
  const previousLabel = canvas.getAttribute("aria-label");
  const previousTabIndex = canvas.getAttribute("tabindex");
  let shellStick = { x: 0, y: 0 };
  let modalOpen = false;
  let engaged = false;
  let disposed = false;
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", "Skybreak. W and S pitch, A and D roll, Q and E rudder. Shift boost, X airbrake. Space or left mouse: cannon. F or right mouse: missile. C: flares. R restarts a time-trial run.");

  const isBlocked = () => disposed || modalOpen || document.hidden;
  function listen(target, eventName, listener, listenerOptions) {
    target.addEventListener(eventName, listener, listenerOptions);
    cleanups.push(() => target.removeEventListener(eventName, listener, listenerOptions));
  }

  /** Devices currently holding the cannon trigger. */
  const firingSources = new Set();

  /** @param {SkybreakInputSource} source @param {keyof typeof ACTION_TEMPLATE} action @param {boolean} active */
  function setAction(source, action, active) {
    actions[source].set(action, active);
    if (action !== "fire") return;
    if (active) firingSources.add(source);
    else firingSources.delete(source);
  }

  /** @param {SkybreakInputSource} source */
  function resetSource(source) {
    firingSources.delete(source);
    axes[source].pitch = 0;
    axes[source].roll = 0;
    axes[source].yaw = 0;
    actions[source].reset();
  }

  function reset() {
    heldKeys.clear();
    shellStick = { x: 0, y: 0 };
    for (const direction of Object.keys(shellDirections)) shellDirections[direction] = false;
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
    axes.keyboard.pitch = Number(pressed(AXIS_KEYS.pitchUp)) - Number(pressed(AXIS_KEYS.pitchDown));
    axes.keyboard.roll = Number(pressed(AXIS_KEYS.rollRight)) - Number(pressed(AXIS_KEYS.rollLeft));
    axes.keyboard.yaw = Number(pressed(AXIS_KEYS.yawRight)) - Number(pressed(AXIS_KEYS.yawLeft));
    for (const action of Object.keys(ACTION_KEYS)) setAction("keyboard", action, pressed(ACTION_KEYS[action]));
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

  function synchronizeShell() {
    axes.shell.roll = Math.max(-1, Math.min(1, shellStick.x));
    axes.shell.pitch = Math.max(-1, Math.min(1, shellStick.y));
    axes.shell.yaw = Number(shellDirections.right) - Number(shellDirections.left);
    setAction("shell", "boost", shellDirections.up);
    setAction("shell", "brake", shellDirections.down);
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
    if (event.button === 0) setAction("pointer", "fire", true);
    else if (event.button === 2) setAction("pointer", "missile", true);
  });
  listen(window, "pointerup", (event) => {
    if (event.pointerType === "touch") return;
    if (event.button === 0) setAction("pointer", "fire", false);
    else if (event.button === 2) setAction("pointer", "missile", false);
  });

  for (const direction of /** @type {Array<keyof typeof shellDirections>} */ (Object.keys(shellDirections))) {
    cleanups.push(platformControls.dpad[direction].onHold(() => {
      if (isBlocked()) return;
      activate();
      shellDirections[direction] = true;
      synchronizeShell();
    }, () => {
      shellDirections[direction] = false;
      synchronizeShell();
    }));
  }
  for (const [button, action] of Object.entries(SHELL_ACTIONS)) {
    cleanups.push(platformControls.actions[button].onHold(() => {
      if (isBlocked()) return;
      activate();
      setAction("shell", action, true);
    }, () => setAction("shell", action, false)));
  }
  cleanups.push(platformControls.sticks.left.onChange((stick) => {
    if (isBlocked()) return;
    shellStick = stick;
    if (Math.hypot(stick.x, stick.y) > 0) activate();
    synchronizeShell();
  }));
  cleanups.push(subscribePlatformTouchInput(gameId, (touchInput) => {
    if (touchInput.type === "reset") {
      resetSource("touch");
      return;
    }
    if (isBlocked()) return;
    activate();
    if (touchInput.type === "axis" && touchInput.controlId === "stick") {
      axes.touch.roll = touchInput.x;
      axes.touch.pitch = touchInput.y;
    } else if (touchInput.type === "action" && TOUCH_ACTIONS.includes(touchInput.controlId)) {
      setAction("touch", touchInput.controlId, touchInput.active);
    }
  }));

  function synchronizeModalState() {
    const nextModalOpen = Boolean(document.querySelector(MODAL_SELECTOR));
    if (nextModalOpen && !modalOpen) reset();
    modalOpen = nextModalOpen;
  }
  const modalObserver = new MutationObserver(synchronizeModalState);
  modalObserver.observe(document.getElementById("game-view") || document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-modal", "open"] });
  synchronizeModalState();

  return {
    activate,
    reset,
    isBlocked,
    isEngaged: () => engaged,
    /** Live trigger state for instant local tracers; authority still decides hits. */
    isFiring: () => !isBlocked() && firingSources.size > 0,
    /**
     * @param {number} viewLagTicks How far behind authority this pilot sees rivals.
     * @returns {import("../shared/config.js").SkybreakInputState}
     */
    capture(viewLagTicks) {
      if (isBlocked()) return { ...SKYBREAK_INPUT_TEMPLATE };
      const captured = { ...SKYBREAK_INPUT_TEMPLATE, viewLagTicks };
      let pitch = 0;
      let roll = 0;
      let yaw = 0;
      for (const source of INPUT_SOURCES) {
        pitch += axes[source].pitch;
        roll += axes[source].roll;
        yaw += axes[source].yaw;
        const sourceActions = actions[source].capture();
        for (const action of Object.keys(ACTION_TEMPLATE)) captured[action] ||= sourceActions[action];
      }
      captured.pitch = Math.max(-1, Math.min(1, pitch));
      captured.roll = Math.max(-1, Math.min(1, roll));
      captured.yaw = Math.max(-1, Math.min(1, yaw));
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
