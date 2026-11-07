import { createRequire } from "node:module";
import { createInputFrame as encodeInputFrame } from "../../public/platform/shared/inputFrames.js";
import {
  NETWORK_TIMING,
  SNAPSHOT_KIND,
} from "../../public/platform/shared/networkProtocol.js";

const require = createRequire(import.meta.url);
const socketPacketParser = require("socket.io-msgpack-parser");

const MS_PER_SECOND = 1000;
const TIMING_DECIMAL_PLACES = 2;
const TIMING_GAP_THRESHOLD_MS = 50;
const MINIMUM_SNAPSHOT_COUNT = 10;
const SAMPLE_PERCENTILE = Object.freeze({ MEDIAN: 0.5, HIGH: 0.95, TAIL: 0.99 });
const TIMING_ASSESSMENT = Object.freeze({
  INSUFFICIENT_SNAPSHOTS: "Insufficient snapshots to assess timing.",
  MISSING_SERVER_TIMESTAMPS: "Server timestamps are unavailable or incomplete; generation timing cannot be compared reliably with arrivals.",
  SERVER_GAPS: "Server generation gaps or dropped simulation steps were observed; these are separate from network latency.",
  DELIVERY_GAPS: "Arrival gaps occurred without observed server generation gaps; delivery or client scheduling may contribute. This does not prove IP packet loss.",
  NO_OBSERVED_GAPS: "No gaps over 50 ms were observed in this sample; this does not establish network quality under other conditions.",
});

/** @typedef {import("../../public/platform/shared/networkProtocol.js").SocketPacket} SocketPacket */
/** @typedef {{k: "f", p?: string[], v: unknown[]}|{k: "d", c: [number, unknown][]}} SnapshotChanges */
/** @typedef {{samples: number, p50: number|null, p95: number|null, p99: number|null, max: number|null}} TimingDistribution */
/** @typedef {{schemaPaths: string[], values: unknown[]}} SnapshotDecodeState */
/**
 * @typedef {object} NetworkTimingEvidence
 * @property {number} snapshots
 * @property {{samples: number}} [serverIntervalMs]
 * @property {number} [serverGapsOver50ms]
 * @property {number} [arrivalGapsOver50ms]
 * @property {number|null} [droppedSimulationSteps]
 */

/**
 * @typedef {object} NetworkSampleBuffer
 * @property {string} name
 * @property {string} [playerId]
 * @property {number[]} snapshotArrivalTimesMs
 * @property {(number|undefined)[]} snapshotServerTimesMs
 * @property {(number|undefined)[]} snapshotSequences
 * @property {number[]} roundTripTimesMs
 * @property {(number|null|undefined)[]} serverLoopLagSamplesMs
 * @property {(number|null|undefined)[]} roomCpuSamplesMs
 * @property {(number|undefined)[]} droppedStepSamples
 * @property {number} startedSnapshotCount
 * @property {number} sentInputSequence
 * @property {number} lastInputAcknowledgement
 */

/**
 * @typedef {object} NetworkTimingSummary
 * @property {string} client
 * @property {string} [player]
 * @property {number} snapshots
 * @property {number|null} observedHz
 * @property {TimingDistribution} rttMs
 * @property {TimingDistribution} arrivalIntervalMs
 * @property {TimingDistribution} serverIntervalMs
 * @property {TimingDistribution} relativeTransitVariationMs
 * @property {TimingDistribution} serverLoopLagMs
 * @property {TimingDistribution} roomCpuMs
 * @property {number|null} droppedSimulationSteps
 * @property {number} applicationSequenceGaps
 * @property {number} arrivalGapsOver50ms
 * @property {number} serverGapsOver50ms
 * @property {number} startedSnapshots
 * @property {number} inputFramesSent
 * @property {number} lastInputAck
 */

/**
 * Build a game-defined input packet, retaining duration for legacy servers.
 * @template {Record<string, boolean>} InputState
 * @param {number|undefined} protocolVersion
 * @param {number|undefined} inputEpoch
 * @param {number} sequenceNumber
 * @param {InputState} inputState Preserved without adding missing keys.
 * @param {number} [fixedDtSec=1/60] Selected game's simulation duration.
 * @returns {import("../../public/platform/shared/inputFrames.js").EncodedInputFrame<InputState>} The existing wire shape.
 */
