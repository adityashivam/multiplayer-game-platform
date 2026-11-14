import { ROOM_START_COUNTDOWN_MS } from "../../../public/platform/shared/roomLifecycle.js";
import { INPUT_PROTOCOL, SOCKET_EVENT } from "../../../public/platform/shared/networkProtocol.js";
import { driftlinePresentation, driftlineTouchControls } from "../../../public/games/driftline/catalog.js";
import {
  DRIFTLINE_EDGE_KEYS,
  DRIFTLINE_FIXED_DT_SEC,
  DRIFTLINE_GAME_ID,
  DRIFTLINE_INPUT_TEMPLATE,
  DRIFTLINE_NUMERIC_INPUTS,
  DRIFTLINE_PRACTICE_BOT_IDS,
  DRIFTLINE_PRACTICE_GAME_ID,
  DRIFTLINE_PRACTICE_PLAYER_IDS,
  DRIFTLINE_RACE_BOT_IDS,
  DRIFTLINE_RACE_PLAYER_IDS,
} from "../../../public/games/driftline/shared/config.js";
import {
  createDriftlineRace,
  recordDriftlineLaunchInput,
  startDriftlineRace,
  stepDriftlineRace,
} from "../../../public/games/driftline/shared/race.js";
import { createDriftlineCar, resetDriftlineCarControls, stepDriftlineCar } from "../../../public/games/driftline/shared/vehicle.js";
import { createDriftlineBotBrain, decideDriftlineBotInput, decideDriftlineBotLaunchThrottle } from "../../../public/games/driftline/shared/bot.js";
import { getDriftlineTrack } from "../../../public/games/driftline/shared/tracks/index.js";
import { createAuthoritativeInputSession } from "../core/authoritativeInputSession.js";
import { emitEvent, registerPluggableGame, scheduleStart } from "../core/index.js";

/** @typedef {import("../../../public/games/driftline/shared/config.js").DriftlineInputState} DriftlineInputState */
/** @typedef {import("../../../public/games/driftline/shared/vehicle.js").DriftlineCar} DriftlineCar */
/** @typedef {import("../../../public/games/driftline/shared/bot.js").DriftlineBotBrain} DriftlineBotBrain */
/**
 * @typedef {DriftlineCar & import("../core/authoritativeInputSession.js").AuthoritativePlayerInputState<keyof DriftlineInputState> & {
 *   input:DriftlineInputState,inputEpoch:number,inputSimulationTick:number,lastInputSeqAck:number,
 *   rejoinToken?:string,__controlEpoch:number
 * }} DriftlineServerCar
 * @typedef {Omit<import("../../../public/games/driftline/shared/race.js").DriftlineRace,"players"> & {
 *   players:Record<string,DriftlineServerCar>,botBrains:DriftlineBotBrain[],
 *   rematchRequests:Record<string,boolean>,abandonedAt:number|null,lastUpdate:number
 * }} DriftlineServerState
 * @typedef {{playerIds:readonly string[],botIds:readonly string[]}} DriftlineRoomOptions
 */

const ROOM_CLEANUP_DELAY_MS = 30000;
const FIXED_STEP_MS = DRIFTLINE_FIXED_DT_SEC * 1000;
const CAR_SNAPSHOT_FIELDS = Object.freeze(/** @type {(keyof DriftlineCar)[]} */ (
  Object.keys(createDriftlineCar(getDriftlineTrack("sunset-cliffs"), "p1", 0))
));
const driftlineInputSession = createAuthoritativeInputSession({
  inputTemplate: DRIFTLINE_INPUT_TEMPLATE,
  numericInputs: DRIFTLINE_NUMERIC_INPUTS,
  edgeKeys: DRIFTLINE_EDGE_KEYS,
  fixedDtSec: DRIFTLINE_FIXED_DT_SEC,
});

/**
 * Metadata shared by both registrations; each keeps its own namespace, route
 * and seat list so rooms, links and lifecycle never mix.
 * @param {{id:string,name:string,description:string,playerIds:readonly string[],tags:string[]}} mode
 */
