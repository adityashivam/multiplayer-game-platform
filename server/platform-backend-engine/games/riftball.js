import { ROOM_START_COUNTDOWN_MS } from "../../../public/platform/shared/roomLifecycle.js";
import { INPUT_PROTOCOL, SOCKET_EVENT } from "../../../public/platform/shared/networkProtocol.js";
import { riftballPresentation, riftballTouchControls } from "../../../public/games/riftball/catalog.js";
import {
  RIFTBALL_EDGE_KEYS,
  RIFTBALL_FIXED_DT_SEC,
  RIFTBALL_GAME_ID,
  RIFTBALL_INPUT_TEMPLATE,
  RIFTBALL_NUMERIC_INPUTS,
  RIFTBALL_PLAYER_IDS,
} from "../../../public/games/riftball/shared/config.js";
import {
  createRiftballPlayer,
  createRiftballRound,
  resetRiftballPlayerControls,
  stepRiftballPlayer,
  stepRiftballWorld,
} from "../../../public/games/riftball/shared/simulation.js";
import { createAuthoritativeInputSession } from "../core/authoritativeInputSession.js";
import { emitEvent, registerPluggableGame, scheduleStart } from "../core/index.js";

/** @typedef {import("../../../public/games/riftball/shared/config.js").RiftballPlayerId} RiftballPlayerId */
/** @typedef {import("../../../public/games/riftball/shared/config.js").RiftballInputState} RiftballInputState */
/** @typedef {import("../../../public/games/riftball/shared/simulation.js").RiftballPlayer} RiftballPlayer */
/**
 * @typedef {RiftballPlayer & import("../core/authoritativeInputSession.js").AuthoritativePlayerInputState<keyof RiftballInputState> & {
 *   input:RiftballInputState,inputEpoch:number,inputSimulationTick:number,lastInputSeqAck:number,
 *   rejoinToken?:string,__controlEpoch:number
 * }} RiftballServerPlayer
 * @typedef {import("../../../public/games/riftball/shared/simulation.js").RiftballRound & {
 *   players:{p1:RiftballServerPlayer,p2:RiftballServerPlayer},
 *   rematchRequests:{p1:boolean,p2:boolean},abandonedAt:number|null,lastUpdate:number
 * }} RiftballServerState
 */

const ROOM_CLEANUP_DELAY_MS = 30000;
const PLAYER_SNAPSHOT_FIELDS = Object.freeze(/** @type {(keyof RiftballPlayer)[]} */ (Object.keys(createRiftballPlayer("p1", 0))));
const riftballInputSession = createAuthoritativeInputSession({
  inputTemplate: RIFTBALL_INPUT_TEMPLATE,
  numericInputs: RIFTBALL_NUMERIC_INPUTS,
  edgeKeys: RIFTBALL_EDGE_KEYS,
  fixedDtSec: RIFTBALL_FIXED_DT_SEC,
});

/** Game-owned metadata; the application composition selects this trusted package. */
export const riftballGameMeta = {
  id: RIFTBALL_GAME_ID,
  name: "Riftball Duel",
  description: "Charge a shot, dash for the rebound and outplay a friend in a two-minute arena sport. First to five wins.",
  presentation: riftballPresentation,
  touchControls: riftballTouchControls,
  namespace: "/riftball",
  room: { playerIds: [...RIFTBALL_PLAYER_IDS] },
  networking: {
    namespace: "/riftball",
    tickRateHz: 1 / RIFTBALL_FIXED_DT_SEC,
    inputProtocol: INPUT_PROTOCOL.QUEUED,
    inputTemplate: RIFTBALL_INPUT_TEMPLATE,
    numericInputs: RIFTBALL_NUMERIC_INPUTS,
  },
  path: "/games/riftball",
  engine: "webgl",
  runtime: {
    kind: "module", mount: "canvas", entryUrl: "/games/riftball/dist/main.js",
    socketIo: true, kaboom: false,
  },
  tags: ["Sports", "2 players", "Action", "3D"],
  platformControlButtons: true,
};

