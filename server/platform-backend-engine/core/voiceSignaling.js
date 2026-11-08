import { randomUUID } from "node:crypto";
import { getRoomPlayerIds } from "./state.js";
import { getDefaultVoiceConfiguration } from "./voiceConfiguration.js";
import { VOICE_EVENT, VOICE_LIMITS, VOICE_PROTOCOL_VERSION } from "../../../public/platform/shared/voiceProtocol.js";

const SIGNAL_RATE_WINDOW_MS = 10000;
const MAX_REQUESTS_PER_WINDOW = 120;
const MAX_JOINS_PER_WINDOW = 6;
const MAX_JOIN_REQUEST_ID_LENGTH = 128;
const MAX_PARTICIPANT_ID_LENGTH = 128;
const MAX_SDP_MID_LENGTH = 128;
const MAX_ICE_USERNAME_LENGTH = 256;

const VOICE_ERROR = Object.freeze({
  INVALID_PACKET: { code: "invalid-packet", message: "Voice setup received an invalid message." },
  NOT_AUTHORIZED: { code: "not-authorized", message: "Join a live game room before joining voice." },
  NOT_JOINED: { code: "not-joined", message: "Join voice before sending voice setup messages." },
  INVALID_TARGET: { code: "invalid-target", message: "That voice participant is no longer in your room." },
  UNSUPPORTED_CAPACITY: { code: "unsupported-capacity", message: "Voice supports game rooms with up to four participants." },
  ROOM_FULL: { code: "room-full", message: "This voice room is full." },
  RATE_LIMIT: { code: "rate-limit", message: "Voice setup is sending too quickly. Wait a moment and try again." },
  UNAVAILABLE: { code: "unavailable", message: "Voice setup is unavailable. Leave voice and try again." },
});

/**
 * @typedef {import("socket.io").Socket} VoiceSocket
 * @typedef {import("../../../public/platform/shared/voiceProtocol.js").VoiceParticipant} VoiceParticipant
 * @typedef {import("../../../public/platform/shared/voiceProtocol.js").VoiceDescription} VoiceDescription
 * @typedef {import("../../../public/platform/shared/voiceProtocol.js").VoiceCandidate} VoiceCandidate
 * @typedef {{id:string,playerId:string,roomId:string,socket:VoiceSocket,muted:boolean}} VoiceMembership
 * @typedef {{roomId:string,playerId:string,maxParticipants:number}} VoiceRoomOwnership
 * @typedef {{version:1,to:string,description?:VoiceDescription,candidate?:VoiceCandidate}} SanitizedVoiceSignal
 * @typedef {{startAtMs:number,requestCount:number,joinCount:number,reported:boolean}} VoiceRequestBudget
 * @typedef {"platform:voice:peer-left"|"platform:voice:state"} VoiceBroadcastEvent
 * @typedef {{version:1,participantId:string,muted?:boolean}} VoiceBroadcastPacket
 * @typedef {(packet:unknown) => void} VoicePacketListener
 * @typedef {{"platform:voice:join":VoicePacketListener,"platform:voice:state":VoicePacketListener,"platform:voice:signal":VoicePacketListener,"platform:voice:leave":VoicePacketListener}} VoiceSocketHandlers
 * @typedef {{createSocketHandlers:(socket:VoiceSocket) => VoiceSocketHandlers,leave:(socket:VoiceSocket) => void,reconcileSocket:(socket:VoiceSocket) => void}} VoiceSignaling
 */

/** @param {unknown} value @param {readonly string[]} supportedKeys @returns {boolean} */
function hasSupportedVoiceKeys(value, supportedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null) &&
    Object.keys(value).every((key) => supportedKeys.includes(key));
}

/**
 * Bound bytes before parsing strings, including multibyte input.
 * @param {unknown} value
 * @param {number} maxBytes
 * @returns {value is string}
 */
function isBoundedVoiceString(value, maxBytes) {
  return typeof value === "string" && value.length <= maxBytes && Buffer.byteLength(value, "utf8") <= maxBytes;
}

/** @param {unknown} packet @returns {boolean} */
function isVoiceLifecyclePacket(packet) {
  return hasSupportedVoiceKeys(packet, ["version"]) && packet.version === VOICE_PROTOCOL_VERSION;
}

