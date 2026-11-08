import test from "node:test";
import assert from "node:assert/strict";
import { createPredictedInputSession } from "../public/platform/frontend-engine/predictedInputSession.js";
import { createInputLatch } from "../public/platform/frontend-engine/inputTimeline.js";
import { createInterpolator } from "../public/platform/frontend-engine/interpolation.js";
import { createAuthoritativeInputSession } from "../server/platform-backend-engine/core/authoritativeInputSession.js";
import { serializeSkyDashState } from "../server/platform-backend-engine/games/sky-dash.js";
import { INPUT_LIMITS, INPUT_PROTOCOL } from "../public/platform/shared/networkProtocol.js";
import {
  SKY_DASH_EDGE_KEYS,
  SKY_DASH_FIXED_DT_SEC,
  SKY_DASH_INPUT_TEMPLATE,
  SKY_DASH_NUMERIC_INPUTS,
} from "../public/games/sky-dash/shared/config.js";
import {
  createSkyDashBotInput,
  createSkyDashRound,
  stepSkyDashRunner,
  stepSkyDashWorld,
} from "../public/games/sky-dash/shared/simulation.js";
import {
  composeSkyDashRenderPose,
  extractSkyDashPositions,
  stepSkyDashPrediction,
} from "../public/games/sky-dash/client/snapshotPose.js";
import { sampleSkyDashObstacles, sampleSkyDashPlatforms } from "../public/games/sky-dash/shared/course.js";

/**
 * Drive the ordinary spawn with supported inputs on a deterministic 60 Hz clock.
 * Packets retain ordering, including two bursts; a final real round pause lets
 * delayed snapshots settle without changing positions or suppressing obstacles.
 * @param {{capturePause?:boolean}} [options]
 */
