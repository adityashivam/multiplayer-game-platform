import { ROOM_START_COUNTDOWN_MS } from "../../../public/platform/shared/roomLifecycle.js";
import { INPUT_PROTOCOL, SOCKET_EVENT } from "../../../public/platform/shared/networkProtocol.js";
import { lastFusePresentation, lastFuseTouchControls } from "../../../public/games/last-fuse/catalog.js";
import {
  LAST_FUSE_EDGE_KEYS,
  LAST_FUSE_FIXED_DT_SEC,
  LAST_FUSE_GAME_ID,
  LAST_FUSE_INPUT_TEMPLATE,
  LAST_FUSE_NUMERIC_INPUTS,
  LAST_FUSE_ONLINE_BOT_IDS,
  LAST_FUSE_ONLINE_PLAYER_IDS,
  LAST_FUSE_PRACTICE_BOT_IDS,
  LAST_FUSE_PRACTICE_GAME_ID,
  LAST_FUSE_PRACTICE_PLAYER_IDS,
} from "../../../public/games/last-fuse/shared/config.js";
import { createLastFuseRunner, resetLastFuseRunnerControls, stepLastFuseRunner } from "../../../public/games/last-fuse/shared/runner.js";
import {
  createLastFuseMatch,
  getLastFuseMatchPlatforms,
  listLastFuseRunners,
  stepLastFuseWorld,
} from "../../../public/games/last-fuse/shared/match.js";
import { LAST_FUSE_PRIVATE_RUNNER_FIELDS } from "../../../public/games/last-fuse/shared/prediction.js";
import { createLastFuseBotBrain, decideLastFuseBotInput } from "../../../public/games/last-fuse/shared/bot.js";
import { createAuthoritativeInputSession } from "../core/authoritativeInputSession.js";
import { emitEvent, registerPluggableGame, scheduleStart } from "../core/index.js";

/** @typedef {import("../../../public/games/last-fuse/shared/config.js").LastFuseInputState} LastFuseInputState */
/** @typedef {import("../../../public/games/last-fuse/shared/runner.js").LastFuseRunner} LastFuseRunner */
/** @typedef {import("../../../public/games/last-fuse/shared/bot.js").LastFuseBotBrain} LastFuseBotBrain */
/**
 * @typedef {LastFuseRunner & import("../core/authoritativeInputSession.js").AuthoritativePlayerInputState<keyof LastFuseInputState> & {
 *   input:LastFuseInputState,inputEpoch:number,inputSimulationTick:number,lastInputSeqAck:number,
 *   rejoinToken?:string,__controlEpoch:number
 * }} LastFuseServerRunner
 * @typedef {Omit<import("../../../public/games/last-fuse/shared/match.js").LastFuseMatch,"players"> & {
 *   players:Record<string,LastFuseServerRunner>,botBrains:LastFuseBotBrain[],
 *   rematchRequests:Record<string,boolean>,abandonedAt:number|null,lastUpdate:number
 * }} LastFuseServerState
 * @typedef {{playerIds:readonly string[],botIds:readonly string[]}} LastFuseRoomOptions
 */

const ROOM_CLEANUP_DELAY_MS = 30000;
const RUNNER_SNAPSHOT_FIELDS = Object.freeze(/** @type {(keyof LastFuseRunner)[]} */ (
  Object.keys(createLastFuseRunner("p1", 0)).filter((field) => !LAST_FUSE_PRIVATE_RUNNER_FIELDS.includes(field))
));
const lastFuseInputSession = createAuthoritativeInputSession({
  inputTemplate: LAST_FUSE_INPUT_TEMPLATE,
  numericInputs: LAST_FUSE_NUMERIC_INPUTS,
  edgeKeys: LAST_FUSE_EDGE_KEYS,
  fixedDtSec: LAST_FUSE_FIXED_DT_SEC,
});
/** Reused per tick; the scheduler never runs rooms concurrently. */
const runnerScratch = [];

