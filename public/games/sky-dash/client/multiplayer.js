import { getGameSocket } from "/platform/frontend-engine/gameSocket.js";
import { createGameRoomConnection } from "/platform/frontend-engine/gameRoomConnection.js";
import { createWorkerInterpolator } from "/platform/frontend-engine/interpolationWorker.js";
import { createNetworkedGameSession } from "/platform/frontend-engine/networkedGameSession.js";
import { updateConnectionState } from "/platform/frontend-engine/connectionBridge.js";
import { INPUT_PROTOCOL, SOCKET_EVENT } from "/platform/shared/networkProtocol.js";
import { SKY_DASH_FIXED_DT_SEC, SKY_DASH_GAME_ID } from "../shared/config.js";
import { stepSkyDashRunner } from "../shared/simulation.js";
import { extractSkyDashPositions, extractSkyDashContinuityKeys, stepSkyDashPrediction, composeSkyDashRenderPose } from "./snapshotPose.js";

const INTERPOLATION_DELAY_MS = 65;
const MAX_SNAPSHOT_BUFFER_SIZE = 24;

/**
 * Adapt pure runner movement to platform prediction; room ownership, input replay,
 * interpolation, diagnostics and reconnect orchestration stay in the SDK.
 * @param {{controls:{capture:()=>object,reset:()=>void},onState:(snapshot:object,playerId:string|null)=>void,onReset:()=>void,onJoined:()=>void,onError:(message:string,retry:()=>void)=>void,onRematchRequested:()=>void}} options
 */
export function createSkyDashMultiplayerSession(options) {
  const socket = getGameSocket(SKY_DASH_GAME_ID);
  const interpolator = createWorkerInterpolator({ extractPositions: extractSkyDashPositions, extractContinuityKeys: extractSkyDashContinuityKeys, interpDelayMs: INTERPOLATION_DELAY_MS, maxBufferSize: MAX_SNAPSHOT_BUFFER_SIZE });
  let roomConnection = null;
  let disposed = false;
  const networkSession = createNetworkedGameSession({
    socket,
    interpolator,
    prediction: {
      fixedDtSec: SKY_DASH_FIXED_DT_SEC,
      captureInput: options.controls.capture,
      simulate: (runner, input, dtSec, context) => stepSkyDashPrediction(runner, input, dtSec, context, stepSkyDashRunner),
      extractPose(runner) {
        const pose = { x: runner.x, y: runner.y, z: runner.z, courseTimeSec: runner.predictionTimeSec };
        for (const seesaw of runner.predictionSeesaws || []) pose[`seesaw.${seesaw.platformId}.angle`] = seesaw.angle;
        return pose;
      },
      maxSmoothingDistance: 1.2,
      correctionGroups: [
        { name: "runner", fields: ["x", "y", "z"], maxSmoothingDistance: 1.2 },
        { name: "course-clock", fields: ["courseTimeSec"], maxSmoothingDistance: 10 },
      ],
    },
    readAuthority(snapshot) {
      const playerState = snapshot.players?.[roomConnection?.getPlayerId()];
      if (!playerState) return null;
      return {
        state: { ...playerState, predictionTimeSec: snapshot.timeSec, predictionBaseSeesaws: snapshot.seesaws || [], predictionSeesawElapsedSec: 0, predictionSeesaws: snapshot.seesaws || [] },
        protocol: snapshot.inputProtocol ?? INPUT_PROTOCOL.QUEUED,
        inputEpoch: playerState.inputEpoch,
        acknowledgedSequence: playerState.inputSeqAck ?? 0,
        context: {
          active: snapshot.started && !snapshot.gameOver && Object.values(snapshot.players).every((runner) => runner.connected),
          simulationTick: playerState.inputSimulationTick,
          continuityKey: `${snapshot.roundId}:${playerState.respawnId}`,
          timeSec: snapshot.timeSec,
        },
      };
    },
    canCaptureInput: (snapshot) => Boolean(roomConnection?.getPlayerId() && !snapshot.gameOver),
    composeRenderPose(remotePose, localPose, snapshot) {
      return composeSkyDashRenderPose(remotePose, localPose, snapshot, roomConnection?.getPlayerId() || null);
    },
    onReset() {
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
    gameId: SKY_DASH_GAME_ID, socket,
    onJoined: options.onJoined,
    onError: options.onError,
    onRematchRequested: options.onRematchRequested,
  });

  return {
    captureAndPredict: () => networkSession.captureAndPredict(),
    samplePose: (options) => networkSession.samplePose(options),
    getSnapshot: () => networkSession.getLatestSnapshot(),
    getPlayerId: () => roomConnection.getPlayerId(),
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
