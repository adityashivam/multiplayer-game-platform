import { createInterpolator } from "./interpolation.js";

const WORKER_SCRIPT_URL = "/platform/shared/interpolation.worker.js";

function reduceStateForInterpolation(state, extractPositions) {
  if (!state || typeof extractPositions !== "function") return null;
  const positions = extractPositions(state);
  if (!positions || typeof positions !== "object" || Array.isArray(positions)) return null;
  return {
    positions,
    net: state.net && typeof state.net === "object" && !Array.isArray(state.net) ? state.net : null,
  };
}

function noop() {}

export function createWorkerInterpolator(config = {}) {
  const extractPositions = config.extractPositions;
  const interpolationConfig = {
    interpDelayMs: config.interpDelayMs ?? 50,
    maxBufferSize: config.maxBufferSize ?? 10,
    adaptive: config.adaptive ?? true,
  };

  if (typeof extractPositions !== "function") {
    throw new Error("createWorkerInterpolator requires config.extractPositions(state).");
  }

  let disposed = false;
  let worker = null;
  let workerEnabled = false;
  let latestPositions = null;
  let latestNetworkStats = null;
  let latestState = null;
  let sampleInFlight = false;
  let sampleRequestId = 0;

  const fallbackInterpolator = createInterpolator(interpolationConfig);

  function runFallbackSample(runtimeOptions = {}) {
    const positions = fallbackInterpolator.getInterpolatedPositions(
      (state) => state.positions,
      runtimeOptions,
    );
    latestPositions = positions;
    latestNetworkStats = fallbackInterpolator.getNetworkStats();
    return positions;
  }

  if (typeof Worker !== "undefined") {
    try {
      worker = new Worker(WORKER_SCRIPT_URL, { type: "module" });
      workerEnabled = true;

      worker.onmessage = (event) => {
        if (disposed) return;
        const message = event?.data;
        if (!message || typeof message !== "object") return;
        if (message.type === "sample") {
          sampleInFlight = false;
          latestPositions = message.positions || null;
          latestNetworkStats = message.netStats || null;
        }
      };

      worker.onerror = (error) => {
        console.warn("Interpolation worker failed, using main-thread fallback.", error);
        workerEnabled = false;
        sampleInFlight = false;
        if (worker) {
          worker.terminate();
          worker = null;
        }
      };

      worker.postMessage({
        type: "init",
        config: interpolationConfig,
      });
    } catch (error) {
      console.warn("Failed to start interpolation worker, using main-thread fallback.", error);
      workerEnabled = false;
      worker = null;
    }
  }

  function pushState(state) {
    if (disposed) return;
    const reducedState = reduceStateForInterpolation(state, extractPositions);
    if (!reducedState) return;
    latestState = state;

    const timestampMs = performance.now();
    if (workerEnabled && worker) {
      worker.postMessage({
        type: "push-state",
        state: reducedState,
        timestampMs,
      });
      return;
    }

    fallbackInterpolator.pushState(reducedState, { timestampMs });
  }

  function getInterpolatedPositions(runtimeOptions = {}) {
    if (disposed) return null;

    if (workerEnabled && worker) {
      if (!sampleInFlight) {
        sampleInFlight = true;
        sampleRequestId += 1;
        worker.postMessage({
          type: "sample",
          requestId: sampleRequestId,
          nowMs: performance.now(),
          runtimeOptions,
        });
      }
      return latestPositions;
    }

    return runFallbackSample(runtimeOptions);
  }

  function getLatestState() {
    return latestState;
  }

  function getNetworkStats() {
    if (disposed) return null;
    if (workerEnabled && worker) return latestNetworkStats;
    return fallbackInterpolator.getNetworkStats();
  }

  function reset() {
    if (disposed) return;
    latestPositions = null;
    latestNetworkStats = null;
    latestState = null;
    sampleInFlight = false;

    if (workerEnabled && worker) {
      worker.postMessage({ type: "reset" });
      return;
    }
    fallbackInterpolator.reset();
  }

  function destroy() {
    if (disposed) return;
    disposed = true;
    latestPositions = null;
    latestNetworkStats = null;
    latestState = null;
    sampleInFlight = false;
    if (worker) {
      worker.onmessage = noop;
      worker.onerror = noop;
      worker.terminate();
      worker = null;
    }
  }

  return {
    pushState,
    getInterpolatedPositions,
    getLatestState,
    getNetworkStats,
    reset,
    destroy,
    isWorkerEnabled: () => workerEnabled && !disposed,
  };
}
