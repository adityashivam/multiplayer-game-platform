/** @typedef {import("./shared/simulation.js").FightPlayerId} FightPlayerId */
/** @typedef {"strikes"|"techniques"|"mobility"|"locomotion"} FightMoveSheetId */
/** @typedef {import("./shared/simulation.js").FightAttackType|"jump"|"slide"|"dodge"|"guard"|"idle"|"run"|"death"} FightMoveClipId */
/** @typedef {{spriteName: string, fileName: string, columns: number, rows: number, cellSize: number}} FightMoveSheet */
/** @typedef {{sheet: FightMoveSheetId, startFrame: number, frameCount: number, normalizedScale: number, feetY: number, frameFeetY?: readonly number[], frameOffsetsX?: readonly number[], holdFrame?: number}} FightMoveClip */

const MOVE_COLUMNS = 8;
const CHARACTER_ART_VERSION = "v4";
/** @type {Readonly<Record<FightMoveSheetId, {rows: number, cellSize: number}>>} */
const SHEET_GEOMETRY = Object.freeze({
  strikes: Object.freeze({ rows: 4, cellSize: 221.75 }),
  techniques: Object.freeze({ rows: 4, cellSize: 221.75 }),
  mobility: Object.freeze({ rows: 4, cellSize: 221.75 }),
  locomotion: Object.freeze({ rows: 3, cellSize: 256 }),
});
const BODY_SCALE_BY_SHEET = Object.freeze({
  p1: Object.freeze({ strikes: 0.554375, techniques: 0.53883178, mobility: 0.54909524, locomotion: 0.5640678 }),
  p2: Object.freeze({ strikes: 0.5761152, techniques: 0.48565083, mobility: 0.51547149, locomotion: 0.53417323 }),
});

/** @type {Readonly<Record<FightMoveClipId, {sheet: FightMoveSheetId, row: number}>>} */
const CLIP_LAYOUT = Object.freeze({
  light: { sheet: "strikes", row: 0 },
  light2: { sheet: "strikes", row: 1 },
  finisher: { sheet: "strikes", row: 2 },
  heavy: { sheet: "strikes", row: 3 },
  sweep: { sheet: "techniques", row: 0 },
  launcher: { sheet: "techniques", row: 1 },
  aerial: { sheet: "techniques", row: 2 },
  special: { sheet: "techniques", row: 3 },
  jump: { sheet: "mobility", row: 0 },
  slide: { sheet: "mobility", row: 1 },
  dodge: { sheet: "mobility", row: 2 },
  guard: { sheet: "mobility", row: 3 },
  idle: { sheet: "locomotion", row: 0 },
  run: { sheet: "locomotion", row: 1 },
  death: { sheet: "locomotion", row: 2 },
});

