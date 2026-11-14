/** @typedef {import("./snapshotPose.js").SkybreakPresentedJet} SkybreakPresentedJet */
/**
 * @typedef {object} SkybreakGhostRun
 * @property {number} version
 * @property {number} timeSec Run time.
 * @property {number[]} samples Flat [x,y,z,fx,fy,fz,ux,uy,uz] every SAMPLE_SEC.
 */

const STORAGE_KEY = "skybreak:time-trial:best:v1";
const SAMPLE_SEC = 0.1;
const SAMPLE_WIDTH = 9;
const GHOST_VERSION = 1;
const MAX_SAMPLES = 1800;
const POSE_KEYS = Object.freeze(["x", "y", "z", "forwardX", "forwardY", "forwardZ", "upX", "upY", "upZ"]);

/** @returns {SkybreakGhostRun|null} */
function readStoredGhost() {
  try {
    const parsed = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? "null");
    if (parsed?.version !== GHOST_VERSION || !Number.isFinite(parsed.timeSec) || !Array.isArray(parsed.samples)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Record the pilot's run and replay their personal best as a ghost. Stored
 * only in this browser: a per-viewer convenience, never authoritative.
 */
export function createSkybreakGhost() {
  let best = readStoredGhost();
  /** @type {number[]} */
  let recording = [];
  let recordingSerial = -1;
  let nextSampleSec = 0;
  const pose = { x: 0, y: 0, z: 0, forwardX: 0, forwardY: 0, forwardZ: 1, upX: 0, upY: 1, upZ: 0 };

  return {
    getBestSec: () => best?.timeSec ?? 0,
    /**
     * Sample the local jet during an active run; a new run serial restarts recording.
     * @param {Readonly<SkybreakPresentedJet>} jet
     */
    record(jet) {
      if (!jet.runActive) return;
      if (jet.runSerial !== recordingSerial) {
        recordingSerial = jet.runSerial;
        recording = [];
        nextSampleSec = 0;
      }
      while (jet.runTimeSec >= nextSampleSec && recording.length / SAMPLE_WIDTH < MAX_SAMPLES) {
        recording.push(jet.x, jet.y, jet.z, jet.forwardX, jet.forwardY, jet.forwardZ, jet.upX, jet.upY, jet.upZ);
        nextSampleSec += SAMPLE_SEC;
      }
    },
    /**
     * Keep the finished run when it beats the stored best.
     * @param {number} timeSec Authoritative run time.
     * @returns {boolean} True for a new personal best.
     */
    finish(timeSec) {
      if (recording.length === 0 || (best && best.timeSec <= timeSec)) return false;
      best = { version: GHOST_VERSION, timeSec, samples: recording };
      try {
        globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(best));
      } catch {
        // Storage can be full or blocked; the ghost still works this session.
      }
      return true;
    },
    /**
     * Ghost pose at a run time, interpolated between samples; null without a best run.
     * The returned object is reused.
     * @param {number} runTimeSec
     */
    sample(runTimeSec) {
      if (!best) return null;
      const count = best.samples.length / SAMPLE_WIDTH;
      if (count < 2) return null;
      const position = Math.min(count - 1.001, Math.max(0, runTimeSec / SAMPLE_SEC));
      const index = Math.floor(position);
      const amount = position - index;
      const from = index * SAMPLE_WIDTH;
      const to = from + SAMPLE_WIDTH;
      POSE_KEYS.forEach((key, offset) => {
        pose[key] = best.samples[from + offset] + (best.samples[to + offset] - best.samples[from + offset]) * amount;
      });
      return pose;
    },
  };
}
