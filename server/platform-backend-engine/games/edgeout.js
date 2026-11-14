import { ROOM_START_COUNTDOWN_MS } from "../../../public/platform/shared/roomLifecycle.js";
import { INPUT_PROTOCOL, SOCKET_EVENT } from "../../../public/platform/shared/networkProtocol.js";
import { edgeoutPresentation, edgeoutTouchControls } from "../../../public/games/edgeout/catalog.js";
import {
  EDGEOUT_DUEL_PLAYER_IDS,
  EDGEOUT_EDGE_KEYS,
  EDGEOUT_FIXED_DT_SEC,
  EDGEOUT_GAME_ID,
  EDGEOUT_INPUT_TEMPLATE,
  EDGEOUT_NUMERIC_INPUTS,
  EDGEOUT_PRACTICE_BOT_IDS,
  EDGEOUT_PRACTICE_GAME_ID,
  EDGEOUT_PRACTICE_PLAYER_IDS,
} from "../../../public/games/edgeout/shared/config.js";
import {
  createEdgeoutFighter,
  createEdgeoutMatch,
  listEdgeoutFighters,
  resetEdgeoutFighterControls,
  stepEdgeoutFighter,
  stepEdgeoutWorld,
} from "../../../public/games/edgeout/shared/simulation.js";
import { createEdgeoutBotBrain, decideEdgeoutBotInput } from "../../../public/games/edgeout/shared/bot.js";
import { createAuthoritativeInputSession } from "../core/authoritativeInputSession.js";
import { emitEvent, registerPluggableGame, scheduleStart } from "../core/index.js";

/** @typedef {import("../../../public/games/edgeout/shared/config.js").EdgeoutInputState} EdgeoutInputState */
/** @typedef {import("../../../public/games/edgeout/shared/simulation.js").EdgeoutFighter} EdgeoutFighter */
/** @typedef {import("../../../public/games/edgeout/shared/bot.js").EdgeoutBotBrain} EdgeoutBotBrain */
/**
 * @typedef {EdgeoutFighter & import("../core/authoritativeInputSession.js").AuthoritativePlayerInputState<keyof EdgeoutInputState> & {
 *   input:EdgeoutInputState,inputEpoch:number,inputSimulationTick:number,lastInputSeqAck:number,
 *   rejoinToken?:string,__controlEpoch:number
 * }} EdgeoutServerFighter
 * @typedef {Omit<import("../../../public/games/edgeout/shared/simulation.js").EdgeoutMatch,"players"> & {
 *   players:Record<string,EdgeoutServerFighter>,botBrains:EdgeoutBotBrain[],
 *   rematchRequests:Record<string,boolean>,abandonedAt:number|null,lastUpdate:number
 * }} EdgeoutServerState
 * @typedef {{playerIds:readonly string[],botIds:readonly string[]}} EdgeoutRoomOptions
 */

const ROOM_CLEANUP_DELAY_MS = 30000;
const FIGHTER_SNAPSHOT_FIELDS = Object.freeze(/** @type {(keyof EdgeoutFighter)[]} */ (Object.keys(createEdgeoutFighter("p1", 0, 2))));
const edgeoutInputSession = createAuthoritativeInputSession({
  inputTemplate: EDGEOUT_INPUT_TEMPLATE,
  numericInputs: EDGEOUT_NUMERIC_INPUTS,
  edgeKeys: EDGEOUT_EDGE_KEYS,
  fixedDtSec: EDGEOUT_FIXED_DT_SEC,
});
/** Reused per tick for the bot step; the scheduler never runs rooms concurrently. */
const botFighterScratch = [];

/**
 * Metadata shared by both registrations. Each mode keeps its own namespace,
 * route and seat list so rooms, links and lifecycle never mix.
 * @param {{id:string,name:string,description:string,playerIds:readonly string[],tags:string[]}} mode
 */
