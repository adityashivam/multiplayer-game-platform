import { getGameSocket } from "/platform/frontend-engine/gameSocket.js";
import { createWorkerInterpolator } from "/platform/frontend-engine/interpolationWorker.js";
import { createNetworkedGameSession } from "/platform/frontend-engine/networkedGameSession.js";
import { createGameRoomConnection } from "/platform/frontend-engine/gameRoomConnection.js";
import { updateConnectionState } from "/platform/frontend-engine/connectionBridge.js";
import { INPUT_PROTOCOL, SOCKET_EVENT } from "/platform/shared/networkProtocol.js";
import { DEAD_SHIFT_FIXED_DT_SEC, DEAD_SHIFT_GAME_ID, DEAD_SHIFT_INPUT_TEMPLATE } from "../shared/config.js";
import { stepDeadShiftPlayer } from "../shared/simulation.js";
import { extractDeadShiftPositions } from "./snapshotPose.js";

const INTERPOLATION_DELAY_MS = 55;
const MAX_SNAPSHOT_BUFFER_SIZE = 24;

/**
 * Adapt this game's pure rules and metadata to the platform-owned networking flow.
 * @param {{controls: object, onState: (snapshot: object, playerId: "p1"|"p2"|null) => void, onReset: () => void, onJoined: () => void, onError: (message:string,retry:()=>void) => void, onRematchRequested: (playerId:string) => void}} options
 */
export function createDeadShiftMultiplayerSession(options) {
  const socket = getGameSocket(DEAD_SHIFT_GAME_ID);
  const interpolator = createWorkerInterpolator({
    extractPositions: extractDeadShiftPositions,
    interpDelayMs: INTERPOLATION_DELAY_MS,
    maxBufferSize: MAX_SNAPSHOT_BUFFER_SIZE,
  });
  const cleanups = [];
  let roomConnection = null;
  let disposed = false;
  let latestInput = { ...DEAD_SHIFT_INPUT_TEMPLATE };

  const networkSession = createNetworkedGameSession({
    socket,
    interpolator,
    prediction: {
      fixedDtSec: DEAD_SHIFT_FIXED_DT_SEC,
      captureInput: () => {
        latestInput = options.controls.capture();
        return latestInput;
      },
      simulate: stepDeadShiftPlayer,
      extractPose: (playerState) => ({ x: playerState.x, y: playerState.y, z: playerState.z }),
      maxSmoothingDistance: 1.5,
    },
    readAuthority: (snapshot) => {
      const playerId = roomConnection?.getPlayerId();
      const playerState = snapshot.players?.[playerId];
      return playerState ? {
        state: playerState,
        protocol: snapshot.inputProtocol ?? INPUT_PROTOCOL.QUEUED,
        inputEpoch: playerState.inputEpoch,
        acknowledgedSequence: playerState.inputSeqAck ?? 0,
        context: {
          simulationTick: playerState.inputSimulationTick,
          active: snapshot.started && !snapshot.gameOver && snapshot.players.p1.connected && snapshot.players.p2.connected,
          players: Object.values(snapshot.players),
        },
      } : null;
    },
    canCaptureInput: (snapshot) => Boolean(roomConnection?.getPlayerId() && !snapshot.gameOver),
    composeRenderPose: (remotePose, localPose, snapshot) => {
      const playerId = roomConnection?.getPlayerId();
      if (!snapshot) return null;
      const presentationPose = remotePose || extractDeadShiftPositions(snapshot);
      if (!playerId || !localPose) return presentationPose;
      return {
        ...presentationPose,
        [`${playerId}x`]: localPose.x,
        [`${playerId}y`]: localPose.y,
        [`${playerId}z`]: localPose.z,
      };
    },
    onReset: () => {
      options.controls.reset();
      latestInput = { ...DEAD_SHIFT_INPUT_TEMPLATE };
      options.onReset();
    },
    onDiagnostics: updateConnectionState,
    diagnosticsIntervalMs: 200,
  });

  cleanups.push(socket.onConnectionChange(updateConnectionState));
  cleanups.push(socket.onEvent(SOCKET_EVENT.STATE, (snapshot) => options.onState(snapshot, roomConnection?.getPlayerId() || null)));
  roomConnection = createGameRoomConnection({
    gameId: DEAD_SHIFT_GAME_ID,
    socket,
    onJoined: options.onJoined,
    onError: options.onError,
    onRematchRequested: options.onRematchRequested,
    roomFullMessage: "This room already has two operators. Open Dead Shift from the library to create another room.",
  });

  return {
    samplePose: (sampleOptions) => networkSession.samplePose(sampleOptions),
    getSnapshot: () => networkSession.getLatestSnapshot(),
    getPlayerId: () => roomConnection.getPlayerId(),
    getInput: () => latestInput,
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
