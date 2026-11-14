import { BUMPER_LINKS_GAME_ID } from "./shared/config.js";
import { startBumperLinks } from "./client/app.js";

/** Online entry: two human seats and two bots. */
startBumperLinks({ gameId: BUMPER_LINKS_GAME_ID });
