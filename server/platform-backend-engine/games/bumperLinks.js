import { ROOM_START_COUNTDOWN_MS } from "../../../public/platform/shared/roomLifecycle.js";
import { INPUT_PROTOCOL, SOCKET_EVENT } from "../../../public/platform/shared/networkProtocol.js";
import { bumperLinksPresentation, bumperLinksTouchControls } from "../../../public/games/bumper-links/catalog.js";
import {
  BUMPER_LINKS_EDGE_KEYS,
  BUMPER_LINKS_FIXED_DT_SEC,
  BUMPER_LINKS_GAME_ID,
  BUMPER_LINKS_INPUT_TEMPLATE,
  BUMPER_LINKS_NUMERIC_INPUTS,
  BUMPER_LINKS_ONLINE_BOT_IDS,
  BUMPER_LINKS_ONLINE_PLAYER_IDS,
  BUMPER_LINKS_PRACTICE_BOT_IDS,
  BUMPER_LINKS_PRACTICE_GAME_ID,
  BUMPER_LINKS_PRACTICE_PLAYER_IDS,
} from "../../../public/games/bumper-links/shared/config.js";
import { createBumperLinksMatch, requestBumperLinksShot, stepBumperLinksWorld } from "../../../public/games/bumper-links/shared/match.js";
import { generateSolvableBumperLinksHole } from "../../../public/games/bumper-links/shared/solver.js";
import { createBumperLinksBotBrain, decideBumperLinksBotShot } from "../../../public/games/bumper-links/shared/bot.js";
import { createAuthoritativeInputSession } from "../core/authoritativeInputSession.js";
import { emitEvent, registerPluggableGame, scheduleStart } from "../core/index.js";

/** @typedef {import("../../../public/games/bumper-links/shared/config.js").BumperLinksInputState} BumperLinksInputState */
/** @typedef {import("../../../public/games/bumper-links/shared/ball.js").BumperLinksBall} BumperLinksBall */
/** @typedef {import("../../../public/games/bumper-links/shared/bot.js").BumperLinksBotBrain} BumperLinksBotBrain */
/**
 * @typedef {BumperLinksBall & import("../core/authoritativeInputSession.js").AuthoritativePlayerInputState<keyof BumperLinksInputState> & {
 *   input:BumperLinksInputState,inputEpoch:number,inputSimulationTick:number,lastInputSeqAck:number,rejoinToken?:string
 * }} BumperLinksServerBall
 * @typedef {Omit<import("../../../public/games/bumper-links/shared/match.js").BumperLinksMatch,"players"> & {
 *   players:Record<string,BumperLinksServerBall>,botBrains:BumperLinksBotBrain[],
 *   rematchRequests:Record<string,boolean>,abandonedAt:number|null,lastUpdate:number
 * }} BumperLinksServerState
 * @typedef {{playerIds:readonly string[],botIds:readonly string[]}} BumperLinksRoomOptions
 */

const ROOM_CLEANUP_DELAY_MS = 30000;
const MATCH_SEED_RANGE = 2 ** 31;
const BALL_SNAPSHOT_FIELDS = Object.freeze(/** @type {(keyof BumperLinksBall)[]} */ ([
  "id", "slotIndex", "x", "y", "z", "vx", "vy", "vz", "atRest", "aimYaw", "strokes", "totalStrokes",
  "sunk", "sinkOrder", "holePoints", "points", "knockouts", "splashes", "shotId", "lifeId", "connected",
]));
const bumperLinksInputSession = createAuthoritativeInputSession({
  inputTemplate: BUMPER_LINKS_INPUT_TEMPLATE,
  numericInputs: BUMPER_LINKS_NUMERIC_INPUTS,
  edgeKeys: BUMPER_LINKS_EDGE_KEYS,
  fixedDtSec: BUMPER_LINKS_FIXED_DT_SEC,
});
const solvedHoleOptions = Object.freeze({ resolveHole: generateSolvableBumperLinksHole });

