import { ROOM_START_COUNTDOWN_MS } from "../../../public/platform/shared/roomLifecycle.js";
import { roadRashGameMeta } from "./metadata.js";
import { emitEvent, registerPluggableGame, scheduleStart } from "../core/index.js";
import { createAuthoritativeInputSession } from "../core/authoritativeInputSession.js";
import { INPUT_PROTOCOL, SOCKET_EVENT } from "../../../public/platform/shared/networkProtocol.js";
import {
  ROAD_RASH_EDGE_INPUT_KEYS,
  ROAD_RASH_FIXED_DT_SEC,
  ROAD_RASH_INPUT_TEMPLATE,
  ROAD_RASH_MOVEMENT_SETTINGS,
  readRoadRashProgress,
  stepRoadRashRider,
} from "../../../public/games/roadrash/shared/simulation.js";

const COUNTDOWN_MS = ROOM_START_COUNTDOWN_MS;
const ROOM_CLEANUP_DELAY_MS = 30000;

const { TRACK_LENGTH, TARGET_LAPS, MAX_SPEED } = ROAD_RASH_MOVEMENT_SETTINGS;

const KICK_COOLDOWN_SEC = 0.7;
const KICK_ACTIVE_SEC = 0.18;
const KICK_RANGE_Z = 1500;
const KICK_RANGE_X = 0.45;
const KICK_SIDE_TOLERANCE_X = 0.2;
const KICK_DAMAGE = 16;
const KICK_SPEED_MULT = 0.62;
const MIN_KICK_SPEED = MAX_SPEED * 0.08;

const TRAFFIC_COUNT = 18;
const TRAFFIC_COLLISION_RANGE_Z = 520;
const TRAFFIC_COLLISION_RANGE_X = 0.2;
const TRAFFIC_DAMAGE = 10;
const TRAFFIC_SPEED_MULT = 0.48;
const TRAFFIC_MIN_SPEED = MAX_SPEED * 0.32;
const TRAFFIC_MAX_SPEED = MAX_SPEED * 0.66;

const START_LANE = {
  p1: -0.28,
  p2: 0.28,
};

/** @typedef {"p1"|"p2"} RoadRashPlayerId */
/** @typedef {import("../../../public/games/roadrash/shared/simulation.js").RoadRashInputState} RoadRashInputState */
/**
 * @typedef {import("../../../public/games/roadrash/shared/simulation.js").RoadRashRiderState &
 * import("../core/authoritativeInputSession.js").AuthoritativePlayerInputState<keyof RoadRashInputState> & {
 *   integrity: number, connected: boolean, finishMs: number|null, rank: number,
 *   kickCooldown: number, kickTimer: number, kickSide: number,
 *   kickHitThisSwing: boolean, collisionCooldown: number, rejoinToken?: string|null
 * }} RoadRashServerRiderState
 */
/**
 * @typedef {{id:string,type:"car",variant:number,x:number,z:number,progress:number,speed:number,phase:number}} RoadRashTrafficState
 * @typedef {import("../core/authoritativeInputSession.js").AuthoritativeInputRoom<RoadRashPlayerId,RoadRashServerRiderState> & {
 *   roundId:number,traffic:RoadRashTrafficState[],trackLength:number,lapsRequired:number,
 *   started:boolean,startAt:number|null,gameOver:boolean,winner:RoadRashPlayerId|"tie"|null,
 *   rematchRequests:{p1:boolean,p2:boolean},lastUpdate:number,abandonedAt:number|null
 * }} RoadRashServerState
 */

