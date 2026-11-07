import test from "node:test";
import assert from "node:assert/strict";
import { createPredictedInputSession } from "../public/platform/frontend-engine/predictedInputSession.js";
import { enqueueInputFrame, consumeInputFrames } from "../server/platform-backend-engine/core/inputProtocol.js";
import { FIGHT_FIXED_DT_SEC, FIGHT_INPUT_TEMPLATE, stepFightPlayer } from "../public/games/fight/shared/simulation.js";

for (const roundTripMs of [0, 100, 200, 300]) {
  test(`Fight replays delayed authority without false corrections at ${roundTripMs}ms RTT and a 100ms burst`, () => {
    const fixedDtSec = FIGHT_FIXED_DT_SEC;
    const serverPlayerState = {
      x: 200,
      y: 870,
      vx: 0,
      vy: 0,
      dir: 1,
      attacking: false,
      attackTimer: 0,
      cooldownTimer: 0,
      dead: false,
      inputEpoch: 1,
    };
    let currentInputState = { ...FIGHT_INPUT_TEMPLATE };
    let currentTick = 0;
    const queuedCommands = [];
    let previousCommandDeliveryTick = 0;
    const oneWayTicks = Math.ceil(roundTripMs / 2 / (fixedDtSec * 1000));
    const inputSession = createPredictedInputSession({
      fixedDtSec,
      captureInput: () => currentInputState,
      sendInput: (inputPacket) => {
        const deliveryTick = Math.max(previousCommandDeliveryTick, currentTick + oneWayTicks + (currentTick >= 40 && currentTick < 46 ? 6 : 0));
        queuedCommands.push({ deliveryTick, inputPacket });
        previousCommandDeliveryTick = deliveryTick;
      },
      simulate: (playerState, inputState, stepSec) => stepFightPlayer(playerState, inputState, stepSec, { active: true }),
      extractPose: (playerState) => ({ x: playerState.x, y: playerState.y }),
    });
    inputSession.receiveAuthority({
      state: serverPlayerState, protocol: 2, inputEpoch: 1, context: { active: true },
    });
    const queuedSnapshots = [];
    let previousSnapshotDeliveryTick = 0;
    let protocolStarted = false;

    for (let tick = 1; tick <= 220; tick++) {
      currentTick = tick;
      if (tick <= 180) {
        currentInputState = {
          ...FIGHT_INPUT_TEMPLATE,
          right: tick < 60,
          left: tick >= 60 && tick < 110,
          jump: tick === 35,
          attack: tick === 70,
        };
        inputSession.captureAndPredict({ active: true });
      }

      while (queuedCommands.length && queuedCommands[0].deliveryTick <= tick) {
        const { inputPacket } = queuedCommands.shift();
        const accepted = enqueueInputFrame({
          player: serverPlayerState,
          inputTemplate: FIGHT_INPUT_TEMPLATE,
          payload: inputPacket,
        });
        assert.equal(accepted, true);
        protocolStarted = true;
      }

      if (protocolStarted) {
        consumeInputFrames({
          player: serverPlayerState,
          dtSec: fixedDtSec,
          continuous: true,
          edgeKeys: ["jump", "attack", "heavyAttack", "aerialAttack"],
          simulate: (inputState, stepSec) => stepFightPlayer(serverPlayerState, inputState, stepSec, { active: true }),
        });
      }

      const { __inputBuffer, ...playerSnapshot } = serverPlayerState;
      const deliveryTick = Math.max(previousSnapshotDeliveryTick, tick + oneWayTicks + (tick >= 90 && tick < 96 ? 6 : 0));
      queuedSnapshots.push({
        deliveryTick,
        state: structuredClone(playerSnapshot),
        ack: serverPlayerState.lastInputSeqAck || 0,
      });
      previousSnapshotDeliveryTick = deliveryTick;

      while (queuedSnapshots.length && queuedSnapshots[0].deliveryTick <= tick) {
        const snapshotPacket = queuedSnapshots.shift();
        const previousPredictedState = { ...inputSession.getState() };
        inputSession.receiveAuthority({
          state: snapshotPacket.state,
          protocol: 2,
          inputEpoch: 1,
          acknowledgedSequence: snapshotPacket.ack,
          context: { active: true, simulationTick: snapshotPacket.state.inputSimulationTick },
        });
        assert.ok(Math.abs(inputSession.getState().x - previousPredictedState.x) < 1e-8, `ordinary delay X tick=${tick} ack=${snapshotPacket.ack} sim=${snapshotPacket.state.inputSimulationTick} previous=${previousPredictedState.x} next=${inputSession.getState().x}`);
        assert.ok(Math.abs(inputSession.getState().y - previousPredictedState.y) < 1e-8, "ordinary delay must not change correctly predicted jump physics");
      }

      inputSession.getRenderPose(fixedDtSec);
    }

    assert.equal(serverPlayerState.lastInputSeqAck, 180);
    assert.equal(inputSession.getStats().pendingCommands, 0);
    assert.equal(inputSession.getStats().hardSnaps, 0);
    assert.equal(inputSession.getStats().corrections, 0);
  });
}
