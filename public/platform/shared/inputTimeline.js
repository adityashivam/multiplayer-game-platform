function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function copyFrame(frame) {
  return {
    seq: frame.seq,
    dtSec: frame.dtSec,
    input: frame.input,
    sentAtMs: frame.sentAtMs,
  };
}

/**
 * Generic client input stream with seq tracking + pending queue for
 * server-ack rollback/replay reconciliation.
 */
export function createInputTimeline(config = {}) {
  const hz = Number.isFinite(config.hz) && config.hz > 0 ? config.hz : 60;
  const intervalMs = 1000 / hz;
  const maxPendingFrames =
    Number.isFinite(config.maxPendingFrames) && config.maxPendingFrames > 0
      ? Math.floor(config.maxPendingFrames)
      : 240;
  const minDtSec = Number.isFinite(config.minDtSec) ? Math.max(0.001, config.minDtSec) : 1 / 120;
  const maxDtSec = Number.isFinite(config.maxDtSec) ? Math.max(minDtSec, config.maxDtSec) : 1 / 15;
  const captureInput = typeof config.captureInput === "function" ? config.captureInput : () => ({});
  const sendFrame = typeof config.sendFrame === "function" ? config.sendFrame : () => {};
  const nowFn = typeof config.nowFn === "function" ? config.nowFn : () => performance.now();

  let running = false;
  let timerId = null;
  let nextSeq = 0;
  let lastSampleMs = null;
  const pendingFrames = [];

  function resetClock() {
    lastSampleMs = null;
  }

  function enqueueFrame() {
    const nowMs = nowFn();
    let dtSec = 1 / hz;
    if (Number.isFinite(lastSampleMs)) {
      dtSec = clampNumber((nowMs - lastSampleMs) / 1000, minDtSec, maxDtSec);
    }
    lastSampleMs = nowMs;

    const frame = {
      seq: ++nextSeq,
      dtSec,
      input: captureInput(),
      sentAtMs: nowMs,
    };

    pendingFrames.push(frame);
    if (pendingFrames.length > maxPendingFrames) {
      pendingFrames.splice(0, pendingFrames.length - maxPendingFrames);
    }

    sendFrame(copyFrame(frame));
    return frame;
  }

  function start() {
    if (running) return;
    running = true;
    resetClock();
    timerId = setInterval(() => {
      enqueueFrame();
    }, intervalMs);
  }

  function stop() {
    running = false;
    if (timerId != null) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  function reset() {
    pendingFrames.length = 0;
    nextSeq = 0;
    resetClock();
  }

  function acknowledge(seq) {
    if (!Number.isFinite(seq)) return;
    while (pendingFrames.length > 0 && pendingFrames[0].seq <= seq) {
      pendingFrames.shift();
    }
  }

  function getPendingFrames() {
    return pendingFrames;
  }

  function getPendingFrameCopies() {
    return pendingFrames.map(copyFrame);
  }

  function getLastSeq() {
    return nextSeq;
  }

  function sendNow() {
    return enqueueFrame();
  }

  return {
    start,
    stop,
    reset,
    acknowledge,
    getPendingFrames,
    getPendingFrameCopies,
    getLastSeq,
    sendNow,
    isRunning: () => running,
  };
}
