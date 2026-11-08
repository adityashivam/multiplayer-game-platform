import test from "node:test";
import assert from "node:assert/strict";
import { createVoiceSignaling } from "../server/platform-backend-engine/core/voiceSignaling.js";
import { createVoiceConfiguration } from "../server/platform-backend-engine/core/voiceConfiguration.js";
import { registerGame } from "../server/platform-backend-engine/core/registerGame.js";
import { VOICE_EVENT } from "../public/platform/shared/voiceProtocol.js";

const AUDIO_DESCRIPTION = { type: "offer", sdp: "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\na=mid:0\r\n" };
const AUDIO_CANDIDATE = {
  candidate: "candidate:1 1 UDP 2122260223 192.0.2.1 5000 typ host",
  sdpMid: "0",
  sdpMLineIndex: 0,
  usernameFragment: "audio-ufrag",
};

function createNamespaceTransport() {
  let connectionListener;
  const namespace = {
    adapter: { rooms: new Map() },
    sockets: new Map(),
    on(eventName, listener) {
      if (eventName === "connection") connectionListener = listener;
    },
    to(roomId) {
      return { emit: (eventName, payload) => emitToRoom(roomId, eventName, payload) };
    },
  };

  function emitToRoom(roomId, eventName, payload, excludedSocketId) {
    for (const socketId of namespace.adapter.rooms.get(roomId) ?? []) {
      if (socketId !== excludedSocketId) namespace.sockets.get(socketId)?.emit(eventName, payload);
    }
  }

  function connectSocket(socketId) {
    const listeners = new Map();
    let joinRequestSequence = 0;
    const socket = {
      id: socketId,
      nsp: namespace,
      data: {},
      connected: true,
      events: [],
      on: (eventName, listener) => listeners.set(eventName, listener),
      emit: (eventName, payload) => socket.events.push({ eventName, payload }),
      to: (roomId) => ({ emit: (eventName, payload) => emitToRoom(roomId, eventName, payload, socketId) }),
      join(roomId) {
        if (!namespace.adapter.rooms.has(roomId)) namespace.adapter.rooms.set(roomId, new Set());
        namespace.adapter.rooms.get(roomId).add(socketId);
      },
      leave: (roomId) => namespace.adapter.rooms.get(roomId)?.delete(socketId),
      receive(eventName, payload) {
        const defaultPacket = eventName === VOICE_EVENT.JOIN
          ? { version: 1, requestId: `${socketId}-join-${++joinRequestSequence}` }
          : { version: 1 };
        return listeners.get(eventName)?.(payload === undefined ? defaultPacket : payload);
      },
    };
    namespace.sockets.set(socketId, socket);
    connectionListener?.(socket);
    return socket;
  }

  return { namespace, connectSocket };
}

function createVoiceHarness({ playerIds = ["west", "east"], nowFn, createParticipantId, configuration } = {}) {
  const transport = createNamespaceTransport();
  const games = new Map();
  const iceRequests = [];
  let participantSequence = 0;
  const voiceSignaling = createVoiceSignaling({
    nsp: transport.namespace,
    games,
    playerIds,
    nowFn,
    createParticipantId: createParticipantId ?? (() => `participant-${++participantSequence}`),
    configuration: {
      createIceServers(participantId) {
        iceRequests.push(participantId);
        return configuration?.createIceServers(participantId) ?? [{ urls: ["stun:discovery.example"] }];
      },
    },
  });

  function connectPlayer(socketId, gameId = "alpha", playerId = playerIds[0]) {
    const socket = transport.connectSocket(socketId);
    for (const [eventName, listener] of Object.entries(voiceSignaling.createSocketHandlers(socket))) {
      socket.on(eventName, listener);
    }
    if (gameId !== null) {
      if (!games.has(gameId)) {
        games.set(gameId, { players: Object.fromEntries(playerIds.map((slotId) => [slotId, { connected: false }])) });
      }
      socket.data.gameId = gameId;
      socket.data.playerId = playerId;
      games.get(gameId).players[playerId].connected = true;
      socket.join(gameId);
    }
    return socket;
  }

  return { ...transport, games, voiceSignaling, connectPlayer, iceRequests };
}

