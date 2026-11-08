import test from "node:test";
import assert from "node:assert/strict";
import { createPredictedInputSession } from "../public/platform/frontend-engine/predictedInputSession.js";
import { createInterpolator } from "../public/platform/frontend-engine/interpolation.js";
import { createAuthoritativeInputSession } from "../server/platform-backend-engine/core/authoritativeInputSession.js";
import { createOrderedNetworkChannel } from "./helpers/networkScenario.js";

const MOVEMENT_SCENARIOS = [
  {
    name: "boolean pixel movement",
    tickRateHz: 60,
    renderRateHz: 144,
    speed: 600,
    inputTemplate: { forward: false, hop: false },
    edgeKeys: ["hop"],
    createState: () => ({ distance: 0, hops: 0, hopHeld: false }),
    captureInput: (nowMs, stepMs) => ({ forward: nowMs < 2400, hop: nowMs >= 900 && nowMs < 900 + stepMs }),
    simulate(player, input, dtSec) {
      player.distance += input.forward ? 600 * dtSec : 0;
      if (input.hop && !player.hopHeld) player.hops += 1;
      player.hopHeld = input.hop;
    },
    readPosition: (player) => player.distance,
    readActions: (player) => player.hops,
  },
  {
    name: "analog world movement",
    tickRateHz: 30,
    renderRateHz: 120,
    speed: 6,
    inputTemplate: { drive: 0, activate: false },
    numericInputs: { drive: { min: -1, max: 1 } },
    edgeKeys: ["activate"],
    createState: () => ({ lane: 0, activations: 0, activateHeld: false }),
    captureInput: (nowMs, stepMs) => ({ drive: nowMs < 2400 ? 1 : 0, activate: nowMs >= 900 && nowMs < 900 + stepMs }),
    simulate(player, input, dtSec) {
      player.lane += input.drive * 6 * dtSec;
      if (input.activate && !player.activateHeld) player.activations += 1;
      player.activateHeld = input.activate;
    },
    readPosition: (player) => player.lane,
    readActions: (player) => player.activations,
  },
];

