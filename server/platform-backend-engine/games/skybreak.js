import { ROOM_START_COUNTDOWN_MS } from "../../../public/platform/shared/roomLifecycle.js";
import { INPUT_PROTOCOL, SOCKET_EVENT } from "../../../public/platform/shared/networkProtocol.js";
import { skybreakPresentation, skybreakTouchControls } from "../../../public/games/skybreak/catalog.js";
import {
  SKYBREAK_DOGFIGHT_BOT_IDS,
  SKYBREAK_DOGFIGHT_PLAYER_IDS,
  SKYBREAK_EDGE_KEYS,
  SKYBREAK_FIXED_DT_SEC,
  SKYBREAK_GAME_ID,
  SKYBREAK_INPUT_TEMPLATE,
  SKYBREAK_NUMERIC_INPUTS,
  SKYBREAK_PRACTICE_BOT_IDS,
  SKYBREAK_PRACTICE_GAME_ID,
  SKYBREAK_PRACTICE_PLAYER_IDS,
  SKYBREAK_TIME_TRIAL_GAME_ID,
  SKYBREAK_TIME_TRIAL_PLAYER_IDS,
} from "../../../public/games/skybreak/shared/config.js";
import { createSkybreakJet, stepSkybreakFlight } from "../../../public/games/skybreak/shared/flight.js";
import { stepSkybreakWeapons } from "../../../public/games/skybreak/shared/combat.js";
import {
  applySkybreakRestartInput,
  createSkybreakMatch,
  listSkybreakJets,
  startSkybreakMatch,
  stepSkybreakWorld,
} from "../../../public/games/skybreak/shared/match.js";
import { createSkybreakBotBrain, decideSkybreakBotInput } from "../../../public/games/skybreak/shared/bot.js";
import { SKYBREAK_PRIVATE_JET_FIELDS } from "../../../public/games/skybreak/shared/prediction.js";
import { createAuthoritativeInputSession } from "../core/authoritativeInputSession.js";
import { emitEvent, registerPluggableGame, scheduleStart } from "../core/index.js";

/** @typedef {import("../../../public/games/skybreak/shared/config.js").SkybreakInputState} SkybreakInputState */
/** @typedef {import("../../../public/games/skybreak/shared/config.js").SkybreakMode} SkybreakMode */
/** @typedef {import("../../../public/games/skybreak/shared/flight.js").SkybreakJet} SkybreakJet */
/** @typedef {import("../../../public/games/skybreak/shared/bot.js").SkybreakBotBrain} SkybreakBotBrain */
/**
 * @typedef {SkybreakJet & import("../core/authoritativeInputSession.js").AuthoritativePlayerInputState<keyof SkybreakInputState> & {
 *   input:SkybreakInputState,inputEpoch:number,inputSimulationTick:number,lastInputSeqAck:number,
 *   rejoinToken?:string,__controlEpoch:number
 * }} SkybreakServerJet
 * @typedef {Omit<import("../../../public/games/skybreak/shared/match.js").SkybreakMatch,"players"> & {
 *   players:Record<string,SkybreakServerJet>,botBrains:SkybreakBotBrain[],
 *   rematchRequests:Record<string,boolean>,abandonedAt:number|null,lastUpdate:number
 * }} SkybreakServerState
 * @typedef {{mode:SkybreakMode,playerIds:readonly string[],botIds:readonly string[]}} SkybreakRoomOptions
 */

const ROOM_CLEANUP_DELAY_MS = 30000;
const JET_SNAPSHOT_FIELDS = Object.freeze(/** @type {(keyof SkybreakJet)[]} */ (
  Object.keys(createSkybreakJet("p1", 0)).filter((field) => !SKYBREAK_PRIVATE_JET_FIELDS.includes(field))
));
const skybreakInputSession = createAuthoritativeInputSession({
  inputTemplate: SKYBREAK_INPUT_TEMPLATE,
  numericInputs: SKYBREAK_NUMERIC_INPUTS,
  edgeKeys: SKYBREAK_EDGE_KEYS,
  fixedDtSec: SKYBREAK_FIXED_DT_SEC,
});
/** Reused per tick; the scheduler never runs rooms concurrently. */
const jetScratch = [];

/**
 * Metadata shared by every registration; each mode keeps its own namespace,
 * route and seats.
 * @param {{id:string,name:string,description:string,playerIds:readonly string[],tags:string[]}} mode
 */
