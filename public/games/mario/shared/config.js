import { buildOneOneTrack } from "../levelData.js";

/** @typedef {{left: boolean, right: boolean, run: boolean, jump: boolean}} MarioInputState */
/** @typedef {"p1"|"p2"} MarioPlayerId */

/** @type {Readonly<MarioInputState>} */
export const MARIO_INPUT_TEMPLATE = Object.freeze({ left: false, right: false, run: false, jump: false });
/** @type {ReadonlyArray<keyof MarioInputState>} */
export const MARIO_EDGE_KEYS = Object.freeze(["jump"]);
/** @type {ReadonlyArray<MarioPlayerId>} */
export const MARIO_PLAYER_IDS = Object.freeze(["p1", "p2"]);
export const MARIO_TICK_RATE_HZ = 60;
export const MARIO_FIXED_DT_SEC = 1 / MARIO_TICK_RATE_HZ;
export const MARIO_TRACK = buildOneOneTrack();

export const MARIO_MOVEMENT_SETTINGS = Object.freeze({
  PLAYER_WIDTH: 16,
  PLAYER_HEIGHT: 16,
  WALK_ACCEL: 920,
  RUN_ACCEL: 1320,
  AIR_ACCEL: 720,
  GROUND_FRICTION: 1080,
  AIR_DRAG: 180,
  MAX_WALK_SPEED: 125,
  MAX_RUN_SPEED: 175,
  JUMP_SPEED: 460,
  GRAVITY: 1450,
  MAX_FALL_SPEED: 760,
});

export const MARIO_START_POSITIONS = Object.freeze({
  p1: Object.freeze({ ...MARIO_TRACK.playerSpawn }),
  p2: Object.freeze({ x: MARIO_TRACK.playerSpawn.x + 24, y: MARIO_TRACK.playerSpawn.y }),
});
