import test from "node:test";
import assert from "node:assert/strict";
import { createVoiceChatSession } from "../public/platform/frontend-engine/voiceChatSession.js";

const AUDIO_SDP = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=rtpmap:111 opus/48000/2\r\n";
const settleVoice = () => new Promise((resolve) => setImmediate(resolve));

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createMicrophoneStream() {
  const microphoneTrack = new EventTarget();
  Object.assign(microphoneTrack, {
    kind: "audio",
    enabled: true,
    readyState: "live",
    contentHint: "",
    stopCount: 0,
    getSettings: () => ({ noiseSuppression: true, echoCancellation: true, autoGainControl: false }),
    stop() {
      this.readyState = "ended";
      this.stopCount += 1;
    },
  });
  return { getTracks: () => [microphoneTrack], getAudioTracks: () => [microphoneTrack], microphoneTrack };
}

function createVoiceFixture(overrides = {}) {
  const listeners = new Map();
  const sentPackets = [];
  const peerConnections = [];
  const audioElements = [];
  const microphoneRequests = [];
  const scheduledTimers = new Map();
  const stateChanges = [];
  const microphoneStream = createMicrophoneStream();
  let connected = true;
  let nextTimerId = 0;

  class PeerConnection {
    constructor(configuration) {
      this.configuration = configuration;
      this.connectionState = "new";
      this.iceConnectionState = "new";
      this.signalingState = "stable";
      this.remoteDescription = null;
      this.localDescription = null;
      this.operations = [];
      this.candidates = [];
      this.closed = false;
      peerConnections.push(this);
    }

    addTransceiver(trackOrKind, options) {
      this.transceiver = {
        direction: options.direction,
        sender: {
          track: typeof trackOrKind === "string" ? null : trackOrKind,
          replaceTrack: async (track) => { this.transceiver.sender.track = track; },
          getParameters: () => ({ transactionId: "native", encodings: [{}] }),
          setParameters: async (parameters) => { this.senderParameters = parameters; },
        },
        setCodecPreferences: (codecs) => { this.codecPreferences = codecs; },
      };
      return this.transceiver;
    }

    async createOffer() {
      this.operations.push("createOffer");
      return { type: "offer", sdp: AUDIO_SDP };
    }

    async createAnswer() {
      this.operations.push("createAnswer");
      return { type: "answer", sdp: AUDIO_SDP };
    }

    async setLocalDescription(description) {
      this.operations.push(`local:${description.type}`);
      this.localDescription = description;
      this.signalingState = description.type === "offer" ? "have-local-offer" : "stable";
    }

    async setRemoteDescription(description) {
      this.operations.push(`remote:${description.type}`);
      this.remoteDescription = description;
      this.signalingState = description.type === "offer" ? "have-remote-offer" : "stable";
    }

    async addIceCandidate(candidate) {
      assert.ok(this.remoteDescription, "ICE cannot be applied before the remote description");
      this.operations.push("candidate");
      this.candidates.push(candidate);
    }

    close() {
      this.closed = true;
      this.connectionState = "closed";
    }
  }

  const transport = {
    onEvent(event, listener) {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event).add(listener);
      return () => listeners.get(event).delete(listener);
    },
    send(event, packet) {
      sentPackets.push({ event, packet });
    },
    isConnected: () => connected,
  };

  const session = createVoiceChatSession({
    transport,
    onStateChange: (voiceState) => stateChanges.push(voiceState),
    PeerConnection,
    Sender: { getCapabilities: () => ({ codecs: [{ mimeType: "audio/opus", clockRate: 48000, channels: 2 }] }) },
    mediaDevices: {
      getUserMedia: async (constraints) => {
        microphoneRequests.push(constraints);
        return microphoneStream;
      },
    },
    createAudioElement(participantId) {
      const audioElement = {
        participantId,
        muted: false,
        volume: 1,
        srcObject: null,
        removed: false,
        play: async () => {},
        pause() {},
        remove() { this.removed = true; },
      };
      audioElements.push(audioElement);
      return audioElement;
    },
    createMediaStream: (tracks) => ({ getTracks: () => tracks }),
    setTimeout(callback, delayMs) {
      const timerId = ++nextTimerId;
      scheduledTimers.set(timerId, { callback, delayMs });
      return timerId;
    },
    clearTimeout: (timerId) => scheduledTimers.delete(timerId),
    isSecureContext: true,
    ...overrides,
  });

  function receive(event, packet) {
    for (const listener of listeners.get(event) || []) {
      listener(packet);
    }
  }

  return {
    session, transport, sentPackets, peerConnections, audioElements, microphoneStream,
    microphoneRequests, scheduledTimers, stateChanges, listeners, receive,
    ready(participantId = "voice-a", participants = [], readyOverrides = {}) {
      receive("platform:voice:ready", {
        version: 1,
        requestId: sentPackets.findLast(({ event }) => event === "platform:voice:join")?.packet.requestId,
        participantId,
        participants,
        iceServers: [{ urls: "stun:voice.example.test" }],
        maxParticipants: 4,
        ...readyOverrides,
      });
    },
    disconnect() {
      connected = false;
      receive("disconnect", "transport close");
    },
    reconnect() {
      connected = true;
      receive("connect");
    },
    runTimers(delayMs) {
      for (const [timerId, timer] of [...scheduledTimers]) {
        if (timer.delayMs === delayMs) {
          scheduledTimers.delete(timerId);
          timer.callback();
        }
      }
    },
  };
}

