import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { bindAnalogStick } from "../public/platform/frontend-engine/analogStick.js";
import { createPredictedInputSession } from "../public/platform/frontend-engine/predictedInputSession.js";
import { bindTouchControlSurface } from "../public/platform/frontend-engine/touchControlSurface.js";
import { createDefaultTouchProfile, resolveTouchLayout } from "../public/platform/shared/touchControls.js";
import { DEAD_SHIFT_FIXED_DT_SEC } from "../public/games/dead-shift/shared/config.js";
import { createDeadShiftPlayer, stepDeadShiftPlayer } from "../public/games/dead-shift/shared/simulation.js";
import { deadShiftTouchControls } from "../public/games/dead-shift/shared/touchControls.js";

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
  let modalOpen = false;
  let platformTouchActive = false;
  let synchronizeModalState = () => {};
  gameDocument.querySelector = (selector) => {
    if (selector.includes("data-platform-touch-game")) {
      return platformTouchActive ? { dataset: { platformTouchGame: "dead-shift", active: "true" } } : null;
    }
    return modalOpen ? {} : null;
  };
  gameDocument.exitPointerLock = () => { gameDocument.pointerLockElement = null; };
  const canvas = new EventTarget();
  const canvasAttributes = new Map([["aria-label", "Platform game canvas"]]);
  canvas.tabIndex = -1;
  canvas.getAttribute = (attributeName) => canvasAttributes.get(attributeName) ?? null;
  canvas.setAttribute = (attributeName, attributeValue) => canvasAttributes.set(attributeName, attributeValue);
  canvas.removeAttribute = (attributeName) => canvasAttributes.delete(attributeName);
  canvas.closest = () => null;
  canvas.focus = () => { gameDocument.activeElement = canvas; };
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 500 });
  canvas.setPointerCapture = () => {};
  const stickElement = new EventTarget();
  stickElement.ownerDocument = gameDocument;
  stickElement.dataset = { stick: "left" };
  stickElement.style = { setProperty() {} };
  stickElement.closest = () => stickElement;
  gameDocument.querySelectorAll = (selector) => {
    if (selector === '[data-stick="left"]') return [stickElement];
    if (selector.includes("data-platform-touch-game") && platformTouchActive) {
      return [{ dataset: { platformTouchGame: "dead-shift", active: "true" } }];
    }
    return [];
  };
  const stickBinding = bindAnalogStick(stickElement);
  globalThis.window = gameWindow;
  globalThis.document = gameDocument;
  globalThis.MutationObserver = class {
    constructor(listener) { synchronizeModalState = listener; }
    observe() {}
    disconnect() {}
  };
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

  return {
    controls, canvas, stickElement, gameWindow, gameDocument, dispatchKeyboard,
    dispatchTouch(touchEvent) {
      gameWindow.dispatchEvent(new CustomEvent("platformtouchinput", { detail: { gameId: "dead-shift", ...touchEvent } }));
    },
    setPlatformTouchActive(active) { platformTouchActive = active; },
    setModalOpen(open) { modalOpen = open; synchronizeModalState(); },
  };
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

test("platform touch movement and relative look map into the existing numeric input schema", (testContext) => {
  const { controls, dispatchTouch } = createControlsEnvironment(testContext);
  dispatchTouch({ type: "axis", controlId: "move", x: 0.6, y: -0.8 });
  dispatchTouch({ type: "look", controlId: "look", deltaX: 40, deltaY: -20 });
  const touchInput = controls.capture();
  assert.equal(touchInput.moveX, 0.6);
  assert.equal(touchInput.moveZ, 0.8);
  assert.ok(Math.abs(touchInput.yaw + 0.16) < 1e-10);
  assert.ok(Math.abs(touchInput.pitch - 0.08) < 1e-10);
  dispatchTouch({ gameId: "another-game", type: "axis", controlId: "move", x: -1, y: 0 });
  assert.equal(controls.capture().moveX, 0.6);
});

test("touch action pulses survive a capture while held fire keeps its independent ownership", (testContext) => {
  const { controls, dispatchTouch, gameWindow } = createControlsEnvironment(testContext);
  dispatchTouch({ type: "action", controlId: "fire", active: true });
  dispatchTouch({ type: "action", controlId: "jump", active: true });
  dispatchTouch({ type: "action", controlId: "jump", active: false });
  dispatchTouch({ type: "action", controlId: "reload", active: true });
  dispatchTouch({ type: "action", controlId: "reload", active: false });
  const actionInput = controls.capture();
  assert.equal(actionInput.fire, true);
  assert.equal(actionInput.jump, true);
  assert.equal(actionInput.reload, true);

  gameWindow.dispatchEvent(Object.assign(new Event("pointerup"), { pointerType: "touch", pointerId: 3, button: 0 }));
  const heldInput = controls.capture();
  assert.equal(heldInput.fire, true);
  assert.equal(heldInput.jump, false);
  assert.equal(heldInput.reload, false);
  dispatchTouch({ type: "action", controlId: "fire", active: false });
  assert.equal(controls.capture().fire, false);
});

