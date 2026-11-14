import { BUMPER_LINKS_PRACTICE_GAME_ID } from "./shared/config.js";
import { startBumperLinks } from "./client/app.js";

/** Solo practice entry: one human seat and three bots. */
startBumperLinks({ gameId: BUMPER_LINKS_PRACTICE_GAME_ID });
