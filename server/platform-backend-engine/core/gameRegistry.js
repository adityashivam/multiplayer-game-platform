import { isSupportedPlayerSlotId } from "../../../public/platform/shared/gameIdentifiers.js";
import { validateGamePresentation } from "../../../public/platform/shared/gamePresentation.js";

/** The trusted, in-process game package contract supported by this engine. */
export const GAME_PLUGIN_API_VERSION = 1;

/**
 * @typedef {object} GameNetworkingMetadata
 * @property {string} namespace
 * @property {number} tickRateHz
 * @property {1|2|null} [inputProtocol]
 * @property {Record<string, boolean>|null} [inputTemplate] Game-defined input keys.
 */

/**
 * @typedef {object} GameMetadata
 * @property {string} id
 * @property {string} name
 * @property {string} path
 * @property {string} [description]
 * @property {string} [namespace]
 * @property {string} [engine]
 * @property {object} [runtime]
 * @property {string[]} [tags]
 * @property {boolean} [startInLandscape]
 * @property {boolean} [platformControlButtons]
 * @property {boolean} [shareRoom]
 * @property {boolean} [networked]
 * @property {{playerIds: string[]}} [room]
 * @property {GameNetworkingMetadata} [networking]
 * @property {import("../../../public/platform/shared/gamePresentation.js").GamePresentation} [presentation]
 */

/**
 * @typedef {object} GamePlugin
 * @property {1} apiVersion
 * @property {GameMetadata} meta
 * @property {(io: import("socket.io").Server) => unknown} [register]
 */

/**
 * @typedef {object} GameRegistry
 * @property {() => GameMetadata[]} listGames Returns independently owned catalog metadata.
 * @property {(gameId: string) => GameMetadata|undefined} getGame
 * @property {(io: import("socket.io").Server) => void} registerGames
 */