function createDriftlineGameMeta({ id, name, description, playerIds, tags }) {
  return {
    id,
    name,
    description,
    presentation: driftlinePresentation,
    touchControls: driftlineTouchControls,
    namespace: `/${id}`,
    room: { playerIds: [...playerIds] },
    networking: {
      namespace: `/${id}`,
      tickRateHz: 1 / DRIFTLINE_FIXED_DT_SEC,
      inputProtocol: INPUT_PROTOCOL.QUEUED,
      inputTemplate: DRIFTLINE_INPUT_TEMPLATE,
      numericInputs: DRIFTLINE_NUMERIC_INPUTS,
    },
    path: `/games/${id}`,
    engine: "webgl",
    runtime: {
      kind: "module",
      mount: "canvas",
      entryUrl: id === DRIFTLINE_PRACTICE_GAME_ID ? "/games/driftline/dist/practice.js" : "/games/driftline/dist/main.js",
      socketIo: true,
      kaboom: false,
    },
    tags,
    platformControlButtons: true,
  };
}

/** Online race: two human seats, four bots, three laps. */
export const driftlineGameMeta = createDriftlineGameMeta({
  id: DRIFTLINE_GAME_ID,
  name: "Driftline",
  description: "Drift to charge your boost, draft your rivals and hold the cleanest line around Sunset Cliffs. Three laps, six cars.",
  playerIds: DRIFTLINE_RACE_PLAYER_IDS,
  tags: ["Racing", "2 players", "Competitive", "3D"],
});

/** Solo practice: one human seat against five bots on the same rules. */
export const driftlinePracticeGameMeta = createDriftlineGameMeta({
  id: DRIFTLINE_PRACTICE_GAME_ID,
  name: "Driftline Practice",
  description: "Learn the handbrake flick, the boost tiers and the perfect start against five bots before you race a friend.",
  playerIds: DRIFTLINE_PRACTICE_PLAYER_IDS,
  tags: ["Racing", "1 player", "Practice", "3D"],
});

/**
 * @param {DriftlineServerState} state
 * @param {number} matchId
 */
function createDriftlineBotBrains(state, matchId) {
  return state.bots.map((_bot, index) => createDriftlineBotBrain(matchId * 131 + index));
}

/** @param {DriftlineRoomOptions} roomOptions @returns {DriftlineServerState} */
export function createDriftlineServerState(roomOptions) {
  const race = createDriftlineRace(roomOptions);
  for (const car of Object.values(race.players)) {
    Object.assign(car, {
      input: { ...DRIFTLINE_INPUT_TEMPLATE },
      inputEpoch: 0,
      inputSimulationTick: 0,
      lastInputSeqAck: 0,
      __controlEpoch: 0,
    });
  }
  const state = /** @type {DriftlineServerState} */ ({
    ...race,
    botBrains: [],
    rematchRequests: Object.fromEntries(Object.keys(race.players).map((playerId) => [playerId, false])),
    abandonedAt: null,
    lastUpdate: Date.now(),
  });
  state.botBrains = createDriftlineBotBrains(state, state.matchId);
  return state;
}

/** @param {DriftlineCar} car @returns {DriftlineCar} */
function serializeDriftlineCar(car) {
  const carSnapshot = /** @type {DriftlineCar} */ ({});
  for (const field of CAR_SNAPSHOT_FIELDS) carSnapshot[field] = car[field];
  return carSnapshot;
}

/**
 * Copy every declared game leaf from the first snapshot onward. SDK queues,
 * held input, rejoin tokens and bot brains remain private to the server.
 * @param {DriftlineServerState} state
 * @returns {object}
 */
export function serializeDriftlineState(state) {
  return {
    matchId: state.matchId,
    trackId: state.trackId,
    players: Object.fromEntries(Object.entries(state.players).map(([playerId, car]) => [playerId, {
      ...serializeDriftlineCar(car),
      ...driftlineInputSession.getPlayerSnapshotMetadata(car),
    }])),
    bots: state.bots.map(serializeDriftlineCar),
    laps: state.laps,
    raceTimeSec: state.raceTimeSec,
    timeSec: state.timeSec,
    started: state.started,
    startAt: state.startAt,
    launchResolved: state.launchResolved,
    gameOver: state.gameOver,
    winner: state.winner,
    phase: state.phase,
    finishOrder: [...state.finishOrder],
    firstFinishSec: state.firstFinishSec,
    contactSerial: state.contactSerial,
    inputProtocol: INPUT_PROTOCOL.QUEUED,
  };
}