/**
 * Request nonces correlate responses only; participant identity remains server-owned.
 * Extract a valid nonce even when another JOIN field is malformed.
 * @param {unknown} packet
 * @returns {string | undefined}
 */
function readVoiceJoinRequestId(packet) {
  if (!packet || typeof packet !== "object" || !Object.hasOwn(packet, "requestId") ||
      !isBoundedVoiceString(packet.requestId, MAX_JOIN_REQUEST_ID_LENGTH) || !/^[\x20-\x7e]+$/.test(packet.requestId)) {
    return undefined;
  }
  return packet.requestId;
}

/**
 * Only one audio media section may be negotiated; video and data channels never
 * enter the platform signaling path, even when a modified client requests them.
 * @param {unknown} description
 * @returns {VoiceDescription | null}
 */
function sanitizeVoiceDescription(description) {
  if (!hasSupportedVoiceKeys(description, ["type", "sdp"]) ||
      !["offer", "answer"].includes(description.type) ||
      !isBoundedVoiceString(description.sdp, VOICE_LIMITS.MAX_SDP_LENGTH) ||
      !/^v=0\r?\n/.test(description.sdp) || /\x00|\r(?!\n)/.test(description.sdp)) {
    return null;
  }

  const mediaSections = description.sdp.split(/\r?\n/).filter((line) => line.startsWith("m="));
  if (mediaSections.length !== 1 || !/^m=audio \d+(?:\/\d+)? [A-Za-z\d/]+ [\d ]+$/.test(mediaSections[0])) {
    return null;
  }
  return { type: description.type, sdp: description.sdp };
}

/** @param {unknown} candidate @returns {VoiceCandidate | null} */
function sanitizeVoiceCandidate(candidate) {
  if (!hasSupportedVoiceKeys(candidate, ["candidate", "sdpMid", "sdpMLineIndex", "usernameFragment"]) ||
      !isBoundedVoiceString(candidate.candidate, VOICE_LIMITS.MAX_CANDIDATE_LENGTH) ||
      (candidate.candidate !== "" && !candidate.candidate.startsWith("candidate:")) ||
      /[\x00\r\n]/.test(candidate.candidate) ||
      !(candidate.sdpMid === null || isBoundedVoiceString(candidate.sdpMid, MAX_SDP_MID_LENGTH)) ||
      !(candidate.sdpMLineIndex === null || candidate.sdpMLineIndex === 0) ||
      !(candidate.usernameFragment === undefined || candidate.usernameFragment === null ||
        isBoundedVoiceString(candidate.usernameFragment, MAX_ICE_USERNAME_LENGTH))) {
    return null;
  }

  return {
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid,
    sdpMLineIndex: candidate.sdpMLineIndex,
    ...(candidate.usernameFragment !== undefined ? { usernameFragment: candidate.usernameFragment } : {}),
  };
}

/** @param {unknown} packet @returns {SanitizedVoiceSignal | null} */
function sanitizeVoiceSignal(packet) {
  if (!hasSupportedVoiceKeys(packet, ["version", "to", "description", "candidate"]) ||
      packet.version !== VOICE_PROTOCOL_VERSION ||
      !isBoundedVoiceString(packet.to, MAX_PARTICIPANT_ID_LENGTH) || packet.to.length === 0 ||
      Object.hasOwn(packet, "description") === Object.hasOwn(packet, "candidate")) {
    return null;
  }

  if (Object.hasOwn(packet, "description")) {
    const description = sanitizeVoiceDescription(packet.description);
    return description ? { version: VOICE_PROTOCOL_VERSION, to: packet.to, description } : null;
  }
  const candidate = sanitizeVoiceCandidate(packet.candidate);
  return candidate ? { version: VOICE_PROTOCOL_VERSION, to: packet.to, candidate } : null;
}

/** @param {VoiceMembership} membership @returns {VoiceParticipant} */
function describeVoiceParticipant(membership) {
  return { id: membership.id, playerId: membership.playerId, muted: membership.muted };
}

