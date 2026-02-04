const defaultState = {
  status: "connecting",
  ping: null,
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
