const LANDSCAPE_ORIENTATION = "landscape";

/** @typedef {{status:"locked"|"unsupported"|"denied"|"cancelled"}} GameOrientationResult */
/** @typedef {{lock?:(orientation:"landscape")=>Promise<void>,unlock?:()=>void}} GameScreenOrientation */

/**
 * Own browser orientation requests for one platform. Native failures are normal
 * capabilities, not game-loading errors. Fullscreen requires an explicit action.
 * @param {{orientation?:GameScreenOrientation,requestFullscreen?:()=>Promise<void>}} options
 */
export function createGameOrientationController({ orientation, requestFullscreen } = {}) {
  let sessionVersion = 0;
  let active = false;
  let locked = false;
  /** @type {{version:number,enterFullscreen:boolean,promise:Promise<GameOrientationResult>}|null} */
  let pendingRequest = null;

  function releaseOrientation() {
    try { orientation?.unlock?.(); } catch { /* A browser can reject cleanup after leaving fullscreen. */ }
    locked = false;
  }

  /** @param {{enterFullscreen?:boolean}} [options] @returns {Promise<GameOrientationResult>} */
  function requestLandscape({ enterFullscreen = false } = {}) {
    if (!active) return Promise.resolve({ status: "cancelled" });
    if (typeof orientation?.lock !== "function") return Promise.resolve({ status: "unsupported" });
    // A fullscreen gesture upgrades a pending automatic request immediately.
    if (pendingRequest?.version === sessionVersion && (!enterFullscreen || pendingRequest.enterFullscreen)) return pendingRequest.promise;
    const version = sessionVersion;

    /** @type {Promise<GameOrientationResult>} */
    const promise = (async () => {
      try {
        if (enterFullscreen) await requestFullscreen?.();
        if (!active || version !== sessionVersion) return { status: "cancelled" };
        await orientation.lock(LANDSCAPE_ORIENTATION);
        if (!active || version !== sessionVersion) {
          if (!active) releaseOrientation();
          return { status: "cancelled" };
        }
        locked = true;
        return { status: "locked" };
      } catch {
        return { status: !active || version !== sessionVersion ? "cancelled" : "denied" };
      }
    })();
    const request = { version, enterFullscreen, promise };
    pendingRequest = request;
    void promise.then(() => {
      if (pendingRequest === request) pendingRequest = null;
    });
    return promise;
  }

  return {
    startSession() { sessionVersion += 1; active = true; },
    stopSession() {
      if (!active) return;
      active = false;
      sessionVersion += 1;
      if (locked || pendingRequest) releaseOrientation();
    },
    canLockOrientation: () => typeof orientation?.lock === "function",
    requestLandscape,
  };
}