/**
 * Own bounded room voice membership within one game namespace. All identities
 * derive from the authoritative room store and current Socket.IO slot owner.
 * The returned handlers only relay setup metadata; media never enters Node.
 * @param {object} options
 * @param {import("socket.io").Namespace} options.nsp
 * @param {Map<string, import("./state.js").RoomState>} options.games
 * @param {readonly string[]} [options.playerIds]
 * @param {import("./voiceConfiguration.js").VoiceConfiguration} [options.configuration]
 * @param {() => number} [options.nowFn]
 * @param {() => string} [options.createParticipantId] Must return a fresh identifier per join.
 * @returns {VoiceSignaling}
 */
export function createVoiceSignaling({
  nsp,
  games,
  playerIds,
  configuration = getDefaultVoiceConfiguration(),
  nowFn = Date.now,
  createParticipantId = randomUUID,
}) {
  /** @type {Map<VoiceSocket, VoiceMembership>} */
  const membershipsBySocket = new Map();
  /** @type {Map<string, Map<string, VoiceMembership>>} */
  const membershipsByRoom = new Map();
  /** @type {WeakMap<VoiceSocket, VoiceRequestBudget>} */
  const requestBudgets = new WeakMap();

  /** @param {VoiceSocket} socket @returns {VoiceRoomOwnership | null} */
  function resolveVoiceRoomOwnership(socket) {
    const { gameId: roomId, playerId } = socket.data;
    const state = games.get(roomId);
    const roomSocketIds = nsp.adapter?.rooms.get(roomId);
    if (socket.connected === false || nsp.sockets?.get(socket.id) !== socket ||
        typeof roomId !== "string" || typeof playerId !== "string" ||
        !roomSocketIds?.has(socket.id) || !state?.players ||
        !Object.hasOwn(state.players, playerId) || state.players[playerId]?.connected !== true) {
      return null;
    }

    let roomPlayerIds;
    try {
      roomPlayerIds = getRoomPlayerIds(state, playerIds);
    } catch {
      return null;
    }
    if (!roomPlayerIds.includes(playerId)) {
      return null;
    }

    let currentSlotOwner;
    for (const socketId of roomSocketIds) {
      const roomSocket = nsp.sockets.get(socketId);
      if (roomSocket?.data?.gameId === roomId && roomSocket.data.playerId === playerId) {
        currentSlotOwner = roomSocket;
      }
    }
    return currentSlotOwner === socket ? { roomId, playerId, maxParticipants: roomPlayerIds.length } : null;
  }

  /** @param {VoiceSocket} socket @param {keyof typeof VOICE_ERROR} errorKey @param {string} [requestId] */
  function emitVoiceError(socket, errorKey, requestId) {
    socket.emit(VOICE_EVENT.ERROR, {
      version: VOICE_PROTOCOL_VERSION,
      ...VOICE_ERROR[errorKey],
      ...(requestId !== undefined ? { requestId } : {}),
    });
  }

  /** @param {VoiceSocket} socket @param {boolean} [isJoin] @param {string} [requestId] @returns {boolean} */
  function consumeVoiceRequestBudget(socket, isJoin = false, requestId) {
    const nowMs = nowFn();
    let requestBudget = requestBudgets.get(socket);
    if (!requestBudget || nowMs < requestBudget.startAtMs || nowMs - requestBudget.startAtMs >= SIGNAL_RATE_WINDOW_MS) {
      requestBudget = { startAtMs: nowMs, requestCount: 0, joinCount: 0, reported: false };
      requestBudgets.set(socket, requestBudget);
    }

    requestBudget.requestCount += 1;
    if (isJoin) requestBudget.joinCount += 1;
    if (requestBudget.requestCount <= MAX_REQUESTS_PER_WINDOW && requestBudget.joinCount <= MAX_JOINS_PER_WINDOW) {
      return true;
    }
    if (!requestBudget.reported) {
      requestBudget.reported = true;
      emitVoiceError(socket, "RATE_LIMIT", requestId);
    }
    return false;
  }

  /**
   * Broadcast small lifecycle messages only to currently authorized members.
   * @param {string} roomId
   * @param {VoiceBroadcastEvent} eventName
   * @param {VoiceBroadcastPacket} packet
   * @param {string} [excludedParticipantId]
   */
  function emitToVoicePeers(roomId, eventName, packet, excludedParticipantId) {
    for (const membership of membershipsByRoom.get(roomId)?.values() ?? []) {
      const ownership = resolveVoiceRoomOwnership(membership.socket);
      if (membership.id !== excludedParticipantId && ownership?.roomId === roomId && ownership.playerId === membership.playerId) {
        membership.socket.emit(eventName, packet);
      }
    }
  }

  /**
   * Refresh recipient-scoped TURN access when a new peer needs ICE negotiation.
   * Existing connections retain their configuration and media allocations.
   * @param {VoiceMembership} joinedMembership
   */
  function announceVoiceParticipantJoined(joinedMembership) {
    const participant = describeVoiceParticipant(joinedMembership);
    for (const recipient of membershipsByRoom.get(joinedMembership.roomId)?.values() ?? []) {
      const ownership = resolveVoiceRoomOwnership(recipient.socket);
      if (recipient.id !== joinedMembership.id && ownership?.roomId === joinedMembership.roomId &&
          ownership.playerId === recipient.playerId) {
        recipient.socket.emit(VOICE_EVENT.PEER_JOINED, {
          version: VOICE_PROTOCOL_VERSION,
          participant,
          iceServers: configuration.createIceServers(recipient.id),
        });
      }
    }
  }

  /**
   * Remove membership before notifying peers; repeated cleanup has no side effects.
   * @param {VoiceSocket} socket
   * @returns {void}
   */
  function leave(socket) {
    const membership = membershipsBySocket.get(socket);
    if (!membership) return;

    membershipsBySocket.delete(socket);
    const roomMemberships = membershipsByRoom.get(membership.roomId);
    roomMemberships?.delete(membership.id);
    if (roomMemberships?.size === 0) membershipsByRoom.delete(membership.roomId);
    emitToVoicePeers(membership.roomId, VOICE_EVENT.PEER_LEFT,
      { version: VOICE_PROTOCOL_VERSION, participantId: membership.id });
  }

  /**
   * Discard stale ownership after joins, even if a game changed its slot state.
   * @param {VoiceSocket} socket
   * @returns {void}
   */
  function reconcileSocket(socket) {
    const membership = membershipsBySocket.get(socket);
    if (!membership) return;
    const ownership = resolveVoiceRoomOwnership(socket);
    if (!ownership || membership.roomId !== ownership.roomId || membership.playerId !== ownership.playerId) {
      leave(socket);
    }
  }

  /** @param {string} roomId */
  function pruneStaleVoiceMembers(roomId) {
    for (const membership of [...(membershipsByRoom.get(roomId)?.values() ?? [])]) {
      reconcileSocket(membership.socket);
    }
  }

  /** @param {VoiceSocket} socket @returns {VoiceMembership | null} */
  function requireVoiceMembership(socket) {
    const previousMembership = membershipsBySocket.get(socket);
    const ownership = resolveVoiceRoomOwnership(socket);
    reconcileSocket(socket);
    if (!ownership || previousMembership && !membershipsBySocket.has(socket)) {
      emitVoiceError(socket, "NOT_AUTHORIZED");
      return null;
    }
    if (!previousMembership) {
      emitVoiceError(socket, "NOT_JOINED");
      return null;
    }
    return previousMembership;
  }

  /** @param {VoiceSocket} socket @param {unknown} packet */
  function joinVoiceRoom(socket, packet) {
    const requestId = readVoiceJoinRequestId(packet);
    if (!consumeVoiceRequestBudget(socket, true, requestId)) return;
    if (requestId === undefined || !hasSupportedVoiceKeys(packet, ["version", "requestId"]) ||
        packet.version !== VOICE_PROTOCOL_VERSION) {
      emitVoiceError(socket, "INVALID_PACKET", requestId);
      return;
    }
    reconcileSocket(socket);
    const ownership = resolveVoiceRoomOwnership(socket);
    if (!ownership) {
      emitVoiceError(socket, "NOT_AUTHORIZED", requestId);
      return;
    }
    if (ownership.maxParticipants > VOICE_LIMITS.MAX_PARTICIPANTS) {
      emitVoiceError(socket, "UNSUPPORTED_CAPACITY", requestId);
      return;
    }

    pruneStaleVoiceMembers(ownership.roomId);
    leave(socket);
    let roomMemberships = membershipsByRoom.get(ownership.roomId);
    if ((roomMemberships?.size ?? 0) >= ownership.maxParticipants) {
      emitVoiceError(socket, "ROOM_FULL", requestId);
      return;
    }

    const participantId = createParticipantId();
    if (typeof participantId !== "string" || !/^[A-Za-z\d_-]{1,128}$/.test(participantId) || roomMemberships?.has(participantId)) {
      emitVoiceError(socket, "UNAVAILABLE", requestId);
      return;
    }
    const iceServers = configuration.createIceServers(participantId);
    const participants = [...(roomMemberships?.values() ?? [])].map(describeVoiceParticipant);
    const membership = { id: participantId, playerId: ownership.playerId, roomId: ownership.roomId, socket, muted: true };
    if (!roomMemberships) {
      roomMemberships = new Map();
      membershipsByRoom.set(ownership.roomId, roomMemberships);
    }
    membershipsBySocket.set(socket, membership);
    roomMemberships.set(participantId, membership);

    socket.emit(VOICE_EVENT.READY, {
      version: VOICE_PROTOCOL_VERSION,
      requestId,
      participantId,
      participants,
      iceServers,
      maxParticipants: Math.min(ownership.maxParticipants, VOICE_LIMITS.MAX_PARTICIPANTS),
    });
    announceVoiceParticipantJoined(membership);
  }

  /** @param {VoiceSocket} socket @param {unknown} packet */
  function updateVoiceParticipantState(socket, packet) {
    if (!consumeVoiceRequestBudget(socket)) return;
    if (!hasSupportedVoiceKeys(packet, ["version", "muted"]) ||
        packet.version !== VOICE_PROTOCOL_VERSION || typeof packet.muted !== "boolean") {
      emitVoiceError(socket, "INVALID_PACKET");
      return;
    }
    const membership = requireVoiceMembership(socket);
    if (!membership || membership.muted === packet.muted) return;

    membership.muted = packet.muted;
    pruneStaleVoiceMembers(membership.roomId);
    emitToVoicePeers(membership.roomId, VOICE_EVENT.STATE,
      { version: VOICE_PROTOCOL_VERSION, participantId: membership.id, muted: membership.muted }, membership.id);
  }

  /** @param {VoiceSocket} socket @param {unknown} packet */
  function forwardVoiceSignal(socket, packet) {
    if (!consumeVoiceRequestBudget(socket)) return;
    const signal = sanitizeVoiceSignal(packet);
    if (!signal) {
      emitVoiceError(socket, "INVALID_PACKET");
      return;
    }
    const sender = requireVoiceMembership(socket);
    if (!sender) return;

    pruneStaleVoiceMembers(sender.roomId);
    const target = membershipsByRoom.get(sender.roomId)?.get(signal.to);
    if (!target || target === sender) {
      emitVoiceError(socket, "INVALID_TARGET");
      return;
    }
    target.socket.emit(VOICE_EVENT.SIGNAL, {
      version: VOICE_PROTOCOL_VERSION,
      from: sender.id,
      ...(signal.description ? { description: signal.description } : { candidate: signal.candidate }),
    });
  }

  return {
    createSocketHandlers(socket) {
      return {
        [VOICE_EVENT.JOIN]: (packet) => joinVoiceRoom(socket, packet),
        [VOICE_EVENT.STATE]: (packet) => updateVoiceParticipantState(socket, packet),
        [VOICE_EVENT.SIGNAL]: (packet) => forwardVoiceSignal(socket, packet),
        [VOICE_EVENT.LEAVE]: (packet) => {
          if (isVoiceLifecyclePacket(packet)) {
            leave(socket);
          } else if (consumeVoiceRequestBudget(socket)) {
            emitVoiceError(socket, "INVALID_PACKET");
          }
        },
      };
    },
    leave,
    reconcileSocket,
  };
}
