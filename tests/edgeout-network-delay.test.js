import test from "node:test";
import assert from "node:assert/strict";
import { createInputLatch } from "../public/platform/frontend-engine/inputTimeline.js";
import { createPredictedInputSession } from "../public/platform/frontend-engine/predictedInputSession.js";
import { createAuthoritativeInputSession } from "../server/platform-backend-engine/core/authoritativeInputSession.js";
import { INPUT_LIMITS } from "../public/platform/shared/networkProtocol.js";
import { createOrderedNetworkChannel } from "./helpers/networkScenario.js";
import { EDGEOUT_EDGE_KEYS, EDGEOUT_FIXED_DT_SEC, EDGEOUT_INPUT_TEMPLATE, EDGEOUT_NUMERIC_INPUTS } from "../public/games/edgeout/shared/config.js";
import { createEdgeoutMatch, stepEdgeoutFighter, stepEdgeoutWorld } from "../public/games/edgeout/shared/simulation.js";
import { createEdgeoutPredictionState, stepEdgeoutPrediction } from "../public/games/edgeout/shared/prediction.js";

const CAPTURE_TICKS = 300;
const SCENARIO_TICKS = 440;
const DASH_TICK = 22;

/**
 * Production SDK sessions on both ends, shared Edgeout rules, and an ordered
 * delayed channel with jitter and stalls in each direction.
 */
