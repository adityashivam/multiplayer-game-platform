/** Game-owned board and protocol configuration, shared by browser and server. */
export const LUDO_GAME_ID = "ludo";
export const LUDO_PLAYER_IDS = Object.freeze(["p1", "p2"]);
export const LUDO_SUPPORTED_PLAYER_IDS = Object.freeze(["p1", "p2", "p3", "p4"]);
export const LUDO_COLORS = Object.freeze(["red", "green", "yellow", "blue"]);

export const LUDO_PALETTE = Object.freeze({
  red: Object.freeze({ color: "#fa5b6a", light: "#ffe5e6", label: "Coral" }),
  green: Object.freeze({ color: "#24caa2", light: "#ddfbef", label: "Emerald" }),
  yellow: Object.freeze({ color: "#ffc447", light: "#fff2ce", label: "Gold" }),
  blue: Object.freeze({ color: "#5b9ef5", light: "#e4efff", label: "Blue" }),
});

export const LUDO_LIMITS = Object.freeze({
  TOKENS_PER_PLAYER: 4,
  BOARD_CELLS: 15,
  RING_LENGTH: 52,
  HOME_START: 51,
  HOME_FINISH: 56,
  YARD: -1,
  ROLL_DURATION_MS: 1050,
  STEP_DURATION_MS: 145,
  MOVE_LANDING_MS: 250,
  NO_MOVE_DURATION_MS: 850,
  TURN_TIMEOUT_MS: 30000,
  SERVER_TICK_MS: 100,
});

export const LUDO_ACTION = Object.freeze({ ROLL: "roll", MOVE: "move" });
export const LUDO_START_INDICES = Object.freeze({ red: 0, green: 13, yellow: 26, blue: 39 });
export const LUDO_SAFE_INDICES = Object.freeze([0, 8, 13, 21, 26, 34, 39, 47]);

/** Clockwise outer track, starting beside the red home. Values are [column,row]. */
export const LUDO_RING_CELLS = Object.freeze([
  [1, 6], [2, 6], [3, 6], [4, 6], [5, 6], [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0], [7, 0], [8, 0],
  [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [9, 6], [10, 6], [11, 6], [12, 6], [13, 6], [14, 6], [14, 7], [14, 8],
  [13, 8], [12, 8], [11, 8], [10, 8], [9, 8], [8, 9], [8, 10], [8, 11], [8, 12], [8, 13], [8, 14], [7, 14], [6, 14],
  [6, 13], [6, 12], [6, 11], [6, 10], [6, 9], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8], [0, 7], [0, 6],
].map(Object.freeze));

export const LUDO_HOME_LANES = Object.freeze({
  red: Object.freeze([[1, 7], [2, 7], [3, 7], [4, 7], [5, 7], [6, 7]].map(Object.freeze)),
  green: Object.freeze([[7, 1], [7, 2], [7, 3], [7, 4], [7, 5], [7, 6]].map(Object.freeze)),
  yellow: Object.freeze([[13, 7], [12, 7], [11, 7], [10, 7], [9, 7], [8, 7]].map(Object.freeze)),
  blue: Object.freeze([[7, 13], [7, 12], [7, 11], [7, 10], [7, 9], [7, 8]].map(Object.freeze)),
});

export const LUDO_YARD_CELLS = Object.freeze({
  red: Object.freeze([[1.9, 1.9], [4.1, 1.9], [1.9, 4.1], [4.1, 4.1]].map(Object.freeze)),
  green: Object.freeze([[9.9, 1.9], [12.1, 1.9], [9.9, 4.1], [12.1, 4.1]].map(Object.freeze)),
  yellow: Object.freeze([[9.9, 9.9], [12.1, 9.9], [9.9, 12.1], [12.1, 12.1]].map(Object.freeze)),
  blue: Object.freeze([[1.9, 9.9], [4.1, 9.9], [1.9, 12.1], [4.1, 12.1]].map(Object.freeze)),
});

/**
 * @typedef {"p1"|"p2"|"p3"|"p4"} LudoPlayerId
 * @typedef {"red"|"green"|"yellow"|"blue"} LudoColor
 * @typedef {"roll"|"rolling"|"choose"|"moving"|"pass"|"finished"} LudoPhase
 * @typedef {{type:"roll",roundId:number,revision:number}|{type:"move",roundId:number,revision:number,tokenIndex:number}} LudoCommand
 */