function createEdgeoutGameMeta({ id, name, description, playerIds, tags }) {
  return {
    id,
    name,
    description,
    presentation: edgeoutPresentation,
    touchControls: edgeoutTouchControls,
    namespace: `/${id}`,
    room: { playerIds: [...playerIds] },
    networking: {
      namespace: `/${id}`,
      tickRateHz: 1 / EDGEOUT_FIXED_DT_SEC,
      inputProtocol: INPUT_PROTOCOL.QUEUED,
      inputTemplate: EDGEOUT_INPUT_TEMPLATE,
      numericInputs: EDGEOUT_NUMERIC_INPUTS,
    },
    path: `/games/${id}`,
    engine: "webgl",
    runtime: {
      kind: "module",
      mount: "canvas",
      entryUrl: id === EDGEOUT_PRACTICE_GAME_ID ? "/games/edgeout/dist/practice.js" : "/games/edgeout/dist/main.js",
      socketIo: true,
      kaboom: false,
    },
    tags,
    platformControlButtons: true,
  };
}

/** Competitive duel: two human seats, first to three rounds. */
export const edgeoutGameMeta = createEdgeoutGameMeta({
  id: EDGEOUT_GAME_ID,
  name: "Edgeout",
  description: "Shove, dash and parry your rival off a crumbling sky arena. Last one standing takes the round; first to three wins.",
  playerIds: EDGEOUT_DUEL_PLAYER_IDS,
  tags: ["Fighting", "2 players", "Competitive", "3D"],
});

/** Solo sparring: one human seat against a server-owned bot on the same rules. */
export const edgeoutPracticeGameMeta = createEdgeoutGameMeta({
  id: EDGEOUT_PRACTICE_GAME_ID,
  name: "Edgeout Practice",
  description: "Learn the shove, the dash and the parry against a CPU sparring partner before you challenge a friend.",
  playerIds: EDGEOUT_PRACTICE_PLAYER_IDS,
  tags: ["Fighting", "1 player", "Practice", "3D"],
});

/**
 * @param {EdgeoutRoomOptions} roomOptions
 * @returns {EdgeoutServerState}
 */
export function createEdgeoutServerState(roomOptions) {
  const match = createEdgeoutMatch(roomOptions);
  for (const fighter of Object.values(match.players)) {
    Object.assign(fighter, {
      input: { ...EDGEOUT_INPUT_TEMPLATE },
      inputEpoch: 0,
      inputSimulationTick: 0,
      lastInputSeqAck: 0,
      __controlEpoch: 0,
    });
  }
  return /** @type {EdgeoutServerState} */ ({
    ...match,
    botBrains: match.bots.map((_bot, index) => createEdgeoutBotBrain(match.matchId * 97 + index)),
    rematchRequests: Object.fromEntries(Object.keys(match.players).map((playerId) => [playerId, false])),
    abandonedAt: null,
    lastUpdate: Date.now(),
  });
}

/** @param {EdgeoutFighter} fighter @returns {EdgeoutFighter} */
function serializeEdgeoutFighter(fighter) {
  const fighterSnapshot = /** @type {EdgeoutFighter} */ ({});
  for (const field of FIGHTER_SNAPSHOT_FIELDS) fighterSnapshot[field] = fighter[field];
  return fighterSnapshot;
}

/**
 * Copy every declared game leaf from the first snapshot onward. SDK queues,
 * held input, rejoin tokens and bot brains remain private to the server.
 * @param {EdgeoutServerState} state
 * @returns {object} Snapshot-owned nested objects and primitive game leaves.
 */
export function serializeEdgeoutState(state) {
  return {
    matchId: state.matchId,
    roundNumber: state.roundNumber,
    players: Object.fromEntries(Object.entries(state.players).map(([playerId, fighter]) => [playerId, {
      ...serializeEdgeoutFighter(fighter),
      ...edgeoutInputSession.getPlayerSnapshotMetadata(fighter),
    }])),
    bots: state.bots.map(serializeEdgeoutFighter),
    arena: { ...state.arena },
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
    roundsToWin: state.roundsToWin,
    ringOutSerial: state.ringOutSerial,
    lastRingOutId: state.lastRingOutId,
    inputProtocol: INPUT_PROTOCOL.QUEUED,
  };
}