function simulateDelayedSkyDashRace({ capturePause = false } = {}) {
  const fixedDtMs = SKY_DASH_FIXED_DT_SEC * 1000;
  const commandDelayTicks = 3;
  const authorityDelayTicks = 9;
  const captureTicks = capturePause ? 220 : 2400;
  const round = createSkyDashRound({ playerIds: ["p1"], botCount: 1 });
  round.started = true;
  round.players.p1.connected = true;
  const serverRunner = round.players.p1;
  const serverInputSession = createAuthoritativeInputSession({
    inputTemplate: SKY_DASH_INPUT_TEMPLATE,
    numericInputs: SKY_DASH_NUMERIC_INPUTS,
    edgeKeys: SKY_DASH_EDGE_KEYS,
    fixedDtSec: SKY_DASH_FIXED_DT_SEC,
  });
  serverInputSession.resetPlayer(serverRunner);
  const inputLatch = createInputLatch(SKY_DASH_INPUT_TEMPLATE, {
    numericInputs: SKY_DASH_NUMERIC_INPUTS,
    edgeKeys: SKY_DASH_EDGE_KEYS,
  });
  const interpolator = createInterpolator({ adaptive: false, interpDelayMs: 65, maxBufferSize: 24 });
  const commandPackets = [];
  const snapshotPackets = [];
  const manualActionCounts = { jump: 0, dash: 0, dive: 0 };
  const manualActionsStarted = { jump: false, dash: false, dive: false };
  const manualActionSequences = { jump: null, dash: null, dive: null };
  const manualPressTicks = capturePause ? { jump: 68 } : { jump: 38, dive: 50, dash: 80 };
  let currentTick = 0;
  let lastCommandDeliveryTick = 0;
  let latestAuthority = serializeSkyDashState(round);
  let staleAuthority = null;
  let staleInputPacket = null;
  let knownInputEpoch = serverRunner.inputEpoch;
  let ownershipChanges = 0;
  let pendingAtOwnershipReset = null;
  let oldPacketAccepted = null;
  let oldAuthorityAccepted = null;
  let resumedFrameEpoch = null;
  let resumedJumpStarted = false;
  let capturePauseStartedAt = 0;
  let serverTimeDuringCapturePause = 0;
  let maxPendingCommands = 0;
  let maxServerQueue = 0;
  let maxCommandBurst = 0;
  let maxReplayCount = 0;
  let presentationClockLeadSec = 0;
  let movingGeometryClockChecks = 0;
  let remoteInterpolationChecks = 0;
  let sawRotatingDeck = false;
  let sawMovingSupport = false;

  const clientInputSession = createPredictedInputSession({
    fixedDtSec: SKY_DASH_FIXED_DT_SEC,
    maxPendingFrames: 32,
    maxReplayFrames: 32,
    maxSmoothingDistance: 1.2,
    captureInput: () => inputLatch.capture(),
    sendInput(inputPacket) {
      let deliveryTick = currentTick + commandDelayTicks;
      if (currentTick >= 35 && currentTick <= 40) deliveryTick = 47;
      if (currentTick >= 430 && currentTick <= 435) deliveryTick = 442;
      deliveryTick = Math.max(lastCommandDeliveryTick, deliveryTick);
      lastCommandDeliveryTick = deliveryTick;
      commandPackets.push({ deliveryTick, inputPacket });
      for (const action of SKY_DASH_EDGE_KEYS) {
        if (currentTick === manualPressTicks[action]) {
          assert.equal(inputPacket.state[action], true, "a press/release between captures must survive the latch");
          manualActionSequences[action] = inputPacket.seq;
        }
      }
      if (currentTick === (capturePause ? manualPressTicks.jump : 60)) {
        staleInputPacket = structuredClone(inputPacket);
      }
      if (capturePause && currentTick === 126) resumedFrameEpoch = inputPacket.epoch;
    },
    simulate(runner, input, stepSec, context) {
      const previousTimeSec = runner.predictionTimeSec;
      stepSkyDashPrediction(runner, input, stepSec, context, stepSkyDashRunner);
      const expectedTimeSec = previousTimeSec + (context.active ? stepSec : 0);
      assert.ok(Math.abs(runner.predictionTimeSec - expectedTimeSec) < 1e-9,
        "each replayed command must advance its owned course clock exactly once");
    },
    extractPose: (runner) => ({ x: runner.x, y: runner.y, z: runner.z, courseTimeSec: runner.predictionTimeSec }),
  });

  function receiveAuthority(snapshot) {
    const retainedSnapshot = structuredClone(snapshot);
    const authorityContext = Object.freeze({
      active: snapshot.started && !snapshot.gameOver,
      timeSec: snapshot.timeSec,
      simulationTick: snapshot.players.p1.inputSimulationTick,
    });
    const accepted = clientInputSession.receiveAuthority({
      state: { ...snapshot.players.p1, predictionTimeSec: snapshot.timeSec, predictionBaseSeesaws: snapshot.seesaws, predictionSeesawElapsedSec: 0, predictionSeesaws: snapshot.seesaws },
      protocol: INPUT_PROTOCOL.QUEUED,
      inputEpoch: snapshot.players.p1.inputEpoch,
      acknowledgedSequence: snapshot.players.p1.inputSeqAck,
      context: authorityContext,
    });
    assert.deepEqual(snapshot, retainedSnapshot, "prediction/replay must leave retained authority immutable");
    assert.equal(authorityContext.timeSec, snapshot.timeSec, "replay context remains read-only");
    if (accepted) {
      latestAuthority = snapshot;
      interpolator.pushState(snapshot, { timestampMs: currentTick * fixedDtMs });
      if (snapshot.players.p1.inputEpoch !== knownInputEpoch) {
        knownInputEpoch = snapshot.players.p1.inputEpoch;
        ownershipChanges += 1;
        pendingAtOwnershipReset = clientInputSession.getStats().pendingCommands;
      }
    }
    return accepted;
  }
  receiveAuthority(latestAuthority);

  for (currentTick = 1; currentTick <= captureTicks + 24; currentTick += 1) {
    while (snapshotPackets.length && snapshotPackets[0].deliveryTick <= currentTick) {
      receiveAuthority(snapshotPackets.shift().snapshot);
    }
    if (capturePause && knownInputEpoch === 2 && oldPacketAccepted === null) {
      assert.equal(staleInputPacket.state.jump, true, "retry a genuine previous-owner action edge");
      const previousReceiptMs = serverRunner.__lastInputReceiptMs;
      oldPacketAccepted = serverInputSession.receiveInput(serverRunner, staleInputPacket, currentTick * fixedDtMs);
      assert.equal(serverRunner.__lastInputReceiptMs, previousReceiptMs, "stale commands cannot prolong ownership");
      const predictionBeforeStaleAuthority = structuredClone(clientInputSession.getState());
      oldAuthorityAccepted = receiveAuthority(staleAuthority);
      assert.deepEqual(clientInputSession.getState(), predictionBeforeStaleAuthority);
    }
    if (capturePause && currentTick === 71) capturePauseStartedAt = round.timeSec;
    if (capturePause && currentTick === 126) serverTimeDuringCapturePause = round.timeSec - capturePauseStartedAt;
    const capturingPaused = capturePause && currentTick >= 71 && currentTick <= 125;
    if (currentTick <= captureTicks && !capturingPaused) {
      let input = { ...SKY_DASH_INPUT_TEMPLATE };
      if (currentTick <= captureTicks - 60) {
        if (capturePause) {
          input.moveZ = 0.25;
        } else if (currentTick > 130) {
          const predictedRunner = clientInputSession.getState();
          input = createSkyDashBotInput({
            ...round,
            timeSec: predictedRunner.predictionTimeSec,
            started: latestAuthority.started,
            gameOver: latestAuthority.gameOver,
          }, predictedRunner);
        }
      }
      for (const inputKey of Object.keys(SKY_DASH_INPUT_TEMPLATE)) inputLatch.set(inputKey, input[inputKey]);
      for (const action of SKY_DASH_EDGE_KEYS) {
        if (currentTick === manualPressTicks[action] || (capturePause && action === "jump" && currentTick === 140)) {
          inputLatch.set(action, true);
          inputLatch.set(action, false);
        }
      }
      clientInputSession.captureAndPredict();
    }

    let commandsDeliveredThisTick = 0;
    while (commandPackets.length && commandPackets[0].deliveryTick <= currentTick) {
      const { inputPacket } = commandPackets.shift();
      assert.equal(serverInputSession.receiveInput(serverRunner, inputPacket, currentTick * fixedDtMs), true);
      commandsDeliveredThisTick += 1;
      maxServerQueue = Math.max(maxServerQueue, serverRunner.__inputBuffer.queue.length);
    }
    maxCommandBurst = Math.max(maxCommandBurst, commandsDeliveredThisTick);
    if (currentTick === captureTicks + 4) round.started = false;
    round.__loopTick = currentTick;
    round.__loopMonotonicNow = currentTick * fixedDtMs;
    serverInputSession.simulateRoom({
      state: round,
      dtSec: SKY_DASH_FIXED_DT_SEC,
      simulate(runner, input, stepSec) {
        const previousVy = runner.vy;
        const previousDashCooldownSec = runner.dashCooldownSec;
        const previousDiveCooldownSec = runner.diveCooldownSec;
        stepSkyDashRunner(runner, input, stepSec, { active: round.started && !round.gameOver, timeSec: round.timeSec, seesaws: round.seesaws });
        if (!capturePause && currentTick <= 130) {
          for (const action of SKY_DASH_EDGE_KEYS) {
            if (input[action]) manualActionCounts[action] += 1;
          }
          manualActionsStarted.jump ||= input.jump && previousVy <= 0 && runner.vy > 0;
          manualActionsStarted.dash ||= input.dash && previousDashCooldownSec <= 0 && runner.dashCooldownSec > 0;
          manualActionsStarted.dive ||= input.dive && previousDiveCooldownSec <= 0 && runner.diveCooldownSec > 0;
        }
        if (capturePause && currentTick >= 140 && input.jump && previousVy <= 0 && runner.vy > 0) {
          resumedJumpStarted = true;
        }
      },
    });
    stepSkyDashWorld(round, SKY_DASH_FIXED_DT_SEC);
    sawRotatingDeck ||= serverRunner.z < -20 && serverRunner.z > -39 && serverRunner.y > -0.2;
    sawMovingSupport ||= serverRunner.supportId >= 3 && serverRunner.supportId <= 5;
    const snapshot = serializeSkyDashState(round);
    snapshotPackets.push({ deliveryTick: currentTick + authorityDelayTicks, snapshot });
    if (currentTick === 60) staleAuthority = snapshot;

    const predictionStats = clientInputSession.getStats();
    maxPendingCommands = Math.max(maxPendingCommands, predictionStats.pendingCommands);
    maxReplayCount = Math.max(maxReplayCount, predictionStats.lastReplayCount);
    const localPose = clientInputSession.getRenderPose(SKY_DASH_FIXED_DT_SEC);
    const remotePose = interpolator.getInterpolatedPositions(extractSkyDashPositions, { nowMs: currentTick * fixedDtMs });
    const retainedRemotePose = { ...remotePose };
    const presentedPose = composeSkyDashRenderPose(remotePose, localPose, latestAuthority, "p1");
    assert.equal(presentedPose.courseTimeSec, localPose.courseTimeSec,
      "moving geometry must use the local prediction pose's clock instead of delayed interpolation time");
    assert.equal(presentedPose["p1.x"], localPose.x);
    assert.equal(presentedPose["p1.y"], localPose.y);
    assert.equal(presentedPose["p1.z"], localPose.z);
    assert.deepEqual(remotePose, retainedRemotePose, "local composition cannot mutate the remote interpolation pose");
    for (const remoteRunner of latestAuthority.bots) {
      for (const axis of ["x", "y", "z", "respawnId"]) {
        assert.equal(presentedPose[`${remoteRunner.id}.${axis}`], remotePose[`${remoteRunner.id}.${axis}`]);
      }
      if (Math.abs(remotePose[`${remoteRunner.id}.z`] - remoteRunner.z) > 0.01) remoteInterpolationChecks += 1;
    }
    presentationClockLeadSec = Math.max(presentationClockLeadSec, localPose.courseTimeSec - remotePose.courseTimeSec);
    const predictedRunner = clientInputSession.getState();
    if (predictedRunner.z < -20 && predictedRunner.z > -63) {
      const renderedSweeper = sampleSkyDashObstacles(presentedPose.courseTimeSec)[0];
      const renderedStone = sampleSkyDashPlatforms(presentedPose.courseTimeSec)[2];
      assert.ok(Math.abs(renderedSweeper.angle - (localPose.courseTimeSec * 1.12 + 0.2)) < 1e-9);
      assert.ok(Math.abs(renderedStone.x - Math.sin(localPose.courseTimeSec * 0.65) * 1.5) < 1e-9);
      movingGeometryClockChecks += 1;
    }
    for (const field of ["x", "y", "z", "courseTimeSec"]) assert.ok(Number.isFinite(localPose[field]));
  }

  if (!capturePause) {
    const settledPrediction = structuredClone(clientInputSession.getState());
    assert.equal(receiveAuthority(staleAuthority), false, "regressing delayed acknowledgements cannot rewind prediction");
    assert.deepEqual(clientInputSession.getState(), settledPrediction);
  }
  return {
    round,
    serverRunner,
    predictedRunner: clientInputSession.getState(),
    pendingCommands: clientInputSession.getStats().pendingCommands,
    replayedCommands: clientInputSession.getStats().replayedCommands,
    undeliveredCommands: commandPackets.length,
    maxPendingCommands,
    maxServerQueue,
    maxCommandBurst,
    maxReplayCount,
    manualActionCounts,
    manualActionsStarted,
    manualActionSequences,
    sawRotatingDeck,
    sawMovingSupport,
    presentationClockLeadSec,
    movingGeometryClockChecks,
    remoteInterpolationChecks,
    ownershipChanges,
    pendingAtOwnershipReset,
    oldPacketAccepted,
    oldAuthorityAccepted,
    resumedFrameEpoch,
    resumedJumpStarted,
    serverTimeDuringCapturePause,
  };
}

