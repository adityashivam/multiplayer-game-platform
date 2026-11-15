/**
 * Glide elements from where they were drawn to where a layout change put
 * them (FLIP), so a grid that gains or loses columns moves instead of jumping.
 *
 * Usage: `const before = captureLayoutBoxes(elements)`, change the layout,
 * then `morphFromLayoutBoxes(before, options)`. Capturing while an earlier
 * morph is still running records where the element is drawn mid-glide, so
 * rapid changes (a pinch, a slider drag) chain smoothly.
 */

/** @type {WeakMap<Element, Animation>} */
const runningMorphs = new WeakMap();

/**
 * @param {Iterable<Element>} elements
 * @returns {Map<Element, DOMRect>} Where each element is drawn right now.
 */
export function captureLayoutBoxes(elements) {
  const boxes = new Map();
  for (const element of elements) boxes.set(element, element.getBoundingClientRect());
  return boxes;
}

/**
 * Drop any running morphs so the next measurement sees the real layout.
 * @param {Iterable<Element>} elements
 */
export function settleLayoutMorphs(elements) {
  for (const element of elements) {
    runningMorphs.get(element)?.cancel();
    runningMorphs.delete(element);
  }
}

/** @param {DOMRect} box @param {DOMRect|undefined} viewport */
function isNearViewport(box, viewport) {
  if (!viewport) return true;
  const margin = viewport.height * 0.5;
  return box.bottom >= viewport.top - margin && box.top <= viewport.bottom + margin;
}

/**
 * Animate each element from its captured box to its current layout box.
 * Elements that barely moved, left the document, or stayed far from the
 * visible area snap instead, which bounds the work on long pages.
 * @param {Map<Element, DOMRect>} before From `captureLayoutBoxes`.
 * @param {{durationMs?:number,easing?:string,viewport?:DOMRect}} [options]
 * @returns {number} How many elements were animated.
 */
export function morphFromLayoutBoxes(before, { durationMs = 240, easing = "cubic-bezier(.22, 1, .36, 1)", viewport } = {}) {
  const connected = [...before.keys()].filter((element) => element.isConnected);
  settleLayoutMorphs(connected);

  // Read every box before writing any animation, so layout runs once.
  const moves = connected.map((element) => ({ element, from: before.get(element), to: element.getBoundingClientRect() }));
  let animated = 0;
  for (const { element, from, to } of moves) {
    if (!from || !to.width || !to.height) continue;
    if (!isNearViewport(from, viewport) && !isNearViewport(to, viewport)) continue;
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    const sx = from.width / to.width;
    const sy = from.height / to.height;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(sx - 1) < 0.005 && Math.abs(sy - 1) < 0.005) continue;
    const morph = element.animate(
      [
        { transformOrigin: "0 0", transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` },
        { transformOrigin: "0 0", transform: "none" },
      ],
      { duration: durationMs, easing },
    );
    runningMorphs.set(element, morph);
    morph.addEventListener?.("finish", () => {
      if (runningMorphs.get(element) === morph) runningMorphs.delete(element);
    });
    animated += 1;
  }
  return animated;
}
