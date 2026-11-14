import { LAST_FUSE_GAME_ID } from "./shared/config.js";
import { startLastFuse } from "./client/app.js";

/** Online entry: two human seats and four bots. */
startLastFuse({ gameId: LAST_FUSE_GAME_ID });
