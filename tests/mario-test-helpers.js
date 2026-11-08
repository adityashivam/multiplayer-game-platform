import { registerMarioGame, registerMarioTouchGame } from "../server/platform-backend-engine/games/mario.js";
import { getGamesStore } from "../server/platform-backend-engine/core/gameStore.js";

/** Exercise the registered game with real rooms, input ownership and simulation. */
export function createMarioTestSession(gameId = "mario") {
  let connectSocket;
  let scheduledServerTick;
  const snapshotPackets = [];
  const namespace = {
    adapter: { rooms: new Map() },
    sockets: new Map(),
    on: (_eventName, callback) => { connectSocket = callback; },
    to: () => ({ emit: (eventName, snapshotPacket) => {
      if (eventName === "state") snapshotPackets.push(snapshotPacket);
    } }),
  };
  const originalSetTimeout = globalThis.setTimeout;
  let simulation;
  globalThis.setTimeout = (callback) => {
    scheduledServerTick = callback;
    return 0;
  };
  try {
    const registerGame = gameId === "mario-touch" ? registerMarioTouchGame : registerMarioGame;
    simulation = registerGame({ of: () => namespace });
  } finally {
    globalThis.setTimeout = originalSetTimeout;
  }

  const games = getGamesStore(namespace);
  let nextSocketId = 1;
  const getState = () => games.get("room");
  function connectPlayer(rejoinToken) {
    const socketHandlers = {};
    const socketEvents = [];
    const socket = {
      id: `socket-${nextSocketId++}`,
      data: {},
      on: (eventName, callback) => { socketHandlers[eventName] = callback; },
      join: (roomId) => {
        if (!namespace.adapter.rooms.has(roomId)) namespace.adapter.rooms.set(roomId, new Set());
        namespace.adapter.rooms.get(roomId).add(socket.id);
      },
      leave: (roomId) => { namespace.adapter.rooms.get(roomId)?.delete(socket.id); },
      emit: (eventName, payload) => { socketEvents.push([eventName, payload]); },
      to: () => ({ emit() {} }),
    };
    namespace.sockets.set(socket.id, socket);
    connectSocket(socket);
    socketHandlers.joinGame({ gameId: "room", rejoinToken });
    return {
      socket,
      socketHandlers,
      socketEvents,
      disconnect() {
        socketHandlers.disconnect();
        socket.leave("room");
        namespace.sockets.delete(socket.id);
      },
    };
  }

  function advanceSimulation(nowMs = 100) {
    const state = getState();
    state.__loopTick = (state.__loopTick || 0) + 1;
    state.__loopMonotonicNow = nowMs;
    simulation.step(state, 1 / 60);
  }

  function sendInputFrame(client, sequenceNumber, inputOverrides = {}) {
    const playerState = getState().players[client.socket.data.playerId];
    const inputPacket = {
      type: "inputFrame",
      protocol: 2,
      epoch: playerState.inputEpoch,
      seq: sequenceNumber,
      state: { left: false, right: false, run: false, jump: false, ...inputOverrides },
    };
    client.socketHandlers.input(inputPacket);
    playerState.__lastInputReceiptMs = 100;
    return inputPacket;
  }

  function emitSnapshot() {
    globalThis.setTimeout = () => 0;
    try { scheduledServerTick(); } finally { globalThis.setTimeout = originalSetTimeout; }
    return snapshotPackets.at(-1);
  }

  return { getState, connectPlayer, advanceSimulation, sendInputFrame, emitSnapshot };
}

export function readMarioSnapshotField(snapshotPacket, fieldPath) {
  return snapshotPacket.v[snapshotPacket.p.indexOf(fieldPath)];
}
