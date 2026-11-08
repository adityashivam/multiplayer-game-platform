import test from "node:test";
import assert from "node:assert/strict";
import { createGameOrientationController } from "../public/platform/src/platform-ui/services/gameOrientation.js";

test("game orientation requests landscape without automatically entering fullscreen", async () => {
  const calls = [];
  const controller = createGameOrientationController({
    orientation: { lock: async (mode) => calls.push(mode), unlock: () => calls.push("unlock") },
    requestFullscreen: async () => calls.push("fullscreen"),
  });
  controller.startSession();
  assert.deepEqual(await controller.requestLandscape(), { status: "locked" });
  controller.stopSession();
  assert.deepEqual(calls, ["landscape", "unlock"]);
});

test("unsupported and denied orientation requests are recoverable without inventing a rotation", async () => {
  const unsupported = createGameOrientationController({ orientation: undefined });
  unsupported.startSession();
  assert.equal(unsupported.canLockOrientation(), false);
  assert.deepEqual(await unsupported.requestLandscape(), { status: "unsupported" });
  const denied = createGameOrientationController({ orientation: { lock: async () => { throw new Error("Not allowed"); } } });
  denied.startSession();
  assert.deepEqual(await denied.requestLandscape(), { status: "denied" });
  denied.stopSession();
});

test("explicit landscape fullscreen requests precede orientation locking and coalesce", async () => {
  const calls = [];
  let finishFullscreen;
  const controller = createGameOrientationController({
    orientation: { lock: async (mode) => calls.push(mode) },
    requestFullscreen: () => { calls.push("fullscreen"); return new Promise((resolve) => { finishFullscreen = resolve; }); },
  });
  controller.startSession();
  const first = controller.requestLandscape({ enterFullscreen: true });
  const second = controller.requestLandscape({ enterFullscreen: true });
  assert.deepEqual(calls, ["fullscreen"]);
  finishFullscreen();
  assert.deepEqual(await first, { status: "locked" });
  assert.deepEqual(await second, { status: "locked" });
  assert.deepEqual(calls, ["fullscreen", "landscape"]);
});

test("leaving a game cancels pending orientation work and stale completion cannot unlock a new session", async () => {
  let finishOldLock;
  let unlocks = 0;
  let requests = 0;
  const controller = createGameOrientationController({ orientation: {
    lock: () => ++requests === 1 ? new Promise((resolve) => { finishOldLock = resolve; }) : Promise.resolve(),
    unlock: () => { unlocks += 1; },
  } });
  controller.startSession();
  const oldRequest = controller.requestLandscape();
  controller.stopSession();
  controller.startSession();
  assert.deepEqual(await controller.requestLandscape(), { status: "locked" });
  const unlocksBeforeOldCompletion = unlocks;
  finishOldLock();
  assert.deepEqual(await oldRequest, { status: "cancelled" });
  assert.equal(unlocks, unlocksBeforeOldCompletion);
  controller.stopSession();
  assert.equal(unlocks, unlocksBeforeOldCompletion + 1);
  assert.deepEqual(await controller.requestLandscape(), { status: "cancelled" });
});

test("an explicit fullscreen action upgrades a pending automatic rotation request", async () => {
  const calls = [];
  let finishAutomaticLock;
  let lockRequests = 0;
  const controller = createGameOrientationController({
    orientation: { lock: () => {
      calls.push("landscape");
      return ++lockRequests === 1 ? new Promise((resolve) => { finishAutomaticLock = resolve; }) : Promise.resolve();
    } },
    requestFullscreen: async () => calls.push("fullscreen"),
  });
  controller.startSession();
  const automatic = controller.requestLandscape();
  const manual = controller.requestLandscape({ enterFullscreen: true });
  assert.deepEqual(calls, ["landscape", "fullscreen"], "The gesture must enter fullscreen even while auto-rotation is pending");
  assert.deepEqual(await manual, { status: "locked" });
  finishAutomaticLock();
  assert.deepEqual(await automatic, { status: "locked" });
});

test("a synchronous browser rejection does not retain a completed request", async () => {
  let lockRequests = 0;
  let fullscreenRequests = 0;
  const controller = createGameOrientationController({
    orientation: { lock: () => { if (++lockRequests === 1) throw new Error("Denied immediately"); return Promise.resolve(); } },
    requestFullscreen: async () => { fullscreenRequests += 1; },
  });
  controller.startSession();
  assert.deepEqual(await controller.requestLandscape(), { status: "denied" });
  assert.deepEqual(await controller.requestLandscape({ enterFullscreen: true }), { status: "locked" });
  assert.equal(fullscreenRequests, 1);
});