// Measured source contact rows keep different authored poses on the same world baseline.
const CLIP_CALIBRATION = Object.freeze({
  p1: Object.freeze({
    light: Object.freeze([198.0, 198.0, 198.0, 198.0, 198.0, 198.0, 198.0, 198.0]),
    light2: Object.freeze([197.25, 197.25, 197.25, 198.25, 197.25, 197.25, 197.25, 197.25]),
    finisher: Object.freeze([198.5, 198.5, 198.5, 198.5, 196.5, 198.5, 198.5, 198.5]),
    heavy: Object.freeze([197.75, 197.75, 197.75, 197.75, 197.75, 197.75, 197.75, 197.75]),
    sweep: Object.freeze([200.0, 201.0, 201.0, 201.0, 201.0, 201.0, 201.0, 201.0]),
    launcher: Object.freeze([200.25, 200.25, 200.25, 200.25, 200.25, 200.25, 200.25, 200.25]),
    aerial: Object.freeze([199.5, 199.5, 163.5, 137.5, 142.5, 162.5, 164.5, 164.5]),
    special: Object.freeze([198.75, 197.75, 197.75, 197.75, 197.75, 197.75, 197.75, 198.75]),
    jump: Object.freeze([207.0, 199.0, 162.0, 144.0, 169.0, 200.0, 207.0, 206.0]),
    slide: Object.freeze([202.25, 202.25, 203.25, 203.25, 203.25, 203.25, 203.25, 203.25]),
    dodge: Object.freeze([202.5, 202.5, 204.5, 197.5, 203.5, 203.5, 203.5, 202.5]),
    guard: Object.freeze([201.75, 201.75, 201.75, 201.75, 201.75, 201.75, 201.75, 201.75]),
    idle: Object.freeze([207, 207, 207, 207, 207, 207, 207, 207]),
    // Keep airborne stride frames registered to the same floor plane.
    run: Object.freeze([203, 203, 203, 203, 203, 203, 203, 203]),
    death: Object.freeze([207, 207, 207, 207, 207, 207, 207, 207]),
  }),
  p2: Object.freeze({
    light: Object.freeze([192.0, 192.0, 192.0, 192.0, 192.0, 192.0, 192.0, 192.0]),
    light2: Object.freeze([192.25, 192.25, 192.25, 192.25, 193.25, 192.25, 192.25, 192.25]),
    finisher: Object.freeze([192.5, 192.5, 192.5, 192.5, 194.5, 192.5, 192.5, 192.5]),
    heavy: Object.freeze([191.75, 191.75, 191.75, 191.75, 191.75, 191.75, 191.75, 191.75]),
    sweep: Object.freeze([205.0, 206.0, 204.0, 206.0, 207.0, 205.0, 205.0, 205.0]),
    launcher: Object.freeze([204.25, 203.25, 203.25, 205.25, 204.25, 204.25, 204.25, 204.25]),
    aerial: Object.freeze([204.5, 204.5, 154.5, 141.5, 154.5, 184.5, 202.5, 204.5]),
    special: Object.freeze([204.75, 201.75, 201.75, 201.75, 201.75, 201.75, 203.75, 203.75]),
    jump: Object.freeze([211.0, 208.0, 173.0, 141.0, 177.0, 206.0, 211.0, 211.0]),
    slide: Object.freeze([207.25, 205.25, 208.25, 208.25, 208.25, 208.25, 207.25, 207.25]),
    dodge: Object.freeze([205.5, 205.5, 197.5, 186.5, 196.5, 205.5, 205.5, 205.5]),
    guard: Object.freeze([201.75, 200.75, 200.75, 201.75, 201.75, 201.75, 201.75, 201.75]),
    idle: Object.freeze([206, 206, 206, 206, 206, 206, 206, 206]),
    run: Object.freeze([199, 199, 199, 199, 199, 199, 199, 199]),
    death: Object.freeze([198, 198, 198, 198, 198, 198, 199, 198]),
  }),
});

/** @param {FightPlayerId} playerId @returns {Readonly<Record<FightMoveSheetId, Readonly<FightMoveSheet>>>} */
function createPlayerMoveSheets(playerId) {
  const playerNumber = playerId === "p1" ? 1 : 2;
  /** @param {FightMoveSheetId} sheetId */
  const createMoveSheet = (sheetId) => Object.freeze({
    spriteName: `moves-player${playerNumber}-${sheetId}-${CHARACTER_ART_VERSION}`,
    fileName: `moves-player${playerNumber}-${sheetId}-${CHARACTER_ART_VERSION}.png`,
    columns: MOVE_COLUMNS,
    ...SHEET_GEOMETRY[sheetId],
  });
  return Object.freeze({
    strikes: createMoveSheet("strikes"), techniques: createMoveSheet("techniques"),
    mobility: createMoveSheet("mobility"), locomotion: createMoveSheet("locomotion"),
  });
}

/** @param {FightPlayerId} playerId @returns {Readonly<Record<FightMoveClipId, Readonly<FightMoveClip>>>} */
function createPlayerMoveClips(playerId) {
  return Object.freeze(Object.fromEntries(Object.entries(CLIP_LAYOUT).map(([clipId, layout]) => [clipId, Object.freeze({
    sheet: layout.sheet,
    startFrame: layout.row * MOVE_COLUMNS,
    frameCount: MOVE_COLUMNS,
    ...(clipId === "sweep" ? { holdFrame: 2 } : {}),
    normalizedScale: BODY_SCALE_BY_SHEET[playerId][layout.sheet],
    feetY: CLIP_CALIBRATION[playerId][clipId][0],
    frameFeetY: CLIP_CALIBRATION[playerId][clipId],
  })])));
}

/** @type {Readonly<Record<FightPlayerId, Readonly<Record<FightMoveSheetId, Readonly<FightMoveSheet>>>>>} */
export const FIGHT_MOVE_SHEETS = Object.freeze({ p1: createPlayerMoveSheets("p1"), p2: createPlayerMoveSheets("p2") });
/** @type {Readonly<Record<FightPlayerId, Readonly<Record<FightMoveClipId, Readonly<FightMoveClip>>>>>} */
export const FIGHT_MOVE_CLIPS = Object.freeze({ p1: createPlayerMoveClips("p1"), p2: createPlayerMoveClips("p2") });
