const PLAYER_SLOT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const NUMERIC_PATH_TOKEN_PATTERN = /^\d+$/;
const RESERVED_SNAPSHOT_PATH_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Check that a game-defined slot survives the current dotted snapshot schema.
 * Slot IDs use letters, digits, underscores and hyphens; numeric-only and
 * prototype traversal keys are excluded. Display names are separate game data.
 * @param {unknown} playerId
 * @returns {playerId is string}
 */
export function isSupportedPlayerSlotId(playerId) {
  return typeof playerId === "string" && PLAYER_SLOT_ID_PATTERN.test(playerId) &&
    !NUMERIC_PATH_TOKEN_PATTERN.test(playerId) && !RESERVED_SNAPSHOT_PATH_KEYS.has(playerId);
}
