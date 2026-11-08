import {
  LUDO_HOME_LANES,
  LUDO_LIMITS,
  LUDO_PLAYER_IDS,
  LUDO_RING_CELLS,
  LUDO_SAFE_INDICES,
  LUDO_START_INDICES,
  LUDO_SUPPORTED_PLAYER_IDS,
  LUDO_YARD_CELLS,
} from "./config.js";

/** @typedef {import("./config.js").LudoPlayerId} LudoPlayerId */
/** @typedef {import("./config.js").LudoColor} LudoColor */
/** @typedef {import("./config.js").LudoPhase} LudoPhase */
/** @typedef {"none"|"roll"|"move"|"pass"|"capture"|"finish"} LudoActionKind */
/**
 * @typedef {object} LudoPlayerState
 * @property {LudoPlayerId} id
 * @property {LudoColor} color
 * @property {number[]} tokens Four progress values: -1 in the yard, 0..55 on the track, 56 home.
 * @property {boolean} connected Owned by the authoritative room lifecycle.
 * @property {number} finished Number of pieces that reached exact home.
 * @property {number} captures
 * @property {number} seriesWins Preserved by the server between rematches.
 * @property {number} entryMisses Accepted non-six yard rolls, below ENTRY_ROLL_LIMIT.
 */
/** @typedef {{p1?:LudoPlayerState,p2?:LudoPlayerState,p3?:LudoPlayerState,p4?:LudoPlayerState}} LudoPlayers */
/**
 * @typedef {object} LudoLastAction
 * @property {number} id Monotonic within one round, including passes.
 * @property {LudoActionKind} kind
 * @property {LudoPlayerId|null} playerId
 * @property {number|null} tokenIndex
 * @property {number} from Token progress, never a visual coordinate.
 * @property {number} to
 * @property {number} diceValue
 * @property {number} startedAtMs Authoritative wall time.
 * @property {number} durationMs
 * @property {LudoPlayerId|null} capturedPlayerId
 * @property {number|null} capturedTokenIndex
 */
/**
 * Complete bounded recovery state. Rules mutate this state; callers own its lifetime.
 * @typedef {object} LudoRoundState
 * @property {number} roundId
 * @property {number} revision
 * @property {LudoPlayerId[]} playerIds
 * @property {LudoPlayers} players
 * @property {boolean} started
 * @property {number|null} startAt
 * @property {boolean} gameOver
 * @property {LudoPlayerId|null} winner
 * @property {LudoPlayerId} currentPlayerId
 * @property {LudoPhase} phase
 * @property {number} diceValue Zero before a roll.
 * @property {number} rollSerial
 * @property {number} consecutiveSixes
 * @property {number[]} legalTokenIndices
 * @property {number} phaseEndsAtMs Zero outside an animation/message phase.
 * @property {number} turnEndsAtMs Zero outside a decision phase.
 * @property {string} lastMessage
 * @property {LudoLastAction} lastAction
 */

/** @type {Readonly<{p1:LudoColor,p2:LudoColor,p3:LudoColor,p4:LudoColor}>} */
const LUDO_SEAT_COLORS = Object.freeze({ p1: "red", p2: "yellow", p3: "green", p4: "blue" });
const SAFE_RING_INDICES = new Set(LUDO_SAFE_INDICES);
const DICE_MINIMUM = 1;
const DICE_MAXIMUM = 6;
const MAX_CONSECUTIVE_SIXES = 3;
const MAX_UNSAFE_STACK = 2;

/**
 * Create a round without starting its clock; the server supplies ready-room timing.
 * @param {{playerIds?:readonly LudoPlayerId[],roundId?:number}} [options]
 * @returns {LudoRoundState}
 * @throws {TypeError} For unsupported/duplicate seats, capacity, or round identity.
 */