/**
 * Metadata shared by both registrations; each mode keeps its own namespace,
 * route and seat list.
 * @param {{id:string,name:string,description:string,playerIds:readonly string[],tags:string[]}} mode
 */
function createLastFuseGameMeta({ id, name, description, playerIds, tags }) {
  return {
    id,
    name,
    description,
    presentation: lastFusePresentation,
    touchControls: lastFuseTouchControls,
    namespace: `/${id}`,
    room: { playerIds: [...playerIds] },
    networking: {
      namespace: `/${id}`,
      tickRateHz: 1 / LAST_FUSE_FIXED_DT_SEC,
      inputProtocol: INPUT_PROTOCOL.QUEUED,
      inputTemplate: LAST_FUSE_INPUT_TEMPLATE,
      numericInputs: LAST_FUSE_NUMERIC_INPUTS,
    },
    path: `/games/${id}`,
    engine: "webgl",
    runtime: {
      kind: "module",
      mount: "canvas",
      entryUrl: id === LAST_FUSE_PRACTICE_GAME_ID ? "/games/last-fuse/dist/practice.js" : "/games/last-fuse/dist/main.js",
      socketIo: true,
      kaboom: false,
    },
    tags,
    platformControlButtons: true,
  };
}

export const lastFuseGameMeta = createLastFuseGameMeta({
  id: LAST_FUSE_GAME_ID,
  name: "Last Fuse",
  description: "Bomb tag across night rooftops. Touch a runner to pass the lit bomb before it blows. Last runner standing wins the round.",
  playerIds: LAST_FUSE_ONLINE_PLAYER_IDS,
  tags: ["Party", "2 players", "Competitive", "3D"],
});

export const lastFusePracticeGameMeta = createLastFuseGameMeta({
  id: LAST_FUSE_PRACTICE_GAME_ID,
  name: "Last Fuse Practice",
  description: "Learn the jumps, the dash and the pass against five bot runners.",
  playerIds: LAST_FUSE_PRACTICE_PLAYER_IDS,
  tags: ["Party", "1 player", "Practice", "3D"],
});

/**
 * @param {LastFuseRoomOptions} roomOptions
 * @param {number} [matchId]
 * @returns {LastFuseServerState}
 */
export function createLastFuseServerState(roomOptions, matchId = 1) {
  const match = createLastFuseMatch({ ...roomOptions, matchId });
  for (const runner of Object.values(match.players)) {
    Object.assign(runner, { input: { ...LAST_FUSE_INPUT_TEMPLATE }, inputEpoch: 0, inputSimulationTick: 0, lastInputSeqAck: 0, __controlEpoch: 0 });
  }
  return /** @type {LastFuseServerState} */ ({
    ...match,
    botBrains: match.bots.map((_bot, index) => createLastFuseBotBrain(matchId * 131 + index)),
    rematchRequests: Object.fromEntries(Object.keys(match.players).map((playerId) => [playerId, false])),
    abandonedAt: null,
    lastUpdate: Date.now(),
  });
}

/** @param {LastFuseRunner} runner @returns {LastFuseRunner} */
function serializeLastFuseRunner(runner) {
  const runnerSnapshot = /** @type {LastFuseRunner} */ ({});
  for (const field of RUNNER_SNAPSHOT_FIELDS) runnerSnapshot[field] = runner[field];
  return runnerSnapshot;
}

/**
 * Snapshot game state for clients. The choice stream, rewind history, view
 * lag, SDK queues, rejoin tokens and bot brains stay on the server.
 * @param {LastFuseServerState} state
 */
