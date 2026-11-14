import { getGameSocket } from "/platform/frontend-engine/gameSocket.js";
import { createGameRoomConnection } from "/platform/frontend-engine/gameRoomConnection.js";
import { createWorkerInterpolator } from "/platform/frontend-engine/interpolationWorker.js";
import { createNetworkedGameSession } from "/platform/frontend-engine/networkedGameSession.js";
import { updateConnectionState } from "/platform/frontend-engine/connectionBridge.js";
import { INPUT_PROTOCOL, SOCKET_EVENT } from "/platform/shared/networkProtocol.js";
import { DRIFTLINE_FIXED_DT_SEC } from "../shared/config.js";
import { createDriftlinePredictionState, stepDriftlinePrediction } from "../shared/prediction.js";
import {
  composeDriftlineRenderPose,
  createDriftlineLocalPresentation,
  extractDriftlineContinuityKeys,
  extractDriftlinePositions,
} from "./snapshotPose.js";

const INTERPOLATION_DELAY_MS = 80;
const MAX_SNAPSHOT_BUFFER_SIZE = 24;
/** Cars cover over a metre per tick at speed, so small corrections smooth further. */
const POSITION_SMOOTHING_M = 3;
const HEADING_SMOOTHING = 0.6;

/**
 * Adapt Driftline cars to SDK room ownership, local prediction,
 * interpolation, recovery and diagnostics.
 * @param {object} options
 * @param {string} options.gameId Registered mode ID; also its namespace.
 * @param {{capture:()=>import("../shared/config.js").DriftlineInputState,reset:()=>void}} options.controls
 * @param {()=>void} options.onReset
 * @param {()=>void} options.onJoined
 * @param {(message:string,retry:()=>void)=>void} options.onError
 * @param {()=>void} options.onRematchRequested
 */
export function createDriftlineMultiplayerSession(options) {
  const socket = getGameSocket(options.gameId);
  const interpolator = createWorkerInterpolator({
    extractPositions: extractDriftlinePositions,
    extractContinuityKeys: extractDriftlineContinuityKeys,
    interpDelayMs: INTERPOLATION_DELAY_MS,
    maxBufferSize: MAX_SNAPSHOT_BUFFER_SIZE,
  });
  /** @type {ReturnType<typeof createGameRoomConnection>|null} */
  let roomConnection = null;
  /** @type {import("./snapshotPose.js").DriftlineLocalPresentation|null} */
  let localPresentation = null;
  let disposed = false;

  const networkSession = createNetworkedGameSession({
    socket,
    interpolator,
    prediction: {
      fixedDtSec: DRIFTLINE_FIXED_DT_SEC,
      captureInput: options.controls.capture,
      simulate: stepDriftlinePrediction,
      extractPose(car) {
        return { x: car.x, y: car.y, z: car.z, yawSin: Math.sin(car.yaw), yawCos: Math.cos(car.yaw) };
      },
      maxSmoothingDistance: POSITION_SMOOTHING_M,
      correctionGroups: [
        { name: "car", fields: ["x", "y", "z"], maxSmoothingDistance: POSITION_SMOOTHING_M },
        { name: "heading", fields: ["yawSin", "yawCos"], maxSmoothingDistance: HEADING_SMOOTHING },
      ],
    },
    readAuthority(snapshot) {
      const playerId = roomConnection?.getPlayerId();
      const car = snapshot.players?.[playerId];
      if (!car) return null;
      const humansConnected = Object.values(snapshot.players).every((player) => player.connected);
      return {
        state: createDriftlinePredictionState(snapshot, playerId),
        protocol: snapshot.inputProtocol ?? INPUT_PROTOCOL.QUEUED,
        inputEpoch: car.inputEpoch,
        acknowledgedSequence: car.inputSeqAck ?? 0,
        context: {
          active: snapshot.started && !snapshot.gameOver && snapshot.phase === "racing" && humansConnected,
          simulationTick: car.inputSimulationTick,
          continuityKey: `${snapshot.matchId}:${car.respawnId}`,
        },
      };
    },
    canCaptureInput: (snapshot) => Boolean(roomConnection?.getPlayerId() && !snapshot.gameOver),
    composeRenderPose(remotePose, localPose, snapshot, predictedState) {
      localPresentation = createDriftlineLocalPresentation(predictedState);
      return composeDriftlineRenderPose(remotePose, localPose, snapshot, roomConnection?.getPlayerId() || null, predictedState);
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
