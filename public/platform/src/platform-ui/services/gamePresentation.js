import {
  GAME_CONTROL_LABELS,
  isSupportedGameAccent,
  isSupportedGameCoverUrl,
} from "../../../shared/gamePresentation.js";

const DEFAULT_LIBRARY_ACCENT = "#00daf3";
const CAPABILITY_TAG_PATTERN = /^(?:\d+\s*players?|single player|real[- ]?time|fast|touch|webgl|demo|preview)$/i;
const PLAYER_COUNT_TAG_PATTERN = /^(\d+)\s*players?$/i;

/**
 * @typedef {object} LibraryGameMetadata
 * @property {string[]} [tags]
 * @property {boolean} [networked]
 * @property {{playerIds: string[]}} [room]
 * @property {import("../../../shared/gamePresentation.js").GamePresentation} [presentation]
 *
 * @typedef {object} GameLibraryDetails
 * @property {string|null} coverUrl
 * @property {string} accentColor
 * @property {string} genreLabel
 * @property {string} playerLabel
 * @property {string[]} controlLabels
 */

/** @param {LibraryGameMetadata} game @param {string[]} tags @returns {string} An advertised capacity, never a live count. */
function readPlayerCapacityLabel(game, tags) {
  const roomCapacity = game.room?.playerIds?.length;
  if (roomCapacity > 0) return roomCapacity === 1 ? "Single player" : `${roomCapacity} players`;

  const taggedCapacity = tags.map((tag) => tag.match(PLAYER_COUNT_TAG_PATTERN)).find(Boolean);
  const playerCount = Number(taggedCapacity?.[1]);
  if (playerCount === 1 || tags.some((tag) => /^single player$/i.test(tag))) return "Single player";
  if (playerCount > 1) return `${playerCount} players`;
  return game.networked === false ? "Single player" : "Multiplayer";
}

/**
 * Derive presentation from any game's catalog entry, including older entries without artwork.
 * Missing or malformed optional fields use safe defaults without game-specific lookups.
 * @param {LibraryGameMetadata} game Public catalog metadata.
 * @returns {GameLibraryDetails}
 */
export function readGameLibraryDetails(game) {
  const presentation = game.presentation || {};
  const tags = Array.isArray(game.tags) ? game.tags.filter((tag) => typeof tag === "string") : [];
  const controls = Array.isArray(presentation.controls) ? presentation.controls : [];

  return {
    coverUrl: isSupportedGameCoverUrl(presentation.coverUrl) ? presentation.coverUrl : null,
    accentColor: isSupportedGameAccent(presentation.accentColor) ? presentation.accentColor : DEFAULT_LIBRARY_ACCENT,
    genreLabel: tags.find((tag) => !CAPABILITY_TAG_PATTERN.test(tag)) || "Game",
    playerLabel: readPlayerCapacityLabel(game, tags),
    controlLabels: [...new Set(controls.filter((control) =>
      typeof control === "string" && Object.hasOwn(GAME_CONTROL_LABELS, control)))]
      .map((control) => GAME_CONTROL_LABELS[control]),
  };
}
