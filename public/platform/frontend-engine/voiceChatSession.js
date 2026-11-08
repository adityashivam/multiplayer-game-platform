import { SOCKET_EVENT } from "../shared/networkProtocol.js";
import { VOICE_EVENT, VOICE_LIMITS, VOICE_PROTOCOL_VERSION } from "../shared/voiceProtocol.js";
import {
  applyVoiceOpusPreferences,
  configureVoiceTrack,
  getVoiceMediaConstraints,
  limitVoiceSenderBitrate,
  preferVoiceAudioCodecs,
} from "./voiceAudio.js";

/** @typedef {import("../shared/voiceProtocol.js").VoiceChatState} VoiceChatState */
/** @typedef {import("../shared/voiceProtocol.js").VoiceParticipant} VoiceParticipant */
/** @typedef {import("../shared/voiceProtocol.js").VoiceCandidate} VoiceCandidate */
/** @typedef {import("../shared/voiceProtocol.js").VoiceDescription} VoiceDescription */
/** @typedef {import("../shared/voiceProtocol.js").VoiceErrorCode} VoiceErrorCode */
/** @typedef {"platform:voice:join"|"platform:voice:leave"|"platform:voice:state"|"platform:voice:signal"} OutgoingVoiceEvent */
/** @typedef {import("../shared/voiceProtocol.js").VoiceJoinPacket|import("../shared/voiceProtocol.js").VoiceLeavePacket|import("../shared/voiceProtocol.js").VoiceStateRequest|import("../shared/voiceProtocol.js").OutgoingVoiceSignal} OutgoingVoicePacket */

/**
 * @typedef {{
 *   "platform:voice:ready":import("../shared/voiceProtocol.js").VoiceReadyPacket,
 *   "platform:voice:signal":import("../shared/voiceProtocol.js").IncomingVoiceSignal,
 *   "platform:voice:peer-joined":import("../shared/voiceProtocol.js").VoicePeerJoinedPacket,
 *   "platform:voice:peer-left":import("../shared/voiceProtocol.js").VoicePeerLeftPacket,
 *   "platform:voice:state":import("../shared/voiceProtocol.js").VoiceStatePacket,
 *   "platform:voice:error":import("../shared/voiceProtocol.js").VoiceErrorPacket,
 *   disconnect:string|undefined,
 * }} VoiceTransportEventMap
 */

/**
 * @typedef {object} VoiceTransport
 * @property {<EventName extends keyof VoiceTransportEventMap>(event:EventName,listener:(packet:VoiceTransportEventMap[EventName])=>void)=>()=>void} onEvent
 * @property {(event:OutgoingVoiceEvent,packet:OutgoingVoicePacket)=>void} send
 * @property {()=>boolean} isConnected
 */

/**
 * @typedef {object} VoiceSessionOptions
 * @property {VoiceTransport} transport Existing authoritative game-room socket.
 * @property {(voiceState:VoiceChatState)=>void} [onStateChange] Low-rate owned state snapshots.
 * @property {typeof RTCPeerConnection} [PeerConnection]
 * @property {MediaDevices} [mediaDevices]
 * @property {typeof RTCRtpSender} [Sender]
 * @property {(participantId:string)=>HTMLAudioElement} [createAudioElement] Session owns cleanup of returned elements.
 * @property {(tracks:MediaStreamTrack[])=>MediaStream} [createMediaStream]
 * @property {typeof globalThis.setTimeout} [setTimeout]
 * @property {typeof globalThis.clearTimeout} [clearTimeout]
 * @property {boolean} [isSecureContext]
 */

/**
 * @typedef {object} VoicePeer
 * @property {VoiceParticipant} participant
 * @property {RTCPeerConnection} connection
 * @property {RTCRtpTransceiver} transceiver
 * @property {number} generation
 * @property {boolean} offerer
 * @property {boolean} failed
 * @property {"connecting"|"connected"|"failed"} connectionState
 * @property {Promise<void>} operations
 * @property {VoiceCandidate[]} pendingCandidates
 * @property {boolean} drainingCandidates
 * @property {boolean} pendingDescription
 * @property {ReturnType<typeof setTimeout>|null} connectionTimer
 * @property {HTMLAudioElement|null} audioElement
 * @property {boolean} playbackBlocked
 */