test("voice starts off without capturing and listen-only participation does not request a microphone", async () => {
  const voice = createVoiceFixture();
  assert.equal(voice.session.getState().status, "off");
  assert.equal(voice.microphoneRequests.length, 0);
  assert.equal(voice.sentPackets.length, 0);

  await voice.session.join({ listenOnly: true });
  assert.equal(voice.microphoneRequests.length, 0);
  assert.equal(voice.sentPackets.length, 1);
  assert.equal(voice.sentPackets[0].event, "platform:voice:join");
  assert.equal(voice.sentPackets[0].packet.version, 1);
  assert.equal(typeof voice.sentPackets[0].packet.requestId, "string");
  assert.ok(voice.sentPackets[0].packet.requestId.length > 0 && voice.sentPackets[0].packet.requestId.length <= 128);
  voice.ready();
  assert.equal(voice.session.getState().status, "waiting");
  assert.equal(voice.session.getState().microphoneMuted, true);
  assert.deepEqual(voice.sentPackets.at(-1), { event: "platform:voice:state", packet: { version: 1, muted: true } });
  voice.session.dispose();
});

test("explicit microphone join uses browser processing and reports actual settings", async () => {
  const voice = createVoiceFixture();
  await voice.session.join();
  assert.deepEqual(voice.microphoneRequests[0], {
    audio: {
      noiseSuppression: { ideal: true },
      echoCancellation: { ideal: true },
      autoGainControl: { ideal: true },
      channelCount: { ideal: 1 },
    },
    video: false,
  });
  voice.ready();
  assert.equal(voice.microphoneStream.microphoneTrack.contentHint, "speech");
  assert.equal(voice.session.getState().microphoneMuted, false);
  assert.equal(voice.session.getState().noiseSuppression, true);
  assert.equal(voice.session.getState().autoGainControl, false);
  assert.deepEqual(voice.sentPackets.at(-1).packet, { version: 1, muted: false });
  voice.session.dispose();
  assert.equal(voice.microphoneStream.microphoneTrack.stopCount, 1);
});

test("listen-only peers negotiate sendrecv and explicit unmute replaces the existing sender track", async () => {
  const voice = createVoiceFixture();
  await voice.session.join({ listenOnly: true });
  voice.ready("voice-b", [{ id: "voice-a", playerId: "p1", muted: false }]);
  const peerConnection = voice.peerConnections[0];
  assert.equal(peerConnection.transceiver.direction, "sendrecv");
  assert.equal(peerConnection.transceiver.sender.track, null);

  await voice.session.setMicrophoneMuted(false);
  assert.equal(voice.microphoneRequests.length, 1);
  assert.equal(peerConnection.transceiver.sender.track, voice.microphoneStream.microphoneTrack);
  assert.equal(voice.session.getState().microphoneMuted, false);
  assert.equal(peerConnection.operations.includes("createOffer"), false);
  voice.session.dispose();
});

