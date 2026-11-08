import test from "node:test";
import assert from "node:assert/strict";
import { bindAnalogStick, normalizeAnalogStick } from "../public/platform/frontend-engine/analogStick.js";
import { getGameControls } from "../public/platform/frontend-engine/gameDom.js";

function createStickEnvironment() {
  const stickWindow = new EventTarget();
  stickWindow.CustomEvent = CustomEvent;
  const stickDocument = new EventTarget();
  stickDocument.defaultView = stickWindow;
  stickDocument.hidden = false;
  const stickElements = [];

  function createStickElement(side) {
    const stickElement = new EventTarget();
    stickElement.ownerDocument = stickDocument;
    stickElement.dataset = { stick: side };
    stickElement.style = { setProperty() {}, removeProperty() {} };
    const attributes = new Map();
    const capturedPointers = new Set();
    stickElement.setAttribute = (name, value) => attributes.set(name, value);
    stickElement.getAttribute = (name) => attributes.get(name) ?? null;
    stickElement.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 });
    stickElement.setPointerCapture = (pointerId) => capturedPointers.add(pointerId);
    stickElement.releasePointerCapture = (pointerId) => capturedPointers.delete(pointerId);
    stickElement.hasPointerCapture = (pointerId) => capturedPointers.has(pointerId);
    stickElements.push(stickElement);
    return stickElement;
  }

  stickDocument.querySelectorAll = (selector) => stickElements.filter((stickElement) => selector === `[data-stick="${stickElement.dataset.stick}"]`);
  return { stickWindow, stickDocument, createStickElement };
}

function dispatchStickEvent(stickElement, eventName, eventFields = {}) {
  const stickEvent = Object.assign(new Event(eventName, { cancelable: true }), eventFields);
  stickElement.dispatchEvent(stickEvent);
  return stickEvent;
}

function installDocument(testContext, stickDocument) {
  const previousDocument = globalThis.document;
  globalThis.document = stickDocument;
  testContext.after(() => {
    if (previousDocument === undefined) {
      delete globalThis.document;
    } else {
      globalThis.document = previousDocument;
    }
  });
}

test("analog axes use a circular deadzone and clamp diagonal magnitude to one", () => {
  assert.deepEqual(normalizeAnalogStick(0.1, 0.1, 0.2), { x: 0, y: 0 });
  const halfwayState = normalizeAnalogStick(0.6, 0, 0.2);
  assert.ok(Math.abs(halfwayState.x - 0.5) < 1e-10);
  assert.equal(halfwayState.y, 0);
  const diagonalState = normalizeAnalogStick(2, -2, 0.2);
  assert.ok(Math.abs(diagonalState.x - Math.SQRT1_2) < 1e-10);
  assert.ok(Math.abs(diagonalState.y + Math.SQRT1_2) < 1e-10);
  assert.ok(Math.abs(Math.hypot(diagonalState.x, diagonalState.y) - 1) < 1e-10);
  assert.deepEqual(normalizeAnalogStick(NaN, Infinity), { x: 0, y: 0 });
});

test("left and right sticks own different pointers and ignore unrelated pointer releases", (testContext) => {
  const { stickDocument, createStickElement } = createStickEnvironment();
  installDocument(testContext, stickDocument);
  const leftElement = createStickElement("left");
  const rightElement = createStickElement("right");
  const leftBinding = bindAnalogStick(leftElement);
  const rightBinding = bindAnalogStick(rightElement);
  testContext.after(() => { leftBinding.dispose(); rightBinding.dispose(); });
  const controls = getGameControls();
  const leftChanges = [];
  const unsubscribe = controls.sticks.left.onChange((stickState) => leftChanges.push(stickState));

  dispatchStickEvent(leftElement, "pointerdown", { pointerId: 1, clientX: 100, clientY: 50, button: 0 });
  dispatchStickEvent(rightElement, "pointerdown", { pointerId: 2, clientX: 50, clientY: 0, button: 0 });
  assert.equal(leftElement.hasPointerCapture(1), true);
  assert.equal(rightElement.hasPointerCapture(2), true);
  assert.deepEqual(controls.sticks.left.getState(), { x: 1, y: 0 });
  assert.deepEqual(controls.sticks.right.getState(), { x: 0, y: -1 });

  dispatchStickEvent(leftElement, "pointerdown", { pointerId: 3, clientX: 0, clientY: 50, button: 0 });
  dispatchStickEvent(leftElement, "pointermove", { pointerId: 3, clientX: 0, clientY: 50 });
  dispatchStickEvent(leftElement, "pointerup", { pointerId: 3 });
  assert.deepEqual(controls.sticks.left.getState(), { x: 1, y: 0 });
  dispatchStickEvent(leftElement, "pointerup", { pointerId: 1 });
  assert.deepEqual(controls.sticks.left.getState(), { x: 0, y: 0 });
  assert.deepEqual(controls.sticks.right.getState(), { x: 0, y: -1 });
  assert.deepEqual(leftChanges, [{ x: 1, y: 0 }, { x: 0, y: 0 }]);

  unsubscribe();
  dispatchStickEvent(leftElement, "pointerdown", { pointerId: 4, clientX: 100, clientY: 50, button: 0 });
  assert.equal(leftChanges.length, 2);
  const copiedState = controls.sticks.left.getState();
  copiedState.x = 0;
  assert.equal(controls.sticks.left.getState().x, 1);
});