test("weapon cycling reacts once per touch press and hold-and-drag fire rotates the camera", (testContext) => {
  const { controls, dispatchTouch } = createControlsEnvironment(testContext);
  dispatchTouch({ type: "action", controlId: "weapon", active: true });
  dispatchTouch({ type: "action", controlId: "weapon", active: true });
  assert.equal(controls.getWeapon(), 1);
  dispatchTouch({ type: "action", controlId: "weapon", active: false });
  dispatchTouch({ type: "action", controlId: "weapon", active: true });
  assert.equal(controls.getWeapon(), 2);
  dispatchTouch({ type: "look", controlId: "fire", deltaX: 15, deltaY: 10 });
  assert.ok(Math.abs(controls.getAim().yaw + 0.06) < 1e-10);
  assert.ok(Math.abs(controls.getAim().pitch + 0.04) < 1e-10);
});

test("mouse and platform touch hold sources release independently and ADS stays presentation-only", (testContext) => {
  const { controls, canvas, gameDocument, gameWindow, dispatchTouch } = createControlsEnvironment(testContext);
  gameDocument.pointerLockElement = canvas;
  canvas.dispatchEvent(Object.assign(new Event("pointerdown"), { pointerType: "mouse", button: 0 }));
  dispatchTouch({ type: "action", controlId: "fire", active: true });
  canvas.dispatchEvent(Object.assign(new Event("pointerdown"), { pointerType: "mouse", button: 2 }));
  assert.equal(controls.isAiming(), true);
  assert.equal(Object.hasOwn(controls.capture(), "aiming"), false);
  gameWindow.dispatchEvent(Object.assign(new Event("pointerup"), { pointerType: "mouse", button: 2 }));
  assert.equal(controls.isAiming(), false);
  assert.equal(controls.capture().fire, true);
  gameWindow.dispatchEvent(Object.assign(new Event("pointerup"), { pointerType: "mouse", button: 0 }));
  assert.equal(controls.capture().fire, true);
  dispatchTouch({ type: "action", controlId: "fire", active: false });
  assert.equal(controls.capture().fire, false);
});

test("a mouse can aim and fire when its second button does not produce another pointerdown", (testContext) => {
  const { controls, canvas, gameDocument, gameWindow } = createControlsEnvironment(testContext);
  gameDocument.pointerLockElement = canvas;
  canvas.dispatchEvent(Object.assign(new Event("pointerdown"), { pointerType: "mouse", button: 2 }));
  canvas.dispatchEvent(Object.assign(new Event("mousedown"), { button: 2 }));
  canvas.dispatchEvent(Object.assign(new Event("mousedown"), { button: 0 }));
  assert.equal(controls.isAiming(), true);
  assert.equal(controls.capture().fire, true);

  gameWindow.dispatchEvent(Object.assign(new Event("mouseup"), { button: 0 }));
  assert.equal(controls.capture().fire, false);
  assert.equal(controls.isAiming(), true);
  gameWindow.dispatchEvent(Object.assign(new Event("mouseup"), { button: 2 }));
  gameWindow.dispatchEvent(Object.assign(new Event("pointerup"), { pointerType: "mouse", button: 2 }));
  assert.equal(controls.isAiming(), false);
});

test("the arena touch camera defers pointer ownership to an active platform surface", (testContext) => {
  const { controls, canvas, setPlatformTouchActive, gameWindow } = createControlsEnvironment(testContext);
  const touchDown = () => canvas.dispatchEvent(Object.assign(new Event("pointerdown"), {
    pointerType: "touch", pointerId: 4, clientX: 600, clientY: 250,
  }));
  const touchMove = () => canvas.dispatchEvent(Object.assign(new Event("pointermove"), {
    pointerType: "touch", pointerId: 4, clientX: 625, clientY: 250,
  }));
  touchDown();
  touchMove();
  assert.ok(Math.abs(controls.getAim().yaw + 0.1) < 1e-10);
  gameWindow.dispatchEvent(Object.assign(new Event("pointerup"), { pointerType: "touch", pointerId: 4 }));

  setPlatformTouchActive(true);
  touchDown();
  touchMove();
  assert.ok(Math.abs(controls.getAim().yaw + 0.1) < 1e-10);
});

