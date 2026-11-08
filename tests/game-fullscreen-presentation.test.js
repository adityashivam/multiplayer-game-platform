import test from "node:test";
import assert from "node:assert/strict";
import { createFullscreenPresentationController } from "../public/platform/src/platform-ui/services/fullscreenPresentation.js";

function createDeferredRequest() {
  let resolve;
  let reject;
  const promise = new Promise((resolveRequest, rejectRequest) => {
    resolve = resolveRequest;
    reject = rejectRequest;
  });

  return { promise, resolve, reject };
}

function createFullscreenElement() {
  const attributes = new Map();

  return {
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
  };
}

/** Model only the browser fullscreen boundary; the controller owns the lifecycle. */
function createFullscreenBrowser({ width = 1280, height = 720, supported = true, requestFullscreen } = {}) {
  const calls = [];
  const listeners = new Set();
  const root = createFullscreenElement();
  const documentElement = createFullscreenElement();
  const body = createFullscreenElement();
  const viewport = { innerWidth: width, innerHeight: height };
  const fullscreenDocument = {
    documentElement,
    body,
    fullscreenEnabled: supported,
    fullscreenElement: null,
    getElementById: (id) => id === "root" ? root : null,
    addEventListener: (eventName, listener) => {
      assert.equal(eventName, "fullscreenchange");
      listeners.add(listener);
    },
    removeEventListener: (eventName, listener) => {
      assert.equal(eventName, "fullscreenchange");
      listeners.delete(listener);
    },
    exitFullscreen: () => {
      calls.push("exit");
      setNativeFullscreen(null);
      return Promise.resolve();
    },
  };

  function setNativeFullscreen(element) {
    fullscreenDocument.fullscreenElement = element;
    for (const listener of listeners) listener();
  }

  root.requestFullscreen = () => {
    calls.push("request");
    if (requestFullscreen) return requestFullscreen();

    setNativeFullscreen(root);
    return Promise.resolve();
  };

  const controller = createFullscreenPresentationController({
    document: fullscreenDocument,
    window: viewport,
  });

  return { controller, fullscreenDocument, viewport, root, documentElement, body, calls, listeners, setNativeFullscreen };
}

test("landscape launch requests native fullscreen synchronously before navigation", async () => {
  const browser = createFullscreenBrowser();
  const launchRequest = browser.controller.beginGameLaunch();
  browser.calls.push("navigate");

  assert.deepEqual(browser.calls, ["request", "navigate"]);
  assert.deepEqual(await launchRequest, { status: "native" });
  assert.deepEqual(browser.controller.getState(), {
    isFullscreen: true,
    pseudoFullscreen: false,
    fullscreenActive: true,
  });
  await browser.controller.dispose();
});

test("portrait launch waits for an explicit fullscreen action after rotation", async () => {
  const browser = createFullscreenBrowser({ width: 390, height: 844 });

  assert.deepEqual(await browser.controller.beginGameLaunch(), { status: "deferred" });
  assert.deepEqual(browser.calls, []);
  browser.viewport.innerWidth = 844;
  browser.viewport.innerHeight = 390;
  await Promise.resolve();
  assert.deepEqual(browser.calls, []);

  assert.deepEqual(await browser.controller.requestFullscreen(), { status: "native" });
  assert.deepEqual(browser.calls, ["request"]);
  await browser.controller.dispose();
});

test("mounting a shared-link presentation never requests or fabricates fullscreen", async () => {
  const browser = createFullscreenBrowser({ supported: false });

  browser.viewport.innerWidth = 1440;
  await Promise.resolve();
  assert.deepEqual(browser.calls, []);
  assert.equal(browser.controller.getState().fullscreenActive, false);
  assert.equal(browser.documentElement.getAttribute("data-pseudo-fullscreen"), null);
  await browser.controller.dispose();
});

