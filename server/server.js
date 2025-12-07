import fs from "fs";
import { createServer } from "http";
import { Server } from "socket.io";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { registerFightGame } from "./games/fight.js";
import { registerPongGame } from "./games/pong.js";
import { fightGameMeta, pongGameMeta } from "./games/metadata.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

const catalog = [
  { ...fightGameMeta },
  { ...pongGameMeta },
];

app.use(express.static(path.join(__dirname, "../public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../public/index.html"));
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

  const htmlPath = path.join(__dirname, "../public/games", gameId, "index.html");
  if (!fs.existsSync(htmlPath)) {
    return res.status(404).send("Game client not found");
  }

  res.sendFile(htmlPath);
});

// Register socket handlers for each game
registerFightGame(io);
registerPongGame(io);

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`🎮 Kaboom Platform server running on http://localhost:${PORT}`);
});
