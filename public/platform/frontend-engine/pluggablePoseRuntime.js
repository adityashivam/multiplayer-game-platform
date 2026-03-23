import { createModularRuntime } from "./modularRuntime.js";

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function copyPoseToTarget(target, source) {
  const keys = Object.keys(source);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    target[key] = source[key];
  }
}

function lerpPose(outPose, prevPose, currPose, keys, alpha) {
  const t = clampNumber(alpha, 0, 1);
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    const prev = prevPose[key];
    const curr = currPose[key];
    outPose[key] = prev + (curr - prev) * t;
  }
  return outPose;
}

/**
 * Generic fixed-step + interpolated pose runtime for any game genre.
 *
 * @param {Object} config
 * @param {number} [config.fixedDtSec=1/120]
 *   Fixed simulation step (seconds). Lower values = finer simulation,
 *   higher CPU cost. Typical range: 1/60 to 1/144.
 * @param {number} [config.maxFrameSec=0.08]
 *   Frame delta clamp used when tab resumes or frame stalls. Prevents
 *   huge simulation jumps after hitches.
 * @param {number} [config.maxFixedSteps=10]
 *   Max fixed updates per render frame. Prevents spiral-of-death under load
 *   by dropping overflow simulation work.
 * @param {number|null} [config.targetRenderFps=60]
 *   Render cap used by the internal runtime. Set `null` to render every frame.
 * @param {Object} [config.shared]
 *   Mutable shared context object available in every callback as `ctx.shared`.
 * @param {() => number} [config.nowFn]
 *   Time provider returning milliseconds. Defaults to `performance.now()`.
 * @param {(ctx: Object) => (Record<string, number> | null | undefined)} config.samplePose
 *   Required. Called on each fixed step. Return numeric pose fields that should
 *   be interpolated to render smoothly (for example `{ x, y, rot }`).
 * @param {(pose: Record<string, number>, ctx: Object) => void} config.applyPose
 *   Required. Called on render steps with the interpolated pose.
 * @param {(ctx: Object) => boolean} [config.shouldSample]
 *   Optional gate to skip sampling for a fixed step (for example when paused).
 * @param {(ctx: Object) => void} [config.onReset]
 *   Optional callback when runtime is reset.
 * @param {(ctx: Object) => void} [config.onDispose]
 *   Optional callback when runtime is destroyed.
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
    targetRenderFps: config.targetRenderFps ?? 60,
    shared: config.shared,
    nowFn: config.nowFn,
  });

  let hasPose = false;
  let poseKeys = [];
  let prevPose = {};
  let currPose = {};
  let outPose = {};

  function resetPoseBuffer() {
    hasPose = false;
    poseKeys = [];
    prevPose = {};
    currPose = {};
    outPose = {};
  }

  function commitPose(pose) {
    if (!pose || typeof pose !== "object" || Array.isArray(pose)) return false;

    if (!hasPose) {
      poseKeys = Object.keys(pose);
      copyPoseToTarget(prevPose, pose);
      copyPoseToTarget(currPose, pose);
      copyPoseToTarget(outPose, pose);
      hasPose = true;
      return true;
    }

    const keys = Object.keys(pose);
    if (keys.length !== poseKeys.length) {
      poseKeys = keys;
    }

    for (let i = 0; i < poseKeys.length; i += 1) {
      const key = poseKeys[i];
      prevPose[key] = currPose[key];
      currPose[key] = pose[key];
    }
    return true;
  }

  runtime.addSystem({
    name: "pose-buffer",
    onReset(ctx) {
      resetPoseBuffer();
      if (onReset) onReset(ctx);
    },
    onFixedUpdate(ctx) {
      if (shouldSample && !shouldSample(ctx)) return;
      const sampledPose = samplePose(ctx);
      commitPose(sampledPose);
    },
    onLateUpdate(ctx) {
      if (!hasPose) return;
      const renderedPose = lerpPose(outPose, prevPose, currPose, poseKeys, ctx.alpha);
      applyPose(renderedPose, ctx);
    },
    onDispose(ctx) {
      if (onDispose) onDispose(ctx);
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