test("only the lower participant ID offers and the other peer answers with bounded Opus settings", async () => {
  const offeringVoice = createVoiceFixture();
  const answeringVoice = createVoiceFixture();
  await offeringVoice.session.join({ listenOnly: true });
  await answeringVoice.session.join({ listenOnly: true });
  offeringVoice.ready("voice-a", [{ id: "voice-b", playerId: "p2", muted: true }]);
  answeringVoice.ready("voice-b", [{ id: "voice-a", playerId: "p1", muted: true }]);
  await settleVoice();

  const offerPacket = offeringVoice.sentPackets.find(({ event }) => event === "platform:voice:signal").packet;
  assert.equal(offerPacket.to, "voice-b");
  assert.equal(offerPacket.description.type, "offer");
  assert.match(offerPacket.description.sdp, /maxaveragebitrate=24000;stereo=0;useinbandfec=1;usedtx=1;cbr=0/);
  assert.equal(answeringVoice.sentPackets.some(({ event }) => event === "platform:voice:signal"), false);

  answeringVoice.receive("platform:voice:signal", { version: 1, from: "voice-a", description: offerPacket.description });
  await settleVoice();
  const answerPacket = answeringVoice.sentPackets.find(({ event }) => event === "platform:voice:signal").packet;
  assert.equal(answerPacket.description.type, "answer");
  offeringVoice.receive("platform:voice:signal", { version: 1, from: "voice-b", description: answerPacket.description });
  await settleVoice();

  for (const voice of [offeringVoice, answeringVoice]) {
    assert.equal(voice.peerConnections[0].senderParameters.encodings[0].maxBitrate, 24000);
    assert.deepEqual(voice.peerConnections[0].configuration.iceServers, [{ urls: "stun:voice.example.test" }]);
    voice.session.dispose();
  }
});

test("answering adopts the negotiated native transceiver before a listen-only microphone upgrade", async () => {
  const voice = createVoiceFixture();
  await voice.session.join({ listenOnly: true });
  voice.ready("voice-z", [{ id: "voice-a", playerId: "p1", muted: false }]);
  const peerConnection = voice.peerConnections[0];
  const unassociatedTransceiver = peerConnection.transceiver;
  let nativeSenderTrack = null;
  const negotiatedTransceiver = {
    mid: "0",
    direction: "recvonly",
    receiver: { track: { kind: "audio" } },
    sender: {
      replaceTrack: async (track) => { nativeSenderTrack = track; },
      getParameters: () => ({ encodings: [{}] }),
      setParameters: async () => {},
    },
    setCodecPreferences() {},
  };
  peerConnection.getTransceivers = () => [unassociatedTransceiver, negotiatedTransceiver];
  voice.receive("platform:voice:signal", { version: 1, from: "voice-a", description: { type: "offer", sdp: AUDIO_SDP } });
  await settleVoice();
  await voice.session.setMicrophoneMuted(false);

  assert.equal(negotiatedTransceiver.direction, "sendrecv");
  assert.equal(nativeSenderTrack, voice.microphoneStream.microphoneTrack);
  voice.session.dispose();
});

test("ICE received before SDP stays bounded and applies only after its remote description", async () => {
  const voice = createVoiceFixture();
  await voice.session.join({ listenOnly: true });
  voice.ready("voice-z", [{ id: "voice-a", playerId: "p1", muted: true }]);
  for (let candidateIndex = 0; candidateIndex < 40; candidateIndex += 1) {
    voice.receive("platform:voice:signal", {
      version: 1,
      from: "voice-a",
      candidate: { candidate: `candidate:${candidateIndex}`, sdpMid: "0", sdpMLineIndex: 0 },
    });
  }
  await settleVoice();
  assert.equal(voice.peerConnections[0].candidates.length, 0);
  voice.receive("platform:voice:signal", { version: 1, from: "voice-a", description: { type: "offer", sdp: AUDIO_SDP } });
  await settleVoice();
  assert.equal(voice.peerConnections[0].candidates.length, 32);
  assert.equal(voice.peerConnections[0].operations[0], "remote:offer");
  assert.equal(voice.peerConnections[0].candidates.at(-1).candidate, "candidate:31");
  voice.session.dispose();
});

