/** Shared wire values. Keep these values stable when refactoring their callers. */
/**
 * @typedef {object} ServerTimingMetrics
 * @property {number|null} [eventLoopLagMs]
 * @property {number|null} [tickDriftMs]
 * @property {number} [droppedSteps]
 * @property {number|null} [roomCpuMs]
 * @property {number|null} [roomCpuAvgMs]
 * @property {number|null} [roomCpuP95Ms]
 * @property {number|null} [roomCpuP99Ms]
 */

/**
 * @typedef {object} SnapshotNetworkMetadata
 * @property {number} [seq]
 * @property {number} [serverTime]
 * @property {number} [tickRate]
 * @property {number} [simTick]
 * @property {ServerTimingMetrics} [server]
 * @property {import("./roomLifecycle.js").RoomLifecycleMetadata} [room] Platform-owned lifecycle, independent of game snapshot fields.
 */

/**
 * @typedef {object} FullSnapshotPacket
 * @property {1} __packed
 * @property {"f"} k
 * @property {number} s
 * @property {string[]} [p]
 * @property {unknown[]} v
 * @property {SnapshotNetworkMetadata} [n]
 */

/**
 * @typedef {object} DeltaSnapshotPacket
 * @property {1} __packed
 * @property {"d"} k
 * @property {number} s
 * @property {number} b
 * @property {[number, unknown][]} c
 * @property {SnapshotNetworkMetadata} [n]
 */

/** @typedef {FullSnapshotPacket|DeltaSnapshotPacket} PackedSnapshotPacket */

/**
 * @typedef {object} JoinGameRequest
 * @property {string} gameId Room identifier within the game namespace.
 * @property {string} [rejoinToken] Bearer token issued for this room's player slot.
 */

/**
 * @typedef {object} RoomFullPayload
 * @property {string} gameId
 * @property {true} [rejoinPending] The supplied token identifies a slot still held by its previous transport.
 */

/**
 * The Socket.IO envelope is fixed; event payloads are supplied by each game.
 * @typedef {object} SocketPacket
 * @property {0|1|2|3|4} type
 * @property {string} nsp
 * @property {number} [id]
 * @property {unknown} [data]
 */

export const INPUT_PROTOCOL = Object.freeze({ LEGACY: 1, QUEUED: 2 });

export const INPUT_MESSAGE_TYPE = Object.freeze({ FRAME: "inputFrame" });

export const SOCKET_EVENT = Object.freeze({
  CONNECT: "connect",
  DISCONNECT: "disconnect",
  JOIN_GAME: "joinGame",
  GAME_JOINED: "gameJoined",
  INPUT: "input",
  STATE: "state",
  PLAYER_JOINED: "playerJoined",
  PLAYER_LEFT: "playerLeft",
  ROOM_FULL: "roomFull",
  REMATCH: "rematch",
  REMATCH_REQUESTED: "rematchRequested",
  REMATCH_STARTED: "rematchStarted",
  PING: "__ping",
  RECONNECT: "reconnect",
  RECONNECT_ATTEMPT: "reconnect_attempt",
  OPEN: "open",
});

export const SOCKET_PACKET_TYPE = Object.freeze({
  CONNECT: 0,
  DISCONNECT: 1,
  EVENT: 2,
  ACKNOWLEDGEMENT: 3,
  CONNECT_ERROR: 4,
});

export const ENGINE_PACKET_TYPE = Object.freeze({ OPEN: "0", PING: "2", PONG: "3" });
export const SNAPSHOT_KIND = Object.freeze({ FULL: "f", DELTA: "d" });
export const SNAPSHOT_PROTOCOL = Object.freeze({ PACKED: 1 });

export const NETWORK_TIMING = Object.freeze({
  SIMULATION_HZ: 60,
  FIXED_DT_SEC: 1 / 60,
  INPUT_STARVATION_MS: 500,
});

export const INPUT_LIMITS = Object.freeze({
  MAX_QUEUED_FRAMES: 120,
  MAX_CREDIT_SEC: 0.25,
  MAX_FRAMES_PER_TICK: 8,
  MAX_PENDING_FRAMES: 240,
});

export const NETWORK_ENDPOINT = Object.freeze({
  HEALTH: "/api/health",
  GAME_CATALOG: "/api/games",
  SOCKET_WEBSOCKET: "/socket.io/?EIO=4&transport=websocket",
});

export const URL_PROTOCOL = Object.freeze({
  HTTP: "http:",
  HTTPS: "https:",
  WEBSOCKET: "ws:",
  SECURE_WEBSOCKET: "wss:",
});
