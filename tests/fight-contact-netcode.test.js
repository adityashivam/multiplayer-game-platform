import assert from "node:assert/strict";
import test from "node:test";
import { createPredictedInputSession } from "../public/platform/frontend-engine/predictedInputSession.js";
import { createWorkerInterpolator } from "../public/platform/frontend-engine/interpolationWorker.js";
import { createAuthoritativeInputSession } from "../server/platform-backend-engine/core/authoritativeInputSession.js";
import {
  createFightPlayerState,
  stepFightPlayer,
  resolveFightSeparation,
  FIGHT_INPUT_TEMPLATE,
  FIGHT_ACTION_EDGE_KEYS,
} from "../public/games/fight/shared/simulation.js";
import { createFightRenderContact } from "../public/games/fight/renderContact.js";

/**
 * Drive both halves of the actual SDK with symmetric delivery delay. Commands
 * travel to the authority; returned snapshots drive prediction reconciliation
 * and the game's real remote interpolator. The local fighter crosses late in a
 * jump, so its landing can precede the delayed authority's change of side.
 *
 */
function simulateDelayedFightCrossUp(roundTripMs) {
  const fixedDtSec = 1 / 60;
  const fixedDtMs = fixedDtSec * 1000;
  const oneWayTicks = Math.round(roundTripMs / 2 / fixedDtMs);
  let currentTick = 0;
  let currentInput = { ...FIGHT_INPUT_TEMPLATE };
  let latestAuthority = null;
  let previousRenderedPose = null;
  let crossedAboveOpponent = false;
  let maximumOpponentFrameDisplacement = 0;
  let minimumContactGap = Infinity;
  const commandPackets = [];
  const snapshotPackets = [];
  const renderContact = createFightRenderContact();
  const state = {
    players: {
      p1: { ...createFightPlayerState(500, 1), inputEpoch: 1, input: { ...FIGHT_INPUT_TEMPLATE } },
      p2: { ...createFightPlayerState(620, -1), inputEpoch: 1, input: { ...FIGHT_INPUT_TEMPLATE } },
    },
  };
  const authoritativeInput = createAuthoritativeInputSession({
    inputTemplate: FIGHT_INPUT_TEMPLATE,
    edgeKeys: FIGHT_ACTION_EDGE_KEYS,
  });
  const clientInput = createPredictedInputSession({
    fixedDtSec,
    captureInput: () => currentInput,
    sendInput: (inputPacket) => commandPackets.push({ deliveryTick: currentTick + oneWayTicks, inputPacket }),
    simulate: (playerState, inputState, stepSec, predictionContext) => {
      stepFightPlayer(playerState, inputState, stepSec, predictionContext);
      if (predictionContext.opponent) {
        const opponentState = { ...predictionContext.opponent };
        resolveFightSeparation(playerState, opponentState);
      }
    },
    extractPose: (playerState) => ({ x: playerState.x, y: playerState.y }),
  });
  const interpolator = createWorkerInterpolator({
    extractPositions: (snapshot) => ({
      p1x: snapshot.players.p1.x, p1y: snapshot.players.p1.y,
      p2x: snapshot.players.p2.x, p2y: snapshot.players.p2.y,
    }),
    extractVelocities: (snapshot) => ({
      p1x: snapshot.players.p1.vx, p1y: snapshot.players.p1.vy,
      p2x: snapshot.players.p2.vx, p2y: snapshot.players.p2.vy,
    }),
    interpDelayMs: 42,
    maxBufferSize: 32,
  });

  function receiveSnapshot(snapshot) {
    latestAuthority = snapshot;
    interpolator.pushState(snapshot, { timestampMs: currentTick * fixedDtMs });
    clientInput.receiveAuthority({
      state: snapshot.players.p1,
      protocol: 2,
      inputEpoch: 1,
      acknowledgedSequence: snapshot.players.p1.lastInputSeqAck ?? 0,
      context: {
        active: true,
        opponent: snapshot.players.p2,
        simulationTick: snapshot.players.p1.inputSimulationTick ?? 0,
      },
    });
  }

  receiveSnapshot({ players: structuredClone(state.players), net: { seq: 1, serverTime: 0, tickRate: 60 } });
  for (currentTick = 1; currentTick < 200; currentTick += 1) {
    while (snapshotPackets.length && snapshotPackets[0].deliveryTick <= currentTick) {
      receiveSnapshot(snapshotPackets.shift().snapshot);
    }

    // Warm up the interpolation clock before jumping. With the current -850px/s
    // jump, movement beginning 35 ticks later crosses shortly before landing.
    currentInput = {
      ...FIGHT_INPUT_TEMPLATE,
      jump: currentTick === 60,
      right: currentTick >= 95 && currentTick <= 115,
    };
    const remotePose = interpolator.getInterpolatedPositions({
      nowMs: currentTick * fixedDtMs,
      pingMs: roundTripMs,
    });
    clientInput.captureAndPredict();
    const localPose = clientInput.getRenderPose(fixedDtSec);
    const rawPose = { ...remotePose, p1x: localPose.x, p1y: localPose.y };
    const renderedPose = renderContact.sample(rawPose, {
      localPlayerId: "p1", players: latestAuthority.players,
      deltaSec: fixedDtSec, nowMs: currentTick * fixedDtMs, inputEpoch: 1,
      localSimulationPosition: clientInput.getState(),
    });
    const opponentFrameDisplacement = previousRenderedPose
      ? Math.abs(renderedPose.p2x - previousRenderedPose.p2x) : 0;
    if (currentTick > 95) {
      maximumOpponentFrameDisplacement = Math.max(maximumOpponentFrameDisplacement, opponentFrameDisplacement);
      if (Math.abs(renderedPose.p1y - renderedPose.p2y) < 100) {
        minimumContactGap = Math.min(minimumContactGap, Math.abs(renderedPose.p1x - renderedPose.p2x));
      }
    }
    previousRenderedPose = renderedPose;

    while (commandPackets.length && commandPackets[0].deliveryTick <= currentTick) {
      authoritativeInput.receiveInput(state.players.p1, commandPackets.shift().inputPacket, currentTick * fixedDtMs);
    }
    state.__loopTick = currentTick;
    state.__loopMonotonicNow = currentTick * fixedDtMs;
    const opponents = { p1: { ...state.players.p2 }, p2: { ...state.players.p1 } };
    authoritativeInput.simulateRoom({
      state,
      dtSec: fixedDtSec,
      simulate: (playerState, inputState, stepSec, playerId) => {
        stepFightPlayer(playerState, inputState, stepSec, { active: true, opponent: opponents[playerId] });
      },
    });
    resolveFightSeparation(state.players.p1, state.players.p2);
    if (state.players.p1.x > state.players.p2.x && Math.abs(state.players.p1.y - state.players.p2.y) > 100) {
      crossedAboveOpponent = true;
    }
    snapshotPackets.push({
      deliveryTick: currentTick + oneWayTicks,
      snapshot: {
        players: structuredClone(state.players),
        net: { seq: currentTick + 1, serverTime: currentTick * fixedDtMs, tickRate: 60 },
      },
    });
  }

  interpolator.destroy?.();
  return { crossedAboveOpponent, maximumOpponentFrameDisplacement, minimumContactGap, predictionStats: clientInput.getStats() };
}

for (const roundTripMs of [100, 200, 300, 500]) {
  test(`a late jump cross-up remains separated without opponent pops at ${roundTripMs}ms RTT`, () => {
    const crossUp = simulateDelayedFightCrossUp(roundTripMs);
    assert.equal(crossUp.crossedAboveOpponent, true, "exercise an actual airborne crossover");
    assert.ok(crossUp.minimumContactGap >= 120 - 1e-8);
    assert.ok(crossUp.maximumOpponentFrameDisplacement < 65, "delayed authority must not flip the opponent across the fighter");
    assert.equal(crossUp.predictionStats.hardSnaps, 0);
  });
}