test("stick cancellation, capture loss, blur, hidden pages, disabling and disposal release input", (testContext) => {
  const { stickWindow, stickDocument, createStickElement } = createStickEnvironment();
  installDocument(testContext, stickDocument);
  const stickElement = createStickElement("left");
  const stickBinding = bindAnalogStick(stickElement);
  const stickControl = getGameControls().sticks.left;
  testContext.after(() => stickBinding.dispose());

  const resetActions = [
    () => dispatchStickEvent(stickElement, "pointercancel", { pointerId: 7 }),
    () => dispatchStickEvent(stickElement, "lostpointercapture", { pointerId: 7 }),
    () => stickWindow.dispatchEvent(new Event("blur")),
    () => { stickDocument.hidden = true; stickDocument.dispatchEvent(new Event("visibilitychange")); },
    () => stickBinding.setDisabled(true),
    () => stickBinding.dispose(),
  ];
  for (const resetInput of resetActions) {
    stickDocument.hidden = false;
    stickBinding.setDisabled(false);
    dispatchStickEvent(stickElement, "pointerdown", { pointerId: 7, clientX: 100, clientY: 50, button: 0 });
    assert.equal(stickControl.getState().x, 1);
    resetInput();
    assert.deepEqual(stickControl.getState(), { x: 0, y: 0 });
    assert.equal(stickElement.hasPointerCapture(7), false);
  }
  dispatchStickEvent(stickElement, "pointerdown", { pointerId: 8, clientX: 0, clientY: 50, button: 0 });
  assert.deepEqual(stickControl.getState(), { x: 0, y: 0 });
});

test("focused arrow keys drive a stick and key release, focus loss or disabled state returns neutral", (testContext) => {
  const { stickDocument, createStickElement } = createStickEnvironment();
  installDocument(testContext, stickDocument);
  const stickElement = createStickElement("right");
  const stickBinding = bindAnalogStick(stickElement);
  const stickControl = getGameControls().sticks.right;
  testContext.after(() => stickBinding.dispose());

  const arrowEvent = dispatchStickEvent(stickElement, "keydown", { key: "ArrowRight" });
  assert.equal(arrowEvent.defaultPrevented, true);
  assert.deepEqual(stickControl.getState(), { x: 1, y: 0 });
  dispatchStickEvent(stickElement, "keydown", { key: "ArrowUp" });
  assert.ok(Math.abs(stickControl.getState().x - Math.SQRT1_2) < 1e-10);
  dispatchStickEvent(stickElement, "keyup", { key: "ArrowRight" });
  assert.deepEqual(stickControl.getState(), { x: 0, y: -1 });
  dispatchStickEvent(stickElement, "blur");
  assert.deepEqual(stickControl.getState(), { x: 0, y: 0 });
  stickBinding.setDisabled(true);
  dispatchStickEvent(stickElement, "keydown", { key: "ArrowRight" });
  dispatchStickEvent(stickElement, "pointerdown", { pointerId: 1, clientX: 100, clientY: 50, button: 0 });
  assert.deepEqual(stickControl.getState(), { x: 0, y: 0 });
});
