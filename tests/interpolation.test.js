import test from "node:test";
import assert from "node:assert/strict";
import { createInterpolator } from "../public/platform/frontend-engine/interpolation.js";

function createServerSnapshot(sequenceNumber, serverTimeMs, x = serverTimeMs) {
  return {
    x,
    net: { seq: sequenceNumber, serverTime: serverTimeMs },
  };
}

const extractPositions = (serverState) => ({ x: serverState.x });

test("playback does not move backwards when delay increases", () => {
  const interpolator = createInterpolator({ adaptive: false, interpDelayMs: 20, maxBufferSize: 50 });
  for (let sampleIndex = 0; sampleIndex <= 20; sampleIndex++) {
    interpolator.pushState(createServerSnapshot(sampleIndex, sampleIndex * 10), { timestampMs: sampleIndex * 10 });
  }
  interpolator.getInterpolatedPositions(extractPositions, { nowMs: 120 });
  const previousPlaybackTimeMs = interpolator.getNetworkStats().playbackTimeMs;
  interpolator.getInterpolatedPositions(extractPositions, { nowMs: 130, interpDelayMs: 80 });
  const nextPlaybackTimeMs = interpolator.getNetworkStats().playbackTimeMs;
  assert.ok(Number.isFinite(previousPlaybackTimeMs) && nextPlaybackTimeMs >= previousPlaybackTimeMs, `${previousPlaybackTimeMs} -> ${nextPlaybackTimeMs}`);
});

test("server sample spacing is independent of arrival jitter", () => {
  const interpolator = createInterpolator({ adaptive: false, interpDelayMs: 0 });
  interpolator.pushState(createServerSnapshot(0, 0), { timestampMs: 0 });
  interpolator.pushState(createServerSnapshot(1, 100), { timestampMs: 150 });
  assert.equal(interpolator.getInterpolatedPositions(extractPositions, { nowMs: 50 }).x, 50);
});

test("Hermite interpolation stays within collision endpoints", () => {
  const interpolator = createInterpolator({
    adaptive: false,
    interpDelayMs: 0,
    extractVelocities: (serverState) => ({ x: serverState.v }),
  });
  interpolator.pushState({ ...createServerSnapshot(0, 0, 10), v: 200 }, { timestampMs: 0 });
  interpolator.pushState({ ...createServerSnapshot(1, 100, 10), v: 0 }, { timestampMs: 100 });
  assert.equal(interpolator.getInterpolatedPositions(extractPositions, { nowMs: 50 }).x, 10);
});

test("duplicates and reset leave playback and diagnostics usable", () => {
  const interpolator = createInterpolator({ adaptive: false, interpDelayMs: 0 });
  interpolator.pushState(createServerSnapshot(1, 0, 0), { timestampMs: 0 });
  interpolator.pushState(createServerSnapshot(1, 10, 500), { timestampMs: 10 });
  assert.equal(interpolator.getLatestState().x, 0);
  interpolator.getInterpolatedPositions(extractPositions, { nowMs: 50 });
  assert.ok(interpolator.getNetworkStats().underrunCount >= 1);
  interpolator.reset();
  interpolator.pushState(createServerSnapshot(1, 0, 10), { timestampMs: 100 });
  assert.equal(interpolator.getInterpolatedPositions(extractPositions, { nowMs: 100 }).x, 10);
  assert.equal(interpolator.getNetworkStats().underrunCount, 0);
});

