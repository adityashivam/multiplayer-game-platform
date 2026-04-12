export const gameTitles = {
  fight: "Kaboom Fight",
  pong: "Kaboom Pong",
  roadrash: "Road Rash Online",
  mario: "Mario Rival Rush",
  "mario-touch": "Mario Rival Rush Touch",
  draw: "Live Draw Duel",
  "webgl-sample": "WebGL Drift",
};

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

export const fallbackGames = [
  {
    id: "fight",
    name: "Kaboom Fight",
    description: "Duel with a friend in this 2-player sword fight built with Kaboom.js.",
    path: "/games/fight",
    engine: "kaboom",
    runtime: makeKaboomRuntime("fight"),
    tags: ["Real-time", "2 players", "Action"],
    startInLandscape: true,
    platformControlButtons: true,
  },
  {
    id: "pong",
    name: "Kaboom Pong",
    description: "Classic two-player pong with server-run ball physics.",
    path: "/games/pong",
    engine: "kaboom",
    runtime: makeKaboomRuntime("pong"),
    tags: ["Arcade", "2 players", "Fast"],
    startInLandscape: true,
    platformControlButtons: true,
  },
  {
    id: "roadrash",
    name: "Road Rash Online",
    description: "Road Rash-inspired two-player bike race with kicks and highway traffic.",
    path: "/games/roadrash",
    engine: "kaboom",
    runtime: makeKaboomRuntime("roadrash"),
    tags: ["Racing", "2 players", "Action"],
    startInLandscape: true,
    platformControlButtons: true,
  },
  {
    id: "mario",
    name: "Mario Rival Rush",
    description: "Head-to-head Mario platform race. Beat your rival to the flag.",
    path: "/games/mario",
    engine: "kaboom",
    runtime: makeKaboomRuntime("mario"),
    tags: ["Platformer", "2 players", "Race"],
    startInLandscape: true,
    platformControlButtons: true,
  },
  {
    id: "mario-touch",
    name: "Mario Rival Rush Touch",
    description:
      "Mario race tuned for fullscreen landscape play with on-screen touch controls.",
    path: "/games/mario-touch",
    engine: "kaboom",
    runtime: makeKaboomRuntime("mario-touch"),
    tags: ["Platformer", "2 players", "Race", "Touch"],
    startInLandscape: true,
    platformControlButtons: false,
  },
  {
    id: "draw",
    name: "Live Draw Duel",
    description: "Touch and draw together. Your strokes appear live on your rival screen.",
    path: "/games/draw",
    engine: "kaboom",
    runtime: makeKaboomRuntime("draw"),
    tags: ["Creative", "2 players", "Realtime"],
    startInLandscape: true,
    platformControlButtons: true,
  },
  {
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
  },
];

export const visualsByGame = {
  fight: {
    status: "ACTIVE",
    players: "2P",
    icon: "swords",
    art:
      "https://lh3.googleusercontent.com/aida-public/AB6AXuDfFo7xAE8YpsiLcTu8wVB5TDryjICa68MoJz3L_xzevsn28LBYu4SK3yrTg3hfV7txizFKMpVntHcHWxkRR7lFfBgyZ7USU6-Qw5PIWc-ftfLN-bpENLwLkLP7PbwD9CRqiIcuWqXJl_0i2N8BX2nDUkj3ldFNzpMt70L6MGNOhZC-7oyfQKEu8Pd9DVsW-kgl5U9TAQh_6l4vz0xDg7rPGWmB_8uyUuMcwiHLG0MnSeuWkLJMM363GgkHe_dKnRwsbJt9ThPtXU9i",
    featured: true,
  },
  pong: {
    status: "ARCADE",
    players: "2P",
    icon: "sports_tennis",
    art:
      "https://lh3.googleusercontent.com/aida-public/AB6AXuCU-xEUh7OsSfRk3s2Bt77jkrHr-TZvbGTC28QtcnpavWc88RXHY6OpNjB2jXpD_auchl2SDu6xQw1LPd0sXqmc36wOh89AkyKmKIPB31mN9AiBjnMJbykmX4bRMANwHiPtliTIaFF_DDYiuBRPrqropD_hk6DRRmZdowywoFAVGPk8RWx2E_VTmf-dDoAY9R1a3F82Op4wEPZy_d8zQ3Gfc20VPFoEpNZ3ejkpXCuvzpGA0CGPPHSeL7bqOQJHStW6d-dNLmCu995Y",
  },
  roadrash: {
    status: "RACE",
    players: "2P",
    icon: "two_wheeler",
    art: "/games/roadrash/assets/roadrash.png",
  },
  mario: {
    status: "NEW",
    players: "2P",
    icon: "sports_esports",
    art: "/games/mario/assets/sprites/player.png",
    featured: true,
  },
  "mario-touch": {
    status: "TOUCH",
    players: "2P",
    icon: "screen_rotation",
    art: "/games/mario/assets/sprites/player.png",
  },
  draw: {
    status: "LAB",
    players: "2P",
    icon: "draw",
  },
  "webgl-sample": {
    status: "WEBGL",
    players: "1P",
    icon: "deployed_code",
    art: "/games/webgl-sample/assets/poster.svg",
    featured: true,
  },
};
