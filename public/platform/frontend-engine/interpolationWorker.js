import { createInterpolator } from "./interpolation.js";

/**
 * Creates an interpolator that runs synchronously on the main thread.
 *
 * The previous Worker-based approach added IPC latency (1-3 ms per
 * postMessage round-trip) and always returned *stale* positions
 * (the result of the PREVIOUS frame's request).  Synchronous
 * interpolation on the main thread gives fresh data every frame,
 * which is critical for smooth 60 fps rendering.
 */
export function createWorkerInterpolator(config = {}) {
  const extractPositions = config.extractPositions;
  const extractVelocities = typeof config.extractVelocities === "function"
    ? config.extractVelocities
    : null;
  const interpolationConfig = {
    interpDelayMs: config.interpDelayMs ?? 45,
    maxBufferSize: config.maxBufferSize ?? 10,
    adaptive: config.adaptive ?? true,
    extractVelocities: extractVelocities
      ? (reducedState) => reducedState.velocities
      : undefined,
  };

  if (typeof extractPositions !== "function") {
    throw new Error("createWorkerInterpolator requires config.extractPositions(state).");
  }

  let disposed = false;
  let latestState = null;

  const interpolator = createInterpolator(interpolationConfig);

  function pushState(state) {
    if (disposed) return;
    const positions = extractPositions(state);
    if (!positions || typeof positions !== "object" || Array.isArray(positions)) return;
    latestState = state;

    const velocities = extractVelocities ? extractVelocities(state) : null;
    const reducedState = {
      positions,
      velocities,
      net: state.net && typeof state.net === "object" && !Array.isArray(state.net) ? state.net : null,
    };
    interpolator.pushState(reducedState, { timestampMs: performance.now() });
  }

  function getInterpolatedPositions(runtimeOptions = {}) {
    if (disposed) return null;
    return interpolator.getInterpolatedPositions(
      (state) => state.positions,
      runtimeOptions,
    );
  }

  function getLatestState() {
    return latestState;
  }

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
