import { SKYBREAK_PRACTICE_GAME_ID } from "./shared/config.js";
import { startSkybreak } from "./client/app.js";

/** Solo dogfight practice against five bots. */
startSkybreak({ gameId: SKYBREAK_PRACTICE_GAME_ID });
