import { useEffect, useState } from "react";
import { watchMicrophonePermission } from "../../../frontend-engine/microphonePermission.js";

/** @typedef {import("../../../frontend-engine/microphonePermission.js").MicrophonePermissionState} MicrophonePermissionState */

/**
 * The browser's microphone permission for this site, kept current without
 * ever showing a prompt. Starts as "unknown" until the browser answers.
 * @returns {MicrophonePermissionState}
 */
export default function useMicrophonePermission() {
  const [permission, setPermission] = useState(/** @type {MicrophonePermissionState} */ ("unknown"));
  useEffect(() => watchMicrophonePermission(setPermission), []);
  return permission;
}
