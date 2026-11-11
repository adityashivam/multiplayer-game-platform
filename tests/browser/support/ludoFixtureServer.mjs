import http from "node:http";
import https from "node:https";
import { Server } from "socket.io";
import msgpackParser from "socket.io-msgpack-parser";
import { rollLudoDie } from "../../../server/platform-backend-engine/games/ludoDice.js";
import { registerLudoGame } from "../../../server/platform-backend-engine/games/ludo.js";
import { getGamesStore } from "../../../server/platform-backend-engine/core/gameStore.js";
import { advanceLudoRound } from "../../../public/games/ludo/shared/rules.js";

const targetOrigin = new URL(process.env.PLATFORM_BASE_URL || "http://localhost:3000");
const assetTransport = targetOrigin.protocol === "https:" ? https : http;
let diceQueue = [];

// Test-only authority. Scenarios arrive over parent IPC, never an HTTP endpoint.
const httpServer = http.createServer((request, response) => {
  const assetRequest = assetTransport.request({
    hostname: targetOrigin.hostname,
    port: targetOrigin.port || undefined,
    path: request.url,
    method: request.method,
    headers: { ...request.headers, host: targetOrigin.host },
  }, (assetResponse) => {
    response.writeHead(assetResponse.statusCode || 502, assetResponse.headers);
    assetResponse.pipe(response);
  });
  assetRequest.on("error", () => {
    if (!response.headersSent) response.writeHead(502);
    response.end("The local asset server is unavailable.");
  });
  request.pipe(assetRequest);
});
const socketServer = new Server(httpServer, {
  transports: ["websocket"],
  parser: msgpackParser,
  pingInterval: 5000,
  pingTimeout: 10000,
});
registerLudoGame(socketServer, { rollDie: (diceContext) => diceQueue.shift() ?? rollLudoDie(diceContext) });

/** Install a valid late-match position without adding production cheat controls. */
function prepareBoardFixture(roomState, fixtureKind) {
  for (const player of Object.values(roomState.players)) {
    player.tokens = [-1, -1, -1, -1];
    player.finished = 0;
    player.captures = 0;
  }
  Object.assign(roomState, {
    started: true,
    startAt: null,
    gameOver: false,
    winner: null,
    currentPlayerId: "p1",
    phase: "roll",
    diceValue: 0,
    consecutiveSixes: 0,
    legalTokenIndices: [],
    phaseEndsAtMs: 0,
    turnEndsAtMs: Date.now() + 30000,
    lastMessage: "Your turn. Roll the dice.",
    revision: roomState.revision + 1,
    lastAction: {
      id: roomState.lastAction.id + 1, kind: "none", playerId: "p1", tokenIndex: -1,
      from: -1, to: -1, diceValue: 0, startedAtMs: Date.now(), durationMs: 0,
      capturedPlayerId: null, capturedTokenIndex: -1,
    },
  });
  if (fixtureKind === "capture") {
    roomState.players.p1.tokens[0] = 0;
    roomState.players.p2.tokens[0] = 32;
  } else if (fixtureKind === "safe") {
    roomState.players.p1.tokens[0] = 2;
    roomState.players.p2.tokens[0] = 34;
  } else if (fixtureKind === "blockade") {
    roomState.players.p1.tokens[0] = 0;
    roomState.players.p2.tokens = [32, 32, -1, -1];
  } else if (fixtureKind === "win") {
    roomState.players.p1.tokens = [56, 56, 56, 50];
    roomState.players.p1.finished = 3;
  } else if (fixtureKind !== "yard") {
    throw new Error("Unsupported Ludo test position");
  }
}

process.on("message", (request) => {
  try {
    if (!request || typeof request.id !== "number") return;
    if (request.type === "dice") {
      if (!Array.isArray(request.values) || request.values.length > 128 ||
          request.values.some(value => !Number.isInteger(value) || value < 1 || value > 6)) {
        throw new Error("Invalid test dice sequence");
      }
      diceQueue = [...request.values];
      process.send?.({ id: request.id, ok: true });
      return;
    }
    const roomState = getGamesStore(socketServer.of("/ludo")).get(request.roomId);
    if (!roomState) throw new Error("Test room has not joined");
    if (request.type === "recreate") {
      const namespace = socketServer.of("/ludo");
      const socketIds = [...(namespace.adapter.rooms.get(request.roomId) || [])];
      getGamesStore(namespace).delete(request.roomId);
      for (const socketId of socketIds) namespace.sockets.get(socketId)?.conn.close();
      process.send?.({ id: request.id, ok: true });
      return;
    }
    if (request.type === "fixture") prepareBoardFixture(roomState, request.fixture);
    if (request.type === "expireDecision") {
      if (roomState.phase !== "roll" && roomState.phase !== "choose") {
        throw new Error("Only a live Ludo decision can expire");
      }
      const nowMs = Date.now();
      roomState.turnEndsAtMs = nowMs - 1;
      advanceLudoRound(roomState, nowMs);
    }
    process.send?.({ id: request.id, ok: true, revision: roomState.revision, roundId: roomState.roundId });
  } catch (error) {
    process.send?.({ id: request?.id, ok: false, message: error.message });
  }
});

httpServer.listen(0, "127.0.0.1", () => {
  process.send?.({ ready: true, url: `http://127.0.0.1:${httpServer.address().port}` });
});
