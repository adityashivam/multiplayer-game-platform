/**
 * Library card zoom: one continuous scale shared by the buttons, the slider,
 * trackpad pinch and touch pinch, remembered on this device. Storage is a
 * per-viewer convenience, so every failure falls back to the default size.
 */

/**
 * `min`/`max` bound the card scale; `step` is one button press and the grid
 * the buttons snap to (anchored on `initial`, so 1 is always a stop).
 */
export const LIBRARY_ZOOM = Object.freeze({ min: 0.45, max: 1.6, step: 0.15, initial: 1 });

const STORAGE_KEY = "platform.library-card-scale.v1";
const SNAP_TOLERANCE = 0.001;

/** @param {number} scale @returns {number} The scale kept inside the zoom range. */
export function clampLibraryZoom(scale) {
  if (!Number.isFinite(scale)) return LIBRARY_ZOOM.initial;
  return Math.min(LIBRARY_ZOOM.max, Math.max(LIBRARY_ZOOM.min, scale));
}

/**
 * The next button stop in a direction. A scale between stops (after a pinch)
 * moves to the nearest stop on that side rather than a whole step further.
 * @param {number} scale
 * @param {1|-1} direction 1 zooms in (bigger cards), -1 zooms out.
 * @returns {number}
 */
export function stepLibraryZoom(scale, direction) {
  const { step, initial } = LIBRARY_ZOOM;
  const stopsFromInitial = (clampLibraryZoom(scale) - initial) / step;
  const nextStop = direction > 0
    ? Math.floor(stopsFromInitial + SNAP_TOLERANCE) + 1
    : Math.ceil(stopsFromInitial - SNAP_TOLERANCE) - 1;
  return clampLibraryZoom(Number((initial + nextStop * step).toFixed(4)));
}

/**
 * Apply a relative pinch or wheel factor (2 doubles the card size).
 * @param {number} scale
 * @param {number} factor
 * @returns {number}
 */
export function scaleLibraryZoomByFactor(scale, factor) {
  if (!Number.isFinite(factor) || factor <= 0) return clampLibraryZoom(scale);
  return clampLibraryZoom(scale * factor);
}

/**
 * @param {Pick<Storage,"getItem">|undefined} [storage=globalThis.localStorage]
 * @returns {number} The remembered scale, or the default.
 */
export function readLibraryZoom(storage = globalThis.localStorage) {
  try {
    const stored = Number.parseFloat(storage?.getItem(STORAGE_KEY) ?? "");
    return Number.isFinite(stored) ? clampLibraryZoom(stored) : LIBRARY_ZOOM.initial;
  } catch {
    return LIBRARY_ZOOM.initial;
  }
}

/**
 * @param {number} scale
 * @param {Pick<Storage,"setItem">|undefined} [storage=globalThis.localStorage]
 */
export function saveLibraryZoom(scale, storage = globalThis.localStorage) {
  try {
    storage?.setItem(STORAGE_KEY, String(Number(clampLibraryZoom(scale).toFixed(3))));
  } catch {
    // Private windows and blocked storage simply forget the size.
  }
}
