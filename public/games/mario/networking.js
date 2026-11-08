import { createNetworkedGameSession } from "../../platform/frontend-engine/networkedGameSession.js";
import { INPUT_PROTOCOL } from "../../platform/shared/networkProtocol.js";
import { MARIO_FIXED_DT_SEC, MARIO_PLAYER_IDS } from "./shared/config.js";
import { stepMarioPlayer } from "./shared/simulation.js";

/** @typedef {import("./shared/config.js").MarioInputState} MarioInputState */
/** @typedef {import("./shared/config.js").MarioPlayerId} MarioPlayerId */
/**
 * @typedef {import("./shared/simulation.js").MarioMovementState & {
 *   connected: boolean, finished: boolean, rank: number, hurtCooldown: number,
 *   movementEpoch: number, inputEpoch: number, inputSeqAck: number, inputSimulationTick: number
 * }} MarioPlayerSnapshot
 */
/**
 * @typedef {{id: string, type: "goomba"|"koopa", x: number, y: number, vx: number, vy: number,
 *   width: number, height: number, facing: number, alive: boolean, stomped: boolean}} MarioEnemySnapshot
 */
/**
 * @typedef {{players: {p1: MarioPlayerSnapshot, p2: MarioPlayerSnapshot}, enemies: MarioEnemySnapshot[],
 *   started: boolean, startAt: number|null, gameOver: boolean, winner: MarioPlayerId|"tie"|null,
 *   inputProtocol: 1|2, track: {worldWidth: number, groundY: number, finishX: number, background: string}
 * } & import("../../platform/shared/networkProtocol.js").SnapshotNetworkMetadata} MarioSnapshot
 */
/** @typedef {Record<string, number>} MarioPose */

/** @param {MarioSnapshot} snapshot @returns {MarioPose} */
function extractMarioPositions(snapshot) {
  const positions = {};
  for (const playerId of MARIO_PLAYER_IDS) {
    positions[`${playerId}x`] = snapshot.players[playerId].x;
    positions[`${playerId}y`] = snapshot.players[playerId].y;
  }
  snapshot.enemies.forEach((enemyState, index) => {
    positions[`e${index}x`] = enemyState.x;
    positions[`e${index}y`] = enemyState.y;
  });
  return positions;
}

/** @param {MarioSnapshot} snapshot @returns {MarioPose} */
function extractMarioVelocities(snapshot) {
  const velocities = {};
  for (const playerId of MARIO_PLAYER_IDS) {
    velocities[`${playerId}x`] = snapshot.players[playerId].vx;
    velocities[`${playerId}y`] = snapshot.players[playerId].vy;
  }
  snapshot.enemies.forEach((enemyState, index) => {
    velocities[`e${index}x`] = enemyState.vx;
    velocities[`e${index}y`] = enemyState.vy;
  });
  return velocities;
}

/** @param {MarioSnapshot} snapshot @returns {Record<string, string|number>} */
function extractMarioContinuityKeys(snapshot) {
  const continuityKeys = {};
  for (const playerId of MARIO_PLAYER_IDS) {
    continuityKeys[`${playerId}x`] = snapshot.players[playerId].movementEpoch;
    continuityKeys[`${playerId}y`] = snapshot.players[playerId].movementEpoch;
  }
  snapshot.enemies.forEach((enemyState, index) => {
    const enemyIdentity = `${enemyState.id}:${enemyState.alive}:${enemyState.stomped}`;
    continuityKeys[`e${index}x`] = enemyIdentity;
    continuityKeys[`e${index}y`] = enemyIdentity;
  });
  return continuityKeys;
}

/** Return the same pose and discontinuity mappings to worker and direct playback. */
export function createMarioInterpolationOptions() {
  return {
    extractPositions: extractMarioPositions,
    extractVelocities: extractMarioVelocities,
    extractContinuityKeys: extractMarioContinuityKeys,
    interpDelayMs: 42,
    maxBufferSize: 32,
  };
}

/**
 * Compose a render-owned state without changing authority or borrowed SDK poses.
 * Only the local movement animation follows prediction; ranks, finishes, enemies
 * and hurt outcomes remain authoritative.
 * @param {MarioPose|null} remotePose
 * @param {MarioPose|null} localPose
 * @param {MarioSnapshot|null} snapshot
 * @param {MarioPlayerSnapshot|null} predictedPlayer
 * @param {MarioPlayerId|null} playerId
 * @returns {MarioSnapshot|null}
 */
