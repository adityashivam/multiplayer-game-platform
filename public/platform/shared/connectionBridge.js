const defaultState = {
  status: "connecting",
  ping: null,
  pingP95Ms: null,
  pingP99Ms: null,
  jitterMs: null,
  jitterP95Ms: null,
  jitterP99Ms: null,
  packetLossPct: null,
  packetLossP95Pct: null,
  packetLossP99Pct: null,
  updateRateHz: null,
  outOfOrderCount: 0,
  serverTickRate: null,
  server: null,
};

let currentState = { ...defaultState };
const listeners = new Set();

function notify() {
  listeners.forEach((listener) => listener({ ...currentState }));
}

export function subscribeConnectionState(listener) {
  if (typeof listener !== "function") return () => {};
  listeners.add(listener);
  listener({ ...currentState });
  return () => listeners.delete(listener);
}

export function updateConnectionState(payload = {}) {
  currentState = {
    ...currentState,
    ...payload,
  };
  notify();
}

export function getConnectionState() {
  return { ...currentState };
}
