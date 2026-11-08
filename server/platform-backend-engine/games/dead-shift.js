import { ROOM_START_COUNTDOWN_MS } from "../../../public/platform/shared/roomLifecycle.js";
import { deadShiftPresentation, deadShiftTouchControls } from "../../../public/games/dead-shift/catalog.js";
import {
  DEAD_SHIFT_EDGE_KEYS,
  DEAD_SHIFT_FIXED_DT_SEC,
  DEAD_SHIFT_GAME_ID,
  DEAD_SHIFT_INPUT_TEMPLATE,
  DEAD_SHIFT_NUMERIC_INPUTS,
  DEAD_SHIFT_PLAYER_IDS,
  DEAD_SHIFT_PLAYER_SETTINGS,
} from "../../../public/games/dead-shift/shared/config.js";
import {
  createDeadShiftPlayer,
  createDeadShiftRound,
  stepDeadShiftCombat,
  stepDeadShiftPlayer,
  stepDeadShiftWorld,
} from "../../../public/games/dead-shift/shared/simulation.js";
import { INPUT_PROTOCOL, SOCKET_EVENT } from "../../../public/platform/shared/networkProtocol.js";
import { createAuthoritativeInputSession } from "../core/authoritativeInputSession.js";
import { emitEvent, registerPluggableGame, scheduleStart } from "../core/index.js";

/** @typedef {import("../../../public/games/dead-shift/shared/config.js").DeadShiftPlayerId} DeadShiftPlayerId */
/** @typedef {import("../../../public/games/dead-shift/shared/config.js").DeadShiftInputState} DeadShiftInputState */
/** @typedef {import("../../../public/games/dead-shift/shared/simulation.js").DeadShiftPlayerState} DeadShiftPlayerState */
/**
 * @typedef {DeadShiftPlayerState & import("../core/authoritativeInputSession.js").AuthoritativePlayerInputState<keyof DeadShiftInputState> & {
 *   input: DeadShiftInputState,inputEpoch:number,inputSimulationTick:number,lastInputSeqAck:number,rejoinToken?:string
 * }} DeadShiftServerPlayerState
 * @typedef {import("../../../public/games/dead-shift/shared/simulation.js").DeadShiftRoundState & {
 *   players:{p1:DeadShiftServerPlayerState,p2:DeadShiftServerPlayerState},
 *   roundId:number,rematchRequests:{p1:boolean,p2:boolean},abandonedAt:number|null,lastUpdate:number
 * }} DeadShiftServerState
 */

const COUNTDOWN_MS = ROOM_START_COUNTDOWN_MS;
const ROOM_CLEANUP_DELAY_MS = 30000;
const PLAYER_SNAPSHOT_FIELDS = Object.freeze(Object.keys(createDeadShiftPlayer("p1")));
const deadShiftInputSession = createAuthoritativeInputSession({
  inputTemplate: DEAD_SHIFT_INPUT_TEMPLATE,
  numericInputs: DEAD_SHIFT_NUMERIC_INPUTS,
  edgeKeys: DEAD_SHIFT_EDGE_KEYS,
  fixedDtSec: DEAD_SHIFT_FIXED_DT_SEC,
});

/** Game-owned registration metadata; the trusted built-in registry imports this package. */
export const deadShiftGameMeta = {
  id: DEAD_SHIFT_GAME_ID,
  name: "Dead Shift",
  description: "Two survivors. One shared horde. Race for the most zombie kills in a 90-second containment breach.",
  presentation: deadShiftPresentation,
  touchControls: deadShiftTouchControls,
  namespace: "/dead-shift",
  room: { playerIds: [...DEAD_SHIFT_PLAYER_IDS] },
  networking: {
    namespace: "/dead-shift",
    tickRateHz: 60,
    inputProtocol: INPUT_PROTOCOL.QUEUED,
    inputTemplate: DEAD_SHIFT_INPUT_TEMPLATE,
    numericInputs: DEAD_SHIFT_NUMERIC_INPUTS,
  },
  path: "/games/dead-shift",
  engine: "webgl",
  runtime: {
    kind: "module",
    mount: "canvas",
    entryUrl: "/games/dead-shift/dist/main.js",
    socketIo: true,
    kaboom: false,
  },
  tags: ["Shooter", "2 players", "Horror", "3D"],
  platformControlButtons: true,
  startInLandscape: true,
};

