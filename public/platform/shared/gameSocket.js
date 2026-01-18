const socketCache = new Map();

function normalizeNamespace(namespace) {
  if (!namespace) {
    throw new Error("Game socket namespace is required.");
  }
  return namespace.startsWith("/") ? namespace : `/${namespace}`;
}

function resolveSocketIo() {
  if (typeof window === "undefined" || typeof window.io !== "function") {
    throw new Error("Socket.io client is not available.");
  }
  return window.io;
}

export function getGameSocket(namespace) {
  const normalized = normalizeNamespace(namespace);
  if (socketCache.has(normalized)) {
    return socketCache.get(normalized);
  }

  const io = resolveSocketIo();
  const raw = io(normalized);

  const api = {
    onEvent(event, handler) {
      if (typeof handler !== "function") return () => {};
      raw.on(event, handler);
      return () => raw.off(event, handler);
    },
    offEvent(event, handler) {
      if (handler) {
        raw.off(event, handler);
      } else {
        raw.off(event);
      }
    },
    send(event, payload) {
      raw.emit(event, payload);
    },
    isConnected() {
      return raw.connected;
    },
  };

  socketCache.set(normalized, api);
  return api;
}