/**
 * Metadata shared by both registrations; each mode keeps its own namespace,
 * route and seat list.
 * @param {{id:string,name:string,description:string,playerIds:readonly string[],tags:string[]}} mode
 */
function createBumperLinksGameMeta({ id, name, description, playerIds, tags }) {
  return {
    id,
    name,
    description,
    presentation: bumperLinksPresentation,
    touchControls: bumperLinksTouchControls,
    namespace: `/${id}`,
    room: { playerIds: [...playerIds] },
    networking: {
      namespace: `/${id}`,
      tickRateHz: 1 / BUMPER_LINKS_FIXED_DT_SEC,
      inputProtocol: INPUT_PROTOCOL.QUEUED,
      inputTemplate: BUMPER_LINKS_INPUT_TEMPLATE,
      numericInputs: BUMPER_LINKS_NUMERIC_INPUTS,
    },
    path: `/games/${id}`,
    engine: "webgl",
    runtime: {
      kind: "module",
      mount: "canvas",
      entryUrl: id === BUMPER_LINKS_PRACTICE_GAME_ID ? "/games/bumper-links/dist/practice.js" : "/games/bumper-links/dist/main.js",
      socketIo: true,
      kaboom: false,
    },
    tags,
    platformControlButtons: true,
  };
}

export const bumperLinksGameMeta = createBumperLinksGameMeta({
  id: BUMPER_LINKS_GAME_ID,
  name: "Bumper Links",
  description: "Battle mini-golf. Everyone putts the same hole at once, so knock rivals off line or into the water and sink first.",
  playerIds: BUMPER_LINKS_ONLINE_PLAYER_IDS,
  tags: ["Party", "2 players", "Competitive", "3D"],
});

export const bumperLinksPracticeGameMeta = createBumperLinksGameMeta({
  id: BUMPER_LINKS_PRACTICE_GAME_ID,
  name: "Bumper Links Practice",
  description: "Play six holes against three bot golfers and learn the bumps, drops and sweepers.",
  playerIds: BUMPER_LINKS_PRACTICE_PLAYER_IDS,
  tags: ["Party", "1 player", "Practice", "3D"],
});

/**
 * A fresh match with solver-checked holes and a room-specific seed.
 * @param {BumperLinksRoomOptions} roomOptions
 * @param {number} [matchId]
 * @param {number} [matchSeed]
 * @returns {BumperLinksServerState}
 */
export function createBumperLinksServerState(roomOptions, matchId = 1, matchSeed = Math.floor(Math.random() * MATCH_SEED_RANGE)) {
  const match = createBumperLinksMatch({ ...roomOptions, matchId, matchSeed, ...solvedHoleOptions });
  for (const ball of Object.values(match.players)) {
    Object.assign(ball, { input: { ...BUMPER_LINKS_INPUT_TEMPLATE }, inputEpoch: 0, inputSimulationTick: 0, lastInputSeqAck: 0 });
  }
  return /** @type {BumperLinksServerState} */ ({
    ...match,
    botBrains: match.bots.map((_bot, index) => createBumperLinksBotBrain((matchSeed + index * 131) >>> 0)),
    rematchRequests: Object.fromEntries(Object.keys(match.players).map((playerId) => [playerId, false])),
    abandonedAt: null,
    lastUpdate: Date.now(),
  });
}

/** @param {BumperLinksBall} ball */
function serializeBumperLinksBall(ball) {
  const ballSnapshot = /** @type {Record<string,unknown>} */ ({});
  for (const field of BALL_SNAPSHOT_FIELDS) ballSnapshot[field] = ball[field];
  return ballSnapshot;
}

/**
 * Snapshot for clients. The course (rebuilt from `holeSeed`), match seed,
 * bot brains, rejoin tokens and SDK queues stay on the server.
 * @param {BumperLinksServerState} state
 */