function composeMarioRenderState(remotePose, localPose, snapshot, predictedPlayer, playerId) {
  if (!snapshot) return null;
  const renderState = {
    ...snapshot,
    players: { p1: { ...snapshot.players.p1 }, p2: { ...snapshot.players.p2 } },
    enemies: snapshot.enemies.map((enemyState) => ({ ...enemyState })),
  };
  for (const slotId of MARIO_PLAYER_IDS) {
    if (Number.isFinite(remotePose?.[`${slotId}x`])) renderState.players[slotId].x = remotePose[`${slotId}x`];
    if (Number.isFinite(remotePose?.[`${slotId}y`])) renderState.players[slotId].y = remotePose[`${slotId}y`];
  }
  renderState.enemies.forEach((enemyState, index) => {
    if (Number.isFinite(remotePose?.[`e${index}x`])) enemyState.x = remotePose[`e${index}x`];
    if (Number.isFinite(remotePose?.[`e${index}y`])) enemyState.y = remotePose[`e${index}y`];
  });
  if (playerId && localPose && predictedPlayer) {
    Object.assign(renderState.players[playerId], {
      x: localPose.x,
      y: localPose.y,
      vx: predictedPlayer.vx,
      vy: predictedPlayer.vy,
      onGround: predictedPlayer.onGround,
      facing: predictedPlayer.facing,
      jumpHeld: predictedPlayer.jumpHeld,
    });
  }
  return renderState;
}

/**
 * Bind Mario's pure movement and snapshot schema to the platform network SDK.
 * The platform owns delivery, epochs, acknowledgement/replay and correction
 * smoothing. The caller owns controls, the socket/interpolator and presentation.
 * @param {object} options
 * @param {import("../../platform/frontend-engine/networkedGameSession.js").NetworkedSessionSocket<MarioInputState>} options.socket
 * @param {import("../../platform/frontend-engine/networkedGameSession.js").NetworkedSessionInterpolator<MarioSnapshot>} options.interpolator
 * @param {() => MarioInputState} options.captureInput Returns an owned input copy.
 * @param {() => (MarioPlayerId|null)} options.getPlayerId
 * @param {(snapshot: MarioSnapshot) => boolean} [options.canCaptureInput]
 * @param {() => void} [options.onReset]
 * @param {() => void} [options.onInputOwnershipReset] Clear controls when authority changes input ownership.
 * @param {(sessionStats: import("../../platform/frontend-engine/networkedGameSession.js").NetworkedSessionStats) => void} [options.onDiagnostics]
 */
export function createMarioNetworkSession(options) {
  return createNetworkedGameSession({
    socket: options.socket,
    interpolator: options.interpolator,
    prediction: {
      fixedDtSec: MARIO_FIXED_DT_SEC,
      captureInput: options.captureInput,
      simulate: (playerState, inputState, dtSec, context) => stepMarioPlayer(playerState, inputState, dtSec, {
        active: context.active && playerState.connected && !playerState.finished,
      }),
      extractPose: (playerState) => ({ x: playerState.x, y: playerState.y }),
      maxSmoothingDistance: 72,
    },
    readAuthority: (snapshot) => {
      const playerId = options.getPlayerId();
      const playerState = playerId ? snapshot.players[playerId] : null;
      return playerState ? {
        state: playerState,
        protocol: snapshot.inputProtocol ?? INPUT_PROTOCOL.LEGACY,
        inputEpoch: playerState.inputEpoch,
        acknowledgedSequence: playerState.inputSeqAck ?? 0,
        context: {
          simulationTick: playerState.inputSimulationTick,
          continuityKey: playerState.movementEpoch,
          active: snapshot.started && !snapshot.gameOver,
        },
      } : null;
    },
    canCaptureInput: options.canCaptureInput,
    composeRenderPose: (remotePose, localPose, snapshot, predictedPlayer) =>
      composeMarioRenderState(remotePose, localPose, snapshot, predictedPlayer, options.getPlayerId()),
    onReset: options.onReset,
    onInputOwnershipReset: options.onInputOwnershipReset,
    onDiagnostics: options.onDiagnostics,
  });
}
