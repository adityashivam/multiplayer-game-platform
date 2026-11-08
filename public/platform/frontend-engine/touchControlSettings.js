import { sanitizeTouchProfile } from "../shared/touchControls.js";

const TOUCH_PROFILE_STORAGE_PREFIX = "platform.touch-controls.v1";
const TOUCH_PROFILE_CHANGE_EVENT = "platformtouchprofilechange";
const TOUCH_PROFILE_SESSION_CACHE = Symbol.for("platform.touch-controls.session.v1");
const MAX_SESSION_TOUCH_PROFILES = 128;
const MAX_STORED_PROFILE_LENGTH = 32768;
const serverSessionProfiles = new Map();

/**
 * @typedef {import("../shared/touchControls.js").TouchControlsDescriptor} TouchControlsDescriptor
 * @typedef {import("../shared/touchControls.js").TouchOrientation} TouchOrientation
 * @typedef {import("../shared/touchControls.js").TouchProfile} TouchProfile
 * @typedef {{candidate: unknown, raw: string|null, persisted: boolean}} SessionTouchProfile
 */

/** @returns {Window|undefined} */
function getTouchSettingsWindow() {
  return typeof window === "undefined" ? undefined : window;
}

/** @param {string} gameId @param {TouchOrientation} orientation @returns {string} */
function createTouchProfileStorageKey(gameId, orientation) {
  return `${TOUCH_PROFILE_STORAGE_PREFIX}:${encodeURIComponent(gameId)}:${orientation === "portrait" ? "portrait" : "landscape"}`;
}

/**
 * The window cache preserves unsaved session preferences across independently
 * bundled shell/game modules. It contains owned values, never caller objects.
 * @param {Window|undefined} settingsWindow
 * @returns {Map<string, SessionTouchProfile>}
 */
function getSessionTouchProfiles(settingsWindow) {
  if (!settingsWindow) {
    return serverSessionProfiles;
  }
  if (!(settingsWindow[TOUCH_PROFILE_SESSION_CACHE] instanceof Map)) {
    settingsWindow[TOUCH_PROFILE_SESSION_CACHE] = new Map();
  }
  return settingsWindow[TOUCH_PROFILE_SESSION_CACHE];
}

/** @param {Map<string, SessionTouchProfile>} profiles @param {string} key @param {SessionTouchProfile} profile */
function rememberSessionTouchProfile(profiles, key, profile) {
  profiles.delete(key);
  profiles.set(key, profile);
  while (profiles.size > MAX_SESSION_TOUCH_PROFILES) {
    profiles.delete(profiles.keys().next().value);
  }
}

/**
 * @param {string|null} raw
 * @returns {unknown} A bounded parsed candidate; malformed records throw and leave the previous session usable.
 * @throws {TypeError|SyntaxError} For oversized or malformed stored JSON.
 */
function parseStoredTouchProfile(raw) {
  if (raw === null) {
    return undefined;
  }
  if (typeof raw !== "string" || raw.length > MAX_STORED_PROFILE_LENGTH) {
    throw new TypeError("Stored touch profile exceeds its supported size");
  }
  return JSON.parse(raw);
}

/**
 * Load this browser's game/orientation profile. Storage getter/read/JSON failures
 * fall back to the last usable session profile or developer defaults.
 * @param {string} gameId
 * @param {TouchControlsDescriptor|undefined} descriptor
 * @param {TouchOrientation} orientation
 * @returns {TouchProfile} An independently owned, descriptor-authorized profile.
 */
