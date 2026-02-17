import { createServer } from "http";
import { Server } from "socket.io";
import msgpackParser from "socket.io-msgpack-parser";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { registerFightGame } from "./games/fight.js";
import { registerPongGame } from "./games/pong.js";
import { registerRoadRashGame } from "./games/roadrash.js";
import { registerMarioGame } from "./games/mario.js";
import {
  fightGameMeta,
  pongGameMeta,
  roadRashGameMeta,
  marioGameMeta,
} from "./games/metadata.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const platformIndex = path.join(__dirname, "../public/platform/dist/index.html");

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: "*" },
  transports: ["websocket"],
  parser: msgpackParser,
  pingInterval: 5000,
  pingTimeout: 10000,
});

const catalog = [
  { ...fightGameMeta },
  { ...pongGameMeta },
  { ...roadRashGameMeta },
  { ...marioGameMeta },
];

app.use(
  express.static(path.join(__dirname, "../public"), {
    index: false,
    redirect: false,
  }),
);

app.get("/", (req, res) => {
  res.sendFile(platformIndex);
});

app.get("/api/games", (req, res) => {
  res.json({
    games: catalog.map((game) => ({
      id: game.id,
      name: game.name,
      description: game.description,
      path: game.path,
      tags: game.tags || [],
      url: `${req.protocol}://${req.get("host")}${game.path}`,
    })),
  });
});

app.get("/api/games/:gameId/new-room", (req, res) => {
  const { gameId } = req.params;
  const game = catalog.find((g) => g.id === gameId);
  if (!game) {
    return res.status(404).json({ error: "Unknown game" });
  }

  const roomId = Math.random().toString(36).slice(2, 8);
  res.json({
    roomId,
    url: `${req.protocol}://${req.get("host")}${game.path}/${roomId}`,
  });
});

// Redirect legacy URLs to the new fight path
app.get("/room/:roomId", (req, res) => {
  res.redirect(`${fightGameMeta.path}/${req.params.roomId}`);
});

// Serve per-game clients
app.get("/games/:gameId/:roomId?", (req, res) => {
  const { gameId } = req.params;
  const game = catalog.find((g) => g.id === gameId);
  if (!game) {
    return res.status(404).send("Game not found");
  }

  res.sendFile(platformIndex);
});

// Register socket handlers for each game
registerFightGame(io);
registerPongGame(io);
registerRoadRashGame(io);
registerMarioGame(io);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`🎮 Kaboom Platform server running on http://localhost:${PORT}`);
});
