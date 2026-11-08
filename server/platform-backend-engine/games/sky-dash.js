import { ROOM_START_COUNTDOWN_MS } from "../../../public/platform/shared/roomLifecycle.js";
import { skyDashPresentation, skyDashTouchControls } from "../../../public/games/sky-dash/catalog.js";
import {
  SKY_DASH_BOT_COUNT,
  SKY_DASH_EDGE_KEYS,
  SKY_DASH_FIXED_DT_SEC,
  SKY_DASH_GAME_ID,
  SKY_DASH_INPUT_TEMPLATE,
  SKY_DASH_NUMERIC_INPUTS,
  SKY_DASH_PLAYER_IDS,
} from "../../../public/games/sky-dash/shared/config.js";
import {
  createSkyDashRound,
  createSkyDashRunner,
  stepSkyDashRunner,
  stepSkyDashWorld,
} from "../../../public/games/sky-dash/shared/simulation.js";
import { INPUT_PROTOCOL, SOCKET_EVENT } from "../../../public/platform/shared/networkProtocol.js";
import { createAuthoritativeInputSession } from "../core/authoritativeInputSession.js";
import { emitEvent, registerPluggableGame, scheduleStart } from "../core/index.js";

/** @typedef {import("../../../public/games/sky-dash/shared/config.js").SkyDashInputState} SkyDashInputState */
/** @typedef {import("../../../public/games/sky-dash/shared/simulation.js").SkyDashRunner} SkyDashRunner */
/**
 * @typedef {SkyDashRunner & import("../core/authoritativeInputSession.js").AuthoritativePlayerInputState<keyof SkyDashInputState> & {
 *   input:SkyDashInputState,inputEpoch:number,inputSimulationTick:number,lastInputSeqAck:number,rejoinToken?:string
 * }} SkyDashServerRunner
 * @typedef {import("../../../public/games/sky-dash/shared/simulation.js").SkyDashRound & {
 *   players:Record<string,SkyDashServerRunner>,rematchRequests:Record<string,boolean>,abandonedAt:number|null,lastUpdate:number
 * }} SkyDashServerState
 * @typedef {{playerIds?:readonly string[],botCount?:number}} SkyDashRoomOptions
 */

const COUNTDOWN_MS = ROOM_START_COUNTDOWN_MS;
const ROOM_CLEANUP_DELAY_MS = 30000;
const RUNNER_SNAPSHOT_FIELDS = Object.freeze(/** @type {(keyof SkyDashRunner)[]} */ (Object.keys(createSkyDashRunner("p1", 0))));
const skyDashInputSession = createAuthoritativeInputSession({
  inputTemplate: SKY_DASH_INPUT_TEMPLATE,
  numericInputs: SKY_DASH_NUMERIC_INPUTS,
  edgeKeys: SKY_DASH_EDGE_KEYS,
  fixedDtSec: SKY_DASH_FIXED_DT_SEC,
});

/** Game-owned metadata; application composition selects this trusted package. */
export const skyDashGameMeta = {
  id: SKY_DASH_GAME_ID,
  name: "Sky Dash",
  description: "Jump, dash and tumble through a floating obstacle course. Two friends race three mischievous bots for the finish.",
  presentation: skyDashPresentation,
  touchControls: skyDashTouchControls,
  namespace: "/sky-dash",
  room: { playerIds: [...SKY_DASH_PLAYER_IDS] },
  networking: {
    namespace: "/sky-dash",
    tickRateHz: 1 / SKY_DASH_FIXED_DT_SEC,
    inputProtocol: INPUT_PROTOCOL.QUEUED,
    inputTemplate: SKY_DASH_INPUT_TEMPLATE,
    numericInputs: SKY_DASH_NUMERIC_INPUTS,
  },
  path: "/games/sky-dash",
  engine: "webgl",
  runtime: {
    kind: "module",
    mount: "canvas",
    entryUrl: "/games/sky-dash/dist/main.js",
    socketIo: true,
    kaboom: false,
  },
  tags: ["Racing", "2 players", "Platformer", "3D"],
  platformControlButtons: true,
};