export function createInputFrame(protocolVersion, inputEpoch, sequenceNumber, inputState, fixedDtSec = NETWORK_TIMING.FIXED_DT_SEC) {
  return encodeInputFrame({ protocolVersion, inputEpoch, sequenceNumber, inputState, fixedDtSec });
}

/**
 * Decode one MessagePack Socket.IO packet without opening a connection.
 * @param {Buffer|ArrayBuffer|Uint8Array} packetBytes
 * @returns {SocketPacket|undefined} The parser's decoded packet.
 * @throws {Error} If the parser rejects the packet.
 */
export function decodeSocketPacket(packetBytes) {
  const socketPacketDecoder = new socketPacketParser.Decoder();
  /** @type {SocketPacket|undefined} */
  let decodedPacket;

  socketPacketDecoder.on("decoded", (socketPacket) => {
    decodedPacket = socketPacket;
  });
  socketPacketDecoder.add(packetBytes);

  return decodedPacket;
}

/**
 * Update a full/delta baseline and return its flattened fields.
 * Schema paths are genuinely dynamic: each game supplies its own fields.
 * @param {SnapshotDecodeState} decodeState Mutated in place.
 * @param {SnapshotChanges} snapshotPacket
 * @returns {Record<string, unknown>} Values indexed by wire schema path.
 */
export function applyPackedSnapshot(decodeState, snapshotPacket) {
  if (snapshotPacket.k === SNAPSHOT_KIND.FULL) {
    decodeState.schemaPaths = snapshotPacket.p || [];
    decodeState.values = snapshotPacket.v.slice();
  } else if (snapshotPacket.k === SNAPSHOT_KIND.DELTA) {
    for (const [fieldIndex, fieldValue] of snapshotPacket.c) {
      decodeState.values[fieldIndex] = fieldValue;
    }
  }

  return Object.fromEntries(
    decodeState.schemaPaths.map((fieldPath, fieldIndex) => [fieldPath, decodeState.values[fieldIndex]]),
  );
}

/**
 * Summarize finite samples with the existing percentile convention.
 * @param {(number|null|undefined)[]} timingSamples
 * @returns {TimingDistribution} Null values indicate an empty finite sample set.
 */
export function summarizeTimingSamples(timingSamples) {
  const sortedSamples = timingSamples.filter(Number.isFinite).sort((left, right) => left - right);

  function readPercentile(percentile) {
    if (!sortedSamples.length) {
      return null;
    }

    const sampleIndex = Math.min(sortedSamples.length - 1, Math.floor(percentile * sortedSamples.length));
    return +sortedSamples[sampleIndex].toFixed(TIMING_DECIMAL_PLACES);
  }

  return {
    samples: sortedSamples.length,
    p50: readPercentile(SAMPLE_PERCENTILE.MEDIAN),
    p95: readPercentile(SAMPLE_PERCENTILE.HIGH),
    p99: readPercentile(SAMPLE_PERCENTILE.TAIL),
    max: sortedSamples.length
      ? +sortedSamples[sortedSamples.length - 1].toFixed(TIMING_DECIMAL_PLACES)
      : null,
  };
}

/** @param {(number|undefined)[]} sampleTimesMs @returns {number[]} Finite consecutive intervals. */
function calculateSampleIntervals(sampleTimesMs) {
  return sampleTimesMs
    .slice(1)
    .map((sampleTimeMs, previousSampleIndex) => sampleTimeMs - sampleTimesMs[previousSampleIndex])
    .filter(Number.isFinite);
}

/** @param {(number|undefined)[]} sequenceNumbers @returns {number} Missing application sequence numbers. */
function countSnapshotSequenceGaps(sequenceNumbers) {
  return sequenceNumbers.slice(1).reduce((gapCount, sequenceNumber, previousSequenceIndex) => {
    const previousSequence = sequenceNumbers[previousSequenceIndex];
    if (!Number.isFinite(sequenceNumber) || !Number.isFinite(previousSequence)) {
      return gapCount;
    }

    return gapCount + Math.max(0, sequenceNumber - previousSequence - 1);
  }, 0);
}

