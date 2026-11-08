import test from "node:test";
import assert from "node:assert/strict";
import { createInputLatch } from "../public/platform/frontend-engine/inputTimeline.js";
import { createPredictedInputSession } from "../public/platform/frontend-engine/predictedInputSession.js";
import { createAuthoritativeInputSession } from "../server/platform-backend-engine/core/authoritativeInputSession.js";
import { INPUT_LIMITS } from "../public/platform/shared/networkProtocol.js";
import { createOrderedNetworkChannel } from "./helpers/networkScenario.js";
import { FIGHT_INPUT_TEMPLATE, FIGHT_ACTION_EDGE_KEYS, createFightPlayerState, stepFightPlayer } from "../public/games/fight/shared/simulation.js";
import { PONG_INPUT_TEMPLATE, stepPongPaddle } from "../public/games/pong/shared/simulation.js";
import { DEAD_SHIFT_INPUT_TEMPLATE, DEAD_SHIFT_EDGE_KEYS, DEAD_SHIFT_NUMERIC_INPUTS } from "../public/games/dead-shift/shared/config.js";
import { createDeadShiftRound, stepDeadShiftPlayer, stepDeadShiftWorld } from "../public/games/dead-shift/shared/simulation.js";
import { SKY_DASH_INPUT_TEMPLATE, SKY_DASH_EDGE_KEYS, SKY_DASH_NUMERIC_INPUTS } from "../public/games/sky-dash/shared/config.js";
import { createSkyDashRound, stepSkyDashRunner, stepSkyDashWorld } from "../public/games/sky-dash/shared/simulation.js";
import { stepSkyDashPrediction } from "../public/games/sky-dash/client/snapshotPose.js";
import { RIFTBALL_INPUT_TEMPLATE, RIFTBALL_EDGE_KEYS, RIFTBALL_NUMERIC_INPUTS } from "../public/games/riftball/shared/config.js";
import { createRiftballRound, stepRiftballPlayer, stepRiftballWorld } from "../public/games/riftball/shared/simulation.js";
import { createRiftballPredictionState, stepRiftballPrediction } from "../public/games/riftball/shared/prediction.js";

const FIXED_DT_SEC = 1 / 60;
const CAPTURE_TICKS = 300;
const SCENARIO_TICKS = 440;

/** Game-owned mappings use real shared rules; both session implementations are production SDK code. */
const scenarios = {
  fight: {
    inputTemplate: FIGHT_INPUT_TEMPLATE, edgeKeys: FIGHT_ACTION_EDGE_KEYS,
    createRound: () => ({ started: true, players: { p1: { ...createFightPlayerState(300, 1), connected: true } } }),
    simulate: stepFightPlayer,
    prediction: stepFightPlayer,
    createPrediction: (snapshot) => snapshot.players.p1,
    input: (tick) => ({ right: tick <= 30 }),
    action: "jump",
    pose: (player) => ({ x: player.x, y: player.y }),
  },
  pong: {
    inputTemplate: PONG_INPUT_TEMPLATE, edgeKeys: [],
    createRound: () => ({ started: true, players: { p1: { y: 360, connected: true } } }),
    simulate: (player, input, dtSec, context) => { if (context.active) stepPongPaddle(player, input, dtSec); },
    prediction: (player, input, dtSec, context) => { if (context.active) stepPongPaddle(player, input, dtSec); },
    createPrediction: (snapshot) => snapshot.players.p1,
    input: (tick) => ({ down: tick <= 12 }),
    pose: (player) => ({ y: player.y }),
  },
  "dead-shift": {
    inputTemplate: DEAD_SHIFT_INPUT_TEMPLATE, edgeKeys: DEAD_SHIFT_EDGE_KEYS, numericInputs: DEAD_SHIFT_NUMERIC_INPUTS,
    createRound: createDeadShiftRound,
    simulate: stepDeadShiftPlayer, prediction: stepDeadShiftPlayer,
    createPrediction: (snapshot) => snapshot.players.p1,
    input: (tick) => ({ moveX: tick <= 30 ? 0.4 : 0 }), action: "jump",
    world: (round) => stepDeadShiftWorld(round, FIXED_DT_SEC, { spawnEnemies: false }),
    pose: (player) => ({ x: player.x, y: player.y, z: player.z }),
  },
  "sky-dash": {
    inputTemplate: SKY_DASH_INPUT_TEMPLATE, edgeKeys: SKY_DASH_EDGE_KEYS, numericInputs: SKY_DASH_NUMERIC_INPUTS,
    createRound: () => createSkyDashRound({ botCount: 0 }),
    simulate: stepSkyDashRunner,
    prediction: (player, input, dtSec, context) => stepSkyDashPrediction(player, input, dtSec, context, stepSkyDashRunner),
    createPrediction: (snapshot) => ({ ...snapshot.players.p1, predictionTimeSec: snapshot.timeSec, predictionBaseSeesaws: snapshot.seesaws, predictionSeesaws: snapshot.seesaws, predictionSeesawElapsedSec: 0 }),
    input: (tick) => ({ moveX: tick <= 20 ? 0.2 : 0 }), action: "jump",
    world: (round) => stepSkyDashWorld(round, FIXED_DT_SEC),
    pose: (player) => ({ x: player.x, y: player.y, z: player.z }),
  },
  riftball: {
    inputTemplate: RIFTBALL_INPUT_TEMPLATE, edgeKeys: RIFTBALL_EDGE_KEYS, numericInputs: RIFTBALL_NUMERIC_INPUTS,
    createRound: createRiftballRound,
    simulate: stepRiftballPlayer, prediction: stepRiftballPrediction,
    createPrediction: (snapshot) => createRiftballPredictionState(snapshot, "p1"),
    input: (tick) => ({ moveX: tick <= 30 ? 0.4 : 0, aimZ: -1 }), action: "jump",
    world: (round) => stepRiftballWorld(round, FIXED_DT_SEC),
    pose: (player) => ({ x: player.x, y: player.y, z: player.z }),
  },
};