function createSkybreakGameMeta({ id, name, description, playerIds, tags }) {
  const entryFile = id === SKYBREAK_PRACTICE_GAME_ID ? "practice" : id === SKYBREAK_TIME_TRIAL_GAME_ID ? "time-trial" : "main";
  return {
    id,
    name,
    description,
    presentation: skybreakPresentation,
    touchControls: skybreakTouchControls,
    namespace: `/${id}`,
    room: { playerIds: [...playerIds] },
    networking: {
      namespace: `/${id}`,
      tickRateHz: 1 / SKYBREAK_FIXED_DT_SEC,
      inputProtocol: INPUT_PROTOCOL.QUEUED,
      inputTemplate: SKYBREAK_INPUT_TEMPLATE,
      numericInputs: SKYBREAK_NUMERIC_INPUTS,
    },
    path: `/games/${id}`,
    engine: "webgl",
    runtime: { kind: "module", mount: "canvas", entryUrl: `/games/skybreak/dist/${entryFile}.js`, socketIo: true, kaboom: false },
    tags,
    platformControlButtons: true,
  };
}

/** Online dogfight: two human seats and four bots, first to ten kills. */
export const skybreakGameMeta = createSkybreakGameMeta({
  id: SKYBREAK_GAME_ID,
  name: "Skybreak",
  description: "Jet dogfights over a sunset canyon. Manage your speed, lead your shots, break missile locks with flares. First to ten kills.",
  playerIds: SKYBREAK_DOGFIGHT_PLAYER_IDS,
  tags: ["Action", "2 players", "Competitive", "3D"],
});

/** Solo dogfight practice against five bots. */
export const skybreakPracticeGameMeta = createSkybreakGameMeta({
  id: SKYBREAK_PRACTICE_GAME_ID,
  name: "Skybreak Practice",
  description: "Learn energy fighting, gun leads and flare timing against five bot pilots.",
  playerIds: SKYBREAK_PRACTICE_PLAYER_IDS,
  tags: ["Action", "1 player", "Practice", "3D"],
});

/** Solo time trial through the canyon gates. */
export const skybreakTimeTrialGameMeta = createSkybreakGameMeta({
  id: SKYBREAK_TIME_TRIAL_GAME_ID,
  name: "Skybreak Time Trial",
  description: "Thread twelve gates through the canyon and over the ridges. Chase your ghost and earn platinum.",
  playerIds: SKYBREAK_TIME_TRIAL_PLAYER_IDS,
  tags: ["Racing", "1 player", "Time trial", "3D"],
});

/** @param {SkybreakRoomOptions} roomOptions @param {number} [matchId] @returns {SkybreakServerState} */
export function createSkybreakServerState(roomOptions, matchId = 1) {
  const match = createSkybreakMatch(roomOptions);
  match.matchId = matchId;
  for (const jet of Object.values(match.players)) {
    Object.assign(jet, { input: { ...SKYBREAK_INPUT_TEMPLATE }, inputEpoch: 0, inputSimulationTick: 0, lastInputSeqAck: 0, __controlEpoch: 0 });
  }
  return /** @type {SkybreakServerState} */ ({
    ...match,
    botBrains: match.bots.map((_bot, index) => createSkybreakBotBrain(matchId * 173 + index)),
    rematchRequests: Object.fromEntries(Object.keys(match.players).map((playerId) => [playerId, false])),
    abandonedAt: null,
    lastUpdate: Date.now(),
  });
}

/** @param {SkybreakJet} jet @returns {SkybreakJet} */
function serializeSkybreakJet(jet) {
  const jetSnapshot = /** @type {SkybreakJet} */ ({});
  for (const field of JET_SNAPSHOT_FIELDS) jetSnapshot[field] = jet[field];
  return jetSnapshot;
}

/**
 * Snapshot game state for clients. Rounds, flare decoys and the rewind
 * history stay on the server; clients draw tracers and flares from jet state.
 * @param {SkybreakServerState} state
 */
