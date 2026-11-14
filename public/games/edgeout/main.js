import { EDGEOUT_GAME_ID } from "./shared/config.js";
import { startEdgeout } from "./client/app.js";

/** Competitive duel entry: two human seats. */
startEdgeout({ gameId: EDGEOUT_GAME_ID });
