import { createModularRuntime } from "./modularRuntime.js";

/**
 * Run queued input at a fixed cadence and sample network presentation once per
 * rendered frame. The session interpolates continuous predicted positions;
 * discrete identities bypass a second numeric pose buffer entirely.
 * The caller retains ownership of the session and its resources.
 * @template RenderPose
 * @param {object} options
 * @param {{captureAndPredict:()=>unknown,samplePose:(options:{nowMs:number,deltaSec:number,captureInput:false,interpolationAlpha:number})=>RenderPose|null}} options.session
 * @param {(pose:RenderPose,context:import("./modularRuntime.js").RuntimeContext<object>)=>void} options.applyPose Borrowed presentation values; copy before mutating or retaining mutable SDK buffers.
 * @param {number} options.fixedDtSec Command simulation step in seconds.
 * @param {number|null} [options.targetRenderFps=60]
 * @param {number} [options.maxFrameSec=0.08]
 * @param {number} [options.maxFixedSteps=5]
 * @returns {ReturnType<typeof createModularRuntime>} Scheduling runtime; destroy does not destroy the supplied session.
 * @throws {TypeError} If dependencies or positive finite timing settings are missing/invalid.
 */
export function createNetworkedGameRuntime(options) {
  if (typeof options?.session?.captureAndPredict !== "function" || typeof options.session.samplePose !== "function" || typeof options.applyPose !== "function") {
    throw new TypeError("Networked runtime requires a session and applyPose callback.");
  }
  if (!Number.isFinite(options.fixedDtSec) || options.fixedDtSec <= 0) {
    throw new TypeError("Networked runtime requires positive finite fixedDtSec.");
  }
  const maxFrameSec = options.maxFrameSec ?? 0.08;
  if (!Number.isFinite(maxFrameSec) || maxFrameSec <= 0) {
    throw new TypeError("Networked runtime requires positive finite maxFrameSec.");
  }
  const runtime = createModularRuntime({
    fixedDtSec: options.fixedDtSec,
    targetRenderFps: options.targetRenderFps === undefined ? 60 : options.targetRenderFps,
    maxFrameSec,
    maxFixedSteps: options.maxFixedSteps ?? 5,
  });
  let lastPresentedAtMs = null;
  runtime.addSystem({
    name: "networked-presentation",
    onReset() {
      lastPresentedAtMs = null;
    },
    onFixedUpdate() {
      options.session.captureAndPredict();
    },
    onLateUpdate(runtimeContext) {
      const elapsedSec = lastPresentedAtMs === null ? runtimeContext.frameDtSec
        : (runtimeContext.nowMs - lastPresentedAtMs) / 1000;
      lastPresentedAtMs = runtimeContext.nowMs;
      const pose = options.session.samplePose({
        nowMs: runtimeContext.nowMs,
        deltaSec: Math.max(0, Math.min(maxFrameSec, elapsedSec)),
        captureInput: false,
        interpolationAlpha: runtimeContext.alpha,
      });
      if (pose) options.applyPose(pose, runtimeContext);
    },
  });
  return runtime;
}
