export const DEAD_SHIFT_CAMERA_FOV_DEG = 73;
export const DEAD_SHIFT_AIM_FOV_DEG = 55;

const AIM_TRANSITION_RATE_SEC = 16;
const MAX_AIM_TRANSITION_DT_SEC = 0.08;

/**
 * Ease render-only ADS independently of input capture and authoritative combat.
 * Reduced motion applies the chosen view immediately, without a zoom animation.
 * @param {number} aimBlend Current presentation weight, from zero to one.
 * @param {boolean} aiming Whether the living, non-reloading operator is aiming.
 * @param {number} dtSec Render duration in seconds.
 * @param {boolean} reducedMotion Player motion preference.
 * @returns {number} New presentation weight; no input or player state is mutated.
 */
export function advanceDeadShiftAimBlend(aimBlend, aiming, dtSec, reducedMotion) {
  const targetBlend = aiming ? 1 : 0;
  if (reducedMotion) return targetBlend;
  const boundedDtSec = Math.max(0, Math.min(MAX_AIM_TRANSITION_DT_SEC, dtSec));
  return aimBlend + (targetBlend - aimBlend) * (1 - Math.exp(-boundedDtSec * AIM_TRANSITION_RATE_SEC));
}