/** @param {unknown} value @returns {boolean} */
function isMetadataObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value @returns {boolean} */
function isAbsoluteGamePath(value) {
  return typeof value === "string" && value.startsWith("/") && !/[\s?#\\]/.test(value);
}

/** @param {GameMetadata} gameMetadata */
function validateRoomMetadata(gameMetadata) {
  if (gameMetadata.room === undefined) return;

  const playerIds = gameMetadata.room?.playerIds;
  if (!isMetadataObject(gameMetadata.room) || !Array.isArray(playerIds) || playerIds.length === 0 ||
      playerIds.some((playerId) => !isSupportedPlayerSlotId(playerId)) ||
      new Set(playerIds).size !== playerIds.length) {
    throw new TypeError(`Game ${gameMetadata.id} requires unique snapshot-compatible room.playerIds`);
  }
}

/** @param {GameMetadata} gameMetadata */
function validateNetworkingMetadata(gameMetadata) {
  const networking = gameMetadata.networking;
  if (networking === undefined) return;

  if (!isMetadataObject(networking) || !isAbsoluteGamePath(networking.namespace) ||
      networking.namespace !== gameMetadata.namespace ||
      !Number.isFinite(networking.tickRateHz) || networking.tickRateHz <= 0) {
    throw new TypeError(`Game ${gameMetadata.id} has invalid networking namespace or cadence`);
  }
  if (networking.inputProtocol != null && networking.inputProtocol !== 1 && networking.inputProtocol !== 2) {
    throw new TypeError(`Game ${gameMetadata.id} has an unsupported input protocol`);
  }
  if (networking.inputProtocol == null) {
    if (networking.inputTemplate != null) {
      throw new TypeError(`Passive game ${gameMetadata.id} cannot advertise an input template`);
    }
  } else if (!isMetadataObject(networking.inputTemplate) ||
      Object.keys(networking.inputTemplate).length === 0 ||
      Object.values(networking.inputTemplate).some((value) => typeof value !== "boolean")) {
    throw new TypeError(`Game ${gameMetadata.id} requires a nonempty boolean input template`);
  }
}

/**
 * Copy and validate metadata for owned catalog reads and JSON delivery before registration.
 * @param {GamePlugin} gamePlugin
 * @returns {GamePlugin}
 * @throws {TypeError} For invalid plugin versions, metadata, or callback contracts.
 */
function copyAndValidateGamePlugin(gamePlugin) {
  if (!isMetadataObject(gamePlugin) || gamePlugin.apiVersion !== GAME_PLUGIN_API_VERSION) {
    throw new TypeError(`Game plugins require apiVersion ${GAME_PLUGIN_API_VERSION}`);
  }
  const gameMetadata = gamePlugin.meta;
  if (!isMetadataObject(gameMetadata) || typeof gameMetadata.id !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(gameMetadata.id) ||
      typeof gameMetadata.name !== "string" || !gameMetadata.name.trim() ||
      !isAbsoluteGamePath(gameMetadata.path)) {
    throw new TypeError("Game metadata requires an id, name, and absolute client path");
  }

  if (gamePlugin.register !== undefined && typeof gamePlugin.register !== "function") {
    throw new TypeError(`Game ${gameMetadata.id} requires a trusted registration callback`);
  }
  if ((gameMetadata.namespace !== undefined && !isAbsoluteGamePath(gameMetadata.namespace)) ||
      (gameMetadata.networked !== false &&
       (typeof gamePlugin.register !== "function" || !isAbsoluteGamePath(gameMetadata.namespace)))) {
    throw new TypeError(`Networked game ${gameMetadata.id} requires a namespace and registration callback`);
  }

  validateRoomMetadata(gameMetadata);
  validateNetworkingMetadata(gameMetadata);
  validateGamePresentation(gameMetadata.presentation, gameMetadata.id);

  try {
    const catalogMetadata = structuredClone(gameMetadata);
    JSON.stringify(catalogMetadata);

    return { apiVersion: GAME_PLUGIN_API_VERSION, meta: catalogMetadata, register: gamePlugin.register };
  } catch (error) {
    throw new TypeError(`Game ${gameMetadata.id} requires serializable catalog metadata`, { cause: error });
  }
}

/**
 * Build a registry of trusted packages already imported by application composition.
 * This API does not resolve module paths or execute externally supplied code.
 * Every plugin is validated before registerGames can mount any namespace.
 * @param {GamePlugin[]} gamePlugins
 * @returns {GameRegistry}
 * @throws {TypeError} For invalid plugins or conflicting IDs, namespaces, or paths.
 */
export function createGameRegistry(gamePlugins) {
  if (!Array.isArray(gamePlugins)) {
    throw new TypeError("Game plugins must be an array of trusted registrations");
  }

  const plugins = gamePlugins.map(copyAndValidateGamePlugin);
  const gamesById = new Map();
  const namespaces = new Set();
  const clientPaths = new Set();

  for (const { meta } of plugins) {
    const clientPath = meta.path.replace(/\/+$/, "") || "/";
    if (gamesById.has(meta.id) || clientPaths.has(clientPath) ||
        (meta.namespace !== undefined && namespaces.has(meta.namespace))) {
      throw new TypeError(`Duplicate game id, namespace, or client path for ${meta.id}`);
    }
    gamesById.set(meta.id, meta);
    clientPaths.add(clientPath);
    if (meta.namespace !== undefined) namespaces.add(meta.namespace);
  }

  return {
    listGames: () => plugins.map(({ meta }) => structuredClone(meta)),
    getGame(gameId) {
      const gameMetadata = gamesById.get(gameId);
      return gameMetadata === undefined ? undefined : structuredClone(gameMetadata);
    },
    registerGames(io) {
      if (!io || typeof io.of !== "function") {
        throw new TypeError("Game registration requires a Socket.IO server");
      }
      for (const gamePlugin of plugins) {
        if (gamePlugin.register) {
          gamePlugin.register.call({ ...gamePlugin, meta: structuredClone(gamePlugin.meta) }, io);
        }
      }
    },
  };
}
