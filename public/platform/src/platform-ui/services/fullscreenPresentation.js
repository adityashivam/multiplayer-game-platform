const PLATFORM_ROOT_ID = "root";
const FULLSCREEN_CHANGE_EVENT = "fullscreenchange";
const PSEUDO_FULLSCREEN_ATTRIBUTE = "data-pseudo-fullscreen";

/** @typedef {{status:"native"|"pseudo"|"deferred"|"cancelled"|"unavailable"}} FullscreenPresentationResult */
/** @typedef {{isFullscreen:boolean,pseudoFullscreen:boolean,fullscreenActive:boolean}} FullscreenPresentationState */
/**
 * @typedef {Object} FullscreenPresentationElement
 * @property {()=>Promise<void>|void} [requestFullscreen]
 * @property {(name:string)=>string|null} getAttribute
 * @property {(name:string,value:string)=>void} setAttribute
 * @property {(name:string)=>void} removeAttribute
 */
/**
 * @typedef {Object} FullscreenPresentationDocument
 * @property {FullscreenPresentationElement|null} fullscreenElement
 * @property {boolean} [fullscreenEnabled]
 * @property {FullscreenPresentationElement} documentElement
 * @property {FullscreenPresentationElement|null} body
 * @property {(id:string)=>FullscreenPresentationElement|null} getElementById
 * @property {(eventName:"fullscreenchange",listener:()=>void)=>void} addEventListener
 * @property {(eventName:"fullscreenchange",listener:()=>void)=>void} removeEventListener
 * @property {()=>Promise<void>|void} [exitFullscreen]
 */
/**
 * @typedef {Object} FullscreenPresentationWindow
 * @property {number} innerWidth
 * @property {number} innerHeight
 * @property {{userActivation?:{isActive:boolean}}} [navigator]
 */
/**
 * @typedef {Object} NativeFullscreenRequest
 * @property {number} version
 * @property {FullscreenPresentationElement} target
 * @property {boolean} entered
 * @property {boolean} exited
 * @property {Promise<FullscreenPresentationResult>} promise
 */

/**
 * Own platform fullscreen without navigation, rendering or game dependencies.
 * Call launch and manual entry methods directly from the player gesture: native
 * requests run synchronously and are never retried by viewport or route events.
 * Only fullscreen entered by this controller is released during cleanup.
 * @param {{document?:FullscreenPresentationDocument,window?:FullscreenPresentationWindow}} [options]
 */