test("modal, blur, visibility and SDK reset clear local touch input without losing camera or weapon", (testContext) => {
  const { controls, dispatchTouch, gameWindow, gameDocument, setModalOpen } = createControlsEnvironment(testContext);
  controls.selectWeapon(3);
  const holdTouchInput = () => {
    dispatchTouch({ type: "axis", controlId: "move", x: 1, y: 0 });
    dispatchTouch({ type: "action", controlId: "fire", active: true });
    dispatchTouch({ type: "action", controlId: "aim", active: true });
  };
  const assertNeutral = () => {
    const neutralInput = controls.capture();
    assert.equal(neutralInput.moveX, 0);
    assert.equal(neutralInput.fire, false);
    assert.equal(neutralInput.weapon, 3);
    assert.equal(controls.isAiming(), false);
  };
  holdTouchInput();
  setModalOpen(true);
  assertNeutral();
  holdTouchInput();
  dispatchTouch({ type: "look", controlId: "look", deltaX: 30, deltaY: 0 });
  assertNeutral();
  assert.equal(controls.getAim().yaw, 0);
  setModalOpen(false);

  holdTouchInput();
  gameWindow.dispatchEvent(new Event("blur"));
  assertNeutral();
  holdTouchInput();
  gameDocument.hidden = true;
  gameDocument.dispatchEvent(new Event("visibilitychange"));
  assertNeutral();
  gameDocument.hidden = false;
  holdTouchInput();
  dispatchTouch({ type: "reset" });
  assertNeutral();
  controls.dispose();
  holdTouchInput();
  assertNeutral();
});

test("a platform touch reset releases only touch-owned input while keyboard and mouse stay held", (testContext) => {
  const { controls, canvas, gameDocument, gameWindow, dispatchKeyboard, dispatchTouch } = createControlsEnvironment(testContext);
  dispatchKeyboard("keydown", "KeyW");
  gameDocument.pointerLockElement = canvas;
  canvas.dispatchEvent(Object.assign(new Event("pointerdown"), { pointerType: "mouse", button: 0 }));
  dispatchTouch({ type: "axis", controlId: "move", x: 0.5, y: 0 });
  dispatchTouch({ type: "action", controlId: "fire", active: true });
  dispatchTouch({ type: "action", controlId: "aim", active: true });
  controls.capture();

  dispatchTouch({ type: "reset" });
  const remainingInput = controls.capture();
  assert.equal(remainingInput.moveX, 0);
  assert.equal(remainingInput.moveZ, 1);
  assert.equal(remainingInput.fire, true);
  assert.equal(controls.isAiming(), false);
  gameWindow.dispatchEvent(Object.assign(new Event("pointerup"), { pointerType: "mouse", button: 0 }));
  assert.equal(controls.capture().fire, false);
  dispatchKeyboard("keyup", "KeyW");
  assert.equal(controls.capture().moveZ, 0);
});

test("touch reset drops pending touch pulses while preserving pending keyboard and mouse presses", (testContext) => {
  const { controls, canvas, gameDocument, gameWindow, dispatchKeyboard, dispatchTouch } = createControlsEnvironment(testContext);
  dispatchKeyboard("keydown", "Space");
  dispatchKeyboard("keyup", "Space");
  gameDocument.pointerLockElement = canvas;
  canvas.dispatchEvent(Object.assign(new Event("pointerdown"), { pointerType: "mouse", button: 0 }));
  gameWindow.dispatchEvent(Object.assign(new Event("pointerup"), { pointerType: "mouse", button: 0 }));
  dispatchTouch({ type: "action", controlId: "reload", active: true });
  dispatchTouch({ type: "action", controlId: "reload", active: false });
  dispatchTouch({ type: "reset" });

  const preservedInput = controls.capture();
  assert.equal(preservedInput.jump, true);
  assert.equal(preservedInput.fire, true);
  assert.equal(preservedInput.reload, false);
  const releasedInput = controls.capture();
  assert.equal(releasedInput.jump, false);
  assert.equal(releasedInput.fire, false);
});

