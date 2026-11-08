/** Room voice uses gameplay transport for small setup messages, never media. */
export const VOICE_PROTOCOL_VERSION = 1;

export const VOICE_EVENT = Object.freeze({
  JOIN: "platform:voice:join",
  READY: "platform:voice:ready",
  PEER_JOINED: "platform:voice:peer-joined",
  PEER_LEFT: "platform:voice:peer-left",
  STATE: "platform:voice:state",
  SIGNAL: "platform:voice:signal",
  LEAVE: "platform:voice:leave",
  ERROR: "platform:voice:error",
});

export const VOICE_LIMITS = Object.freeze({
  MAX_PARTICIPANTS: 4,
  MAX_SDP_LENGTH: 16384,
  MAX_CANDIDATE_LENGTH: 2048,
  MAX_PENDING_CANDIDATES: 32,
  AUDIO_BITRATE_BPS: 24000,
  JOIN_TIMEOUT_MS: 10000,
  CONNECTION_TIMEOUT_MS: 20000,
});

/**
 * @typedef {{urls:string|string[],username?:string,credential?:string}} VoiceIceServer
 * @typedef {"invalid-packet"|"not-authorized"|"not-joined"|"invalid-target"|"unsupported-capacity"|"room-full"|"rate-limit"|"unavailable"|"UNSUPPORTED"|"INSECURE_CONTEXT"|"TRANSPORT_DISCONNECTED"|"MICROPHONE_PERMISSION_DENIED"|"MICROPHONE_UNAVAILABLE"|"MICROPHONE_ENDED"|"JOIN_TIMEOUT"|"CONNECTION_FAILED"|"VOICE_LOAD_FAILED"|"VOICE_ACTION_FAILED"} VoiceErrorCode
 * @typedef {{id:string,playerId:string,muted:boolean}} VoiceParticipant
 * @typedef {{version:1,requestId:string}} VoiceJoinPacket
 * @typedef {{version:1}} VoiceLeavePacket
 * @typedef {{version:1,muted:boolean}} VoiceStateRequest
 * @typedef {{version:1,participantId:string,muted:boolean}} VoiceStatePacket
 * @typedef {{version:1,participant:VoiceParticipant,iceServers:VoiceIceServer[]}} VoicePeerJoinedPacket
 * @typedef {{version:1,participantId:string}} VoicePeerLeftPacket
 * @typedef {{type:"offer"|"answer",sdp:string}} VoiceDescription
 * @typedef {{candidate:string,sdpMid:string|null,sdpMLineIndex:number|null,usernameFragment?:string|null}} VoiceCandidate
 * @typedef {{version:1,to:string,description?:VoiceDescription,candidate?:VoiceCandidate}} OutgoingVoiceSignal
 * @typedef {{version:1,from:string,description?:VoiceDescription,candidate?:VoiceCandidate}} IncomingVoiceSignal
 * @typedef {{version:1,requestId:string,participantId:string,participants:VoiceParticipant[],iceServers:VoiceIceServer[],maxParticipants:number}} VoiceReadyPacket
 * @typedef {{version:1,requestId?:string,code:VoiceErrorCode,message:string}} VoiceErrorPacket
 * @typedef {"off"|"joining"|"waiting"|"connecting"|"connected"|"error"|"unsupported"} VoiceStatus
 * @typedef {VoiceParticipant & {connectionState?:"connecting"|"connected"|"failed"}} VoicePeerState
 * @typedef {{status:VoiceStatus,microphoneMuted:boolean,deafened:boolean,volume:number,participants:VoicePeerState[],playbackBlocked:boolean,errorCode:VoiceErrorCode|null,errorMessage:string,noiseSuppression:boolean|null,echoCancellation:boolean|null,autoGainControl:boolean|null}} VoiceChatState
 */