export function serializeBumperLinksState(state) {
  return {
    matchId: state.matchId,
    holeIndex: state.holeIndex,
    holes: state.holes,
    holeSeed: state.holeSeed,
    par: state.par,
    players: Object.fromEntries(Object.entries(state.players).map(([playerId, ball]) => [playerId, {
      ...serializeBumperLinksBall(ball),
      ...bumperLinksInputSession.getPlayerSnapshotMetadata(ball),
    }])),
    bots: state.bots.map(serializeBumperLinksBall),
    phase: state.phase,
    started: state.started,
    startAt: state.startAt,
    gameOver: state.gameOver,
    winner: state.winner,
    holeTimeSec: state.holeTimeSec,
    holeResetRemainingSec: state.holeResetRemainingSec,
    holeSerial: state.holeSerial,
    eventSerial: state.eventSerial,
    recentEvents: state.recentEvents.map((event) => ({ ...event })),
    inputProtocol: INPUT_PROTOCOL.QUEUED,
  };
}

/** @param {BumperLinksServerState} state */
function scheduleBumperLinksStart(state) {
  scheduleStart(state, ROOM_START_COUNTDOWN_MS, (countdownState) => {
    countdownState.phase = "countdown";
  }, Object.keys(state.players));
}

/** @param {BumperLinksServerState} state @param {string} playerId */
function connectBumperLinksPlayer(state, playerId) {
  state.players[playerId].connected = true;
  bumperLinksInputSession.resetPlayer(state.players[playerId]);
  state.abandonedAt = null;
  scheduleBumperLinksStart(state);
}

/**
 * Pause in place; strokes, points and ball positions are kept. Every
 * human's ownership resets so a held charge cannot fire after a rejoin.
 * @param {BumperLinksServerState} state
 * @param {string} playerId
 */
function disconnectBumperLinksPlayer(state, playerId) {
  state.players[playerId].connected = false;
  for (const slotId of Object.keys(state.players)) {
    bumperLinksInputSession.resetPlayer(state.players[slotId]);
    state.rematchRequests[slotId] = false;
  }
  state.started = false;
  state.startAt = null;
  if (!state.gameOver) state.phase = "paused";
  state.abandonedAt = Object.values(state.players).every((ball) => !ball.connected) ? Date.now() : null;
}

/** @param {{state:BumperLinksServerState,playerId:string,payload:unknown}} options */
function receiveBumperLinksInput({ state, playerId, payload }) {
  const ball = state.players[playerId];
  if (!ball?.connected || state.gameOver) return;
  bumperLinksInputSession.receiveInput(ball, payload);
}

/** @param {{state:BumperLinksServerState,dt:number}} context */
function stepBumperLinksPlayerInputs({ state, dt }) {
  bumperLinksInputSession.simulateRoom({
    state,
    dtSec: dt,
    simulate: (ball, input) => {
      if (!ball.connected) return;
      if (ball.atRest && !ball.sunk) ball.aimYaw = input.aimYaw;
      if (input.shoot) requestBumperLinksShot(state, ball.id, input.aimYaw, input.power);
    },
  });
}

/** @param {{state:BumperLinksServerState,dt:number}} context */
function stepBumperLinksBots({ state, dt }) {
  if (state.bots.length === 0 || !state.started || state.gameOver || state.phase !== "playing") return;
  state.bots.forEach((bot, index) => {
    const shot = decideBumperLinksBotShot(bot, state.botBrains[index], state, dt);
    if (shot) requestBumperLinksShot(state, bot.id, shot.aimYaw, shot.power);
  });
}

/**
 * Every connected human votes after a match; practice needs one vote.
 * @param {{socket:import("socket.io").Socket,games:Map<string,BumperLinksServerState>,nsp:import("socket.io").Namespace}} context
 * @param {BumperLinksRoomOptions} roomOptions
 */