test("microphone mute, incoming mute and volume control existing and subsequently attached audio", async () => {
  const voice = createVoiceFixture();
  await voice.session.join();
  voice.ready("voice-z", [{ id: "voice-a", playerId: "p1", muted: false }]);
  voice.session.setDeafened(true);
  voice.session.setVolume(0.35);
  const remoteStream = { getTracks: () => [] };
  voice.peerConnections[0].ontrack({ track: { kind: "audio" }, streams: [remoteStream] });
  await settleVoice();
  assert.equal(voice.audioElements[0].srcObject, remoteStream);
  assert.equal(voice.audioElements[0].muted, true);
  assert.equal(voice.audioElements[0].volume, 0.35);

  await voice.session.setMicrophoneMuted(true);
  assert.equal(voice.microphoneStream.microphoneTrack.enabled, false);
  assert.equal(voice.microphoneStream.microphoneTrack.stopCount, 0);
  assert.deepEqual(voice.sentPackets.at(-1), { event: "platform:voice:state", packet: { version: 1, muted: true } });
  voice.session.setDeafened(false);
  voice.session.setVolume(2);
  assert.equal(voice.audioElements[0].muted, false);
  assert.equal(voice.audioElements[0].volume, 1);
  voice.session.leave();
  assert.equal(voice.audioElements[0].removed, true);
  assert.equal(voice.audioElements[0].srcObject, null);
  assert.equal(voice.peerConnections[0].closed, true);
  voice.session.dispose();
});

test("streamless tracks play through owned audio and blocked autoplay can resume explicitly", async () => {
  const voice = createVoiceFixture();
  await voice.session.join({ listenOnly: true });
  voice.ready("voice-z", [{ id: "voice-a", playerId: "p1", muted: false }]);
  const remoteTrack = { kind: "audio" };
  const peerConnection = voice.peerConnections[0];
  peerConnection.ontrack({ track: remoteTrack, streams: [] });
  voice.audioElements[0].play = async () => { throw new Error("Gesture required"); };
  await voice.session.resumePlayback();
  assert.equal(voice.session.getState().playbackBlocked, true);
  assert.deepEqual(voice.audioElements[0].srcObject.getTracks(), [remoteTrack]);

  voice.audioElements[0].play = async () => {};
  await voice.session.resumePlayback();
  assert.equal(voice.session.getState().playbackBlocked, false);
  voice.session.dispose();
});

test("microphone permission denial ends a pending join without entering the voice room", async () => {
  const voice = createVoiceFixture({
    mediaDevices: { getUserMedia: async () => { throw Object.assign(new Error("Denied"), { name: "NotAllowedError" }); } },
  });
  await voice.session.join();
  assert.equal(voice.session.getState().status, "error");
  assert.equal(voice.session.getState().microphoneMuted, true);
  assert.equal(voice.session.getState().errorCode, "MICROPHONE_PERMISSION_DENIED");
  assert.equal(voice.sentPackets.length, 0);
  assert.equal(voice.scheduledTimers.size, 0);
  voice.session.dispose();
});

test("insecure and unsupported browsers never capture or signal", async () => {
  for (const dependency of [{ isSecureContext: false }, { PeerConnection: null }]) {
    const voice = createVoiceFixture(dependency);
    await voice.session.join();
    assert.equal(voice.session.getState().status, "unsupported");
    assert.equal(voice.sentPackets.length, 0);
    assert.equal(voice.microphoneRequests.length, 0);
    voice.session.dispose();
  }
});

test("join timeout releases capture and late READY cannot restore membership", async () => {
  const voice = createVoiceFixture();
  await voice.session.join();
  voice.runTimers(10000);
  assert.equal(voice.session.getState().errorCode, "JOIN_TIMEOUT");
  assert.equal(voice.microphoneStream.microphoneTrack.stopCount, 1);
  voice.ready("late-voice", [{ id: "voice-a", playerId: "p1", muted: false }]);
  assert.equal(voice.peerConnections.length, 0);
  assert.equal(voice.session.getState().status, "error");
  voice.session.dispose();
});

