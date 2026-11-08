import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { bindAnalogStick } from "../public/platform/frontend-engine/analogStick.js";

// Node resolves browser-root imports through local file URLs. The factory and
// its SDK dependencies execute unchanged; only the browser URL base differs.
const controlsUrl = new URL("../public/games/dead-shift/client/controls.js", import.meta.url);
const controlsSource = (await readFile(controlsUrl, "utf8")).replace(/from "([^"]+)"/g, (_match, modulePath) => {
  const resolvedUrl = modulePath.startsWith("/platform/")
    ? new URL(`../public${modulePath}`, import.meta.url)
    : new URL(modulePath, controlsUrl);
  return `from "${resolvedUrl.href}"`;
});
const { createDeadShiftControls } = await import(`data:text/javascript,${encodeURIComponent(controlsSource)}`);

function createControlsEnvironment(testContext) {
  const previousGlobals = { window: globalThis.window, document: globalThis.document, MutationObserver: globalThis.MutationObserver };
  const gameWindow = new EventTarget();
  gameWindow.matchMedia = () => ({ matches: true });
  const keyboardListeners = [];
  const addWindowListener = gameWindow.addEventListener.bind(gameWindow);
  const removeWindowListener = gameWindow.removeEventListener.bind(gameWindow);
  gameWindow.addEventListener = (eventName, listener, options) => {
    if (eventName === "keydown" || eventName === "keyup") {
      keyboardListeners.push({ eventName, listener, capture: options === true || options?.capture === true });
    }
    addWindowListener(eventName, listener, options);
  };
  gameWindow.removeEventListener = (eventName, listener, options) => {
    const listenerIndex = keyboardListeners.findIndex((entry) => entry.eventName === eventName && entry.listener === listener);
    if (listenerIndex >= 0) keyboardListeners.splice(listenerIndex, 1);
    removeWindowListener(eventName, listener, options);
  };
  const gameDocument = new EventTarget();
  gameDocument.defaultView = gameWindow;
  gameWindow.CustomEvent = CustomEvent;
  gameDocument.hidden = false;
  gameDocument.body = new EventTarget();
  gameDocument.getElementById = () => null;
  gameDocument.querySelector = () => null;
  gameDocument.exitPointerLock = () => { gameDocument.pointerLockElement = null; };
  const canvas = new EventTarget();
  const canvasAttributes = new Map([["aria-label", "Platform game canvas"]]);
  canvas.tabIndex = -1;
  canvas.getAttribute = (attributeName) => canvasAttributes.get(attributeName) ?? null;
  canvas.setAttribute = (attributeName, attributeValue) => canvasAttributes.set(attributeName, attributeValue);
  canvas.removeAttribute = (attributeName) => canvasAttributes.delete(attributeName);
  canvas.closest = () => null;
  canvas.focus = () => { gameDocument.activeElement = canvas; };
  const stickElement = new EventTarget();
  stickElement.ownerDocument = gameDocument;
  stickElement.dataset = { stick: "left" };
  stickElement.style = { setProperty() {} };
  stickElement.closest = () => stickElement;
  gameDocument.querySelectorAll = (selector) => selector === '[data-stick="left"]' ? [stickElement] : [];
  const stickBinding = bindAnalogStick(stickElement);
  globalThis.window = gameWindow;
  globalThis.document = gameDocument;
  globalThis.MutationObserver = class { observe() {} disconnect() {} };
  const controls = createDeadShiftControls({ canvas });
  controls.activate();
  testContext.after(() => {
    controls.dispose();
    stickBinding.dispose();
    for (const [globalName, previousValue] of Object.entries(previousGlobals)) {
      if (previousValue === undefined) delete globalThis[globalName];
      else globalThis[globalName] = previousValue;
    }
  });

  // EventTarget has no DOM parent tree in Node. Model the browser's window
  // capture -> target -> window bubble path, preserving real stopPropagation.
  function dispatchKeyboard(eventName, code, target = canvas, key = code) {
    const keyboardEvent = Object.assign(new Event(eventName, { cancelable: true }), { code, key, repeat: false });
    Object.defineProperty(keyboardEvent, "target", { value: target });
    let propagationStopped = false;
    keyboardEvent.stopPropagation = () => { propagationStopped = true; };
    for (const entry of keyboardListeners.filter((entry) => entry.eventName === eventName && entry.capture)) {
      entry.listener(keyboardEvent);
    }
    target.dispatchEvent(keyboardEvent);
    if (!propagationStopped) {
      for (const entry of keyboardListeners.filter((entry) => entry.eventName === eventName && !entry.capture)) {
        entry.listener(keyboardEvent);
      }
    }
  }

  return { controls, canvas, stickElement, gameWindow, gameDocument, dispatchKeyboard };
}