export function createLudoRound({ playerIds = LUDO_PLAYER_IDS, roundId = 1 } = {}) {
  if (!Array.isArray(playerIds) || playerIds.length < 2 || playerIds.length > 4 ||
      new Set(playerIds).size !== playerIds.length ||
      playerIds.some((playerId) => !LUDO_SUPPORTED_PLAYER_IDS.includes(playerId)) ||
      !Number.isSafeInteger(roundId) || roundId < 1) {
    throw new TypeError("Ludo requires two to four unique supported seats and a positive roundId.");
  }

  /** @type {LudoPlayers} */
  const players = {};
  for (const playerId of playerIds) {
    players[playerId] = {
      id: playerId,
      color: LUDO_SEAT_COLORS[playerId],
      tokens: Array(LUDO_LIMITS.TOKENS_PER_PLAYER).fill(LUDO_LIMITS.YARD),
      connected: false,
      finished: 0,
      captures: 0,
      seriesWins: 0,
      entryMisses: 0,
    };
  }

  return {
    roundId,
    revision: 0,
    playerIds: [...playerIds],
    players,
    started: false,
    startAt: null,
    gameOver: false,
    winner: null,
    currentPlayerId: playerIds[0],
    phase: "roll",
    diceValue: 0,
    rollSerial: 0,
    consecutiveSixes: 0,
    legalTokenIndices: [],
    phaseEndsAtMs: 0,
    turnEndsAtMs: 0,
    lastMessage: "Waiting for players",
    lastAction: {
      id: 0,
      kind: "none",
      playerId: null,
      tokenIndex: null,
      from: LUDO_LIMITS.YARD,
      to: LUDO_LIMITS.YARD,
      diceValue: 0,
      startedAtMs: 0,
      durationMs: 0,
      capturedPlayerId: null,
      capturedTokenIndex: null,
    },
  };
}

/**
 * Convert game progress to a board cell; rendering offsets never enter simulation.
 * @param {LudoColor} color
 * @param {number} progress
 * @param {number} [tokenIndex=0]
 * @returns {{column:number,row:number}} A fresh coordinate object.
 * @throws {TypeError|RangeError} For unknown colors or out-of-range piece progress.
 */
export function getLudoTokenCell(color, progress, tokenIndex = 0) {
  if (!Object.hasOwn(LUDO_START_INDICES, color)) {
    throw new TypeError("Unknown Ludo color.");
  }
  if (!Number.isInteger(progress) || progress < LUDO_LIMITS.YARD || progress > LUDO_LIMITS.HOME_FINISH ||
      !Number.isInteger(tokenIndex) || tokenIndex < 0 || tokenIndex >= LUDO_LIMITS.TOKENS_PER_PLAYER) {
    throw new RangeError("Ludo token coordinates require valid progress and a token index.");
  }

  const cell = progress === LUDO_LIMITS.YARD ? LUDO_YARD_CELLS[color][tokenIndex] :
    progress >= LUDO_LIMITS.HOME_START ? LUDO_HOME_LANES[color][progress - LUDO_LIMITS.HOME_START] :
      LUDO_RING_CELLS[getLudoRingIndex(color, progress)];
  return { column: cell[0], row: cell[1] };
}

/** @param {LudoColor} color @param {number} progress @returns {number} */
function getLudoRingIndex(color, progress) {
  return (LUDO_START_INDICES[color] + progress) % LUDO_LIMITS.RING_LENGTH;
}

/** @param {number} diceValue @returns {boolean} */
function isLudoDiceValue(diceValue) {
  return Number.isInteger(diceValue) && diceValue >= DICE_MINIMUM && diceValue <= DICE_MAXIMUM;
}

/**
 * Count one owner's pieces on an outer-ring cell, excluding yard and home lane.
 * @param {LudoPlayerState} playerState
 * @param {number} ringIndex
 * @returns {number}
 */
function countLudoPiecesOnRingCell(playerState, ringIndex) {
  let pieceCount = 0;
  for (const progress of playerState.tokens) {
    if (progress >= 0 && progress < LUDO_LIMITS.HOME_START &&
        getLudoRingIndex(playerState.color, progress) === ringIndex) {
      pieceCount += 1;
    }
  }
  return pieceCount;
}

/**
 * Opponent blockades affect every traversed unsafe ring cell, including landing.
 * @param {LudoRoundState} state
 * @param {LudoPlayerId} playerId
 * @param {number} from
 * @param {number} to
 * @returns {boolean}
 */
