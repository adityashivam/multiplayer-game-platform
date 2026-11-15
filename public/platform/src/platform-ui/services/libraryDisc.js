/**
 * Geometry for the portrait "disc" library: game names sit on the rim of a
 * large disc whose curved edge faces left and whose hub lies off to the
 * right, so names read inward from the rim. The selected game rests at the
 * leftmost point; neighbours follow the curve, shrink and fade.
 */

/** Degrees between neighbouring names, the widest visible angle, and the rim's inset from the left edge. */
export const LIBRARY_DISC = Object.freeze({ stepDeg: 12, maxVisibleDeg: 64, rimInsetPx: 26 });

/** @typedef {{radius:number,centerX:number,centerY:number,maxAngleDeg:number}} LibraryDiscGeometry */
/** @typedef {{visible:boolean,x:number,y:number,angleDeg:number,scale:number,opacity:number}} LibraryDiscPlacement */

/**
 * Size the disc for its column: a radius that grows with the height, the
 * hub placed so the rim sits just inside the left edge, and the widest
 * angle whose names still fit vertically.
 * @param {{width:number,height:number}} box The disc column in pixels.
 * @returns {LibraryDiscGeometry}
 */
export function readLibraryDiscGeometry({ width, height }) {
  const radius = Math.min(460, Math.max(240, height * 0.62, width * 1.6));
  const centerY = height / 2;
  const fitAngle = Math.asin(Math.min(1, Math.max(0, centerY - 14) / radius)) * (180 / Math.PI);
  return {
    radius,
    centerX: radius + LIBRARY_DISC.rimInsetPx,
    centerY,
    maxAngleDeg: Math.min(LIBRARY_DISC.maxVisibleDeg, fitAngle),
  };
}

/**
 * Where a name sits for a given offset from the disc's current position.
 * @param {number} offset Item index minus the (possibly fractional) disc position.
 * @param {LibraryDiscGeometry} geometry
 * @returns {LibraryDiscPlacement}
 */
export function placeLibraryDiscItem(offset, geometry) {
  const angleDeg = offset * LIBRARY_DISC.stepDeg;
  if (Math.abs(angleDeg) > geometry.maxAngleDeg) return { visible: false, x: 0, y: 0, angleDeg, scale: 0, opacity: 0 };
  const radians = angleDeg * (Math.PI / 180);
  const distance = Math.min(Math.abs(offset), 4);
  return {
    visible: true,
    x: geometry.centerX - geometry.radius * Math.cos(radians),
    y: geometry.centerY + geometry.radius * Math.sin(radians),
    // Names read inward toward the hub, so they turn against the rim angle.
    angleDeg: 0 - angleDeg,
    scale: 1.1 - distance * 0.07,
    // Neighbours stay readable; only names far round the rim fade to 40%.
    opacity: 1 - Math.min(Math.abs(offset) / 5.5, 0.6),
  };
}

/** @param {number} index @param {number} count @returns {number} */
export function clampLibraryDiscIndex(index, count) {
  return Math.max(0, Math.min(Math.max(0, count - 1), index));
}

/**
 * Where the disc rests after a drag or flick: the nearest game, carried a
 * little further by the release speed.
 * @param {number} position Fractional disc position when released.
 * @param {number} velocity Items per second, positive toward later games.
 * @param {number} count
 * @returns {number}
 */
export function settleLibraryDiscIndex(position, velocity, count) {
  const carry = Math.max(-4, Math.min(4, velocity * 0.22));
  return clampLibraryDiscIndex(Math.round(position + carry), count);
}
