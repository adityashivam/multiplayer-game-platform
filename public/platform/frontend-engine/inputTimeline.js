import { INPUT_LIMITS, NETWORK_TIMING } from "../shared/networkProtocol.js";

const DEFAULT_MIN_INPUT_DT_SEC = 1 / 120;
const DEFAULT_MAX_INPUT_DT_SEC = 1 / 15;
const MIN_INPUT_DT_SEC = 0.001;
const MAX_TIMER_DRIFT_INTERVALS = 4;

/**
 * @template InputState
 * @typedef {object} InputCommandFrame
 * @property {number} seq Monotonic command sequence within one input session.
 * @property {number} dtSec Command duration in seconds.
 * @property {InputState} input Captured game input, retained by reference.
 * @property {number} [sentAtMs] Client sampling time in milliseconds.
 */

/**
 * @template InputState
 * @typedef {object} InputTimelineConfig
 * @property {number} [hz=60]
 * @property {number} [fixedDtSec] Use this duration instead of elapsed sample time.
 * @property {number} [maxPendingFrames=240]
 * @property {number} [minDtSec=1/120]
 * @property {number} [maxDtSec=1/15]
 * @property {() => InputState} [captureInput]
 * @property {(inputFrame: InputCommandFrame<InputState>) => void} [sendFrame]
 * @property {() => number} [nowFn] Clock returning milliseconds.
 */

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * Preserve action edges between captures without latching movement. The input
 * template is copied; capture returns a new object and consumes pending edges.
 *
 * @template {string} InputKey
 * @param {Record<InputKey, boolean>} inputTemplate Supported game input keys.
 * @param {{ edgeKeys?: InputKey[] }} [options]
 */
export function createInputLatch(inputTemplate, { edgeKeys = [] } = {}) {
  const heldInput = { ...inputTemplate };
  const actionEdgeKeys = new Set(edgeKeys);
  const pendingActionEdges = new Set();

  return {
    /**
     * @param {keyof typeof heldInput} inputKey
     * @param {boolean} active
     */
    set(inputKey, active) {
      if (!Object.hasOwn(heldInput, inputKey)) {
        return;
      }

      if (active && !heldInput[inputKey] && actionEdgeKeys.has(inputKey)) {
        pendingActionEdges.add(inputKey);
      }
      heldInput[inputKey] = Boolean(active);
    },
    /** @returns {Record<InputKey, boolean>} */
    capture() {
      const capturedInput = { ...heldInput };
      for (const inputKey of pendingActionEdges) {
        capturedInput[inputKey] = true;
      }
      pendingActionEdges.clear();
      return capturedInput;
    },
    reset() {
      for (const inputKey of Object.keys(heldInput)) {
        heldInput[inputKey] = false;
      }
      pendingActionEdges.clear();
    },
  };
}

/**
 * Copy frame metadata while retaining the captured input reference.
 * @template InputState
 * @param {InputCommandFrame<InputState>} inputFrame
 * @returns {InputCommandFrame<InputState>}
 */
function copyInputFrame(inputFrame) {
  return {
    seq: inputFrame.seq,
    dtSec: inputFrame.dtSec,
    input: inputFrame.input,
    sentAtMs: inputFrame.sentAtMs,
  };
}

/**
 * Track command sequences and a bounded pending queue for acknowledgement and
 * replay. Sending copies frame metadata; the timeline retains each input object.
 * @template InputState
 * @param {InputTimelineConfig<InputState>} [config]
 */
