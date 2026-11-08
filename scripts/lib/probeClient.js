import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { createInputTimeline } from "../../public/platform/frontend-engine/inputTimeline.js";
import {
  ENGINE_PACKET_TYPE,
  INPUT_PROTOCOL,
  NETWORK_ENDPOINT,
  SOCKET_EVENT,
  SOCKET_PACKET_TYPE,
  URL_PROTOCOL,
} from "../../public/platform/shared/networkProtocol.js";
import { applyPackedSnapshot, createInputFrame } from "./networkMetrics.js";
import { validateProbeGameConfig } from "./probeOptions.js";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");
const socketPacketParser = require("socket.io-msgpack-parser");

const PROBE_TIMEOUT_MS = Object.freeze({ ROOM_JOIN: 15000, ROUND_TRIP_EXPIRY: 10000 });
const ROUND_TRIP_SAMPLE_INTERVAL_MS = 1000;
const INPUT_DIRECTION_INTERVAL_MS = 2000;
const PACKET_EVENT = Object.freeze({ MESSAGE: "message", ERROR: "error", CLOSE: "close", DECODED: "decoded" });
const PROBE_FAILURE = Object.freeze({
  JOIN_TIMEOUT: "joining timed out",
  CONNECTION_CLOSED: "connection closed",
  ROOM_FULL: "Probe room full",
});

/** @typedef {import("../../public/platform/shared/networkProtocol.js").SocketPacket} SocketPacket */
/** @typedef {import("../../public/platform/shared/networkProtocol.js").PackedSnapshotPacket} PackedSnapshotPacket */
/** @typedef {import("./networkMetrics.js").NetworkSampleBuffer} NetworkSampleBuffer */
/** @typedef {import("./networkMetrics.js").SnapshotDecodeState} SnapshotDecodeState */
/** @typedef {import("./probeOptions.js").ProbeGameConfig} ProbeGameConfig */

/**
 * @typedef {object} ProbePlayerOptions
 * @property {string} playerName
 * @property {URL} serverUrl
 * @property {string} roomId
 * @property {ProbeGameConfig} gameConfig
 */

/**
 * @typedef {object} ProbePlayerClient
 * @property {NetworkSampleBuffer} networkSamples
 * @property {() => Promise<void>} joinRoom
 * @property {() => void} startSampling
 * @property {() => void} stopInputStream
 * @property {() => void} stopRoundTripSampling
 * @property {() => void} closeSocketConnection
 */

/**
 * Alternate a game's first two boolean controls while preserving numeric defaults.
 * The template is never mutated and no game-specific input keys are introduced.
 * @template {string} InputKey
 * @param {Record<InputKey, boolean | number>} inputTemplate
 * @param {number} elapsedMs
 * @returns {Record<InputKey, boolean | number>} Fresh captured input for one command.
 */
export function createProbeInputState(inputTemplate, elapsedMs) {
  const capturedInput = { ...inputTemplate };
  const inputKeys = /** @type {InputKey[]} */ (Object.keys(inputTemplate).filter((inputKey) => typeof inputTemplate[inputKey] === "boolean"));
  const alternateDirection = Math.floor(elapsedMs / INPUT_DIRECTION_INTERVAL_MS) % 2 === 0;
  if (inputKeys.length === 1) {
    capturedInput[inputKeys[0]] = alternateDirection;
  } else if (inputKeys.length >= 2) {
    capturedInput[inputKeys[0]] = !alternateDirection;
    capturedInput[inputKeys[1]] = alternateDirection;
  }

  return capturedInput;
}

/**
 * Create one diagnostic player's transport and sample buffers.
 * The caller owns cleanup, including when joinRoom rejects.
 * @param {ProbePlayerOptions} probeOptions
 * @returns {ProbePlayerClient} A client whose sampling starts after room join.
 * @throws {Error} Invalid capabilities fail before constructing the WebSocket.
 */