/** @param {SkyDashRoomOptions} options @returns {SkyDashServerState} */
function createSkyDashServerState(options) {
  const round = createSkyDashRound(options);
  for (const runner of Object.values(round.players)) {
    Object.assign(runner, {
      input: { ...SKY_DASH_INPUT_TEMPLATE },
      inputEpoch: 0,
      inputSimulationTick: 0,
      lastInputSeqAck: 0,
    });
  }
  return {
    ...round,
    rematchRequests: Object.fromEntries(Object.keys(round.players).map((playerId) => [playerId, false])),
    abandonedAt: null,
    lastUpdate: Date.now(),
  };
}

/**
 * Copy only declared game fields. Tokens, SDK queues and mutable input state
 * remain private, while all future action/progress leaves exist immediately.
 * @param {SkyDashRunner} runner
 * @returns {SkyDashRunner}
 */
function serializeSkyDashRunner(runner) {
  const runnerSnapshot = /** @type {SkyDashRunner} */ ({});
  for (const field of RUNNER_SNAPSHOT_FIELDS) runnerSnapshot[field] = runner[field];
  return runnerSnapshot;
}

/**
 * Preserve configured human keys and fixed bot/standing counts on every packet.
 * All objects are owned copies so packed snapshot baselines cannot mutate.
 * @param {SkyDashServerState} state
 */
export function serializeSkyDashState(state) {
  return {
    roundId: state.roundId,
    players: Object.fromEntries(Object.entries(state.players).map(([playerId, runner]) => [playerId, {
      ...serializeSkyDashRunner(runner),
      ...skyDashInputSession.getPlayerSnapshotMetadata(runner),
    }])),
    bots: state.bots.map((runner) => serializeSkyDashRunner(runner)),
    standings: state.standings.map((standing) => ({ ...standing })),
    seesaws: state.seesaws.map((seesaw) => ({ ...seesaw })),
    timeSec: state.timeSec,
    timer: state.timer,
    durationSec: state.durationSec,
    started: state.started,
    startAt: state.startAt,
    gameOver: state.gameOver,
    winner: state.winner,
    inputProtocol: INPUT_PROTOCOL.QUEUED,
    connected: Object.fromEntries(Object.entries(state.players).map(([playerId, runner]) => [playerId, runner.connected])),
  };
}

/** @param {SkyDashServerState} state */
function scheduleSkyDashStart(state) {
  scheduleStart(state, COUNTDOWN_MS, undefined, Object.keys(state.players));
}

/** @param {SkyDashServerState} state @param {string} playerId */
function connectSkyDashPlayer(state, playerId) {
  const runner = state.players[playerId];
  runner.connected = true;
  runner.jumpHeld = false;
  runner.dashHeld = false;
  runner.diveHeld = false;
  skyDashInputSession.resetPlayer(runner);
  state.abandonedAt = null;
  scheduleSkyDashStart(state);
}

/**
 * Pause the existing race rather than rebuilding its clock, course or progress.
 * The SDK invalidates old ownership and clears queued/held commands immediately.
 * @param {SkyDashServerState} state
 * @param {string} playerId
 */
function disconnectSkyDashPlayer(state, playerId) {
  const runner = state.players[playerId];
  runner.connected = false;
  runner.vx = 0;
  runner.vy = 0;
  runner.vz = 0;
  runner.jumpHeld = false;
  runner.dashHeld = false;
  runner.diveHeld = false;
  runner.jumpBufferSec = 0;
  skyDashInputSession.resetPlayer(runner);
  state.started = false;
  state.startAt = null;
  for (const slotId of Object.keys(state.players)) state.rematchRequests[slotId] = false;
  state.abandonedAt = Object.values(state.players).every((player) => !player.connected) ? Date.now() : null;
}

/** @param {{state:SkyDashServerState,playerId:string,payload:unknown}} options */
function receiveSkyDashInput({ state, playerId, payload }) {
  const runner = state.players[playerId];
  if (!runner?.connected || state.gameOver) return;
  skyDashInputSession.receiveInput(runner, payload);
}