test("movement and sprint release after keyboard focus moves to a platform stick", (testContext) => {
  const { controls, stickElement, dispatchKeyboard } = createControlsEnvironment(testContext);
  dispatchKeyboard("keydown", "KeyW");
  dispatchKeyboard("keydown", "ShiftLeft");
  assert.equal(controls.capture().moveZ, 1);
  assert.equal(controls.capture().sprint, true);

  dispatchKeyboard("keyup", "KeyW", stickElement);
  dispatchKeyboard("keyup", "ShiftLeft", stickElement);
  assert.equal(controls.capture().moveZ, 0);
  assert.equal(controls.capture().sprint, false);
});

test("window capture releases a movement arrow before the focused stick consumes keyup", (testContext) => {
  const { controls, stickElement, dispatchKeyboard } = createControlsEnvironment(testContext);
  dispatchKeyboard("keydown", "ArrowUp", undefined, "ArrowUp");
  assert.equal(controls.capture().moveZ, 1);
  dispatchKeyboard("keyup", "ArrowUp", stickElement, "ArrowUp");
  assert.equal(controls.capture().moveZ, 0);
});

test("short reload and jump presses survive one capture after focus changes without staying held", (testContext) => {
  const { controls, stickElement, dispatchKeyboard } = createControlsEnvironment(testContext);
  dispatchKeyboard("keydown", "KeyR");
  dispatchKeyboard("keydown", "Space");
  dispatchKeyboard("keyup", "KeyR", stickElement);
  dispatchKeyboard("keyup", "Space", stickElement);
  const edgeInput = controls.capture();
  assert.equal(edgeInput.reload, true);
  assert.equal(edgeInput.jump, true);
  const releasedInput = controls.capture();
  assert.equal(releasedInput.reload, false);
  assert.equal(releasedInput.jump, false);
});

test("mouse fire releases on blur and numeric captures retain actual aim and weapon values", (testContext) => {
  const { controls, canvas, gameWindow, gameDocument } = createControlsEnvironment(testContext);
  gameDocument.pointerLockElement = canvas;
  canvas.dispatchEvent(Object.assign(new Event("pointerdown"), { pointerType: "mouse", button: 0 }));
  assert.equal(controls.capture().fire, true);
  controls.selectWeapon(4);
  gameDocument.dispatchEvent(Object.assign(new Event("mousemove"), { movementX: 100, movementY: -100 }));
  const aimedInput = controls.capture();
  assert.ok(Math.abs(aimedInput.yaw + 0.22) < 1e-10);
  assert.ok(Math.abs(aimedInput.pitch - 0.22) < 1e-10);
  assert.equal(aimedInput.weapon, 4);
  gameWindow.dispatchEvent(new Event("blur"));
  const neutralInput = controls.capture();
  assert.equal(neutralInput.fire, false);
  assert.equal(neutralInput.weapon, 4);
  assert.equal(neutralInput.yaw, aimedInput.yaw);
});

test("a subcapture mouse fire tap survives once while held fire remains continuous", (testContext) => {
  const { controls, canvas, gameWindow, gameDocument } = createControlsEnvironment(testContext);
  gameDocument.pointerLockElement = canvas;
  const pressFire = () => canvas.dispatchEvent(Object.assign(new Event("pointerdown"), {
    pointerType: "mouse", button: 0,
  }));
  const releaseFire = () => gameWindow.dispatchEvent(Object.assign(new Event("pointerup"), {
    pointerType: "mouse", button: 0,
  }));

  pressFire();
  releaseFire();
  assert.equal(controls.capture().fire, true);
  assert.equal(controls.capture().fire, false);

  pressFire();
  assert.equal(controls.capture().fire, true);
  assert.equal(controls.capture().fire, true);
  releaseFire();
  assert.equal(controls.capture().fire, false);
});

test("disposing controls restores the host canvas accessibility and removes bindings", (testContext) => {
  const { controls, canvas, dispatchKeyboard } = createControlsEnvironment(testContext);
  assert.equal(canvas.tabIndex, 0);
  assert.match(canvas.getAttribute("aria-label"), /Dead Shift/);
  controls.dispose();
  assert.equal(canvas.tabIndex, -1);
  assert.equal(canvas.getAttribute("aria-label"), "Platform game canvas");
  dispatchKeyboard("keydown", "KeyW");
  assert.equal(controls.capture().moveZ, 0);
});
