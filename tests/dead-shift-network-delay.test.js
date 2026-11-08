import test from "node:test";
import assert from "node:assert/strict";
import { createPredictedInputSession } from "../public/platform/frontend-engine/predictedInputSession.js";
import { createInputLatch } from "../public/platform/frontend-engine/inputTimeline.js";
import { createAuthoritativeInputSession } from "../server/platform-backend-engine/core/authoritativeInputSession.js";
import { serializeDeadShiftState } from "../server/platform-backend-engine/games/dead-shift.js";
import { INPUT_LIMITS, INPUT_PROTOCOL } from "../public/platform/shared/networkProtocol.js";
import {
  DEAD_SHIFT_EDGE_KEYS,
  DEAD_SHIFT_FIXED_DT_SEC,
  DEAD_SHIFT_INPUT_TEMPLATE,
  DEAD_SHIFT_NUMERIC_INPUTS,
} from "../public/games/dead-shift/shared/config.js";
import {
  createDeadShiftRound,
  damageDeadShiftPlayer,
  spawnDeadShiftEnemy,
  stepDeadShiftCombat,
  stepDeadShiftPlayer,
} from "../public/games/dead-shift/shared/simulation.js";

/** @param {import("../public/games/dead-shift/shared/simulation.js").DeadShiftPlayerState} playerState */
function readDeadShiftCombatState(playerState) {
  return {
    health: playerState.health,
    kills: playerState.kills,
    weapon: playerState.weapon,
    ammo: playerState.ammo,
    shotId: playerState.shotId,
  };
}

/**
 * Run both real SDK sessions on a deterministic clock. Authority returns 150 ms
 * late; commands normally arrive after 50 ms, with two ordered delivery bursts.
 * Keep one stationary enemy so this fixture isolates transport, reconciliation
 * and authoritative fire/score ownership from unrelated AI decisions.
 */
