/**
 * Crossfade bookkeeping for the library backdrop: the newest backdrop fades
 * in over the previous one, and older layers are dropped so quick focus
 * changes never pile up images.
 */

/** @typedef {{id:number,url:string}} LibraryBackdropLayer */

const MAX_BACKDROP_LAYERS = 2;

/**
 * @param {readonly LibraryBackdropLayer[]} layers Current layers, oldest first.
 * @param {string|null} url The focused game's backdrop, or null when it has none.
 * @returns {readonly LibraryBackdropLayer[]} The same array when nothing changes.
 */
export function pushLibraryBackdropLayer(layers, url) {
  if (!url) return layers.length ? [] : layers;
  const newest = layers.at(-1);
  if (newest?.url === url) return layers;
  return [...layers.slice(-(MAX_BACKDROP_LAYERS - 1)), { id: (newest?.id ?? 0) + 1, url }];
}
