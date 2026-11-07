import { createServer } from "http";
import { Server } from "socket.io";
import msgpackParser from "socket.io-msgpack-parser";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { registerHealthRoute } from "./healthRoutes.js";
import {
  createBuiltInGameRegistry,
  legacyRoomRouteAliases,
} from "../platform-backend-engine/games/builtInGames.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const platformIndex = path.join(__dirname, "../../public/platform/dist/index.html");

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: "*" },
  transports: ["websocket"],
  parser: msgpackParser,
  pingInterval: 5000,
  pingTimeout: 10000,
});

const gameRegistry = createBuiltInGameRegistry();

app.use(
  express.static(path.join(__dirname, "../../public"), {
    index: false,
    redirect: false,
  }),
);

app.get("/", (req, res) => {
  res.sendFile(platformIndex);
});

registerHealthRoute(app);

app.get("/api/games", (req, res) => {
  res.json({
    games: gameRegistry.listGames().map((game) => ({
      id: game.id,
      name: game.name,
      description: game.description,
      path: game.path,
      engine: game.engine || "kaboom",
      runtime: game.runtime || null,
      tags: game.tags || [],
      startInLandscape: game.startInLandscape === true,
      platformControlButtons: game.platformControlButtons !== false,
      shareRoom: game.shareRoom !== false,
      networked: game.networked !== false,
      ...(game.namespace !== undefined ? { namespace: game.namespace } : {}),
      ...(game.room !== undefined ? { room: game.room } : {}),
      ...(game.networking !== undefined ? { networking: game.networking } : {}),
      url: `${req.protocol}://${req.get("host")}${game.path}`,
    })),
  });
});

app.get("/api/games/:gameId/new-room", (req, res) => {
  const { gameId } = req.params;
  const game = gameRegistry.getGame(gameId);
  if (!game) {
    return res.status(404).json({ error: "Unknown game" });
  }

  const roomId = Math.random().toString(36).slice(2, 8);
  res.json({
    roomId,
    url: `${req.protocol}://${req.get("host")}${game.path}/${roomId}`,
  });
});

for (const routeAlias of legacyRoomRouteAliases) {
  const targetGame = gameRegistry.getGame(routeAlias.gameId);
  app.get(routeAlias.path, (req, res) => {
    res.redirect(`${targetGame.path}/${req.params.roomId}`);
  });
}

// Serve per-game clients
app.get("/games/:gameId/:roomId?", (req, res) => {
  const { gameId } = req.params;
  const game = gameRegistry.getGame(gameId);
  if (!game) {
    return res.status(404).send("Game not found");
  }

  res.sendFile(platformIndex);
});

gameRegistry.registerGames(io);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`🎮 Kaboom Platform server running on http://localhost:${PORT}`);
});