test("150 ms delivery burst keeps playback monotonic and extrapolation bounded", () => {
  const interpolator = createInterpolator({
    adaptive: true,
    interpDelayMs: 35,
    extractVelocities: () => ({ x: 1000 }),
  });
  let lastPlaybackTimeMs = -Infinity;
  let lastPositionX = -Infinity;
  for (let nowMs = 0; nowMs <= 700; nowMs += 10) {
    if (nowMs <= 200 || nowMs >= 350) {
      if (nowMs === 350) {
        for (let sentAtMs = 210; sentAtMs <= 350; sentAtMs += 10) {
          interpolator.pushState(createServerSnapshot(sentAtMs, sentAtMs), { timestampMs: nowMs });
        }
      } else {
        interpolator.pushState(createServerSnapshot(nowMs, nowMs), { timestampMs: nowMs });
      }
    }
    const x = interpolator.getInterpolatedPositions(extractPositions, { nowMs }).x;
    const networkStats = interpolator.getNetworkStats();
    assert.ok(networkStats.playbackTimeMs >= lastPlaybackTimeMs, `timeline reversed at ${nowMs}`);
    assert.ok(x >= lastPositionX, `position reversed at ${nowMs}`);
    assert.ok(x <= (nowMs > 200 && nowMs < 350 ? 200 : nowMs) + 80, `unbounded extrapolation at ${nowMs}`);
    lastPlaybackTimeMs = networkStats.playbackTimeMs;
    lastPositionX = x;
  }
  assert.ok(interpolator.getNetworkStats().underrunCount > 0);
});

test("reducing extrapolation cannot rewind playback", () => {
  const interpolator = createInterpolator({ adaptive: false, interpDelayMs: 0 });
  interpolator.pushState(createServerSnapshot(1, 0), { timestampMs: 0 });
  interpolator.getInterpolatedPositions(extractPositions, { nowMs: 50, extrapolateMs: 80 });
  const previousPlaybackTimeMs = interpolator.getNetworkStats().playbackTimeMs;
  interpolator.getInterpolatedPositions(extractPositions, { nowMs: 60, extrapolateMs: 0 });
  assert.ok(interpolator.getNetworkStats().playbackTimeMs >= previousPlaybackTimeMs);
});

test("wrapper retains the latest accepted state on duplicate sequence", async () => {
  const { createWorkerInterpolator } = await import("../public/platform/frontend-engine/interpolationWorker.js");
  const interpolator = createWorkerInterpolator({ extractPositions, adaptive: false });
  interpolator.pushState(createServerSnapshot(1, 0, 1), { timestampMs: 0 });
  interpolator.pushState(createServerSnapshot(1, 1, 2), { timestampMs: 1 });
  assert.equal(interpolator.getLatestState().x, 1);
});

test("playback tracks authoritative clock drift without exhausting the buffer", () => {
  const interpolator = createInterpolator({ adaptive: false, interpDelayMs: 50 });
  for (let nowMs = 0; nowMs <= 20000; nowMs += 20) {
    interpolator.pushState(createServerSnapshot(nowMs, nowMs * 0.99), { timestampMs: nowMs });
    interpolator.getInterpolatedPositions(extractPositions, { nowMs });
  }
  const networkStats = interpolator.getNetworkStats();
  assert.ok(networkStats.bufferOccupancyMs > 25 && networkStats.bufferOccupancyMs < 75, `occupancy ${networkStats.bufferOccupancyMs}`);
  assert.ok(networkStats.effectiveDelayMs > 25 && networkStats.effectiveDelayMs < 75, `display delay ${networkStats.effectiveDelayMs}`);
});

test("default buffer retains enough history for a 150 ms delay", () => {
  const interpolator = createInterpolator({ adaptive: false, interpDelayMs: 150 });
  for (let sampleIndex = 0; sampleIndex <= 20; sampleIndex++) {
    interpolator.pushState(createServerSnapshot(sampleIndex, sampleIndex * 10), { timestampMs: sampleIndex * 10 });
  }
  assert.equal(interpolator.getInterpolatedPositions(extractPositions, { nowMs: 200 }).x, 50);
});

test("stable low-latency delivery keeps adaptive delay modest", () => {
  const interpolator = createInterpolator({ connectionProvider: () => ({}) });
  for (let sampleIndex = 0; sampleIndex < 100; sampleIndex++) {
    interpolator.pushState(createServerSnapshot(sampleIndex, sampleIndex * 1000 / 60), { timestampMs: sampleIndex * 1000 / 60 });
    interpolator.getInterpolatedPositions(extractPositions, { nowMs: sampleIndex * 1000 / 60 });
  }
  assert.ok(interpolator.getNetworkStats().interpDelayMs <= 50);
});
