export function bothPlayersConnected(state) {
  return state.players.p1.connected && state.players.p2.connected;
}

export function scheduleStart(state, countdownMs, onScheduleStart) {
  if (!state.started && !state.gameOver && !state.startAt && bothPlayersConnected(state)) {
    if (onScheduleStart) {
      onScheduleStart(state);
    }
    state.startAt = Date.now() + countdownMs;
  }
}

const gamesByNamespace = new WeakMap();

export function getGamesStore(nsp) {
  if (!nsp) return new Map();
  if (!gamesByNamespace.has(nsp)) {
    gamesByNamespace.set(nsp, new Map());
  }
  return gamesByNamespace.get(nsp);
}

export function tickGames({
  games,
  nsp,
  dtFallback = 1 / 60,
  beforeUpdate,
  updateState,
  serializeState,
  afterEmit,
  stateEvent = "state",
}) {
  const now = Date.now();

  for (const [gameId, state] of games.entries()) {
    const dt = (now - state.lastUpdate) / 1000 || dtFallback;
    state.lastUpdate = now;

    if (beforeUpdate) {
      beforeUpdate(state, dt);
    }

    if (updateState) {
      updateState(state, dt);
    }

    if (serializeState) {
      emitEvent({ nsp, gameId, type: stateEvent, payload: serializeState(state), target: "game" });
    }

    if (afterEmit) {
      afterEmit(state, dt);
    }
  }
}

export function joinGameRoom({
  nsp,
  socket,
  games,
  gameId,
  createState,
  onStateCreated,
}) {
  if (!gameId) return null;

  const room = nsp.adapter.rooms.get(gameId);
  let playerId;

  if (!room) {
    playerId = "p1";
  } else if (room.size === 1) {
    playerId = "p2";
  } else {
    emitEvent({ socket, type: "roomFull" });
    return null;
  }

  socket.join(gameId);
  socket.data.gameId = gameId;
  socket.data.playerId = playerId;

  if (!games.has(gameId)) {
    games.set(gameId, createState());
    if (onStateCreated) {
      onStateCreated(games.get(gameId));
    }
  }

  return {
    playerId,
    state: games.get(gameId),
  };
}

export function handlePlayerDisconnect({ socket, games, onPlayerDisconnect }) {
  const { gameId, playerId } = socket.data;
  if (!gameId || !playerId) return;

  const state = games.get(gameId);
  if (!state || !state.players || !state.players[playerId]) return;

  if (onPlayerDisconnect) {
    onPlayerDisconnect(state, playerId);
  }

  emitEvent({ socket, gameId, type: "playerLeft", payload: { playerId }, target: "others" });
}

export function handleJoinGame({
  nsp,
  socket,
  games,
  gameId,
  createState,
  onStateCreated,
  onPlayerConnected,
}) {
  const joined = joinGameRoom({
    nsp,
    socket,
    games,
    gameId,
    createState,
    onStateCreated,
  });
  if (!joined) return;

  const { playerId, state } = joined;
  if (state && state.players[playerId]) {
    if (onPlayerConnected) {
      onPlayerConnected(state, playerId);
    }
  }

  emitEvent({ socket, type: "gameJoined", payload: { playerId, gameId } });
  emitEvent({ socket, gameId, type: "playerJoined", payload: { playerId }, target: "others" });
}

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

export function registerGame({
  io,
  meta,
  createState,
  onStateCreated,
  onPlayerConnected,
  handleInput,
  handleDisconnect,
  handleRematch,
  beforeUpdate,
  updateState,
  serializeState,
  afterEmit,
  tickMs = 1000 / 60,
  dtFallback = 1 / 60,
  stateEvent = "state",
}) {
  const nsp = io.of(meta.namespace);
  const games = getGamesStore(nsp);

  setInterval(
    () =>
      tickGames({
        games,
        nsp,
        dtFallback,
        beforeUpdate,
        updateState,
        serializeState,
        afterEmit,
        stateEvent,
      }),
    tickMs,
  );

  registerSocketHandlers(nsp, (socket) => {
    const handlers = {
      joinGame: createJoinHandler({
        nsp,
        socket,
        games,
        createState,
        onStateCreated,
        onPlayerConnected,
      }),
      input: createInputHandler({ socket, games, handleInput }),
      disconnect: createDisconnectHandler({ socket, games, handleDisconnect }),
    };

    if (handleRematch) {
      handlers.rematch = createRematchHandler({ socket, games, nsp, handleRematch });
    }

    return handlers;
  });
}

function createJoinHandler({ nsp, socket, games, createState, onStateCreated, onPlayerConnected }) {
  return ({ gameId }) =>
    handleJoinGame({
      nsp,
      socket,
      games,
      gameId,
      createState,
      onStateCreated,
      onPlayerConnected,
    });
}

function createInputHandler({ socket, games, handleInput }) {
  if (!handleInput) return null;
  return (payload) => {
    const gameId = socket.data.gameId;
    const playerId = socket.data.playerId;
    if (!gameId || !playerId) return;

    const state = games.get(gameId);
    if (!state) return;

    handleInput({ state, playerId, payload, socket });
  };
}

function createDisconnectHandler({ socket, games, handleDisconnect }) {
  return () =>
    handlePlayerDisconnect({
      socket,
      games,
      onPlayerDisconnect: handleDisconnect,
    });
}

function createRematchHandler({ socket, games, nsp, handleRematch }) {
  return (payload) =>
    handleRematch({
      socket,
      games,
      nsp,
      payload,
    });
}

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
