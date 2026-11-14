import { getGameSocket } from "/platform/frontend-engine/gameSocket.js";
import { createGameRoomConnection } from "/platform/frontend-engine/gameRoomConnection.js";
import { createWorkerInterpolator } from "/platform/frontend-engine/interpolationWorker.js";
import { createNetworkedGameSession } from "/platform/frontend-engine/networkedGameSession.js";
import { updateConnectionState } from "/platform/frontend-engine/connectionBridge.js";
import { INPUT_PROTOCOL } from "/platform/shared/networkProtocol.js";
import { LAST_FUSE_BOMB_SETTINGS, LAST_FUSE_FIXED_DT_SEC } from "../shared/config.js";
import { createLastFusePredictionState, stepLastFusePrediction } from "../shared/prediction.js";
import {
  composeLastFuseRenderPose,
  createLastFuseLocalPresentation,
  extractLastFuseContinuityKeys,
  extractLastFusePositions,
} from "./snapshotPose.js";

export const LAST_FUSE_INTERPOLATION_DELAY_MS = 70;
const MAX_SNAPSHOT_BUFFER_SIZE = 24;
const MAX_SMOOTHING_DISTANCE = 1.4;
const FACING_SMOOTHING_DISTANCE = 3;

/**
 * How far behind authority this runner sees rivals: interpolation delay plus
 * half the round trip, in fixed ticks. The server clamps it before use.
 * @param {{getConnectionSnapshot:()=>({ping?:number}|null)}} socket
 * @returns {number}
 */
export function measureLastFuseViewLagTicks(socket) {
  const ping = socket.getConnectionSnapshot()?.ping;
  const lagMs = LAST_FUSE_INTERPOLATION_DELAY_MS + (Number.isFinite(ping) ? ping / 2 : 0);
  return Math.max(0, Math.min(LAST_FUSE_BOMB_SETTINGS.maxViewLagTicks, Math.round(lagMs / (LAST_FUSE_FIXED_DT_SEC * 1000))));
}

/**
 * Adapt Last Fuse runners to SDK room ownership, local prediction,
 * interpolation, recovery and diagnostics. The SDK owns acknowledgement and
 * replay; this adapter only maps game state.
 * @param {object} options
 * @param {string} options.gameId Registered mode ID; also its socket namespace.
 * @param {{capture:(viewLagTicks:number)=>import("../shared/config.js").LastFuseInputState,reset:()=>void}} options.controls
 * @param {()=>void} options.onReset
 * @param {()=>void} options.onJoined
 * @param {(message:string,retry:()=>void)=>void} options.onError
 * @param {()=>void} options.onRematchRequested
 */
export function createLastFuseMultiplayerSession(options) {
  const socket = getGameSocket(options.gameId);
  const interpolator = createWorkerInterpolator({
    extractPositions: extractLastFusePositions,
    extractContinuityKeys: extractLastFuseContinuityKeys,
    interpDelayMs: LAST_FUSE_INTERPOLATION_DELAY_MS,
    maxBufferSize: MAX_SNAPSHOT_BUFFER_SIZE,
  });
  /** @type {ReturnType<typeof createGameRoomConnection>|null} */
  let roomConnection = null;
  /** @type {import("./snapshotPose.js").LastFuseLocalPresentation|null} */
  let localPresentation = null;
  let disposed = false;

  const networkSession = createNetworkedGameSession({
    socket,
    interpolator,
    prediction: {
      fixedDtSec: LAST_FUSE_FIXED_DT_SEC,
      captureInput: () => options.controls.capture(measureLastFuseViewLagTicks(socket)),
      simulate: stepLastFusePrediction,
      extractPose: (runner) => ({
        x: runner.x,
        y: runner.y,
        z: runner.z,
        facingSin: Math.sin(runner.facing),
        facingCos: Math.cos(runner.facing),
      }),
      maxSmoothingDistance: MAX_SMOOTHING_DISTANCE,
      correctionGroups: [
        { name: "runner", fields: ["x", "y", "z"], maxSmoothingDistance: MAX_SMOOTHING_DISTANCE },
        { name: "facing", fields: ["facingSin", "facingCos"], maxSmoothingDistance: FACING_SMOOTHING_DISTANCE },
      ],
    },
    readAuthority(snapshot) {
      const playerId = roomConnection?.getPlayerId();
      const runner = snapshot.players?.[playerId];
      if (!runner) return null;
      const humansConnected = Object.values(snapshot.players).every((player) => player.connected);
      return {
        state: createLastFusePredictionState(snapshot, playerId),
        protocol: snapshot.inputProtocol ?? INPUT_PROTOCOL.QUEUED,
        inputEpoch: runner.inputEpoch,
        acknowledgedSequence: runner.inputSeqAck ?? 0,
        context: {
          active: snapshot.started && !snapshot.gameOver && snapshot.phase === "playing" && humansConnected && !runner.eliminated && !runner.fallen,
          simulationTick: runner.inputSimulationTick,
          continuityKey: `${snapshot.matchId}:${snapshot.roundNumber}:${runner.respawnId}`,
        },
      };
    },
    canCaptureInput: (snapshot) => Boolean(roomConnection?.getPlayerId() && !snapshot.gameOver),
    composeRenderPose(remotePose, localPose, snapshot, predictedState) {
      localPresentation = createLastFuseLocalPresentation(predictedState);
      return composeLastFuseRenderPose(remotePose, localPose, snapshot, roomConnection?.getPlayerId() || null, predictedState);
    },
    onReset() {
      localPresentation = null;
      options.controls.reset();
      options.onReset();
    },
    onInputOwnershipReset: () => options.controls.reset(),
    onDiagnostics: updateConnectionState,
    diagnosticsIntervalMs: 200,
  });
  const cleanups = [socket.onConnectionChange(updateConnectionState)];
  roomConnection = createGameRoomConnection({
    gameId: options.gameId,
    socket,
    onJoined: options.onJoined,
    onError: options.onError,
    onRematchRequested: options.onRematchRequested,
  });

  return {
    captureAndPredict: () => networkSession.captureAndPredict(),
    samplePose: (sampleOptions) => networkSession.samplePose(sampleOptions),
    getSnapshot: () => networkSession.getLatestSnapshot(),
    getPlayerId: () => roomConnection.getPlayerId(),
    getLocalPresentation: () => localPresentation,
    requestRematch: () => roomConnection.requestRematch(),
    dispose() {
      if (disposed) return;
      disposed = true;
      roomConnection.dispose();
      cleanups.forEach((cleanup) => cleanup());
      networkSession.destroy();
      interpolator.destroy();
      socket.destroy();
      updateConnectionState({ status: "disconnected", ping: null });
    },
  };
}