test("Sky Dash replays legal course movement and short action presses through 50/150 ms delay and ordered bursts", () => {
  const session = simulateDelayedSkyDashRace();

  assert.ok(session.maxCommandBurst >= 7, "exercise an ordered delivery burst exceeding 100 ms of commands");
  assert.ok(session.maxPendingCommands >= 12, "exercise the command plus authority delay backlog");
  assert.ok(session.maxPendingCommands <= 32);
  assert.ok(session.maxServerQueue <= INPUT_LIMITS.MAX_QUEUED_FRAMES);
  assert.ok(session.maxServerQueue <= 16, "ordered bursts must drain without an accumulating server backlog");
  assert.ok(session.maxReplayCount <= 32);
  assert.ok(session.replayedCommands > 100);
  assert.deepEqual(session.manualActionCounts, { jump: 1, dash: 1, dive: 1 });
  assert.ok(session.manualActionSequences.jump > 0);
  assert.ok(session.manualActionSequences.dash > 0);
  assert.ok(session.manualActionSequences.dive > 0);
  assert.ok(session.serverRunner.lastInputSeqAck >= Math.max(...Object.values(session.manualActionSequences)));
  assert.ok(session.manualActionsStarted.jump);
  assert.ok(session.manualActionsStarted.dash);
  assert.ok(session.manualActionsStarted.dive);
  assert.ok(session.sawRotatingDeck, "reach the rotating deck using supported inputs from the ordinary spawn");
  assert.ok(session.sawMovingSupport, "land on an actual moving stone without changing runner position");
  assert.ok(session.presentationClockLeadSec > 0.1);
  assert.ok(session.movingGeometryClockChecks > 30);
  assert.ok(session.remoteInterpolationChecks > 30);
  assert.equal(session.serverRunner.inputEpoch, 1, "ordinary latency and a round pause retain command ownership");
  assert.equal(session.pendingCommands, 0);
  assert.equal(session.undeliveredCommands, 0);
  assert.equal(session.serverRunner.__inputBuffer.queue.length, 0);
  for (const field of ["x", "y", "z", "vx", "vy", "vz", "grounded", "supportId", "jumpHeld", "dashHeld", "diveHeld"]) {
    assert.equal(session.predictedRunner[field], session.serverRunner[field], `${field} must converge after the paused room drains`);
  }
  assert.equal(session.predictedRunner.predictionTimeSec, session.round.timeSec);
});