const VOICE_CLIENT_ERROR = Object.freeze({
  UNSUPPORTED: "UNSUPPORTED",
  INSECURE_CONTEXT: "INSECURE_CONTEXT",
  TRANSPORT_DISCONNECTED: "TRANSPORT_DISCONNECTED",
  MICROPHONE_PERMISSION_DENIED: "MICROPHONE_PERMISSION_DENIED",
  MICROPHONE_UNAVAILABLE: "MICROPHONE_UNAVAILABLE",
  MICROPHONE_ENDED: "MICROPHONE_ENDED",
  JOIN_TIMEOUT: "JOIN_TIMEOUT",
  CONNECTION_FAILED: "CONNECTION_FAILED",
});
const VOICE_STALE_TARGET_ERROR_CODE = "invalid-target";
let nextVoiceJoinSequence = 0;

/** Correlate responses across rapid leave/rejoin without using room identity. */
function createVoiceJoinRequestId() {
  nextVoiceJoinSequence += 1;
  const requestNonce = globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
  return `${nextVoiceJoinSequence.toString(36)}-${requestNonce}`;
}

/** @param {string} participantId @returns {HTMLAudioElement} */
function createOwnedVoiceAudioElement(participantId) {
  const audioElement = document.createElement("audio");
  audioElement.hidden = true;
  audioElement.autoplay = true;
  audioElement.setAttribute("playsinline", "");
  audioElement.setAttribute("data-platform-voice-peer", participantId);
  document.body.append(audioElement);
  return audioElement;
}

/** @param {MediaStream|null} microphoneStream */
function stopMicrophoneStream(microphoneStream) {
  for (const microphoneTrack of microphoneStream?.getTracks() || []) {
    microphoneTrack.stop();
  }
}

/** @param {unknown} participant @returns {participant is VoiceParticipant} */
function isVoiceParticipant(participant) {
  if (!participant || typeof participant !== "object") {
    return false;
  }
  const voiceParticipant = /** @type {Partial<VoiceParticipant>} */ (participant);
  return typeof voiceParticipant.id === "string" && voiceParticipant.id.length > 0
    && typeof voiceParticipant.playerId === "string" && typeof voiceParticipant.muted === "boolean";
}

/** @param {unknown} description @returns {description is VoiceDescription} */
function isVoiceDescription(description) {
  if (!description || typeof description !== "object") {
    return false;
  }
  const voiceDescription = /** @type {Partial<VoiceDescription>} */ (description);
  return (voiceDescription.type === "offer" || voiceDescription.type === "answer")
    && typeof voiceDescription.sdp === "string" && voiceDescription.sdp.length <= VOICE_LIMITS.MAX_SDP_LENGTH
    && /^m=audio /m.test(voiceDescription.sdp) && !/^m=(?!audio )/m.test(voiceDescription.sdp);
}

/** @param {unknown} candidate @returns {candidate is VoiceCandidate} */
function isVoiceCandidate(candidate) {
  if (!candidate || typeof candidate !== "object") {
    return false;
  }
  const voiceCandidate = /** @type {Partial<VoiceCandidate>} */ (candidate);
  return typeof voiceCandidate.candidate === "string" && voiceCandidate.candidate.length <= VOICE_LIMITS.MAX_CANDIDATE_LENGTH
    && (voiceCandidate.sdpMid === null || typeof voiceCandidate.sdpMid === "string")
    && (voiceCandidate.sdpMLineIndex === null || Number.isInteger(voiceCandidate.sdpMLineIndex));
}

/** @param {unknown} microphoneError @returns {{code:VoiceErrorCode,message:string}} */
function describeMicrophoneError(microphoneError) {
  const errorName = microphoneError && typeof microphoneError === "object" && "name" in microphoneError
    ? microphoneError.name : null;
  if (errorName === "NotAllowedError" || errorName === "SecurityError") {
    return { code: VOICE_CLIENT_ERROR.MICROPHONE_PERMISSION_DENIED, message: "Microphone access was denied. Allow access or join listen only." };
  }
  return { code: VOICE_CLIENT_ERROR.MICROPHONE_UNAVAILABLE, message: "A microphone is unavailable. Check your device or join listen only." };
}

/**
 * Own optional room voice independently of rendering and gameplay. Only explicit
 * join/unmute calls capture media. Leaving invalidates every in-flight promise;
 * reconnect requires another explicit join. Errors are published in state and
 * async public operations resolve, keeping browser failures out of game flows.
 * @param {VoiceSessionOptions} options
 */
