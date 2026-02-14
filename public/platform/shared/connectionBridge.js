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

// Throttle metric-only updates to avoid React re-render spam.
// Status changes (connected/disconnected/reconnecting) always notify immediately.
const METRIC_THROTTLE_MS = 2000;
let lastNotifyMs = 0;
let pendingNotifyTimer = null;
let lastNotifiedStatus = currentState.status;

function doNotify() {
  lastNotifyMs = Date.now();
  lastNotifiedStatus = currentState.status;
  const snapshot = { ...currentState };
  listeners.forEach((listener) => listener(snapshot));
}

function scheduleNotify() {
  const now = Date.now();
  const isStatusChange = currentState.status !== lastNotifiedStatus;

  // Status changes always notify immediately
  if (isStatusChange) {
    if (pendingNotifyTimer) {
      clearTimeout(pendingNotifyTimer);
      pendingNotifyTimer = null;
    }
    doNotify();
    return;
  }

  // Metric-only updates are throttled
  const elapsed = now - lastNotifyMs;
  if (elapsed >= METRIC_THROTTLE_MS) {
    if (pendingNotifyTimer) {
      clearTimeout(pendingNotifyTimer);
      pendingNotifyTimer = null;
    }
    doNotify();
  } else if (!pendingNotifyTimer) {
    pendingNotifyTimer = setTimeout(() => {
      pendingNotifyTimer = null;
      doNotify();
    }, METRIC_THROTTLE_MS - elapsed);
  }
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
  scheduleNotify();
}

export function getConnectionState() {
  return { ...currentState };
}