test("a presentation without a browser document remains unavailable and can be disposed", async () => {
  const controller = createFullscreenPresentationController();

  assert.deepEqual(await controller.beginGameLaunch(), { status: "unavailable" });
  assert.deepEqual(await controller.requestFullscreen(), { status: "unavailable" });
  await controller.endGamePresentation();
  await controller.dispose();
  assert.equal(controller.getState().fullscreenActive, false);
});

test("the explicit portrait action can enter fullscreen before orientation locking", async () => {
  const browser = createFullscreenBrowser({ width: 390, height: 844 });
  const fullscreenRequest = browser.controller.requestFullscreen();

  assert.deepEqual(browser.calls, ["request"]);
  assert.deepEqual(await fullscreenRequest, { status: "native" });
  await browser.controller.dispose();
});

test("a launch without browser activation defers native fullscreen until a player action", async () => {
  const browser = createFullscreenBrowser();
  browser.viewport.navigator = { userActivation: { isActive: false } };

  assert.deepEqual(await browser.controller.beginGameLaunch(), { status: "deferred" });
  assert.deepEqual(browser.calls, []);
  assert.equal(browser.controller.getState().fullscreenActive, false);

  browser.viewport.navigator.userActivation.isActive = true;
  const launchRequest = browser.controller.beginGameLaunch();
  assert.deepEqual(browser.calls, ["request"]);
  assert.deepEqual(await launchRequest, { status: "native" });
  await browser.controller.dispose();
});

test("an explicit fullscreen request without browser activation uses pseudo presentation", async () => {
  const browser = createFullscreenBrowser();
  browser.viewport.navigator = { userActivation: { isActive: false } };

  assert.deepEqual(await browser.controller.requestFullscreen(), { status: "pseudo" });
  assert.deepEqual(browser.calls, []);
  assert.equal(browser.controller.getState().pseudoFullscreen, true);
  await browser.controller.dispose();
});

test("unsupported native fullscreen uses and releases the platform pseudo presentation", async () => {
  const browser = createFullscreenBrowser({ supported: false });

  assert.deepEqual(await browser.controller.beginGameLaunch(), { status: "pseudo" });
  assert.deepEqual(browser.calls, []);
  assert.equal(browser.documentElement.getAttribute("data-pseudo-fullscreen"), "true");
  assert.equal(browser.body.getAttribute("data-pseudo-fullscreen"), "true");
  assert.equal(browser.controller.getState().fullscreenActive, true);

  await browser.controller.endGamePresentation();
  assert.equal(browser.documentElement.getAttribute("data-pseudo-fullscreen"), null);
  assert.equal(browser.body.getAttribute("data-pseudo-fullscreen"), null);
  assert.equal(browser.controller.getState().fullscreenActive, false);
  await browser.controller.dispose();
});

for (const rejectionKind of ["promise", "synchronous"]) {
  test(`${rejectionKind} browser denial falls back once and a new launch can retry`, async () => {
    let nativeRequests = 0;
    const browser = createFullscreenBrowser({ requestFullscreen: () => {
      nativeRequests += 1;
      if (rejectionKind === "synchronous") throw new Error("Fullscreen denied");
      return Promise.reject(new Error("Fullscreen denied"));
    } });

    assert.deepEqual(await browser.controller.beginGameLaunch(), { status: "pseudo" });
    assert.equal(browser.controller.getState().pseudoFullscreen, true);
    assert.deepEqual(await browser.controller.beginGameLaunch(), { status: "pseudo" });
    assert.equal(nativeRequests, 1, "Repeated entry calls must not retry a denied browser request");

    await browser.controller.endGamePresentation();
    assert.deepEqual(await browser.controller.beginGameLaunch(), { status: "pseudo" });
    assert.equal(nativeRequests, 2);
    await browser.controller.dispose();
  });
}