test("a new explicit join rejects the previous join's delayed READY and ERROR packets", async () => {
  const voice = createVoiceFixture();
  await voice.session.join({ listenOnly: true });
  const oldRequestId = voice.sentPackets[0].packet.requestId;
  voice.session.leave();
  await voice.session.join({ listenOnly: true });
  const currentRequestId = voice.sentPackets.at(-1).packet.requestId;
  assert.notEqual(currentRequestId, oldRequestId);

  voice.ready("stale-participant", [{ id: "stale-peer", playerId: "p1", muted: false }], { requestId: oldRequestId });
  voice.receive("platform:voice:error", { version: 1, requestId: oldRequestId, code: "room-required", message: "Old join failed." });
  assert.equal(voice.session.getState().status, "joining");
  assert.equal(voice.peerConnections.length, 0);

  voice.ready("fresh-participant");
  assert.equal(voice.session.getState().status, "waiting");
  assert.equal(voice.session.getState().errorCode, null);
  voice.session.dispose();
});

test("a later peer uses refreshed recipient ICE credentials without changing existing connections", async () => {
  const voice = createVoiceFixture();
  await voice.session.join({ listenOnly: true });
  voice.ready("voice-z", [{ id: "voice-a", playerId: "p1", muted: false }]);
  voice.receive("platform:voice:peer-joined", {
    version: 1,
    participant: { id: "voice-b", playerId: "p2", muted: false },
    iceServers: [{ urls: "turn:relay.example.test", username: "renewed-recipient", credential: "short-lived" }],
  });
  assert.deepEqual(voice.peerConnections[1].configuration.iceServers, [{
    urls: "turn:relay.example.test", username: "renewed-recipient", credential: "short-lived",
  }]);
  assert.deepEqual(voice.peerConnections[0].configuration.iceServers, [{ urls: "stun:voice.example.test" }]);
  voice.session.dispose();
});

test("leaving during permission capture stops late tracks and cannot signal or update state", async () => {
  const permission = createDeferred();
  const voice = createVoiceFixture({ mediaDevices: { getUserMedia: () => permission.promise } });
  const joinPromise = voice.session.join();
  voice.session.leave();
  const updateCount = voice.stateChanges.length;
  permission.resolve(voice.microphoneStream);
  await joinPromise;
  assert.equal(voice.microphoneStream.microphoneTrack.stopCount, 1);
  assert.equal(voice.sentPackets.length, 0);
  assert.equal(voice.stateChanges.length, updateCount);
  assert.equal(voice.session.getState().status, "off");
  voice.session.dispose();
});

test("late peer negotiation after leave cannot send a description or revive audio", async () => {
  const voice = createVoiceFixture();
  await voice.session.join({ listenOnly: true });
  voice.ready("voice-z", [{ id: "voice-a", playerId: "p1", muted: true }]);
  const delayedAnswer = createDeferred();
  voice.peerConnections[0].createAnswer = () => delayedAnswer.promise;
  voice.receive("platform:voice:signal", { version: 1, from: "voice-a", description: { type: "offer", sdp: AUDIO_SDP } });
  await settleVoice();
  const oldTrackListener = voice.peerConnections[0].ontrack;
  voice.session.leave();
  const sentCount = voice.sentPackets.length;
  delayedAnswer.resolve({ type: "answer", sdp: AUDIO_SDP });
  oldTrackListener({ track: { kind: "audio" }, streams: [] });
  await settleVoice();
  assert.equal(voice.sentPackets.length, sentCount);
  assert.equal(voice.audioElements.length, 0);
  assert.equal(voice.session.getState().status, "off");
  voice.session.dispose();
});

test("peer departure and stale signals are isolated from the other voice peer", async () => {
  const voice = createVoiceFixture();
  await voice.session.join({ listenOnly: true });
  voice.ready("voice-z", [
    { id: "voice-a", playerId: "p1", muted: true },
    { id: "voice-b", playerId: "p2", muted: false },
  ]);
  voice.receive("platform:voice:peer-left", { version: 1, participantId: "voice-a" });
  voice.receive("platform:voice:signal", { version: 1, from: "voice-a", description: { type: "offer", sdp: AUDIO_SDP } });
  voice.receive("platform:voice:signal", { version: 1, from: "unknown", description: { type: "offer", sdp: AUDIO_SDP } });
  voice.receive("platform:voice:state", { version: 1, participantId: "voice-b", muted: true });
  await settleVoice();
  assert.equal(voice.peerConnections.length, 2);
  assert.equal(voice.peerConnections[0].closed, true);
  assert.equal(voice.peerConnections[1].closed, false);
  assert.deepEqual(voice.session.getState().participants, [{ id: "voice-b", playerId: "p2", muted: true, connectionState: "connecting" }]);
  voice.session.dispose();
});