export function createVoiceChatSession({
  transport,
  onStateChange = () => {},
  PeerConnection = globalThis.RTCPeerConnection,
  mediaDevices = globalThis.navigator?.mediaDevices,
  Sender = globalThis.RTCRtpSender,
  createAudioElement = createOwnedVoiceAudioElement,
  createMediaStream = (tracks) => new MediaStream(tracks),
  setTimeout: scheduleTimeout = globalThis.setTimeout.bind(globalThis),
  clearTimeout: cancelTimeout = globalThis.clearTimeout.bind(globalThis),
  isSecureContext = globalThis.isSecureContext !== false,
}) {
  const unsupportedCode = !isSecureContext
    ? VOICE_CLIENT_ERROR.INSECURE_CONTEXT
    : typeof PeerConnection !== "function" ? VOICE_CLIENT_ERROR.UNSUPPORTED : null;
  const unsupportedMessage = unsupportedCode === VOICE_CLIENT_ERROR.INSECURE_CONTEXT
    ? "Voice requires HTTPS or localhost."
    : "This browser does not support room voice.";
  /** @type {VoiceChatState} */
  let voiceState = {
    status: unsupportedCode ? "unsupported" : "off",
    microphoneMuted: true,
    deafened: false,
    volume: 1,
    participants: [],
    playbackBlocked: false,
    errorCode: unsupportedCode,
    errorMessage: unsupportedCode ? unsupportedMessage : "",
    noiseSuppression: null,
    echoCancellation: null,
    autoGainControl: null,
  };
  /** @type {Map<string,VoicePeer>} */
  const peers = new Map();
  /** @type {MediaStream|null} */
  let microphoneStream = null;
  /** @type {MediaStreamTrack|null} */
  let microphoneTrack = null;
  /** @type {Promise<MediaStreamTrack|null>|null} */
  let capturePromise = null;
  /** @type {Promise<void>|null} */
  let joinPromise = null;
  /** @type {ReturnType<typeof setTimeout>|null} */
  let joinTimer = null;
  /** @type {RTCIceServer[]} */
  let iceServers = [];
  let maxParticipants = VOICE_LIMITS.MAX_PARTICIPANTS;
  let participantId = null;
  let joinRequestId = null;
  let generation = 0;
  let requestedJoin = false;
  let joinSent = false;
  let desiredMicrophoneMuted = true;
  let disposed = false;

  /** Return an owned snapshot so callers cannot mutate session state. */
  function getState() {
    return { ...voiceState, participants: voiceState.participants.map((participant) => ({ ...participant })) };
  }

  /** @param {Partial<VoiceChatState>} patch */
  function publishState(patch) {
    voiceState = { ...voiceState, ...patch };
    onStateChange(getState());
  }

  /** @param {number} expectedGeneration */
  function isCurrentSession(expectedGeneration) {
    return !disposed && requestedJoin && expectedGeneration === generation;
  }

  /** @param {VoicePeer} peer */
  function isCurrentPeer(peer) {
    return isCurrentSession(peer.generation) && peers.get(peer.participant.id) === peer && !peer.failed;
  }

  /** Transport failures must never interrupt local media cleanup. @param {OutgoingVoiceEvent} event @param {OutgoingVoicePacket} packet @returns {boolean} */
  function sendVoicePacket(event, packet) {
    if (!transport.isConnected()) {
      return false;
    }
    try {
      transport.send(event, packet);
      return true;
    } catch {
      return false;
    }
  }

  function clearJoinTimer() {
    if (joinTimer !== null) {
      cancelTimeout(joinTimer);
      joinTimer = null;
    }
  }

  /** @param {VoicePeer} peer */
  function clearPeerTimer(peer) {
    if (peer.connectionTimer !== null) {
      cancelTimeout(peer.connectionTimer);
      peer.connectionTimer = null;
    }
  }

  /** Release only resources owned by this peer; another peer remains active. @param {VoicePeer} peer */
  function disposePeerResources(peer) {
    clearPeerTimer(peer);
    peer.pendingCandidates.length = 0;
    peer.connection.onicecandidate = null;
    peer.connection.onconnectionstatechange = null;
    peer.connection.oniceconnectionstatechange = null;
    peer.connection.ontrack = null;
    peer.connection.close();
    if (peer.audioElement) {
      peer.audioElement.pause();
      peer.audioElement.srcObject = null;
      peer.audioElement.remove();
      peer.audioElement = null;
    }
    peer.playbackBlocked = false;
  }

  /**
   * Invalidate pending capture/negotiation before releasing owned resources.
   * @param {{notifyServer?:boolean,status?:import("../shared/voiceProtocol.js").VoiceStatus,errorCode?:VoiceErrorCode|null,errorMessage?:string}} [options]
   */
  function stopVoice({ notifyServer = true, status = "off", errorCode = null, errorMessage = "" } = {}) {
    const sendLeave = joinSent && notifyServer && transport.isConnected();
    requestedJoin = false;
    joinSent = false;
    participantId = null;
    joinRequestId = null;
    generation += 1;
    clearJoinTimer();
    capturePromise = null;
    joinPromise = null;
    desiredMicrophoneMuted = true;
    microphoneTrack?.removeEventListener?.("ended", receiveMicrophoneEnded);
    stopMicrophoneStream(microphoneStream);
    microphoneTrack = null;
    microphoneStream = null;
    for (const peer of peers.values()) {
      disposePeerResources(peer);
    }
    peers.clear();
    if (sendLeave) {
      sendVoicePacket(VOICE_EVENT.LEAVE, { version: VOICE_PROTOCOL_VERSION });
    }
    publishState({
      status, errorCode, errorMessage, microphoneMuted: true, participants: [],
      playbackBlocked: false, noiseSuppression: null, echoCancellation: null, autoGainControl: null,
    });
  }

  /** Rebuild low-rate presentation state after peer lifecycle events. */
  function publishPeerStates() {
    if (!requestedJoin) {
      return;
    }
    const activePeers = [...peers.values()];
    const hasConnectingPeer = activePeers.some((peer) => peer.connectionState === "connecting");
    const hasConnectedPeer = activePeers.some((peer) => peer.connectionState === "connected");
    const status = !participantId ? "joining" : activePeers.length === 0 ? "waiting"
      : hasConnectingPeer ? "connecting" : hasConnectedPeer ? "connected" : "error";
    publishState({
      status,
      participants: activePeers.map((peer) => ({ ...peer.participant, connectionState: peer.connectionState })),
      playbackBlocked: activePeers.some((peer) => peer.playbackBlocked),
    });
  }

  /** @param {VoicePeer} peer */
  function reportPeerConnectionFailure(peer) {
    if (!isCurrentPeer(peer)) {
      return;
    }
    peer.failed = true;
    peer.connectionState = "failed";
    disposePeerResources(peer);
    publishState({
      errorCode: VOICE_CLIENT_ERROR.CONNECTION_FAILED,
      errorMessage: `Voice connection to Player ${peer.participant.playerId} failed. Leave and rejoin to try again; a relay may be required on this network.`,
    });
    publishPeerStates();
  }

  /** Serialize SDP, sender changes and ICE without allowing stale work to send. @param {VoicePeer} peer @param {()=>Promise<void>} operation */
  function queuePeerOperation(peer, operation) {
    peer.operations = peer.operations.then(async () => {
      if (isCurrentPeer(peer)) {
        await operation();
      }
    }).catch(() => reportPeerConnectionFailure(peer));
    return peer.operations;
  }

  function sendMicrophoneState() {
    if (requestedJoin && participantId && transport.isConnected()) {
      sendVoicePacket(VOICE_EVENT.STATE, { version: VOICE_PROTOCOL_VERSION, muted: voiceState.microphoneMuted });
    }
  }

  /** A lost device leaves listening active; recapture always needs explicit unmute. */
  function receiveMicrophoneEnded() {
    if (!requestedJoin || !microphoneTrack) {
      return;
    }
    microphoneTrack.removeEventListener?.("ended", receiveMicrophoneEnded);
    stopMicrophoneStream(microphoneStream);
    microphoneTrack = null;
    microphoneStream = null;
    desiredMicrophoneMuted = true;
    for (const peer of peers.values()) {
      queuePeerOperation(peer, async () => { await peer.transceiver.sender.replaceTrack(null); });
    }
    publishState({
      microphoneMuted: true,
      errorCode: VOICE_CLIENT_ERROR.MICROPHONE_ENDED,
      errorMessage: "The microphone disconnected. Unmute to try again, or continue listening.",
      noiseSuppression: null, echoCancellation: null, autoGainControl: null,
    });
    sendMicrophoneState();
  }

  /** Late permission results are stopped before they can become owned media. @param {number} expectedGeneration */
  async function captureMicrophone(expectedGeneration) {
    if (microphoneTrack?.readyState === "live") {
      return microphoneTrack;
    }
    if (capturePromise) {
      return capturePromise;
    }

    const pendingCapture = (async () => {
      if (!mediaDevices?.getUserMedia) {
        throw new Error("Microphone capture is unavailable.");
      }
      const capturedStream = await mediaDevices.getUserMedia(getVoiceMediaConstraints());
      if (!isCurrentSession(expectedGeneration)) {
        stopMicrophoneStream(capturedStream);
        return null;
      }
      const capturedTrack = capturedStream.getAudioTracks()[0];
      if (!capturedTrack || capturedTrack.readyState === "ended") {
        stopMicrophoneStream(capturedStream);
        throw new Error("No live microphone track was returned.");
      }

      microphoneStream = capturedStream;
      microphoneTrack = capturedTrack;
      capturedTrack.enabled = !desiredMicrophoneMuted;
      capturedTrack.addEventListener?.("ended", receiveMicrophoneEnded);
      publishState({
        microphoneMuted: desiredMicrophoneMuted,
        ...configureVoiceTrack(capturedTrack),
        ...(voiceState.errorCode?.startsWith("MICROPHONE_") ? { errorCode: null, errorMessage: "" } : {}),
      });
      await Promise.all([...peers.values()].map((peer) => queuePeerOperation(peer, async () => {
        await peer.transceiver.sender.replaceTrack(capturedTrack);
        if (isCurrentPeer(peer) && peer.connection.signalingState === "stable") {
          await limitVoiceSenderBitrate(peer.transceiver.sender);
        }
      })));
      return isCurrentSession(expectedGeneration) ? capturedTrack : null;
    })();
    capturePromise = pendingCapture;
    try {
      return await pendingCapture;
    } finally {
      if (capturePromise === pendingCapture) {
        capturePromise = null;
      }
    }
  }

  /** @param {VoicePeer} peer @returns {Promise<void>} */
  async function playPeerAudio(peer) {
    const audioElement = peer.audioElement;
    if (!isCurrentPeer(peer) || !audioElement) {
      return;
    }
    try {
      await audioElement.play();
      if (isCurrentPeer(peer) && peer.audioElement === audioElement) {
        peer.playbackBlocked = false;
        publishPeerStates();
      }
    } catch {
      if (isCurrentPeer(peer) && peer.audioElement === audioElement) {
        peer.playbackBlocked = true;
        publishPeerStates();
      }
    }
  }

  /** @param {VoicePeer} peer */
  function applyIncomingAudioPreferences(peer) {
    if (peer.audioElement) {
      peer.audioElement.muted = voiceState.deafened;
      peer.audioElement.volume = voiceState.volume;
    }
  }

  /** @param {VoicePeer} peer @param {RTCTrackEvent} trackEvent */
  function receivePeerAudioTrack(peer, trackEvent) {
    if (!isCurrentPeer(peer) || trackEvent.track.kind !== "audio") {
      return;
    }
    if (!peer.audioElement) {
      peer.audioElement = createAudioElement(peer.participant.id);
    }
    peer.audioElement.srcObject = trackEvent.streams?.[0] || createMediaStream([trackEvent.track]);
    applyIncomingAudioPreferences(peer);
    void playPeerAudio(peer);
  }

  /** @param {VoicePeer} peer @param {VoiceDescription} description */
  function sendPeerDescription(peer, description) {
    if (isCurrentPeer(peer) && transport.isConnected()) {
      sendVoicePacket(VOICE_EVENT.SIGNAL, {
        version: VOICE_PROTOCOL_VERSION,
        to: peer.participant.id,
        description: { type: description.type, sdp: description.sdp },
      });
    }
  }

  /**
   * A native answerer can create a new transceiver for an incoming offer rather
   * than associate the one prepared before SDP. Use the negotiated audio sender
   * so later listen-only upgrades do not attach to an unassociated sender.
   * @param {VoicePeer} peer
   */
  async function adoptNegotiatedAudioTransceiver(peer) {
    const negotiatedTransceiver = peer.connection.getTransceivers?.().find((transceiver) => (
      transceiver.mid != null && transceiver.receiver?.track?.kind === "audio"
    ));
    if (negotiatedTransceiver && negotiatedTransceiver !== peer.transceiver) {
      const unassociatedTransceiver = peer.transceiver;
      peer.transceiver = negotiatedTransceiver;
      await unassociatedTransceiver.sender.replaceTrack(null);
      if (!isCurrentPeer(peer)) {
        return;
      }
      unassociatedTransceiver.stop?.();
    }
    if (!isCurrentPeer(peer)) {
      return;
    }

    peer.transceiver.direction = "sendrecv";
    preferVoiceAudioCodecs(peer.transceiver, Sender);
    await peer.transceiver.sender.replaceTrack(microphoneTrack);
  }

  /** @param {VoicePeer} peer */
  async function flushPeerCandidates(peer) {
    while (isCurrentPeer(peer) && peer.connection.remoteDescription && peer.pendingCandidates.length > 0) {
      await peer.connection.addIceCandidate(peer.pendingCandidates.shift());
    }
  }

  /** @param {VoicePeer} peer */
  function scheduleCandidateDrain(peer) {
    if (peer.drainingCandidates || !peer.connection.remoteDescription) {
      return;
    }
    peer.drainingCandidates = true;
    queuePeerOperation(peer, async () => {
      try {
        await flushPeerCandidates(peer);
      } finally {
        peer.drainingCandidates = false;
      }
    });
  }

  /** @param {VoicePeer} peer */
  function startPeerConnectionTimer(peer) {
    if (peer.connectionTimer === null) {
      peer.connectionTimer = scheduleTimeout(() => reportPeerConnectionFailure(peer), VOICE_LIMITS.CONNECTION_TIMEOUT_MS);
    }
  }

  /** @param {VoicePeer} peer */
  function receivePeerConnectionState(peer) {
    if (!isCurrentPeer(peer)) {
      return;
    }
    const connectionState = peer.connection.connectionState;
    if (connectionState === "failed" || peer.connection.iceConnectionState === "failed") {
      reportPeerConnectionFailure(peer);
      return;
    }
    if (connectionState === "connected") {
      peer.connectionState = "connected";
      clearPeerTimer(peer);
    } else {
      peer.connectionState = "connecting";
      startPeerConnectionTimer(peer);
    }
    publishPeerStates();
  }

  /** @param {VoiceParticipant} participant */
  function addVoicePeer(participant) {
    if (!requestedJoin || !participantId || !isVoiceParticipant(participant)
      || participant.id === participantId || peers.has(participant.id) || peers.size >= maxParticipants - 1) {
      return;
    }

    let connection = null;
    let registeredPeer = false;
    try {
      connection = new PeerConnection({ iceServers });
      const transceiver = connection.addTransceiver(microphoneTrack || "audio", {
        direction: "sendrecv",
        ...(microphoneStream ? { streams: [microphoneStream] } : {}),
      });
      preferVoiceAudioCodecs(transceiver, Sender);
      /** @type {VoicePeer} */
      const peer = {
        participant: { id: participant.id, playerId: participant.playerId, muted: participant.muted },
        connection, transceiver, generation, offerer: participantId < participant.id,
        failed: false, connectionState: "connecting", operations: Promise.resolve(),
        pendingCandidates: [], drainingCandidates: false, pendingDescription: false,
        connectionTimer: null, audioElement: null, playbackBlocked: false,
      };
      peers.set(participant.id, peer);
      registeredPeer = true;
      connection.onconnectionstatechange = () => receivePeerConnectionState(peer);
      connection.oniceconnectionstatechange = () => receivePeerConnectionState(peer);
      connection.ontrack = (trackEvent) => receivePeerAudioTrack(peer, trackEvent);
      connection.onicecandidate = (candidateEvent) => {
        if (!isCurrentPeer(peer) || !candidateEvent.candidate || !transport.isConnected()) {
          return;
        }
        const candidate = candidateEvent.candidate;
        sendVoicePacket(VOICE_EVENT.SIGNAL, {
          version: VOICE_PROTOCOL_VERSION,
          to: participant.id,
          candidate: {
            candidate: candidate.candidate,
            sdpMid: candidate.sdpMid,
            sdpMLineIndex: candidate.sdpMLineIndex,
            ...(candidate.usernameFragment !== undefined ? { usernameFragment: candidate.usernameFragment } : {}),
          },
        });
      };
      startPeerConnectionTimer(peer);
      publishPeerStates();
      if (peer.offerer) {
        queuePeerOperation(peer, async () => {
          const offer = await connection.createOffer();
          if (!isCurrentPeer(peer)) {
            return;
          }
          await connection.setLocalDescription({ type: "offer", sdp: applyVoiceOpusPreferences(offer.sdp) });
          sendPeerDescription(peer, connection.localDescription);
        });
      }
    } catch {
      if (connection && !registeredPeer) {
        connection.close();
      }
      stopVoice({ status: "error", errorCode: VOICE_CLIENT_ERROR.CONNECTION_FAILED, errorMessage: "Voice could not create a connection. Rejoin to try again." });
    }
  }

  /** @param {import("../shared/voiceProtocol.js").VoiceReadyPacket} readyPacket */
  function receiveVoiceReady(readyPacket) {
    if (!requestedJoin || !joinSent || participantId || readyPacket?.version !== VOICE_PROTOCOL_VERSION
      || readyPacket.requestId !== joinRequestId
      || typeof readyPacket.participantId !== "string" || !readyPacket.participantId || !Array.isArray(readyPacket.participants)) {
      return;
    }
    clearJoinTimer();
    participantId = readyPacket.participantId;
    iceServers = Array.isArray(readyPacket.iceServers) ? readyPacket.iceServers : [];
    maxParticipants = Number.isInteger(readyPacket.maxParticipants)
      ? Math.max(1, Math.min(VOICE_LIMITS.MAX_PARTICIPANTS, readyPacket.maxParticipants)) : VOICE_LIMITS.MAX_PARTICIPANTS;
    sendMicrophoneState();
    for (const participant of readyPacket.participants.slice(0, maxParticipants - 1)) {
      addVoicePeer(participant);
    }
    publishPeerStates();
  }

  /** @param {import("../shared/voiceProtocol.js").IncomingVoiceSignal} signalPacket */
  function receiveVoiceSignal(signalPacket) {
    if (!requestedJoin || signalPacket?.version !== VOICE_PROTOCOL_VERSION) {
      return;
    }
    const peer = peers.get(signalPacket.from);
    if (!peer || !isCurrentPeer(peer)) {
      return;
    }
    if (signalPacket.candidate && !signalPacket.description && isVoiceCandidate(signalPacket.candidate)) {
      if (peer.pendingCandidates.length < VOICE_LIMITS.MAX_PENDING_CANDIDATES) {
        peer.pendingCandidates.push({ ...signalPacket.candidate });
        scheduleCandidateDrain(peer);
      }
      return;
    }
    if (signalPacket.candidate || !isVoiceDescription(signalPacket.description) || peer.pendingDescription) {
      return;
    }

    const description = { ...signalPacket.description };
    if ((description.type === "offer" && peer.offerer)
      || (description.type === "answer" && (!peer.offerer || peer.connection.signalingState !== "have-local-offer"))) {
      return;
    }
    peer.pendingDescription = true;
    queuePeerOperation(peer, async () => {
      try {
        await peer.connection.setRemoteDescription(description);
        if (!isCurrentPeer(peer)) {
          return;
        }
        if (description.type === "offer") {
          await adoptNegotiatedAudioTransceiver(peer);
        }
        await flushPeerCandidates(peer);
        if (!isCurrentPeer(peer)) {
          return;
        }
        if (description.type === "offer") {
          const answer = await peer.connection.createAnswer();
          if (!isCurrentPeer(peer)) {
            return;
          }
          await peer.connection.setLocalDescription({ type: "answer", sdp: applyVoiceOpusPreferences(answer.sdp) });
          sendPeerDescription(peer, peer.connection.localDescription);
        }
        if (isCurrentPeer(peer)) {
          await limitVoiceSenderBitrate(peer.transceiver.sender);
        }
      } finally {
        peer.pendingDescription = false;
      }
    });
  }

  const subscriptions = [
    transport.onEvent(VOICE_EVENT.READY, receiveVoiceReady),
    transport.onEvent(VOICE_EVENT.SIGNAL, receiveVoiceSignal),
    transport.onEvent(VOICE_EVENT.PEER_JOINED, (peerPacket) => {
      if (peerPacket?.version === VOICE_PROTOCOL_VERSION) {
        if (Array.isArray(peerPacket.iceServers)) {
          iceServers = peerPacket.iceServers;
        }
        addVoicePeer(peerPacket.participant);
      }
    }),
    transport.onEvent(VOICE_EVENT.PEER_LEFT, (peerPacket) => {
      const peer = peerPacket?.version === VOICE_PROTOCOL_VERSION ? peers.get(peerPacket.participantId) : null;
      if (peer) {
        peers.delete(peer.participant.id);
        disposePeerResources(peer);
        publishPeerStates();
      }
    }),
    transport.onEvent(VOICE_EVENT.STATE, (statePacket) => {
      const peer = statePacket?.version === VOICE_PROTOCOL_VERSION ? peers.get(statePacket.participantId) : null;
      if (peer && typeof statePacket.muted === "boolean") {
        peer.participant.muted = statePacket.muted;
        publishPeerStates();
      }
    }),
    transport.onEvent(VOICE_EVENT.ERROR, (errorPacket) => {
      if (requestedJoin && errorPacket?.version === VOICE_PROTOCOL_VERSION
        && typeof errorPacket.code === "string" && typeof errorPacket.message === "string") {
        if (errorPacket.requestId !== undefined && errorPacket.requestId !== joinRequestId) {
          return;
        }
        // A peer can leave while its last ICE/SDP message is still in flight.
        // Target rejection does not revoke this participant's room membership.
        if (errorPacket.code === VOICE_STALE_TARGET_ERROR_CODE) {
          return;
        }
        stopVoice({ status: "error", errorCode: errorPacket.code, errorMessage: errorPacket.message });
      }
    }),
    transport.onEvent(SOCKET_EVENT.DISCONNECT, () => {
      if (requestedJoin) {
        stopVoice({ notifyServer: false, status: "error", errorCode: VOICE_CLIENT_ERROR.TRANSPORT_DISCONNECTED, errorMessage: "Voice disconnected. Rejoin after the game reconnects." });
      }
    }),
  ];

  /** Explicitly join with capture, or receive audio without requesting capture. @param {{listenOnly?:boolean}} [options] @returns {Promise<void>} */
  async function join({ listenOnly = false } = {}) {
    if (disposed) {
      return;
    }
    if (unsupportedCode) {
      publishState({ status: "unsupported", errorCode: unsupportedCode, errorMessage: unsupportedMessage });
      return;
    }
    if (requestedJoin && voiceState.status !== "error") {
      return joinPromise || undefined;
    }
    if (requestedJoin) {
      stopVoice();
    }
    if (!transport.isConnected()) {
      publishState({ status: "error", errorCode: VOICE_CLIENT_ERROR.TRANSPORT_DISCONNECTED, errorMessage: "Connect to a game room before joining voice." });
      return;
    }

    requestedJoin = true;
    generation += 1;
    joinRequestId = createVoiceJoinRequestId();
    const expectedGeneration = generation;
    desiredMicrophoneMuted = listenOnly;
    publishState({ status: "joining", errorCode: null, errorMessage: "", microphoneMuted: true });
    joinTimer = scheduleTimeout(() => {
      if (isCurrentSession(expectedGeneration) && !participantId) {
        stopVoice({ status: "error", errorCode: VOICE_CLIENT_ERROR.JOIN_TIMEOUT, errorMessage: "Voice joining timed out. Try again or join listen only." });
      }
    }, VOICE_LIMITS.JOIN_TIMEOUT_MS);
    joinPromise = (async () => {
      try {
        if (!listenOnly) {
          await captureMicrophone(expectedGeneration);
        }
        if (isCurrentSession(expectedGeneration)) {
          joinSent = true;
          const acceptedJoin = sendVoicePacket(VOICE_EVENT.JOIN, { version: VOICE_PROTOCOL_VERSION, requestId: joinRequestId });
          if (!acceptedJoin) {
            stopVoice({ notifyServer: false, status: "error", errorCode: VOICE_CLIENT_ERROR.TRANSPORT_DISCONNECTED, errorMessage: "Voice setup could not reach the room. Rejoin after the game reconnects." });
          }
        }
      } catch (microphoneError) {
        if (isCurrentSession(expectedGeneration)) {
          const failure = describeMicrophoneError(microphoneError);
          stopVoice({ status: "error", errorCode: failure.code, errorMessage: failure.message });
        }
      }
    })();
    return joinPromise;
  }

  /** Muting retains capture; explicit unmute can acquire a missing device. @param {boolean} muted @returns {Promise<void>} */
  async function setMicrophoneMuted(muted) {
    if (disposed || !requestedJoin) {
      return;
    }
    desiredMicrophoneMuted = Boolean(muted);
    if (desiredMicrophoneMuted) {
      if (microphoneTrack) {
        microphoneTrack.enabled = false;
      }
      publishState({ microphoneMuted: true });
      sendMicrophoneState();
      return;
    }

    const expectedGeneration = generation;
    try {
      const capturedTrack = await captureMicrophone(expectedGeneration);
      if (isCurrentSession(expectedGeneration) && capturedTrack) {
        capturedTrack.enabled = !desiredMicrophoneMuted;
        publishState({ microphoneMuted: desiredMicrophoneMuted });
        sendMicrophoneState();
      }
    } catch (microphoneError) {
      if (isCurrentSession(expectedGeneration)) {
        desiredMicrophoneMuted = true;
        const failure = describeMicrophoneError(microphoneError);
        publishState({ microphoneMuted: true, errorCode: failure.code, errorMessage: failure.message });
        sendMicrophoneState();
      }
    }
  }

  /** @param {boolean} deafened */
  function setDeafened(deafened) {
    if (disposed) {
      return;
    }
    publishState({ deafened: Boolean(deafened) });
    for (const peer of peers.values()) {
      applyIncomingAudioPreferences(peer);
      if (!voiceState.deafened) {
        void playPeerAudio(peer);
      }
    }
  }

  /** Set incoming audio volume, clamped to the supported [0,1] range. @param {number} volume */
  function setVolume(volume) {
    if (disposed || !Number.isFinite(volume)) {
      return;
    }
    publishState({ volume: Math.max(0, Math.min(1, volume)) });
    for (const peer of peers.values()) {
      applyIncomingAudioPreferences(peer);
    }
  }

  /** Call directly from a player gesture to retry browser-blocked playback. */
  async function resumePlayback() {
    await Promise.all([...peers.values()].map(playPeerAudio));
  }

  /** Leave voice without changing the game socket or room. Safe to call repeatedly. */
  function leave() {
    if (!disposed) {
      stopVoice();
    }
  }

  /** Stop capture, audio, timers and transport subscriptions. Safe to call repeatedly. */
  function dispose() {
    if (disposed) {
      return;
    }
    stopVoice();
    disposed = true;
    for (const unsubscribe of subscriptions) {
      unsubscribe();
    }
  }

  return { join, setMicrophoneMuted, setDeafened, setVolume, resumePlayback, leave, dispose, getState };
}