function packetsFor(socket, eventName) {
  return socket.events.filter((socketEvent) => socketEvent.eventName === eventName).map((socketEvent) => socketEvent.payload);
}

function joinVoice(socket) {
  socket.receive(VOICE_EVENT.JOIN);
  return packetsFor(socket, VOICE_EVENT.READY).at(-1)?.participantId;
}

test("voice requires authoritative connected room ownership before revealing ICE access", () => {
  const harness = createVoiceHarness();
  const spectator = harness.connectPlayer("spectator", null);
  spectator.receive(VOICE_EVENT.JOIN);

  assert.equal(packetsFor(spectator, VOICE_EVENT.ERROR)[0].code, "not-authorized");
  assert.deepEqual(packetsFor(spectator, VOICE_EVENT.READY), []);
  assert.deepEqual(harness.iceRequests, []);

  const player = harness.connectPlayer("player");
  harness.namespace.adapter.rooms.get("alpha").delete(player.id);
  player.receive(VOICE_EVENT.JOIN);
  assert.equal(packetsFor(player, VOICE_EVENT.ERROR)[0].code, "not-authorized");
  assert.deepEqual(harness.iceRequests, []);
});

test("voice publishes generic room participants and bounds mesh capacity by game slots", () => {
  const harness = createVoiceHarness({ playerIds: ["pilot", "navigator", "engineer"] });
  const first = harness.connectPlayer("one", "alpha", "pilot");
  const second = harness.connectPlayer("two", "alpha", "navigator");
  assert.equal(joinVoice(first), "participant-1");
  assert.equal(joinVoice(second), "participant-2");

  assert.deepEqual(packetsFor(first, VOICE_EVENT.READY)[0], {
    version: 1,
    requestId: "one-join-1",
    participantId: "participant-1",
    participants: [],
    iceServers: [{ urls: ["stun:discovery.example"] }],
    maxParticipants: 3,
  });
  assert.deepEqual(packetsFor(second, VOICE_EVENT.READY)[0].participants, [
    { id: "participant-1", playerId: "pilot", muted: true },
  ]);
  assert.deepEqual(packetsFor(first, VOICE_EVENT.PEER_JOINED), [{
    version: 1, participant: { id: "participant-2", playerId: "navigator", muted: true },
    iceServers: [{ urls: ["stun:discovery.example"] }],
  }]);
});

test("voice echoes each join request nonce without treating it as participant identity", () => {
  const harness = createVoiceHarness();
  const player = harness.connectPlayer("one");
  player.receive(VOICE_EVENT.JOIN, { version: 1, requestId: "previous-attempt" });
  player.receive(VOICE_EVENT.LEAVE);
  player.receive(VOICE_EVENT.JOIN, { version: 1, requestId: "current-attempt" });

  const readyPackets = packetsFor(player, VOICE_EVENT.READY);
  assert.deepEqual(readyPackets.map((packet) => packet.requestId), ["previous-attempt", "current-attempt"]);
  assert.deepEqual(readyPackets.map((packet) => packet.participantId), ["participant-1", "participant-2"]);
});

test("voice correlates authorization and malformed join errors to validated request nonces", () => {
  const harness = createVoiceHarness();
  const spectator = harness.connectPlayer("spectator", null);
  spectator.receive(VOICE_EVENT.JOIN, { version: 1, requestId: "previous-attempt" });
  spectator.receive(VOICE_EVENT.JOIN, { version: 2, requestId: "current-attempt" });

  assert.deepEqual(packetsFor(spectator, VOICE_EVENT.ERROR).map((packet) => [packet.code, packet.requestId]), [
    ["not-authorized", "previous-attempt"],
    ["invalid-packet", "current-attempt"],
  ]);
});

