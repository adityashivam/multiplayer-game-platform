import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultTouchProfile, resolveTouchLayout } from "../public/platform/shared/touchControls.js";
import { bindTouchControlSurface, isPlatformTouchControlsActive, subscribePlatformTouchInput } from "../public/platform/frontend-engine/touchControlSurface.js";

const descriptor = {
  apiVersion: 1,
  customizable: true,
  defaultPreset: "two-thumb",
  allowedPresets: ["two-thumb", "three-finger", "four-finger"],
  controls: [
    { id: "drive", type: "stick", role: "move", label: "Drive" },
    { id: "camera", type: "look", role: "look", label: "Camera", editable: false },
    { id: "tool", type: "button", role: "primary", label: "Use tool", behavior: "hold-look" },
    { id: "hop", type: "button", role: "jump", label: "Hop" },
    { id: "cycle", type: "button", role: "utility", label: "Cycle", behavior: "press" },
  ],
};

function createTouchEnvironment(testContext, options = {}) {
  const { hostTouchAction = "", ...bindingOptions } = options;
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const touchWindow = new EventTarget();
  touchWindow.CustomEvent = CustomEvent;
  const touchDocument = new EventTarget();
  touchDocument.defaultView = touchWindow;
  touchDocument.hidden = false;
  touchDocument.modal = false;
  const capturedPointers = new Set();

  function createElement({ id, tag = "DIV", interactive = false, bounds = { left: 0, top: 0, width: 1000, height: 500 } } = {}) {
    const touchElement = new EventTarget();
    const properties = new Map();
    touchElement.ownerDocument = touchDocument;
    touchElement.dataset = id ? { touchControlId: id } : {};
    touchElement.tagName = tag;
    touchElement.interactive = interactive;
    touchElement.style = { setProperty: (name, value) => properties.set(name, value), getPropertyValue: (name) => properties.get(name) };
    touchElement.getBoundingClientRect = () => bounds;
    touchElement.setPointerCapture = (pointerId) => capturedPointers.add(pointerId);
    touchElement.releasePointerCapture = (pointerId) => capturedPointers.delete(pointerId);
    touchElement.hasPointerCapture = (pointerId) => capturedPointers.has(pointerId);
    touchElement.closest = (selector) => selector === "[data-touch-control-id]" ? (id ? touchElement : null) : (interactive ? touchElement : null);
    return touchElement;
  }

  const host = createElement();
  host.style.touchAction = hostTouchAction;
  const surface = createElement();
  surface.parentElement = host;
  surface.dataset.platformTouchGame = "relay";
  surface.dataset.active = "true";
  const controls = new Map([
    ["drive", createElement({ id: "drive", bounds: { left: 40, top: 220, width: 100, height: 100 } })],
    ["tool", createElement({ id: "tool", tag: "BUTTON" })],
    ["hop", createElement({ id: "hop", tag: "BUTTON" })],
    ["cycle", createElement({ id: "cycle", tag: "BUTTON" })],
  ]);
  surface.querySelectorAll = (selector) => selector === "[data-touch-control-id]" ? [...controls.values()] : [];
  surface.contains = (candidate) => [...controls.values()].includes(candidate);
  touchDocument.querySelectorAll = () => [surface];
  touchDocument.querySelector = () => touchDocument.modal ? {} : null;
  globalThis.window = touchWindow;
  globalThis.document = touchDocument;
  const events = [];
  const unsubscribe = subscribePlatformTouchInput("relay", (inputEvent) => events.push(inputEvent));
  const binding = bindTouchControlSurface({ element: surface, gameId: "relay", descriptor, layout: resolveTouchLayout(descriptor, createDefaultTouchProfile(descriptor), "landscape"), ...bindingOptions });
  events.length = 0;
  testContext.after(() => {
    binding.dispose();
    unsubscribe();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  });

  function pointer(eventName, pointerId, target = host, fields = {}) {
    const pointerEvent = Object.assign(new Event(eventName, { cancelable: true }), { pointerId, button: 0, pointerType: "touch", clientX: 700, clientY: 200, ...fields });
    Object.defineProperty(pointerEvent, "target", { value: target });
    host.dispatchEvent(pointerEvent);
    return pointerEvent;
  }
  return { touchWindow, touchDocument, host, surface, controls, createElement, capturedPointers, binding, events, pointer };
}

