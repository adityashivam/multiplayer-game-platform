import { getGameSocket } from "/platform/frontend-engine/gameSocket.js";
import { createGameRoomConnection } from "/platform/frontend-engine/gameRoomConnection.js";
import { createWorkerInterpolator } from "/platform/frontend-engine/interpolationWorker.js";
import { createNetworkedGameSession } from "/platform/frontend-engine/networkedGameSession.js";
import { updateConnectionState } from "/platform/frontend-engine/connectionBridge.js";
import { INPUT_PROTOCOL, SOCKET_EVENT } from "/platform/shared/networkProtocol.js";
import { RIFTBALL_FIXED_DT_SEC, RIFTBALL_GAME_ID } from "../shared/config.js";
import { createRiftballPredictionState, stepRiftballPrediction } from "../shared/prediction.js";
import { extractRiftballPositions, extractRiftballContinuityKeys, composeRiftballRenderPose, createRiftballLocalPresentation } from "./snapshotPose.js";

const INTERPOLATION_DELAY_MS = 65;
const MAX_SNAPSHOT_BUFFER_SIZE = 24;

/**
 * Adapt game-owned physics and poses to SDK room ownership, command prediction,
 * interpolation, recovery and diagnostics. The SDK owns acknowledgement/replay.
 * @param {{controls:object,onState:(snapshot:object,playerId:string|null)=>void,onReset:()=>void,onJoined:()=>void,onError:(message:string,retry:()=>void)=>void,onRematchRequested:()=>void}} options
 */
export function createRiftballMultiplayerSession(options) {
  const socket = getGameSocket(RIFTBALL_GAME_ID);
  const interpolator = createWorkerInterpolator({ extractPositions: extractRiftballPositions, extractContinuityKeys: extractRiftballContinuityKeys, interpDelayMs: INTERPOLATION_DELAY_MS, maxBufferSize: MAX_SNAPSHOT_BUFFER_SIZE });
  let roomConnection = null;
  let disposed = false;
  /** @type {import("./snapshotPose.js").RiftballLocalPresentation|null} */
  let localPresentation = null;
  const networkSession = createNetworkedGameSession({
    socket,
    interpolator,
    prediction: {
      fixedDtSec: RIFTBALL_FIXED_DT_SEC,
      captureInput: options.controls.capture,
      simulate: stepRiftballPrediction,
      extractPose(player) {
        return {
          x: player.x, y: player.y, z: player.z,
          facingSin: Math.sin(player.facing), facingCos: Math.cos(player.facing),
          ballX: player.previewBall.x, ballY: player.previewBall.y, ballZ: player.previewBall.z,
        };
      },
      maxSmoothingDistance: 1.2,
      correctionGroups: [
        { name: "athlete", fields: ["x", "y", "z"], maxSmoothingDistance: 1.2 },
        { name: "ball", fields: ["ballX", "ballY", "ballZ"], maxSmoothingDistance: 1.2 },
        { name: "facing", fields: ["facingSin", "facingCos"], maxSmoothingDistance: 3 },
      ],
    },
    readAuthority(snapshot) {
      const playerId = roomConnection?.getPlayerId();
      const player = snapshot.players?.[playerId];
      if (!player) return null;
      return {
        state: createRiftballPredictionState(snapshot, playerId),
        protocol: snapshot.inputProtocol ?? INPUT_PROTOCOL.QUEUED,
        inputEpoch: player.inputEpoch,
        acknowledgedSequence: player.inputSeqAck ?? 0,
        context: {
          active: snapshot.started && !snapshot.gameOver && ["playing", "overtime"].includes(snapshot.phase) && Object.values(snapshot.players).every((athlete) => athlete.connected),
          simulationTick: player.inputSimulationTick,
          continuityKey: `${snapshot.roundId}:${snapshot.ball.serveId}`,
          timeSec: snapshot.timeSec,
        },
      };
    },
    canCaptureInput: (snapshot) => Boolean(roomConnection?.getPlayerId() && !snapshot.gameOver),
    composeRenderPose(remote, local, snapshot, predictedState) {
      localPresentation = createRiftballLocalPresentation(predictedState);
      return composeRiftballRenderPose(remote, local, snapshot, roomConnection?.getPlayerId() || null, predictedState);
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
    gameId: RIFTBALL_GAME_ID, socket,
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