for (const requestId of [undefined, null, "", "x".repeat(129), "nonce\nline", "non-ascii-\u00e9"]) {
  test(`voice rejects an invalid join nonce ${JSON.stringify(requestId)}`, () => {
    const harness = createVoiceHarness();
    const player = harness.connectPlayer("one");
    player.receive(VOICE_EVENT.JOIN, { version: 1, ...(requestId !== undefined ? { requestId } : {}) });

    assert.equal(packetsFor(player, VOICE_EVENT.ERROR)[0].code, "invalid-packet");
    assert.equal(Object.hasOwn(packetsFor(player, VOICE_EVENT.ERROR)[0], "requestId"), false);
    assert.deepEqual(packetsFor(player, VOICE_EVENT.READY), []);
    assert.deepEqual(harness.iceRequests, []);
  });
}

test("voice echoes the current join request nonce when the membership rate limit rejects it", () => {
  const harness = createVoiceHarness({ nowFn: () => 0 });
  const player = harness.connectPlayer("one");
  for (let joinIndex = 1; joinIndex <= 7; joinIndex += 1) {
    player.receive(VOICE_EVENT.JOIN, { version: 1, requestId: `attempt-${joinIndex}` });
  }

  assert.deepEqual(packetsFor(player, VOICE_EVENT.ERROR).map((packet) => [packet.code, packet.requestId]), [
    ["rate-limit", "attempt-7"],
  ]);
});

test("a late peer receives fresh TURN access for each existing recipient before negotiation", () => {
  let nowMs = 1700000000000;
  const configuration = createVoiceConfiguration({
    env: { VOICE_TURN_URLS: "turn:relay.example", VOICE_TURN_SECRET: "test-only-turn-shared-secret" },
    nowFn: () => nowMs,
  });
  const harness = createVoiceHarness({ nowFn: () => nowMs, configuration });
  const first = harness.connectPlayer("one", "alpha", "west");
  const firstId = joinVoice(first);
  const expiredTurnServer = packetsFor(first, VOICE_EVENT.READY)[0]?.iceServers[1];
  nowMs += 601000;
  const second = harness.connectPlayer("two", "alpha", "east");
  const secondId = joinVoice(second);
  const refreshedTurnServer = packetsFor(first, VOICE_EVENT.PEER_JOINED)[0]?.iceServers?.[1];

  assert.ok(refreshedTurnServer, "Existing recipients need fresh ICE before creating the new peer");
  assert.equal(expiredTurnServer.username, `1700000600:${firstId}`);
  assert.equal(refreshedTurnServer.username, `1700001201:${firstId}`);
  assert.notEqual(refreshedTurnServer.credential, expiredTurnServer.credential);
  assert.equal(packetsFor(second, VOICE_EVENT.READY)[0].iceServers[1].username, `1700001201:${secondId}`);
});

test("voice forwards only audio setup and candidate metadata with server-owned sender identity", () => {
  const harness = createVoiceHarness();
  const first = harness.connectPlayer("one", "alpha", "west");
  const second = harness.connectPlayer("two", "alpha", "east");
  const firstId = joinVoice(first);
  const secondId = joinVoice(second);

  first.receive(VOICE_EVENT.SIGNAL, { version: 1, to: secondId, description: AUDIO_DESCRIPTION });
  second.receive(VOICE_EVENT.SIGNAL, { version: 1, to: firstId, candidate: AUDIO_CANDIDATE });

  assert.deepEqual(packetsFor(second, VOICE_EVENT.SIGNAL), [{ version: 1, from: firstId, description: AUDIO_DESCRIPTION }]);
  assert.deepEqual(packetsFor(first, VOICE_EVENT.SIGNAL), [{ version: 1, from: secondId, candidate: AUDIO_CANDIDATE }]);
  first.receive(VOICE_EVENT.SIGNAL, { version: 1, to: secondId, candidate: { candidate: "", sdpMid: null, sdpMLineIndex: null } });
  assert.deepEqual(packetsFor(second, VOICE_EVENT.SIGNAL).at(-1).candidate,
    { candidate: "", sdpMid: null, sdpMLineIndex: null });
});