test("four fingers independently own movement, background look and two actions", (testContext) => {
  const { controls, capturedPointers, events, pointer } = createTouchEnvironment(testContext);
  pointer("pointerdown", 11, controls.get("drive"), { clientX: 140, clientY: 270 });
  pointer("pointerdown", 22);
  pointer("pointerdown", 33, controls.get("tool"));
  pointer("pointerdown", 44, controls.get("hop"));
  assert.equal(capturedPointers.size, 4);
  assert.ok(events.some((event) => event.type === "axis" && event.controlId === "drive" && event.x === 1 && event.y === 0));
  assert.deepEqual(events.filter((event) => event.type === "action"), [
    { gameId: "relay", type: "action", controlId: "tool", active: true },
    { gameId: "relay", type: "action", controlId: "hop", active: true },
  ]);
  pointer("pointermove", 22, undefined, { clientX: 720, clientY: 190 });
  pointer("pointermove", 33, controls.get("tool"), { clientX: 710, clientY: 215 });
  assert.deepEqual(events.filter((event) => event.type === "look"), [
    { gameId: "relay", type: "look", controlId: "camera", deltaX: 20, deltaY: -10 },
    { gameId: "relay", type: "look", controlId: "tool", deltaX: 10, deltaY: 15 },
  ]);

  pointer("pointerup", 99);
  pointer("pointerup", 11);
  assert.equal(capturedPointers.size, 3);
  assert.equal(events.filter((event) => event.type === "action" && !event.active).length, 0);
  assert.deepEqual(events.at(-1), { gameId: "relay", type: "axis", controlId: "drive", x: 0, y: 0 });
  pointer("pointercancel", 44);
  assert.deepEqual(events.at(-1), { gameId: "relay", type: "action", controlId: "hop", active: false });
  assert.equal(capturedPointers.has(33), true);
  pointer("pointerup", 33);
  assert.deepEqual(events.at(-1), { gameId: "relay", type: "action", controlId: "tool", active: false });
  assert.equal(controls.get("tool").dataset.pressed, undefined);
});

test("look capture leaves interactive HUD and platform controls available", (testContext) => {
  const { createElement, events, pointer } = createTouchEnvironment(testContext);
  for (const target of [
    createElement({ tag: "BUTTON", interactive: true }),
    createElement({ tag: "INPUT", interactive: true }),
    createElement({ interactive: true }), // Contenteditable or platform chrome.
  ]) {
    const downEvent = pointer("pointerdown", 1, target);
    pointer("pointermove", 1, target, { clientX: 750 });
    assert.equal(downEvent.defaultPrevented, false);
  }
  pointer("pointerdown", 1, undefined, { clientX: 100 });
  pointer("pointermove", 1, undefined, { clientX: 200 });
  assert.deepEqual(events, []);
  const lookDown = pointer("pointerdown", 2);
  assert.equal(lookDown.defaultPrevented, true);
  pointer("pointermove", 2, undefined, { clientX: 730 });
  assert.equal(events.at(-1).deltaX, 30);
});

test("stick deadzone and button presses update DOM feedback without re-rendering", (testContext) => {
  const { controls, events, pointer } = createTouchEnvironment(testContext);
  pointer("pointerdown", 1, controls.get("drive"), { clientX: 91, clientY: 270 });
  assert.deepEqual(events.at(-1), { gameId: "relay", type: "axis", controlId: "drive", x: 0, y: 0 });
  pointer("pointermove", 1, controls.get("drive"), { clientX: 140, clientY: 320 });
  const axis = events.at(-1);
  assert.ok(Math.abs(Math.hypot(axis.x, axis.y) - 1) < 1e-10);
  assert.equal(controls.get("drive").dataset.pressed, "true");
  assert.notEqual(controls.get("drive").style.getPropertyValue("--touch-stick-x"), "0px");
  pointer("pointerup", 1);
  assert.equal(controls.get("drive").style.getPropertyValue("--touch-stick-x"), "0px");
  pointer("pointerdown", 2, controls.get("cycle"));
  assert.deepEqual(events.slice(-2), [
    { gameId: "relay", type: "action", controlId: "cycle", active: true },
    { gameId: "relay", type: "action", controlId: "cycle", active: false },
  ]);
});

test("blur, resize, hidden pages, modal focus and disposal clear held controls", (testContext) => {
  const { touchWindow, touchDocument, controls, capturedPointers, surface, events, binding, pointer } = createTouchEnvironment(testContext);
  assert.equal(isPlatformTouchControlsActive("relay"), true);
  assert.equal(isPlatformTouchControlsActive("other"), false);
  for (const reset of [
    () => touchWindow.dispatchEvent(new Event("blur")),
    () => touchWindow.dispatchEvent(new Event("resize")),
    () => { touchDocument.hidden = true; touchDocument.dispatchEvent(new Event("visibilitychange")); },
    () => { touchDocument.modal = true; pointer("pointermove", 1); },
    () => binding.dispose(),
  ]) {
    touchDocument.hidden = false;
    touchDocument.modal = false;
    pointer("pointerdown", 1, controls.get("tool"));
    assert.equal(controls.get("tool").dataset.pressed, "true");
    reset();
    assert.equal(capturedPointers.size, 0);
    assert.equal(controls.get("tool").dataset.pressed, undefined);
    assert.ok(events.slice(-2).some((event) => event.type === "action" && event.active === false));
    assert.equal(events.at(-1).type, "reset");
  }
  assert.equal(surface.dataset.active, "false");
  const eventCount = events.length;
  pointer("pointerdown", 2, controls.get("tool"));
  assert.equal(events.length, eventCount);
});