/** @type {ReadonlyArray<RoadRashPlayerId>} */
const ROAD_RASH_PLAYER_IDS = Object.freeze(["p1", "p2"]);
const roadRashInputSession = createAuthoritativeInputSession({
  inputTemplate: ROAD_RASH_INPUT_TEMPLATE,
  edgeKeys: ROAD_RASH_EDGE_INPUT_KEYS,
  fixedDtSec: ROAD_RASH_FIXED_DT_SEC,
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function wrap(value, max) {
  if (!Number.isFinite(max) || max <= 0) return value;
  let out = value;
  while (out >= max) out -= max;
  while (out < 0) out += max;
  return out;
}

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function randomChoice(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * @param {number} startLane
 * @returns {RoadRashServerRiderState}
 */
function makePlayer(startLane) {
  return {
    x: startLane,
    z: 0,
    progress: 0,
    lapsCompleted: 0,
    speed: 0,
    integrity: 100,
    connected: false,
    finished: false,
    finishMs: null,
    rank: 2,
    kickCooldown: 0,
    kickTimer: 0,
    kickSide: 0,
    kickHitThisSwing: false,
    collisionCooldown: 0,
    input: { ...ROAD_RASH_INPUT_TEMPLATE },
    inputEpoch: 0,
    inputSimulationTick: 0,
    lastInputSeqAck: 0,
  };
}

/**
 * @param {string} id
 * @param {number} z
 * @returns {RoadRashTrafficState}
 */
function makeTraffic(id, z) {
  // Keep only two bikes in the race (local + opponent). AI traffic is cars only.
  const type = "car";
  return {
    id,
    type,
    variant: randomChoice([0, 1]),
    x: randomRange(-0.88, 0.88),
    z,
    progress: z,
    speed: randomRange(TRAFFIC_MIN_SPEED, TRAFFIC_MAX_SPEED),
    phase: randomRange(0, Math.PI * 2),
  };
}

function createTrafficField() {
  const traffic = [];
  const spacing = TRACK_LENGTH / TRAFFIC_COUNT;
  for (let i = 0; i < TRAFFIC_COUNT; i += 1) {
    const jitter = randomRange(-spacing * 0.35, spacing * 0.35);
    const z = wrap(i * spacing + jitter + TRACK_LENGTH * 0.08, TRACK_LENGTH);
    traffic.push(makeTraffic(`t${i}`, z));
  }
  return traffic;
}

/** @returns {RoadRashServerState} */
function createInitialGameState() {
  return {
    roundId: 1,
    players: {
      p1: makePlayer(START_LANE.p1),
      p2: makePlayer(START_LANE.p2),
    },
    traffic: createTrafficField(),
    trackLength: TRACK_LENGTH,
    lapsRequired: TARGET_LAPS,
    started: false,
    startAt: null,
    gameOver: false,
    winner: null,
    rematchRequests: { p1: false, p2: false },
    lastUpdate: Date.now(),
    abandonedAt: null,
  };
}

function scheduleRoadRashStart(state) {
  scheduleStart(state, COUNTDOWN_MS);
}

function syncStartState(state, nowMs) {
  if (!state.started && state.startAt && nowMs >= state.startAt) {
    state.started = true;
    state.startAt = null;
  }
}

function isRaceActive(state) {
  return Boolean(state.started && !state.gameOver);
}

function progressOf(player, trackLength = TRACK_LENGTH) {
  return readRoadRashProgress(player, trackLength);
}

function tickKickState(player, dt) {
  if (player.kickCooldown > 0) {
    player.kickCooldown = Math.max(0, player.kickCooldown - dt);
  }

  if (player.kickTimer > 0) {
    player.kickTimer = Math.max(0, player.kickTimer - dt);
    if (player.kickTimer === 0) {
      player.kickSide = 0;
      player.kickHitThisSwing = false;
    }
  }
}

function maybeStartKick(player, inputState) {
  const wantsLeftKick = Boolean(inputState.kickLeft);
  const wantsRightKick = Boolean(inputState.kickRight);

  if (!wantsLeftKick && !wantsRightKick) return;
  if (player.kickCooldown > 0) return;
  if (player.speed < MIN_KICK_SPEED) return;

  player.kickCooldown = KICK_COOLDOWN_SEC;
  player.kickTimer = KICK_ACTIVE_SEC;
  player.kickSide = wantsLeftKick ? -1 : 1;
  player.kickHitThisSwing = false;
}

/** @param {{state:RoadRashServerState,nowMs:number}} context */
function runStartTransitionSystem({ state, nowMs }) {
  state.lastUpdate = nowMs;
  syncStartState(state, nowMs);
}

/** @param {{state:RoadRashServerState,dt:number}} context */
function runPlayerSystem({ state, dt }) {
  const raceActive = isRaceActive(state);
  const trackLength = state.trackLength || TRACK_LENGTH;
  const lapsRequired = state.lapsRequired || TARGET_LAPS;

  roadRashInputSession.simulateRoom({
    state,
    dtSec: dt,
    simulate: (player, inputState, fixedDtSec, _playerId, inputFrame) => {
      tickKickState(player, fixedDtSec);
      const hasKickImpulse = inputFrame !== null || player.inputProtocol !== INPUT_PROTOCOL.QUEUED;
      if (raceActive && player.connected && !player.finished && hasKickImpulse) {
        maybeStartKick(player, inputState);
      }
      // Kicks are one-shot impulses; a rejected press must not start next step
      // merely because held throttle subsequently crosses the minimum speed.
      player.input.kickLeft = false;
      player.input.kickRight = false;

      if (player.collisionCooldown > 0) {
        player.collisionCooldown = Math.max(0, player.collisionCooldown - fixedDtSec);
      }

      stepRoadRashRider(player, inputState, fixedDtSec, {
        active: raceActive && player.connected,
        trackLength,
        lapsRequired,
      });
      if (player.finished && !Number.isFinite(player.finishMs)) {
        player.finishMs = Date.now();
      }
    },
  });
}

function runTrafficSystem({ state, dt, nowMs }) {
  if (!isRaceActive(state)) return;

  for (let i = 0; i < state.traffic.length; i += 1) {
    const item = state.traffic[i];
    const wobble = Math.sin(nowMs / 1000 + item.phase) * 0.06;
    item.x = clamp(item.x + wobble * dt, -0.92, 0.92);
    item.progress = (Number.isFinite(item.progress) ? item.progress : item.z) + item.speed * dt;
    item.z = wrap(item.progress, state.trackLength || TRACK_LENGTH);
  }
}

function resolveKick(attacker, defender) {
  if (attacker.kickTimer <= 0) return;
  if (attacker.kickHitThisSwing) return;

  const zGap = Math.abs(progressOf(attacker) - progressOf(defender));
  if (zGap > KICK_RANGE_Z) return;

  const relativeX = defender.x - attacker.x;
  const xGap = Math.abs(relativeX);
  if (xGap > KICK_RANGE_X) return;

  if (attacker.kickSide < 0 && relativeX > KICK_SIDE_TOLERANCE_X) return;
  if (attacker.kickSide > 0 && relativeX < -KICK_SIDE_TOLERANCE_X) return;

  defender.speed *= KICK_SPEED_MULT;
  defender.integrity = clamp(defender.integrity - KICK_DAMAGE, 0, 100);
  defender.x = clamp(defender.x + attacker.kickSide * 0.16, -1.2, 1.2);
  attacker.kickHitThisSwing = true;
}

function trafficDeltaZ(playerZ, trafficZ) {
  const wrappedPlayerZ = wrap(playerZ, TRACK_LENGTH);
  let dz = trafficZ - wrappedPlayerZ;
  if (dz < -TRACK_LENGTH / 2) dz += TRACK_LENGTH;
  if (dz > TRACK_LENGTH / 2) dz -= TRACK_LENGTH;
  return dz;
}

function runCollisionSystem({ state }) {
  if (!isRaceActive(state)) return;

  const p1 = state.players.p1;
  const p2 = state.players.p2;

  resolveKick(p1, p2);
  resolveKick(p2, p1);

  for (const player of [p1, p2]) {
    if (player.finished || player.collisionCooldown > 0) continue;

    for (let i = 0; i < state.traffic.length; i += 1) {
      const traffic = state.traffic[i];
      const dz = Math.abs(trafficDeltaZ(player.z, traffic.z));
      if (dz > TRAFFIC_COLLISION_RANGE_Z) continue;
      if (Math.abs(player.x - traffic.x) > TRAFFIC_COLLISION_RANGE_X) continue;

      player.speed *= TRAFFIC_SPEED_MULT;
      player.integrity = clamp(player.integrity - TRAFFIC_DAMAGE, 0, 100);
      player.collisionCooldown = 0.18;
      player.x = clamp(player.x + (player.x <= traffic.x ? -0.12 : 0.12), -1.2, 1.2);
      break;
    }
  }
}

function updateRanks(state) {
  const standings = [
    { id: "p1", player: state.players.p1 },
    { id: "p2", player: state.players.p2 },
  ];
  const trackLength = state.trackLength || TRACK_LENGTH;

  standings.sort((a, b) => {
    if (a.player.finished && b.player.finished) {
      return (a.player.finishMs || Infinity) - (b.player.finishMs || Infinity);
    }
    if (a.player.finished && !b.player.finished) return -1;
    if (!a.player.finished && b.player.finished) return 1;
    return progressOf(b.player, trackLength) - progressOf(a.player, trackLength);
  });

  standings.forEach((entry, index) => {
    entry.player.rank = index + 1;
  });
}

function decideWinner(state) {
  if (state.gameOver) return;

  const { p1, p2 } = state.players;

  if (!p1.finished && !p2.finished) return;

  state.gameOver = true;
  if (p1.finished && p2.finished) {
    if ((p1.finishMs || Infinity) < (p2.finishMs || Infinity)) state.winner = "p1";
    else if ((p2.finishMs || Infinity) < (p1.finishMs || Infinity)) state.winner = "p2";
    else state.winner = "tie";
  } else {
    state.winner = p1.finished ? "p1" : "p2";
  }
}

function runRaceRulesSystem({ state }) {
  if (state.gameOver) return;

  updateRanks(state);
  decideWinner(state);
}

/** @param {RoadRashServerRiderState} player */
function serializeRoadRashPlayerState(player) {
  return {
    x: player.x,
    z: player.z,
    progress: player.progress,
    lapsCompleted: player.lapsCompleted,
    speed: player.speed,
    integrity: player.integrity,
    connected: player.connected,
    finished: player.finished,
    rank: player.rank,
    kickSide: player.kickSide,
    kickActive: player.kickTimer > 0,
    ...roadRashInputSession.getPlayerSnapshotMetadata(player),
  };
}

/**
 * Return owned presentation fields and SDK input metadata; never expose command buffers.
 * @param {RoadRashServerState} state Borrowed authoritative room; never mutated.
 * @returns {import("../../../public/games/roadrash/client/networkSession.js").RoadRashSnapshot}
 */
export function serializeRoadRashState(state) {
  return {
    roundId: state.roundId,
    inputProtocol: INPUT_PROTOCOL.QUEUED,
    players: {
      p1: serializeRoadRashPlayerState(state.players.p1),
      p2: serializeRoadRashPlayerState(state.players.p2),
    },
    traffic: state.traffic.map((item) => ({
      id: item.id,
      type: item.type,
      variant: item.variant,
      x: item.x,
      z: item.z,
      progress: item.progress,
      speed: item.speed,
    })),
    trackLength: state.trackLength,
    lapsRequired: state.lapsRequired,
    started: state.started,
    startAt: state.startAt,
    gameOver: state.gameOver,
    winner: state.winner,
  };
}

function createRoadRashSystems() {
  return [
    { priority: -160, system: { name: "start-transition", update: runStartTransitionSystem } },
    { priority: -100, system: { name: "players", update: runPlayerSystem } },
    { priority: -40, system: { name: "traffic", update: runTrafficSystem } },
    { priority: -10, system: { name: "collisions", update: runCollisionSystem } },
    { priority: 10, system: { name: "race-rules", update: runRaceRulesSystem } },
  ];
}

function resetRaceStateInPlace(state, { keepConnections = true } = {}) {
  const nextState = createInitialGameState();
  nextState.roundId = (state.roundId || 0) + 1;
  for (const playerId of ROAD_RASH_PLAYER_IDS) {
    const previousPlayer = state.players[playerId];
    const nextPlayer = nextState.players[playerId];
    nextPlayer.inputEpoch = previousPlayer.inputEpoch;
    roadRashInputSession.resetPlayer(nextPlayer);
    if (keepConnections) {
      nextPlayer.connected = previousPlayer.connected;
      nextPlayer.rejoinToken = previousPlayer.rejoinToken || null;
    }
  }

  state.roundId = nextState.roundId;
  state.players = nextState.players;
  state.traffic = nextState.traffic;
  state.trackLength = nextState.trackLength;
  state.lapsRequired = nextState.lapsRequired;
  state.started = nextState.started;
  state.startAt = nextState.startAt;
  state.gameOver = nextState.gameOver;
  state.winner = nextState.winner;
  state.rematchRequests = nextState.rematchRequests;
  state.lastUpdate = nextState.lastUpdate;
  state.abandonedAt = null;
}

/**
 * Register shared rider movement while keeping traffic, combat and results on the server.
 * @param {import("socket.io").Server} io
 * @returns {ReturnType<typeof registerPluggableGame>}
 */
export function registerRoadRashGame(io) {
  return registerPluggableGame({
    io,
    meta: roadRashGameMeta,
    createState: createInitialGameState,
    systems: createRoadRashSystems(),
    shouldStep: ({ state }) => !state.gameOver,
    onPlayerConnected: (state, playerId) => {
      state.players[playerId].connected = true;
      state.abandonedAt = null;
      // If a player joins via room link after a finished match, auto-reset so race can start immediately.
      if (state.gameOver) {
        resetRaceStateInPlace(state, { keepConnections: true });
      } else {
        roadRashInputSession.resetPlayer(state.players[playerId]);
      }
      scheduleRoadRashStart(state);
    },
    handleInput: ({ state, playerId, payload }) => {
      roadRashInputSession.receiveInput(state.players[playerId], payload);
    },
    handleDisconnect: (state, playerId) => {
      state.players[playerId].connected = false;
      const otherPlayerId = playerId === "p1" ? "p2" : "p1";
      const bothDisconnected = !state.players[otherPlayerId].connected;

      // A pause invalidates both command streams, including the connected rider's
      // held throttle and any late kick pulse. Race progress and seat tokens survive.
      for (const rider of Object.values(state.players)) {
        roadRashInputSession.resetPlayer(rider);
        rider.kickTimer = 0;
        rider.kickSide = 0;
        rider.kickHitThisSwing = false;
      }
      state.started = false;
      state.startAt = null;
      state.rematchRequests = { p1: false, p2: false };
      state.abandonedAt = bothDisconnected ? Date.now() : null;
    },
    handleRematch: ({ socket, games, nsp }) => {
      const { gameId, playerId } = socket.data;
      if (!gameId || !playerId) return;
      const state = games.get(gameId);
      if (!state || !state.players?.[playerId]) return;

      if (!state.rematchRequests) {
        state.rematchRequests = { p1: false, p2: false };
      }
      state.rematchRequests[playerId] = true;
      emitEvent({ socket, gameId, type: SOCKET_EVENT.REMATCH_REQUESTED, payload: { playerId }, target: "others" });

      const bothReady =
        state.players.p1.connected &&
        state.players.p2.connected &&
        state.rematchRequests.p1 &&
        state.rematchRequests.p2;
      if (!bothReady) return;

      const nextState = createInitialGameState();
      nextState.roundId = state.roundId + 1;
      for (const slotId of ROAD_RASH_PLAYER_IDS) {
        const previousPlayer = state.players[slotId];
        const nextPlayer = nextState.players[slotId];
        nextPlayer.connected = previousPlayer.connected;
        nextPlayer.rejoinToken = previousPlayer.rejoinToken || null;
        nextPlayer.inputEpoch = previousPlayer.inputEpoch;
        roadRashInputSession.resetPlayer(nextPlayer);
      }
      games.set(gameId, nextState);
      emitEvent({ nsp, gameId, type: SOCKET_EVENT.REMATCH_STARTED, target: "game" });
    },
    beforeUpdate: scheduleRoadRashStart,
    shouldCleanup: (state, now) => {
      if (!state.abandonedAt) return false;
      return now - state.abandonedAt > ROOM_CLEANUP_DELAY_MS;
    },
    serializeState: serializeRoadRashState,
    dtFallback: ROAD_RASH_FIXED_DT_SEC,
    tickMs: ROAD_RASH_FIXED_DT_SEC * 1000,
  });
}