test("voice rejects cross-room, unjoined, stale and self targets", () => {
  const harness = createVoiceHarness();
  const first = harness.connectPlayer("one", "alpha", "west");
  const second = harness.connectPlayer("two", "beta", "east");
  const unjoined = harness.connectPlayer("three", "alpha", "east");
  const firstId = joinVoice(first);
  const secondId = joinVoice(second);

  first.receive(VOICE_EVENT.SIGNAL, { version: 1, to: secondId, description: AUDIO_DESCRIPTION });
  first.receive(VOICE_EVENT.SIGNAL, { version: 1, to: firstId, description: AUDIO_DESCRIPTION });
  first.receive(VOICE_EVENT.SIGNAL, { version: 1, to: "old-session", description: AUDIO_DESCRIPTION });
  unjoined.receive(VOICE_EVENT.SIGNAL, { version: 1, to: firstId, description: AUDIO_DESCRIPTION });

  assert.deepEqual(packetsFor(first, VOICE_EVENT.ERROR).map((packet) => packet.code),
    ["invalid-target", "invalid-target", "invalid-target"]);
  assert.equal(packetsFor(unjoined, VOICE_EVENT.ERROR)[0].code, "not-joined");
  assert.deepEqual(packetsFor(second, VOICE_EVENT.SIGNAL), []);
  assert.deepEqual(packetsFor(first, VOICE_EVENT.SIGNAL), []);
});

for (const [description, signalFields] of [
  ["unknown protocol versions", { version: 2, description: AUDIO_DESCRIPTION }],
  ["forged sender identities", { description: AUDIO_DESCRIPTION, from: "forged" }],
  ["raw media payloads", { media: new Uint8Array([1, 2, 3]) }],
  ["two signal kinds", { description: AUDIO_DESCRIPTION, candidate: AUDIO_CANDIDATE }],
  ["oversized SDP", { description: { type: "offer", sdp: `v=0\r\nm=audio 9 RTP/SAVPF 111\r\na=${"x".repeat(16384)}` } }],
  ["video descriptions", { description: { type: "offer", sdp: "v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\n" } }],
  ["data channels", { description: { type: "offer", sdp: "v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n" } }],
  ["audio plus video", { description: { type: "offer", sdp: `${AUDIO_DESCRIPTION.sdp}m=video 9 UDP/TLS/RTP/SAVPF 96\r\n` } }],
  ["multiple audio tracks", { description: { type: "offer", sdp: AUDIO_DESCRIPTION.sdp.repeat(2) } }],
  ["unsupported description types", { description: { type: "rollback", sdp: AUDIO_DESCRIPTION.sdp } }],
  ["extra description fields", { description: { ...AUDIO_DESCRIPTION, media: "hidden-payload" } }],
  ["oversized candidates", { candidate: { ...AUDIO_CANDIDATE, candidate: "x".repeat(2049) } }],
  ["non-audio candidate indices", { candidate: { ...AUDIO_CANDIDATE, sdpMLineIndex: 1 } }],
  ["oversized candidate usernames", { candidate: { ...AUDIO_CANDIDATE, usernameFragment: "x".repeat(257) } }],
]) {
  test(`voice rejects ${description} before forwarding`, () => {
    const harness = createVoiceHarness();
    const first = harness.connectPlayer("one", "alpha", "west");
    const second = harness.connectPlayer("two", "alpha", "east");
    joinVoice(first);
    const secondId = joinVoice(second);

    first.receive(VOICE_EVENT.SIGNAL, { version: 1, to: secondId, ...signalFields });

    assert.equal(packetsFor(first, VOICE_EVENT.ERROR)[0].code, "invalid-packet");
    assert.deepEqual(packetsFor(second, VOICE_EVENT.SIGNAL), []);
  });
}

test("voice rejects room selectors and malformed mute states without changing advertised state", () => {
  const harness = createVoiceHarness({ playerIds: ["west", "east", "north"] });
  const first = harness.connectPlayer("one", "alpha", "west");
  const second = harness.connectPlayer("two", "alpha", "east");
  first.receive(VOICE_EVENT.JOIN, { version: 1, gameId: "beta" });
  assert.equal(packetsFor(first, VOICE_EVENT.ERROR)[0].code, "invalid-packet");
  const firstId = joinVoice(first);
  joinVoice(second);
  first.receive(VOICE_EVENT.STATE, { version: 1, muted: false });
  first.receive(VOICE_EVENT.STATE, { version: 1, muted: "false" });
  const third = harness.connectPlayer("three", "alpha", "north");
  joinVoice(third);

  assert.deepEqual(packetsFor(second, VOICE_EVENT.STATE), [{ version: 1, participantId: firstId, muted: false }]);
  assert.deepEqual(packetsFor(third, VOICE_EVENT.READY)[0].participants[0], { id: firstId, playerId: "west", muted: false });
});

