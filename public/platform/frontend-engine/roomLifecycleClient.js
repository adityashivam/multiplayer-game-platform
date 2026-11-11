import { ROOM_LIFECYCLE_VERSION, ROOM_PHASE, ROOM_START_COUNTDOWN_MS } from "../shared/roomLifecycle.js";

const GO_CUE_DURATION_MS = 650;
const MAX_CLOCK_LATENCY_ADJUSTMENT_MS = 250;
const SUPPORTED_PHASES = new Set(Object.values(ROOM_PHASE));

/**
 * @typedef {object} RoomLifecyclePresentation
 * @property {"connecting"|"reconnecting"|"error"|import("../shared/roomLifecycle.js").RoomPhase} phase
 * @property {string|null} roomId
 * @property {string|null} playerId
 * @property {boolean} joined
 * @property {boolean} hasPlayed Whether this room ownership has entered authoritative play; retained during recovery.
 * @property {number|null} secondsRemaining
 * @property {number|null} startAtMs
 * @property {number} countdownDurationMs
 * @property {number} connectedPlayers
 * @property {number} requiredPlayers
 * @property {boolean} showGo
 * @property {"roomFull"|null} errorCode
 * @property {string|null} errorMessage
 */

/** @returns {RoomLifecyclePresentation} */
function createInitialPresentation() {
  return { phase: "connecting", roomId: null, playerId: null, joined: false, hasPlayed: false, secondsRemaining: null, startAtMs: null, countdownDurationMs: ROOM_START_COUNTDOWN_MS, connectedPlayers: 0, requiredPlayers: 0, showGo: false, errorCode: null, errorMessage: null };
}

/**
 * Estimate authoritative time from server-stamped packets and a monotonic local
 * anchor. The device's Date.now/timezone cannot advance or delay this countdown.
 * Only a playing packet can start gameplay or emit the GO cue.
 * @param {{nowFn?:()=>number,onChange?:(state:RoomLifecyclePresentation)=>void}} [options]
 */
