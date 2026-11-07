import { monitorEventLoopDelay } from "node:perf_hooks";
import { INPUT_PROTOCOL, NETWORK_ENDPOINT } from "../../public/platform/shared/networkProtocol.js";

const EVENT_LOOP_SAMPLE_RESOLUTION_MS = 20;
const NANOSECONDS_PER_MILLISECOND = 1e6;
const DEVELOPMENT_BUILD_ID = "development";
const HEALTH_CACHE_POLICY = Object.freeze({ HEADER: "Cache-Control", VALUE: "no-store" });

/** @typedef {{BUILD_ID?: string, RENDER_GIT_COMMIT?: string, GIT_COMMIT?: string}} BuildEnvironment */
/** @typedef {{build: string, commit: string|null}} ServerBuildIdentity */
/**
 * @typedef {object} ServerHealthSnapshot
 * @property {string} build
 * @property {string|null} commit
 * @property {number} protocol
 * @property {number} uptimeSeconds
 * @property {{resolution: number, mean: number|null, p95: number, p99: number}} eventLoopDelayMs
 */

/**
 * Read the existing build identifier precedence, including empty-value fallback.
 * @param {BuildEnvironment} buildEnvironment
 * @returns {ServerBuildIdentity}
 */
function readServerBuildIdentity(buildEnvironment) {
  return {
    build: buildEnvironment.BUILD_ID || buildEnvironment.RENDER_GIT_COMMIT
      || buildEnvironment.GIT_COMMIT || DEVELOPMENT_BUILD_ID,
    commit: buildEnvironment.RENDER_GIT_COMMIT || buildEnvironment.GIT_COMMIT || null,
  };
}

/**
 * Capture process health separately from match and network timing.
 * @param {ServerBuildIdentity} serverBuildIdentity
 * @param {import("node:perf_hooks").IntervalHistogram} eventLoopMonitor
 * @returns {ServerHealthSnapshot} Histogram values include the sampling interval.
 */
function createServerHealthSnapshot(serverBuildIdentity, eventLoopMonitor) {
  return {
    build: serverBuildIdentity.build,
    commit: serverBuildIdentity.commit,
    protocol: INPUT_PROTOCOL.QUEUED,
    uptimeSeconds: process.uptime(),
    eventLoopDelayMs: {
      resolution: EVENT_LOOP_SAMPLE_RESOLUTION_MS,
      mean: Number.isFinite(eventLoopMonitor.mean)
        ? eventLoopMonitor.mean / NANOSECONDS_PER_MILLISECOND
        : null,
      p95: eventLoopMonitor.percentile(95) / NANOSECONDS_PER_MILLISECOND,
      p99: eventLoopMonitor.percentile(99) / NANOSECONDS_PER_MILLISECOND,
    },
  };
}

/**
 * Register the uncached health endpoint and its process-lifetime monitor.
 * @param {import("express").Express} platformHttpApp
 * @returns {void}
 */
export function registerHealthRoute(platformHttpApp) {
  const eventLoopMonitor = monitorEventLoopDelay({ resolution: EVENT_LOOP_SAMPLE_RESOLUTION_MS });
  const serverBuildIdentity = readServerBuildIdentity(process.env);
  eventLoopMonitor.enable();

  platformHttpApp.get(NETWORK_ENDPOINT.HEALTH, (_httpRequest, httpResponse) => {
    httpResponse.set(HEALTH_CACHE_POLICY.HEADER, HEALTH_CACHE_POLICY.VALUE);
    httpResponse.json(createServerHealthSnapshot(serverBuildIdentity, eventLoopMonitor));
  });
}
