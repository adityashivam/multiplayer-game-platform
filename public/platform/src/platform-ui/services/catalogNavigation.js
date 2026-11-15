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

/**
 * @typedef {{left:number,top:number,width:number,height:number}} CatalogCardBox
 */

/**
 * Move through cards by where they are drawn, so up and down stay natural
 * when the last row is partial or columns change mid-zoom. Left/right/home/end follow list order.
 * @param {readonly CatalogCardBox[]} boxes Each card's box, by catalog index.
 * @param {number} currentIndex
 * @param {"left"|"right"|"up"|"down"|"home"|"end"} direction
 * @returns {number} The next index, or the current one at an edge.
 */
export function readSpatialCatalogIndex(boxes, currentIndex, direction) {
  const count = boxes.length;
  if (!count) return 0;
  const current = boxes[currentIndex];
  if (!current || (direction !== "up" && direction !== "down")) {
    return readNextCatalogIndex(currentIndex, direction, 1, count);
  }

  const centreX = current.left + current.width / 2;
  const centreY = current.top + current.height / 2;
  const sign = direction === "down" ? 1 : -1;
  let nearestRowDistance = Infinity;
  let bestIndex = currentIndex;
  let bestHorizontal = Infinity;
  boxes.forEach((box, index) => {
    const rowDistance = sign * (box.top + box.height / 2 - centreY);
    if (rowDistance <= current.height / 2) return;
    const horizontal = Math.abs(box.left + box.width / 2 - centreX);
    // Prefer the closest row; within a row (same top within a few pixels), the closest column.
    if (rowDistance < nearestRowDistance - 4 || (Math.abs(rowDistance - nearestRowDistance) <= 4 && horizontal < bestHorizontal)) {
      nearestRowDistance = Math.min(nearestRowDistance, rowDistance);
      bestIndex = index;
      bestHorizontal = horizontal;
    }
  });
  return bestIndex;
}