export function loadTouchProfile(gameId, descriptor, orientation) {
  const settingsWindow = getTouchSettingsWindow();
  const storageKey = createTouchProfileStorageKey(gameId, orientation);
  const sessionProfiles = getSessionTouchProfiles(settingsWindow);
  const previousProfile = sessionProfiles.get(storageKey);
  if (previousProfile && !previousProfile.persisted) {
    return sanitizeTouchProfile(descriptor, previousProfile.candidate);
  }

  try {
    const raw = settingsWindow?.localStorage?.getItem(storageKey) ?? null;
    if (previousProfile && raw === previousProfile.raw) {
      return sanitizeTouchProfile(descriptor, previousProfile.candidate);
    }
    const candidate = parseStoredTouchProfile(raw);
    rememberSessionTouchProfile(sessionProfiles, storageKey, { candidate, raw, persisted: true });
    return sanitizeTouchProfile(descriptor, candidate);
  } catch {
    return sanitizeTouchProfile(descriptor, previousProfile?.candidate);
  }
}

/**
 * Commit a bounded owned profile. A failed write still updates this page's usable
 * session profile and notifies subscribers; persisted reports whether it survives reload.
 * @param {string} gameId
 * @param {TouchControlsDescriptor|undefined} descriptor
 * @param {TouchOrientation} orientation
 * @param {unknown} profile
 * @returns {{profile: TouchProfile, persisted: boolean}}
 */
export function saveTouchProfile(gameId, descriptor, orientation, profile) {
  const settingsWindow = getTouchSettingsWindow();
  const storageKey = createTouchProfileStorageKey(gameId, orientation);
  const safeProfile = sanitizeTouchProfile(descriptor, profile);
  const raw = JSON.stringify(safeProfile);
  let persisted = false;

  try {
    const profileStorage = settingsWindow?.localStorage;
    if (profileStorage) {
      profileStorage.setItem(storageKey, raw);
      persisted = true;
    }
  } catch {
    // The returned session profile remains usable when storage is blocked/full.
  }

  rememberSessionTouchProfile(getSessionTouchProfiles(settingsWindow), storageKey, {
    candidate: safeProfile,
    raw,
    persisted,
  });
  if (settingsWindow?.CustomEvent) {
    settingsWindow.dispatchEvent(new settingsWindow.CustomEvent(TOUCH_PROFILE_CHANGE_EVENT, {
      detail: { key: storageKey, profile: sanitizeTouchProfile(descriptor, safeProfile), persisted },
    }));
  }
  return { profile: sanitizeTouchProfile(descriptor, safeProfile), persisted };
}

/**
 * Listen to same-page saves (including separate bundles) and native cross-tab
 * storage updates. Malformed remote writes are ignored, and unsubscribe releases both listeners.
 * @param {string} gameId
 * @param {TouchControlsDescriptor|undefined} descriptor
 * @param {TouchOrientation} orientation
 * @param {(profile: TouchProfile) => void} listener Receives an owned authorized profile.
 * @returns {() => void}
 */
export function subscribeTouchProfile(gameId, descriptor, orientation, listener) {
  const settingsWindow = getTouchSettingsWindow();
  if (!settingsWindow) {
    return () => {};
  }
  const storageKey = createTouchProfileStorageKey(gameId, orientation);

  function receiveLocalTouchProfile(profileEvent) {
    if (profileEvent.detail?.key === storageKey) {
      listener(sanitizeTouchProfile(descriptor, profileEvent.detail.profile));
    }
  }

  function receiveStoredTouchProfile(storageEvent) {
    if (storageEvent.key !== null && storageEvent.key !== storageKey) {
      return;
    }
    try {
      const raw = storageEvent.key === null ? null : storageEvent.newValue;
      const candidate = parseStoredTouchProfile(raw);
      rememberSessionTouchProfile(getSessionTouchProfiles(settingsWindow), storageKey, { candidate, raw, persisted: true });
      listener(sanitizeTouchProfile(descriptor, candidate));
    } catch {
      // Preserve the last good value when another tab writes malformed preferences.
    }
  }

  settingsWindow.addEventListener(TOUCH_PROFILE_CHANGE_EVENT, receiveLocalTouchProfile);
  settingsWindow.addEventListener("storage", receiveStoredTouchProfile);
  return () => {
    settingsWindow.removeEventListener(TOUCH_PROFILE_CHANGE_EVENT, receiveLocalTouchProfile);
    settingsWindow.removeEventListener("storage", receiveStoredTouchProfile);
  };
}
