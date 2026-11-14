import { LAST_FUSE_PRACTICE_GAME_ID } from "./shared/config.js";
import { startLastFuse } from "./client/app.js";

/** Solo practice entry: one human seat and five bots. */
startLastFuse({ gameId: LAST_FUSE_PRACTICE_GAME_ID });
