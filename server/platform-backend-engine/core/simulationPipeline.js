function normalizePriority(value) {
  if (!Number.isFinite(value)) return 0;
  return value;
}

function makeContext({ state, dt, nowMs, shared, runtime }) {
  return {
    state,
    dt,
    nowMs,
    shared,
    runtime,
  };
}

/**
 * Priority-ordered simulation pipeline for authoritative server game logic.
 *
 * @param {Object} [config]
 * @param {Object} [config.shared]
 *   Mutable shared state available to systems as `ctx.shared`.
 * @param {() => number} [config.nowFn]
 *   Optional time provider in milliseconds. Defaults to `Date.now()`.
 *
 * Each system can implement:
 * - shouldRun(ctx): boolean
 * - update(ctx): void
 * - onReset(ctx): void
 */
export function createSimulationPipeline(config = {}) {
  const shared = config.shared && typeof config.shared === "object" ? config.shared : {};
  const nowFn = typeof config.nowFn === "function" ? config.nowFn : () => Date.now();
  const systems = [];

  function sortSystems() {
    systems.sort((a, b) => a.priority - b.priority);
  }

  const runtime = {
    addSystem(system, options = {}) {
      if (!system || typeof system !== "object") return () => {};
      const entry = {
        system,
        priority: normalizePriority(options.priority),
      };
      systems.push(entry);
      sortSystems();
      return () => runtime.removeSystem(system);
    },

    removeSystem(system) {
      const index = systems.findIndex((entry) => entry.system === system);
      if (index >= 0) {
        systems.splice(index, 1);
      }
    },

    step(state, dt, options = {}) {
      const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : nowFn();
      const ctx = makeContext({
        state,
        dt,
        nowMs,
        shared,
        runtime,
      });

      for (let i = 0; i < systems.length; i += 1) {
        const candidate = systems[i].system;
        if (typeof candidate?.update !== "function") continue;
        if (typeof candidate.shouldRun === "function" && !candidate.shouldRun(ctx)) {
          continue;
        }
        candidate.update(ctx);
      }
      return ctx;
    },

    reset(state, options = {}) {
      const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : nowFn();
      const ctx = makeContext({
        state,
        dt: 0,
        nowMs,
        shared,
        runtime,
      });
      for (let i = 0; i < systems.length; i += 1) {
        const candidate = systems[i].system;
        if (typeof candidate?.onReset === "function") {
          candidate.onReset(ctx);
        }
      }
      return ctx;
    },

    listSystems() {
      return systems.map((entry) => ({
        priority: entry.priority,
        name: entry.system?.name || null,
      }));
    },
  };

  return runtime;
}
