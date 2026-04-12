function makeKaboomRuntime(id) {
  return {
    kind: "module",
    mount: "canvas",
    entryUrl: `/games/${id}/main.js`,
    socketIo: true,
    kaboom: true,
  };
}

function makeWebglRuntime(id) {
  return {
    kind: "module",
    mount: "canvas",
    entryUrl: `/games/${id}/main.js`,
    socketIo: false,
    kaboom: false,
  };
}

export const fightGameMeta = {
  id: "fight",
  name: "Kaboom Fight",
  description: "Two-player sword duel powered by Kaboom.js and Socket.IO.",
  namespace: "/fight",
  path: "/games/fight",
  engine: "kaboom",
  runtime: makeKaboomRuntime("fight"),
  tags: ["Real-time", "2 players", "Action"],
  startInLandscape: true,
  platformControlButtons: true,
};

export const pongGameMeta = {
  id: "pong",
  name: "Kaboom Pong",
  description: "Classic two-player pong duel with server-authoritative ball physics.",
  namespace: "/pong",
  path: "/games/pong",
  engine: "kaboom",
  runtime: makeKaboomRuntime("pong"),
  tags: ["Arcade", "2 players", "Fast"],
  startInLandscape: true,
  platformControlButtons: true,
};

export const roadRashGameMeta = {
  id: "roadrash",
  name: "Road Rash Online",
  description: "Road Rash-inspired 2-player race with kicking, traffic, and real-time multiplayer.",
  namespace: "/roadrash",
  path: "/games/roadrash",
  engine: "kaboom",
  runtime: makeKaboomRuntime("roadrash"),
  tags: ["Racing", "2 players", "Action"],
  startInLandscape: true,
  platformControlButtons: true,
};

export const marioGameMeta = {
  id: "mario",
  name: "Mario Rival Rush",
  description: "Head-to-head 2-player Mario platform race. Reach the flag first to win.",
  namespace: "/mario",
  path: "/games/mario",
  engine: "kaboom",
  runtime: makeKaboomRuntime("mario"),
  tags: ["Platformer", "2 players", "Race"],
  startInLandscape: true,
  platformControlButtons: true,
};

export const marioTouchGameMeta = {
  id: "mario-touch",
  name: "Mario Rival Rush Touch",
  description: "Head-to-head Mario race tuned for fullscreen landscape and touch controls.",
  namespace: "/mario-touch",
  path: "/games/mario-touch",
  engine: "kaboom",
  runtime: makeKaboomRuntime("mario-touch"),
  tags: ["Platformer", "2 players", "Race", "Touch"],
  startInLandscape: true,
  platformControlButtons: false,
};

export const drawGameMeta = {
  id: "draw",
  name: "Live Draw Duel",
  description: "Draw with touch or mouse and mirror strokes live to your rival.",
  namespace: "/draw",
  path: "/games/draw",
  engine: "kaboom",
  runtime: makeKaboomRuntime("draw"),
  tags: ["Creative", "2 players", "Realtime"],
  startInLandscape: true,
  platformControlButtons: true,
};

export const webglSampleGameMeta = {
  id: "webgl-sample",
  name: "WebGL Drift",
  description: "Single-player WebGL dodge runner built on the standard browser canvas/WebGL runtime path.",
  path: "/games/webgl-sample/play",
  engine: "webgl",
  runtime: makeWebglRuntime("webgl-sample"),
  tags: ["Arcade", "Action", "Single Player", "WebGL"],
  startInLandscape: true,
  platformControlButtons: true,
  shareRoom: false,
  networked: false,
};
