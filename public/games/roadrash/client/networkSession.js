import { createNetworkedGameSession } from "../../../platform/frontend-engine/networkedGameSession.js";
import { INPUT_PROTOCOL } from "../../../platform/shared/networkProtocol.js";
import {
  ROAD_RASH_FIXED_DT_SEC,
  ROAD_RASH_MOVEMENT_SETTINGS,
  readRoadRashProgress,
  splitRoadRashProgress,
  stepRoadRashRider,
} from "../shared/simulation.js";

/** @typedef {"p1"|"p2"} RoadRashPlayerId */
/** @typedef {import("../shared/simulation.js").RoadRashInputState} RoadRashInputState */
/**
 * @typedef {import("../shared/simulation.js").RoadRashRiderState & {
 *   integrity: number, connected: boolean, rank: number, kickSide: number,
 *   kickActive: boolean, inputEpoch: number, inputSeqAck: number, inputSimulationTick: number
 * }} RoadRashRiderSnapshot
 */
/**
 * @typedef {{id: string, type: "car", variant: number, x: number, z: number,
 *   progress: number, speed: number}} RoadRashTrafficSnapshot
 */
/**
 * @typedef {object} RoadRashSnapshot
 * @property {number} roundId
 * @property {1|2} inputProtocol
 * @property {{p1: RoadRashRiderSnapshot, p2: RoadRashRiderSnapshot}} players
 * @property {RoadRashTrafficSnapshot[]} traffic
 * @property {number} trackLength
 * @property {number} lapsRequired
 * @property {boolean} started
 * @property {number|null} startAt
 * @property {boolean} gameOver
 * @property {RoadRashPlayerId|"tie"|null} winner
 * @property {import("../../../platform/shared/networkProtocol.js").SnapshotNetworkMetadata} [net]
 */

/** @type {ReadonlyArray<RoadRashPlayerId>} */
const ROAD_RASH_PLAYER_IDS = Object.freeze(["p1", "p2"]);
const ROAD_RASH_MAX_SMOOTHING_DISTANCE = 0.65;

/**
 * Flatten only continuous coordinates. Server-supplied progress prevents lap or
 * traffic wraps from being mistaken for travel backwards around the entire course.
 * @param {RoadRashSnapshot} snapshot Borrowed; never mutated.
 * @returns {Record<string, number>} Dynamic traffic paths belong to this game's pose schema.
 */
export function extractRoadRashPositions(snapshot) {
  const positions = { roundId: snapshot.roundId };
  for (const playerId of ROAD_RASH_PLAYER_IDS) {
    const rider = snapshot.players[playerId];
    positions[`${playerId}x`] = rider.x;
    positions[`${playerId}progress`] = readRoadRashProgress(rider, snapshot.trackLength);
    positions[`${playerId}speed`] = rider.speed;
  }
  snapshot.traffic.forEach((traffic, index) => {
    positions[`t${index}x`] = traffic.x;
    positions[`t${index}progress`] = traffic.progress;
  });
  return positions;
}

/**
 * Advertise actual longitudinal velocities for bounded remote extrapolation.
 * Pauses and finishes must hold position even while a rider's engine coasts down.
 * @param {RoadRashSnapshot} snapshot
 * @returns {Record<string, number>}
 */
export function extractRoadRashVelocities(snapshot) {
  const velocities = {};
  const active = snapshot.started && !snapshot.gameOver;
  for (const playerId of ROAD_RASH_PLAYER_IDS) {
    const rider = snapshot.players[playerId];
    velocities[`${playerId}progress`] = active && rider.connected && !rider.finished ? rider.speed : 0;
  }
  snapshot.traffic.forEach((traffic, index) => {
    velocities[`t${index}progress`] = active ? traffic.speed : 0;
  });
  return velocities;
}

/**
 * Course resets are discontinuities; no rider or traffic segment crosses rounds.
 * @param {RoadRashSnapshot} snapshot
 * @returns {Record<string, number>}
 */
export function extractRoadRashContinuityKeys(snapshot) {
  const continuityKeys = {};
  for (const posePath of Object.keys(extractRoadRashPositions(snapshot))) {
    continuityKeys[posePath] = snapshot.roundId;
  }
  return continuityKeys;
}

/**
 * Apply a borrowed continuous pose to fresh render objects. Wrapped z and lap
 * counters are derived after interpolation, so a lap transition has one identity.
 * Combat animations, integrity and winner remain the snapshot's authoritative values.
 * @param {RoadRashSnapshot|null} snapshot
 * @param {Record<string, number>|null} pose
 * @returns {RoadRashSnapshot|null}
 */
