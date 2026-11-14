import { getGameControls } from "/platform/frontend-engine/gameDom.js";
import { subscribePlatformTouchInput } from "/platform/frontend-engine/touchControlSurface.js";
import { BUMPER_LINKS_INPUT_TEMPLATE } from "../shared/config.js";
import { wrapBumperLinksYaw } from "../shared/course.js";
import { applyBumperLinksAimInput, createBumperLinksAimState, resolveBumperLinksDragAim } from "./aim.js";

/** @typedef {import("../shared/config.js").BumperLinksInputState} BumperLinksInputState */

const TURN_KEYS = Object.freeze({ left: ["KeyA", "ArrowLeft"], right: ["KeyD", "ArrowRight"] });
const FINE_TURN_KEYS = Object.freeze(["ShiftLeft", "ShiftRight"]);
const CHARGE_KEYS = Object.freeze(["Space", "KeyK"]);
const GAME_KEYS = new Set([...TURN_KEYS.left, ...TURN_KEYS.right, ...CHARGE_KEYS, ...FINE_TURN_KEYS]);
const FINE_TURN_SCALE = 0.3;
const MIN_DRAG_PX = 8;
const MIN_DRAG_POWER = 0.05;
const MODAL_SELECTOR = '[aria-modal="true"], dialog[open]';

/**
 * Aim and putt from keyboard, mouse or finger drag, the console shell and
 * the platform touch surface. Aim and charge update at render cadence; a
 * release becomes exactly one shot in the next fixed capture.
 * @param {object} options
 * @param {HTMLCanvasElement} options.canvas
 * @param {string} options.gameId Registered ID used by the touch surface.
 * @param {()=>number} options.getCameraHeading Heading the camera looks along.
 * @param {()=>void} [options.onActivate]
 */
