/** Optional, renderer-independent game library metadata. */
export const GAME_CONTROL_LABELS = Object.freeze({
  keyboard: "Keyboard",
  touch: "Touch",
  pointer: "Mouse / pen",
});

/**
 * @typedef {"keyboard"|"touch"|"pointer"} GameControl
 * @typedef {object} GamePresentation
 * @property {string} [coverUrl] Root-relative or HTTPS cover illustration.
 * @property {string} [accentColor] Six-digit hex color.
 * @property {GameControl[]} [controls] Inputs the game actually supports.
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
 * Validate optional presentation before any trusted game plugin is registered.
 * @param {GamePresentation|undefined} presentation
 * @param {string} gameId
 * @returns {void}
 * @throws {TypeError} If supplied fields cannot be displayed safely or describe unsupported inputs.
 */
export function validateGamePresentation(presentation, gameId) {
  if (presentation === undefined) return;

  if (presentation === null || typeof presentation !== "object" || Array.isArray(presentation) ||
      (presentation.coverUrl !== undefined && !isSupportedGameCoverUrl(presentation.coverUrl)) ||
      (presentation.accentColor !== undefined && !isSupportedGameAccent(presentation.accentColor)) ||
      (presentation.controls !== undefined && (!Array.isArray(presentation.controls) ||
        presentation.controls.some((control) =>
          typeof control !== "string" || !Object.hasOwn(GAME_CONTROL_LABELS, control))))) {
    throw new TypeError(`Game ${gameId} has invalid presentation metadata`);
  }
}
