/**
 * Resolve bounded keyboard and console navigation in a responsive catalog grid.
 * @param {number} currentIndex
 * @param {"left"|"right"|"up"|"down"|"home"|"end"} direction
 * @param {number} columns
 * @param {number} count
 * @returns {number} A valid current-page index, or zero for an empty page.
 */
export function readNextCatalogIndex(currentIndex, direction, columns, count) {
  const lastIndex = Math.max(0, count - 1);
  let nextIndex = currentIndex;
  switch (direction) {
    case "left":
      nextIndex -= 1;
      break;
    case "right":
      nextIndex += 1;
      break;
    case "up":
      nextIndex -= columns;
      break;
    case "down":
      nextIndex += columns;
      break;
    case "home":
      nextIndex = 0;
      break;
    case "end":
      nextIndex = lastIndex;
      break;
    default:
      break;
  }
  return Math.max(0, Math.min(lastIndex, nextIndex));
}

/** @param {HTMLElement|null} gridElement @returns {number} The browser's current computed grid column count. */
export function readCatalogColumnCount(gridElement) {
  if (!gridElement) return 1;
  const columns = getComputedStyle(gridElement).gridTemplateColumns;
  return columns === "none" ? 1 : Math.max(1, columns.split(/\s+/).filter(Boolean).length);
}