test("concurrent launch and manual requests share one pending browser request", async () => {
  const pendingNativeRequest = createDeferredRequest();
  const browser = createFullscreenBrowser({ requestFullscreen: () => pendingNativeRequest.promise });
  const launchRequest = browser.controller.beginGameLaunch();
  const repeatedLaunchRequest = browser.controller.beginGameLaunch();
  const manualRequest = browser.controller.requestFullscreen();

  assert.equal(launchRequest, repeatedLaunchRequest);
  assert.equal(launchRequest, manualRequest);
  assert.deepEqual(browser.calls, ["request"]);

  browser.setNativeFullscreen(browser.root);
  pendingNativeRequest.resolve();
  assert.deepEqual(await launchRequest, { status: "native" });
  await browser.controller.dispose();
});

test("returning to the library releases a late native fullscreen completion", async () => {
  const pendingNativeRequest = createDeferredRequest();
  const browser = createFullscreenBrowser({ requestFullscreen: () => pendingNativeRequest.promise });
  const launchRequest = browser.controller.beginGameLaunch();

  await browser.controller.endGamePresentation();
  browser.setNativeFullscreen(browser.root);
  pendingNativeRequest.resolve();

  assert.deepEqual(await launchRequest, { status: "cancelled" });
  assert.equal(browser.fullscreenDocument.fullscreenElement, null);
  assert.equal(browser.controller.getState().fullscreenActive, false);
  assert.deepEqual(browser.calls, ["request", "exit"]);
  await browser.controller.dispose();
});

test("a rejected browser request after returning cannot re-enable pseudo fullscreen", async () => {
  const pendingNativeRequest = createDeferredRequest();
  const browser = createFullscreenBrowser({ requestFullscreen: () => pendingNativeRequest.promise });
  const launchRequest = browser.controller.beginGameLaunch();

  await browser.controller.endGamePresentation();
  pendingNativeRequest.reject(new Error("Gesture expired"));

  assert.deepEqual(await launchRequest, { status: "cancelled" });
  assert.equal(browser.controller.getState().fullscreenActive, false);
  assert.equal(browser.documentElement.getAttribute("data-pseudo-fullscreen"), null);
  await browser.controller.dispose();
});

test("an obsolete rejection cannot override a newer game launch", async () => {
  const oldNativeRequest = createDeferredRequest();
  const newNativeRequest = createDeferredRequest();
  let nativeRequests = 0;
  const browser = createFullscreenBrowser({ requestFullscreen: () => {
    nativeRequests += 1;
    return nativeRequests === 1 ? oldNativeRequest.promise : newNativeRequest.promise;
  } });
  const oldLaunchRequest = browser.controller.beginGameLaunch();
  await browser.controller.endGamePresentation();
  const newLaunchRequest = browser.controller.beginGameLaunch();

  oldNativeRequest.reject(new Error("Old gesture expired"));
  assert.deepEqual(await oldLaunchRequest, { status: "cancelled" });
  assert.equal(browser.controller.getState().pseudoFullscreen, false);
  assert.equal(browser.documentElement.getAttribute("data-pseudo-fullscreen"), null);

  browser.setNativeFullscreen(browser.root);
  newNativeRequest.resolve();
  assert.deepEqual(await newLaunchRequest, { status: "native" });
  assert.deepEqual(browser.calls, ["request", "request"]);
  await browser.controller.dispose();
});

test("an obsolete success cannot exit fullscreen held by a newer game launch", async () => {
  const oldNativeRequest = createDeferredRequest();
  const newNativeRequest = createDeferredRequest();
  let nativeRequests = 0;
  const browser = createFullscreenBrowser({ requestFullscreen: () => {
    nativeRequests += 1;
    return nativeRequests === 1 ? oldNativeRequest.promise : newNativeRequest.promise;
  } });
  const oldLaunchRequest = browser.controller.beginGameLaunch();
  await browser.controller.endGamePresentation();
  const newLaunchRequest = browser.controller.beginGameLaunch();

  browser.setNativeFullscreen(browser.root);
  newNativeRequest.resolve();
  assert.deepEqual(await newLaunchRequest, { status: "native" });
  oldNativeRequest.resolve();
  assert.deepEqual(await oldLaunchRequest, { status: "cancelled" });
  assert.equal(browser.fullscreenDocument.fullscreenElement, browser.root);
  assert.deepEqual(browser.calls, ["request", "request"]);
  await browser.controller.dispose();
});

