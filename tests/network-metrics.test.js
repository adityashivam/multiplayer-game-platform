import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPackedSnapshot,
  classifyNetworkTiming,
  createInputFrame,
  decodeSocketPacket,
  summarizeNetworkTiming,
  summarizeTimingSamples,
} from "../scripts/lib/networkMetrics.js";

const ENCODED_STATE_PACKET_HEX = "83a47479706502a36e7370a62f6669676874a46461746192a5737461746585a16ba166a17305a17091a773746172746564a17691c3a16e82aa73657276657254696d6564a673657276657283ae6576656e744c6f6f704c61674d7302a9726f6f6d4370754d7301ac64726f70706564537465707303";

test("decodes a literal msgpack Socket.IO state packet and applies full and delta snapshots", () => {
  const encodedPacketBytes = Buffer.from(ENCODED_STATE_PACKET_HEX, "hex");
  const statePacket = decodeSocketPacket(encodedPacketBytes);
  const decodeState = { schemaPaths: [], values: [] };

  assert.equal(statePacket.nsp, "/fight");
  assert.deepEqual(applyPackedSnapshot(decodeState, statePacket.data[1]), { started: true });
  assert.deepEqual(applyPackedSnapshot(decodeState, { k: "d", c: [[0, false]] }), { started: false });
});

test("describes samples and counts sequence gaps separately from timing", () => {
  const networkSamples = {
    name: "one",
    snapshotArrivalTimesMs: [100, 120, 190],
    snapshotServerTimesMs: [1000, 1020, 1040],
    snapshotSequences: [1, 2, 5],
    roundTripTimesMs: [10, 30, 20],
    serverLoopLagSamplesMs: [1],
    roomCpuSamplesMs: [2],
    droppedStepSamples: [3, 5],
    startedSnapshotCount: 2,
    sentInputSequence: 8,
    lastInputAcknowledgement: 7,
  };
  const networkSummary = summarizeNetworkTiming(networkSamples);

  assert.deepEqual(summarizeTimingSamples([10, 30, 20]), {
    samples: 3,
    p50: 20,
    p95: 30,
    p99: 30,
    max: 30,
  });
  assert.equal(networkSummary.applicationSequenceGaps, 2);
  assert.equal(networkSummary.arrivalGapsOver50ms, 1);
  assert.equal(networkSummary.serverGapsOver50ms, 0);
  assert.equal(networkSummary.droppedSimulationSteps, 2);
});

test("classification reports evidence conservatively", () => {
  const serverGapEvidence = {
    snapshots: 10,
    serverGapsOver50ms: 2,
    arrivalGapsOver50ms: 2,
    droppedSimulationSteps: 0,
  };
  const deliveryGapEvidence = {
    snapshots: 10,
    serverGapsOver50ms: 0,
    arrivalGapsOver50ms: 2,
    droppedSimulationSteps: 0,
  };

  assert.match(classifyNetworkTiming({ snapshots: 1 }), /insufficient/i);
  assert.match(classifyNetworkTiming(serverGapEvidence), /server/i);
  assert.match(classifyNetworkTiming(deliveryGapEvidence), /delivery/i);
});

test("does not infer healthy server timing when timestamps are missing", () => {
  const missingTimestampEvidence = {
    snapshots: 20,
    serverIntervalMs: { samples: 0 },
    arrivalGapsOver50ms: 2,
  };

  assert.match(classifyNetworkTiming(missingTimestampEvidence), /unavailable/i);
});

test("protocol 2 commands carry the server epoch and legacy frames retain duration", () => {
  assert.deepEqual(createInputFrame(2, 7, 3, { right: true }), {
    type: "inputFrame",
    protocol: 2,
    epoch: 7,
    seq: 3,
    state: { right: true },
  });
  assert.deepEqual(createInputFrame(undefined, undefined, 4, { left: true }), {
    type: "inputFrame",
    seq: 4,
    dtSec: 1 / 60,
    state: { left: true },
  });
});
