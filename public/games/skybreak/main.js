import { SKYBREAK_GAME_ID } from "./shared/config.js";
import { startSkybreak } from "./client/app.js";

/** Online dogfight entry: two human seats and four bots. */
startSkybreak({ gameId: SKYBREAK_GAME_ID });
