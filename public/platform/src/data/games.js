import { fightPresentation } from "../../../games/fight/catalog.js";
import { pongPresentation } from "../../../games/pong/catalog.js";
import { roadRashPresentation } from "../../../games/roadrash/catalog.js";
import { marioPresentation } from "../../../games/mario/catalog.js";
import { marioTouchPresentation } from "../../../games/mario-touch/catalog.js";
import { drawPresentation } from "../../../games/draw/catalog.js";
import { webglSamplePresentation } from "../../../games/webgl-sample/catalog.js";
import { deadShiftPresentation, deadShiftTouchControls } from "../../../games/dead-shift/catalog.js";

export const gameTitles = {
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