/** @param {DriftlineServerState} state */
function scheduleDriftlineStart(state) {
  scheduleStart(state, ROOM_START_COUNTDOWN_MS, (countdownState) => {
    countdownState.phase = "countdown";
  }, Object.keys(state.players));
}

/** @param {DriftlineServerCar} car */
function resetDriftlineInputOwnership(car) {
  driftlineInputSession.resetPlayer(car);
  resetDriftlineCarControls(car);
  car.__controlEpoch = car.inputEpoch;
}

/** @param {DriftlineServerState} state @param {string} playerId */
function connectDriftlinePlayer(state, playerId) {
  state.players[playerId].connected = true;
  resetDriftlineInputOwnership(state.players[playerId]);
  state.abandonedAt = null;
  scheduleDriftlineStart(state);
}

/**
 * Pause the race in place: positions, laps and speeds are kept. Every human's
 * ownership resets so old held or queued input cannot leak through a rejoin.
 * @param {DriftlineServerState} state
 * @param {string} playerId
 */
function disconnectDriftlinePlayer(state, playerId) {
  state.players[playerId].connected = false;
  for (const slotId of Object.keys(state.players)) {
    resetDriftlineInputOwnership(state.players[slotId]);
    state.rematchRequests[slotId] = false;
  }
  for (const bot of state.bots) resetDriftlineCarControls(bot);
  state.started = false;
  state.startAt = null;
  if (!state.gameOver) state.phase = "paused";
  state.abandonedAt = Object.values(state.players).every((car) => !car.connected) ? Date.now() : null;
}

/** @param {{state:DriftlineServerState,playerId:string,payload:unknown}} options */
function receiveDriftlineInput({ state, playerId, payload }) {
  const car = state.players[playerId];
  if (!car?.connected || state.gameOver) return;
  driftlineInputSession.receiveInput(car, payload);
}

/**
 * Before the start, queued throttle only feeds the launch; afterwards the
 * shared car rules drive. Both run at the fixed simulation cadence.
 * @param {{state:DriftlineServerState,dt:number}} context
 */
function stepDriftlinePlayerInputs({ state, dt }) {
  const track = getDriftlineTrack(state.trackId);
  const racing = state.started && !state.gameOver && state.phase === "racing";
  const countingDown = !state.started && state.startAt !== null && !state.launchResolved;
  driftlineInputSession.simulateRoom({
    state,
    dtSec: dt,
    simulate: (car, input, fixedDtSec) => {
      if (car.__controlEpoch !== car.inputEpoch) {
        resetDriftlineCarControls(car);
        car.__controlEpoch = car.inputEpoch;
      }
      if (countingDown) recordDriftlineLaunchInput(car, input.throttle);
      stepDriftlineCar(car, input, fixedDtSec, { track, active: racing && car.connected });
    },
  });
}

/**
 * Bots rev during the countdown and drive once racing, through the same
 * shared car rules as humans.
 * @param {{state:DriftlineServerState,dt:number,nowMs:number}} context
 */
function stepDriftlineBots({ state, dt, nowMs }) {
  if (state.bots.length === 0 || state.gameOver) return;
  if (!state.started) {
    if (state.startAt === null || state.launchResolved) return;
    const ticksUntilStart = Math.max(0, Math.round((state.startAt - nowMs) / FIXED_STEP_MS));
    state.bots.forEach((bot, index) => recordDriftlineLaunchInput(bot, decideDriftlineBotLaunchThrottle(state.botBrains[index], ticksUntilStart)));
    return;
  }
  if (state.phase !== "racing") return;
  const track = getDriftlineTrack(state.trackId);
  state.bots.forEach((bot, index) => {
    const input = decideDriftlineBotInput(bot, state.botBrains[index], track, dt);
    stepDriftlineCar(bot, input, dt, { track, active: true });
  });
}

