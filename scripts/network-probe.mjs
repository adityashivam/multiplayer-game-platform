import { NETWORK_ENDPOINT } from "../public/platform/shared/networkProtocol.js";
import { classifyNetworkTiming, summarizeNetworkTiming } from "./lib/networkMetrics.js";
import { createProbePlayerClient } from "./lib/probeClient.js";
import {
  parseAndValidateProbeOptions,
  PROBE_USAGE_MESSAGE,
  resolveProbeGameConfig,
} from "./lib/probeOptions.js";

const MS_PER_SECOND = 1000;
const DEFAULT_PROBE_GAME_ID = "fight";
const HTTP_REQUEST_TIMEOUT_MS = 5000;
const LEGACY_PROBE_PLAYER_NAMES = Object.freeze(["player-one", "player-two"]);
const REPORT_NOTE = "Sequence gaps are application snapshot gaps, not measured IP packet loss. Relative transit variation is not one-way latency.";

/** @typedef {import("./lib/probeClient.js").ProbePlayerClient} ProbePlayerClient */
/** @typedef {import("./lib/probeOptions.js").ProbeOptions} ProbeOptions */
/** @typedef {import("./lib/probeOptions.js").ProbeGameConfig} ProbeGameConfig */
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
 * Preserve CLI usage errors and keep its default game at the composition boundary.
 * @param {string[]} cliArguments
 * @returns {ProbeOptions}
 * @throws {Error} Invalid URLs/protocols throw; missing URL or invalid duration exits with status 1.
 */
function readProbeCommandLineOptions(cliArguments) {
  try {
    return parseAndValidateProbeOptions(cliArguments, { defaultGameId: DEFAULT_PROBE_GAME_ID });
  } catch (optionError) {
    if (optionError.message === PROBE_USAGE_MESSAGE) {
      console.error(PROBE_USAGE_MESSAGE);
      process.exit(1);
    }
    throw optionError;
  }
}

/**
 * Resolve capabilities from the public catalog before opening diagnostic sockets.
 * @param {URL} serverUrl
 * @param {string} gameId
 * @returns {Promise<ProbeGameConfig>}
 * @throws {Error} Unavailable catalog, invalid metadata or unsupported selected game.
 */
async function readProbeGameConfig(serverUrl, gameId) {
  const catalogResponse = await fetch(new URL(NETWORK_ENDPOINT.GAME_CATALOG, serverUrl), {
    signal: AbortSignal.timeout(HTTP_REQUEST_TIMEOUT_MS),
  });
  if (!catalogResponse.ok) {
    throw new Error(`Game catalog request failed with HTTP ${catalogResponse.status}`);
  }

  return resolveProbeGameConfig(await catalogResponse.json(), gameId);
}

/**
 * Read optional health metadata; legacy servers may not expose this endpoint.
 * @param {URL} serverUrl
 * @returns {Promise<ServerHealthResponse>} Failed requests are represented in the report.
 */
async function readServerHealth(serverUrl) {
  try {
    const healthResponse = await fetch(new URL(NETWORK_ENDPOINT.HEALTH, serverUrl), {
      signal: AbortSignal.timeout(HTTP_REQUEST_TIMEOUT_MS),
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
 * Run one configured diagnostic match and print the existing timing fields.
 * @param {ProbeOptions} probeOptions
 * @returns {Promise<void>}
 * @throws {Error} Connection/codec failures propagate after all clients are closed.
 */
async function runNetworkProbe({ serverUrl, durationSeconds, gameId }) {
  const probeGameConfig = await readProbeGameConfig(serverUrl, gameId);
  const roomId = `probe${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  /** @type {ProbePlayerClient[]} */
  const probeClients = [];

  try {
    const initialServerHealth = await readServerHealth(serverUrl);
    console.error(`Measuring one ${probeGameConfig.playerIds.length}-player ${probeGameConfig.name} room at ${serverUrl.origin} for ${durationSeconds} seconds`);
    for (const [playerIndex] of probeGameConfig.playerIds.entries()) {
      const playerName = LEGACY_PROBE_PLAYER_NAMES[playerIndex] ?? `player-${playerIndex + 1}`;
      const probeClient = createProbePlayerClient({
        playerName,
        serverUrl,
        roomId,
        gameConfig: probeGameConfig,
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
      game: probeGameConfig,
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

await runNetworkProbe(readProbeCommandLineOptions(process.argv.slice(2)));
