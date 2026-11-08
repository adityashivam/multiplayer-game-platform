import {
  INPUT_PROTOCOL,
  URL_PROTOCOL,
} from "../../public/platform/shared/networkProtocol.js";
import { isSupportedPlayerSlotId } from "../../public/platform/shared/gameIdentifiers.js";
import { createInputSchema } from "../../public/platform/shared/inputSchema.js";

const DEFAULT_DURATION_SECONDS = 30;
const MAX_DURATION_SECONDS = 120;
const MAX_PROBE_PLAYERS = 8;
const MAX_PROBE_TICK_RATE_HZ = 120;
const MAX_PROBE_INPUT_KEYS = 32;
const MAX_CONFIG_IDENTIFIER_LENGTH = 64;
const SUPPORTED_HTTP_PROTOCOLS = Object.freeze([URL_PROTOCOL.HTTP, URL_PROTOCOL.HTTPS]);
const CLI_OPTION = Object.freeze({ URL: "--url", DURATION: "--seconds", GAME: "--game" });
const SUPPORTED_CLI_OPTIONS = Object.freeze(Object.values(CLI_OPTION));

export const PROBE_USAGE_MESSAGE = "Usage: node scripts/network-probe.mjs --url URL [--seconds 30] [--game GAME] (maximum 120 seconds)";

/** @typedef {{serverUrl: URL, durationSeconds: number, gameId: string}} ProbeOptions */
/** @typedef {"--url"|"--seconds"|"--game"} ProbeOptionName */
/**
 * Input keys are supplied by the selected game, rather than by the diagnostic.
 * @typedef {Record<string, boolean | number>} ProbeInputState
 */
/**
 * @typedef {object} ProbeGameConfig
 * @property {string} id
 * @property {string} name
 * @property {string} namespace
 * @property {string[]} playerIds
 * @property {number} tickRateHz
 * @property {1|2|null} inputProtocol Null selects snapshots and RTT without input.
 * @property {ProbeInputState|null} inputTemplate First two controls alternate; others retain template values.
 * @property {import("../../public/platform/shared/inputSchema.js").NumericInputConfiguration<string>} [numericInputs]
 */

/** @param {unknown} configValue @returns {configValue is Record<string, unknown>} */
function isConfigRecord(configValue) {
  return configValue !== null && typeof configValue === "object" && !Array.isArray(configValue);
}

/** @param {unknown} identifier @returns {identifier is string} */
function isProbeIdentifier(identifier) {
  return typeof identifier === "string" && identifier.length > 0 &&
    identifier.length <= MAX_CONFIG_IDENTIFIER_LENGTH && identifier.trim() === identifier;
}

/**
 * Parse diagnostic options without opening connections or exiting the process.
 * The CLI supplies its default game so reusable helpers contain no game identity.
 * @param {string[]} cliArguments
 * @param {{defaultGameId?: string}} [defaults]
 * @returns {ProbeOptions}
 * @throws {Error} Missing, unknown, repeated or invalid options fail before probing.
 */
export function parseAndValidateProbeOptions(cliArguments, { defaultGameId } = {}) {
  /** @type {Map<ProbeOptionName, string>} */
  const optionValues = new Map();
  for (let argumentIndex = 0; argumentIndex < cliArguments.length; argumentIndex += 2) {
    const optionName = /** @type {ProbeOptionName} */ (cliArguments[argumentIndex]);
    const optionValue = cliArguments[argumentIndex + 1];
    if (
      !SUPPORTED_CLI_OPTIONS.includes(optionName) || optionValues.has(optionName) ||
      typeof optionValue !== "string" || optionValue.startsWith("--")
    ) {
      throw new Error(PROBE_USAGE_MESSAGE);
    }
    optionValues.set(optionName, optionValue);
  }

  const serverAddress = optionValues.get(CLI_OPTION.URL);
  const durationSeconds = Number(optionValues.get(CLI_OPTION.DURATION) ?? DEFAULT_DURATION_SECONDS);
  const gameId = optionValues.get(CLI_OPTION.GAME) ?? defaultGameId;
  if (
    !serverAddress || !isProbeIdentifier(gameId) || !Number.isFinite(durationSeconds) ||
    durationSeconds <= 0 || durationSeconds > MAX_DURATION_SECONDS
  ) {
    throw new Error(PROBE_USAGE_MESSAGE);
  }

  const serverUrl = new URL(serverAddress);
  if (!SUPPORTED_HTTP_PROTOCOLS.includes(serverUrl.protocol)) {
    throw new Error("URL must use http or https");
  }

  return { serverUrl, durationSeconds, gameId };
}

/**
 * Validate and copy resolved capabilities before any diagnostic socket is opened.
 * Limits bound one diagnostic match; this tool is not a capacity benchmark.
 * @param {unknown} probeConfig
 * @returns {ProbeGameConfig} Owned player/template copies safe for the caller to retain.
 * @throws {Error} Unsupported or malformed capabilities cannot create probe clients.
 */
