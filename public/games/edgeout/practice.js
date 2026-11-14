import { EDGEOUT_PRACTICE_GAME_ID } from "./shared/config.js";
import { startEdgeout } from "./client/app.js";

/** Solo practice entry: one human seat against a server-owned CPU fighter. */
startEdgeout({ gameId: EDGEOUT_PRACTICE_GAME_ID });