/** @param {EdgeoutServerState} state */
function scheduleEdgeoutStart(state) {
  scheduleStart(state, ROOM_START_COUNTDOWN_MS, (countdownState) => {
    countdownState.phase = "countdown";
  }, Object.keys(state.players));
}

/**
 * SDK ownership and game action edges reset together. The private epoch also
 * detects SDK starvation/dropped-time recovery inside the simulation callback.
 * @param {EdgeoutServerFighter} fighter
 */
function resetEdgeoutInputOwnership(fighter) {
  edgeoutInputSession.resetPlayer(fighter);
  resetEdgeoutFighterControls(fighter);
  fighter.__controlEpoch = fighter.inputEpoch;
}

/** @param {EdgeoutServerState} state @param {string} playerId */
function connectEdgeoutPlayer(state, playerId) {
  state.players[playerId].connected = true;
  resetEdgeoutInputOwnership(state.players[playerId]);
  state.abandonedAt = null;
  scheduleEdgeoutStart(state);
}

/**
 * Pause the match without losing round wins or damage. Every human's ownership
 * resets so held or queued actions cannot leak through a rejoin; bots freeze
 * with the paused world. Results stay final after the match ends.
 * @param {EdgeoutServerState} state
 * @param {string} playerId
 */
function disconnectEdgeoutPlayer(state, playerId) {
  state.players[playerId].connected = false;
  for (const slotId of Object.keys(state.players)) {
    resetEdgeoutInputOwnership(state.players[slotId]);
    state.rematchRequests[slotId] = false;
  }
  for (const bot of state.bots) resetEdgeoutFighterControls(bot);
  state.started = false;
  state.startAt = null;
  if (!state.gameOver) state.phase = "paused";
  state.abandonedAt = Object.values(state.players).every((fighter) => !fighter.connected) ? Date.now() : null;
}

/** @param {{state:EdgeoutServerState,playerId:string,payload:unknown}} options */
function receiveEdgeoutInput({ state, playerId, payload }) {
  const fighter = state.players[playerId];
  if (!fighter?.connected || state.gameOver) return;
  edgeoutInputSession.receiveInput(fighter, payload);
}

/** @param {{state:EdgeoutServerState,dt:number}} context */
function stepEdgeoutPlayerInputs({ state, dt }) {
  const active = state.started && !state.gameOver && state.phase === "playing";
  edgeoutInputSession.simulateRoom({
    state,
    dtSec: dt,
    simulate: (fighter, input, fixedDtSec) => {
      if (fighter.__controlEpoch !== fighter.inputEpoch) {
        resetEdgeoutFighterControls(fighter);
        fighter.__controlEpoch = fighter.inputEpoch;
      }
      stepEdgeoutFighter(fighter, input, fixedDtSec, { active: active && fighter.connected, intactRings: state.arena.intactRings });
    },
  });
}

/**
 * Bots decide from the same post-input world the humans just produced, then
 * move once per tick through the shared fighter rules.
 * @param {{state:EdgeoutServerState,dt:number}} context
 */
function stepEdgeoutBots({ state, dt }) {
  if (state.bots.length === 0 || !state.started || state.gameOver || state.phase !== "playing") return;
  const fighters = listEdgeoutFighters(state, botFighterScratch);
  state.bots.forEach((bot, index) => {
    const input = decideEdgeoutBotInput(bot, state.botBrains[index], state, fighters, dt);
    stepEdgeoutFighter(bot, input, dt, { active: true, intactRings: state.arena.intactRings });
  });
}

/**
 * Every connected human votes after a completed match; practice needs one
 * vote. Series wins and seat ownership carry into the fresh match.
 * @param {{socket:import("socket.io").Socket,games:Map<string,EdgeoutServerState>,nsp:import("socket.io").Namespace}} context
 * @param {EdgeoutRoomOptions} roomOptions
 */
