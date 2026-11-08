import { SOCKET_EVENT } from "../shared/networkProtocol.js";

const ROOM_READY_EVENT = "kaboom:room-ready";
const GAME_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const ROOM_ID_PATTERN = /^[a-z0-9]+$/i;

/**
 * @typedef {{gameId:string,playerId:string,rejoinToken?:string}} JoinedGameRoom
 * @typedef {{connect:undefined,disconnect:unknown,gameJoined:JoinedGameRoom,roomFull:unknown,rematchRequested:{playerId:string}}} RoomConnectionEvents
 * @typedef {object} RoomConnectionSocket
 * @property {<EventName extends keyof RoomConnectionEvents>(eventName:EventName,listener:(payload:RoomConnectionEvents[EventName])=>void)=>()=>void} onEvent
 * @property {(eventName:"joinGame"|"rematch",payload?:{gameId:string,rejoinToken?:string})=>void} send
 * @property {()=>boolean} isConnected
 */

/**
 * Own room creation, shared-link navigation and per-tab seat recovery. Networking
 * prediction/input ownership stays in createNetworkedGameSession. The caller
 * retains the socket; disposal only removes this component's subscriptions.
 * @param {object} options
 * @param {string} options.gameId Registered game identifier.
 * @param {RoomConnectionSocket} options.socket
 * @param {(joinedRoom:JoinedGameRoom)=>void} [options.onJoined]
 * @param {(message:string,retry:()=>void)=>void} [options.onError]
 * @param {(playerId:string)=>void} [options.onRematchRequested]
 * @param {Window} [options.windowRef]
 * @param {Storage|null} [options.storage] Null opts out of seat persistence.
 * @param {typeof fetch} [options.fetchRoom]
 * @param {string} [options.roomFullMessage]
 * @returns {{getPlayerId:()=>string|null,getRoomId:()=>string|null,requestRematch:()=>void,dispose:()=>void}}
 * @throws {TypeError} If gameId is not a supported route identifier.
 */
export function createGameRoomConnection(options) {
  const { gameId, socket } = options;
  if (typeof gameId !== "string" || !GAME_ID_PATTERN.test(gameId)) throw new TypeError("Room connection requires a registered game identifier.");
  const windowRef = options.windowRef ?? window;
  const fetchRoom = options.fetchRoom ?? fetch;
  const storage = options.storage === undefined ? readSessionStorage() : options.storage;
  const requestController = new AbortController();
  const routeSegments = windowRef.location.pathname.split("/").filter(Boolean);
  let roomId = routeSegments[0] === "games" && routeSegments[1] === gameId &&
    routeSegments.length === 3 && ROOM_ID_PATTERN.test(routeSegments[2]) ? routeSegments[2] : null;
  let playerId = null;
  let rejoinToken = null;
  let joinRequested = false;
  let creatingRoom = false;
  let disposed = false;

  function getStorageKey() {
    return `rejoinToken:${gameId}:${roomId}`;
  }

  function announceRoomReady() {
    if (!roomId || disposed) return;
    const roomPath = `/games/${gameId}/${roomId}`;
    if (windowRef.location.pathname !== roomPath) windowRef.history.replaceState({}, "", roomPath);
    windowRef.dispatchEvent(new CustomEvent(ROOM_READY_EVENT, { detail: { gameId, roomId } }));
  }

  function joinRoom() {
    if (disposed || joinRequested || !roomId || !socket.isConnected()) return;
    if (!rejoinToken) {
      try { rejoinToken = storage?.getItem(getStorageKey()) || null; } catch { /* Seat ownership still survives the current connection. */ }
    }
    joinRequested = true;
    socket.send(SOCKET_EVENT.JOIN_GAME, { gameId: roomId, rejoinToken: rejoinToken || undefined });
  }

  async function prepareRoom() {
    if (disposed || creatingRoom) return;
    creatingRoom = true;
    try {
      if (!roomId) {
        const roomResponse = await fetchRoom(`/api/games/${gameId}/new-room`, { signal: requestController.signal });
        if (disposed) return;
        if (!roomResponse.ok) throw new Error("Could not create a room. Please try again.");
        const roomDetails = await roomResponse.json();
        if (disposed) return;
        if (typeof roomDetails?.roomId !== "string" || !ROOM_ID_PATTERN.test(roomDetails.roomId)) {
          throw new Error("The server returned an invalid room link.");
        }
        roomId = roomDetails.roomId;
      }
      announceRoomReady();
      joinRoom();
    } catch (roomError) {
      if (!disposed && roomError.name !== "AbortError") options.onError?.(roomError.message, prepareRoom);
    } finally {
      creatingRoom = false;
    }
  }

  const unsubscribeHandlers = [
    socket.onEvent(SOCKET_EVENT.CONNECT, joinRoom),
    socket.onEvent(SOCKET_EVENT.DISCONNECT, () => { joinRequested = false; }),
    socket.onEvent(SOCKET_EVENT.GAME_JOINED, (joinedRoom) => {
      if (disposed || joinedRoom.gameId !== roomId) return;
      playerId = joinedRoom.playerId;
      roomId = joinedRoom.gameId || roomId;
      rejoinToken = joinedRoom.rejoinToken || null;
      if (rejoinToken) {
        try { storage?.setItem(getStorageKey(), rejoinToken); } catch { /* Restricted storage must not prevent play. */ }
      }
      announceRoomReady();
      options.onJoined?.(joinedRoom);
    }),
    socket.onEvent(SOCKET_EVENT.ROOM_FULL, () => {
      joinRequested = false;
      options.onError?.(options.roomFullMessage || "This room is full. Open the game from the library to create another room.", joinRoom);
    }),
    socket.onEvent(SOCKET_EVENT.REMATCH_REQUESTED, (request) => {
      if (request.playerId !== playerId) options.onRematchRequested?.(request.playerId);
    }),
  ];
  prepareRoom();

  return {
    getPlayerId: () => playerId,
    getRoomId: () => roomId,
    requestRematch() {
      if (!disposed && playerId) socket.send(SOCKET_EVENT.REMATCH);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      requestController.abort();
      unsubscribeHandlers.forEach((unsubscribe) => unsubscribe());
    },
  };
}

/** Read browser storage defensively: privacy settings can throw on property access. */
function readSessionStorage() {
  try { return sessionStorage; } catch { return null; }
}