function simulateDelayedDeadShiftSession() {
  const fixedDtMs = DEAD_SHIFT_FIXED_DT_SEC * 1000;
  const authorityDelayTicks = 9;
  const commandDelayTicks = 3;
  const inputLatch = createInputLatch(DEAD_SHIFT_INPUT_TEMPLATE, {
    numericInputs: DEAD_SHIFT_NUMERIC_INPUTS,
    edgeKeys: DEAD_SHIFT_EDGE_KEYS,
  });
  const round = createDeadShiftRound();
  round.roundId = 1;
  round.started = true;
  Object.assign(round.players.p1, { connected: true, x: -13.5, z: 8 });
  round.players.p2.connected = true;
  const enemy = spawnDeadShiftEnemy(round, "walker", -13, 0);
  const serverInputSession = createAuthoritativeInputSession({
    inputTemplate: DEAD_SHIFT_INPUT_TEMPLATE,
    numericInputs: DEAD_SHIFT_NUMERIC_INPUTS,
    edgeKeys: DEAD_SHIFT_EDGE_KEYS,
    fixedDtSec: DEAD_SHIFT_FIXED_DT_SEC,
  });
  for (const player of Object.values(round.players)) serverInputSession.resetPlayer(player);

  const commandPackets = [];
  const snapshotPackets = [];
  let currentTick = 0;
  let previousCommandDeliveryTick = 0;
  let latestAuthority = serializeDeadShiftState(round);
  let staleAuthority = null;
  let maxPendingCommands = 0;
  let maxServerQueue = 0;
  let maxCommandBurst = 0;
  let maxCorrectionDistance = 0;
  let maxJumpHeight = 0;
  let firstServerShotTick = null;
  let firstClientKillTick = null;
  let shortFireSequence = null;
  let shotYaw = 0;
  const clientInputSession = createPredictedInputSession({
    fixedDtSec: DEAD_SHIFT_FIXED_DT_SEC,
    maxPendingFrames: 32,
    maxSmoothingDistance: 1.5,
    captureInput: () => inputLatch.capture(),
    sendInput: (inputPacket) => {
      let deliveryTick = currentTick + commandDelayTicks;
      if (currentTick >= 35 && currentTick <= 40) deliveryTick = 47;
      if (currentTick >= 136 && currentTick <= 145) deliveryTick = 149;
      deliveryTick = Math.max(previousCommandDeliveryTick, deliveryTick);
      previousCommandDeliveryTick = deliveryTick;
      commandPackets.push({ deliveryTick, inputPacket });
      if (inputPacket.state.fire) shortFireSequence = inputPacket.seq;
    },
    simulate: stepDeadShiftPlayer,
    extractPose: (playerState) => ({ x: playerState.x, y: playerState.y, z: playerState.z }),
  });

  function receiveAuthority(snapshot) {
    const snapshotBeforeReplay = structuredClone(snapshot);
    const accepted = clientInputSession.receiveAuthority({
      state: snapshot.players.p1,
      protocol: INPUT_PROTOCOL.QUEUED,
      inputEpoch: snapshot.players.p1.inputEpoch,
      acknowledgedSequence: snapshot.players.p1.inputSeqAck,
      context: {
        active: true,
        simulationTick: snapshot.players.p1.inputSimulationTick,
        players: Object.values(snapshot.players),
      },
    });
    assert.deepEqual(snapshot, snapshotBeforeReplay, "replay must not mutate retained authority");
    if (accepted) latestAuthority = snapshot;
    return accepted;
  }
  receiveAuthority(latestAuthority);

  for (currentTick = 1; currentTick <= 250; currentTick += 1) {
    while (snapshotPackets.length && snapshotPackets[0].deliveryTick <= currentTick) {
      receiveAuthority(snapshotPackets.shift().snapshot);
    }
    if (currentTick <= 220) {
      inputLatch.set("moveX", currentTick <= 30 ? 0.45 : currentTick <= 60 ? -0.45 : 0);
      inputLatch.set("moveZ", currentTick <= 45 ? 0.65 : currentTick <= 100 ? -0.4 : 0);
      inputLatch.set("yaw", currentTick <= 100 ? Math.sin(currentTick / 15) * 0.18 : shotYaw);
      inputLatch.set("pitch", currentTick <= 100 ? Math.sin(currentTick / 11) * 0.15 : 0);
      inputLatch.set("weapon", currentTick >= 25 && currentTick <= 70 ? 2 : 0);
      inputLatch.set("sprint", currentTick >= 12 && currentTick <= 25);
      if (currentTick === 38) {
        inputLatch.set("jump", true);
        inputLatch.set("jump", false);
      }
      if (currentTick === 140) {
        const player = clientInputSession.getState();
        shotYaw = Math.atan2(player.x - enemy.x, player.z - enemy.z);
        inputLatch.set("yaw", shotYaw);
        // The complete click occurs between captures, inside a delivery burst.
        inputLatch.set("fire", true);
        inputLatch.set("fire", false);
      }
      clientInputSession.captureAndPredict();
      assert.deepEqual(
        readDeadShiftCombatState(clientInputSession.getState()),
        readDeadShiftCombatState(latestAuthority.players.p1),
        "local commands must never predict health, ammunition or kill results",
      );
      maxJumpHeight = Math.max(maxJumpHeight, clientInputSession.getState().y);
    }

    let commandsDeliveredThisTick = 0;
    while (commandPackets.length && commandPackets[0].deliveryTick <= currentTick) {
      const { inputPacket } = commandPackets.shift();
      assert.equal(serverInputSession.receiveInput(round.players.p1, inputPacket, currentTick * fixedDtMs), true);
      commandsDeliveredThisTick += 1;
      maxServerQueue = Math.max(maxServerQueue, round.players.p1.__inputBuffer.queue.length);
    }
    maxCommandBurst = Math.max(maxCommandBurst, commandsDeliveredThisTick);
    round.__loopTick = currentTick;
    round.__loopMonotonicNow = currentTick * fixedDtMs;
    serverInputSession.simulateRoom({
      state: round,
      dtSec: DEAD_SHIFT_FIXED_DT_SEC,
      simulate: (playerState, inputState, stepSec) => {
        stepDeadShiftPlayer(playerState, inputState, stepSec, { active: true });
        stepDeadShiftCombat(round, playerState, inputState, stepSec);
      },
    });
    if (round.players.p1.shotId > 0 && firstServerShotTick === null) firstServerShotTick = currentTick;
    if (clientInputSession.getState().kills > 0 && firstClientKillTick === null) firstClientKillTick = currentTick;
    if (currentTick === 170) damageDeadShiftPlayer(round, round.players.p1, 23, "enemy");
    const snapshot = serializeDeadShiftState(round);
    snapshotPackets.push({ deliveryTick: currentTick + authorityDelayTicks, snapshot });
    if (currentTick === 130) staleAuthority = snapshot;
    const stats = clientInputSession.getStats();
    maxPendingCommands = Math.max(maxPendingCommands, stats.pendingCommands);
    maxCorrectionDistance = Math.max(maxCorrectionDistance, stats.correctionDistance);
    clientInputSession.getRenderPose(DEAD_SHIFT_FIXED_DT_SEC);
  }

  const settledPrediction = structuredClone(clientInputSession.getState());
  assert.equal(receiveAuthority(staleAuthority), false, "delayed regressing acknowledgements must be ignored");
  assert.deepEqual(clientInputSession.getState(), settledPrediction);

  return {
    round,
    predictedPlayer: clientInputSession.getState(),
    predictionStats: clientInputSession.getStats(),
    maxPendingCommands,
    maxServerQueue,
    maxCommandBurst,
    maxCorrectionDistance,
    maxJumpHeight,
    firstServerShotTick,
    firstClientKillTick,
    shortFireSequence,
    undeliveredCommands: commandPackets.length,
  };
}