export function serializeLastFuseState(state) {
  return {
    matchId: state.matchId,
    roundNumber: state.roundNumber,
    rounds: state.rounds,
    players: Object.fromEntries(Object.entries(state.players).map(([playerId, runner]) => [playerId, {
      ...serializeLastFuseRunner(runner),
      ...lastFuseInputSession.getPlayerSnapshotMetadata(runner),
    }])),
    bots: state.bots.map(serializeLastFuseRunner),
    city: { ...state.city },
    bomb: { ...state.bomb },
    roundTimeSec: state.roundTimeSec,
    timeSec: state.timeSec,
    started: state.started,
    startAt: state.startAt,
    gameOver: state.gameOver,
    winner: state.winner,
    phase: state.phase,
    roundWinnerId: state.roundWinnerId,
    roundSerial: state.roundSerial,
    roundResetRemainingSec: state.roundResetRemainingSec,
    fallSerial: state.fallSerial,
    lastFallId: state.lastFallId,
    inputProtocol: INPUT_PROTOCOL.QUEUED,
  };
}

/** @param {LastFuseServerState} state */
function scheduleLastFuseStart(state) {
  scheduleStart(state, ROOM_START_COUNTDOWN_MS, (countdownState) => {
    countdownState.phase = "countdown";
  }, Object.keys(state.players));
}

/** @param {LastFuseServerRunner} runner */
function resetLastFuseInputOwnership(runner) {
  lastFuseInputSession.resetPlayer(runner);
  resetLastFuseRunnerControls(runner);
  runner.__controlEpoch = runner.inputEpoch;
}

/** @param {LastFuseServerState} state @param {string} playerId */
function connectLastFusePlayer(state, playerId) {
  state.players[playerId].connected = true;
  resetLastFuseInputOwnership(state.players[playerId]);
  state.abandonedAt = null;
  scheduleLastFuseStart(state);
}

/**
 * Pause in place; points, the bomb and the fuse are kept. Every human's
 * ownership resets so held input cannot leak through a rejoin.
 * @param {LastFuseServerState} state
 * @param {string} playerId
 */
function disconnectLastFusePlayer(state, playerId) {
  state.players[playerId].connected = false;
  for (const slotId of Object.keys(state.players)) {
    resetLastFuseInputOwnership(state.players[slotId]);
    state.rematchRequests[slotId] = false;
  }
  for (const bot of state.bots) resetLastFuseRunnerControls(bot);
  state.started = false;
  state.startAt = null;
  if (!state.gameOver) state.phase = "paused";
  state.abandonedAt = Object.values(state.players).every((runner) => !runner.connected) ? Date.now() : null;
}

/** @param {{state:LastFuseServerState,playerId:string,payload:unknown}} options */
function receiveLastFuseInput({ state, playerId, payload }) {
  const runner = state.players[playerId];
  if (!runner?.connected || state.gameOver) return;
  lastFuseInputSession.receiveInput(runner, payload);
}

/** @param {{state:LastFuseServerState,dt:number}} context */
function stepLastFusePlayerInputs({ state, dt }) {
  const playing = state.started && !state.gameOver && state.phase === "playing";
  lastFuseInputSession.simulateRoom({
    state,
    dtSec: dt,
    simulate: (runner, input, fixedDtSec) => {
      if (runner.__controlEpoch !== runner.inputEpoch) {
        resetLastFuseRunnerControls(runner);
        runner.__controlEpoch = runner.inputEpoch;
      }
      runner.viewLagTicks = input.viewLagTicks;
      stepLastFuseRunner(runner, input, fixedDtSec, {
        active: playing && runner.connected,
        platforms: getLastFuseMatchPlatforms(state),
        holder: state.bomb.holderId === runner.id,
      });
    },
  });
}

/** @param {{state:LastFuseServerState,dt:number}} context */
function stepLastFuseBots({ state, dt }) {
  if (state.bots.length === 0 || !state.started || state.gameOver || state.phase !== "playing") return;
  const runners = listLastFuseRunners(state, runnerScratch);
  const platforms = getLastFuseMatchPlatforms(state);
  state.bots.forEach((bot, index) => {
    const input = decideLastFuseBotInput(bot, state.botBrains[index], state, runners, dt);
    stepLastFuseRunner(bot, input, dt, { active: true, platforms, holder: state.bomb.holderId === bot.id });
  });
}

/**
 * Every connected human votes after a match; practice needs one vote.
 * @param {{socket:import("socket.io").Socket,games:Map<string,LastFuseServerState>,nsp:import("socket.io").Namespace}} context
 * @param {LastFuseRoomOptions} roomOptions
 */