for (const movementScenario of MOVEMENT_SCENARIOS) {
  for (const roundTripMs of [150, 300, 500]) {
    test(`${movementScenario.name} stays stable at ${roundTripMs} ms RTT with jitter and ordered 200 ms stalls`, () => {
      const fixedDtSec = 1 / movementScenario.tickRateHz;
      const stepMs = fixedDtSec * 1000;
      const renderIntervalMs = 1000 / movementScenario.renderRateHz;
      const commandChannel = createOrderedNetworkChannel({
        oneWayDelayMs: roundTripMs / 2,
        jitterMs: 60,
        stalls: [{ startMs: 850, durationMs: 200 }],
      });
      const snapshotChannel = createOrderedNetworkChannel({
        oneWayDelayMs: roundTripMs / 2,
        jitterMs: 60,
        stalls: [{ startMs: 1450, durationMs: 200 }],
      });
      const serverPlayer = movementScenario.createState();
      const authoritativeInput = createAuthoritativeInputSession({
        inputTemplate: movementScenario.inputTemplate,
        numericInputs: movementScenario.numericInputs,
        edgeKeys: movementScenario.edgeKeys,
        fixedDtSec,
      });
      authoritativeInput.resetPlayer(serverPlayer);
      let nowMs = 0;
      const clientInput = createPredictedInputSession({
        fixedDtSec,
        captureInput: () => movementScenario.captureInput(nowMs, stepMs),
        sendInput: (packet) => commandChannel.send(packet, nowMs),
        simulate: movementScenario.simulate,
        extractPose: (player) => ({ position: movementScenario.readPosition(player) }),
      });
      const interpolator = createInterpolator({
        connectionProvider: () => ({ ping: roundTripMs, pingP95Ms: roundTripMs + 100, jitterP95Ms: 60 }),
      });
      let worldTick = 0;
      let nextFixedAtMs = stepMs;
      let previousFixedAtMs = 0;
      let nextRenderAtMs = 0;
      let previousLocalPosition = null;
      let previousRemotePosition = null;
      let previousPlaybackTimeMs = -Infinity;
      let maximumCommandBurst = 0;
      let maximumPending = 0;
      let maximumQueue = 0;
      let restingMovement = 0;

      function sendAuthority(serverTimeMs) {
        snapshotChannel.send({
          state: structuredClone(serverPlayer),
          protocol: 2,
          inputEpoch: serverPlayer.inputEpoch,
          acknowledgedSequence: serverPlayer.lastInputSeqAck,
          context: { simulationTick: serverPlayer.inputSimulationTick },
          net: { seq: worldTick, serverTime: serverTimeMs, tickRate: movementScenario.tickRateHz },
        }, serverTimeMs);
      }
      sendAuthority(0);

      for (nowMs = 0; nowMs <= 6000; nowMs += 1) {
        for (const authority of snapshotChannel.receive(nowMs)) {
          clientInput.receiveAuthority(authority);
          interpolator.pushState(authority, { timestampMs: nowMs });
        }
        const isFixedStep = nextFixedAtMs <= nowMs + 1e-8;
        if (isFixedStep) {
          clientInput.captureAndPredict();
        }
        const deliveredCommands = commandChannel.receive(nowMs);
        maximumCommandBurst = Math.max(maximumCommandBurst, deliveredCommands.length);
        for (const command of deliveredCommands) {
          assert.equal(authoritativeInput.receiveInput(serverPlayer, command, nowMs), true);
        }
        maximumQueue = Math.max(maximumQueue, serverPlayer.__inputBuffer?.queue.length ?? 0);
        if (isFixedStep) {
          worldTick += 1;
          authoritativeInput.simulatePlayer({
            player: serverPlayer,
            dtSec: fixedDtSec,
            loopTick: worldTick,
            nowMs,
            simulate: (input, dtSec) => movementScenario.simulate(serverPlayer, input, dtSec),
          });
          sendAuthority(nextFixedAtMs);
          previousFixedAtMs = nextFixedAtMs;
          nextFixedAtMs += stepMs;
        }
        maximumPending = Math.max(maximumPending, clientInput.getStats().pendingCommands);
        if (nextRenderAtMs > nowMs + 1e-8) continue;
        nextRenderAtMs += renderIntervalMs;
        const localPose = clientInput.getRenderPose(renderIntervalMs / 1000, (nowMs - previousFixedAtMs) / stepMs);
        const remotePose = interpolator.getInterpolatedPositions(
          (authority) => ({ position: movementScenario.readPosition(authority.state) }),
          { nowMs },
        );
        if (!localPose || !remotePose) continue;

        const interpolationStats = interpolator.getNetworkStats();
        assert.ok(interpolationStats.playbackTimeMs >= previousPlaybackTimeMs);
        previousPlaybackTimeMs = interpolationStats.playbackTimeMs;
        if (nowMs > 600 && nowMs < 2200 && previousLocalPosition !== null) {
          assert.ok(localPose.position >= previousLocalPosition - 1e-8, "fixed render interpolation cannot reverse steady movement");
          assert.ok(localPose.position - previousLocalPosition <= movementScenario.speed * (renderIntervalMs + 2) / 1000 + 1e-8);
          assert.ok(remotePose.position >= previousRemotePosition - 1e-8, "ordered jitter cannot rewind remote movement");
        }
        if (nowMs > 4800 && previousLocalPosition !== null) {
          restingMovement = Math.max(restingMovement, Math.abs(localPose.position - previousLocalPosition));
          restingMovement = Math.max(restingMovement, Math.abs(remotePose.position - previousRemotePosition));
        }
        previousLocalPosition = localPose.position;
        previousRemotePosition = remotePose.position;
      }

      assert.ok(maximumCommandBurst >= 3, "the scenario must deliver an ordered command burst");
      assert.ok(maximumPending > roundTripMs / stepMs / 2 && maximumPending <= 240);
      assert.ok(maximumQueue <= 120);
      assert.ok(restingMovement < 1e-6, `resting motion ${restingMovement}`);
      assert.equal(serverPlayer.inputEpoch, 1);
      assert.equal(clientInput.getStats().hardSnaps, 0);
      assert.equal(movementScenario.readActions(serverPlayer), 1);
      assert.equal(movementScenario.readPosition(clientInput.getState()), movementScenario.readPosition(serverPlayer));
      assert.equal(interpolator.getNetworkStats().packetLossPct, 0, "ordered delivery gaps are not dropped snapshots");
      assert.ok(interpolator.getNetworkStats().interpDelayMs <= 200);
    });
  }
}