test("Sky Dash starvation changes input ownership once and rejects stale replay before legal input resumes", () => {
  const session = simulateDelayedSkyDashRace({ capturePause: true });

  assert.equal(session.serverRunner.inputEpoch, 2);
  assert.equal(session.ownershipChanges, 1);
  assert.equal(session.pendingAtOwnershipReset, 0);
  assert.equal(session.oldPacketAccepted, false);
  assert.equal(session.oldAuthorityAccepted, false);
  assert.ok(session.serverTimeDuringCapturePause > 0.7, "a capture pause does not stop the authoritative course clock");
  assert.equal(session.resumedFrameEpoch, 2);
  assert.ok(session.resumedJumpStarted, "a fresh short press must work after starvation recovery");
  assert.ok(session.maxPendingCommands <= 32);
  assert.ok(session.maxServerQueue <= INPUT_LIMITS.MAX_QUEUED_FRAMES);
  assert.equal(session.pendingCommands, 0);
  assert.equal(session.undeliveredCommands, 0);
  assert.equal(session.serverRunner.__inputBuffer.queue.length, 0);
  for (const field of ["x", "y", "z", "vx", "vy", "vz", "jumpHeld", "dashHeld", "diveHeld"]) {
    assert.equal(session.predictedRunner[field], session.serverRunner[field]);
  }
  assert.equal(session.predictedRunner.predictionTimeSec, session.round.timeSec);
});