export function createFullscreenPresentationController({ document: fullscreenDocument, window: fullscreenWindow } = {}) {
  let sessionVersion = 0;
  let active = false;
  let disposed = false;
  let pseudoFullscreen = false;
  /** @type {FullscreenPresentationElement|null} */
  let ownedNativeTarget = null;
  /** @type {NativeFullscreenRequest|null} */
  let pendingRequest = null;
  /** @type {{target:FullscreenPresentationElement,promise:Promise<void>}|null} */
  let pendingNativeExit = null;
  /** @type {{element:FullscreenPresentationElement,previousValue:string|null}[]} */
  let pseudoAttributes = [];
  /** @type {Set<NativeFullscreenRequest>} */
  const unsettledRequests = new Set();
  /** @type {Set<(presentationState:FullscreenPresentationState)=>void>} */
  const subscribers = new Set();

  /** @returns {FullscreenPresentationState} */
  function getState() {
    const isFullscreen = Boolean(fullscreenDocument?.fullscreenElement);

    return { isFullscreen, pseudoFullscreen, fullscreenActive: isFullscreen || pseudoFullscreen };
  }

  function publishPresentationState() {
    if (disposed) return;

    const presentationState = getState();
    for (const subscriber of subscribers) subscriber(presentationState);
  }

  /** Save the attributes we change so unrelated presentation ownership survives. */
  function enablePseudoFullscreen() {
    if (pseudoFullscreen) return;

    const elements = [fullscreenDocument?.documentElement, fullscreenDocument?.body];
    pseudoAttributes = elements.filter(Boolean).map((element) => ({
      element,
      previousValue: element.getAttribute(PSEUDO_FULLSCREEN_ATTRIBUTE),
    }));
    for (const { element } of pseudoAttributes) element.setAttribute(PSEUDO_FULLSCREEN_ATTRIBUTE, "true");
    pseudoFullscreen = true;
    publishPresentationState();
  }

  function releasePseudoFullscreen() {
    for (const { element, previousValue } of pseudoAttributes) {
      if (element.getAttribute(PSEUDO_FULLSCREEN_ATTRIBUTE) !== "true") continue;

      if (previousValue === null) {
        element.removeAttribute(PSEUDO_FULLSCREEN_ATTRIBUTE);
      } else {
        element.setAttribute(PSEUDO_FULLSCREEN_ATTRIBUTE, previousValue);
      }
    }
    pseudoAttributes = [];
    pseudoFullscreen = false;
  }

  /** @param {FullscreenPresentationElement} target @returns {Promise<void>} */
  function releaseNativeFullscreen(target) {
    if (fullscreenDocument?.fullscreenElement !== target || typeof fullscreenDocument.exitFullscreen !== "function") {
      return Promise.resolve();
    }
    if (pendingNativeExit?.target === target) return pendingNativeExit.promise;

    /** @type {()=>void} */
    let finishExit;
    /** @type {Promise<void>} */
    const promise = new Promise((resolve) => { finishExit = resolve; });
    const nativeExit = { target, promise };
    pendingNativeExit = nativeExit;

    function completeNativeExit() {
      if (pendingNativeExit === nativeExit) pendingNativeExit = null;
      publishPresentationState();
      finishExit();
    }

    try {
      Promise.resolve(fullscreenDocument.exitFullscreen()).then(completeNativeExit, completeNativeExit);
    } catch {
      completeNativeExit();
    }

    return promise;
  }

  /** @param {FullscreenPresentationElement} target */
  function hasUnsettledNativeRequest(target) {
    return [...unsettledRequests].some((nativeRequest) => nativeRequest.target === target);
  }

  function recordFullscreenChange() {
    const fullscreenElement = fullscreenDocument?.fullscreenElement;

    if (ownedNativeTarget !== fullscreenElement) ownedNativeTarget = null;
    if (pendingRequest?.version === sessionVersion) {
      if (fullscreenElement === pendingRequest.target) {
        pendingRequest.entered = true;
        ownedNativeTarget = pendingRequest.target;
      } else if (pendingRequest.entered) {
        pendingRequest.exited = true;
      }
    }

    if (!active && fullscreenElement && hasUnsettledNativeRequest(fullscreenElement)) {
      void releaseNativeFullscreen(fullscreenElement);
    }
    publishPresentationState();
  }

  fullscreenDocument?.addEventListener(FULLSCREEN_CHANGE_EVENT, recordFullscreenChange);

  function startPresentationSession() {
    if (active) return;

    sessionVersion += 1;
    active = true;
  }

  /** @param {NativeFullscreenRequest} nativeRequest */
  function isCurrentNativeRequest(nativeRequest) {
    return active && !disposed && nativeRequest.version === sessionVersion;
  }

  /** @param {NativeFullscreenRequest} nativeRequest @returns {Promise<FullscreenPresentationResult>} */
  async function completeNativeRequest(nativeRequest) {
    if (pendingRequest === nativeRequest) pendingRequest = null;
    unsettledRequests.delete(nativeRequest);

    if (!isCurrentNativeRequest(nativeRequest)) {
      const newerSessionOwnsTarget = active && (ownedNativeTarget === nativeRequest.target || pendingRequest?.target === nativeRequest.target);
      if (!newerSessionOwnsTarget) await releaseNativeFullscreen(nativeRequest.target);
      return { status: "cancelled" };
    }
    if (nativeRequest.exited || fullscreenDocument?.fullscreenElement !== nativeRequest.target) {
      return { status: "cancelled" };
    }

    ownedNativeTarget = nativeRequest.target;
    publishPresentationState();
    return { status: "native" };
  }

  /** @param {NativeFullscreenRequest} nativeRequest @returns {FullscreenPresentationResult} */
  function rejectNativeRequest(nativeRequest) {
    if (pendingRequest === nativeRequest) pendingRequest = null;
    unsettledRequests.delete(nativeRequest);

    if (!isCurrentNativeRequest(nativeRequest) || nativeRequest.exited) return { status: "cancelled" };
    if (fullscreenDocument?.fullscreenElement === nativeRequest.target) {
      ownedNativeTarget = nativeRequest.target;
      publishPresentationState();
      return { status: "native" };
    }

    enablePseudoFullscreen();
    return { status: "pseudo" };
  }

  /**
   * Request native fullscreen during the current player gesture. Pending entry
   * calls coalesce; native denial and unsupported APIs use pseudo fullscreen.
   * @returns {Promise<FullscreenPresentationResult>}
   */
  function requestFullscreen() {
    if (disposed) return Promise.resolve({ status: "cancelled" });
    if (!fullscreenDocument) return Promise.resolve({ status: "unavailable" });

    startPresentationSession();
    if (pendingRequest?.version === sessionVersion) return pendingRequest.promise;

    const target = fullscreenDocument.getElementById(PLATFORM_ROOT_ID) || fullscreenDocument.documentElement;
    const fullscreenElement = fullscreenDocument.fullscreenElement;
    if (fullscreenElement && pendingNativeExit?.target !== fullscreenElement) {
      if (fullscreenElement === target && hasUnsettledNativeRequest(target)) ownedNativeTarget = target;
      publishPresentationState();
      return Promise.resolve({ status: "native" });
    }
    if (pseudoFullscreen) return Promise.resolve({ status: "pseudo" });
    if (!target) return Promise.resolve({ status: "unavailable" });

    const nativeSupported = fullscreenDocument.fullscreenEnabled !== false && typeof target.requestFullscreen === "function";
    const activationAvailable = fullscreenWindow?.navigator?.userActivation?.isActive !== false;
    if (!nativeSupported || !activationAvailable) {
      enablePseudoFullscreen();
      return Promise.resolve({ status: "pseudo" });
    }

    /** @type {(presentationResult:FullscreenPresentationResult)=>void} */
    let finishRequest;
    /** @type {Promise<FullscreenPresentationResult>} */
    const promise = new Promise((resolve) => { finishRequest = resolve; });
    const nativeRequest = { version: sessionVersion, target, entered: false, exited: false, promise };
    pendingRequest = nativeRequest;
    unsettledRequests.add(nativeRequest);

    try {
      // Keep this invocation before any Promise continuation: browsers consume
      // transient activation from the original Play or Fullscreen action here.
      const browserRequest = target.requestFullscreen();
      Promise.resolve(browserRequest).then(
        () => completeNativeRequest(nativeRequest),
        () => rejectNativeRequest(nativeRequest),
      ).then(finishRequest);
    } catch {
      finishRequest(rejectNativeRequest(nativeRequest));
    }

    return promise;
  }

  /**
   * Start a game from its Play gesture. Portrait and inactive entry points keep
   * the full-window game view and leave native entry to a later labeled action.
   * @returns {Promise<FullscreenPresentationResult>}
   */
  function beginGameLaunch() {
    if (disposed) return Promise.resolve({ status: "cancelled" });
    if (!fullscreenDocument) return Promise.resolve({ status: "unavailable" });

    startPresentationSession();
    const landscape = Boolean(fullscreenWindow && fullscreenWindow.innerWidth > fullscreenWindow.innerHeight);
    if (!landscape || fullscreenWindow?.navigator?.userActivation?.isActive === false) {
      return Promise.resolve({ status: "deferred" });
    }

    return requestFullscreen();
  }

  /** Invalidate pending entry before releasing only our native and pseudo state. @returns {Promise<void>} */
  function endGamePresentation() {
    const pendingNativeTarget = pendingRequest && pendingRequest.target === fullscreenDocument?.fullscreenElement ? pendingRequest.target : null;
    const nativeTarget = ownedNativeTarget || pendingNativeTarget;
    active = false;
    sessionVersion += 1;
    pendingRequest = null;
    ownedNativeTarget = null;
    releasePseudoFullscreen();
    publishPresentationState();

    return nativeTarget ? releaseNativeFullscreen(nativeTarget) : Promise.resolve();
  }

  /** @returns {Promise<FullscreenPresentationResult>|Promise<void>} */
  function toggleFullscreen() {
    return getState().fullscreenActive ? endGamePresentation() : requestFullscreen();
  }

  /** @param {(presentationState:FullscreenPresentationState)=>void} subscriber @returns {()=>void} */
  function subscribe(subscriber) {
    if (disposed) return () => {};

    subscribers.add(subscriber);
    return () => {
      subscribers.delete(subscriber);
    };
  }

  /** Release subscriptions and ownership; late browser completion still cleans up. @returns {Promise<void>} */
  function dispose() {
    disposed = true;
    subscribers.clear();
    fullscreenDocument?.removeEventListener(FULLSCREEN_CHANGE_EVENT, recordFullscreenChange);
    return endGamePresentation();
  }

  return { beginGameLaunch, requestFullscreen, endGamePresentation, toggleFullscreen, subscribe, getState, dispose };
}