test("touch commands use existing SDK ownership, prediction and reset without sending local ADS", (testContext) => {
  const { controls, dispatchTouch } = createControlsEnvironment(testContext);
  const sentPackets = [];
  const playerState = createDeadShiftPlayer("p1");
  const predictedInputSession = createPredictedInputSession({
    fixedDtSec: DEAD_SHIFT_FIXED_DT_SEC,
    captureInput: controls.capture,
    sendInput: (inputPacket) => sentPackets.push(inputPacket),
    simulate: stepDeadShiftPlayer,
    extractPose: (predictedPlayer) => ({ x: predictedPlayer.x, y: predictedPlayer.y, z: predictedPlayer.z }),
  });
  testContext.after(() => predictedInputSession.stop());
  predictedInputSession.receiveAuthority({
    state: playerState,
    protocol: 2,
    inputEpoch: 7,
    acknowledgedSequence: 0,
    context: { active: true },
  });
  dispatchTouch({ type: "axis", controlId: "move", x: 0.5, y: -0.5 });
  dispatchTouch({ type: "action", controlId: "fire", active: true });
  dispatchTouch({ type: "action", controlId: "fire", active: false });
  dispatchTouch({ type: "action", controlId: "aim", active: true });
  predictedInputSession.captureAndPredict();
  assert.equal(sentPackets[0].epoch, 7);
  assert.equal(sentPackets[0].seq, 1);
  assert.equal(sentPackets[0].state.moveX, 0.5);
  assert.equal(sentPackets[0].state.fire, true);
  assert.equal(Object.hasOwn(sentPackets[0].state, "aiming"), false);
  assert.ok(predictedInputSession.getState().x > playerState.x);
  assert.equal(predictedInputSession.getState().ammo, playerState.ammo);
  predictedInputSession.captureAndPredict();
  assert.equal(sentPackets[1].state.fire, false);

  controls.reset();
  predictedInputSession.reset();
  assert.equal(predictedInputSession.captureAndPredict(), null);
  predictedInputSession.receiveAuthority({
    state: playerState,
    protocol: 2,
    inputEpoch: 8,
    acknowledgedSequence: 0,
    context: { active: true },
  });
  predictedInputSession.captureAndPredict();
  assert.equal(sentPackets[2].epoch, 8);
  assert.equal(sentPackets[2].seq, 1);
  assert.equal(sentPackets[2].state.moveX, 0);
  assert.equal(sentPackets[2].state.fire, false);
  assert.equal(controls.isAiming(), false);
});

test("four real surface pointers move, look, fire and aim without one release cancelling another action", (testContext) => {
  const { controls, canvas, gameDocument, setPlatformTouchActive } = createControlsEnvironment(testContext);
  const host = new EventTarget();
  host.style = { touchAction: "" };
  const capturedPointers = new Set();
  host.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 500 });
  host.setPointerCapture = (pointerId) => capturedPointers.add(pointerId);
  host.hasPointerCapture = (pointerId) => capturedPointers.has(pointerId);
  host.releasePointerCapture = (pointerId) => capturedPointers.delete(pointerId);
  const controlElements = new Map(deadShiftTouchControls.controls.filter((control) => control.type !== "look").map((control) => {
    const controlElement = {
      dataset: { touchControlId: control.id },
      style: { setProperty() {} },
      getBoundingClientRect: () => ({ left: 100, top: 300, width: 128, height: 128 }),
      closest: () => controlElement,
    };
    return [control.id, controlElement];
  }));
  const touchSurface = {
    ownerDocument: gameDocument,
    parentElement: host,
    dataset: { active: "true" },
    querySelectorAll: () => [...controlElements.values()],
  };
  const touchBinding = bindTouchControlSurface({
    element: touchSurface,
    gameId: "dead-shift",
    descriptor: deadShiftTouchControls,
    layout: resolveTouchLayout(deadShiftTouchControls, createDefaultTouchProfile(deadShiftTouchControls), "landscape"),
  });
  testContext.after(() => touchBinding.dispose());
  setPlatformTouchActive(true);
  function dispatchPointer(type, pointerId, target, clientX, clientY) {
    const pointerEvent = Object.assign(new Event(type, { cancelable: true }), {
      pointerId, pointerType: "touch", button: 0, clientX, clientY,
    });
    Object.defineProperty(pointerEvent, "target", { value: target });
    host.dispatchEvent(pointerEvent);
  }

  dispatchPointer("pointerdown", 1, controlElements.get("move"), 228, 364);
  dispatchPointer("pointerdown", 2, canvas, 600, 200);
  dispatchPointer("pointerdown", 3, controlElements.get("fire"), 700, 400);
  dispatchPointer("pointerdown", 4, controlElements.get("aim"), 650, 300);
  dispatchPointer("pointermove", 2, canvas, 615, 200);
  dispatchPointer("pointermove", 3, controlElements.get("fire"), 710, 400);
  assert.equal(controls.capture().moveX, 1);
  assert.ok(Math.abs(controls.getAim().yaw + 0.1) < 1e-10);
  assert.equal(controls.isAiming(), true);
  assert.equal(capturedPointers.size, 4);

  dispatchPointer("pointerup", 1, controlElements.get("move"), 228, 364);
  dispatchPointer("pointercancel", 2, canvas, 615, 200);
  const remainingInput = controls.capture();
  assert.equal(remainingInput.moveX, 0);
  assert.equal(remainingInput.fire, true);
  assert.equal(controls.isAiming(), true);
  dispatchPointer("pointerup", 4, controlElements.get("aim"), 650, 300);
  assert.equal(controls.isAiming(), false);
  assert.equal(controls.capture().fire, true);
  dispatchPointer("pointerup", 3, controlElements.get("fire"), 710, 400);
  assert.equal(controls.capture().fire, false);
  assert.equal(capturedPointers.size, 0);
});
