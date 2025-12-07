export function emitEvent({ socket, nsp, gameId, type, payload, target = "self" }) {
  if (!type) return;

  const emitWith = (emitter) => {
    if (!emitter) return;
    if (payload === undefined) emitter.emit(type);
    else emitter.emit(type, payload);
  };

  switch (target) {
    case "self":
      emitWith(socket);
      break;
    case "others":
      if (socket && gameId) {
        emitWith(socket.to(gameId));
      }
      break;
    case "game":
      if (nsp && gameId) {
        emitWith(nsp.to(gameId));
      }
      break;
    default:
      break;
  }
}
