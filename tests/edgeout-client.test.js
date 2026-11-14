import test from "node:test";
import assert from "node:assert/strict";
import { EDGEOUT_INPUT_TEMPLATE } from "../public/games/edgeout/shared/config.js";
import { createEdgeoutMatch, stepEdgeoutFighter } from "../public/games/edgeout/shared/simulation.js";
import { createEdgeoutPredictionState, stepEdgeoutPrediction } from "../public/games/edgeout/shared/prediction.js";
import {
  composeEdgeoutRenderPose,
  createEdgeoutLocalPresentation,
  createEdgeoutPresentedFighters,
  extractEdgeoutContinuityKeys,
  extractEdgeoutPositions,
} from "../public/games/edgeout/client/snapshotPose.js";
import { createEdgeoutEventTracker } from "../public/games/edgeout/client/matchEvents.js";
import { getEdgeoutSeatHeading, projectEdgeoutMovement } from "../public/games/edgeout/client/inputState.js";

const DT_SEC = 1 / 60;

function createPracticeSnapshot() {
  const match = createEdgeoutMatch({ playerIds: ["p1"], botIds: ["cpu"] });
  Object.assign(match, { started: true, phase: "playing" });
  match.players.p1.connected = true;
  return structuredClone(match);
}

test("local prediction replays exactly what authority simulates", () => {
  const snapshot = createPracticeSnapshot();
  const predicted = createEdgeoutPredictionState(snapshot, "p1");
  const authority = structuredClone(snapshot.players.p1);
  for (let tick = 0; tick < 90; tick += 1) {
    const input = { ...EDGEOUT_INPUT_TEMPLATE, moveX: tick < 40 ? 1 : 0, dash: tick === 10, shove: tick >= 50 && tick < 70 };
    stepEdgeoutPrediction(predicted, input, DT_SEC, { active: true });
    stepEdgeoutFighter(authority, input, DT_SEC, { active: true, intactRings: snapshot.arena.intactRings });
  }
  for (const field of ["x", "y", "z", "facing", "action", "actionId", "dashCooldownSec", "shovePower"]) {
    assert.equal(predicted[field], authority[field], field);
  }
  assert.equal(createEdgeoutPredictionState(snapshot, "cpu"), null, "bots are never locally owned");
});

test("every fighter, bots included, maps to interpolation paths that snap on a new round", () => {
  const snapshot = createPracticeSnapshot();
  const positions = extractEdgeoutPositions(snapshot);
  assert.ok(Number.isFinite(positions["cpu.x"]) && Number.isFinite(positions["p1.facingSin"]));
  const firstKeys = extractEdgeoutContinuityKeys(snapshot);
  snapshot.roundNumber += 1;
  const nextKeys = extractEdgeoutContinuityKeys(snapshot);
  assert.notEqual(firstKeys["cpu.x"], nextKeys["cpu.x"]);
});

test("the local fighter renders from prediction while rivals keep authority", () => {
  const snapshot = createPracticeSnapshot();
  const predicted = createEdgeoutPredictionState(snapshot, "p1");
  predicted.x = 1.5;
  predicted.action = "charge";
  predicted.chargeSec = 0.3;
  const localPose = { x: 1.5, y: 0, z: predicted.z, facingSin: 0, facingCos: -1 };
  const pose = composeEdgeoutRenderPose(extractEdgeoutPositions(snapshot), localPose, snapshot, "p1", predicted);
  const fighters = createEdgeoutPresentedFighters(snapshot, pose, createEdgeoutLocalPresentation(predicted));
  const local = fighters.find((fighter) => fighter.id === "p1");
  const bot = fighters.find((fighter) => fighter.id === "cpu");
  assert.equal(local.x, 1.5);
  assert.equal(local.action, "charge");
  assert.equal(bot.x, snapshot.bots[0].x);

  snapshot.players.p1.action = "stunned";
  const stunned = createEdgeoutPresentedFighters(snapshot, pose, createEdgeoutLocalPresentation(predicted));
  assert.equal(stunned.find((fighter) => fighter.id === "p1").action, "stunned", "authoritative stun wins over a stale prediction");
});

test("events fire once per authoritative change and never replay on a new match", () => {
  const tracker = createEdgeoutEventTracker();
  const snapshot = createPracticeSnapshot();
  const fighters = () => createEdgeoutPresentedFighters(snapshot, null);
  assert.deepEqual(tracker.update(snapshot, fighters()), []);

  snapshot.bots[0].hitSerial = 1;
  snapshot.bots[0].lastHitKind = "charged";
  snapshot.bots[0].lastHitSpeed = 18;
  snapshot.players.p1.parrySerial = 1;
  const kinds = tracker.update(snapshot, fighters()).map((event) => event.kind);
  assert.deepEqual(kinds.sort(), ["hit", "parry"]);
  assert.deepEqual(tracker.update(snapshot, fighters()), [], "unchanged serials stay quiet");

  snapshot.matchId += 1;
  snapshot.bots[0].hitSerial = 4;
  snapshot.ringOutSerial = 3;
  assert.deepEqual(tracker.update(snapshot, fighters()), [], "a rematch rebases instead of replaying");
});

test("screen movement follows each seat's camera", () => {
  const p1Heading = getEdgeoutSeatHeading(0, 2);
  const p2Heading = getEdgeoutSeatHeading(1, 2);
  const p1Forward = projectEdgeoutMovement({ moveX: 0, moveZ: 1 }, p1Heading);
  const p2Forward = projectEdgeoutMovement({ moveX: 0, moveZ: 1 }, p2Heading);
  assert.ok(p1Forward.moveZ < -0.99, "p1 pushes forward toward -Z, at its rival");
  assert.ok(p2Forward.moveZ > 0.99, "p2 pushes forward toward +Z, at its rival");
  const p1Right = projectEdgeoutMovement({ moveX: 1, moveZ: 0 }, p1Heading);
  assert.ok(p1Right.moveX > 0.99);
});