test("Escape updates presentation without automatically requesting fullscreen again", async () => {
  const browser = createFullscreenBrowser();
  const observedStates = [];
  const unsubscribe = browser.controller.subscribe((presentationState) => observedStates.push(presentationState));
  await browser.controller.beginGameLaunch();

  browser.setNativeFullscreen(null);
  browser.viewport.innerWidth = 1400;
  await Promise.resolve();

  assert.equal(browser.controller.getState().fullscreenActive, false);
  assert.equal(observedStates.at(-1).fullscreenActive, false);
  assert.deepEqual(browser.calls, ["request"]);
  assert.deepEqual(await browser.controller.requestFullscreen(), { status: "native" });
  assert.deepEqual(browser.calls, ["request", "request"]);
  unsubscribe();
  await browser.controller.dispose();
});

test("Escape before request settlement cannot be replaced by pseudo fullscreen", async () => {
  const pendingNativeRequest = createDeferredRequest();
  const browser = createFullscreenBrowser({ requestFullscreen: () => pendingNativeRequest.promise });
  const launchRequest = browser.controller.beginGameLaunch();

  browser.setNativeFullscreen(browser.root);
  browser.setNativeFullscreen(null);
  pendingNativeRequest.reject(new Error("Fullscreen cancelled"));

  assert.deepEqual(await launchRequest, { status: "cancelled" });
  assert.equal(browser.controller.getState().fullscreenActive, false);
  assert.equal(browser.documentElement.getAttribute("data-pseudo-fullscreen"), null);
  assert.deepEqual(browser.calls, ["request"]);
  await browser.controller.dispose();
});

test("return and disposal preserve native fullscreen that predates platform ownership", async () => {
  for (const usePlatformRoot of [false, true]) {
    const browser = createFullscreenBrowser();
    const preexistingElement = usePlatformRoot ? browser.root : createFullscreenElement();
    browser.setNativeFullscreen(preexistingElement);

    assert.deepEqual(await browser.controller.beginGameLaunch(), { status: "native" });
    await browser.controller.endGamePresentation();
    await browser.controller.dispose();

    assert.equal(browser.fullscreenDocument.fullscreenElement, preexistingElement);
    assert.deepEqual(browser.calls, []);
  }
});

test("disposing a pending launch cleans its late completion without notifying detached consumers", async () => {
  const pendingNativeRequest = createDeferredRequest();
  const browser = createFullscreenBrowser({ requestFullscreen: () => pendingNativeRequest.promise });
  let notifications = 0;
  browser.controller.subscribe(() => { notifications += 1; });
  const launchRequest = browser.controller.beginGameLaunch();

  await browser.controller.dispose();
  const notificationsAtDisposal = notifications;
  assert.equal(browser.listeners.size, 0);
  browser.setNativeFullscreen(browser.root);
  pendingNativeRequest.resolve();

  assert.deepEqual(await launchRequest, { status: "cancelled" });
  assert.equal(browser.fullscreenDocument.fullscreenElement, null);
  assert.equal(notifications, notificationsAtDisposal);
  assert.deepEqual(await browser.controller.beginGameLaunch(), { status: "cancelled" });
  assert.deepEqual(browser.calls, ["request", "exit"]);
});

test("pseudo cleanup restores attributes that existed before this controller", async () => {
  const browser = createFullscreenBrowser({ supported: false });
  browser.documentElement.setAttribute("data-pseudo-fullscreen", "external");
  browser.body.setAttribute("data-pseudo-fullscreen", "true");

  await browser.controller.beginGameLaunch();
  await browser.controller.endGamePresentation();

  assert.equal(browser.documentElement.getAttribute("data-pseudo-fullscreen"), "external");
  assert.equal(browser.body.getAttribute("data-pseudo-fullscreen"), "true");
  await browser.controller.dispose();
});