test("lost room ownership evicts voice before accepting another signal", () => {
  const harness = createVoiceHarness();
  const first = harness.connectPlayer("one", "alpha", "west");
  const second = harness.connectPlayer("two", "alpha", "east");
  const firstId = joinVoice(first);
  const secondId = joinVoice(second);
  first.data.gameId = "beta";

  first.receive(VOICE_EVENT.SIGNAL, { version: 1, to: secondId, description: AUDIO_DESCRIPTION });

  assert.equal(packetsFor(first, VOICE_EVENT.ERROR)[0].code, "not-authorized");
  assert.deepEqual(packetsFor(second, VOICE_EVENT.PEER_LEFT), [{ version: 1, participantId: firstId }]);
  assert.deepEqual(packetsFor(second, VOICE_EVENT.SIGNAL), []);
});

test("a stale target cannot receive signaling or remain advertised to a fresh join", () => {
  const harness = createVoiceHarness({ playerIds: ["west", "east", "north"] });
  const first = harness.connectPlayer("one", "alpha", "west");
  const second = harness.connectPlayer("two", "alpha", "east");
  joinVoice(first);
  const secondId = joinVoice(second);
  harness.namespace.sockets.delete(second.id);
  first.receive(VOICE_EVENT.SIGNAL, { version: 1, to: secondId, description: AUDIO_DESCRIPTION });
  const third = harness.connectPlayer("three", "alpha", "north");
  joinVoice(third);

  assert.equal(packetsFor(first, VOICE_EVENT.ERROR)[0].code, "invalid-target");
  assert.deepEqual(packetsFor(second, VOICE_EVENT.SIGNAL), []);
  assert.equal(packetsFor(third, VOICE_EVENT.READY)[0].participants.some((participant) => participant.id === secondId), false);
});

test("voice notifications require the same authoritative player slot as the membership", () => {
  const harness = createVoiceHarness({ playerIds: ["west", "east", "north"] });
  const first = harness.connectPlayer("one", "alpha", "west");
  const second = harness.connectPlayer("two", "alpha", "east");
  joinVoice(first);
  joinVoice(second);
  first.data.playerId = "north";
  harness.games.get("alpha").players.north.connected = true;
  second.receive(VOICE_EVENT.LEAVE);

  assert.deepEqual(packetsFor(first, VOICE_EVENT.PEER_LEFT), []);
});

test("leaving is idempotent and a rejoin rejects its previous participant identity", () => {
  const harness = createVoiceHarness();
  const first = harness.connectPlayer("one", "alpha", "west");
  const second = harness.connectPlayer("two", "alpha", "east");
  const firstId = joinVoice(first);
  joinVoice(second);
  first.receive(VOICE_EVENT.LEAVE);
  first.receive(VOICE_EVENT.LEAVE);
  const nextFirstId = joinVoice(first);
  second.receive(VOICE_EVENT.SIGNAL, { version: 1, to: firstId, description: AUDIO_DESCRIPTION });

  assert.notEqual(nextFirstId, firstId);
  assert.deepEqual(packetsFor(second, VOICE_EVENT.PEER_LEFT), [{ version: 1, participantId: firstId }]);
  assert.equal(packetsFor(second, VOICE_EVENT.ERROR)[0].code, "invalid-target");
  assert.deepEqual(packetsFor(first, VOICE_EVENT.SIGNAL), []);
});