test("a 1300 ms transport stall resets ownership once and resumes with fresh commands", () => {
  const fixedDtSec = 1 / 60;
  const stepMs = fixedDtSec * 1000;
  const commandChannel = createOrderedNetworkChannel({
    oneWayDelayMs: 250,
    jitterMs: 60,
    stalls: [{ startMs: 900, durationMs: 1300 }],
  });
  const snapshotChannel = createOrderedNetworkChannel({ oneWayDelayMs: 250, jitterMs: 60 });
  const serverPlayer = { distance: 0, hopCount: 0, hopHeld: false };
  const serverInput = createAuthoritativeInputSession({ inputTemplate: { move: false, hop: false }, edgeKeys: ["hop"] });
  serverInput.resetPlayer(serverPlayer);
  let nowMs = 0;
  function simulateMovement(player, input, dtSec) {
    player.distance += input.move ? 60 * dtSec : 0;
    if (input.hop && !player.hopHeld) player.hopCount += 1;
    player.hopHeld = input.hop;
  }
  const clientInput = createPredictedInputSession({
    captureInput: () => ({ move: nowMs < 3000, hop: nowMs >= 2600 && nowMs < 2600 + stepMs }),
    sendInput: (packet) => commandChannel.send(packet, nowMs),
    simulate: simulateMovement,
    extractPose: (player) => ({ distance: player.distance }),
  });
  let nextFixedAtMs = stepMs;
  let worldTick = 0;
  let staleAuthority = null;
  let rejectedOldCommands = 0;
  let maximumPending = 0;
  let ownershipChanges = 0;
  let acceptedEpoch;

  for (nowMs = 0; nowMs <= 5000; nowMs += 1) {
    for (const authority of snapshotChannel.receive(nowMs)) {
      assert.equal(clientInput.receiveAuthority(authority), true);
      if (acceptedEpoch !== undefined && acceptedEpoch !== authority.inputEpoch) ownershipChanges += 1;
      acceptedEpoch = authority.inputEpoch;
      if (authority.inputEpoch === 1) staleAuthority = authority;
    }
    if (nextFixedAtMs > nowMs + 1e-8) continue;
    clientInput.captureAndPredict();
    for (const packet of commandChannel.receive(nowMs)) {
      const previousReceiptMs = serverPlayer.__lastInputReceiptMs;
      const accepted = serverInput.receiveInput(serverPlayer, packet, nowMs);
      if (packet.epoch !== serverPlayer.inputEpoch) {
        assert.equal(accepted, false);
        assert.equal(serverPlayer.__lastInputReceiptMs, previousReceiptMs);
        rejectedOldCommands += 1;
      } else {
        assert.equal(accepted, true);
      }
    }
    worldTick += 1;
    serverInput.simulatePlayer({
      player: serverPlayer, dtSec: fixedDtSec, loopTick: worldTick, nowMs,
      simulate: (input, dtSec) => simulateMovement(serverPlayer, input, dtSec),
    });
    snapshotChannel.send({
      state: { distance: serverPlayer.distance, hopCount: serverPlayer.hopCount, hopHeld: serverPlayer.hopHeld },
      protocol: 2,
      inputEpoch: serverPlayer.inputEpoch,
      acknowledgedSequence: serverPlayer.lastInputSeqAck,
      context: { simulationTick: serverPlayer.inputSimulationTick },
    }, nowMs);
    maximumPending = Math.max(maximumPending, clientInput.getStats().pendingCommands);
    nextFixedAtMs += stepMs;
  }

  assert.equal(serverPlayer.inputEpoch, 2);
  assert.equal(ownershipChanges, 1);
  assert.ok(rejectedOldCommands >= 30);
  assert.ok(maximumPending <= 240);
  assert.equal(serverPlayer.hopCount, 1, "a fresh short press still works after ownership recovery");
  assert.equal(clientInput.getState().distance, serverPlayer.distance);
  const recoveredState = structuredClone(clientInput.getState());
  assert.equal(clientInput.receiveAuthority(staleAuthority), false);
  assert.deepEqual(clientInput.getState(), recoveredState);

  commandChannel.clear();
  snapshotChannel.clear();
  clientInput.reset();
  serverInput.resetPlayer(serverPlayer);
  assert.equal(clientInput.captureAndPredict(), null);
  clientInput.receiveAuthority({
    state: recoveredState, protocol: 2, inputEpoch: serverPlayer.inputEpoch,
    acknowledgedSequence: 0, context: { simulationTick: 0 },
  });
  assert.equal(clientInput.captureAndPredict().seq, 1);
  assert.equal(serverPlayer.inputEpoch, 3);
});
