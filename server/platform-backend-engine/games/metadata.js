const BUNDLED_GAME_TICK_RATE_HZ = 60;
const BUNDLED_PLAYER_IDS = Object.freeze(["p1", "p2"]);

/**
 * @typedef {{left: boolean, right: boolean, jump: boolean, attack: boolean, heavyAttack: boolean, aerialAttack: boolean}} FightInputTemplate
 * @typedef {{up: boolean, down: boolean}} PongInputTemplate
 */

/** @returns {{playerIds: string[]}} Each game owns its room metadata. */
function makeTwoPlayerRoomMetadata() {
  return { playerIds: [...BUNDLED_PLAYER_IDS] };
}

/**
 * Only games accepting inputFrame advertise continuous diagnostic input.
 * Other bundled games expose snapshot and RTT sampling through their namespace.
 * @param {string} namespace
 * @param {FightInputTemplate|PongInputTemplate|null} [inputTemplate]
 * @returns {{namespace: string, tickRateHz: number, inputProtocol: 2|null, inputTemplate: FightInputTemplate|PongInputTemplate|null}}
 */
function makeNetworkingMetadata(namespace, inputTemplate = null) {
  return {
    namespace,
    tickRateHz: BUNDLED_GAME_TICK_RATE_HZ,
    inputProtocol: inputTemplate === null ? null : 2,
    inputTemplate,
  };
}

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
  room: makeTwoPlayerRoomMetadata(),
  networking: makeNetworkingMetadata("/fight", {
    left: false,
    right: false,
    jump: false,
    attack: false,
    heavyAttack: false,
    aerialAttack: false,
  }),
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
  room: makeTwoPlayerRoomMetadata(),
  networking: makeNetworkingMetadata("/pong", { up: false, down: false }),
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
  room: makeTwoPlayerRoomMetadata(),
  networking: makeNetworkingMetadata("/roadrash"),
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
  room: makeTwoPlayerRoomMetadata(),
  networking: makeNetworkingMetadata("/mario"),
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
  room: makeTwoPlayerRoomMetadata(),
  networking: makeNetworkingMetadata("/mario-touch"),
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
  room: makeTwoPlayerRoomMetadata(),
  networking: makeNetworkingMetadata("/draw"),
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
