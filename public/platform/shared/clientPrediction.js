/**
 * Client-side prediction engine for authoritative-server multiplayer games.
 *
 * Runs a full physics simulation locally for instant input response, then
 * reconciles with the server via soft correction offsets.
 *
 * Near opponents, the X axis is smoothly lerped toward the server position
 * each frame. This prevents oscillation from two-body separation mismatch
 * (the client can't accurately predict opponent push-apart because the
 * opponent's position is delayed by interpolation) while keeping movement
 * smooth and responsive.
 *
 * Usage:
 *   import { createClientPredictor } from "/platform/shared/clientPrediction.js";
 *   const predictor = createClientPredictor();
 *   predictor.reconcile(serverPlayerState);          // every server tick
 *   const pos = predictor.step(dt, sp, input, opts); // every render frame
 */

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function expSmoothingAlpha(ratePerSec, dtSec) {
  if (!Number.isFinite(ratePerSec) || ratePerSec <= 0) return 0;
  if (!Number.isFinite(dtSec) || dtSec <= 0) return 0;
  const x = ratePerSec * dtSec;
  return x / (1 + x);
}

/**
 * @param {Object} [config]
 * @param {number} [config.moveSpeed=500]
 * @param {number} [config.jumpSpeed=-1300]
 * @param {number} [config.gravity=1600]
 * @param {number} [config.worldMinX=100]
 * @param {number} [config.worldMaxX=1180]
 * @param {number} [config.groundY=870]
 * @param {number} [config.minSeparation=120]
 * @param {number} [config.groundedThreshold=100]
 * @param {number} [config.hardSnapDistSq=62500]
 * @param {number} [config.hardSnapVerticalError=150]
 * @param {number} [config.correctionBlendFactor=0.35]
 * @param {number} [config.correctionDeadzone=0.5]
 * @param {number} [config.correctionClampMin=-140]
 * @param {number} [config.correctionClampMax=140]
 * @param {number} [config.correctionDecayCoeff=22]
 * @param {number} [config.maxDeltaSec=0.05]
 * @param {number} [config.proximityLerpMax=0.35]      - max per-frame lerp toward server when at minSeparation
 * @param {number} [config.proximityLerpRange=2]        - multiplier of minSeparation at which lerp begins
 * @param {number} [config.contactExitBuffer=50]        - extra px beyond minSeparation before contact assist fully releases
 * @param {number} [config.contactAssistRiseRate=24]    - contact assist engagement speed (1/sec)
 * @param {number} [config.contactAssistFallRate=10]    - contact assist release speed (1/sec)
 * @param {number} [config.contactMoveSuppression=0.85] - max local move suppression near contact
 * @param {number} [config.contactServerFollowRate=22]  - server-follow speed near contact (1/sec)
 */
