import { getGameSocket } from "/platform/frontend-engine/gameSocket.js";
import { createGameRoomConnection } from "/platform/frontend-engine/gameRoomConnection.js";
import { createWorkerInterpolator } from "/platform/frontend-engine/interpolationWorker.js";
import { createNetworkedGameSession } from "/platform/frontend-engine/networkedGameSession.js";
import { updateConnectionState } from "/platform/frontend-engine/connectionBridge.js";
import { INPUT_PROTOCOL } from "/platform/shared/networkProtocol.js";
import { SKYBREAK_COMBAT_SETTINGS, SKYBREAK_FIXED_DT_SEC } from "../shared/config.js";
import { createSkybreakPredictionState, stepSkybreakPrediction } from "../shared/prediction.js";
import {
  composeSkybreakRenderPose,
  createSkybreakLocalPresentation,
  extractSkybreakContinuityKeys,
  extractSkybreakPositions,
} from "./snapshotPose.js";

export const SKYBREAK_INTERPOLATION_DELAY_MS = 80;
const MAX_SNAPSHOT_BUFFER_SIZE = 24;
/** Jets cover over three metres per tick; larger corrections still smooth. */
const POSITION_SMOOTHING_M = 8;
const ORIENTATION_SMOOTHING = 0.5;

/**
 * How far behind authority this pilot sees rivals: interpolation delay plus
 * half the round trip, in fixed ticks. The server clamps it before use.
 * @param {{getConnectionSnapshot:()=>({ping?:number}|null)}} socket
 */
function measureSkybreakViewLagTicks(socket) {
  const ping = socket.getConnectionSnapshot()?.ping;
  const lagMs = SKYBREAK_INTERPOLATION_DELAY_MS + (Number.isFinite(ping) ? ping / 2 : 0);
  return Math.max(0, Math.min(SKYBREAK_COMBAT_SETTINGS.maxViewLagTicks, Math.round(lagMs / (SKYBREAK_FIXED_DT_SEC * 1000))));
}

/**
 * Adapt Skybreak jets to SDK room ownership, local flight prediction,
 * interpolation, recovery and diagnostics.
 * @param {object} options
 * @param {string} options.gameId
 * @param {{capture:(viewLagTicks:number)=>import("../shared/config.js").SkybreakInputState,reset:()=>void}} options.controls
 * @param {()=>void} options.onReset
 * @param {()=>void} options.onJoined
 * @param {(message:string,retry:()=>void)=>void} options.onError
 * @param {()=>void} options.onRematchRequested
 */
export function createSkybreakMultiplayerSession(options) {
  const socket = getGameSocket(options.gameId);
  const interpolator = createWorkerInterpolator({
    extractPositions: extractSkybreakPositions,
    extractContinuityKeys: extractSkybreakContinuityKeys,
    interpDelayMs: SKYBREAK_INTERPOLATION_DELAY_MS,
    maxBufferSize: MAX_SNAPSHOT_BUFFER_SIZE,
  });
  /** @type {ReturnType<typeof createGameRoomConnection>|null} */
  let roomConnection = null;
  let localPresentation = null;
  let disposed = false;

  const networkSession = createNetworkedGameSession({
    socket,
    interpolator,
    prediction: {
      fixedDtSec: SKYBREAK_FIXED_DT_SEC,
      captureInput: () => options.controls.capture(measureSkybreakViewLagTicks(socket)),
      simulate: stepSkybreakPrediction,
      extractPose: (jet) => ({ x: jet.x, y: jet.y, z: jet.z, forwardX: jet.forwardX, forwardY: jet.forwardY, forwardZ: jet.forwardZ, upX: jet.upX, upY: jet.upY, upZ: jet.upZ }),
      maxSmoothingDistance: POSITION_SMOOTHING_M,
      correctionGroups: [
        { name: "jet", fields: ["x", "y", "z"], maxSmoothingDistance: POSITION_SMOOTHING_M },
        { name: "nose", fields: ["forwardX", "forwardY", "forwardZ"], maxSmoothingDistance: ORIENTATION_SMOOTHING },
        { name: "wings", fields: ["upX", "upY", "upZ"], maxSmoothingDistance: ORIENTATION_SMOOTHING },
      ],
    },
    readAuthority(snapshot) {
      const playerId = roomConnection?.getPlayerId();
      const jet = snapshot.players?.[playerId];
      if (!jet) return null;
      const humansConnected = Object.values(snapshot.players).every((player) => player.connected);
      return {
        state: createSkybreakPredictionState(snapshot, playerId),
        protocol: snapshot.inputProtocol ?? INPUT_PROTOCOL.QUEUED,
        inputEpoch: jet.inputEpoch,
        acknowledgedSequence: jet.inputSeqAck ?? 0,
        context: {
          active: snapshot.started && !snapshot.gameOver && snapshot.phase === "playing" && humansConnected && jet.alive,
          simulationTick: jet.inputSimulationTick,
          continuityKey: `${snapshot.matchId}:${jet.respawnId}`,
        },
      };
    },
    canCaptureInput: (snapshot) => Boolean(roomConnection?.getPlayerId() && !snapshot.gameOver),
    composeRenderPose(remotePose, localPose, snapshot, predictedState) {
      localPresentation = createSkybreakLocalPresentation(predictedState);
      return composeSkybreakRenderPose(remotePose, localPose, snapshot, roomConnection?.getPlayerId() || null, predictedState);
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
