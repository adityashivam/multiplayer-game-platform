const MAX_CAMERA_PITCH = 1.3;
const FULL_TURN_RAD = Math.PI * 2;

/**
 * Combine keyboard and analog axes without granting faster diagonal movement.
 * @param {{keyboardX?: number, keyboardZ?: number, stickX?: number, stickY?: number}} axes
 * @returns {{moveX: number, moveZ: number}} Right and forward axes, with magnitude at most one.
 */
export function normalizeDeadShiftMovement({ keyboardX = 0, keyboardZ = 0, stickX = 0, stickY = 0 }) {
  const moveX = Math.max(-1, Math.min(1, keyboardX + stickX));
  const moveZ = Math.max(-1, Math.min(1, keyboardZ - stickY));
  const magnitude = Math.max(1, Math.hypot(moveX, moveZ));
  return { moveX: moveX / magnitude, moveZ: moveZ / magnitude };
}

/**
 * Apply pointer deltas or time-scaled stick deltas to the first-person camera.
 * @param {{yaw: number, pitch: number}} aim Current angles in radians.
 * @param {number} deltaX Positive turns right.
 * @param {number} deltaY Positive looks down.
 * @param {number} sensitivity Radians per delta unit.
 * @returns {{yaw: number, pitch: number}} Wrapped yaw and bounded pitch.
 */
export function rotateDeadShiftAim(aim, deltaX, deltaY, sensitivity) {
  let yaw = aim.yaw - deltaX * sensitivity;
  if (yaw > Math.PI || yaw < -Math.PI) {
    yaw = ((yaw + Math.PI) % FULL_TURN_RAD + FULL_TURN_RAD) % FULL_TURN_RAD - Math.PI;
  }
  return {
    yaw,
    pitch: Math.max(-MAX_CAMERA_PITCH, Math.min(MAX_CAMERA_PITCH, aim.pitch - deltaY * sensitivity)),
  };
}
