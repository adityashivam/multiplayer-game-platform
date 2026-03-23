const defaultState = {
  open: false,
  title: "",
  subtitle: "",
  status: "",
  actionLabel: "",
  phase: "idle",
  winner: null,
  gameId: null,
};

let currentState = { ...defaultState };
const listeners = new Set();
let rematchHandler = null;

function notify() {
  listeners.forEach((listener) => listener({ ...currentState }));
}

export function subscribeEndGame(listener) {
  if (typeof listener !== "function") return () => {};
  listeners.add(listener);
  listener({ ...currentState });
  return () => listeners.delete(listener);
}

export function showEndGameModal(payload = {}) {
  const nextPhase = payload.phase || currentState.phase || "ready";
  currentState = {
    ...currentState,
    ...payload,
    open: true,
    phase: nextPhase,
  };
  notify();
}

export function updateEndGameModal(payload = {}) {
  currentState = {
    ...currentState,
    ...payload,
  };
  notify();
}

export function hideEndGameModal() {
  currentState = { ...defaultState };
  notify();
}

export function registerRematchHandler(handler) {
  rematchHandler = typeof handler === "function" ? handler : null;
}

export function requestRematch() {
  if (rematchHandler) rematchHandler();
}