export function createBumperLinksControls({ canvas, gameId, getCameraHeading, onActivate }) {
  const platformControls = getGameControls();
  const aim = createBumperLinksAimState(0);
  const heldKeys = new Set();
  const turnSources = { keyboard: 0, shell: 0, touch: 0 };
  const chargeSources = { keyboard: false, shell: false, touch: false };
  const cleanups = [];
  const previousLabel = canvas.getAttribute("aria-label");
  const previousTabIndex = canvas.getAttribute("tabindex");
  /**
   * A press on the canvas; it only steers the aim once it has moved, so a
   * plain click never blocks keyboard or touch charging.
   * @type {{pointerId:number,startX:number,startY:number,heading:number,aimYaw:number,power:number,moved:boolean}|null}
   */
  let drag = null;
  /** @type {{aimYaw:number,power:number}|null} */
  let pendingShot = null;
  let canPutt = false;
  let modalOpen = false;
  let engaged = false;
  let disposed = false;
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", "Bumper Links. A and D or the arrows aim, hold and release Space to putt, or drag back from the ball and let go.");

  const isBlocked = () => disposed || modalOpen || document.hidden;
  function listen(target, eventName, listener, listenerOptions) {
    target.addEventListener(eventName, listener, listenerOptions);
    cleanups.push(() => target.removeEventListener(eventName, listener, listenerOptions));
  }

  function reset() {
    heldKeys.clear();
    for (const source of Object.keys(turnSources)) turnSources[source] = 0;
    for (const source of Object.keys(chargeSources)) chargeSources[source] = false;
    aim.charging = false;
    aim.chargeSec = 0;
    aim.power = 0;
    drag = null;
    pendingShot = null;
  }

  function activate() {
    if (isBlocked()) return;
    engaged = true;
    canvas.focus({ preventScroll: true });
    onActivate?.();
  }

  function synchronizeKeyboard() {
    const pressed = (keys) => keys.some((key) => heldKeys.has(key));
    const fine = pressed(FINE_TURN_KEYS) ? FINE_TURN_SCALE : 1;
    turnSources.keyboard = (Number(pressed(TURN_KEYS.right)) - Number(pressed(TURN_KEYS.left))) * fine;
    chargeSources.keyboard = pressed(CHARGE_KEYS);
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

  /** @param {PointerEvent} event */
  function measureDrag(event) {
    const rect = canvas.getBoundingClientRect();
    return resolveBumperLinksDragAim({
      dx: event.clientX - drag.startX,
      dy: event.clientY - drag.startY,
      heading: drag.heading,
      sizePx: Math.min(rect.width, rect.height),
    });
  }

  listen(window, "keydown", (event) => updateKeyboard(event, true));
  listen(window, "keyup", (event) => updateKeyboard(event, false), { capture: true });
  listen(window, "blur", reset);
  listen(document, "visibilitychange", () => { if (document.hidden) reset(); });
  listen(canvas, "pointerdown", (event) => {
    if (isBlocked() || event.button !== 0) return;
    activate();
    if (!canPutt) return;
    drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, heading: getCameraHeading(), aimYaw: aim.aimYaw, power: 0, moved: false };
    canvas.setPointerCapture?.(event.pointerId);
  });
  listen(canvas, "pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < MIN_DRAG_PX) return;
    drag.moved = true;
    const dragAim = measureDrag(event);
    drag.aimYaw = dragAim.aimYaw;
    drag.power = dragAim.power;
  });
  listen(canvas, "pointerup", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (drag.moved && drag.power >= MIN_DRAG_POWER && canPutt) {
      aim.aimYaw = drag.aimYaw;
      pendingShot = { aimYaw: drag.aimYaw, power: drag.power };
    }
    drag = null;
  });
  listen(canvas, "pointercancel", () => { drag = null; });

  for (const [direction, turn] of /** @type {const} */ ([["left", -1], ["right", 1]])) {
    cleanups.push(platformControls.dpad[direction].onHold(() => {
      if (isBlocked()) return;
      activate();
      turnSources.shell = turn;
    }, () => {
      if (turnSources.shell === turn) turnSources.shell = 0;
    }));
  }
  cleanups.push(platformControls.actions.a.onHold(() => {
    if (isBlocked()) return;
    activate();
    chargeSources.shell = true;
  }, () => { chargeSources.shell = false; }));
  cleanups.push(platformControls.sticks.left.onChange((stick) => {
    if (isBlocked()) return;
    if (Math.abs(stick.x) > 0) activate();
    turnSources.shell = stick.x;
  }));
  cleanups.push(subscribePlatformTouchInput(gameId, (touchInput) => {
    if (touchInput.type === "reset") {
      turnSources.touch = 0;
      chargeSources.touch = false;
      return;
    }
    if (isBlocked()) return;
    activate();
    if (touchInput.type === "axis" && touchInput.controlId === "aim") turnSources.touch = touchInput.x;
    else if (touchInput.type === "action" && touchInput.controlId === "shoot") chargeSources.touch = touchInput.active;
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
    isDragging: () => Boolean(drag?.moved),
    /**
     * Advance aim and charge once per rendered frame.
     * @param {number} dtSec
     * @param {boolean} ballReady Whether the local ball rests and the hole is in play.
     * @returns {{aimYaw:number,power:number,charging:boolean}}
     */
    update(dtSec, ballReady) {
      canPutt = ballReady && !isBlocked();
      const turn = Math.max(-1, Math.min(1, turnSources.keyboard + turnSources.shell + turnSources.touch));
      const chargeHeld = canPutt && (chargeSources.keyboard || chargeSources.shell || chargeSources.touch);
      if (!canPutt || chargeHeld) drag = null;
      const dragging = Boolean(drag?.moved);
      const step = applyBumperLinksAimInput(aim, { turn: dragging ? 0 : turn, chargeHeld, dtSec });
      if (step.release && canPutt) pendingShot = { aimYaw: step.aimYaw, power: step.power };
      if (dragging) return { aimYaw: drag.aimYaw, power: drag.power, charging: drag.power > 0 };
      return { aimYaw: aim.aimYaw, power: aim.charging ? aim.power : 0, charging: aim.charging };
    },
    /** Point the aim somewhere new, for a fresh rest or hole. @param {number} aimYaw */
    setAimYaw(aimYaw) {
      if (Number.isFinite(aimYaw) && !aim.charging && !drag?.moved) aim.aimYaw = wrapBumperLinksYaw(aimYaw);
    },
    /** @returns {BumperLinksInputState} One fixed command; a pending shot is sent once. */
    capture() {
      if (isBlocked()) return { ...BUMPER_LINKS_INPUT_TEMPLATE };
      const shot = pendingShot;
      pendingShot = null;
      return shot
        ? { aimYaw: wrapBumperLinksYaw(shot.aimYaw), power: shot.power, shoot: true }
        : { aimYaw: wrapBumperLinksYaw(drag?.moved ? drag.aimYaw : aim.aimYaw), power: 0, shoot: false };
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