export function validateProbeGameConfig(probeConfig) {
  if (!isConfigRecord(probeConfig) || !isProbeIdentifier(probeConfig.id)) {
    throw new Error("Invalid probe game identity");
  }
  if (
    typeof probeConfig.namespace !== "string" ||
    !/^\/[^\s?#]+$/.test(probeConfig.namespace)
  ) {
    throw new Error("Invalid probe namespace");
  }

  const playerIds = probeConfig.playerIds;
  if (
    !Array.isArray(playerIds) || playerIds.length === 0 || playerIds.length > MAX_PROBE_PLAYERS ||
    playerIds.some((playerId) => !isProbeIdentifier(playerId) || !isSupportedPlayerSlotId(playerId)) ||
    new Set(playerIds).size !== playerIds.length
  ) {
    throw new Error(`Probe player slots must contain 1-${MAX_PROBE_PLAYERS} unique player identifiers`);
  }
  if (
    typeof probeConfig.tickRateHz !== "number" || !Number.isFinite(probeConfig.tickRateHz) || probeConfig.tickRateHz < 1 ||
    probeConfig.tickRateHz > MAX_PROBE_TICK_RATE_HZ
  ) {
    throw new Error(`Probe tick rate must be between 1 and ${MAX_PROBE_TICK_RATE_HZ} Hz`);
  }

  const inputProtocol = probeConfig.inputProtocol;
  const inputTemplate = probeConfig.inputTemplate;
  if (inputProtocol === null) {
    if (inputTemplate !== null || probeConfig.numericInputs !== undefined) {
      throw new Error("Snapshots-only probe input template must be null");
    }
  } else {
    if (inputProtocol !== INPUT_PROTOCOL.LEGACY && inputProtocol !== INPUT_PROTOCOL.QUEUED) {
      throw new Error("Unsupported probe input protocol");
    }
    if (!isConfigRecord(inputTemplate)) {
      throw new Error("Probe input template must contain named controls");
    }

    const inputKeys = Object.keys(inputTemplate);
    if (
      inputKeys.length === 0 || inputKeys.length > MAX_PROBE_INPUT_KEYS ||
      inputKeys.some((inputKey) => !isProbeIdentifier(inputKey))
    ) {
      throw new Error(`Probe input template must contain 1-${MAX_PROBE_INPUT_KEYS} named controls`);
    }
    createInputSchema(/** @type {ProbeInputState} */ (inputTemplate), probeConfig.numericInputs);
  }

  return {
    id: probeConfig.id,
    name: typeof probeConfig.name === "string" && probeConfig.name.trim() ? probeConfig.name : probeConfig.id,
    namespace: probeConfig.namespace,
    playerIds: [...playerIds],
    tickRateHz: probeConfig.tickRateHz,
    inputProtocol,
    inputTemplate: inputTemplate === null ? null : /** @type {ProbeInputState} */ ({ ...inputTemplate }),
    ...(probeConfig.numericInputs === undefined ? {} : { numericInputs: structuredClone(probeConfig.numericInputs) }),
  };
}

/**
 * Select one registered game's public networking contract from /api/games.
 * Games without multiplayer or diagnostic capabilities fail before client setup.
 * @param {unknown} catalogResponse Parsed catalog response.
 * @param {string} gameId
 * @returns {ProbeGameConfig}
 * @throws {Error} Unknown/duplicate games, missing metadata, and unsupported capabilities.
 */
export function resolveProbeGameConfig(catalogResponse, gameId) {
  if (!isConfigRecord(catalogResponse) || !Array.isArray(catalogResponse.games)) {
    throw new Error("Invalid game catalog response");
  }

  const matchingGames = catalogResponse.games.filter((gameMeta) => isConfigRecord(gameMeta) && gameMeta.id === gameId);
  if (matchingGames.length === 0) {
    throw new Error(`Unknown game: ${gameId}`);
  }
  if (matchingGames.length > 1) {
    throw new Error(`Ambiguous duplicate game in catalog: ${gameId}`);
  }

  const gameMeta = matchingGames[0];
  if (gameMeta.networked === false) {
    throw new Error(`Game ${gameId} does not support multiplayer probes`);
  }
  const networking = gameMeta.networking;
  const room = gameMeta.room;
  if (!isConfigRecord(networking) || !isConfigRecord(room)) {
    throw new Error(`Game ${gameId} does not expose probe networking and player slot capabilities`);
  }
  if (gameMeta.namespace !== undefined && gameMeta.namespace !== networking.namespace) {
    throw new Error(`Game ${gameId} has inconsistent probe namespaces`);
  }

  return validateProbeGameConfig({
    id: gameMeta.id,
    name: gameMeta.name,
    namespace: networking.namespace,
    playerIds: room.playerIds,
    tickRateHz: networking.tickRateHz,
    inputProtocol: networking.inputProtocol ?? null,
    inputTemplate: networking.inputTemplate ?? null,
    ...(networking.numericInputs === undefined ? {} : { numericInputs: networking.numericInputs }),
  });
}
