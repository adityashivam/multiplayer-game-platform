/** BoxGeometry material groups: +X, -X, +Y, -Y, +Z, -Z. */
export const LUDO_DIE_FACES = Object.freeze([
  Object.freeze({ value: 3, normal: Object.freeze([1, 0, 0]) }),
  Object.freeze({ value: 4, normal: Object.freeze([-1, 0, 0]) }),
  Object.freeze({ value: 1, normal: Object.freeze([0, 1, 0]) }),
  Object.freeze({ value: 6, normal: Object.freeze([0, -1, 0]) }),
  Object.freeze({ value: 2, normal: Object.freeze([0, 0, 1]) }),
  Object.freeze({ value: 5, normal: Object.freeze([0, 0, -1]) }),
]);

/**
 * Keep the last real outcome on the table while the next turn awaits a roll.
 * One is only the unrolled board's visual placeholder.
 * @param {{diceValue:number,lastAction:{diceValue:number}}} snapshot
 * @returns {number}
 */
export function getLudoDisplayedDieValue(snapshot) {
  return snapshot.diceValue || snapshot.lastAction.diceValue || 1;
}

/**
 * Canonical quaternion with the requested, physically authored die face up.
 * Opposite faces sum to seven. Rotation about the vertical axis is left to the
 * renderer so it cannot change the outcome.
 * @param {number} value
 * @returns {[number,number,number,number]}
 */
export function getLudoDieOrientation(value) {
  const quarterTurn = Math.SQRT1_2;

  switch (value) {
    case 2:
      return [-quarterTurn, 0, 0, quarterTurn];
    case 3:
      return [0, 0, quarterTurn, quarterTurn];
    case 4:
      return [0, 0, -quarterTurn, quarterTurn];
    case 5:
      return [quarterTurn, 0, 0, quarterTurn];
    case 6:
      return [1, 0, 0, 0];
    default:
      return [0, 0, 0, 1];
  }
}

/**
 * Deterministic cell-local layout, including the largest supported shared safe
 * cell. Scale accounts for the sculpted pawn's 0.36-unit base radius.
 * @param {number} index Stable index in a player/token-sorted cell group.
 * @param {number} count
 * @returns {{x:number,z:number,scale:number}}
 */
export function getLudoStackOffset(index, count) {
  const boundedCount = Math.max(1, Math.min(16, Math.floor(count)));

  if (boundedCount === 1) {
    return { x: 0, z: 0, scale: 1 };
  }

  const columns = Math.ceil(Math.sqrt(boundedCount));
  const rows = Math.ceil(boundedCount / columns);
  const boundedIndex = Math.max(0, Math.min(boundedCount - 1, Math.floor(index)));
  const spacing = 0.88 / Math.max(columns, rows);

  return {
    x: (boundedIndex % columns - (columns - 1) / 2) * spacing,
    z: (Math.floor(boundedIndex / columns) - (rows - 1) / 2) * spacing,
    scale: Math.min(0.75, spacing / 0.76),
  };
}

/** @typedef {import("../shared/rules.js").LudoLastAction} LudoVisualAction */
/** @typedef {{roundId:number,started?:boolean,lastAction:LudoVisualAction}} LudoVisualSnapshot */
/** @typedef {{identity:string,action:LudoVisualAction,elapsedMs:number,progress:number}} LudoActionFrame */

/**
 * Owns one bounded animation, independent of snapshot delivery cadence. Initial
 * hydration, old actions, reduced motion and round changes land immediately.
 * A local monotonic clock keeps clock-offset updates from rewinding a hop.
 * Snapshot/action objects remain read-only and are never modified.
 * @returns {{sample(snapshot:LudoVisualSnapshot|null,serverNowMs:number,nowMs:number,reducedMotion?:boolean):LudoActionFrame|null,reset():void}}
 */
export function createLudoActionTimeline() {
  let observedRoundId = null;
  let observedActionId = -1;
  let activeFrame = null;
  let localStartedAtMs = 0;
  let observedPaused = false;

  return {
    // Room identities can be recreated with the same round/action IDs. Only an
    // explicit accepted-join boundary may discard the stale-action highwater.
    reset() {
      observedRoundId = null;
      observedActionId = -1;
      activeFrame = null;
      localStartedAtMs = 0;
      observedPaused = false;
    },
    sample(snapshot, serverNowMs, nowMs, reducedMotion = false) {
      if (!snapshot?.lastAction) {
        return null;
      }

      const action = snapshot.lastAction;

      if (snapshot.roundId !== observedRoundId) {
        observedRoundId = snapshot.roundId;
        observedActionId = action.id;
        activeFrame = null;
        observedPaused = snapshot.started === false;
        return null;
      }

      if (snapshot.started === false || observedPaused) {
        observedPaused = snapshot.started === false;
        observedActionId = Math.max(observedActionId, action.id);
        activeFrame = null;
        return null;
      }

      if (action.id > observedActionId) {
        observedActionId = action.id;
        activeFrame = null;

        const elapsedMs = Math.max(0, serverNowMs - action.startedAtMs);
        const supportedAction = action.kind === "roll" || action.kind === "move"
          || action.kind === "capture" || action.kind === "finish";

        if (!reducedMotion && snapshot.started !== false && supportedAction
          && action.durationMs > 0 && elapsedMs < action.durationMs) {
          localStartedAtMs = nowMs - elapsedMs;
          activeFrame = {
            identity: `${snapshot.roundId}:${action.id}`,
            action,
            elapsedMs,
            progress: elapsedMs / action.durationMs,
          };
        }
      }

      if (reducedMotion || snapshot.started === false) {
        activeFrame = null;
      }

      if (!activeFrame) {
        return null;
      }

      activeFrame.elapsedMs = Math.max(activeFrame.elapsedMs, nowMs - localStartedAtMs);
      activeFrame.progress = Math.min(1, activeFrame.elapsedMs / activeFrame.action.durationMs);

      if (activeFrame.progress >= 1) {
        activeFrame = null;
      }

      return activeFrame;
    },
  };
}