export function serializeSkybreakState(state) {
  return {
    matchId: state.matchId,
    mode: state.mode,
    players: Object.fromEntries(Object.entries(state.players).map(([playerId, jet]) => [playerId, {
      ...serializeSkybreakJet(jet),
      ...skybreakInputSession.getPlayerSnapshotMetadata(jet),
    }])),
    bots: state.bots.map(serializeSkybreakJet),
    missiles: state.missiles.map((missile) => ({ ...missile })),
    killFeed: state.killFeed.map((kill) => ({ ...kill })),
    killSerial: state.killSerial,
    phase: state.phase,
    started: state.started,
    startAt: state.startAt,
    gameOver: state.gameOver,
    winner: state.winner,
    timeSec: state.timeSec,
    matchTimeSec: state.matchTimeSec,
    durationSec: state.durationSec,
    killsToWin: state.killsToWin,
    inputProtocol: INPUT_PROTOCOL.QUEUED,
  };
}

/** @param {SkybreakServerState} state */
function scheduleSkybreakStart(state) {
  scheduleStart(state, ROOM_START_COUNTDOWN_MS, (countdownState) => {
    countdownState.phase = "countdown";
  }, Object.keys(state.players));
}

/** @param {SkybreakServerJet} jet */
function resetSkybreakInputOwnership(jet) {
  skybreakInputSession.resetPlayer(jet);
  jet.missileHeld = false;
  jet.flareHeld = false;
  jet.restartHeld = false;
  jet.cannonFiring = false;
  jet.__controlEpoch = jet.inputEpoch;
}

/** @param {SkybreakServerState} state @param {string} playerId */
function connectSkybreakPlayer(state, playerId) {
  state.players[playerId].connected = true;
  resetSkybreakInputOwnership(state.players[playerId]);
  state.abandonedAt = null;
  scheduleSkybreakStart(state);
}

/**
 * Pause in place; scores and positions are kept. Every human's ownership
 * resets so held triggers cannot leak through a rejoin.
 * @param {SkybreakServerState} state
 * @param {string} playerId
 */
function disconnectSkybreakPlayer(state, playerId) {
  state.players[playerId].connected = false;
  for (const slotId of Object.keys(state.players)) {
    resetSkybreakInputOwnership(state.players[slotId]);
    state.rematchRequests[slotId] = false;
  }
  state.started = false;
  state.startAt = null;
  if (!state.gameOver) state.phase = "paused";
  state.abandonedAt = Object.values(state.players).every((jet) => !jet.connected) ? Date.now() : null;
}

/** @param {{state:SkybreakServerState,playerId:string,payload:unknown}} options */
function receiveSkybreakInput({ state, playerId, payload }) {
  const jet = state.players[playerId];
  if (!jet?.connected || state.gameOver) return;
  skybreakInputSession.receiveInput(jet, payload);
}

/** @param {{state:SkybreakServerState,dt:number}} context */
function stepSkybreakPlayerInputs({ state, dt }) {
  const playing = state.started && !state.gameOver && state.phase === "playing";
  const jets = listSkybreakJets(state, jetScratch);
  const dogfight = state.mode === "dogfight";
  skybreakInputSession.simulateRoom({
    state,
    dtSec: dt,
    simulate: (jet, input, fixedDtSec) => {
      if (jet.__controlEpoch !== jet.inputEpoch) {
        resetSkybreakInputOwnership(jet);
        jet.__controlEpoch = jet.inputEpoch;
      }
      const active = playing && jet.connected;
      if (!active) return;
      applySkybreakRestartInput(state, jet, input);
      stepSkybreakFlight(jet, input, fixedDtSec, { active, boundary: dogfight });
      if (dogfight) stepSkybreakWeapons(jet, input, fixedDtSec, state, jets);
    },
  });
}

/** @param {{state:SkybreakServerState,dt:number}} context */
function stepSkybreakBots({ state, dt }) {
  if (state.bots.length === 0 || !state.started || state.gameOver || state.phase !== "playing") return;
  const jets = listSkybreakJets(state, jetScratch);
  state.bots.forEach((bot, index) => {
    const input = decideSkybreakBotInput(bot, state.botBrains[index], state, jets, dt);
    stepSkybreakFlight(bot, input, dt, { active: true, boundary: true });
    stepSkybreakWeapons(bot, input, dt, state, jets);
  });
}

/**
 * Every connected human votes after a dogfight; practice needs one vote.
 * Time trials never end, so they need no rematch.
 * @param {{socket:import("socket.io").Socket,games:Map<string,SkybreakServerState>,nsp:import("socket.io").Namespace}} context
 * @param {SkybreakRoomOptions} roomOptions
 */
