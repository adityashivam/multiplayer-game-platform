import { getGameSocket } from "/platform/frontend-engine/gameSocket.js";
import { createGameRoomConnection } from "/platform/frontend-engine/gameRoomConnection.js";
import { createWorkerInterpolator } from "/platform/frontend-engine/interpolationWorker.js";
import { createNetworkedGameSession } from "/platform/frontend-engine/networkedGameSession.js";
import { updateConnectionState } from "/platform/frontend-engine/connectionBridge.js";
import { INPUT_PROTOCOL } from "/platform/shared/networkProtocol.js";
import { BUMPER_LINKS_FIXED_DT_SEC } from "../shared/config.js";
import { extractBumperLinksContinuityKeys, extractBumperLinksPositions } from "./snapshotPose.js";

/** @typedef {import("./snapshotPose.js").BumperLinksSnapshot} BumperLinksSnapshot */
/** @typedef {import("../shared/config.js").BumperLinksInputState} BumperLinksInputState */

export const BUMPER_LINKS_INTERPOLATION_DELAY_MS = 80;
const MAX_SNAPSHOT_BUFFER_SIZE = 24;

/**
 * Balls are never predicted: shots are rare and contacts decide outcomes,
 * so the local "prediction" only carries the authoritative pose. The SDK
 * still owns queued commands, acknowledgement and ownership epochs.
 * @param {{x:number,y:number,z:number}} _ball
 */
function keepBumperLinksAuthorityPose(_ball) {}

/**
 * Adapt Bumper Links balls to SDK room ownership, queued input,
 * interpolation, recovery and diagnostics.
 * @param {object} options
 * @param {string} options.gameId Registered mode ID; also its socket namespace.
 * @param {{capture:()=>BumperLinksInputState,reset:()=>void}} options.controls
 * @param {()=>void} options.onReset
 * @param {()=>void} options.onJoined
 * @param {(message:string,retry:()=>void)=>void} options.onError
 * @param {()=>void} options.onRematchRequested
 */
export function createBumperLinksMultiplayerSession(options) {
  const socket = getGameSocket(options.gameId);
  const interpolator = createWorkerInterpolator({
    extractPositions: extractBumperLinksPositions,
    extractContinuityKeys: extractBumperLinksContinuityKeys,
    interpDelayMs: BUMPER_LINKS_INTERPOLATION_DELAY_MS,
    maxBufferSize: MAX_SNAPSHOT_BUFFER_SIZE,
  });
  /** @type {ReturnType<typeof createGameRoomConnection>|null} */
  let roomConnection = null;
  let disposed = false;

  const networkSession = createNetworkedGameSession({
    socket,
    interpolator,
    prediction: {
      fixedDtSec: BUMPER_LINKS_FIXED_DT_SEC,
      captureInput: () => options.controls.capture(),
      simulate: keepBumperLinksAuthorityPose,
      extractPose: (ball) => ({ x: ball.x, y: ball.y, z: ball.z }),
    },
    readAuthority(snapshot) {
      const playerId = roomConnection?.getPlayerId();
      const ball = snapshot.players?.[playerId];
      if (!ball) return null;
      return {
        state: { x: ball.x, y: ball.y, z: ball.z },
        protocol: snapshot.inputProtocol ?? INPUT_PROTOCOL.QUEUED,
        inputEpoch: ball.inputEpoch,
        acknowledgedSequence: ball.inputSeqAck ?? 0,
        context: {
          active: snapshot.started && !snapshot.gameOver && snapshot.phase === "playing",
          simulationTick: ball.inputSimulationTick,
          continuityKey: `${snapshot.matchId}:${snapshot.holeIndex}:${ball.lifeId}`,
        },
      };
    },
    canCaptureInput: (snapshot) => Boolean(roomConnection?.getPlayerId() && !snapshot.gameOver),
    composeRenderPose: (remotePose) => remotePose,
    onReset() {
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
    /** @returns {BumperLinksSnapshot|null} */
    getSnapshot: () => networkSession.getLatestSnapshot(),
    getPlayerId: () => roomConnection.getPlayerId(),
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
