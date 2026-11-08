import { createGameRegistry, GAME_PLUGIN_API_VERSION } from "../core/gameRegistry.js";
import { registerFightGame } from "./fight.js";
import { registerPongGame } from "./pong.js";
import { registerRoadRashGame } from "./roadrash.js";
import { registerMarioGame, registerMarioTouchGame } from "./mario.js";
import { registerDrawGame } from "./draw.js";
import { deadShiftGameMeta, registerDeadShiftGame } from "./dead-shift.js";
import { skyDashGameMeta, registerSkyDashGame } from "./sky-dash.js";
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
