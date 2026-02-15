const DEFAULT_FIXED_DT_SEC = 1 / 120;
const DEFAULT_MAX_FRAME_SEC = 0.1;
const DEFAULT_MAX_FIXED_STEPS = 8;

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizePositiveNumber(value, fallback) {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

function normalizeTargetFps(value) {
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}

function makeContext({
  nowMs,
  frameDtSec,
  fixedDtSec,
  fixedSteps,
  alpha,
  rendered,
  droppedFixedSteps,
  shared,
  runtime,
  stepIndex,
}) {
  return {
    nowMs,
    frameDtSec,
    fixedDtSec,
    fixedSteps,
    alpha,
    rendered,
    droppedFixedSteps,
    shared,
    runtime,
    stepIndex,
  };
}

/**
 * Unity-style runtime loop with plugin systems.
 *
 * @param {Object} config
 * @param {number} [config.fixedDtSec=1/120]
 *   Fixed simulation step in seconds for `onFixedUpdate`.
 * @param {number} [config.maxFrameSec=0.1]
 *   Clamp for measured frame delta to absorb tab-resume hitches.
 * @param {number} [config.maxFixedSteps=8]
 *   Max fixed steps consumed in one render frame before dropping overflow.
 * @param {number|null} [config.targetRenderFps]
 *   Render cap. Use `null` to allow rendering every frame.
 * @param {Object} [config.shared]
 *   Shared mutable state passed to all system hooks as `ctx.shared`.
 * @param {() => number} [config.nowFn]
 *   Custom clock in milliseconds. Defaults to `performance.now()`.
 *
 * System hooks are optional:
 * - onInit(ctx)
 * - onUpdate(ctx)
 * - onFixedUpdate(ctx)
 * - onLateUpdate(ctx)
 * - onReset(ctx)
 * - onDispose(ctx)
 */
export function createModularRuntime(config = {}) {
  let fixedDtSec = normalizePositiveNumber(config.fixedDtSec, DEFAULT_FIXED_DT_SEC);
  const maxFrameSec = normalizePositiveNumber(config.maxFrameSec, DEFAULT_MAX_FRAME_SEC);
  const maxFixedSteps = Math.max(
    1,
    Math.floor(normalizePositiveNumber(config.maxFixedSteps, DEFAULT_MAX_FIXED_STEPS)),
  );
  let targetRenderFps = normalizeTargetFps(config.targetRenderFps);

  const shared = config.shared && typeof config.shared === "object" ? config.shared : {};
  const nowFn = typeof config.nowFn === "function" ? config.nowFn : () => performance.now();

  const systems = [];
  let lastNowMs = null;
  let accumulatorSec = 0;
  let renderAccumulatorSec = 0;
  let droppedFixedSteps = 0;
  let disposed = false;

  const emptyStepResult = {
    frameDtSec: 0,
    fixedSteps: 0,
    alpha: 0,
    rendered: false,
    droppedFixedSteps: 0,
  };

  function callHook(hookName, context) {
    for (let i = 0; i < systems.length; i += 1) {
      const hook = systems[i].system?.[hookName];
      if (typeof hook === "function") {
        hook(context);
      }
    }
  }

  function sortSystems() {
    systems.sort((a, b) => a.priority - b.priority);
  }

  const runtime = {
    addSystem(system, options = {}) {
      if (!system || typeof system !== "object") {
        return () => {};
      }

      const priority = Number.isFinite(options.priority) ? options.priority : 0;
      const entry = { system, priority };
      systems.push(entry);
      sortSystems();

      const initContext = makeContext({
        nowMs: lastNowMs,
        frameDtSec: 0,
        fixedDtSec,
        fixedSteps: 0,
        alpha: fixedDtSec > 0 ? clampNumber(accumulatorSec / fixedDtSec, 0, 1) : 0,
        rendered: false,
        droppedFixedSteps,
        shared,
        runtime,
        stepIndex: 0,
      });
      if (typeof system.onInit === "function") {
        system.onInit(initContext);
      }

      return () => runtime.removeSystem(system);
    },

    removeSystem(system) {
      const idx = systems.findIndex((entry) => entry.system === system);
      if (idx === -1) return;
      const [entry] = systems.splice(idx, 1);
      const context = makeContext({
        nowMs: lastNowMs,
        frameDtSec: 0,
        fixedDtSec,
        fixedSteps: 0,
        alpha: 0,
        rendered: false,
        droppedFixedSteps,
        shared,
        runtime,
        stepIndex: 0,
      });
      if (typeof entry.system?.onDispose === "function") {
        entry.system.onDispose(context);
      }
    },

    setTargetRenderFps(value) {
      targetRenderFps = normalizeTargetFps(value);
    },

    setFixedDtSec(value) {
      fixedDtSec = normalizePositiveNumber(value, fixedDtSec);
    },

    reset() {
      accumulatorSec = 0;
      renderAccumulatorSec = 0;
      lastNowMs = null;
      droppedFixedSteps = 0;

      const context = makeContext({
        nowMs: null,
        frameDtSec: 0,
        fixedDtSec,
        fixedSteps: 0,
        alpha: 0,
        rendered: false,
        droppedFixedSteps,
        shared,
        runtime,
        stepIndex: 0,
      });
      callHook("onReset", context);
    },

    step(options = {}) {
      if (disposed) {
        return emptyStepResult;
      }

      const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : nowFn();
      let frameDtSec = 0;
      if (lastNowMs != null) {
        frameDtSec = clampNumber((nowMs - lastNowMs) / 1000, 0, maxFrameSec);
      }
      lastNowMs = nowMs;

      if (frameDtSec === 0) {
        return {
          frameDtSec: 0,
          fixedSteps: 0,
          alpha: fixedDtSec > 0 ? clampNumber(accumulatorSec / fixedDtSec, 0, 1) : 0,
          rendered: false,
          droppedFixedSteps,
        };
      }

      accumulatorSec += frameDtSec;
      renderAccumulatorSec += frameDtSec;

      callHook(
        "onUpdate",
        makeContext({
          nowMs,
          frameDtSec,
          fixedDtSec,
          fixedSteps: 0,
          alpha: fixedDtSec > 0 ? clampNumber(accumulatorSec / fixedDtSec, 0, 1) : 0,
          rendered: false,
          droppedFixedSteps,
          shared,
          runtime,
          stepIndex: 0,
        }),
      );

      let fixedSteps = 0;
      while (accumulatorSec >= fixedDtSec && fixedSteps < maxFixedSteps) {
        fixedSteps += 1;
        accumulatorSec -= fixedDtSec;

        callHook(
          "onFixedUpdate",
          makeContext({
            nowMs,
            frameDtSec,
            fixedDtSec,
            fixedSteps,
            alpha: fixedDtSec > 0 ? clampNumber(accumulatorSec / fixedDtSec, 0, 1) : 0,
            rendered: false,
            droppedFixedSteps,
            shared,
            runtime,
            stepIndex: fixedSteps,
          }),
        );
      }

      if (accumulatorSec >= fixedDtSec) {
        const dropped = Math.floor(accumulatorSec / fixedDtSec);
        droppedFixedSteps += dropped;
        accumulatorSec = accumulatorSec % fixedDtSec;
      }

      const frameTargetFps =
        options.targetRenderFps === undefined
          ? targetRenderFps
          : normalizeTargetFps(options.targetRenderFps);
      const minRenderIntervalSec = frameTargetFps ? 1 / frameTargetFps : 0;

      let rendered = true;
      if (minRenderIntervalSec > 0 && !options.forceRender) {
        rendered = renderAccumulatorSec >= minRenderIntervalSec - 0.000001;
      }

      const alpha = fixedDtSec > 0 ? clampNumber(accumulatorSec / fixedDtSec, 0, 1) : 0;

      if (rendered) {
        renderAccumulatorSec = 0;
        callHook(
          "onLateUpdate",
          makeContext({
            nowMs,
            frameDtSec,
            fixedDtSec,
            fixedSteps,
            alpha,
            rendered: true,
            droppedFixedSteps,
            shared,
            runtime,
            stepIndex: 0,
          }),
        );
      }

      return {
        frameDtSec,
        fixedSteps,
        alpha,
        rendered,
        droppedFixedSteps,
      };
    },

    getStats() {
      return {
        fixedDtSec,
        targetRenderFps,
        maxFixedSteps,
        droppedFixedSteps,
      };
    },

    destroy() {
      if (disposed) return;
      disposed = true;

      const context = makeContext({
        nowMs: lastNowMs,
        frameDtSec: 0,
        fixedDtSec,
        fixedSteps: 0,
        alpha: 0,
        rendered: false,
        droppedFixedSteps,
        shared,
        runtime,
        stepIndex: 0,
      });
      callHook("onDispose", context);
      systems.length = 0;
    },
  };

  return runtime;
}