function requestEdgeoutRematch({ socket, games, nsp }, roomOptions) {
  const { gameId, playerId } = socket.data;
  const state = games.get(gameId);
  if (!state || !state.gameOver || !Object.hasOwn(state.players, playerId) || !state.players[playerId].connected) return;
  state.rematchRequests[playerId] = true;
  emitEvent({ socket, gameId, type: SOCKET_EVENT.REMATCH_REQUESTED, payload: { playerId }, target: "others" });
  if (!Object.keys(state.players).every((slotId) => state.players[slotId].connected && state.rematchRequests[slotId])) return;

  const nextState = createEdgeoutServerState(roomOptions);
  nextState.matchId = state.matchId + 1;
  nextState.botBrains = nextState.bots.map((_bot, index) => createEdgeoutBotBrain(nextState.matchId * 97 + index));
  for (const slotId of Object.keys(state.players)) {
    const previousFighter = state.players[slotId];
    const nextFighter = nextState.players[slotId];
    nextFighter.connected = previousFighter.connected;
    nextFighter.rejoinToken = previousFighter.rejoinToken;
    nextFighter.seriesWins = previousFighter.seriesWins;
    nextFighter.inputEpoch = previousFighter.inputEpoch;
    resetEdgeoutInputOwnership(nextFighter);
  }
  state.bots.forEach((bot, index) => { nextState.bots[index].seriesWins = bot.seriesWins; });
  scheduleEdgeoutStart(nextState);
  games.set(gameId, nextState);
  emitEvent({ nsp, gameId, type: SOCKET_EVENT.REMATCH_STARTED, target: "game" });
}

/**
 * Register one Edgeout mode with platform rooms, input ownership and the
 * fixed-cadence scheduler. Bots stay outside the human seat table, so they
 * never count toward readiness. Pure shared rules own every outcome.
 * @param {import("socket.io").Server} io
 * @param {ReturnType<typeof createEdgeoutGameMeta>} meta
 * @param {EdgeoutRoomOptions} roomOptions
 * @returns {ReturnType<typeof registerPluggableGame>}
 */
function registerEdgeoutMode(io, meta, roomOptions) {
  createEdgeoutMatch(roomOptions);
  return registerPluggableGame({
    io,
    meta,
    createState: () => createEdgeoutServerState(roomOptions),
    onPlayerConnected: connectEdgeoutPlayer,
    handleInput: receiveEdgeoutInput,
    handleDisconnect: disconnectEdgeoutPlayer,
    handleRematch: (context) => requestEdgeoutRematch(context, roomOptions),
    beforeUpdate: scheduleEdgeoutStart,
    systems: [
      { priority: -200, system: { name: "round-lifecycle", update: ({ state, nowMs }) => {
        state.lastUpdate = nowMs;
        scheduleEdgeoutStart(state);
        if (!state.started && state.startAt !== null && nowMs >= state.startAt) {
          state.started = true;
          state.startAt = null;
          state.phase = state.roundResetRemainingSec > 0 ? "roundOver" : "playing";
        }
      } } },
      { priority: -100, system: { name: "player-input", update: stepEdgeoutPlayerInputs } },
      { priority: -50, system: { name: "bots", update: stepEdgeoutBots } },
      { priority: 0, system: { name: "shared-world", update: ({ state, dt }) => stepEdgeoutWorld(state, dt) } },
    ],
    shouldStep: ({ state }) => !state.gameOver,
    shouldCleanup: (state, nowMs) => state.abandonedAt !== null && nowMs - state.abandonedAt > ROOM_CLEANUP_DELAY_MS,
    serializeState: serializeEdgeoutState,
    tickMs: EDGEOUT_FIXED_DT_SEC * 1000,
    dtFallback: EDGEOUT_FIXED_DT_SEC,
  });
}

/** @param {import("socket.io").Server} io */
export function registerEdgeoutGame(io) {
  return registerEdgeoutMode(io, edgeoutGameMeta, { playerIds: EDGEOUT_DUEL_PLAYER_IDS, botIds: [] });
}

/** @param {import("socket.io").Server} io */
export function registerEdgeoutPracticeGame(io) {
  return registerEdgeoutMode(io, edgeoutPracticeGameMeta, { playerIds: EDGEOUT_PRACTICE_PLAYER_IDS, botIds: EDGEOUT_PRACTICE_BOT_IDS });
}
