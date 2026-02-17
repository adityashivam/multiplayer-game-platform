export const fightGameMeta = {
  id: "fight",
  name: "Kaboom Fight",
  description: "Two-player sword duel powered by Kaboom.js and Socket.IO.",
  namespace: "/fight",
  path: "/games/fight",
  tags: ["Real-time", "2 players", "Action"],
  platformControlButtons: true,
};

export const pongGameMeta = {
  id: "pong",
  name: "Kaboom Pong",
  description: "Classic two-player pong duel with server-authoritative ball physics.",
  namespace: "/pong",
  path: "/games/pong",
  tags: ["Arcade", "2 players", "Fast"],
  platformControlButtons: true,
};

export const roadRashGameMeta = {
  id: "roadrash",
  name: "Road Rash Online",
  description: "Road Rash-inspired 2-player race with kicking, traffic, and real-time multiplayer.",
  namespace: "/roadrash",
  path: "/games/roadrash",
  tags: ["Racing", "2 players", "Action"],
  platformControlButtons: true,
};

export const marioGameMeta = {
  id: "mario",
  name: "Mario Rival Rush",
  description: "Head-to-head 2-player Mario platform race. Reach the flag first to win.",
  namespace: "/mario",
  path: "/games/mario",
  tags: ["Platformer", "2 players", "Race"],
  platformControlButtons: true,
};

export const marioTouchGameMeta = {
  id: "mario-touch",
  name: "Mario Rival Rush Touch",
  description: "Head-to-head Mario race tuned for fullscreen landscape and touch controls.",
  namespace: "/mario-touch",
  path: "/games/mario-touch",
  tags: ["Platformer", "2 players", "Race", "Touch"],
  platformControlButtons: false,
};

export const drawGameMeta = {
  id: "draw",
  name: "Live Draw Duel",
  description: "Draw with touch or mouse and mirror strokes live to your rival.",
  namespace: "/draw",
  path: "/games/draw",
  tags: ["Creative", "2 players", "Realtime"],
  platformControlButtons: true,
};