/** @returns {RiftballServerState} */
export function createRiftballServerState() {
  const round = createRiftballRound();
  for (const player of Object.values(round.players)) {
    Object.assign(player, {
      input: { ...RIFTBALL_INPUT_TEMPLATE },
      inputEpoch: 0,
      inputSimulationTick: 0,
      lastInputSeqAck: 0,
      __controlEpoch: 0,
    });
  }
  return /** @type {RiftballServerState} */ ({
    ...round,
    rematchRequests: { p1: false, p2: false },
    abandonedAt: null,
    lastUpdate: Date.now(),
  });
}

/** @param {RiftballServerPlayer} player */
function serializeRiftballPlayer(player) {
  const playerSnapshot = /** @type {RiftballPlayer} */ ({});
  for (const field of PLAYER_SNAPSHOT_FIELDS) playerSnapshot[field] = player[field];
  return { ...playerSnapshot, ...riftballInputSession.getPlayerSnapshotMetadata(player) };
}

/**
 * Copy every declared game leaf from the first snapshot onward. Mutable SDK
 * queues, held input objects and rejoin tokens remain private to the server.
 * @param {RiftballServerState} state
 * @returns {object} Snapshot-owned nested objects and primitive game leaves.
 */
export function serializeRiftballState(state) {
  return {
    roundId: state.roundId,
    players: { p1: serializeRiftballPlayer(state.players.p1), p2: serializeRiftballPlayer(state.players.p2) },
    ball: { ...state.ball },
    timeSec: state.timeSec,
    timer: state.timer,
    durationSec: state.durationSec,
    started: state.started,
    startAt: state.startAt,
    gameOver: state.gameOver,
    winner: state.winner,
    phase: state.phase,
    suddenDeath: state.suddenDeath,
    goalSerial: state.goalSerial,
    lastScorer: state.lastScorer,
    goalResetRemainingSec: state.goalResetRemainingSec,
    inputProtocol: INPUT_PROTOCOL.QUEUED,
  };
}

/** @param {RiftballServerState} state */
function scheduleRiftballStart(state) {
  scheduleStart(state, ROOM_START_COUNTDOWN_MS, (countdownState) => {
    countdownState.phase = "countdown";
  }, RIFTBALL_PLAYER_IDS);
}

/**
 * SDK ownership and game action edges reset together. The private epoch also
 * detects SDK starvation/dropped-time recovery inside the simulation callback.
 * @param {RiftballServerPlayer} player
 */
function resetRiftballInputOwnership(player) {
  riftballInputSession.resetPlayer(player);
  resetRiftballPlayerControls(player);
  player.__controlEpoch = player.inputEpoch;
}

/** @param {RiftballServerState} state @param {RiftballPlayerId} playerId */
function connectRiftballPlayer(state, playerId) {
  const player = state.players[playerId];
  player.connected = true;
  resetRiftballInputOwnership(player);
  state.abandonedAt = null;
  scheduleRiftballStart(state);
}

/**
 * Pause the existing score, ball and clock. Reset both participants' ownership
 * so the remaining player's queued/held actions cannot leak through a rejoin.
 * Results remain results if a client disconnects after the final whistle.
 * @param {RiftballServerState} state
 * @param {RiftballPlayerId} playerId
 */
function disconnectRiftballPlayer(state, playerId) {
  state.players[playerId].connected = false;
  for (const slotId of RIFTBALL_PLAYER_IDS) {
    resetRiftballInputOwnership(state.players[slotId]);
    state.rematchRequests[slotId] = false;
  }
  state.started = false;
  state.startAt = null;
  if (!state.gameOver) state.phase = "paused";
  state.abandonedAt = RIFTBALL_PLAYER_IDS.every((slotId) => !state.players[slotId].connected) ? Date.now() : null;
}

/** @param {{state:RiftballServerState,playerId:RiftballPlayerId,payload:unknown}} options */
function receiveRiftballInput({ state, playerId, payload }) {
  const player = state.players[playerId];
  if (!player?.connected || state.gameOver) return;
  riftballInputSession.receiveInput(player, payload);
}