export function createProbePlayerClient({ playerName, serverUrl, roomId, gameConfig }) {
  const probeGameConfig = validateProbeGameConfig(gameConfig);
  const socketUrl = new URL(NETWORK_ENDPOINT.SOCKET_WEBSOCKET, serverUrl);
  socketUrl.protocol = socketUrl.protocol === URL_PROTOCOL.HTTPS
    ? URL_PROTOCOL.SECURE_WEBSOCKET
    : URL_PROTOCOL.WEBSOCKET;

  const probeSocket = new WebSocket(socketUrl);
  const socketPacketEncoder = new socketPacketParser.Encoder();
  const socketPacketDecoder = new socketPacketParser.Decoder();
  /** @type {SnapshotDecodeState} */
  const snapshotDecodeState = { schemaPaths: [], values: [] };
  /** @type {Map<number, number>} Request ID to monotonic send time. */
  const roundTripRequests = new Map();
  /** @type {NetworkSampleBuffer} */
  const networkSamples = {
    name: playerName,
    snapshotArrivalTimesMs: [],
    snapshotServerTimesMs: [],
    snapshotSequences: [],
    roundTripTimesMs: [],
    serverLoopLagSamplesMs: [],
    roomCpuSamplesMs: [],
    droppedStepSamples: [],
    startedSnapshotCount: 0,
    sentInputSequence: 0,
    lastInputAcknowledgement: 0,
  };

  /** @type {number|undefined} */
  let inputProtocolVersion = probeGameConfig.inputProtocol ?? undefined;
  /** @type {number|undefined} */
  let inputEpoch;
  let nextRoundTripRequestId = 0;
  /** @type {ReturnType<typeof createInputTimeline>|null} */
  let inputStream = null;
  /** @type {ReturnType<typeof setInterval>|null} */
  let roundTripTimer = null;

  /** @param {Omit<SocketPacket, "nsp">} socketPacket @returns {void} */
  function sendSocketPacket(socketPacket) {
    if (probeSocket.readyState !== WebSocket.OPEN) {
      return;
    }

    const namespacedPacket = { nsp: probeGameConfig.namespace, ...socketPacket };
    probeSocket.send(socketPacketEncoder.encode(namespacedPacket)[0]);
  }

  /** @param {(typeof SOCKET_EVENT)[keyof typeof SOCKET_EVENT]} eventName @param {unknown} [eventPayload] @returns {void} */
  function emitGameEvent(eventName, eventPayload) {
    sendSocketPacket({
      type: SOCKET_PACKET_TYPE.EVENT,
      data: eventPayload === undefined ? [eventName] : [eventName, eventPayload],
    });
  }

  /** @param {PackedSnapshotPacket} snapshotPacket @returns {void} Mutates this client's samples. */
  function recordReceivedSnapshot(snapshotPacket) {
    const snapshotFields = applyPackedSnapshot(snapshotDecodeState, snapshotPacket);
    const snapshotMetadata = snapshotPacket.n;
    const playerFieldPrefix = `players.${networkSamples.playerId}`;

    networkSamples.snapshotArrivalTimesMs.push(performance.now());
    networkSamples.snapshotServerTimesMs.push(snapshotMetadata?.serverTime);
    networkSamples.snapshotSequences.push(snapshotPacket.s);
    networkSamples.serverLoopLagSamplesMs.push(snapshotMetadata?.server?.eventLoopLagMs);
    networkSamples.roomCpuSamplesMs.push(snapshotMetadata?.server?.roomCpuMs);
    networkSamples.droppedStepSamples.push(snapshotMetadata?.server?.droppedSteps);
    if (snapshotFields.started) {
      networkSamples.startedSnapshotCount++;
    }

    networkSamples.lastInputAcknowledgement = snapshotFields[`${playerFieldPrefix}.inputSeqAck`]
      ?? networkSamples.lastInputAcknowledgement;
    inputStream?.acknowledge(networkSamples.lastInputAcknowledgement);
    inputProtocolVersion = snapshotFields.inputProtocol ?? inputProtocolVersion;
    inputEpoch = snapshotFields[`${playerFieldPrefix}.inputEpoch`] ?? inputEpoch;
  }

  /** @param {number} requestId @returns {void} Ignore acknowledgements without a pending request. */
  function recordRoundTripAcknowledgement(requestId) {
    if (!roundTripRequests.has(requestId)) {
      return;
    }

    networkSamples.roundTripTimesMs.push(performance.now() - roundTripRequests.get(requestId));
    roundTripRequests.delete(requestId);
  }

  /**
   * Join the configured namespace and room, leaving handlers active for sampling.
   * @returns {Promise<void>}
   * @throws {Error} Rejects on timeout, transport closure/error, parser failure, or a full room.
   */
  function joinRoom() {
    return new Promise((resolve, reject) => {
      const joinTimeout = setTimeout(() => {
        reject(new Error(`${playerName}: ${PROBE_FAILURE.JOIN_TIMEOUT}`));
      }, PROBE_TIMEOUT_MS.ROOM_JOIN);

      function rejectRoomJoin(joinError) {
        clearTimeout(joinTimeout);
        reject(joinError);
      }

      probeSocket.on(PACKET_EVENT.ERROR, rejectRoomJoin);
      probeSocket.on(PACKET_EVENT.CLOSE, () => {
        rejectRoomJoin(new Error(`${playerName}: ${PROBE_FAILURE.CONNECTION_CLOSED}`));
      });
      probeSocket.on(PACKET_EVENT.MESSAGE, (messageBytes, isBinary) => {
        if (!isBinary) {
          const enginePacket = messageBytes.toString();
          if (enginePacket.startsWith(ENGINE_PACKET_TYPE.OPEN)) {
            sendSocketPacket({ type: SOCKET_PACKET_TYPE.CONNECT });
          } else if (enginePacket.startsWith(ENGINE_PACKET_TYPE.PING)) {
            probeSocket.send(ENGINE_PACKET_TYPE.PONG + enginePacket.slice(1));
          }
          return;
        }

        try {
          socketPacketDecoder.add(messageBytes);
        } catch (decodeError) {
          rejectRoomJoin(decodeError);
        }
      });
      socketPacketDecoder.on(PACKET_EVENT.DECODED, (socketPacket) => {
        if (socketPacket.nsp !== probeGameConfig.namespace) {
          return;
        }
        if (socketPacket.type === SOCKET_PACKET_TYPE.CONNECT) {
          emitGameEvent(SOCKET_EVENT.JOIN_GAME, { gameId: roomId });
        }
        if (socketPacket.type === SOCKET_PACKET_TYPE.ACKNOWLEDGEMENT) {
          recordRoundTripAcknowledgement(socketPacket.id);
        }
        if (socketPacket.type !== SOCKET_PACKET_TYPE.EVENT) {
          return;
        }

        const [eventName, eventPayload] = socketPacket.data;
        if (eventName === SOCKET_EVENT.STATE) {
          recordReceivedSnapshot(eventPayload);
        }
        if (eventName === SOCKET_EVENT.GAME_JOINED) {
          networkSamples.playerId = eventPayload.playerId;
          inputEpoch = eventPayload.inputEpoch ?? inputEpoch;
          clearTimeout(joinTimeout);
          resolve();
        }
        if (eventName === SOCKET_EVENT.ROOM_FULL) {
          rejectRoomJoin(new Error(PROBE_FAILURE.ROOM_FULL));
        }
      });
    });
  }

  /** @returns {void} Sample RTT once and discard requests older than the existing timeout. */
  function sendRoundTripProbe() {
    const requestId = ++nextRoundTripRequestId;
    roundTripRequests.set(requestId, performance.now());
    for (const [pendingRequestId, sentAtMs] of roundTripRequests) {
      if (performance.now() - sentAtMs > PROBE_TIMEOUT_MS.ROUND_TRIP_EXPIRY) {
        roundTripRequests.delete(pendingRequestId);
      }
    }
    sendSocketPacket({ type: SOCKET_PACKET_TYPE.EVENT, id: requestId, data: [SOCKET_EVENT.PING] });
  }

  /** @returns {void} Start configured input, when supported, and 1 Hz RTT samples. */
  function startSampling() {
    if (roundTripTimer !== null) {
      return;
    }

    const samplingStartedAtMs = performance.now();
    if (probeGameConfig.inputTemplate !== null) {
      const fixedDtSec = 1 / probeGameConfig.tickRateHz;
      inputStream = createInputTimeline({
        hz: probeGameConfig.tickRateHz,
        fixedDtSec,
        captureInput: () => createProbeInputState(probeGameConfig.inputTemplate, performance.now() - samplingStartedAtMs),
        sendFrame: (capturedFrame) => {
          if (inputProtocolVersion >= INPUT_PROTOCOL.QUEUED && !Number.isSafeInteger(inputEpoch)) {
            return;
          }

          networkSamples.sentInputSequence = capturedFrame.seq;
          emitGameEvent(SOCKET_EVENT.INPUT, createInputFrame(
            inputProtocolVersion,
            inputEpoch,
            capturedFrame.seq,
            capturedFrame.input,
            fixedDtSec,
          ));
        },
      });
      inputStream.start();
    }
    sendRoundTripProbe();
    roundTripTimer = setInterval(sendRoundTripProbe, ROUND_TRIP_SAMPLE_INTERVAL_MS);
  }

  return {
    networkSamples,
    joinRoom,
    startSampling,
    stopInputStream: () => inputStream?.stop(),
    stopRoundTripSampling: () => {
      if (roundTripTimer !== null) {
        clearInterval(roundTripTimer);
        roundTripTimer = null;
      }
    },
    closeSocketConnection: () => probeSocket.close(),
  };
}
