import { FIGHT_INPUT_TEMPLATE } from "../../../public/games/fight/shared/simulation.js";
import { fightPresentation } from "../../../public/games/fight/catalog.js";
import { pongPresentation } from "../../../public/games/pong/catalog.js";
import { roadRashPresentation } from "../../../public/games/roadrash/catalog.js";
import { marioPresentation } from "../../../public/games/mario/catalog.js";
import { marioTouchPresentation } from "../../../public/games/mario-touch/catalog.js";
import { drawPresentation } from "../../../public/games/draw/catalog.js";
import { webglSamplePresentation } from "../../../public/games/webgl-sample/catalog.js";

const BUNDLED_GAME_TICK_RATE_HZ = 60;
const BUNDLED_PLAYER_IDS = Object.freeze(["p1", "p2"]);

/**
 * @typedef {import("../../../public/games/fight/shared/simulation.js").FightInputState} FightInputTemplate
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
  presentation: fightPresentation,
  name: "Kaboom Fight",
  description: "Read your rival. Time your strike. Settle it in a two-player sword duel.",
  namespace: "/fight",
  room: makeTwoPlayerRoomMetadata(),
  networking: makeNetworkingMetadata("/fight", FIGHT_INPUT_TEMPLATE),
  path: "/games/fight",
  engine: "kaboom",
  runtime: makeKaboomRuntime("fight"),
  tags: ["Real-time", "2 players", "Action"],
  startInLandscape: true,
  platformControlButtons: true,
};

export const pongGameMeta = {
  id: "pong",
  presentation: pongPresentation,
  name: "Kaboom Pong",
  description: "One ball. Two paddles. Keep the rally alive and find your winning angle.",
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
  presentation: roadRashPresentation,
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
  presentation: marioPresentation,
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
  presentation: marioTouchPresentation,
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
  presentation: drawPresentation,
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
  presentation: webglSamplePresentation,
  name: "WebGL Drift",
  description: "Find your line, dodge the traffic, and see how long you can last.",
  path: "/games/webgl-sample/play",
  engine: "webgl",
  runtime: makeWebglRuntime("webgl-sample"),
  tags: ["Arcade", "Action", "Single Player", "WebGL"],
  startInLandscape: true,
  platformControlButtons: true,
  shareRoom: false,
  networked: false,
};