/**
 * Every connected human votes after the race; practice needs one vote. Seat
 * ownership carries into a fresh grid.
 * @param {{socket:import("socket.io").Socket,games:Map<string,DriftlineServerState>,nsp:import("socket.io").Namespace}} context
 * @param {DriftlineRoomOptions} roomOptions
 */
function requestDriftlineRematch({ socket, games, nsp }, roomOptions) {
  const { gameId, playerId } = socket.data;
  const state = games.get(gameId);
  if (!state || !state.gameOver || !Object.hasOwn(state.players, playerId) || !state.players[playerId].connected) return;
  state.rematchRequests[playerId] = true;
  emitEvent({ socket, gameId, type: SOCKET_EVENT.REMATCH_REQUESTED, payload: { playerId }, target: "others" });
  if (!Object.keys(state.players).every((slotId) => state.players[slotId].connected && state.rematchRequests[slotId])) return;

  const nextState = createDriftlineServerState(roomOptions);
  nextState.matchId = state.matchId + 1;
  nextState.botBrains = createDriftlineBotBrains(nextState, nextState.matchId);
  for (const slotId of Object.keys(state.players)) {
    const nextCar = nextState.players[slotId];
    nextCar.connected = state.players[slotId].connected;
    nextCar.rejoinToken = state.players[slotId].rejoinToken;
    nextCar.inputEpoch = state.players[slotId].inputEpoch;
    resetDriftlineInputOwnership(nextCar);
  }
  scheduleDriftlineStart(nextState);
  games.set(gameId, nextState);
  emitEvent({ nsp, gameId, type: SOCKET_EVENT.REMATCH_STARTED, target: "game" });
}

/**
 * Register one Driftline mode with platform rooms, input ownership and the
 * fixed-cadence scheduler. Bots stay outside the human seat table.
 * @param {import("socket.io").Server} io
 * @param {ReturnType<typeof createDriftlineGameMeta>} meta
 * @param {DriftlineRoomOptions} roomOptions
 */
function registerDriftlineMode(io, meta, roomOptions) {
  createDriftlineRace(roomOptions);
  return registerPluggableGame({
    io,
    meta,
    createState: () => createDriftlineServerState(roomOptions),
    onPlayerConnected: connectDriftlinePlayer,
    handleInput: receiveDriftlineInput,
    handleDisconnect: disconnectDriftlinePlayer,
    handleRematch: (context) => requestDriftlineRematch(context, roomOptions),
    beforeUpdate: scheduleDriftlineStart,
    systems: [
      { priority: -200, system: { name: "race-lifecycle", update: ({ state, nowMs }) => {
        state.lastUpdate = nowMs;
        scheduleDriftlineStart(state);
        if (!state.started && state.startAt !== null && nowMs >= state.startAt) {
          state.started = true;
          state.startAt = null;
          state.phase = "racing";
          startDriftlineRace(state);
        }
      } } },
      { priority: -100, system: { name: "player-input", update: stepDriftlinePlayerInputs } },
      { priority: -50, system: { name: "bots", update: stepDriftlineBots } },
      { priority: 0, system: { name: "race-world", update: ({ state, dt }) => stepDriftlineRace(state, dt) } },
    ],
    shouldStep: ({ state }) => !state.gameOver,
    shouldCleanup: (state, nowMs) => state.abandonedAt !== null && nowMs - state.abandonedAt > ROOM_CLEANUP_DELAY_MS,
    serializeState: serializeDriftlineState,
    tickMs: FIXED_STEP_MS,
    dtFallback: DRIFTLINE_FIXED_DT_SEC,
  });
}

/** @param {import("socket.io").Server} io */
export function registerDriftlineGame(io) {
  return registerDriftlineMode(io, driftlineGameMeta, { playerIds: DRIFTLINE_RACE_PLAYER_IDS, botIds: DRIFTLINE_RACE_BOT_IDS });
}

/** @param {import("socket.io").Server} io */
export function registerDriftlinePracticeGame(io) {
  return registerDriftlineMode(io, driftlinePracticeGameMeta, { playerIds: DRIFTLINE_PRACTICE_PLAYER_IDS, botIds: DRIFTLINE_PRACTICE_BOT_IDS });
}
