import test from "node:test";
import assert from "node:assert/strict";
import { createRiftballInputState, projectRiftballMovement } from "../public/games/riftball/client/inputState.js";
import { createRiftballReplayBuffer } from "../public/games/riftball/client/replay.js";

test("Riftball controls preserve short taps and independent device holds", () => {
  const input = createRiftballInputState();
  input.setAction("keyboard", "strike", true);
  input.setAction("touch", "strike", true);
  input.setAction("touch", "jump", true);
  input.setAction("touch", "jump", false);
  assert.equal(input.capture().jump, true, "A press between fixed steps survives once");
  assert.equal(input.capture().jump, false);
  input.resetSource("touch");
  assert.equal(input.capture().strike, true, "Closing the touch editor must not release a physical key");
  input.setAction("keyboard", "strike", false);
  assert.equal(input.capture().strike, false);
  input.setAction("touch", "dash", true);
  input.setAction("touch", "dash", false);
  input.resetSource("touch");
  assert.equal(input.capture().dash, false, "Reset removes unconsumed touch edges");
});

test("movement stays normalized and follows either athlete's camera", () => {
  const input = createRiftballInputState();
  input.setMovement("keyboard", 1, 1);
  input.setMovement("shell", 1, 1);
  const captured = input.capture();
  assert.ok(Math.abs(Math.hypot(captured.moveX, captured.moveZ) - 1) < 1e-12);
  assert.deepEqual(projectRiftballMovement({ moveX: 0, moveZ: 1 }, 0), { moveX: 0, moveZ: 1 });
  const reversed = projectRiftballMovement({ moveX: 0, moveZ: 1 }, Math.PI);
  assert.ok(Math.abs(reversed.moveX) < 1e-12);
  assert.equal(reversed.moveZ, -1);
  assert.ok(Math.abs(projectRiftballMovement({ moveX: 1, moveZ: 0 }, Math.PI).moveX - 1) < 1e-12, "Right follows screen right when looking down the court");
  input.setMovement("keyboard", NaN, Infinity);
  input.resetSource("shell");
  assert.equal(input.capture().moveX, 0);
  assert.equal(input.capture().moveZ, 0);
});

function createFrame(timeSec, serveId = 1) {
  return {
    timeSec, gameTimeSec: timeSec, roundId: 1, playerId: "p1", phase: "playing",
    players: [{ id: "p1", x: timeSec, y: 0, z: 2, facing: 0, actionId: 1, actionTimeSec: timeSec }],
    ball: { x: timeSec, y: 0.4, z: 0, serveId },
  };
}

test("replay retains a bounded owned history and stops at its real endpoint", () => {
  const replay = createRiftballReplayBuffer({ durationSec: 2, sampleRateHz: 30 });
  for (let index = 0; index < 600; index += 1) replay.record(createFrame(index / 60));
  const stats = replay.getStats();
  assert.ok(stats.samples <= 62);
  assert.ok(stats.durationSec <= 2.04);
  assert.equal(replay.start(20), true);
  const first = replay.sample(20);
  assert.equal(first.replay, true);
  first.players[0].x = -100;
  assert.ok(replay.sample(20).players[0].x > 7, "A renderer cannot mutate replay history");
  const middle = replay.sample(21);
  assert.ok(middle.ball.x > 8 && middle.ball.x < 10);
  assert.equal(replay.sample(24).replay, true, "Present the endpoint once even if a frame overshoots it");
  assert.equal(replay.sample(24.01), null);
  assert.equal(replay.isPlaying(), false);
});

test("replay never blends a ball serve across the court and clears on a new round", () => {
  const replay = createRiftballReplayBuffer();
  replay.record(createFrame(0, 1));
  const reset = createFrame(0.1, 2);
  reset.ball.x = 40;
  replay.record(reset);
  replay.start(2);
  const sample = replay.sample(2.05);
  assert.ok(sample.ball.x === 0 || sample.ball.x === 40, "Serve identities remain discrete");
  replay.record({ ...createFrame(0), roundId: 2 });
  assert.equal(replay.isPlaying(), false);
  assert.equal(replay.getStats().samples, 1);
  replay.clear();
  assert.equal(replay.start(5), false);
});

test("the terminal scoring frame is retained even inside the normal replay sampling interval", () => {
  const replay = createRiftballReplayBuffer();
  replay.record(createFrame(0));
  replay.record(createFrame(0.1));
  const terminal = createFrame(0.11);
  terminal.ball.z = -17.6;
  terminal.goalSerial = 5;
  replay.record(terminal, { forceSample: true });
  replay.start(1);
  const endpoint = replay.sample(1 + 0.11 / 0.8);
  assert.ok(Math.abs(endpoint.ball.z + 17.6) < 1e-9);
  assert.equal(endpoint.goalSerial, 5);
});

test("ordinary 60 Hz playback displays the winning endpoint before completing", () => {
  const replay = createRiftballReplayBuffer();
  replay.record({ ...createFrame(0), ball: { ...createFrame(0).ball, z: 15 } });
  replay.record({ ...createFrame(0.1), ball: { ...createFrame(0.1).ball, z: 16.9 } });
  replay.record({ ...createFrame(0.11), goalSerial: 5, ball: { ...createFrame(0.11).ball, z: 17.45 } }, { forceSample: true });
  replay.start(1);
  let sawWinningFrame = false;
  for (let index = 0; index < 30; index += 1) {
    const frame = replay.sample(1 + index / 60);
    if (!frame) break;
    sawWinningFrame ||= frame.goalSerial === 5 && frame.ball.z > 17.4;
  }
  assert.equal(sawWinningFrame, true);
  assert.equal(replay.isPlaying(), false);
});
