import { DRIFTLINE_GAME_ID } from "./shared/config.js";
import { startDriftline } from "./client/app.js";

/** Online race entry: two human seats and four bots. */
startDriftline({ gameId: DRIFTLINE_GAME_ID });
