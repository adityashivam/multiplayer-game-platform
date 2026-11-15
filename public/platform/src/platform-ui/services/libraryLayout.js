/**
 * Which library layout a device shows: the card grid, or the disc built for
 * portrait screens. A player's choice is remembered per device; without one,
 * portrait screens get the disc and everything else the grid. The disc is a
 * portrait layout, so landscape always uses the grid.
 */

/** @typedef {"grid"|"disc"} LibraryLayout */

export const LIBRARY_LAYOUTS = Object.freeze(["grid", "disc"]);
/** Portrait screens narrow enough to stack the library in one column. */
export const PORTRAIT_LIBRARY_QUERY = "(max-width: 900px) and (orientation: portrait)";
const STORAGE_KEY = "platform.library-layout.v1";

/**
 * @param {Pick<Storage,"getItem">|undefined} [storage=globalThis.localStorage]
 * @returns {LibraryLayout|null} The remembered choice, or null when there is none.
 */
export function readLibraryLayoutChoice(storage = globalThis.localStorage) {
  try {
    const stored = storage?.getItem(STORAGE_KEY);
    return LIBRARY_LAYOUTS.includes(/** @type {LibraryLayout} */ (stored)) ? /** @type {LibraryLayout} */ (stored) : null;
  } catch {
    return null;
  }
}

/**
 * @param {LibraryLayout} layout
 * @param {Pick<Storage,"setItem">|undefined} [storage=globalThis.localStorage]
 */
export function saveLibraryLayoutChoice(layout, storage = globalThis.localStorage) {
  try {
    storage?.setItem(STORAGE_KEY, layout);
  } catch {
    // Private windows and blocked storage keep the choice for this visit only.
  }
}

/**
 * The layout to show right now.
 * @param {LibraryLayout|null} choice The player's remembered choice, if any.
 * @param {boolean} portrait Whether the screen is a portrait one.
 * @returns {LibraryLayout}
 */
export function resolveLibraryLayout(choice, portrait) {
  if (!portrait) return "grid";
  return choice ?? "disc";
}
