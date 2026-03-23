import { registerGame } from "./registerGame.js";
import { createSimulationPipeline } from "./simulationPipeline.js";

function normalizeSystems(systems) {
  if (!Array.isArray(systems)) return [];
  return systems.filter(
    (entry) =>
      entry &&
      typeof entry === "object" &&
      entry.system &&
      typeof entry.system === "object",
  );
}

/**
 * Build a pluggable authoritative simulation pipeline.
 *
 * @param {Object} config
 * @param {Array<{priority?: number, system: Object}>} [config.systems]
 *   Ordered systems list. Each `system` can implement `update(ctx)`,
 *   `shouldRun(ctx)`, and `onReset(ctx)`.
 * @param {(args: {state: Object, dt: number, options: Object}) => boolean} [config.shouldStep]
 *   Optional global guard called before each pipeline step. Return `false`
 *   to skip simulation for that tick.
 * @param {Object} [config.shared]
 *   Mutable shared context object passed to every system as `ctx.shared`.
 * @param {() => number} [config.nowFn]
 *   Optional time provider. Defaults to `Date.now()`.
 */
export function createPluggableSimulation(config = {}) {
  const pipeline = createSimulationPipeline({
    shared: config.shared,
    nowFn: config.nowFn,
  });
  const shouldStep = typeof config.shouldStep === "function" ? config.shouldStep : null;

  const systems = normalizeSystems(config.systems);
  for (let i = 0; i < systems.length; i += 1) {
    const { system, priority } = systems[i];
    pipeline.addSystem(system, { priority });
  }

  return {
    pipeline,
    step(state, dt, options = {}) {
      if (shouldStep && !shouldStep({ state, dt, options })) {
        return null;
      }
      return pipeline.step(state, dt, options);
    },
    reset(state, options = {}) {
      return pipeline.reset(state, options);
    },
    listSystems() {
      return pipeline.listSystems();
    },
  };
}

/**
 * Register a game using a pluggable simulation system list.
 * Developers can tune behavior by adjusting system priorities and config
 * without changing the core room/socket lifecycle hooks.
 *
 * @param {Object} config
 *   Accepts all `registerGame(...)` options plus:
 * @param {Array<{priority?: number, system: Object}>} [config.systems]
 *   Simulation system definitions.
 * @param {(args: {state: Object, dt: number, options: Object}) => boolean} [config.shouldStep]
 *   Optional guard to skip simulation for a tick.
 * @param {Object} [config.simulationShared]
 *   Shared mutable object available to all systems.
 * @param {() => number} [config.simulationNowFn]
 *   Optional time provider for simulation context.
 * @param {(state: Object, dt: number) => void} [config.afterSimulationStep]
 *   Optional callback invoked after systems run, before state serialization.
 */
export function registerPluggableGame(config = {}) {
  const simulation = createPluggableSimulation({
    systems: config.systems,
    shouldStep: config.shouldStep,
    shared: config.simulationShared,
    nowFn: config.simulationNowFn,
  });

  registerGame({
    ...config,
    updateState: (state, dt) => {
      simulation.step(state, dt);
      if (typeof config.afterSimulationStep === "function") {
        config.afterSimulationStep(state, dt);
      }
    },
  });

  return simulation;
}