/** @returns {DeadShiftServerState} */
function createDeadShiftServerState() {
  const round = createDeadShiftRound();
  for (const playerId of DEAD_SHIFT_PLAYER_IDS) {
    Object.assign(round.players[playerId], {
      input: { ...DEAD_SHIFT_INPUT_TEMPLATE },
      inputEpoch: 0,
      inputSimulationTick: 0,
      lastInputSeqAck: 0,
    });
  }
  return { ...round, roundId: 1, rematchRequests: { p1: false, p2: false }, abandonedAt: null, lastUpdate: Date.now() };
}

/**
 * Select only explicit game snapshot fields; SDK queues/tokens stay server-owned.
 * Each snapshot owns its array values so transport comparisons retain baselines.
 * @param {DeadShiftServerPlayerState} player
 */
function serializeDeadShiftPlayer(player) {
  const playerSnapshot = {};
  for (const key of PLAYER_SNAPSHOT_FIELDS) {
    playerSnapshot[key] = key === "magazines" ? player.magazines.slice() : player[key];
  }
  return { ...playerSnapshot, ...deadShiftInputSession.getPlayerSnapshotMetadata(player) };
}

/**
 * Fixed pools make all future entity/event leaves visible in the first snapshot.
 * @param {DeadShiftServerState} state
 */
export function serializeDeadShiftState(state) {
  return {
    roundId: state.roundId,
    players: { p1: serializeDeadShiftPlayer(state.players.p1), p2: serializeDeadShiftPlayer(state.players.p2) },
    enemies: state.enemies.map((enemy) => ({ ...enemy })),
    projectiles: state.projectiles.map((projectile) => ({ ...projectile })),
    events: state.events.map((event) => ({ ...event })),
    timer: state.timer,
    durationSec: state.durationSec,
    maxHealth: DEAD_SHIFT_PLAYER_SETTINGS.maxHealth,
    started: state.started,
    startAt: state.startAt,
    gameOver: state.gameOver,
    winner: state.winner,
    inputProtocol: INPUT_PROTOCOL.QUEUED,
    connected: { p1: state.players.p1.connected, p2: state.players.p2.connected },
  };
}

/** @param {DeadShiftServerState} state */
function scheduleDeadShiftStart(state) {
  scheduleStart(state, COUNTDOWN_MS, undefined, DEAD_SHIFT_PLAYER_IDS);
}

/** @param {DeadShiftServerState} state @param {DeadShiftPlayerId} playerId */
function connectDeadShiftPlayer(state, playerId) {
  const player = state.players[playerId];
  player.connected = true;
  player.jumpHeld = false;
  player.reloadHeld = false;
  deadShiftInputSession.resetPlayer(player);
  state.abandonedAt = null;
  scheduleDeadShiftStart(state);
}

/**
 * Pause the existing round while an owner reconnects. Entities, score and clock
 * remain intact; the SDK clears held input and advances ownership immediately.
 * @param {DeadShiftServerState} state
 * @param {DeadShiftPlayerId} playerId
 */
function disconnectDeadShiftPlayer(state, playerId) {
  const player = state.players[playerId];
  player.connected = false;
  for (const ownerState of Object.values(state.players)) {
    ownerState.vx = 0;
    ownerState.vy = 0;
    ownerState.vz = 0;
    ownerState.jumpHeld = false;
    ownerState.reloadHeld = false;
    deadShiftInputSession.resetPlayer(ownerState);
  }
  state.started = false;
  state.startAt = null;
  state.rematchRequests.p1 = false;
  state.rematchRequests.p2 = false;
  state.abandonedAt = DEAD_SHIFT_PLAYER_IDS.every((slotId) => !state.players[slotId].connected) ? Date.now() : null;
}

/**
 * @param {{state:DeadShiftServerState,playerId:DeadShiftPlayerId,payload:unknown}} options
 */