export function createInputTimeline(config = {}) {
  const inputHz = Number.isFinite(config.hz) && config.hz > 0
    ? config.hz
    : NETWORK_TIMING.SIMULATION_HZ;
  const intervalMs = 1000 / inputHz;
  const fixedDtSec = Number.isFinite(config.fixedDtSec) && config.fixedDtSec > 0
    ? config.fixedDtSec
    : null;
  const maxPendingFrames =
    Number.isFinite(config.maxPendingFrames) && config.maxPendingFrames > 0
      ? Math.floor(config.maxPendingFrames)
      : INPUT_LIMITS.MAX_PENDING_FRAMES;
  const minDtSec = Number.isFinite(config.minDtSec)
    ? Math.max(MIN_INPUT_DT_SEC, config.minDtSec)
    : DEFAULT_MIN_INPUT_DT_SEC;
  const maxDtSec = Number.isFinite(config.maxDtSec)
    ? Math.max(minDtSec, config.maxDtSec)
    : DEFAULT_MAX_INPUT_DT_SEC;
  const captureInput = typeof config.captureInput === "function" ? config.captureInput : () => ({});
  const sendFrame = typeof config.sendFrame === "function" ? config.sendFrame : () => {};
  const nowFn = typeof config.nowFn === "function" ? config.nowFn : () => performance.now();

  let running = false;
  let timerId = null;
  let expectedNextMs = null;
  let nextSequence = 0;
  let lastSampleMs = null;
  /** @type {InputCommandFrame<InputState>[]} */
  const pendingFrames = [];

  function resetSampleClock() {
    lastSampleMs = null;
  }

  /** Capture, retain, and send one command in that order. */
  function enqueueInputFrame() {
    const nowMs = nowFn();
    let dtSec = 1 / inputHz;
    if (fixedDtSec != null) {
      dtSec = fixedDtSec;
    } else if (Number.isFinite(lastSampleMs)) {
      dtSec = clampNumber((nowMs - lastSampleMs) / 1000, minDtSec, maxDtSec);
    }
    lastSampleMs = nowMs;

    const inputFrame = {
      seq: ++nextSequence,
      dtSec,
      input: captureInput(),
      sentAtMs: nowMs,
    };

    pendingFrames.push(inputFrame);
    if (pendingFrames.length > maxPendingFrames) {
      pendingFrames.splice(0, pendingFrames.length - maxPendingFrames);
    }

    sendFrame(copyInputFrame(inputFrame));
    return inputFrame;
  }

  /** Start timer sampling; repeated starts leave the current timer intact. */
  function start() {
    if (running) {
      return;
    }

    running = true;
    resetSampleClock();
    expectedNextMs = nowFn() + intervalMs;
    timerId = setTimeout(function sampleNextInputFrame() {
      if (!running) {
        return;
      }

      enqueueInputFrame();
      expectedNextMs += intervalMs;
      const nowMs = nowFn();
      const driftMs = nowMs - expectedNextMs;
      if (driftMs > intervalMs * MAX_TIMER_DRIFT_INTERVALS) {
        expectedNextMs = nowMs + intervalMs;
      }
      const delayMs = Math.max(0, expectedNextMs - nowMs);
      timerId = setTimeout(sampleNextInputFrame, delayMs);
    }, intervalMs);
  }

  function stop() {
    running = false;
    if (timerId != null) {
      clearTimeout(timerId);
      timerId = null;
    }
    expectedNextMs = null;
  }

  /** Clear pending history and restart sequences without stopping sampling. */
  function reset() {
    pendingFrames.length = 0;
    nextSequence = 0;
    resetSampleClock();
  }

  /** @param {number} acknowledgedSequence Remove commands through this sequence. */
  function acknowledge(acknowledgedSequence) {
    if (!Number.isFinite(acknowledgedSequence)) {
      return;
    }
    while (pendingFrames.length > 0 && pendingFrames[0].seq <= acknowledgedSequence) {
      pendingFrames.shift();
    }
  }

  /** Return the owned queue; consumers must not mutate it or its frames. */
  function getPendingFrames() {
    return pendingFrames;
  }

  /** Copy frame metadata while sharing each captured input object. */
  function getPendingFrameCopies() {
    return pendingFrames.map(copyInputFrame);
  }

  function getLastSeq() {
    return nextSequence;
  }

  function sendNow() {
    return enqueueInputFrame();
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
