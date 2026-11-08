import { createInterpolator } from "./interpolation.js";

/**
 * @template State
 * @template {string} PoseKey
 * @typedef {object} WorkerInterpolationConfig
 * @property {(serverState: State) => Record<PoseKey, number>} extractPositions
 * @property {(serverState: State) => (Record<PoseKey, number> | null)} [extractVelocities]
 * @property {(serverState: State) => (Partial<Record<PoseKey, string|number>> | null)} [extractContinuityKeys]
 *   Declare fields that must not interpolate or infer velocity across identity changes.
 * @property {number} [interpDelayMs=45]
 * @property {number} [maxBufferSize=32]
 * @property {boolean} [adaptive=true]
 */

/**
 * Keep the established worker API while sampling synchronously on the main
 * thread so each render receives current positions. Raw snapshots are retained
 * by reference only after the reduced snapshot is accepted.
 * @template {{ net?: import("../shared/networkProtocol.js").SnapshotNetworkMetadata | null }} State
 * @template {string} PoseKey
 * @param {WorkerInterpolationConfig<State, PoseKey>} [config]
 * @throws {Error} When the position extractor is missing.
 */
export function createWorkerInterpolator(config = {}) {
  const extractPositions = config.extractPositions;
  const extractVelocities = typeof config.extractVelocities === "function"
    ? config.extractVelocities
    : null;
  const extractContinuityKeys = typeof config.extractContinuityKeys === "function"
    ? config.extractContinuityKeys
    : null;
  const interpolationConfig = {
    interpDelayMs: config.interpDelayMs ?? 45,
    maxBufferSize: config.maxBufferSize ?? 32,
    adaptive: config.adaptive ?? true,
    extractVelocities: extractVelocities
      ? (reducedState) => reducedState.velocities
      : undefined,
    extractContinuityKeys: extractContinuityKeys
      ? (reducedState) => reducedState.continuityKeys
      : undefined,
  };

  if (typeof extractPositions !== "function") {
    throw new Error("createWorkerInterpolator requires config.extractPositions(state).");
  }

  let disposed = false;
  /** @type {State | null} */
  let latestState = null;

  const interpolator = createInterpolator(interpolationConfig);

  /**
   * @param {State} serverState
   * @param {{ timestampMs?: number }} [options] Arrival clock override.
   */
  function pushState(serverState, options = {}) {
    if (disposed) {
      return;
    }

    const positions = extractPositions(serverState);
    if (!positions || typeof positions !== "object" || Array.isArray(positions)) {
      return;
    }

    const velocities = extractVelocities ? extractVelocities(serverState) : null;
    const reducedState = {
      positions,
      velocities,
      continuityKeys: extractContinuityKeys ? extractContinuityKeys(serverState) : null,
      net: serverState.net && typeof serverState.net === "object" && !Array.isArray(serverState.net)
        ? serverState.net
        : null,
    };
    if (interpolator.pushState(reducedState, options)) {
      latestState = serverState;
    }
  }

  /**
   * @param {import("./interpolation.js").InterpolationRuntimeOptions} [runtimeOptions]
   * @returns {Record<PoseKey, number> | null} May reuse the interpolator's pose object.
   */
  function getInterpolatedPositions(runtimeOptions = {}) {
    if (disposed) return null;
    return interpolator.getInterpolatedPositions(
      (state) => state.positions,
      runtimeOptions,
    );
  }

  /** @returns {State | null} The most recently accepted raw snapshot reference. */
  function getLatestState() {
    return latestState;
  }

  /** @returns {import("./interpolation.js").InterpolationNetworkStats | null} */
  function getNetworkStats() {
    if (disposed) return null;
    return interpolator.getNetworkStats();
  }

  function reset() {
    if (disposed) return;
    latestState = null;
    interpolator.reset();
  }

  function destroy() {
    if (disposed) return;
    disposed = true;
    latestState = null;
  }

  return {
    pushState,
    getInterpolatedPositions,
    getLatestState,
    getNetworkStats,
    reset,
    destroy,
    isWorkerEnabled: () => false,
  };
}
