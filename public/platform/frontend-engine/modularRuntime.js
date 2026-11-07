const DEFAULT_FIXED_DT_SEC = 1 / 120;
const DEFAULT_MAX_FRAME_SEC = 0.1;
const DEFAULT_MAX_FIXED_STEPS = 8;
const RENDER_INTERVAL_EPSILON_SEC = 0.000001;

/**
 * @typedef {object} RuntimeStepOptions
 * @property {number} [nowMs]
 * @property {number | null} [targetRenderFps] Override the cap for this step.
 * @property {boolean} [forceRender]
 */

/**
 * @typedef {object} RuntimeStepResult
 * @property {number} frameDtSec
 * @property {number} fixedSteps
 * @property {number} alpha
 * @property {boolean} rendered
 * @property {number} droppedFixedSteps Cumulative discarded simulation work.
 */

/**
 * @typedef {object} RuntimeStats
 * @property {number} fixedDtSec
 * @property {number | null} targetRenderFps
 * @property {number} maxFixedSteps
 * @property {number} droppedFixedSteps
 */

/**
 * @template {object} SharedState
 * @typedef {object} RuntimeContext
 * @property {number | null} nowMs
 * @property {number} frameDtSec
 * @property {number} fixedDtSec
 * @property {number} fixedSteps
 * @property {number} alpha
 * @property {boolean} rendered
 * @property {number} droppedFixedSteps
 * @property {SharedState} shared Shared mutable state, owned by the caller.
 * @property {RuntimeController<SharedState>} runtime
 * @property {number} stepIndex Fixed-step index within this frame, otherwise zero.
 */

/**
 * @typedef {"onInit" | "onUpdate" | "onFixedUpdate" | "onLateUpdate" | "onReset" | "onDispose"} RuntimeHookName
 */

/**
 * @template {object} SharedState
 * @typedef {object} RuntimeSystem
 * @property {string} [name]
 * @property {(context: RuntimeContext<SharedState>) => void} [onInit]
 * @property {(context: RuntimeContext<SharedState>) => void} [onUpdate]
 * @property {(context: RuntimeContext<SharedState>) => void} [onFixedUpdate]
 * @property {(context: RuntimeContext<SharedState>) => void} [onLateUpdate]
 * @property {(context: RuntimeContext<SharedState>) => void} [onReset]
 * @property {(context: RuntimeContext<SharedState>) => void} [onDispose]
 */

/**
 * @template {object} SharedState
 * @typedef {object} RuntimeConfig
 * @property {number} [fixedDtSec=1/120] Fixed simulation step in seconds.
 * @property {number} [maxFrameSec=0.1] Elapsed-time clamp after a stall.
 * @property {number} [maxFixedSteps=8] Bound on catch-up work per frame.
 * @property {number | null} [targetRenderFps] Null allows rendering every frame.
 * @property {SharedState} [shared]
 * @property {() => number} [nowFn] Clock returning milliseconds.
 */

/**
 * @template {object} SharedState
 * @typedef {object} RuntimeController
 * @property {(system: RuntimeSystem<SharedState>, options?: { priority?: number }) => (() => void)} addSystem
 * @property {(system: RuntimeSystem<SharedState>) => void} removeSystem
 * @property {(value: number | null) => void} setTargetRenderFps
 * @property {(value: number) => void} setFixedDtSec
 * @property {() => void} reset
 * @property {(options?: RuntimeStepOptions) => RuntimeStepResult} step
 * @property {() => RuntimeStats} getStats
 * @property {() => void} destroy
 */

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

/**
 * @template {object} SharedState
 * @param {RuntimeContext<SharedState>} contextFields
 * @returns {RuntimeContext<SharedState>}
 */
function createRuntimeContext({
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
 * Run plugin hooks in priority order: update, bounded fixed updates, then render.
 * Hook contexts are fresh objects sharing the caller's mutable shared state.
 *
 * @template {object} SharedState
 * @param {RuntimeConfig<SharedState>} [config]
 * @returns {RuntimeController<SharedState>}
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

  /** @type {{ system: RuntimeSystem<SharedState>, priority: number }[]} */
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

  /**
   * @param {RuntimeHookName} hookName
   * @param {RuntimeContext<SharedState>} context
   */
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

  /** @type {RuntimeController<SharedState>} */
  const runtime = {
    addSystem(system, options = {}) {
      if (!system || typeof system !== "object") {
        return () => {};
      }

      const priority = Number.isFinite(options.priority) ? options.priority : 0;
      const entry = { system, priority };
      systems.push(entry);
      sortSystems();

      const initContext = createRuntimeContext({
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
      const context = createRuntimeContext({
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

      const context = createRuntimeContext({
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
        createRuntimeContext({
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
          createRuntimeContext({
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
        rendered = renderAccumulatorSec >= minRenderIntervalSec - RENDER_INTERVAL_EPSILON_SEC;
      }

      const alpha = fixedDtSec > 0 ? clampNumber(accumulatorSec / fixedDtSec, 0, 1) : 0;

      if (rendered) {
        // Retain fractional frame time while bounding a stalled renderer's debt.
        if (minRenderIntervalSec > 0 && !options.forceRender) {
          renderAccumulatorSec = Math.min(
            minRenderIntervalSec,
            Math.max(0, renderAccumulatorSec - minRenderIntervalSec),
          );
        } else {
          renderAccumulatorSec = 0;
        }
        callHook(
          "onLateUpdate",
          createRuntimeContext({
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

      const context = createRuntimeContext({
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
