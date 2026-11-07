import { NETWORK_ENDPOINT, URL_PROTOCOL } from "../public/platform/shared/networkProtocol.js";
import { classifyNetworkTiming, summarizeNetworkTiming } from "./lib/networkMetrics.js";
import { createProbePlayerClient } from "./lib/probeClient.js";

const MS_PER_SECOND = 1000;
const DEFAULT_DURATION_SECONDS = 30;
const MAX_DURATION_SECONDS = 120;
const HEALTH_REQUEST_TIMEOUT_MS = 5000;
const SUPPORTED_HTTP_PROTOCOLS = Object.freeze([URL_PROTOCOL.HTTP, URL_PROTOCOL.HTTPS]);
const PROBE_PLAYER_NAMES = Object.freeze(["player-one", "player-two"]);
const CLI_OPTION = Object.freeze({ URL: "--url", DURATION: "--seconds" });
const USAGE_MESSAGE = "Usage: node scripts/network-probe.mjs --url URL [--seconds 30] (maximum 120 seconds)";
const INVALID_PROTOCOL_MESSAGE = "URL must use http or https";
const REPORT_NOTE = "Sequence gaps are application snapshot gaps, not measured IP packet loss. Relative transit variation is not one-way latency.";

/** @typedef {import("./lib/probeClient.js").ProbePlayerClient} ProbePlayerClient */
/** @typedef {{serverUrl: URL, durationSeconds: number}} ProbeOptions */
/**
 * @typedef {object} ServerHealthResponse
 * @property {string} [build]
 * @property {string|null} [commit]
 * @property {number} [protocol]
 * @property {number} [uptimeSeconds]
 * @property {{resolution: number, mean: number|null, p95: number, p99: number}} [eventLoopDelayMs]
 * @property {false} [available]
 * @property {number} [status]
 * @property {string} [error]
 */

/**
 * Parse existing CLI options, preserving their defaults and failure behavior.
 * @param {string[]} cliArguments
 * @returns {ProbeOptions}
 * @throws {Error} Invalid URLs/protocols throw; missing URL or invalid duration exits with status 1.
 */
function parseAndValidateProbeOptions(cliArguments) {
  /** @param {(typeof CLI_OPTION)[keyof typeof CLI_OPTION]} optionName @returns {string|undefined} */
  function readOptionValue(optionName) {
    const optionIndex = cliArguments.indexOf(optionName);
    return optionIndex < 0 ? undefined : cliArguments[optionIndex + 1];
  }

  const serverAddress = readOptionValue(CLI_OPTION.URL);
  const durationSeconds = Number(readOptionValue(CLI_OPTION.DURATION) ?? DEFAULT_DURATION_SECONDS);
  if (!serverAddress || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > MAX_DURATION_SECONDS) {
    console.error(USAGE_MESSAGE);
    process.exit(1);
  }

  const serverUrl = new URL(serverAddress);
  if (!SUPPORTED_HTTP_PROTOCOLS.includes(serverUrl.protocol)) {
    throw new Error(INVALID_PROTOCOL_MESSAGE);
  }

  return { serverUrl, durationSeconds };
}

/**
 * Read optional health metadata; legacy servers may not expose this endpoint.
 * @param {URL} serverUrl
 * @returns {Promise<ServerHealthResponse>} Failed requests are represented in the report.
 */
async function readServerHealth(serverUrl) {
  try {
    const healthResponse = await fetch(new URL(NETWORK_ENDPOINT.HEALTH, serverUrl), {
      signal: AbortSignal.timeout(HEALTH_REQUEST_TIMEOUT_MS),
    });
    if (!healthResponse.ok) {
      return { available: false, status: healthResponse.status };
    }

    return await healthResponse.json();
  } catch (healthError) {
    return { available: false, error: healthError.message };
  }
}

/** @param {ProbePlayerClient[]} probeClients @returns {void} Preserve stream/timer/socket cleanup order. */
function closeProbeClients(probeClients) {
  for (const probeClient of probeClients) {
    probeClient.stopInputStream();
  }
  for (const probeClient of probeClients) {
    probeClient.stopRoundTripSampling();
  }
  for (const probeClient of probeClients) {
    probeClient.closeSocketConnection();
  }
}

/**
 * Run one two-player diagnostic match and print the existing JSON report.
 * @param {ProbeOptions} probeOptions
 * @returns {Promise<void>}
 * @throws {Error} Connection/codec failures propagate after all clients are closed.
 */
async function runNetworkProbe({ serverUrl, durationSeconds }) {
  const roomId = `probe${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  /** @type {ProbePlayerClient[]} */
  const probeClients = [];

  try {
    const initialServerHealth = await readServerHealth(serverUrl);
    console.error(`Measuring one two-player Fight room at ${serverUrl.origin} for ${durationSeconds} seconds`);
    for (const playerName of PROBE_PLAYER_NAMES) {
      const probeClient = createProbePlayerClient({
        playerName,
        serverUrl,
        roomId,
        protocolVersion: initialServerHealth.protocol,
      });
      probeClients.push(probeClient);
      await probeClient.joinRoom();
      probeClient.startSampling();
    }

    await new Promise((resolve) => setTimeout(resolve, durationSeconds * MS_PER_SECOND));
    const networkSummaries = probeClients.map((probeClient) => {
      const networkSummary = summarizeNetworkTiming(probeClient.networkSamples);
      return { ...networkSummary, classification: classifyNetworkTiming(networkSummary) };
    });
    const probeReport = {
      origin: serverUrl.origin,
      roomId,
      measuredAt: new Date().toISOString(),
      durationSeconds,
      healthBefore: initialServerHealth,
      healthAfter: await readServerHealth(serverUrl),
      summaries: networkSummaries,
      note: REPORT_NOTE,
    };
    console.log(JSON.stringify(probeReport, null, 2));
  } finally {
    closeProbeClients(probeClients);
  }
}

await runNetworkProbe(parseAndValidateProbeOptions(process.argv.slice(2)));