function requestSkybreakRematch({ socket, games, nsp }, roomOptions) {
  const { gameId, playerId } = socket.data;
  const state = games.get(gameId);
  if (!state || !state.gameOver || !Object.hasOwn(state.players, playerId) || !state.players[playerId].connected) return;
  state.rematchRequests[playerId] = true;
  emitEvent({ socket, gameId, type: SOCKET_EVENT.REMATCH_REQUESTED, payload: { playerId }, target: "others" });
  if (!Object.keys(state.players).every((slotId) => state.players[slotId].connected && state.rematchRequests[slotId])) return;
  const nextState = createSkybreakServerState(roomOptions, state.matchId + 1);
  for (const slotId of Object.keys(state.players)) {
    const nextJet = nextState.players[slotId];
    nextJet.connected = state.players[slotId].connected;
    nextJet.rejoinToken = state.players[slotId].rejoinToken;
    nextJet.inputEpoch = state.players[slotId].inputEpoch;
    resetSkybreakInputOwnership(nextJet);
  }
  scheduleSkybreakStart(nextState);
  games.set(gameId, nextState);
  emitEvent({ nsp, gameId, type: SOCKET_EVENT.REMATCH_STARTED, target: "game" });
}

/**
 * Register one Skybreak mode with platform rooms, input ownership and the
 * fixed-cadence scheduler. Bots stay outside the human seat table.
 * @param {import("socket.io").Server} io
 * @param {ReturnType<typeof createSkybreakGameMeta>} meta
 * @param {SkybreakRoomOptions} roomOptions
 */
function registerSkybreakMode(io, meta, roomOptions) {
  createSkybreakMatch(roomOptions);
  return registerPluggableGame({
    io,
    meta,
    createState: () => createSkybreakServerState(roomOptions),
    onPlayerConnected: connectSkybreakPlayer,
    handleInput: receiveSkybreakInput,
    handleDisconnect: disconnectSkybreakPlayer,
    handleRematch: (context) => requestSkybreakRematch(context, roomOptions),
    beforeUpdate: scheduleSkybreakStart,
    systems: [
      { priority: -200, system: { name: "match-lifecycle", update: ({ state, nowMs }) => {
        state.lastUpdate = nowMs;
        scheduleSkybreakStart(state);
        if (!state.started && state.startAt !== null && nowMs >= state.startAt) {
          state.started = true;
          state.startAt = null;
          state.phase = "playing";
          startSkybreakMatch(state);
        }
      } } },
      { priority: -100, system: { name: "player-input", update: stepSkybreakPlayerInputs } },
      { priority: -50, system: { name: "bots", update: stepSkybreakBots } },
      { priority: 0, system: { name: "world", update: ({ state, dt }) => stepSkybreakWorld(state, dt) } },
    ],
    shouldStep: ({ state }) => !state.gameOver,
    shouldCleanup: (state, nowMs) => state.abandonedAt !== null && nowMs - state.abandonedAt > ROOM_CLEANUP_DELAY_MS,
    serializeState: serializeSkybreakState,
    tickMs: SKYBREAK_FIXED_DT_SEC * 1000,
    dtFallback: SKYBREAK_FIXED_DT_SEC,
  });
}

/** @param {import("socket.io").Server} io */
export function registerSkybreakGame(io) {
  return registerSkybreakMode(io, skybreakGameMeta, { mode: "dogfight", playerIds: SKYBREAK_DOGFIGHT_PLAYER_IDS, botIds: SKYBREAK_DOGFIGHT_BOT_IDS });
}

/** @param {import("socket.io").Server} io */
export function registerSkybreakPracticeGame(io) {
  return registerSkybreakMode(io, skybreakPracticeGameMeta, { mode: "dogfight", playerIds: SKYBREAK_PRACTICE_PLAYER_IDS, botIds: SKYBREAK_PRACTICE_BOT_IDS });
}

/** @param {import("socket.io").Server} io */
export function registerSkybreakTimeTrialGame(io) {
  return registerSkybreakMode(io, skybreakTimeTrialGameMeta, { mode: "timeTrial", playerIds: SKYBREAK_TIME_TRIAL_PLAYER_IDS, botIds: [] });
}