export function createRoomLifecycleClient({ nowFn = () => performance.now(), onChange } = {}) {
  let presentation = createInitialPresentation();
  let serverAnchorMs = null;
  let localAnchorMs = 0;
  let goUntilMs = 0;
  let changeKey = "";
  let seatRejoinToken = null;

  function publishPresentation() {
    const key = `${presentation.phase}|${presentation.roomId}|${presentation.playerId}|${presentation.joined}|${presentation.hasPlayed}|${presentation.secondsRemaining}|${presentation.startAtMs}|${presentation.countdownDurationMs}|${presentation.connectedPlayers}|${presentation.requiredPlayers}|${presentation.showGo}|${presentation.errorCode}`;
    if (key === changeKey) return;
    changeKey = key;
    onChange?.({ ...presentation });
  }

  function refresh() {
    const nowMs = nowFn();
    const estimatedServerNowMs = serverAnchorMs === null ? null : serverAnchorMs + Math.max(0, nowMs - localAnchorMs);
    presentation.secondsRemaining = presentation.phase === ROOM_PHASE.COUNTDOWN && estimatedServerNowMs !== null && presentation.startAtMs !== null
      ? Math.max(0, Math.ceil((presentation.startAtMs - estimatedServerNowMs) / 1000)) : null;
    presentation.showGo = presentation.phase === ROOM_PHASE.PLAYING && nowMs < goUntilMs;
    publishPresentation();
  }

  return {
    /**
     * Accept ownership without restarting presentation on repeated confirmations.
     * A reconnect retains recovery until a fresh authoritative snapshot arrives.
     * @param {{gameId:string,playerId:string,rejoinToken?:string}} joinedRoom
     */
    recordJoined(joinedRoom) {
      if (typeof joinedRoom?.gameId !== "string" || typeof joinedRoom?.playerId !== "string") return;
      const { gameId, playerId } = joinedRoom;
      const rejoinToken = typeof joinedRoom.rejoinToken === "string" ? joinedRoom.rejoinToken : null;
      const sameSeat = presentation.roomId === gameId && presentation.playerId === playerId && seatRejoinToken === rejoinToken;
      if (sameSeat && presentation.joined) return;
      if (sameSeat && presentation.phase === "reconnecting") {
        presentation = { ...presentation, joined: true };
        publishPresentation();
        return;
      }

      seatRejoinToken = rejoinToken;
      presentation = { ...createInitialPresentation(), roomId: gameId, playerId, joined: true };
      serverAnchorMs = null;
      goUntilMs = 0;
      publishPresentation();
    },
    /** @param {{net?:{serverTime?:number,room?:import("../shared/roomLifecycle.js").RoomLifecycleMetadata}}} snapshot */
    recordSnapshot(snapshot, { pingMs = 0 } = {}) {
      const room = snapshot?.net?.room;
      const serverTime = snapshot?.net?.serverTime;
      if (!presentation.joined || !room || room.apiVersion !== ROOM_LIFECYCLE_VERSION || room.roomId !== presentation.roomId ||
          !SUPPORTED_PHASES.has(room.phase) || !Number.isFinite(serverTime) ||
          !Number.isSafeInteger(room.connectedPlayers) || !Number.isSafeInteger(room.requiredPlayers) ||
          room.requiredPlayers < 1 || room.connectedPlayers < 0 || room.connectedPlayers > room.requiredPlayers) return;
      const previousPhase = presentation.phase;
      const wasPlaying = presentation.hasPlayed;
      const localNowMs = nowFn();
      const observedServerMs = serverTime + (Number.isFinite(pingMs) ? Math.min(MAX_CLOCK_LATENCY_ADJUSTMENT_MS, Math.max(0, pingMs / 2)) : 0);
      const sameCountdown = previousPhase === ROOM_PHASE.COUNTDOWN && room.phase === ROOM_PHASE.COUNTDOWN &&
        presentation.startAtMs === room.startAtMs && serverAnchorMs !== null;
      serverAnchorMs = sameCountdown ? Math.max(observedServerMs, serverAnchorMs + Math.max(0, localNowMs - localAnchorMs)) : observedServerMs;
      localAnchorMs = localNowMs;
      presentation = {
        ...presentation,
        phase: room.phase,
        hasPlayed: wasPlaying || room.phase === ROOM_PHASE.PLAYING,
        startAtMs: Number.isFinite(room.startAtMs) ? room.startAtMs : null,
        countdownDurationMs: Number.isFinite(room.countdownDurationMs) && room.countdownDurationMs >= 0 ? room.countdownDurationMs : ROOM_START_COUNTDOWN_MS,
        connectedPlayers: room.connectedPlayers,
        requiredPlayers: room.requiredPlayers,
      };
      if (!wasPlaying && previousPhase === ROOM_PHASE.COUNTDOWN && room.phase === ROOM_PHASE.PLAYING) goUntilMs = localAnchorMs + GO_CUE_DURATION_MS;
      if (room.phase !== ROOM_PHASE.PLAYING) goUntilMs = 0;
      refresh();
    },
    recordDisconnected() {
      presentation = { ...presentation, joined: false, phase: "reconnecting", secondsRemaining: null, startAtMs: null, showGo: false };
      serverAnchorMs = null;
      goUntilMs = 0;
      publishPresentation();
    },
    /** @param {"roomFull"} errorCode A terminal failure replaces the joining presentation. */
    recordJoinFailure(errorCode) {
      presentation = { ...presentation, phase: "error", joined: false, secondsRemaining: null, startAtMs: null, showGo: false, errorCode,
        errorMessage: "Every player slot is currently occupied. Return to the library to start another room." };
      goUntilMs = 0;
      publishPresentation();
    },
    restartRound() {
      presentation = { ...presentation, phase: "connecting", hasPlayed: false, secondsRemaining: null, startAtMs: null, showGo: false };
      goUntilMs = 0;
      publishPresentation();
    },
    refresh,
    getSnapshot: () => ({ ...presentation }),
    reset() {
      presentation = createInitialPresentation();
      seatRejoinToken = null;
      serverAnchorMs = null;
      goUntilMs = 0;
      publishPresentation();
    },
  };
}
