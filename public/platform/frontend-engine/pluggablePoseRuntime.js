import { createModularRuntime } from "./modularRuntime.js";

const DEFAULT_TARGET_RENDER_FPS = 60;

/**
 * @template {string} PoseKey
 * @template {object} SharedState
 * @typedef {object} PoseRuntimeConfig
 * @property {number} [fixedDtSec=1/120]
 * @property {number} [maxFrameSec=0.08]
 * @property {number} [maxFixedSteps=10]
 * @property {number | null} [targetRenderFps=60] Null renders every frame.
 * @property {SharedState} [shared] Mutable state shared by all callbacks.
 * @property {() => number} [nowFn] Clock returning milliseconds.
 * @property {(context: import("./modularRuntime.js").RuntimeContext<SharedState>) => (Record<PoseKey, number> | null | undefined)} samplePose
 * @property {(pose: Record<PoseKey, number>, context: import("./modularRuntime.js").RuntimeContext<SharedState>) => void} applyPose
 * @property {(context: import("./modularRuntime.js").RuntimeContext<SharedState>) => boolean} [shouldSample]
 * @property {(context: import("./modularRuntime.js").RuntimeContext<SharedState>) => void} [onReset]
 * @property {(context: import("./modularRuntime.js").RuntimeContext<SharedState>) => void} [onDispose]
 */

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

/**
 * @template {string} PoseKey
 * @param {Partial<Record<PoseKey, number>>} targetPose Mutated in place.
 * @param {Record<PoseKey, number>} sourcePose
 */
function copyPoseToTarget(targetPose, sourcePose) {
  const keys = Object.keys(sourcePose);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    targetPose[key] = sourcePose[key];
  }
}

/**
 * @template {string} PoseKey
 * @param {Record<PoseKey, number>} renderPose Mutated and returned for reuse.
 * @param {Record<PoseKey, number>} previousPose
 * @param {Record<PoseKey, number>} currentPose
 * @param {PoseKey[]} keys
 * @param {number} alpha
 * @returns {Record<PoseKey, number>}
 */
function interpolatePoseFields(renderPose, previousPose, currentPose, keys, alpha) {
  const t = clampNumber(alpha, 0, 1);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const previousValue = previousPose[key];
    const currentValue = currentPose[key];
    renderPose[key] = previousValue + (currentValue - previousValue) * t;
  }
  return renderPose;
}

/**
 * Sample a game's numeric pose on fixed steps and interpolate it for rendering.
 * Samples are copied into owned buffers. applyPose receives a reused buffer and
 * must copy it before retaining it across frames.
 *
 * @template {string} PoseKey
 * @template {object} SharedState
 * @param {PoseRuntimeConfig<PoseKey, SharedState>} [config]
 * @throws {Error} When sampling or rendering callbacks are missing.
 */
export function createPluggablePoseRuntime(config = {}) {
  const samplePose = typeof config.samplePose === "function" ? config.samplePose : null;
  const applyPose = typeof config.applyPose === "function" ? config.applyPose : null;
  const shouldSample = typeof config.shouldSample === "function" ? config.shouldSample : null;
  const onReset = typeof config.onReset === "function" ? config.onReset : null;
  const onDispose = typeof config.onDispose === "function" ? config.onDispose : null;

  if (!samplePose) {
    throw new Error("createPluggablePoseRuntime requires config.samplePose(ctx).");
  }
  if (!applyPose) {
    throw new Error("createPluggablePoseRuntime requires config.applyPose(pose, ctx).");
  }

  const runtime = createModularRuntime({
    fixedDtSec: config.fixedDtSec ?? 1 / 120,
    maxFrameSec: config.maxFrameSec ?? 0.08,
    maxFixedSteps: config.maxFixedSteps ?? 10,
    targetRenderFps: config.targetRenderFps === undefined
      ? DEFAULT_TARGET_RENDER_FPS
      : config.targetRenderFps,
    shared: config.shared,
    nowFn: config.nowFn,
  });

  let hasPose = false;
  let poseKeys = [];
  let previousPose = {};
  let currentPose = {};
  let renderPose = {};

  function resetPoseBuffer() {
    hasPose = false;
    poseKeys = [];
    previousPose = {};
    currentPose = {};
    renderPose = {};
  }

  /**
   * Copy a sample into the two fixed-step buffers without retaining its object.
   * @param {Record<PoseKey, number> | null | undefined} pose
   * @returns {boolean} Whether a pose sample was accepted.
   */
  function commitPose(pose) {
    if (!pose || typeof pose !== "object" || Array.isArray(pose)) {
      return false;
    }

    if (!hasPose) {
      poseKeys = Object.keys(pose);
      copyPoseToTarget(previousPose, pose);
      copyPoseToTarget(currentPose, pose);
      copyPoseToTarget(renderPose, pose);
      hasPose = true;
      return true;
    }

    const keys = Object.keys(pose);
    if (keys.length !== poseKeys.length) {
      poseKeys = keys;
    }

    for (let i = 0; i < poseKeys.length; i += 1) {
      const key = poseKeys[i];
      previousPose[key] = currentPose[key];
      currentPose[key] = pose[key];
    }
    return true;
  }

  runtime.addSystem({
    name: "pose-buffer",
    onReset(runtimeContext) {
      resetPoseBuffer();
      if (onReset) {
        onReset(runtimeContext);
      }
    },
    onFixedUpdate(runtimeContext) {
      if (shouldSample && !shouldSample(runtimeContext)) {
        return;
      }
      const sampledPose = samplePose(runtimeContext);
      commitPose(sampledPose);
    },
    onLateUpdate(runtimeContext) {
      if (!hasPose) {
        return;
      }
      const renderedPose = interpolatePoseFields(renderPose, previousPose, currentPose, poseKeys, runtimeContext.alpha);
      applyPose(renderedPose, runtimeContext);
    },
    onDispose(runtimeContext) {
      if (onDispose) {
        onDispose(runtimeContext);
      }
    },
  });

  return {
    step(options = {}) {
      return runtime.step(options);
    },
    reset() {
      runtime.reset();
    },
    destroy() {
      runtime.destroy();
      resetPoseBuffer();
    },
    setTargetRenderFps(value) {
      runtime.setTargetRenderFps(value);
    },
    setFixedDtSec(value) {
      runtime.setFixedDtSec(value);
    },
    getStats() {
      return runtime.getStats();
    },
    hasPose() {
      return hasPose;
    },
  };
}
