import { SKYBREAK_TIME_TRIAL_GAME_ID } from "./shared/config.js";
import { startSkybreak } from "./client/app.js";

/** Solo time trial through the canyon gates. */
startSkybreak({ gameId: SKYBREAK_TIME_TRIAL_GAME_ID });