test("larger authoritative rooms require a different voice topology", () => {
  const harness = createVoiceHarness({ playerIds: ["west", "east", "north", "south", "center"] });
  const player = harness.connectPlayer("one");
  player.receive(VOICE_EVENT.JOIN);

  assert.equal(packetsFor(player, VOICE_EVENT.ERROR)[0].code, "unsupported-capacity");
  assert.deepEqual(harness.iceRequests, []);
});

test("voice bounds signal bursts, suppresses repeated limit errors and recovers after its window", () => {
  let nowMs = 1000;
  const harness = createVoiceHarness({ nowFn: () => nowMs });
  const first = harness.connectPlayer("one", "alpha", "west");
  const second = harness.connectPlayer("two", "alpha", "east");
  joinVoice(first);
  const secondId = joinVoice(second);
  for (let requestIndex = 0; requestIndex < 200; requestIndex += 1) {
    first.receive(VOICE_EVENT.SIGNAL, { version: 1, to: secondId, candidate: AUDIO_CANDIDATE });
  }

  const forwardedCount = packetsFor(second, VOICE_EVENT.SIGNAL).length;
  assert.ok(forwardedCount > 0 && forwardedCount <= 120);
  assert.equal(packetsFor(first, VOICE_EVENT.ERROR).filter((packet) => packet.code === "rate-limit").length, 1);
  nowMs += 10000;
  first.receive(VOICE_EVENT.SIGNAL, { version: 1, to: secondId, candidate: AUDIO_CANDIDATE });
  assert.equal(packetsFor(second, VOICE_EVENT.SIGNAL).length, forwardedCount + 1);
});

test("voice limits repeated membership churn while preserving immediate cleanup", () => {
  const harness = createVoiceHarness({ nowFn: () => 0 });
  const first = harness.connectPlayer("one", "alpha", "west");
  for (let joinIndex = 0; joinIndex < 20; joinIndex += 1) {
    first.receive(VOICE_EVENT.JOIN);
  }
  assert.ok(packetsFor(first, VOICE_EVENT.READY).length <= 6);
  assert.equal(packetsFor(first, VOICE_EVENT.ERROR).at(-1).code, "rate-limit");
  first.receive(VOICE_EVENT.LEAVE);
  const second = harness.connectPlayer("two", "alpha", "east");
  joinVoice(second);
  assert.deepEqual(packetsFor(second, VOICE_EVENT.READY)[0].participants, []);
});

test("generic registration releases voice on room switches and disconnect without changing rematches", (testContext) => {
  const { namespace, connectSocket } = createNamespaceTransport();
  const timerMock = testContext.mock.method(globalThis, "setTimeout", () => 0);
  try {
    registerGame({
      io: { of: () => namespace },
      meta: { namespace: "/synthetic", room: { playerIds: ["west", "east"] } },
      createState: () => ({ players: { west: { connected: false }, east: { connected: false } } }),
      handleRematch: () => {},
    });
  } finally {
    timerMock.mock.restore();
  }
  const first = connectSocket("one");
  const second = connectSocket("two");
  first.receive("joinGame", { gameId: "alpha" });
  second.receive("joinGame", { gameId: "alpha" });
  const firstId = joinVoice(first);
  const secondId = joinVoice(second);
  first.receive("rematch");
  first.receive("joinGame", { gameId: "alpha" });
  assert.deepEqual(packetsFor(second, VOICE_EVENT.PEER_LEFT), []);

  first.receive("joinGame", { gameId: "beta" });
  assert.deepEqual(packetsFor(second, VOICE_EVENT.PEER_LEFT), [{ version: 1, participantId: firstId }]);
  first.receive(VOICE_EVENT.SIGNAL, { version: 1, to: secondId, description: AUDIO_DESCRIPTION });
  assert.deepEqual(packetsFor(second, VOICE_EVENT.SIGNAL), []);
  const replacement = connectSocket("replacement");
  replacement.receive("joinGame", { gameId: "alpha" });
  joinVoice(replacement);
  second.connected = false;
  second.leave("alpha");
  second.receive("disconnect");
  assert.deepEqual(packetsFor(replacement, VOICE_EVENT.PEER_LEFT), [{ version: 1, participantId: secondId }]);
  assert.equal(second.data.gameId, null);
});