function receiveDeadShiftInput({ state, playerId, payload }) {
  const player = state.players[playerId];
  if (!player || !player.connected || state.gameOver) return;
  deadShiftInputSession.receiveInput(player, payload);
}

/**
 * Keep movement/input acknowledgement in the SDK and advance weapon intent once
 * per fixed world step. Neither packet frequency nor render FPS advances combat.
 * @param {{state:DeadShiftServerState,dt:number}} context
 */
function stepDeadShiftPlayerInputs({ state, dt }) {
  const active = state.started && !state.gameOver;
  deadShiftInputSession.simulateRoom({
    state,
    dtSec: dt,
    simulate: (player, inputState, fixedDtSec) => {
      stepDeadShiftPlayer(player, inputState, fixedDtSec, { active: active && player.connected });
      if (active) stepDeadShiftCombat(state, player, inputState, fixedDtSec);
    },
  });
}

/**
 * @param {{socket:import("socket.io").Socket,games:Map<string,DeadShiftServerState>,nsp:import("socket.io").Namespace}} options
 */
function requestDeadShiftRematch({ socket, games, nsp }) {
  const { gameId, playerId } = socket.data;
  const state = games.get(gameId);
  if (!state || !state.gameOver || !DEAD_SHIFT_PLAYER_IDS.includes(playerId) || !state.players[playerId].connected) return;
  state.rematchRequests[playerId] = true;
  emitEvent({ socket, gameId, type: SOCKET_EVENT.REMATCH_REQUESTED, payload: { playerId }, target: "others" });
  if (!DEAD_SHIFT_PLAYER_IDS.every((slotId) => state.players[slotId].connected && state.rematchRequests[slotId])) return;
  const nextState = createDeadShiftServerState();
  nextState.roundId = state.roundId + 1;
  for (const slotId of DEAD_SHIFT_PLAYER_IDS) {
    const previousPlayer = state.players[slotId];
    const nextPlayer = nextState.players[slotId];
    nextPlayer.connected = previousPlayer.connected;
    nextPlayer.rejoinToken = previousPlayer.rejoinToken;
    nextPlayer.inputEpoch = previousPlayer.inputEpoch;
    deadShiftInputSession.resetPlayer(nextPlayer);
  }
  scheduleDeadShiftStart(nextState);
  games.set(gameId, nextState);
  emitEvent({ nsp, gameId, type: SOCKET_EVENT.REMATCH_STARTED, target: "game" });
}

/**
 * Register authoritative gameplay through platform ownership, room scheduling and
 * snapshots. Game-owned helpers never duplicate SDK command/reconnect queues.
 * @param {import("socket.io").Server} io
 * @returns {ReturnType<typeof registerPluggableGame>}
 */
export function registerDeadShiftGame(io) {
  return registerPluggableGame({
    io,
    meta: deadShiftGameMeta,
    createState: createDeadShiftServerState,
    onPlayerConnected: connectDeadShiftPlayer,
    handleInput: receiveDeadShiftInput,
    handleDisconnect: disconnectDeadShiftPlayer,
    handleRematch: requestDeadShiftRematch,
    beforeUpdate: scheduleDeadShiftStart,
    systems: [
      { priority: -200, system: { name: "round-lifecycle", update: ({ state, nowMs }) => {
        state.lastUpdate = nowMs;
        if (!state.started && state.startAt !== null && nowMs >= state.startAt) {
          state.started = true;
          state.startAt = null;
        }
      } } },
      { priority: -100, system: { name: "player-input", update: stepDeadShiftPlayerInputs } },
      { priority: 0, system: { name: "shared-world", update: ({ state, dt }) => stepDeadShiftWorld(state, dt) } },
    ],
    shouldStep: ({ state }) => !state.gameOver,
    shouldCleanup: (state, nowMs) => state.abandonedAt !== null && nowMs - state.abandonedAt > ROOM_CLEANUP_DELAY_MS,
    serializeState: serializeDeadShiftState,
    tickMs: DEAD_SHIFT_FIXED_DT_SEC * 1000,
    dtFallback: DEAD_SHIFT_FIXED_DT_SEC,
  });
}