test("Dead Shift reconciles numeric movement with 150 ms authority delay and preserves a short fire pulse through bursts", () => {
  const session = simulateDelayedDeadShiftSession();
  assert.ok(session.maxJumpHeight > 0.7, "exercise the shared jump simulation during a command burst");
  assert.ok(session.maxCommandBurst >= 10, "exercise coalesced delivery rather than a constant-delay stream");
  assert.ok(session.maxServerQueue <= INPUT_LIMITS.MAX_QUEUED_FRAMES);
  assert.ok(session.maxServerQueue <= 16, "the configured delivery bursts must drain promptly");
  assert.ok(session.maxPendingCommands >= 12, "exercise a real delayed reconciliation backlog");
  assert.ok(session.maxPendingCommands <= 32);
  assert.ok(session.maxCorrectionDistance < 1.5, "late turns/jumps must recover inside the game's smoothing budget");
  assert.equal(session.predictionStats.hardSnaps, 0);
  assert.equal(session.predictionStats.pendingCommands, 0);
  assert.equal(session.undeliveredCommands, 0);
  assert.equal(session.round.players.p1.__inputBuffer.queue.length, 0);
  assert.equal(session.round.players.p1.inputEpoch, 1, "ordinary delay must not reset ownership");
  assert.ok(session.shortFireSequence > 0);
  assert.ok(session.round.players.p1.lastInputSeqAck >= session.shortFireSequence);
  assert.equal(session.round.players.p1.shotId, 1);
  assert.equal(session.round.players.p1.kills, 1);
  assert.equal(session.round.players.p1.ammo, 29);
  assert.equal(session.round.players.p1.health, 77);
  assert.equal(session.firstClientKillTick - session.firstServerShotTick, 9,
    "the kill may appear only when its 150 ms delayed authoritative snapshot arrives");
  assert.equal(session.round.events.filter((event) => event.id > 0 && event.kind === "shot").length, 1);
  assert.equal(session.round.events.filter((event) => event.id > 0 && event.kind === "kill").length, 1);
  assert.equal(session.round.events.length, 32);
  assert.deepEqual(readDeadShiftCombatState(session.predictedPlayer), readDeadShiftCombatState(session.round.players.p1));
  for (const coordinate of ["x", "y", "z", "yaw", "pitch"]) {
    assert.ok(Math.abs(session.predictedPlayer[coordinate] - session.round.players.p1[coordinate]) < 1e-8,
      `${coordinate} must converge after pending commands and delayed snapshots drain`);
  }
});
