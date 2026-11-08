/** Versioned, genre-independent room start presentation contract. */
export const ROOM_LIFECYCLE_VERSION = 1;
export const ROOM_START_COUNTDOWN_MS = 5000;
export const ROOM_PHASE = Object.freeze({ WAITING: "waiting", COUNTDOWN: "countdown", PLAYING: "playing", FINISHED: "finished" });

/**
 * @typedef {"waiting"|"countdown"|"playing"|"finished"} RoomPhase
 * @typedef {{apiVersion:1,roomId:string,phase:RoomPhase,startAtMs:number|null,countdownDurationMs:number,connectedPlayers:number,requiredPlayers:number}} RoomLifecycleMetadata
 * @typedef {{players:Record<string,{connected?:boolean}>,started?:boolean,startAt?:number|null,gameOver?:boolean,__roomStart?:{scheduledStartAtMs:number,countdownDurationMs:number}}} LifecycleRoomState
 */

/**
 * Project human socket ownership and authoritative start timing into platform
 * metadata. Game-owned actors outside players never consume ready-room seats.
 * @param {LifecycleRoomState} state
 * @param {string} roomId
 * @returns {RoomLifecycleMetadata}
 */
export function createRoomLifecycleMetadata(state, roomId) {
  const players = Object.values(state.players || {});
  const requiredPlayers = players.length;
  const connectedPlayers = players.reduce((count, player) => count + Number(Boolean(player.connected)), 0);
  const allConnected = requiredPlayers > 0 && connectedPlayers === requiredPlayers;
  const hasDeadline = Number.isFinite(state.startAt);
  const phase = state.gameOver ? ROOM_PHASE.FINISHED : !allConnected ? ROOM_PHASE.WAITING :
    state.started === true || state.started === undefined ? ROOM_PHASE.PLAYING :
      hasDeadline ? ROOM_PHASE.COUNTDOWN : ROOM_PHASE.WAITING;
  const scheduledStartAtMs = hasDeadline ? state.startAt : state.__roomStart?.scheduledStartAtMs;

  return {
    apiVersion: ROOM_LIFECYCLE_VERSION,
    roomId,
    phase,
    startAtMs: (phase === ROOM_PHASE.COUNTDOWN || phase === ROOM_PHASE.PLAYING) && Number.isFinite(scheduledStartAtMs) ? scheduledStartAtMs : null,
    countdownDurationMs: state.__roomStart?.countdownDurationMs ?? ROOM_START_COUNTDOWN_MS,
    connectedPlayers,
    requiredPlayers,
  };
}