test("an invalid target notice after peer departure preserves capture and unrelated peers", async () => {
  const voice = createVoiceFixture();
  await voice.session.join();
  voice.ready("voice-z", [
    { id: "voice-a", playerId: "p1", muted: false },
    { id: "voice-b", playerId: "p2", muted: false },
  ]);
  voice.receive("platform:voice:peer-left", { version: 1, participantId: "voice-a" });
  voice.receive("platform:voice:error", { version: 1, code: "invalid-target", message: "That voice participant is no longer in your room." });

  assert.equal(voice.microphoneStream.microphoneTrack.stopCount, 0);
  assert.equal(voice.peerConnections[1].closed, false);
  assert.equal(voice.session.getState().status, "connecting");
  assert.equal(voice.session.getState().participants[0].id, "voice-b");
  assert.equal(voice.sentPackets.some(({ event }) => event === "platform:voice:leave"), false);
  voice.session.dispose();
});

test("peer mesh stays bounded to the server capacity and malformed packets are ignored", async () => {
  const voice = createVoiceFixture();
  await voice.session.join({ listenOnly: true });
  voice.ready("voice-z", Array.from({ length: 8 }, (_, index) => ({ id: `voice-${index}`, playerId: `p${index}`, muted: true })));
  voice.receive("platform:voice:peer-joined", { version: 1, participant: { id: "excess", playerId: "p9", muted: true } });
  voice.receive("platform:voice:peer-left", { version: 2, participantId: "voice-0" });
  voice.receive("platform:voice:signal", { version: 1, from: "voice-0", description: { type: "video", sdp: AUDIO_SDP } });
  await settleVoice();
  assert.equal(voice.peerConnections.length, 3);
  assert.equal(voice.peerConnections[0].remoteDescription, null);
  voice.session.dispose();
});

test("connection timeout names the failed peer and explicit retry starts fresh membership", async () => {
  const voice = createVoiceFixture();
  await voice.session.join({ listenOnly: true });
  voice.ready("voice-z", [{ id: "voice-a", playerId: "p1", muted: false }]);
  voice.runTimers(20000);
  assert.equal(voice.session.getState().status, "error");
  assert.equal(voice.session.getState().errorCode, "CONNECTION_FAILED");
  assert.equal(voice.session.getState().participants[0].connectionState, "failed");
  assert.equal(voice.peerConnections[0].closed, true);
  await voice.session.join({ listenOnly: true });
  assert.equal(voice.sentPackets.at(-1).event, "platform:voice:join");
  voice.ready("voice-z2", [{ id: "voice-b", playerId: "p2", muted: false }]);
  assert.equal(voice.peerConnections.length, 2);
  voice.session.dispose();
});

test("connected peers clear deadlines and connection failure never changes the game transport", async () => {
  const voice = createVoiceFixture();
  await voice.session.join({ listenOnly: true });
  voice.ready("voice-z", [{ id: "voice-a", playerId: "p1", muted: false }]);
  const peerConnection = voice.peerConnections[0];
  peerConnection.connectionState = "connected";
  peerConnection.onconnectionstatechange();
  assert.equal(voice.session.getState().status, "connected");
  assert.equal(voice.scheduledTimers.size, 0);
  peerConnection.connectionState = "failed";
  peerConnection.onconnectionstatechange();
  assert.equal(voice.session.getState().errorCode, "CONNECTION_FAILED");
  assert.equal(voice.transport.isConnected(), true);
  voice.session.dispose();
});