/** @param {{state:RiftballServerState,dt:number}} context */
function stepRiftballPlayerInputs({ state, dt }) {
  const active = state.started && !state.gameOver && state.phase !== "goal";
  riftballInputSession.simulateRoom({
    state,
    dtSec: dt,
    simulate: (player, input, fixedDtSec) => {
      if (player.__controlEpoch !== player.inputEpoch) {
        resetRiftballPlayerControls(player);
        player.__controlEpoch = player.inputEpoch;
      }
      stepRiftballPlayer(player, input, fixedDtSec, { active: active && player.connected, timeSec: state.timeSec });
    },
  });
}

/**
 * Both connected seats vote after a completed match. Fresh match state preserves
 * series wins and rejoin ownership, while the SDK advances command epochs.
 * @param {{socket:import("socket.io").Socket,games:Map<string,RiftballServerState>,nsp:import("socket.io").Namespace}} context
 */
function requestRiftballRematch({ socket, games, nsp }) {
  const { gameId, playerId } = socket.data;
  const state = games.get(gameId);
  if (!state || !state.gameOver || !RIFTBALL_PLAYER_IDS.includes(playerId) || !state.players[playerId].connected) return;
  state.rematchRequests[playerId] = true;
  emitEvent({ socket, gameId, type: SOCKET_EVENT.REMATCH_REQUESTED, payload: { playerId }, target: "others" });
  if (!RIFTBALL_PLAYER_IDS.every((slotId) => state.players[slotId].connected && state.rematchRequests[slotId])) return;

  const nextState = createRiftballServerState();
  nextState.roundId = state.roundId + 1;
  for (const slotId of RIFTBALL_PLAYER_IDS) {
    const previousPlayer = state.players[slotId];
    const nextPlayer = nextState.players[slotId];
    nextPlayer.connected = previousPlayer.connected;
    nextPlayer.rejoinToken = previousPlayer.rejoinToken;
    nextPlayer.seriesWins = previousPlayer.seriesWins;
    nextPlayer.inputEpoch = previousPlayer.inputEpoch;
    resetRiftballInputOwnership(nextPlayer);
  }
  scheduleRiftballStart(nextState);
  games.set(gameId, nextState);
  emitEvent({ nsp, gameId, type: SOCKET_EVENT.REMATCH_STARTED, target: "game" });
}

/**
 * Register this game's callbacks with platform rooms, input ownership and the
 * fixed-cadence authoritative scheduler. Pure world rules own all outcomes.
 * @param {import("socket.io").Server} io
 * @returns {ReturnType<typeof registerPluggableGame>}
 */
export function registerRiftballGame(io) {
  return registerPluggableGame({
    io,
    meta: riftballGameMeta,
    createState: createRiftballServerState,
    onPlayerConnected: connectRiftballPlayer,
    handleInput: receiveRiftballInput,
    handleDisconnect: disconnectRiftballPlayer,
    handleRematch: requestRiftballRematch,
    beforeUpdate: scheduleRiftballStart,
    systems: [
      { priority: -200, system: { name: "round-lifecycle", update: ({ state, nowMs }) => {
        state.lastUpdate = nowMs;
        scheduleRiftballStart(state);
        if (!state.started && state.startAt !== null && nowMs >= state.startAt) {
          state.started = true;
          state.startAt = null;
          state.phase = state.goalResetRemainingSec > 0 ? "goal" : state.suddenDeath ? "overtime" : "playing";
        }
      } } },
      { priority: -100, system: { name: "player-input", update: stepRiftballPlayerInputs } },
      { priority: 0, system: { name: "shared-world", update: ({ state, dt }) => stepRiftballWorld(state, dt) } },
    ],
    shouldStep: ({ state }) => !state.gameOver,
    shouldCleanup: (state, nowMs) => state.abandonedAt !== null && nowMs - state.abandonedAt > ROOM_CLEANUP_DELAY_MS,
    serializeState: serializeRiftballState,
    tickMs: RIFTBALL_FIXED_DT_SEC * 1000,
    dtFallback: RIFTBALL_FIXED_DT_SEC,
  });
}
