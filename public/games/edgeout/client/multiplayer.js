import { getGameSocket } from "/platform/frontend-engine/gameSocket.js";
import { createGameRoomConnection } from "/platform/frontend-engine/gameRoomConnection.js";
import { createWorkerInterpolator } from "/platform/frontend-engine/interpolationWorker.js";
import { createNetworkedGameSession } from "/platform/frontend-engine/networkedGameSession.js";
import { updateConnectionState } from "/platform/frontend-engine/connectionBridge.js";
import { INPUT_PROTOCOL, SOCKET_EVENT } from "/platform/shared/networkProtocol.js";
import { EDGEOUT_FIXED_DT_SEC } from "../shared/config.js";
import { createEdgeoutPredictionState, stepEdgeoutPrediction } from "../shared/prediction.js";
import {
  composeEdgeoutRenderPose,
  createEdgeoutLocalPresentation,
  extractEdgeoutContinuityKeys,
  extractEdgeoutPositions,
} from "./snapshotPose.js";

const INTERPOLATION_DELAY_MS = 65;
const MAX_SNAPSHOT_BUFFER_SIZE = 24;
const MAX_SMOOTHING_DISTANCE = 1.2;
const FACING_SMOOTHING_DISTANCE = 3;

/**
 * Adapt Edgeout fighters to SDK room ownership, local prediction,
 * interpolation, recovery and diagnostics. The SDK owns acknowledgement and
 * replay; this adapter only maps game state.
 * @param {object} options
 * @param {string} options.gameId Registered mode ID; also its socket namespace.
 * @param {{capture:()=>import("../shared/config.js").EdgeoutInputState,reset:()=>void}} options.controls
 * @param {(snapshot:object,playerId:string|null)=>void} options.onState
 * @param {()=>void} options.onReset
 * @param {()=>void} options.onJoined
 * @param {(message:string,retry:()=>void)=>void} options.onError
 * @param {()=>void} options.onRematchRequested
 */
export function createEdgeoutMultiplayerSession(options) {
  const socket = getGameSocket(options.gameId);
  const interpolator = createWorkerInterpolator({
    extractPositions: extractEdgeoutPositions,
    extractContinuityKeys: extractEdgeoutContinuityKeys,
    interpDelayMs: INTERPOLATION_DELAY_MS,
    maxBufferSize: MAX_SNAPSHOT_BUFFER_SIZE,
  });
  /** @type {ReturnType<typeof createGameRoomConnection>|null} */
  let roomConnection = null;
  /** @type {import("./snapshotPose.js").EdgeoutLocalPresentation|null} */
  let localPresentation = null;
  let disposed = false;

  const networkSession = createNetworkedGameSession({
    socket,
    interpolator,
    prediction: {
      fixedDtSec: EDGEOUT_FIXED_DT_SEC,
      captureInput: options.controls.capture,
      simulate: stepEdgeoutPrediction,
      extractPose(fighter) {
        return {
          x: fighter.x,
          y: fighter.y,
          z: fighter.z,
          facingSin: Math.sin(fighter.facing),
          facingCos: Math.cos(fighter.facing),
        };
      },
      maxSmoothingDistance: MAX_SMOOTHING_DISTANCE,
      correctionGroups: [
        { name: "fighter", fields: ["x", "y", "z"], maxSmoothingDistance: MAX_SMOOTHING_DISTANCE },
        { name: "facing", fields: ["facingSin", "facingCos"], maxSmoothingDistance: FACING_SMOOTHING_DISTANCE },
      ],
    },
    readAuthority(snapshot) {
      const playerId = roomConnection?.getPlayerId();
      const fighter = snapshot.players?.[playerId];
      if (!fighter) return null;
      const humansConnected = Object.values(snapshot.players).every((player) => player.connected);
      return {
        state: createEdgeoutPredictionState(snapshot, playerId),
        protocol: snapshot.inputProtocol ?? INPUT_PROTOCOL.QUEUED,
        inputEpoch: fighter.inputEpoch,
        acknowledgedSequence: fighter.inputSeqAck ?? 0,
        context: {
          active: snapshot.started && !snapshot.gameOver && snapshot.phase === "playing" && humansConnected,
          simulationTick: fighter.inputSimulationTick,
          continuityKey: `${snapshot.matchId}:${snapshot.roundNumber}`,
        },
      };
    },
    canCaptureInput: (snapshot) => Boolean(roomConnection?.getPlayerId() && !snapshot.gameOver),
    composeRenderPose(remotePose, localPose, snapshot, predictedState) {
      localPresentation = createEdgeoutLocalPresentation(predictedState);
      return composeEdgeoutRenderPose(remotePose, localPose, snapshot, roomConnection?.getPlayerId() || null, predictedState);
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
  const cleanups = [
    socket.onConnectionChange(updateConnectionState),
    socket.onEvent(SOCKET_EVENT.STATE, (snapshot) => options.onState(snapshot, roomConnection?.getPlayerId() || null)),
  ];
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
    getStats: () => networkSession.getStats(),
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
