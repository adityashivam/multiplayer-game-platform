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
 * @param {number} [config.hardSnapDistSq=40000]
 * @param {number} [config.hardSnapVerticalError=100]
 * @param {number} [config.correctionBlendFactor=0.18]
 * @param {number} [config.correctionDeadzone=0.75]
 * @param {number} [config.correctionClampMin=-90]
 * @param {number} [config.correctionClampMax=90]
 * @param {number} [config.correctionDecayCoeff=14]
 * @param {number} [config.maxDeltaSec=0.05]
 * @param {number} [config.proximityLerpMax=0.5]       - max per-frame lerp toward server when at minSeparation
 * @param {number} [config.proximityLerpRange=2]        - multiplier of minSeparation at which lerp begins
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
  const hardSnapDistSq = config.hardSnapDistSq ?? 40000;
  const hardSnapVerticalError = config.hardSnapVerticalError ?? 100;
  const correctionBlendFactor = config.correctionBlendFactor ?? 0.18;
  const correctionDeadzone = config.correctionDeadzone ?? 0.75;
  const correctionClampMin = config.correctionClampMin ?? -90;
  const correctionClampMax = config.correctionClampMax ?? 90;
  const correctionDecayCoeff = config.correctionDecayCoeff ?? 14;
  const maxDeltaSec = config.maxDeltaSec ?? 0.05;
  // Per-frame lerp factor when right at minSeparation from opponent
  const proximityLerpMax = config.proximityLerpMax ?? 0.5;
  // Distance (as multiple of minSeparation) where lerp starts ramping up
  const proximityLerpStart = minSeparation * (config.proximityLerpRange ?? 2);

  // --- State ---
  let initialized = false;
  let x = 0;
  let y = 0;
  let vx = 0;
  let vy = 0;
  let correctionX = 0;
  let correctionY = 0;
  let hardSnapCount = 0;

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

    correctionX = clampNumber(
      correctionX + errorX * correctionBlendFactor,
      correctionClampMin,
      correctionClampMax,
    );
    correctionY = clampNumber(
      correctionY + errorY * correctionBlendFactor,
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
   * @param {Object} opts                    Pre-allocated: { active, attackSlowdown, opponentX, opponentY }
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

    // --- Integrate X ---
    x += vx * clampedDt;
    x = clampNumber(x, worldMinX, worldMaxX);

    // --- Proximity lerp: pull x toward server when near opponent ---
    // This replaces push-apart simulation which can't be accurate client-side.
    // The lerp acts on the internal state (x) directly, so there's no
    // accumulated divergence — it's a stable, one-sided pull toward the
    // server's authoritative position. Far from opponent: full prediction.
    const opponentX = opts.opponentX;
    const opponentY = opts.opponentY;
    let proximityT = 0;
    if (Number.isFinite(opponentX) && Number.isFinite(opponentY)) {
      const dy = y - opponentY;
      if ((dy < 0 ? -dy : dy) < groundedThreshold) {
        const dx = x - opponentX;
        const dist = dx < 0 ? -dx : dx;
        if (dist < proximityLerpStart) {
          // Ramp: 0 at proximityLerpStart, 1 at minSeparation
          const range = proximityLerpStart - minSeparation;
          proximityT = range > 0
            ? clampNumber((proximityLerpStart - dist) / range, 0, 1)
            : 1;
          const lerpFactor = proximityT * proximityLerpMax;
          x += (serverPlayerState.x - x) * lerpFactor;
        }
      }
    }

    // --- Correction decay ---
    const correctionDecay = Math.exp(-clampedDt * correctionDecayCoeff);
    correctionX *= correctionDecay;
    correctionY *= correctionDecay;

    // Near opponent: dampen X correction proportionally to prevent it
    // from fighting the proximity lerp.
    if (proximityT > 0) {
      correctionX *= (1 - proximityT);
    }

    _result.x = clampNumber(x + correctionX, worldMinX, worldMaxX);
    _result.y = Math.min(groundY, y + correctionY);
    return _result;
  }

  function reset(serverPlayerState) {
    resetFromServer(serverPlayerState);
  }

  function getState() {
    return { initialized, x, y, vx, vy, correctionX, correctionY, hardSnapCount };
  }

  return { step, reconcile, reset, getState };
}
