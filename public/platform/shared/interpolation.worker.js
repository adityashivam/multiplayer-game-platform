import { createInterpolator } from "./interpolation.js";

let interpolator = createInterpolator({
  interpDelayMs: 50,
  maxBufferSize: 10,
  adaptive: true,
  connectionProvider: () => ({ ping: null }),
});

function sanitizeReducedState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  const positions =
    state.positions && typeof state.positions === "object" && !Array.isArray(state.positions)
      ? state.positions
      : null;
  if (!positions) return null;

  return {
    positions,
    net: state.net && typeof state.net === "object" && !Array.isArray(state.net) ? state.net : null,
  };
}

self.onmessage = (event) => {
  const message = event?.data;
  if (!message || typeof message !== "object") return;

  if (message.type === "init") {
    const config = message.config || {};
    interpolator = createInterpolator({
      interpDelayMs: config.interpDelayMs ?? 50,
      maxBufferSize: config.maxBufferSize ?? 10,
      adaptive: config.adaptive ?? true,
      connectionProvider: () => ({ ping: null }),
    });
    return;
  }

  if (message.type === "reset") {
    interpolator.reset();
    return;
  }

  if (message.type === "push-state") {
    const reducedState = sanitizeReducedState(message.state);
    if (!reducedState) return;
    const timestampMs = Number.isFinite(message.timestampMs) ? message.timestampMs : undefined;
    interpolator.pushState(reducedState, { timestampMs });
    return;
  }

  if (message.type === "sample") {
    const runtimeOptions = message.runtimeOptions || {};
    const nowMs = Number.isFinite(message.nowMs) ? message.nowMs : performance.now();
    const positions = interpolator.getInterpolatedPositions(
      (state) => state.positions,
      { ...runtimeOptions, nowMs },
    );
    const netStats = interpolator.getNetworkStats();
    self.postMessage({
      type: "sample",
      requestId: message.requestId ?? 0,
      positions,
      netStats,
    });
  }
};