function hasLudoOpponentBlockade(state, playerId, from, to) {
  const playerState = state.players[playerId];
  for (let progress = Math.max(0, from + 1); progress <= Math.min(to, LUDO_LIMITS.HOME_START - 1); progress += 1) {
    const ringIndex = getLudoRingIndex(playerState.color, progress);
    if (SAFE_RING_INDICES.has(ringIndex)) {
      continue;
    }
    for (const opponentId of state.playerIds) {
      if (opponentId !== playerId && countLudoPiecesOnRingCell(state.players[opponentId], ringIndex) >= MAX_UNSAFE_STACK) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Query legal choices without modifying phase, ownership or input state.
 * @param {LudoRoundState} state
 * @param {LudoPlayerId} playerId
 * @param {number} [diceValue=state.diceValue]
 * @returns {number[]} Indices in stable token order.
 */
export function getLegalLudoTokenIndices(state, playerId, diceValue = state.diceValue) {
  if (!Object.hasOwn(state.players, playerId) || state.gameOver || !isLudoDiceValue(diceValue)) {
    return [];
  }

  const playerState = state.players[playerId];
  const legalTokenIndices = [];
  for (let tokenIndex = 0; tokenIndex < playerState.tokens.length; tokenIndex += 1) {
    const from = playerState.tokens[tokenIndex];
    if (from === LUDO_LIMITS.HOME_FINISH || (from === LUDO_LIMITS.YARD && diceValue !== DICE_MAXIMUM)) {
      continue;
    }
    const to = from === LUDO_LIMITS.YARD ? 0 : from + diceValue;
    if (to > LUDO_LIMITS.HOME_FINISH || hasLudoOpponentBlockade(state, playerId, from, to)) {
      continue;
    }

    const destinationIsSafe = to === LUDO_LIMITS.HOME_FINISH ||
      (to < LUDO_LIMITS.HOME_START && SAFE_RING_INDICES.has(getLudoRingIndex(playerState.color, to)));
    const ownDestinationCount = playerState.tokens.reduce((count, progress, candidateIndex) =>
      count + Number(candidateIndex !== tokenIndex && progress === to), 0);
    if (!destinationIsSafe && ownDestinationCount >= MAX_UNSAFE_STACK) {
      continue;
    }
    legalTokenIndices.push(tokenIndex);
  }
  return legalTokenIndices;
}

/**
 * @param {LudoRoundState} state
 * @param {LudoPlayerId} playerId
 * @param {LudoPhase} phase
 * @param {number} nowMs
 * @returns {boolean}
 */
function canMakeLudoDecision(state, playerId, phase, nowMs) {
  return state.started && !state.gameOver && Object.hasOwn(state.players, playerId) &&
    state.currentPlayerId === playerId && state.phase === phase && Number.isFinite(nowMs) &&
    nowMs < state.turnEndsAtMs;
}

/**
 * Return the entry wait only when every unfinished piece remains in its yard.
 * Finished pieces do not count as active; track and home-lane pieces disable help.
 * @param {LudoPlayerState} playerState Read-only authoritative player state.
 * @returns {number} Zero when ineligible, otherwise 1..ENTRY_ROLL_LIMIT.
 */
export function getLudoEntryRollsRemaining(playerState) {
  const hasYardPiece = playerState.tokens.includes(LUDO_LIMITS.YARD);
  const hasActivePiece = playerState.tokens.some((progress) => progress >= 0 && progress < LUDO_LIMITS.HOME_FINISH);
  if (!hasYardPiece || hasActivePiece) return 0;

  return Math.max(1, LUDO_LIMITS.ENTRY_ROLL_LIMIT - (playerState.entryMisses ?? 0));
}

/**
 * Apply a natural server die with the disclosed quick-entry rule for every seat.
 * Only accepted rolls update entry progress; timeouts and invalid actions do not.
 * @param {LudoRoundState} state Mutated only on acceptance.
 * @param {LudoPlayerId} playerId
 * @param {number} naturalDiceValue Integer 1..6 generated by the authoritative server.
 * @param {number} nowMs
 * @returns {boolean}
 */
export function applyLudoRoll(state, playerId, naturalDiceValue, nowMs) {
  if (!canMakeLudoDecision(state, playerId, "roll", nowMs) || !isLudoDiceValue(naturalDiceValue)) {
    return false;
  }

  const playerState = state.players[playerId];
  const entryRollsRemaining = getLudoEntryRollsRemaining(playerState);
  const diceValue = entryRollsRemaining === 1 ? DICE_MAXIMUM : naturalDiceValue;
  playerState.entryMisses = entryRollsRemaining > 0 && diceValue !== DICE_MAXIMUM
    ? (playerState.entryMisses ?? 0) + 1 : 0;

  state.diceValue = diceValue;
  state.rollSerial += 1;
  state.consecutiveSixes = diceValue === DICE_MAXIMUM ? state.consecutiveSixes + 1 : 0;
  state.phase = "rolling";
  state.phaseEndsAtMs = nowMs + LUDO_LIMITS.ROLL_DURATION_MS;
  state.turnEndsAtMs = 0;
  state.legalTokenIndices = [];
  state.lastMessage = "Rolling the die";
  state.lastAction = {
    id: state.lastAction.id + 1,
    kind: "roll",
    playerId,
    tokenIndex: null,
    from: LUDO_LIMITS.YARD,
    to: LUDO_LIMITS.YARD,
    diceValue,
    startedAtMs: nowMs,
    durationMs: LUDO_LIMITS.ROLL_DURATION_MS,
    capturedPlayerId: null,
    capturedTokenIndex: null,
  };
  state.revision += 1;
  return true;
}

/**
 * Capture at most one opponent; shared safe cells never capture or block travel.
 * @param {LudoRoundState} state
 * @param {LudoPlayerId} playerId
 * @param {number} to
 * @returns {{capturedPlayerId:LudoPlayerId|null,capturedTokenIndex:number|null}}
 */
function captureLudoOpponent(state, playerId, to) {
  const playerState = state.players[playerId];
  if (to < LUDO_LIMITS.HOME_START) {
    const ringIndex = getLudoRingIndex(playerState.color, to);
    if (!SAFE_RING_INDICES.has(ringIndex)) {
      for (const opponentId of state.playerIds) {
        if (opponentId === playerId) {
          continue;
        }
        const opponentState = state.players[opponentId];
        const capturedTokenIndex = opponentState.tokens.findIndex((progress) =>
          progress >= 0 && progress < LUDO_LIMITS.HOME_START &&
          getLudoRingIndex(opponentState.color, progress) === ringIndex);
        if (capturedTokenIndex !== -1) {
          opponentState.tokens[capturedTokenIndex] = LUDO_LIMITS.YARD;
          playerState.captures += 1;
          return { capturedPlayerId: opponentId, capturedTokenIndex };
        }
      }
    }
  }
  return { capturedPlayerId: null, capturedTokenIndex: null };
}

/**
 * Commit logical movement/capture immediately and reserve its visible animation time.
 * @param {LudoRoundState} state Mutated only for a current legal choice.
 * @param {LudoPlayerId} playerId
 * @param {number} tokenIndex
 * @param {number} nowMs
 * @returns {boolean}
 */
export function applyLudoMove(state, playerId, tokenIndex, nowMs) {
  if (!canMakeLudoDecision(state, playerId, "choose", nowMs) || !Number.isInteger(tokenIndex) ||
      !getLegalLudoTokenIndices(state, playerId).includes(tokenIndex)) {
    return false;
  }

  const playerState = state.players[playerId];
  const from = playerState.tokens[tokenIndex];
  const to = from === LUDO_LIMITS.YARD ? 0 : from + state.diceValue;
  const capturedPiece = captureLudoOpponent(state, playerId, to);
  playerState.tokens[tokenIndex] = to;
  playerState.finished = playerState.tokens.filter((progress) => progress === LUDO_LIMITS.HOME_FINISH).length;
  const kind = to === LUDO_LIMITS.HOME_FINISH ? "finish" : capturedPiece.capturedPlayerId ? "capture" : "move";
  const hopCount = from === LUDO_LIMITS.YARD ? 1 : to - from;
  const durationMs = hopCount * LUDO_LIMITS.STEP_DURATION_MS + LUDO_LIMITS.MOVE_LANDING_MS;

  state.phase = "moving";
  state.phaseEndsAtMs = nowMs + durationMs;
  state.turnEndsAtMs = 0;
  state.legalTokenIndices = [];
  state.lastMessage = kind === "capture" ? "Captured a piece — roll again" :
    kind === "finish" ? "Home — roll again" : "Moving a piece";
  state.lastAction = {
    id: state.lastAction.id + 1,
    kind,
    playerId,
    tokenIndex,
    from,
    to,
    diceValue: state.diceValue,
    startedAtMs: nowMs,
    durationMs,
    ...capturedPiece,
  };
  state.revision += 1;
  return true;
}

/**
 * @param {LudoRoundState} state
 * @param {number} nowMs
 * @param {string} message
 * @param {boolean} [forfeit=false] A timeout never earns the unused six bonus.
 */
function beginLudoPass(state, nowMs, message, forfeit = false) {
  const displayedDiceValue = state.diceValue || state.lastAction.diceValue;
  if (forfeit) {
    state.consecutiveSixes = 0;
  }
  state.phase = "pass";
  state.phaseEndsAtMs = nowMs + LUDO_LIMITS.NO_MOVE_DURATION_MS;
  state.turnEndsAtMs = 0;
  state.legalTokenIndices = [];
  state.lastMessage = message;
  state.lastAction = {
    id: state.lastAction.id + 1,
    kind: "pass",
    playerId: state.currentPlayerId,
    tokenIndex: null,
    from: LUDO_LIMITS.YARD,
    to: LUDO_LIMITS.YARD,
    diceValue: displayedDiceValue,
    startedAtMs: nowMs,
    durationMs: LUDO_LIMITS.NO_MOVE_DURATION_MS,
    capturedPlayerId: null,
    capturedTokenIndex: null,
  };
  state.revision += 1;
}

/** @param {LudoRoundState} state @param {number} nowMs @param {boolean} extraRoll */
function beginNextLudoRoll(state, nowMs, extraRoll) {
  if (!extraRoll) {
    const currentIndex = state.playerIds.indexOf(state.currentPlayerId);
    state.currentPlayerId = state.playerIds[(currentIndex + 1) % state.playerIds.length];
    state.consecutiveSixes = 0;
  }
  state.phase = "roll";
  state.diceValue = 0;
  state.phaseEndsAtMs = 0;
  state.turnEndsAtMs = nowMs + LUDO_LIMITS.TURN_TIMEOUT_MS;
  state.legalTokenIndices = [];
  state.lastMessage = extraRoll ? "Bonus roll" : "Roll the die";
  state.revision += 1;
}

/**
 * Advance at most one phase. Long stalls never skip a human decision or replay actions.
 * Paused and finished rounds do not consume clocks or change revisions.
 * @param {LudoRoundState} state Mutated in place.
 * @param {number} nowMs
 * @returns {void}
 */
export function advanceLudoRound(state, nowMs) {
  if (!state.started || state.gameOver || !Number.isFinite(nowMs)) {
    return;
  }
  if (state.phase === "roll" || state.phase === "choose") {
    if (state.turnEndsAtMs > 0 && nowMs >= state.turnEndsAtMs) {
      beginLudoPass(state, nowMs, "Time expired — turn passed", true);
    }
    return;
  }
  if (nowMs < state.phaseEndsAtMs) {
    return;
  }

  if (state.phase === "rolling") {
    if (state.consecutiveSixes >= MAX_CONSECUTIVE_SIXES) {
      beginLudoPass(state, nowMs, "Three sixes — turn passed");
      return;
    }
    state.legalTokenIndices = getLegalLudoTokenIndices(state, state.currentPlayerId);
    if (state.legalTokenIndices.length === 0) {
      beginLudoPass(state, nowMs, "No legal move");
      return;
    }
    state.phase = "choose";
    state.phaseEndsAtMs = 0;
    state.turnEndsAtMs = nowMs + LUDO_LIMITS.TURN_TIMEOUT_MS;
    state.lastMessage = "Choose a glowing piece";
    state.revision += 1;
    return;
  }

  if (state.phase === "moving") {
    const playerState = state.players[state.currentPlayerId];
    if (playerState.finished === LUDO_LIMITS.TOKENS_PER_PLAYER) {
      state.gameOver = true;
      state.winner = state.currentPlayerId;
      state.phase = "finished";
      state.phaseEndsAtMs = 0;
      state.turnEndsAtMs = 0;
      state.lastMessage = "All four pieces home";
      playerState.seriesWins += 1;
      state.revision += 1;
      return;
    }
    beginNextLudoRoll(state, nowMs, state.diceValue === DICE_MAXIMUM ||
      state.lastAction.kind === "capture" || state.lastAction.kind === "finish");
    return;
  }

  if (state.phase === "pass") {
    beginNextLudoRoll(state, nowMs, state.diceValue === DICE_MAXIMUM &&
      state.consecutiveSixes > 0 && state.consecutiveSixes < MAX_CONSECUTIVE_SIXES);
  }
}
