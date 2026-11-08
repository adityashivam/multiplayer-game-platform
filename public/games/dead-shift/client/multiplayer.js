import { getGameSocket } from "/platform/frontend-engine/gameSocket.js";
import { createWorkerInterpolator } from "/platform/frontend-engine/interpolationWorker.js";
import { createNetworkedGameSession } from "/platform/frontend-engine/networkedGameSession.js";
import { updateConnectionState } from "/platform/frontend-engine/connectionBridge.js";
import { INPUT_PROTOCOL, SOCKET_EVENT } from "/platform/shared/networkProtocol.js";
import { DEAD_SHIFT_FIXED_DT_SEC, DEAD_SHIFT_GAME_ID, DEAD_SHIFT_INPUT_TEMPLATE } from "../shared/config.js";
import { stepDeadShiftPlayer } from "../shared/simulation.js";
import { extractDeadShiftPositions } from "./snapshotPose.js";

const ROOM_READY_EVENT = "kaboom:room-ready";
const INTERPOLATION_DELAY_MS = 55;
const MAX_SNAPSHOT_BUFFER_SIZE = 24;
const ROOM_CREATE_URL = `/api/games/${DEAD_SHIFT_GAME_ID}/new-room`;

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
  const roomRequest = new AbortController();
  let playerId = null;
  let roomId = readRoomIdFromLocation();
  let rejoinToken = null;
  let joinRequested = false;
  let preparingRoom = false;
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
    canCaptureInput: (snapshot) => Boolean(playerId && !snapshot.gameOver),
    composeRenderPose: (remotePose, localPose, snapshot) => {
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

  function getRejoinStorageKey() {
    return `rejoinToken:${DEAD_SHIFT_GAME_ID}:${roomId}`;
  }

  function announceRoomReady() {
    if (!roomId || disposed) return;
    const roomPath = `/games/${DEAD_SHIFT_GAME_ID}/${roomId}`;
    if (window.location.pathname !== roomPath) window.history.replaceState({}, "", roomPath);
    window.dispatchEvent(new CustomEvent(ROOM_READY_EVENT, { detail: { gameId: DEAD_SHIFT_GAME_ID, roomId } }));
  }

  function joinRoom() {
    if (!socket.isConnected() || !roomId || joinRequested || disposed) return;
    if (!rejoinToken) {
      try { rejoinToken = sessionStorage.getItem(getRejoinStorageKey()); } catch { /* Storage can be unavailable in private contexts. */ }
    }
    joinRequested = true;
    socket.send(SOCKET_EVENT.JOIN_GAME, { gameId: roomId, rejoinToken: rejoinToken || undefined });
  }

  async function prepareRoom() {
    if (preparingRoom || disposed) return;
    preparingRoom = true;
    try {
      if (!roomId) {
        const roomResponse = await fetch(ROOM_CREATE_URL, { signal: roomRequest.signal });
        if (!roomResponse.ok) throw new Error("Could not create a room. Please try again.");
        const roomDetails = await roomResponse.json();
        if (!/^[a-z0-9]+$/i.test(roomDetails.roomId || "")) throw new Error("The server returned an invalid room link.");
        roomId = roomDetails.roomId;
      }
      announceRoomReady();
      joinRoom();
    } catch (roomError) {
      if (!disposed && roomError.name !== "AbortError") options.onError(roomError.message, prepareRoom);
    } finally {
      preparingRoom = false;
    }
  }

  cleanups.push(socket.onConnectionChange(updateConnectionState));
  cleanups.push(socket.onEvent(SOCKET_EVENT.CONNECT, () => {
    joinRequested = false;
    joinRoom();
  }));
  cleanups.push(socket.onEvent(SOCKET_EVENT.DISCONNECT, () => {
    joinRequested = false;
    options.controls.reset();
  }));
  cleanups.push(socket.onEvent(SOCKET_EVENT.GAME_JOINED, (joinedRoom) => {
    playerId = joinedRoom.playerId;
    roomId = joinedRoom.gameId || roomId;
    rejoinToken = joinedRoom.rejoinToken || null;
    if (rejoinToken) {
      try { sessionStorage.setItem(getRejoinStorageKey(), rejoinToken); } catch { /* Gameplay continues without reload recovery. */ }
    }
    announceRoomReady();
    options.onJoined();
  }));
  cleanups.push(socket.onEvent(SOCKET_EVENT.ROOM_FULL, () => {
    joinRequested = false;
    options.onError("This room already has two operators. Open Dead Shift from the library to create another room.", joinRoom);
  }));
  cleanups.push(socket.onEvent(SOCKET_EVENT.STATE, (snapshot) => options.onState(snapshot, playerId)));
  cleanups.push(socket.onEvent(SOCKET_EVENT.REMATCH_REQUESTED, ({ playerId: requestingPlayerId }) => {
    if (requestingPlayerId !== playerId) options.onRematchRequested(requestingPlayerId);
  }));
  prepareRoom();

  return {
    samplePose: (sampleOptions) => networkSession.samplePose(sampleOptions),
    getSnapshot: () => networkSession.getLatestSnapshot(),
    getPlayerId: () => playerId,
    getInput: () => latestInput,
    getStats: () => networkSession.getStats(),
    requestRematch: () => socket.send(SOCKET_EVENT.REMATCH),
    dispose() {
      if (disposed) return;
      disposed = true;
      roomRequest.abort();
      cleanups.forEach((cleanup) => cleanup());
      networkSession.destroy();
      interpolator.destroy();
      socket.destroy();
      updateConnectionState({ status: "disconnected", ping: null });
    },
  };
}

/** @returns {string|null} The platform's room route or null before room creation. */
function readRoomIdFromLocation() {
  return window.location.pathname.match(/^\/games\/dead-shift\/([a-z0-9]+)\/?$/i)?.[1] || null;
}
