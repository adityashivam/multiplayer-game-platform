import { EDGEOUT_ARENA } from "./config.js";

/**
 * @typedef {object} EdgeoutArena
 * @property {number} intactRings Rings still standing, counting the centre tile; zero means no floor.
 * @property {number} warningRing Ring index about to fall, or -1.
 * @property {number} warningRemainingSec Seconds until the warned ring falls.
 * @property {number} collapseSerial Rings collapsed this round; a presentation identity.
 * @typedef {{id:number,x:number,z:number,width:number,depth:number,topY:number,thickness:number,vx:number,vy:number,vz:number}} EdgeoutPlatform
 * @typedef {{column:number,row:number,ring:number,x:number,z:number}} EdgeoutTile
 */

/** One stable support ID: shrinking never swaps support under a fighter who is still inside. */
const ARENA_PLATFORM_ID = 1;
const NO_PLATFORMS = Object.freeze([]);
/** @type {Map<number,ReadonlyArray<Readonly<EdgeoutPlatform>>>} */
const platformCache = new Map();

/** @returns {EdgeoutArena} A full arena with no warning. */
export function createEdgeoutArena() {
  return {
    intactRings: EDGEOUT_ARENA.rings,
    warningRing: -1,
    warningRemainingSec: 0,
    collapseSerial: 0,
  };
}

/**
 * Half the side length of the standing floor. Rings collapse outside-in, so the
 * remaining floor is always one centred square.
 * @param {number} intactRings
 * @returns {number} World units; zero when the floor is gone.
 */
export function getEdgeoutArenaHalfExtent(intactRings) {
  return intactRings > 0 ? EDGEOUT_ARENA.tileSize * (intactRings - 0.5) : 0;
}

/**
 * Shared, frozen kinematic platforms for the standing floor. Cached per ring
 * count so simulation steps allocate nothing; callers must not mutate them.
 * @param {number} intactRings
 * @returns {ReadonlyArray<Readonly<EdgeoutPlatform>>}
 */
export function getEdgeoutArenaPlatforms(intactRings) {
  if (!(intactRings > 0)) return NO_PLATFORMS;
  let platforms = platformCache.get(intactRings);
  if (!platforms) {
    const width = getEdgeoutArenaHalfExtent(intactRings) * 2;
    platforms = Object.freeze([Object.freeze({
      id: ARENA_PLATFORM_ID,
      x: 0,
      z: 0,
      width,
      depth: width,
      topY: 0,
      thickness: EDGEOUT_ARENA.tileThickness,
      vx: 0,
      vy: 0,
      vz: 0,
    })]);
    platformCache.set(intactRings, platforms);
  }
  return platforms;
}

/**
 * Round time at which the given collapse happens. Collapse one removes the
 * outer ring; the last collapse removes the centre tile.
 * @param {number} collapseNumber One-based collapse index.
 * @returns {number} Seconds of round play.
 */
export function getEdgeoutCollapseTimeSec(collapseNumber) {
  return EDGEOUT_ARENA.firstCollapseSec + (collapseNumber - 1) * EDGEOUT_ARENA.collapseIntervalSec;
}

/**
 * Derive the arena from elapsed round time. The schedule is deterministic, so
 * browser and server agree without extra state. Mutates the supplied arena.
 * @param {EdgeoutArena} arena
 * @param {number} roundTimeSec
 * @returns {boolean} True when a ring fell during this update.
 */
export function updateEdgeoutArena(arena, roundTimeSec) {
  let collapsedRings = 0;
  while (collapsedRings < EDGEOUT_ARENA.rings && roundTimeSec >= getEdgeoutCollapseTimeSec(collapsedRings + 1)) collapsedRings += 1;

  const collapsedNow = collapsedRings > arena.collapseSerial;
  arena.collapseSerial = collapsedRings;
  arena.intactRings = EDGEOUT_ARENA.rings - collapsedRings;
  arena.warningRing = -1;
  arena.warningRemainingSec = 0;
  if (arena.intactRings > 0) {
    const remainingSec = getEdgeoutCollapseTimeSec(collapsedRings + 1) - roundTimeSec;
    if (remainingSec <= EDGEOUT_ARENA.warningSec) {
      arena.warningRing = arena.intactRings - 1;
      arena.warningRemainingSec = remainingSec;
    }
  }
  return collapsedNow;
}

/**
 * Floor a fighter can safely stand on: a warned ring counts as already gone.
 * @param {Readonly<EdgeoutArena>} arena
 * @returns {number} Half extent in world units.
 */
export function getEdgeoutSafeHalfExtent(arena) {
  return getEdgeoutArenaHalfExtent(arena.warningRing >= 0 ? arena.intactRings - 1 : arena.intactRings);
}

/**
 * Every tile of the full grid with its ring index (Chebyshev distance from the
 * centre). Pure layout for renderers; a new owned array per call.
 * @returns {EdgeoutTile[]}
 */
export function listEdgeoutTiles() {
  const tiles = [];
  const maxRing = EDGEOUT_ARENA.rings - 1;
  for (let row = -maxRing; row <= maxRing; row += 1) {
    for (let column = -maxRing; column <= maxRing; column += 1) {
      tiles.push({
        column,
        row,
        ring: Math.max(Math.abs(column), Math.abs(row)),
        x: column * EDGEOUT_ARENA.tileSize,
        z: row * EDGEOUT_ARENA.tileSize,
      });
    }
  }
  return tiles;
}