export function buildRoadRashRenderState(snapshot, pose) {
  if (!snapshot) return null;

  const renderState = {
    ...snapshot,
    players: { p1: { ...snapshot.players.p1 }, p2: { ...snapshot.players.p2 } },
    traffic: snapshot.traffic.map((traffic) => ({ ...traffic })),
  };
  if (!pose || pose.roundId !== snapshot.roundId) return renderState;

  for (const playerId of ROAD_RASH_PLAYER_IDS) {
    const rider = renderState.players[playerId];
    const x = pose[`${playerId}x`];
    const speed = pose[`${playerId}speed`];
    const progress = pose[`${playerId}progress`];
    if (Number.isFinite(x)) rider.x = Math.max(-1.2, Math.min(1.2, x));
    if (Number.isFinite(speed)) rider.speed = Math.max(0, Math.min(ROAD_RASH_MOVEMENT_SETTINGS.MAX_SPEED, speed));
    if (Number.isFinite(progress)) {
      Object.assign(rider, splitRoadRashProgress(progress, snapshot.trackLength, snapshot.lapsRequired));
    }
  }
  renderState.traffic.forEach((traffic, index) => {
    const x = pose[`t${index}x`];
    const progress = pose[`t${index}progress`];
    if (Number.isFinite(x)) traffic.x = Math.max(-0.95, Math.min(0.95, x));
    if (Number.isFinite(progress)) {
      traffic.progress = progress;
      traffic.z = ((progress % snapshot.trackLength) + snapshot.trackLength) % snapshot.trackLength;
    }
  });
  return renderState;
}

/**
 * Supply game rules/mappings to the SDK. The SDK owns command sequences, epochs,
 * replay, bounded queues, recovery and correction offsets. The caller owns the
 * socket/interpolator and drives command capture at 60 Hz separately from rendering.
 * @param {object} options
 * @param {import("../../../platform/frontend-engine/networkedGameSession.js").NetworkedSessionSocket<RoadRashInputState>} options.socket
 * @param {import("../../../platform/frontend-engine/networkedGameSession.js").NetworkedSessionInterpolator<RoadRashSnapshot>} options.interpolator
 * @param {{capture: () => RoadRashInputState, reset: () => void}} options.inputLatch
 * @param {() => (RoadRashPlayerId|null)} options.getPlayerId
 * @param {(snapshot: RoadRashSnapshot) => boolean} [options.canCaptureInput]
 * @param {(resetOptions: {preserveSequence: boolean}) => void} [options.onReset]
 * @param {(stats: import("../../../platform/frontend-engine/networkedGameSession.js").NetworkedSessionStats) => void} [options.onDiagnostics]
 */
export function createRoadRashNetworkSession(options) {
  return createNetworkedGameSession({
    socket: options.socket,
    interpolator: options.interpolator,
    prediction: {
      fixedDtSec: ROAD_RASH_FIXED_DT_SEC,
      maxSmoothingDistance: ROAD_RASH_MAX_SMOOTHING_DISTANCE,
      captureInput: () => options.inputLatch.capture(),
      simulate: stepRoadRashRider,
      // Put normalized lane, lap and speed measures on comparable scales. A
      // world-unit progress delta must not hide a small but visible steering error.
      extractPose: (rider) => ({
        x: rider.x,
        progress: rider.progress / ROAD_RASH_MOVEMENT_SETTINGS.TRACK_LENGTH,
        speed: rider.speed / ROAD_RASH_MOVEMENT_SETTINGS.MAX_SPEED,
      }),
    },
    readAuthority: (snapshot) => {
      const playerId = options.getPlayerId();
      const rider = playerId ? snapshot.players[playerId] : null;
      return rider?.connected ? {
        state: rider,
        protocol: snapshot.inputProtocol ?? INPUT_PROTOCOL.QUEUED,
        inputEpoch: rider.inputEpoch,
        acknowledgedSequence: rider.inputSeqAck,
        context: {
          active: snapshot.started && !snapshot.gameOver,
          trackLength: snapshot.trackLength,
          lapsRequired: snapshot.lapsRequired,
          simulationTick: rider.inputSimulationTick,
          continuityKey: snapshot.roundId,
        },
      } : null;
    },
    canCaptureInput: (snapshot) => !snapshot.gameOver &&
      snapshot.players.p1.connected && snapshot.players.p2.connected &&
      (!options.canCaptureInput || options.canCaptureInput(snapshot)),
    composeRenderPose: (remotePose, localPose, snapshot) => {
      if (!snapshot) return null;
      const playerId = options.getPlayerId();
      const renderPose = remotePose?.roundId === snapshot.roundId
        ? { ...remotePose }
        : extractRoadRashPositions(snapshot);
      if (localPose && playerId) {
        renderPose[`${playerId}x`] = localPose.x;
        renderPose[`${playerId}progress`] = localPose.progress * ROAD_RASH_MOVEMENT_SETTINGS.TRACK_LENGTH;
        renderPose[`${playerId}speed`] = localPose.speed * ROAD_RASH_MOVEMENT_SETTINGS.MAX_SPEED;
      }
      return Object.keys(renderPose).length ? renderPose : null;
    },
    onReset: (resetOptions) => {
      options.inputLatch.reset();
      options.onReset?.(resetOptions);
    },
    onInputOwnershipReset: () => {
      options.inputLatch.reset();
      options.onReset?.({ preserveSequence: false });
    },
    onDiagnostics: options.onDiagnostics,
  });
}