/**
 * Advance input exactly through the shared SDK. Every human uses the pre-world
 * course time; stepSkyDashWorld then moves bots and advances this clock once.
 * @param {{state:SkyDashServerState,dt:number}} context
 */
function stepSkyDashPlayerInputs({ state, dt }) {
  const active = state.started && !state.gameOver;
  skyDashInputSession.simulateRoom({
    state,
    dtSec: dt,
    simulate: (runner, inputState, fixedDtSec) => {
      stepSkyDashRunner(runner, inputState, fixedDtSec, { active: active && runner.connected, timeSec: state.timeSec, seesaws: state.seesaws });
    },
  });
}

/**
 * @param {{socket:import("socket.io").Socket,games:Map<string,SkyDashServerState>,nsp:import("socket.io").Namespace}} context
 * @param {() => SkyDashServerState} createState
 */
function requestSkyDashRematch({ socket, games, nsp }, createState) {
  const { gameId, playerId } = socket.data;
  const state = games.get(gameId);
  if (!state || !state.gameOver || !Object.hasOwn(state.players, playerId) || !state.players[playerId].connected) return;
  state.rematchRequests[playerId] = true;
  emitEvent({ socket, gameId, type: SOCKET_EVENT.REMATCH_REQUESTED, payload: { playerId }, target: "others" });
  if (!Object.keys(state.players).every((slotId) => state.players[slotId].connected && state.rematchRequests[slotId])) return;

  const nextState = createState();
  nextState.roundId = state.roundId + 1;
  for (const slotId of Object.keys(state.players)) {
    const previousRunner = state.players[slotId];
    const nextRunner = nextState.players[slotId];
    nextRunner.connected = previousRunner.connected;
    nextRunner.rejoinToken = previousRunner.rejoinToken;
    nextRunner.inputEpoch = previousRunner.inputEpoch;
    skyDashInputSession.resetPlayer(nextRunner);
  }
  scheduleSkyDashStart(nextState);
  games.set(gameId, nextState);
  emitEvent({ nsp, gameId, type: SOCKET_EVENT.REMATCH_STARTED, target: "game" });
}

/**
 * Register server authority with platform rooms, input ownership and snapshots.
 * Optional trusted configuration exercises alternate human/bot capacities using
 * the same rules, without placing bot actors in the socket ownership table.
 * @param {import("socket.io").Server} io
 * @param {SkyDashRoomOptions} [options]
 * @returns {ReturnType<typeof registerPluggableGame>}
 */
export function registerSkyDashGame(io, { playerIds = SKY_DASH_PLAYER_IDS, botCount = SKY_DASH_BOT_COUNT } = {}) {
  const roomOptions = { playerIds: [...playerIds], botCount };
  createSkyDashRound(roomOptions);
  const createState = () => createSkyDashServerState(roomOptions);
  return registerPluggableGame({
    io,
    meta: { ...skyDashGameMeta, room: { playerIds: roomOptions.playerIds } },
    createState,
    onPlayerConnected: connectSkyDashPlayer,
    handleInput: receiveSkyDashInput,
    handleDisconnect: disconnectSkyDashPlayer,
    handleRematch: (context) => requestSkyDashRematch(context, createState),
    beforeUpdate: scheduleSkyDashStart,
    systems: [
      { priority: -200, system: { name: "round-lifecycle", update: ({ state, nowMs }) => {
        state.lastUpdate = nowMs;
        if (!state.started && state.startAt !== null && nowMs >= state.startAt) {
          state.started = true;
          state.startAt = null;
        }
      } } },
      { priority: -100, system: { name: "player-input", update: stepSkyDashPlayerInputs } },
      { priority: 0, system: { name: "shared-world", update: ({ state, dt }) => stepSkyDashWorld(state, dt) } },
    ],
    shouldStep: ({ state }) => !state.gameOver,
    shouldCleanup: (state, nowMs) => state.abandonedAt !== null && nowMs - state.abandonedAt > ROOM_CLEANUP_DELAY_MS,
    serializeState: serializeSkyDashState,
    tickMs: SKY_DASH_FIXED_DT_SEC * 1000,
    dtFallback: SKY_DASH_FIXED_DT_SEC,
  });
}
