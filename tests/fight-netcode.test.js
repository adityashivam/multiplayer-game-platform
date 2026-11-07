import test from "node:test";
import assert from "node:assert/strict";
import { createCommandPredictor } from "../public/platform/frontend-engine/commandPrediction.js";
import { enqueueInputFrame, consumeInputFrames } from "../server/platform-backend-engine/core/inputProtocol.js";
import { FIGHT_FIXED_DT_SEC, FIGHT_INPUT_TEMPLATE, stepFightPlayer } from "../public/platform/shared/fightSimulation.js";

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
    const predictor = createCommandPredictor({
      fixedDtSec,
      simulate: (playerState, inputState, stepSec) => stepFightPlayer(playerState, inputState, stepSec, { active: true }),
      extractPose: (playerState) => ({ x: playerState.x, y: playerState.y }),
    });
    predictor.reset(serverPlayerState);
    const oneWayTicks = Math.ceil(roundTripMs / 2 / (fixedDtSec * 1000));
    const pendingFrames = [];
    const queuedCommands = [];
    const queuedSnapshots = [];
    let previousCommandDeliveryTick = 0;
    let previousSnapshotDeliveryTick = 0;
    let protocolStarted = false;

    for (let tick = 1; tick <= 220; tick++) {
      if (tick <= 180) {
        const inputState = {
          ...FIGHT_INPUT_TEMPLATE,
          right: tick < 60,
          left: tick >= 60 && tick < 110,
          jump: tick === 35,
          attack: tick === 70,
        };
        const inputFrame = { seq: tick, input: inputState };
        pendingFrames.push(inputFrame);
        predictor.advance(inputFrame, { active: true });
        const deliveryTick = Math.max(previousCommandDeliveryTick, tick + oneWayTicks + (tick >= 40 && tick < 46 ? 6 : 0));
        queuedCommands.push({ deliveryTick, inputFrame });
        previousCommandDeliveryTick = deliveryTick;
      }

      while (queuedCommands.length && queuedCommands[0].deliveryTick <= tick) {
        const { inputFrame } = queuedCommands.shift();
        const accepted = enqueueInputFrame({
          player: serverPlayerState,
          inputTemplate: FIGHT_INPUT_TEMPLATE,
          payload: {
            type: "inputFrame",
            protocol: 2,
            epoch: 1,
            seq: inputFrame.seq,
            state: inputFrame.input,
          },
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
        while (pendingFrames.length && pendingFrames[0].seq <= snapshotPacket.ack) {
          pendingFrames.shift();
        }
        const previousPredictedState = { ...predictor.getState() };
        predictor.reconcile(
          snapshotPacket.state,
          pendingFrames,
          { active: true, simulationTick: snapshotPacket.state.inputSimulationTick },
          snapshotPacket.ack,
        );
        assert.ok(Math.abs(predictor.getState().x - previousPredictedState.x) < 1e-8, `ordinary delay X tick=${tick} ack=${snapshotPacket.ack} sim=${snapshotPacket.state.inputSimulationTick} previous=${previousPredictedState.x} next=${predictor.getState().x}`);
        assert.ok(Math.abs(predictor.getState().y - previousPredictedState.y) < 1e-8, "ordinary delay must not change correctly predicted jump physics");
      }

      predictor.getRenderPose(fixedDtSec);
    }

    assert.equal(serverPlayerState.lastInputSeqAck, 180);
    assert.equal(pendingFrames.length, 0);
    assert.equal(predictor.getStats().hardSnaps, 0);
    assert.equal(predictor.getStats().corrections, 0);
  });
}
