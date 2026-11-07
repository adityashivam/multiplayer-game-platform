import test from "node:test";
import assert from "node:assert/strict";
import { createPredictedInputSession } from "../public/platform/frontend-engine/predictedInputSession.js";
import { createWorkerInterpolator } from "../public/platform/frontend-engine/interpolationWorker.js";
import { createAuthoritativeInputSession } from "../server/platform-backend-engine/core/authoritativeInputSession.js";
import {
  createFightPlayerState, stepFightPlayer, resolveFightSeparation, resolveFightExchange,
  FIGHT_INPUT_TEMPLATE, FIGHT_ACTION_EDGE_KEYS,
} from "../public/games/fight/shared/simulation.js";
import { createFightRenderContact } from "../public/games/fight/renderContact.js";

const FIXED_DT_SEC = 1 / 60;
const FIXED_DT_MS = FIXED_DT_SEC * 1000;
const ATTACK_KEYS = ["attack", "heavyAttack", "aerialAttack", "attack"];
const JITTER_FRAMES = [-2, -1, 0, 1, 2, 1, 0];

/** Exercise two independently predicted views through actual SDK delivery and combat. */
function simulateDelayedCombatContacts(jitterEnabled) {
  const state = { players: {
    p1: { ...createFightPlayerState(500, 1), inputEpoch: 1, input: { ...FIGHT_INPUT_TEMPLATE } },
    p2: { ...createFightPlayerState(620, -1), inputEpoch: 1, input: { ...FIGHT_INPUT_TEMPLATE } },
  } };
  let currentTick = 0;
  let packetCount = 0;
  let impactCount = 0;
  let gameOver = false;
  const authoritativeInput = createAuthoritativeInputSession({
    inputTemplate: FIGHT_INPUT_TEMPLATE, edgeKeys: FIGHT_ACTION_EDGE_KEYS,
  });

  function readDeliveryTick(previousDeliveryTick) {
    const jitterFrames = jitterEnabled ? JITTER_FRAMES[packetCount++ % JITTER_FRAMES.length] : 0;
    return Math.max(previousDeliveryTick, currentTick + 9 + jitterFrames);
  }

  function createFightTestClient(playerId) {
    const opponentId = playerId === "p1" ? "p2" : "p1";
    const client = {
      playerId, opponentId, inputState: { ...FIGHT_INPUT_TEMPLATE }, authority: null,
      commandPackets: [], snapshotPackets: [], lastCommandDelivery: 0, lastSnapshotDelivery: 0,
      previousPose: null, maximumStep: 0, minimumGap: Infinity,
      renderContact: createFightRenderContact(),
    };
    client.prediction = createPredictedInputSession({
      fixedDtSec: FIXED_DT_SEC,
      captureInput: () => client.inputState,
      sendInput: (inputPacket) => {
        const deliveryTick = readDeliveryTick(client.lastCommandDelivery);
        client.lastCommandDelivery = deliveryTick;
        client.commandPackets.push({ deliveryTick, inputPacket });
      },
      simulate: (playerState, inputState, dtSec, context) => {
        stepFightPlayer(playerState, inputState, dtSec, context);
        if (context.opponent) {
          const opponent = { ...context.opponent };
          if (playerId === "p1") resolveFightSeparation(playerState, opponent);
          else resolveFightSeparation(opponent, playerState);
        }
      },
      extractPose: (playerState) => ({ x: playerState.x, y: playerState.y }),
    });
    client.interpolator = createWorkerInterpolator({
      extractPositions: (snapshot) => ({
        p1x: snapshot.players.p1.x, p1y: snapshot.players.p1.y,
        p2x: snapshot.players.p2.x, p2y: snapshot.players.p2.y,
      }),
      extractVelocities: (snapshot) => ({
        p1x: snapshot.players.p1.vx, p1y: snapshot.players.p1.vy,
        p2x: snapshot.players.p2.vx, p2y: snapshot.players.p2.vy,
      }),
      interpDelayMs: 42, maxBufferSize: 32,
    });
    return client;
  }

  function receiveSnapshot(client, snapshot) {
    client.authority = snapshot;
    client.interpolator.pushState(snapshot, { timestampMs: currentTick * FIXED_DT_MS });
    const playerState = snapshot.players[client.playerId];
    client.prediction.receiveAuthority({
      state: playerState, protocol: 2, inputEpoch: 1,
      acknowledgedSequence: playerState.lastInputSeqAck ?? 0,
      context: { active: !gameOver, opponent: snapshot.players[client.opponentId], simulationTick: playerState.inputSimulationTick ?? 0 },
    });
  }

  const clients = [createFightTestClient("p1"), createFightTestClient("p2")];
  for (const client of clients) {
    receiveSnapshot(client, { players: structuredClone(state.players), net: { seq: 1, serverTime: 0, tickRate: 60 } });
  }
  let movementDirections = { p1: "right", p2: "left" };

  for (currentTick = 1; currentTick < 1600 && !gameOver; currentTick++) {
    for (const client of clients) {
      while (client.snapshotPackets.length && client.snapshotPackets[0].deliveryTick <= currentTick) {
        receiveSnapshot(client, client.snapshotPackets.shift().snapshot);
      }
    }
    const exchangeIndex = Math.floor((currentTick - 60) / 44);
    const startsExchange = currentTick >= 60 && (currentTick - 60) % 44 === 0;
    if (startsExchange) {
      const players = clients[0].authority.players;
      const p1IsLeft = players.p1.x < players.p2.x;
      movementDirections = { p1: p1IsLeft ? "right" : "left", p2: p1IsLeft ? "left" : "right" };
    }

    for (const client of clients) {
      const attackingId = exchangeIndex % 3 === 0 ? "p2" : "p1";
      const attackKey = ATTACK_KEYS[Math.max(0, exchangeIndex) % ATTACK_KEYS.length];
      client.inputState = {
        ...FIGHT_INPUT_TEMPLATE,
        ...(currentTick >= 60 ? { [movementDirections[client.playerId]]: true } : {}),
        ...(startsExchange && client.playerId === attackingId ? { [attackKey]: true } : {}),
      };
      const remotePose = client.interpolator.getInterpolatedPositions({
        nowMs: currentTick * FIXED_DT_MS, pingMs: 300, jitterP95Ms: jitterEnabled ? 30 : 0,
      });
      client.prediction.captureAndPredict();
      const localPose = client.prediction.getRenderPose(FIXED_DT_SEC);
      const renderedPose = client.renderContact.sample({
        ...remotePose, [`${client.playerId}x`]: localPose.x, [`${client.playerId}y`]: localPose.y,
      }, {
        localPlayerId: client.playerId, players: client.authority.players,
        deltaSec: FIXED_DT_SEC, nowMs: currentTick * FIXED_DT_MS, inputEpoch: 1,
        localSimulationPosition: client.prediction.getState(),
      });
      if (currentTick > 60 && client.previousPose) {
        client.maximumStep = Math.max(client.maximumStep,
          Math.abs(renderedPose.p1x - client.previousPose.p1x), Math.abs(renderedPose.p2x - client.previousPose.p2x));
      }
      if (Math.abs(renderedPose.p1y - renderedPose.p2y) < 100) {
        client.minimumGap = Math.min(client.minimumGap, Math.abs(renderedPose.p1x - renderedPose.p2x));
      }
      client.previousPose = renderedPose;
    }

    for (const client of clients) {
      while (client.commandPackets.length && client.commandPackets[0].deliveryTick <= currentTick) {
        authoritativeInput.receiveInput(state.players[client.playerId], client.commandPackets.shift().inputPacket, currentTick * FIXED_DT_MS);
      }
    }
    state.__loopTick = currentTick;
    state.__loopMonotonicNow = currentTick * FIXED_DT_MS;
    const opponents = { p1: { ...state.players.p2 }, p2: { ...state.players.p1 } };
    authoritativeInput.simulateRoom({
      state, dtSec: FIXED_DT_SEC,
      simulate: (playerState, inputState, dtSec, playerId) =>
        stepFightPlayer(playerState, inputState, dtSec, { active: true, opponent: opponents[playerId] }),
    });
    resolveFightSeparation(state.players.p1, state.players.p2);
    const impacts = resolveFightExchange(state.players.p1, state.players.p2);
    impactCount += Number(Boolean(impacts.p1)) + Number(Boolean(impacts.p2));
    gameOver = state.players.p1.dead || state.players.p2.dead;
    for (const client of clients) {
      const deliveryTick = readDeliveryTick(client.lastSnapshotDelivery);
      client.lastSnapshotDelivery = deliveryTick;
      client.snapshotPackets.push({ deliveryTick, snapshot: {
        players: structuredClone(state.players),
        net: { seq: currentTick + 1, serverTime: currentTick * FIXED_DT_MS, tickRate: 60 },
      } });
    }
  }

  for (const client of clients) client.interpolator.destroy?.();
  return { clients, impactCount, gameOver };
}

for (const jitterEnabled of [false, true]) {
  test(`launcher exchanges preserve both rendered fighters at300ms RTT${jitterEnabled ? " with jitter" : ""}`, () => {
    const duel = simulateDelayedCombatContacts(jitterEnabled);
    assert.ok(duel.impactCount > 10, "the scenario must exercise actual combat and launcher reactions");
    for (const client of duel.clients) {
      assert.ok(client.minimumGap >= 120 - 1e-8);
      assert.ok(client.maximumStep < 100, `player ${client.playerId} sees a${client.maximumStep}px side pop`);
      assert.equal(client.prediction.getStats().hardSnaps, 0);
    }
  });
}