test("disconnect releases capture and reconnect requires a new explicit join with fresh peer IDs", async () => {
  const microphoneStream = createMicrophoneStream();
  const voice = createVoiceFixture({ mediaDevices: { getUserMedia: async () => microphoneStream } });
  await voice.session.join();
  voice.ready("voice-old", [{ id: "voice-a", playerId: "p1", muted: false }]);
  voice.disconnect();
  assert.equal(microphoneStream.microphoneTrack.stopCount, 1);
  assert.equal(voice.peerConnections[0].closed, true);
  const sentCount = voice.sentPackets.length;
  voice.reconnect();
  voice.ready("stale-ready");
  await settleVoice();
  assert.equal(voice.sentPackets.length, sentCount);
  await voice.session.join({ listenOnly: true });
  voice.ready("voice-new", [{ id: "voice-new-peer", playerId: "p1", muted: true }]);
  voice.receive("platform:voice:signal", { version: 1, from: "voice-a", description: { type: "offer", sdp: AUDIO_SDP } });
  await settleVoice();
  assert.equal(voice.peerConnections.length, 2);
  assert.equal(voice.peerConnections[1].remoteDescription, null);
  voice.session.dispose();
  assert.equal([...voice.listeners.values()].reduce((count, eventListeners) => count + eventListeners.size, 0), 0);
  assert.equal(voice.scheduledTimers.size, 0);
});

test("microphone ending publishes a muted state while retaining listening until explicit recapture", async () => {
  const replacementStream = createMicrophoneStream();
  let captureCount = 0;
  const voice = createVoiceFixture({ mediaDevices: { getUserMedia: async () => (
    captureCount++ === 0 ? voice.microphoneStream : replacementStream
  ) } });
  await voice.session.join();
  voice.ready();
  voice.microphoneStream.microphoneTrack.readyState = "ended";
  voice.microphoneStream.microphoneTrack.dispatchEvent(new Event("ended"));
  assert.equal(voice.session.getState().status, "waiting");
  assert.equal(voice.session.getState().microphoneMuted, true);
  assert.equal(voice.session.getState().errorCode, "MICROPHONE_ENDED");
  await voice.session.setMicrophoneMuted(false);
  assert.equal(captureCount, 2);
  assert.equal(voice.session.getState().microphoneMuted, false);
  assert.equal(voice.session.getState().errorCode, null);
  voice.session.dispose();
});

test("server errors release pending capture and repeated disposal sends at most one leave", async () => {
  const voice = createVoiceFixture();
  await voice.session.join();
  voice.receive("platform:voice:error", { version: 1, code: "VOICE_FULL", message: "Voice room full." });
  assert.equal(voice.session.getState().errorCode, "VOICE_FULL");
  assert.equal(voice.microphoneStream.microphoneTrack.stopCount, 1);
  voice.session.dispose();
  voice.session.dispose();
  const leavePackets = voice.sentPackets.filter(({ event }) => event === "platform:voice:leave");
  assert.equal(leavePackets.length, 1);
  await voice.session.join();
  assert.equal(voice.microphoneRequests.length, 1);
});

test("a failed native transceiver setup closes the partially created peer and microphone", async () => {
  let failedConnection;
  class UnsupportedAudioConnection {
    constructor() { failedConnection = this; }
    addTransceiver() { throw new Error("Audio transceiver unavailable"); }
    close() { this.closed = true; }
  }
  const voice = createVoiceFixture({ PeerConnection: UnsupportedAudioConnection });
  await voice.session.join();
  voice.ready("voice-z", [{ id: "voice-a", playerId: "p1", muted: false }]);
  assert.equal(failedConnection.closed, true);
  assert.equal(voice.microphoneStream.microphoneTrack.stopCount, 1);
  assert.equal(voice.session.getState().errorCode, "CONNECTION_FAILED");
  voice.session.dispose();
});

test("transport send failures never prevent capture and subscription cleanup", async () => {
  const voice = createVoiceFixture();
  await voice.session.join();
  voice.ready();
  voice.transport.send = () => { throw new Error("Socket unavailable"); };
  assert.doesNotThrow(() => voice.session.dispose());
  assert.equal(voice.microphoneStream.microphoneTrack.stopCount, 1);
  assert.equal(voice.session.getState().status, "off");
  assert.equal([...voice.listeners.values()].reduce((count, eventListeners) => count + eventListeners.size, 0), 0);
});

test("a join send failure reports the transport and releases newly acquired capture", async () => {
  const voice = createVoiceFixture();
  voice.transport.send = () => { throw new Error("Socket unavailable"); };
  await voice.session.join();
  assert.equal(voice.session.getState().errorCode, "TRANSPORT_DISCONNECTED");
  assert.equal(voice.microphoneStream.microphoneTrack.stopCount, 1);
  assert.equal(voice.scheduledTimers.size, 0);
  voice.session.dispose();
});
