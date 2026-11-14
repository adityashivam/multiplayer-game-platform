import { DRIFTLINE_PRACTICE_GAME_ID } from "./shared/config.js";
import { startDriftline } from "./client/app.js";

/** Solo practice entry: one human seat against five server-owned bots. */
startDriftline({ gameId: DRIFTLINE_PRACTICE_GAME_ID });