function requestLastFuseRematch({ socket, games, nsp }, roomOptions) {
  const { gameId, playerId } = socket.data;
  const state = games.get(gameId);
  if (!state || !state.gameOver || !Object.hasOwn(state.players, playerId) || !state.players[playerId].connected) return;
  state.rematchRequests[playerId] = true;
  emitEvent({ socket, gameId, type: SOCKET_EVENT.REMATCH_REQUESTED, payload: { playerId }, target: "others" });
  if (!Object.keys(state.players).every((slotId) => state.players[slotId].connected && state.rematchRequests[slotId])) return;

  const nextState = createLastFuseServerState(roomOptions, state.matchId + 1);
  for (const slotId of Object.keys(state.players)) {
    const nextRunner = nextState.players[slotId];
    nextRunner.connected = state.players[slotId].connected;
    nextRunner.rejoinToken = state.players[slotId].rejoinToken;
    nextRunner.inputEpoch = state.players[slotId].inputEpoch;
    resetLastFuseInputOwnership(nextRunner);
  }
  scheduleLastFuseStart(nextState);
  games.set(gameId, nextState);
  emitEvent({ nsp, gameId, type: SOCKET_EVENT.REMATCH_STARTED, target: "game" });
}

/**
 * Register one Last Fuse mode with platform rooms, input ownership and the
 * fixed-cadence scheduler. Bots stay outside the human seat table.
 * @param {import("socket.io").Server} io
 * @param {ReturnType<typeof createLastFuseGameMeta>} meta
 * @param {LastFuseRoomOptions} roomOptions
 */
function registerLastFuseMode(io, meta, roomOptions) {
  createLastFuseMatch(roomOptions);
  return registerPluggableGame({
    io,
    meta,
    createState: () => createLastFuseServerState(roomOptions),
    onPlayerConnected: connectLastFusePlayer,
    handleInput: receiveLastFuseInput,
    handleDisconnect: disconnectLastFusePlayer,
    handleRematch: (context) => requestLastFuseRematch(context, roomOptions),
    beforeUpdate: scheduleLastFuseStart,
    systems: [
      { priority: -200, system: { name: "round-lifecycle", update: ({ state, nowMs }) => {
        state.lastUpdate = nowMs;
        scheduleLastFuseStart(state);
        if (!state.started && state.startAt !== null && nowMs >= state.startAt) {
          state.started = true;
          state.startAt = null;
          state.phase = state.roundResetRemainingSec > 0 ? "roundOver" : "playing";
        }
      } } },
      { priority: -100, system: { name: "player-input", update: stepLastFusePlayerInputs } },
      { priority: -50, system: { name: "bots", update: stepLastFuseBots } },
      { priority: 0, system: { name: "shared-world", update: ({ state, dt }) => stepLastFuseWorld(state, dt) } },
    ],
    shouldStep: ({ state }) => !state.gameOver,
    shouldCleanup: (state, nowMs) => state.abandonedAt !== null && nowMs - state.abandonedAt > ROOM_CLEANUP_DELAY_MS,
    serializeState: serializeLastFuseState,
    tickMs: LAST_FUSE_FIXED_DT_SEC * 1000,
    dtFallback: LAST_FUSE_FIXED_DT_SEC,
  });
}

/** @param {import("socket.io").Server} io */
export function registerLastFuseGame(io) {
  return registerLastFuseMode(io, lastFuseGameMeta, { playerIds: LAST_FUSE_ONLINE_PLAYER_IDS, botIds: LAST_FUSE_ONLINE_BOT_IDS });
}

/** @param {import("socket.io").Server} io */
export function registerLastFusePracticeGame(io) {
  return registerLastFuseMode(io, lastFusePracticeGameMeta, { playerIds: LAST_FUSE_PRACTICE_PLAYER_IDS, botIds: LAST_FUSE_PRACTICE_BOT_IDS });
}