for (const roundTripMs of [150, 300, 500]) {
  test(`edgeout converges at ${roundTripMs} ms RTT with jitter, ordered bursts and a short dash`, () => {
    const match = createEdgeoutMatch({ playerIds: ["p1", "p2"] });
    Object.assign(match, { started: true, phase: "playing" });
    for (const fighter of Object.values(match.players)) fighter.connected = true;
    const inputConfig = { inputTemplate: EDGEOUT_INPUT_TEMPLATE, edgeKeys: EDGEOUT_EDGE_KEYS, numericInputs: EDGEOUT_NUMERIC_INPUTS, fixedDtSec: EDGEOUT_FIXED_DT_SEC };
    const serverSession = createAuthoritativeInputSession(inputConfig);
    for (const fighter of Object.values(match.players)) serverSession.resetPlayer(fighter);
    const inputLatch = createInputLatch(EDGEOUT_INPUT_TEMPLATE, inputConfig);
    const commands = createOrderedNetworkChannel({ oneWayDelayMs: roundTripMs / 2, jitterMs: 60, stalls: [{ startMs: 750, durationMs: 200 }, { startMs: 2100, durationMs: 200 }] });
    const snapshots = createOrderedNetworkChannel({ oneWayDelayMs: roundTripMs / 2, jitterMs: 60, stalls: [{ startMs: 1600, durationMs: 200 }] });
    const pose = (fighter) => ({ x: fighter.x, y: fighter.y, z: fighter.z });
    let currentTimeMs = 0;
    let maximumPending = 0;
    let maximumQueue = 0;
    let maximumBurst = 0;
    let authorityDashed = false;
    let lastPresented = null;
    let restingMovement = 0;
    let neutralMovement = 0;

    const clientSession = createPredictedInputSession({
      fixedDtSec: EDGEOUT_FIXED_DT_SEC,
      captureInput: () => inputLatch.capture(),
      sendInput: (packet) => commands.send(packet, currentTimeMs),
      simulate: stepEdgeoutPrediction,
      extractPose: pose,
      maxSmoothingDistance: 1.5,
    });

    function receiveSnapshot(snapshot) {
      const fighter = snapshot.players.p1;
      clientSession.receiveAuthority({
        state: createEdgeoutPredictionState(snapshot, "p1"),
        protocol: 2,
        inputEpoch: fighter.inputEpoch,
        acknowledgedSequence: fighter.inputSeqAck,
        context: {
          active: snapshot.started && snapshot.phase === "playing",
          simulationTick: fighter.inputSimulationTick,
          continuityKey: `${snapshot.matchId}:${snapshot.roundNumber}`,
        },
      });
    }

    function createSnapshot() {
      const snapshot = structuredClone(match);
      for (const [playerId, fighter] of Object.entries(match.players)) {
        const { __inputBuffer, ...fighterSnapshot } = snapshot.players[playerId];
        snapshot.players[playerId] = { ...fighterSnapshot, ...serverSession.getPlayerSnapshotMetadata(fighter) };
      }
      return snapshot;
    }

    receiveSnapshot(createSnapshot());
    for (let tick = 1; tick <= SCENARIO_TICKS; tick += 1) {
      currentTimeMs = tick * EDGEOUT_FIXED_DT_SEC * 1000;
      for (const snapshot of snapshots.receive(currentTimeMs)) receiveSnapshot(snapshot);
      if (tick <= CAPTURE_TICKS) {
        inputLatch.set("moveX", tick <= 30 ? 0.5 : 0);
        if (tick === DASH_TICK) {
          inputLatch.set("dash", true);
          inputLatch.set("dash", false);
        }
        clientSession.captureAndPredict();
      }
      const deliveredCommands = commands.receive(currentTimeMs);
      maximumBurst = Math.max(maximumBurst, deliveredCommands.length);
      for (const packet of deliveredCommands) serverSession.receiveInput(match.players.p1, packet, currentTimeMs);
      maximumQueue = Math.max(maximumQueue, match.players.p1.__inputBuffer?.queue.length ?? 0);
      if (tick === CAPTURE_TICKS + 40) match.started = false;
      match.__loopTick = tick;
      match.__loopMonotonicNow = currentTimeMs;
      serverSession.simulateRoom({
        state: match,
        dtSec: EDGEOUT_FIXED_DT_SEC,
        simulate: (fighter, input, stepSec) => {
          stepEdgeoutFighter(fighter, input, stepSec, { active: match.started && match.phase === "playing", intactRings: match.arena.intactRings });
          if (fighter === match.players.p1 && fighter.action === "dash") authorityDashed = true;
        },
      });
      stepEdgeoutWorld(match, EDGEOUT_FIXED_DT_SEC);
      snapshots.send(createSnapshot(), currentTimeMs);

      for (const alpha of [0.5, 1]) {
        const presented = { ...clientSession.getRenderPose(1 / 120, alpha) };
        assert.ok(Object.values(presented).every(Number.isFinite), "render coordinates remain finite");
        if (lastPresented) {
          const movement = Math.hypot(...Object.keys(presented).map((key) => presented[key] - lastPresented[key]));
          if (tick >= 410) restingMovement = Math.max(restingMovement, movement);
          if (tick >= 220 && tick <= 280) neutralMovement = Math.max(neutralMovement, movement);
        }
        lastPresented = presented;
      }
      maximumPending = Math.max(maximumPending, clientSession.getStats().pendingCommands);
    }

    assert.equal(authorityDashed, true, "the short dash press reaches server simulation");
    assert.ok(maximumBurst >= 3, "fixture includes ordered delivery bursts");
    assert.ok(maximumPending <= INPUT_LIMITS.MAX_PENDING_FRAMES);
    assert.ok(maximumQueue <= INPUT_LIMITS.MAX_QUEUED_FRAMES);
    assert.equal(clientSession.getStats().pendingCommands, 0);
    assert.equal(clientSession.getStats().hardSnaps, 0, "delay alone must not snap the local fighter");
    assert.ok(restingMovement < 1e-5, `resting presentation does not vibrate: ${restingMovement}`);
    assert.ok(neutralMovement < 1e-5, `neutral input stays still while snapshots continue: ${neutralMovement}`);
    for (const [key, value] of Object.entries(pose(match.players.p1))) {
      assert.ok(Math.abs(lastPresented[key] - value) < 0.001, `${key} converges to authority`);
    }
  });
}