/**
 * Separate server generation, client arrival, and round-trip timing.
 * @param {NetworkSampleBuffer} networkSamples
 * @returns {NetworkTimingSummary} Existing CLI fields and calculations.
 */
export function summarizeNetworkTiming(networkSamples) {
  const arrivalIntervalsMs = calculateSampleIntervals(networkSamples.snapshotArrivalTimesMs);
  const serverIntervalsMs = calculateSampleIntervals(networkSamples.snapshotServerTimesMs);
  const transitOffsetsMs = networkSamples.snapshotArrivalTimesMs
    .map((arrivalTimeMs, snapshotIndex) => arrivalTimeMs - networkSamples.snapshotServerTimesMs[snapshotIndex])
    .filter(Number.isFinite);
  const minimumTransitOffsetMs = Math.min(...transitOffsetsMs);
  const droppedStepSamples = networkSamples.droppedStepSamples.filter(Number.isFinite);
  const arrivalTimesMs = networkSamples.snapshotArrivalTimesMs;

  return {
    client: networkSamples.name,
    player: networkSamples.playerId,
    snapshots: arrivalTimesMs.length,
    observedHz: arrivalTimesMs.length > 1
      ? +((arrivalTimesMs.length - 1) * MS_PER_SECOND / (arrivalTimesMs.at(-1) - arrivalTimesMs[0])).toFixed(TIMING_DECIMAL_PLACES)
      : null,
    rttMs: summarizeTimingSamples(networkSamples.roundTripTimesMs),
    arrivalIntervalMs: summarizeTimingSamples(arrivalIntervalsMs),
    serverIntervalMs: summarizeTimingSamples(serverIntervalsMs),
    relativeTransitVariationMs: summarizeTimingSamples(transitOffsetsMs.map((offsetMs) => offsetMs - minimumTransitOffsetMs)),
    serverLoopLagMs: summarizeTimingSamples(networkSamples.serverLoopLagSamplesMs),
    roomCpuMs: summarizeTimingSamples(networkSamples.roomCpuSamplesMs),
    droppedSimulationSteps: droppedStepSamples.length
      ? Math.max(0, droppedStepSamples.at(-1) - droppedStepSamples[0])
      : null,
    applicationSequenceGaps: countSnapshotSequenceGaps(networkSamples.snapshotSequences),
    arrivalGapsOver50ms: arrivalIntervalsMs.filter((intervalMs) => intervalMs > TIMING_GAP_THRESHOLD_MS).length,
    serverGapsOver50ms: serverIntervalsMs.filter((intervalMs) => intervalMs > TIMING_GAP_THRESHOLD_MS).length,
    startedSnapshots: networkSamples.startedSnapshotCount,
    inputFramesSent: networkSamples.sentInputSequence,
    lastInputAck: networkSamples.lastInputAcknowledgement,
  };
}

/**
 * Describe only evidence observed in this one-match sample.
 * @param {NetworkTimingEvidence} networkSummary
 * @returns {string} An assessment that does not equate sequence gaps with IP loss.
 */
export function classifyNetworkTiming(networkSummary) {
  if (networkSummary.snapshots < MINIMUM_SNAPSHOT_COUNT) {
    return TIMING_ASSESSMENT.INSUFFICIENT_SNAPSHOTS;
  }
  if (networkSummary.serverIntervalMs && networkSummary.serverIntervalMs.samples < networkSummary.snapshots - 1) {
    return TIMING_ASSESSMENT.MISSING_SERVER_TIMESTAMPS;
  }
  if (networkSummary.serverGapsOver50ms || networkSummary.droppedSimulationSteps > 0) {
    return TIMING_ASSESSMENT.SERVER_GAPS;
  }
  if (networkSummary.arrivalGapsOver50ms) {
    return TIMING_ASSESSMENT.DELIVERY_GAPS;
  }

  return TIMING_ASSESSMENT.NO_OBSERVED_GAPS;
}