export function createClientPredictor(config = {}) {
  const moveSpeed = config.moveSpeed ?? 500;
  const jumpSpeed = config.jumpSpeed ?? -1300;
  const gravity = config.gravity ?? 1600;
  const worldMinX = config.worldMinX ?? 100;
  const worldMaxX = config.worldMaxX ?? 1180;
  const groundY = config.groundY ?? 870;
  const minSeparation = config.minSeparation ?? 120;
  const groundedThreshold = config.groundedThreshold ?? 100;
  const hardSnapDistSq = config.hardSnapDistSq ?? 62500;
  const hardSnapVerticalError = config.hardSnapVerticalError ?? 150;
  const correctionBlendFactor = config.correctionBlendFactor ?? 0.35;
  const correctionDeadzone = config.correctionDeadzone ?? 0.5;
  const correctionClampMin = config.correctionClampMin ?? -140;
  const correctionClampMax = config.correctionClampMax ?? 140;
  const correctionDecayCoeff = config.correctionDecayCoeff ?? 22;
  const maxDeltaSec = config.maxDeltaSec ?? 0.05;
  // Per-frame lerp factor when right at minSeparation from opponent
  const proximityLerpMax = config.proximityLerpMax ?? 0.35;
  // Distance (as multiple of minSeparation) where lerp starts ramping up
  const proximityLerpStart = minSeparation * (config.proximityLerpRange ?? 2);
  const contactExitDist = minSeparation + (config.contactExitBuffer ?? 50);
  const contactAssistRiseRate = config.contactAssistRiseRate ?? 24;
  const contactAssistFallRate = config.contactAssistFallRate ?? 10;
  const contactMoveSuppression = clampNumber(config.contactMoveSuppression ?? 0.85, 0, 1);
  const contactServerFollowRate = config.contactServerFollowRate ?? 22;

  // --- State ---
  let initialized = false;
  let x = 0;
  let y = 0;
  let vx = 0;
  let vy = 0;
  let correctionX = 0;
  let correctionY = 0;
  let hardSnapCount = 0;
  let contactAssist = 0;

  const _result = { x: 0, y: 0 };

  function resetFromServer(serverPlayerState) {
    if (!serverPlayerState) {
      initialized = false;
      correctionX = 0;
      correctionY = 0;
      return;
    }
    initialized = true;
    x = serverPlayerState.x;
    y = serverPlayerState.y;
    vx = serverPlayerState.vx || 0;
    vy = serverPlayerState.vy || 0;
    correctionX = 0;
    correctionY = 0;
    contactAssist = 0;
  }

  /**
   * Reconcile predicted state with authoritative server state.
   * Call once per server tick.
   */
  function reconcile(serverPlayerState) {
    if (!serverPlayerState) return;
    if (!initialized) {
      resetFromServer(serverPlayerState);
      return;
    }

    // Reconcile against the rendered prediction (sim position + correction),
    // not against raw simulation state, to avoid correction overshoot loops.
    const renderedX = x + correctionX;
    const renderedY = y + correctionY;
    let errorX = serverPlayerState.x - renderedX;
    let errorY = serverPlayerState.y - renderedY;
    if ((errorX < 0 ? -errorX : errorX) <= correctionDeadzone) errorX = 0;
    if ((errorY < 0 ? -errorY : errorY) <= correctionDeadzone) errorY = 0;
    const errorDistSq = errorX * errorX + errorY * errorY;
    const absErrorY = errorY < 0 ? -errorY : errorY;

    if (errorDistSq > hardSnapDistSq || absErrorY > hardSnapVerticalError) {
      hardSnapCount += 1;
      resetFromServer(serverPlayerState);
      return;
    }

    // Filter toward the latest observed error (stable) instead of integrating
    // error every tick (which can wind up and oscillate near contact edges).
    correctionX = clampNumber(
      correctionX + (errorX - correctionX) * correctionBlendFactor,
      correctionClampMin,
      correctionClampMax,
    );
    correctionY = clampNumber(
      correctionY + (errorY - correctionY) * correctionBlendFactor,
      correctionClampMin,
      correctionClampMax,
    );
  }

  /**
   * Advance prediction by one frame. Call every render tick.
   *
   * @param {number} deltaSec
   * @param {Object|null} serverPlayerState  { x, y, vx, vy, attacking }
   * @param {Object} inputState              { left, right, jump }
   * @param {Object} opts                    Pre-allocated: { active, attackSlowdown, opponentX, opponentY, replay }
   * @returns {{ x: number, y: number } | null}
   */
  function step(deltaSec, serverPlayerState, inputState, opts) {
    if (!serverPlayerState) return null;

    if (!opts.active) {
      resetFromServer(serverPlayerState);
      _result.x = serverPlayerState.x;
      _result.y = serverPlayerState.y;
      return _result;
    }

    if (!initialized) {
      resetFromServer(serverPlayerState);
    }

    const clampedDt = clampNumber(deltaSec, 0, maxDeltaSec);
    const speedMultiplier = opts.attackSlowdown ? 0.3 : 1;
    const replayMode = Boolean(opts.replay);

    // --- Input → velocity ---
    if (inputState.left && !inputState.right) {
      vx = -moveSpeed * speedMultiplier;
    } else if (inputState.right && !inputState.left) {
      vx = moveSpeed * speedMultiplier;
    } else {
      vx = 0;
    }

    if (inputState.jump && y >= groundY - 1) {
      vy = jumpSpeed;
    }

    // --- Integrate Y (full simulation, no two-body interaction) ---
    vy += gravity * clampedDt;
    y += vy * clampedDt;
    if (y > groundY) {
      y = groundY;
      vy = 0;
    }

    if (replayMode) {
      x += vx * clampedDt;
      x = clampNumber(x, worldMinX, worldMaxX);
      contactAssist = 0;
      correctionX = 0;
      correctionY = 0;
      _result.x = x;
      _result.y = y;
      return _result;
    }

    // --- Contact-aware X integration ---
    // We cannot reliably simulate two-body push-apart from delayed opponent data.
    // Near contact, suppress local X simulation and follow server more strongly.
    const opponentX = opts.opponentX;
    const opponentY = opts.opponentY;
    let proximityT = 0;
    let nearContact = false;
    let dist = Infinity;
    if (Number.isFinite(opponentX) && Number.isFinite(opponentY)) {
      const dy = y - opponentY;
      if ((dy < 0 ? -dy : dy) < groundedThreshold) {
        const dx = x - opponentX;
        dist = dx < 0 ? -dx : dx;
        if (dist < proximityLerpStart) {
          // Ramp: 0 at proximityLerpStart, 1 at minSeparation
          const range = proximityLerpStart - minSeparation;
          proximityT = range > 0
            ? clampNumber((proximityLerpStart - dist) / range, 0, 1)
            : 1;
        }
        nearContact = dist <= minSeparation;
      }
    }

    const inContactBand = nearContact || (proximityT > 0 && dist <= contactExitDist);
    const assistTarget = inContactBand ? 1 : 0;
    const assistRate = assistTarget > contactAssist ? contactAssistRiseRate : contactAssistFallRate;
    const assistAlpha = expSmoothingAlpha(assistRate, clampedDt);
    contactAssist += (assistTarget - contactAssist) * assistAlpha;

    const moveScale = 1 - contactAssist * contactMoveSuppression;
    x += vx * clampedDt * moveScale;
    x = clampNumber(x, worldMinX, worldMaxX);

    if (proximityT > 0 || contactAssist > 0.01) {
      const contactStrength = clampNumber(Math.max(proximityT, contactAssist), 0, 1);
      const proximityLerpFactor = contactStrength * proximityLerpMax;
      x += (serverPlayerState.x - x) * proximityLerpFactor;

      const followAlpha = expSmoothingAlpha(contactServerFollowRate * contactStrength, clampedDt);
      x += (serverPlayerState.x - x) * followAlpha;
    }

    // --- Correction decay ---
    const correctionDecay = 1 / (1 + clampedDt * correctionDecayCoeff);
    correctionX *= correctionDecay;
    correctionY *= correctionDecay;

    // Near opponent: dampen X correction proportionally to prevent it
    // from fighting the proximity lerp.
    const correctionDampen = clampNumber(Math.max(proximityT, contactAssist), 0, 1);
    if (correctionDampen > 0) {
      correctionX *= (1 - correctionDampen);
    }

    _result.x = clampNumber(x + correctionX, worldMinX, worldMaxX);
    _result.y = Math.min(groundY, y + correctionY);
    return _result;
  }

  function reset(serverPlayerState) {
    resetFromServer(serverPlayerState);
  }

  /**
   * Inject a visual correction offset (e.g. after resimulation to prevent pops).
   * The offset decays naturally via correctionDecayCoeff each frame.
   */
  function injectCorrection(cx, cy) {
    correctionX = clampNumber(cx, correctionClampMin, correctionClampMax);
    correctionY = clampNumber(cy, correctionClampMin, correctionClampMax);
  }

  function getState() {
    return { initialized, x, y, vx, vy, correctionX, correctionY, hardSnapCount, contactAssist };
  }

  return { step, reconcile, reset, injectCorrection, getState };
}
