import { createGameRegistry, GAME_PLUGIN_API_VERSION } from "../core/gameRegistry.js";
import { registerFightGame } from "./fight.js";
import { registerPongGame } from "./pong.js";
import { registerRoadRashGame } from "./roadrash.js";
import { registerMarioGame, registerMarioTouchGame } from "./mario.js";
import { registerDrawGame } from "./draw.js";
import { deadShiftGameMeta, registerDeadShiftGame } from "./dead-shift.js";
import { skyDashGameMeta, registerSkyDashGame } from "./sky-dash.js";
import { riftballGameMeta, registerRiftballGame } from "./riftball.js";
import { ludoGameMeta, registerLudoGame } from "./ludo.js";
import { edgeoutGameMeta, edgeoutPracticeGameMeta, registerEdgeoutGame, registerEdgeoutPracticeGame } from "./edgeout.js";
import { driftlineGameMeta, driftlinePracticeGameMeta, registerDriftlineGame, registerDriftlinePracticeGame } from "./driftline.js";
import {
  registerSkybreakGame,
  registerSkybreakPracticeGame,
  registerSkybreakTimeTrialGame,
  skybreakGameMeta,
  skybreakPracticeGameMeta,
  skybreakTimeTrialGameMeta,
} from "./skybreak.js";
import {
  fightGameMeta,
  pongGameMeta,
  roadRashGameMeta,
  marioGameMeta,
  marioTouchGameMeta,
  drawGameMeta,
  webglSampleGameMeta,
} from "./metadata.js";

/** Compatibility routes belong to built-in composition, alongside the package list. */
export const legacyRoomRouteAliases = Object.freeze([
  Object.freeze({ path: "/room/:roomId", gameId: fightGameMeta.id }),
]);

/**
 * Compose only trusted packages imported by this application.
 * Remove or add a built-in here without changing reusable engine services.
 * @returns {import("../core/gameRegistry.js").GameRegistry}
 */
export function createBuiltInGameRegistry() {
  return createGameRegistry([
    { apiVersion: GAME_PLUGIN_API_VERSION, meta: skybreakGameMeta, register: registerSkybreakGame },
    { apiVersion: GAME_PLUGIN_API_VERSION, meta: skybreakPracticeGameMeta, register: registerSkybreakPracticeGame },
    { apiVersion: GAME_PLUGIN_API_VERSION, meta: skybreakTimeTrialGameMeta, register: registerSkybreakTimeTrialGame },
    { apiVersion: GAME_PLUGIN_API_VERSION, meta: driftlineGameMeta, register: registerDriftlineGame },
    { apiVersion: GAME_PLUGIN_API_VERSION, meta: driftlinePracticeGameMeta, register: registerDriftlinePracticeGame },
    { apiVersion: GAME_PLUGIN_API_VERSION, meta: edgeoutGameMeta, register: registerEdgeoutGame },
    { apiVersion: GAME_PLUGIN_API_VERSION, meta: edgeoutPracticeGameMeta, register: registerEdgeoutPracticeGame },
    { apiVersion: GAME_PLUGIN_API_VERSION, meta: ludoGameMeta, register: registerLudoGame },
    { apiVersion: GAME_PLUGIN_API_VERSION, meta: riftballGameMeta, register: registerRiftballGame },
    { apiVersion: GAME_PLUGIN_API_VERSION, meta: skyDashGameMeta, register: registerSkyDashGame },
    { apiVersion: GAME_PLUGIN_API_VERSION, meta: deadShiftGameMeta, register: registerDeadShiftGame },
    { apiVersion: GAME_PLUGIN_API_VERSION, meta: fightGameMeta, register: registerFightGame },
    { apiVersion: GAME_PLUGIN_API_VERSION, meta: pongGameMeta, register: registerPongGame },
    { apiVersion: GAME_PLUGIN_API_VERSION, meta: roadRashGameMeta, register: registerRoadRashGame },
    { apiVersion: GAME_PLUGIN_API_VERSION, meta: marioGameMeta, register: registerMarioGame },
    { apiVersion: GAME_PLUGIN_API_VERSION, meta: marioTouchGameMeta, register: registerMarioTouchGame },
    { apiVersion: GAME_PLUGIN_API_VERSION, meta: drawGameMeta, register: registerDrawGame },
    { apiVersion: GAME_PLUGIN_API_VERSION, meta: webglSampleGameMeta },
  ]);
}
