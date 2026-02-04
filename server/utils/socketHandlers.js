export function registerSocketHandlers(nsp, buildHandlers) {
  nsp.on("connection", (socket) => {
    // Built-in ping probe — client measures round-trip via ack
    socket.on("__ping", (cb) => {
      if (typeof cb === "function") cb();
    });

    const handlers = buildHandlers ? buildHandlers(socket) : null;
    if (!handlers) return;

    for (const [event, handler] of Object.entries(handlers)) {
      if (typeof handler === "function") {
        socket.on(event, handler);
      }
    }
  });
}
