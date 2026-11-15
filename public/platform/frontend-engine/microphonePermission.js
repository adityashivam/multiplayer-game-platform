/**
 * Read the browser's microphone permission without prompting. Browsers never
 * let a site re-show the permission prompt once access is blocked, so the
 * platform reads the state to explain how to unblock it instead.
 */

/** @typedef {"granted"|"prompt"|"denied"|"unknown"} MicrophonePermissionState */

const KNOWN_PERMISSION_STATES = new Set(["granted", "prompt", "denied"]);
const MICROPHONE_PERMISSION = Object.freeze({ name: "microphone" });

/**
 * @typedef {{query:(descriptor:{name:string})=>Promise<{state:string}&Partial<EventTarget>>}} MicrophonePermissions
 */

/** @param {string|undefined} state @returns {MicrophonePermissionState} */
function normalizeMicrophonePermission(state) {
  return KNOWN_PERMISSION_STATES.has(state) ? /** @type {MicrophonePermissionState} */ (state) : "unknown";
}

/** @param {MicrophonePermissions|undefined} permissions */
async function queryMicrophonePermissionStatus(permissions) {
  if (typeof permissions?.query !== "function") return null;
  try {
    return await permissions.query(MICROPHONE_PERMISSION);
  } catch {
    // Older Firefox and some WebViews reject the "microphone" name.
    return null;
  }
}

/**
 * @param {MicrophonePermissions|undefined} [permissions=globalThis.navigator?.permissions]
 * @returns {Promise<MicrophonePermissionState>} "unknown" where the browser cannot say.
 */
export async function readMicrophonePermission(permissions = globalThis.navigator?.permissions) {
  const status = await queryMicrophonePermissionStatus(permissions);
  return normalizeMicrophonePermission(status?.state);
}

/**
 * Report the current state once, then every change the browser announces
 * (for example when the player switches the site setting to Allow).
 * @param {(state:MicrophonePermissionState)=>void} onChange
 * @param {MicrophonePermissions|undefined} [permissions=globalThis.navigator?.permissions]
 * @returns {()=>void} Stops reporting; safe to call before the first read finishes.
 */
export function watchMicrophonePermission(onChange, permissions = globalThis.navigator?.permissions) {
  let stopped = false;
  /** @type {(()=>void)|null} */
  let removeListener = null;

  void queryMicrophonePermissionStatus(permissions).then((status) => {
    if (stopped) return;
    onChange(normalizeMicrophonePermission(status?.state));
    if (typeof status?.addEventListener !== "function") return;
    const reportChange = () => {
      if (!stopped) onChange(normalizeMicrophonePermission(status.state));
    };
    status.addEventListener("change", reportChange);
    removeListener = () => status.removeEventListener("change", reportChange);
  });

  return () => {
    stopped = true;
    removeListener?.();
  };
}

const JOINED_VOICE_STATUSES = new Set(["waiting", "connecting", "connected"]);
const PERMISSION_DENIED_ERROR = "MICROPHONE_PERMISSION_DENIED";

/**
 * Decide what to resume after the player unblocks the microphone. Only a
 * request the browser refused is resumed, so listen-only never starts
 * sending audio by itself.
 * @param {{previousPermission:MicrophonePermissionState,permission:MicrophonePermissionState,voiceState:{status:string,errorCode:string|null}}} change
 * @returns {"join"|"unmute"|null} Rejoin voice, unmute an existing membership, or nothing.
 */
export function chooseMicrophoneRecoveryAction({ previousPermission, permission, voiceState }) {
  if (previousPermission !== "denied" || (permission !== "granted" && permission !== "prompt")) return null;
  if (voiceState?.errorCode !== PERMISSION_DENIED_ERROR) return null;
  return JOINED_VOICE_STATUSES.has(voiceState.status) ? "unmute" : "join";
}