function requestBumperLinksRematch({ socket, games, nsp }, roomOptions) {
  const { gameId, playerId } = socket.data;
  const state = games.get(gameId);
  if (!state || !state.gameOver || !Object.hasOwn(state.players, playerId) || !state.players[playerId].connected) return;
  state.rematchRequests[playerId] = true;
  emitEvent({ socket, gameId, type: SOCKET_EVENT.REMATCH_REQUESTED, payload: { playerId }, target: "others" });
  if (!Object.keys(state.players).every((slotId) => state.players[slotId].connected && state.rematchRequests[slotId])) return;

  const nextState = createBumperLinksServerState(roomOptions, state.matchId + 1);
  for (const slotId of Object.keys(state.players)) {
    const nextBall = nextState.players[slotId];
    nextBall.connected = state.players[slotId].connected;
    nextBall.rejoinToken = state.players[slotId].rejoinToken;
    nextBall.inputEpoch = state.players[slotId].inputEpoch;
    bumperLinksInputSession.resetPlayer(nextBall);
  }
  scheduleBumperLinksStart(nextState);
  games.set(gameId, nextState);
  emitEvent({ nsp, gameId, type: SOCKET_EVENT.REMATCH_STARTED, target: "game" });
}

/**
 * Register one Bumper Links mode with platform rooms, input ownership and
 * the fixed-cadence scheduler. Bots stay outside the human seat table.
 * @param {import("socket.io").Server} io
 * @param {ReturnType<typeof createBumperLinksGameMeta>} meta
 * @param {BumperLinksRoomOptions} roomOptions
 */
function registerBumperLinksMode(io, meta, roomOptions) {
  return registerPluggableGame({
    io,
    meta,
    createState: () => createBumperLinksServerState(roomOptions),
    onPlayerConnected: connectBumperLinksPlayer,
    handleInput: receiveBumperLinksInput,
    handleDisconnect: disconnectBumperLinksPlayer,
    handleRematch: (context) => requestBumperLinksRematch(context, roomOptions),
    beforeUpdate: scheduleBumperLinksStart,
    systems: [
      { priority: -200, system: { name: "round-lifecycle", update: ({ state, nowMs }) => {
        state.lastUpdate = nowMs;
        scheduleBumperLinksStart(state);
        if (!state.started && state.startAt !== null && nowMs >= state.startAt) {
          state.started = true;
          state.startAt = null;
          state.phase = state.holeResetRemainingSec > 0 ? "holeOver" : "playing";
        }
      } } },
      { priority: -100, system: { name: "player-input", update: stepBumperLinksPlayerInputs } },
      { priority: -50, system: { name: "bots", update: stepBumperLinksBots } },
      { priority: 0, system: { name: "shared-world", update: ({ state, dt }) => stepBumperLinksWorld(state, dt, solvedHoleOptions) } },
    ],
    shouldStep: ({ state }) => !state.gameOver,
    shouldCleanup: (state, nowMs) => state.abandonedAt !== null && nowMs - state.abandonedAt > ROOM_CLEANUP_DELAY_MS,
    serializeState: serializeBumperLinksState,
    tickMs: BUMPER_LINKS_FIXED_DT_SEC * 1000,
    dtFallback: BUMPER_LINKS_FIXED_DT_SEC,
  });
}

/** @param {import("socket.io").Server} io */
export function registerBumperLinksGame(io) {
  return registerBumperLinksMode(io, bumperLinksGameMeta, { playerIds: BUMPER_LINKS_ONLINE_PLAYER_IDS, botIds: BUMPER_LINKS_ONLINE_BOT_IDS });
}

/** @param {import("socket.io").Server} io */
export function registerBumperLinksPracticeGame(io) {
  return registerBumperLinksMode(io, bumperLinksPracticeGameMeta, { playerIds: BUMPER_LINKS_PRACTICE_PLAYER_IDS, botIds: BUMPER_LINKS_PRACTICE_BOT_IDS });
}
