/** Optional, renderer-independent game library metadata. */
export const GAME_CONTROL_LABELS = Object.freeze({
  keyboard: "Keyboard",
  touch: "Touch",
  pointer: "Mouse / pen",
});

/** Viewport orientations a game's renderer can lay itself out for. */
export const GAME_ORIENTATIONS = Object.freeze(["landscape", "portrait"]);

/**
 * @typedef {"keyboard"|"touch"|"pointer"} GameControl
 * @typedef {"landscape"|"portrait"} GameOrientation
 * @typedef {object} GamePresentation
 * @property {string} [coverUrl] Root-relative or HTTPS cover illustration.
 * @property {string} [capsuleUrl] Portrait 600×900 art for library cards; root-relative or HTTPS.
 * @property {string} [backdropUrl] Wide 1920×1080 scene shown behind the library; root-relative or HTTPS.
 * @property {string} [accentColor] Six-digit hex color.
 * @property {GameControl[]} [controls] Inputs the game actually supports.
 * @property {GameOrientation[]} [orientations] Viewport orientations the game lays itself out
 *   for. Omitted means landscape only, so the platform asks touch players to rotate first.
 */

/** @param {unknown} coverUrl @returns {boolean} Whether a cover can use a supported image URL. */
export function isSupportedGameCoverUrl(coverUrl) {
  if (typeof coverUrl !== "string" || /[\s\\]/.test(coverUrl)) return false;
  if (coverUrl.startsWith("/") && !coverUrl.startsWith("//")) return true;

  try {
    return new URL(coverUrl).protocol === "https:";
  } catch {
    return false;
  }
}

/** @param {unknown} accentColor @returns {boolean} Whether an accent is a plain hex color. */
export function isSupportedGameAccent(accentColor) {
  return typeof accentColor === "string" && /^#[0-9a-f]{6}$/i.test(accentColor);
}

/**
 * The orientations a game declares, defaulting to landscape only.
 * Malformed values fall back to the default rather than throwing, for older catalog entries.
 * @param {GamePresentation|undefined} presentation
 * @returns {GameOrientation[]}
 */
export function readGameOrientations(presentation) {
  const orientations = presentation?.orientations;
  if (!Array.isArray(orientations)) return ["landscape"];
  const supported = GAME_ORIENTATIONS.filter((orientation) => orientations.includes(orientation));
  return supported.length > 0 ? supported : ["landscape"];
}

/** @param {unknown} orientations @returns {boolean} Whether a declared orientation list is usable. */
function isSupportedGameOrientationList(orientations) {
  return Array.isArray(orientations) && orientations.length > 0 &&
    new Set(orientations).size === orientations.length &&
    orientations.every((orientation) => GAME_ORIENTATIONS.includes(orientation));
}

/**
 * Validate optional presentation before any trusted game plugin is registered.
 * @param {GamePresentation|undefined} presentation
 * @param {string} gameId
 * @returns {void}
 * @throws {TypeError} If supplied fields cannot be displayed safely or describe unsupported inputs.
 */
export function validateGamePresentation(presentation, gameId) {
  if (presentation === undefined) return;

  if (presentation === null || typeof presentation !== "object" || Array.isArray(presentation) ||
      ["coverUrl", "capsuleUrl", "backdropUrl"].some((artworkKey) =>
        presentation[artworkKey] !== undefined && !isSupportedGameCoverUrl(presentation[artworkKey])) ||
      (presentation.accentColor !== undefined && !isSupportedGameAccent(presentation.accentColor)) ||
      (presentation.controls !== undefined && (!Array.isArray(presentation.controls) ||
        presentation.controls.some((control) =>
          typeof control !== "string" || !Object.hasOwn(GAME_CONTROL_LABELS, control)))) ||
      (presentation.orientations !== undefined && !isSupportedGameOrientationList(presentation.orientations))) {
    throw new TypeError(`Game ${gameId} has invalid presentation metadata`);
  }
}
