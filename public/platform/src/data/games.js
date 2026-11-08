import { fightPresentation, fightTouchControls } from "../../../games/fight/catalog.js";
import { pongPresentation, pongTouchControls } from "../../../games/pong/catalog.js";
import { roadRashPresentation, roadRashTouchControls } from "../../../games/roadrash/catalog.js";
import { marioPresentation, marioTouchControls } from "../../../games/mario/catalog.js";
import { marioTouchPresentation, marioTouchVariantControls } from "../../../games/mario-touch/catalog.js";
import { drawPresentation, drawTouchControls } from "../../../games/draw/catalog.js";
import { webglSamplePresentation, webglSampleTouchControls } from "../../../games/webgl-sample/catalog.js";
import { deadShiftPresentation, deadShiftTouchControls } from "../../../games/dead-shift/catalog.js";
import { skyDashPresentation, skyDashTouchControls } from "../../../games/sky-dash/catalog.js";
import { riftballPresentation, riftballTouchControls } from "../../../games/riftball/catalog.js";
import { ludoPresentation, ludoTouchControls } from "../../../games/ludo/catalog.js";

export const gameTitles = {
  ludo: "Ludo Table",
  riftball: "Riftball Duel",
  "sky-dash": "Sky Dash",
  "dead-shift": "Dead Shift",
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
    id: "ludo",
    name: "Ludo Table",
    description: "A colorful 3D Ludo table for two friends. Roll, capture, race home and talk through shared room voice.",
    presentation: ludoPresentation,
    touchControls: ludoTouchControls,
    path: "/games/ludo",
    namespace: "/ludo",
    engine: "webgl",
    runtime: { kind: "module", mount: "canvas", entryUrl: "/games/ludo/dist/main.js", socketIo: true, kaboom: false },
    tags: ["Board", "2 players", "3D", "Strategy"],
    platformControlButtons: true,
  },
  {
    id: "riftball",
    name: "Riftball Duel",
    description: "One ball. Every angle is yours. Charge, dash and feint through a competitive 3D court duel.",
    presentation: riftballPresentation,
    touchControls: riftballTouchControls,
    path: "/games/riftball",
    engine: "webgl",
    runtime: { kind: "module", mount: "canvas", entryUrl: "/games/riftball/dist/main.js", socketIo: true, kaboom: false },
    tags: ["Sports", "2 players", "Competitive", "3D"],
    platformControlButtons: true,
  },
  {
    id: "sky-dash",
    name: "Sky Dash",
    description: "Jump, dash and dive through a sky-high obstacle race. Two friends, three bots, one crown.",
    presentation: skyDashPresentation,
    touchControls: skyDashTouchControls,
    path: "/games/sky-dash",
    engine: "webgl",
    runtime: { kind: "module", mount: "canvas", entryUrl: "/games/sky-dash/dist/main.js", socketIo: true, kaboom: false },
    tags: ["Racing", "2 players", "3D", "Platformer"],
    startInLandscape: true,
    platformControlButtons: true,
  },
  {
    id: "dead-shift",
    name: "Dead Shift",
    presentation: deadShiftPresentation,
    touchControls: deadShiftTouchControls,
    description: "Two survivors. One shared horde. Race for the most zombie kills in a 90-second containment breach.",
    path: "/games/dead-shift",
    engine: "webgl",
    runtime: {
      kind: "module",
      mount: "canvas",
      entryUrl: "/games/dead-shift/dist/main.js",
      socketIo: true,
      kaboom: false,
    },
    tags: ["Shooter", "2 players", "Horror", "3D"],
    startInLandscape: true,
    platformControlButtons: true,
  },
  {
    id: "fight",
    presentation: fightPresentation,
    touchControls: fightTouchControls,
    name: "Kaboom Fight",
    description: "Read your rival. Time your strike. Settle it in a two-player sword duel.",
    path: "/games/fight",
    engine: "kaboom",
    runtime: makeKaboomRuntime("fight"),
    tags: ["Real-time", "2 players", "Action"],
    startInLandscape: true,
    platformControlButtons: true,
  },
  {
    id: "pong",
    presentation: pongPresentation,
    touchControls: pongTouchControls,
    name: "Kaboom Pong",
    description: "One ball. Two paddles. Keep the rally alive and find your winning angle.",
    path: "/games/pong",
    engine: "kaboom",
    runtime: makeKaboomRuntime("pong"),
    tags: ["Arcade", "2 players", "Fast"],
    startInLandscape: true,
    platformControlButtons: true,
  },
  {
    id: "roadrash",
    presentation: roadRashPresentation,
    touchControls: roadRashTouchControls,
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
    presentation: marioPresentation,
    touchControls: marioTouchControls,
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
    presentation: marioTouchPresentation,
    touchControls: marioTouchVariantControls,
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
    presentation: drawPresentation,
    touchControls: drawTouchControls,
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
    presentation: webglSamplePresentation,
    touchControls: webglSampleTouchControls,
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
  },
];
