import { FIGHT_MOVEMENT } from "./shared/simulation.js";

/** @typedef {import("./shared/simulation.js").FightPlayerId} FightPlayerId */
/** @typedef {{p1x: number, p1y: number, p2x: number, p2y: number}} FightRenderPose */
/**
 * @typedef {object} FightRenderContactOptions
 * @property {FightPlayerId|null} [localPlayerId] Anchor the local prediction where the arena permits.
 * @property {{p1: {x: number, y: number}, p2: {x: number, y: number}}|null} [players] Latest authority supplies grounded side order.
 * @property {boolean} [p1IsLeft] Previously displayed contact order, when known.
 */
/** @typedef {FightRenderContactOptions & {deltaSec: number, nowMs?: number, inputEpoch?: number, localSimulationPosition?: {x: number, y: number}|null}} FightRenderPlaybackOptions */

const CONTACT_CORRECTION_RELEASE_PER_SEC = 18;
const CONTACT_HISTORY_MAX_GAP_MS = 250;

/**
 * Preserve displayed contact order and release visual correction over time.
 * Launcher/jump timelines may cross before their delayed opponent has clearance;
 * retaining the correction avoids snapping across sides or on contact release.
 * The caller resets this tracker on room/visibility changes. Long frame gaps and
 * ownership epoch changes also reseed history from current authority.
 * @returns {{sample: (pose: FightRenderPose, options: FightRenderPlaybackOptions) => FightRenderPose, reset: () => void}}
 */
export function createFightRenderContact() {
  let correctionP1X = 0;
  let correctionP2X = 0;
  /** @type {boolean|undefined} */
  let p1IsLeft;
  /** @type {number|null} */
  let lastFrameAtMs = null;
  /** @type {number|undefined} */
  let lastInputEpoch;

  function reset() {
    correctionP1X = 0;
    correctionP2X = 0;
    p1IsLeft = undefined;
    lastFrameAtMs = null;
    lastInputEpoch = undefined;
  }

  return {
    reset,
    sample(pose, options) {
      const elapsedMs = lastFrameAtMs === null || options.nowMs === undefined ? 0 : options.nowMs - lastFrameAtMs;
      const epochChanged = lastInputEpoch !== undefined && options.inputEpoch !== undefined && lastInputEpoch !== options.inputEpoch;
      if (elapsedMs < 0 || elapsedMs > CONTACT_HISTORY_MAX_GAP_MS || epochChanged) reset();
      lastFrameAtMs = options.nowMs ?? null;
      lastInputEpoch = options.inputEpoch;

      const decay = Math.exp(-CONTACT_CORRECTION_RELEASE_PER_SEC * Math.max(0, options.deltaSec));
      const renderedPose = constrainFightRenderPose({
        ...pose,
        p1x: pose.p1x + correctionP1X * decay,
        p2x: pose.p2x + correctionP2X * decay,
      }, { ...options, p1IsLeft });
      const verticallyClear = Math.abs(pose.p1y - pose.p2y) >= FIGHT_MOVEMENT.VERTICAL_SEPARATION_LIMIT;
      if (verticallyClear && options.localPlayerId && options.players) {
        // Prediction collides with the latest opponent state, not its delayed
        // artwork. Use that same reference before committing a landing side.
        const ownsP1 = options.localPlayerId === "p1";
        const localX = options.localSimulationPosition?.x ?? (ownsP1 ? pose.p1x : pose.p2x);
        const opponentX = options.players[ownsP1 ? "p2" : "p1"].x;
        // Equal X resolves with p1 on the right, matching shared separation.
        p1IsLeft = ownsP1 ? localX < opponentX : opponentX < localX;
      } else if (p1IsLeft === undefined || verticallyClear) {
        if (renderedPose.p1x !== renderedPose.p2x) p1IsLeft = renderedPose.p1x < renderedPose.p2x;
      }
      correctionP1X = renderedPose.p1x - pose.p1x;
      correctionP2X = renderedPose.p2x - pose.p2x;
      return renderedPose;
    },
  };
}

/**
 * Keep mixed prediction/interpolation timelines from drawing interpenetrating
 * fighters. Apply after render interpolation, before artwork-specific Y offsets.
 * This returns an owned pose and never changes simulation or retained snapshots.
 * A clear jump-over is allowed; near-ground contact follows authoritative order.
 * @param {FightRenderPose} pose Raw simulation coordinates for both visuals.
 * @param {FightRenderContactOptions} [options]
 * @returns {FightRenderPose}
 */
export function constrainFightRenderPose(pose, { localPlayerId, players, p1IsLeft: displayedOrder } = {}) {
  const { MIN_X: minX, MAX_X: maxX, MIN_HORIZONTAL_SEPARATION: distance, VERTICAL_SEPARATION_LIMIT: verticalLimit } = FIGHT_MOVEMENT;
  const boundedPose = {
    ...pose,
    p1x: Math.max(minX, Math.min(maxX, pose.p1x)),
    p2x: Math.max(minX, Math.min(maxX, pose.p2x)),
  };
  if (Math.abs(pose.p1y - pose.p2y) >= verticalLimit) return boundedPose;

  // A predicted jump may finish its cross-up before the delayed authority does.
  // Airborne authority must not restore the pre-jump order at local landing.
  const hasAuthoritativeContact = players && Math.abs(players.p1.y - players.p2.y) < verticalLimit;
  const p1IsLeft = displayedOrder ?? (hasAuthoritativeContact && players.p1.x !== players.p2.x
    ? players.p1.x < players.p2.x : boundedPose.p1x < boundedPose.p2x);
  const signedGap = (boundedPose.p2x - boundedPose.p1x) * (p1IsLeft ? 1 : -1);
  if (signedGap >= distance) return boundedPose;

  if (localPlayerId === "p1") {
    boundedPose.p1x = Math.max(minX + (p1IsLeft ? 0 : distance),
      Math.min(maxX - (p1IsLeft ? distance : 0), boundedPose.p1x));
    boundedPose.p2x = boundedPose.p1x + (p1IsLeft ? distance : -distance);
  } else if (localPlayerId === "p2") {
    boundedPose.p2x = Math.max(minX + (p1IsLeft ? distance : 0),
      Math.min(maxX - (p1IsLeft ? 0 : distance), boundedPose.p2x));
    boundedPose.p1x = boundedPose.p2x + (p1IsLeft ? -distance : distance);
  } else {
    const leftPosition = Math.max(minX, Math.min(maxX - distance,
      (boundedPose.p1x + boundedPose.p2x - distance) / 2));
    boundedPose.p1x = leftPosition + (p1IsLeft ? 0 : distance);
    boundedPose.p2x = leftPosition + (p1IsLeft ? distance : 0);
  }
  return boundedPose;
}
