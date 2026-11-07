import test from "node:test";
import assert from "node:assert/strict";
import { tickGames } from "../server/platform-backend-engine/core/gameLoop.js";

test("room elapsed uses monotonic time and simulation tick counts fixed steps", () => {
  const gameState = {};
  const games = new Map([["room", gameState]]);
  const snapshotPackets = [];
  const namespace = {
    to: () => ({ emit: (_event, snapshotPacket) => snapshotPackets.push(snapshotPacket) }),
  };
  const advanceRoomTick = (nowMs, monotonicNowMs) => tickGames({
    games,
    nsp: namespace,
    tickMs: 10,
    nowMs,
    monotonicNowMs,
    updateState: () => {},
    serializeState: () => ({ value: 1 }),
  });

  advanceRoomTick(1000, 100);
  advanceRoomTick(500, 125);
  assert.equal(snapshotPackets.at(-1).n.simTick, 2);
  assert.equal(snapshotPackets.at(-1).n.serverTime, 500);

  advanceRoomTick(9999, 125);
  assert.equal(snapshotPackets.at(-1).n.simTick, 2);
});

test("join response carries the connected player input epoch", async () => {
  const { handleJoinGame } = await import("../server/platform-backend-engine/core/rooms.js");
  const socketEvents = [];
  const socket = {
    data: {},
    join() {},
    emit: (eventName, socketPayload) => socketEvents.push([eventName, socketPayload]),
    to: () => ({ emit() {} }),
  };
  const namespace = { adapter: { rooms: new Map() }, sockets: new Map() };

  handleJoinGame({
    nsp: namespace,
    socket,
    games: new Map(),
    gameId: "room",
    createState: () => ({ players: { p1: { inputEpoch: 0 }, p2: {} } }),
    onPlayerConnected: (gameState, playerId) => {
      gameState.players[playerId].inputEpoch += 1;
    },
  });
  assert.equal(socketEvents[0][1].inputEpoch, 1);
});