for (const [gameId, scenario] of Object.entries(scenarios)) {
  for (const roundTripMs of [150, 300, 500]) {
    test(`${gameId} converges at ${roundTripMs} ms RTT with jitter, ordered bursts and a short action`, () => {
      const round = scenario.createRound();
      round.started = true;
      if (gameId === "riftball") round.phase = "playing";
      for (const player of Object.values(round.players)) player.connected = true;
      const inputConfig = { inputTemplate: scenario.inputTemplate, edgeKeys: scenario.edgeKeys, numericInputs: scenario.numericInputs, fixedDtSec: FIXED_DT_SEC };
      const serverSession = createAuthoritativeInputSession(inputConfig);
      for (const player of Object.values(round.players)) serverSession.resetPlayer(player);
      const inputLatch = createInputLatch(scenario.inputTemplate, inputConfig);
      const commands = createOrderedNetworkChannel({ oneWayDelayMs: roundTripMs / 2, jitterMs: 60, stalls: [{ startMs: 750, durationMs: 200 }, { startMs: 2100, durationMs: 200 }] });
      const snapshots = createOrderedNetworkChannel({ oneWayDelayMs: roundTripMs / 2, jitterMs: 60, stalls: [{ startMs: 1600, durationMs: 200 }] });
      let tick = 0;
      let currentTimeMs = 0;
      let maximumPending = 0;
      let maximumQueue = 0;
      let maximumBurst = 0;
      let authoritySawJump = false;
      let immediateLocalMovement = false;
      let lastPresented = null;
      let restingMovement = 0;
      let playingRestMovement = 0;
      const clientSession = createPredictedInputSession({
        fixedDtSec: FIXED_DT_SEC,
        captureInput: () => inputLatch.capture(),
        sendInput: (packet) => commands.send(packet, currentTimeMs),
        simulate: scenario.prediction,
        extractPose: scenario.pose,
        maxSmoothingDistance: gameId === "fight" || gameId === "pong" ? 250 : 1.5,
      });

      function receiveSnapshot(snapshot) {
        const retained = structuredClone(snapshot);
        const player = snapshot.players.p1;
        clientSession.receiveAuthority({
          state: scenario.createPrediction(snapshot), protocol: 2, inputEpoch: player.inputEpoch,
          acknowledgedSequence: player.inputSeqAck,
          context: {
            active: snapshot.started,
            simulationTick: player.inputSimulationTick,
            timeSec: snapshot.timeSec ?? 0,
            players: Object.values(snapshot.players),
            seesaws: snapshot.seesaws,
            continuityKey: `${snapshot.roundId ?? 0}:${player.respawnId ?? 0}`,
          },
        });
        assert.deepEqual(snapshot, retained, "replay cannot mutate authority");
      }

      function createSnapshot() {
        const snapshot = structuredClone(round);
        for (const [playerId, player] of Object.entries(round.players)) {
          const { __inputBuffer, ...playerSnapshot } = snapshot.players[playerId];
          snapshot.players[playerId] = { ...playerSnapshot, ...serverSession.getPlayerSnapshotMetadata(player) };
        }
        return snapshot;
      }
      receiveSnapshot(createSnapshot());
      const startingPose = scenario.pose(clientSession.getState());
      for (tick = 1; tick <= SCENARIO_TICKS; tick += 1) {
        currentTimeMs = tick * FIXED_DT_SEC * 1000;
        for (const snapshot of snapshots.receive(currentTimeMs)) receiveSnapshot(snapshot);
        if (tick <= CAPTURE_TICKS) {
          const input = { ...scenario.inputTemplate, ...scenario.input(tick) };
          for (const [key, value] of Object.entries(input)) inputLatch.set(key, value);
          if (scenario.action && tick === 22) {
            inputLatch.set(scenario.action, true);
            inputLatch.set(scenario.action, false);
          }
          clientSession.captureAndPredict();
          if (tick === 1) immediateLocalMovement = Object.entries(scenario.pose(clientSession.getState())).some(([key, value]) => value !== startingPose[key]);
        }
        const deliveredCommands = commands.receive(currentTimeMs);
        maximumBurst = Math.max(maximumBurst, deliveredCommands.length);
        for (const packet of deliveredCommands) serverSession.receiveInput(round.players.p1, packet, currentTimeMs);
        maximumQueue = Math.max(maximumQueue, round.players.p1.__inputBuffer?.queue.length ?? 0);
        if (tick === CAPTURE_TICKS + 40) round.started = false;
        round.__loopTick = tick;
        round.__loopMonotonicNow = currentTimeMs;
        serverSession.simulateRoom({
          state: round, dtSec: FIXED_DT_SEC,
          simulate: (player, input, stepSec) => {
            scenario.simulate(player, input, stepSec, { active: round.started, timeSec: round.timeSec ?? 0, players: Object.values(round.players), seesaws: round.seesaws });
            if (player === round.players.p1 && (player.vy < -1 || player.vy > 1)) authoritySawJump = true;
          },
        });
        if (scenario.world) scenario.world(round);
        snapshots.send(createSnapshot(), currentTimeMs);
        for (const alpha of [0.5, 1]) {
          const pose = { ...clientSession.getRenderPose(1 / 120, alpha) };
          assert.ok(Object.values(pose).every(Number.isFinite), "render coordinates remain finite");
          if (tick >= 410 && lastPresented) restingMovement = Math.max(restingMovement, Math.hypot(...Object.keys(pose).map((key) => pose[key] - lastPresented[key])));
          if (tick >= 220 && tick <= 280 && lastPresented) playingRestMovement = Math.max(playingRestMovement, Math.hypot(...Object.keys(pose).map((key) => pose[key] - lastPresented[key])));
          lastPresented = pose;
        }
        maximumPending = Math.max(maximumPending, clientSession.getStats().pendingCommands);
      }
      assert.equal(immediateLocalMovement, true, "local controls do not wait for RTT");
      if (scenario.action) assert.equal(authoritySawJump, true, "the short action reaches server simulation");
      assert.ok(maximumBurst >= 3, "fixture includes ordered delivery bursts");
      assert.ok(maximumPending <= INPUT_LIMITS.MAX_PENDING_FRAMES);
      assert.ok(maximumQueue <= INPUT_LIMITS.MAX_QUEUED_FRAMES);
      assert.equal(clientSession.getStats().pendingCommands, 0);
      assert.equal(clientSession.getStats().hardSnaps, 0, "delay alone must not force a local position snap in this unobstructed scenario");
      assert.ok(restingMovement < 1e-5, `resting presentation does not vibrate: ${restingMovement}`);
      assert.ok(playingRestMovement < 1e-5, `neutral inputs stay stable while the world and snapshots continue: ${playingRestMovement}`);
      const authorityPose = scenario.pose(round.players.p1);
      for (const [key, value] of Object.entries(authorityPose)) assert.ok(Math.abs(lastPresented[key] - value) < 0.001, `${key} converges to authority`);
    });
  }
}