test("input subscriptions cross module boundaries, filter game identities and own their events", async (testContext) => {
  const { touchWindow, controls, events, pointer } = createTouchEnvironment(testContext);
  const peerSdk = await import("../public/platform/frontend-engine/touchControlSurface.js?separate-game-bundle");
  const observed = [];
  const unsubscribe = peerSdk.subscribePlatformTouchInput("relay", (inputEvent) => observed.push(inputEvent));
  testContext.after(unsubscribe);
  const unsubscribeOther = peerSdk.subscribePlatformTouchInput("other", () => assert.fail("other game's event delivered"));
  testContext.after(unsubscribeOther);
  pointer("pointerdown", 7, controls.get("tool"));
  assert.deepEqual(observed.at(-1), events.at(-1));
  observed.at(-1).active = false;
  assert.equal(events.at(-1).active, true);
  unsubscribe();
  touchWindow.dispatchEvent(new touchWindow.CustomEvent("platformtouchinput", { detail: { gameId: "relay", type: "reset" } }));
  assert.equal(observed.length, 1);
});

test("rebinding the same mounted surface after a modal restores its active input marker", (testContext) => {
  const { surface, controls, binding, events, pointer } = createTouchEnvironment(testContext);
  binding.dispose();
  const layout = resolveTouchLayout(descriptor, createDefaultTouchProfile(descriptor), "landscape");
  const disabledBinding = bindTouchControlSurface({ element: surface, gameId: "relay", descriptor, layout, disabled: true });
  assert.equal(isPlatformTouchControlsActive("relay"), false);
  disabledBinding.dispose();
  const resumedBinding = bindTouchControlSurface({ element: surface, gameId: "relay", descriptor, layout, disabled: false });
  testContext.after(() => resumedBinding.dispose());
  assert.equal(isPlatformTouchControlsActive("relay"), true);
  pointer("pointerdown", 77, controls.get("tool"));
  assert.deepEqual(events.at(-1), { gameId: "relay", type: "action", controlId: "tool", active: true });
});

test("background mouse clicks remain available to game controls while explicit touch buttons accept mouse", (testContext) => {
  const { controls, events, pointer } = createTouchEnvironment(testContext);
  const downEvent = pointer("pointerdown", 1, undefined, { pointerType: "mouse" });
  pointer("pointermove", 1, undefined, { pointerType: "mouse", clientX: 730 });
  assert.equal(downEvent.defaultPrevented, false);
  assert.deepEqual(events, []);
  pointer("pointerdown", 2, controls.get("tool"), { pointerType: "mouse" });
  assert.deepEqual(events.at(-1), { gameId: "relay", type: "action", controlId: "tool", active: true });
});

test("a stale browser pointer capture cannot prevent other controls from resetting", (testContext) => {
  const { host, controls, events, binding, pointer } = createTouchEnvironment(testContext);
  pointer("pointerdown", 1, controls.get("drive"), { clientX: 140, clientY: 270 });
  pointer("pointerdown", 2, controls.get("tool"));
  host.releasePointerCapture = () => { throw new Error("browser already canceled pointer"); };
  assert.doesNotThrow(() => binding.reset());
  assert.ok(events.some((event) => event.type === "axis" && event.x === 0 && event.y === 0));
  assert.ok(events.some((event) => event.type === "action" && event.controlId === "tool" && event.active === false));
  assert.equal(events.at(-1).type, "reset");
});

test("active bindings own host touch gestures and restore panning on disable and disposal", (testContext) => {
  const { host, binding } = createTouchEnvironment(testContext, { hostTouchAction: "pan-y" });
  assert.equal(host.style.touchAction, "none");
  binding.setDisabled(true);
  assert.equal(host.style.touchAction, "pan-y");
  binding.setDisabled(false);
  assert.equal(host.style.touchAction, "none");
  binding.dispose();
  assert.equal(host.style.touchAction, "pan-y");
});

test("initially disabled surfaces leave custom renderer host panning available", (testContext) => {
  const { host, binding } = createTouchEnvironment(testContext, { hostTouchAction: "pan-y", disabled: true });
  assert.equal(host.style.touchAction, "pan-y");
  binding.setDisabled(false);
  assert.equal(host.style.touchAction, "none");
  binding.dispose();
  assert.equal(host.style.touchAction, "pan-y");
});

test("replacing a host binding cannot restore panning while its replacement owns gestures", (testContext) => {
  const { host, surface, binding } = createTouchEnvironment(testContext, { hostTouchAction: "pan-y" });
  const replacementBinding = bindTouchControlSurface({
    element: surface,
    gameId: "relay",
    descriptor,
    layout: resolveTouchLayout(descriptor, createDefaultTouchProfile(descriptor), "landscape"),
  });
  testContext.after(() => replacementBinding.dispose());
  binding.dispose();
  assert.equal(host.style.touchAction, "none");
  replacementBinding.dispose();
  assert.equal(host.style.touchAction, "pan-y");
});
