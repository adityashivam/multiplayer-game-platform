export function registerSocketHandlers(nsp, buildHandlers) {
  nsp.on("connection", (socket) => {
    const handlers = buildHandlers ? buildHandlers(socket) : null;
    if (!handlers) return;

    for (const [event, handler] of Object.entries(handlers)) {
      if (typeof handler === "function") {
        socket.on(event, handler);
      }
    }
  });
}
