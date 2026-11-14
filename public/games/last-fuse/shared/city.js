import { LAST_FUSE_CITY } from "./config.js";

/**
 * One building. Its roof is a kinematic platform whose thickness reaches the
 * street, so walls block runners instead of letting them clip inside.
 * @typedef {object} LastFuseRoof
 * @property {number} id Positive support ID; also the bit `1 << (id - 1)` in collapse masks.
 * @property {number} column
 * @property {number} row
 * @property {number} x
 * @property {number} z
 * @property {number} width
 * @property {number} depth
 * @property {number} topY
 * @property {number[]} neighborIds Roofs reachable with one jump.
 */
/**
 * A deterministic city for one seed. Shared and frozen; callers must not
 * mutate it.
 * @typedef {object} LastFuseCityLayout
 * @property {number} seed
 * @property {readonly LastFuseRoof[]} roofs Indexed by `id - 1`.
 * @property {readonly number[]} spawnRoofIds Far-apart roofs in slot order.
 */
/**
 * Per-round city state carried in snapshots.
 * @typedef {object} LastFuseCityState
 * @property {number} seed Layout seed for this round.
 * @property {number} collapsedMask Bit per collapsed roof.
 * @property {number} crumblingRoofId Roof about to fall, or zero.
 * @property {number} crumbleRemainingSec
 * @property {number} collapseSerial Collapses this round; a presentation identity.
 */
/**
 * @typedef {{id:number,x:number,z:number,width:number,depth:number,topY:number,thickness:number,vx:number,vy:number,vz:number}} LastFusePlatform
 */

const MAX_CACHED_LAYOUTS = 8;
const MIN_SIDE_OVERLAP_M = 2;
const NO_PLATFORMS = Object.freeze([]);
/** @type {Map<number,LastFuseCityLayout>} */
const layoutCache = new Map();
/** @type {Map<string,ReadonlyArray<Readonly<LastFusePlatform>>>} */
const platformCache = new Map();
const MAX_CACHED_PLATFORM_SETS = 64;

/**
 * Mulberry32 step on a one-element state array.
 * @param {Uint32Array} state
 * @returns {number} A value in [0, 1).
 */
function nextCityRandom(state) {
  state[0] = (state[0] + 0x6d2b79f5) >>> 0;
  let mixed = state[0];
  mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
  mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
  return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
}

/**
 * Edge gap and side overlap between two roofs along one axis.
 * @param {LastFuseRoof} first
 * @param {LastFuseRoof} second
 * @param {"x"|"z"} axis
 */
function measureRoofGap(first, second, axis) {
  const along = axis === "x" ? "width" : "depth";
  const across = axis === "x" ? "depth" : "width";
  const acrossAxis = axis === "x" ? "z" : "x";
  const gap = Math.abs(second[axis] - first[axis]) - (first[along] + second[along]) / 2;
  const overlap = Math.min(first[acrossAxis] + first[across] / 2, second[acrossAxis] + second[across] / 2) -
    Math.max(first[acrossAxis] - first[across] / 2, second[acrossAxis] - second[across] / 2);
  return { gap, overlap };
}

/** @param {LastFuseRoof} first @param {LastFuseRoof} second @param {"x"|"z"} axis */
function canJumpBetweenRoofs(first, second, axis) {
  const { gap, overlap } = measureRoofGap(first, second, axis);
  return gap <= LAST_FUSE_CITY.maxJumpGap && overlap >= MIN_SIDE_OVERLAP_M &&
    Math.abs(second.topY - first.topY) <= LAST_FUSE_CITY.maxJumpRise;
}

/**
 * Link orthogonal neighbours that one jump can cross, then check every roof
 * is reachable from every other.
 * @param {LastFuseRoof[]} roofs
 * @returns {boolean} True when the city is connected.
 */
function linkRoofs(roofs) {
  const { columns, rows } = LAST_FUSE_CITY;
  for (const roof of roofs) {
    roof.neighborIds = [];
    const candidates = [[1, 0, "x"], [-1, 0, "x"], [0, 1, "z"], [0, -1, "z"]];
    for (const [columnStep, rowStep, axis] of candidates) {
      const column = roof.column + columnStep;
      const row = roof.row + rowStep;
      if (column < 0 || row < 0 || column >= columns || row >= rows) continue;
      const neighbor = roofs[row * columns + column];
      if (canJumpBetweenRoofs(roof, neighbor, /** @type {"x"|"z"} */ (axis))) roof.neighborIds.push(neighbor.id);
    }
  }
  const visited = new Set([roofs[0].id]);
  const queue = [roofs[0]];
  while (queue.length > 0) {
    const roof = queue.shift();
    for (const neighborId of roof.neighborIds) {
      if (visited.has(neighborId)) continue;
      visited.add(neighborId);
      queue.push(roofs[neighborId - 1]);
    }
  }
  return visited.size === roofs.length;
}

/**
 * @param {Uint32Array|null} random Null builds the fallback grid with no jitter.
 * @returns {LastFuseRoof[]}
 */
function placeRoofs(random) {
  const { columns, rows, cellSize, minRoofSize, maxRoofSize, baseRoofHeight, heightSteps } = LAST_FUSE_CITY;
  const roofs = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const roll = () => (random ? nextCityRandom(random) : 0.5);
      const width = random ? minRoofSize + roll() * (maxRoofSize - minRoofSize) : maxRoofSize;
      const depth = random ? minRoofSize + roll() * (maxRoofSize - minRoofSize) : maxRoofSize;
      const jitterX = (roll() - 0.5) * (cellSize - width) * 0.3;
      const jitterZ = (roll() - 0.5) * (cellSize - depth) * 0.3;
      const step = random ? heightSteps[Math.floor(roll() * heightSteps.length)] : 0;
      roofs.push({
        id: roofs.length + 1,
        column,
        row,
        x: (column - (columns - 1) / 2) * cellSize + jitterX,
        z: (row - (rows - 1) / 2) * cellSize + jitterZ,
        width,
        depth,
        topY: baseRoofHeight + step,
        neighborIds: [],
      });
    }
  }
  return roofs;
}

/**
 * Corners first, then edge midpoints, then the centre: consecutive slots
 * start as far apart as the grid allows.
 * @returns {number[]}
 */
function listSpawnRoofIds() {
  const { columns, rows } = LAST_FUSE_CITY;
  const lastColumn = columns - 1;
  const lastRow = rows - 1;
  const middleColumn = Math.floor(lastColumn / 2);
  const middleRow = Math.floor(lastRow / 2);
  const cells = [
    [0, 0], [lastColumn, lastRow], [lastColumn, 0], [0, lastRow],
    [middleColumn, 0], [middleColumn, lastRow], [0, middleRow], [lastColumn, middleRow], [middleColumn, middleRow],
  ];
  return cells.map(([column, row]) => row * columns + column + 1);
}

/**
 * Build or reuse the city for a seed. Layouts that fail the jump check are
 * re-rolled; after too many tries a regular grid, which always passes, is used.
 * @param {number} seed Any integer.
 * @returns {LastFuseCityLayout}
 */
export function getLastFuseCityLayout(seed) {
  const key = seed >>> 0;
  const cached = layoutCache.get(key);
  if (cached) return cached;

  const random = new Uint32Array([(Math.imul(key, 2654435761) ^ 0x51ed270b) >>> 0]);
  let roofs = null;
  for (let attempt = 0; attempt < LAST_FUSE_CITY.layoutAttempts && !roofs; attempt += 1) {
    const candidate = placeRoofs(random);
    if (linkRoofs(candidate)) roofs = candidate;
  }
  if (!roofs) {
    roofs = placeRoofs(null);
    linkRoofs(roofs);
  }
  const layout = Object.freeze({
    seed: key,
    roofs: Object.freeze(roofs.map((roof) => Object.freeze({ ...roof, neighborIds: Object.freeze(roof.neighborIds) }))),
    spawnRoofIds: Object.freeze(listSpawnRoofIds()),
  });
  if (layoutCache.size >= MAX_CACHED_LAYOUTS) layoutCache.delete(layoutCache.keys().next().value);
  layoutCache.set(key, layout);
  return layout;
}

/** @param {number} mask @param {number} roofId @returns {boolean} */
export function isLastFuseRoofCollapsed(mask, roofId) {
  return ((mask >>> (roofId - 1)) & 1) === 1;
}

/** @param {number} seed @returns {LastFuseCityState} A full city for a new round. */
export function createLastFuseCityState(seed) {
  return { seed: seed >>> 0, collapsedMask: 0, crumblingRoofId: 0, crumbleRemainingSec: 0, collapseSerial: 0 };
}

/**
 * Shared, frozen platforms for the standing roofs. Cached per seed and
 * collapse mask so simulation steps allocate nothing; callers must not mutate
 * them.
 * @param {number} seed
 * @param {number} collapsedMask
 * @returns {ReadonlyArray<Readonly<LastFusePlatform>>}
 */
export function getLastFusePlatforms(seed, collapsedMask) {
  const key = `${seed >>> 0}:${collapsedMask}`;
  let platforms = platformCache.get(key);
  if (platforms) return platforms;
  const layout = getLastFuseCityLayout(seed);
  const standing = layout.roofs.filter((roof) => !isLastFuseRoofCollapsed(collapsedMask, roof.id));
  platforms = standing.length === 0 ? NO_PLATFORMS : Object.freeze(standing.map((roof) => Object.freeze({
    id: roof.id,
    x: roof.x,
    z: roof.z,
    width: roof.width,
    depth: roof.depth,
    topY: roof.topY,
    thickness: roof.topY,
    vx: 0,
    vy: 0,
    vz: 0,
  })));
  if (platformCache.size >= MAX_CACHED_PLATFORM_SETS) platformCache.delete(platformCache.keys().next().value);
  platformCache.set(key, platforms);
  return platforms;
}

/**
 * The standing roof under a point, or null.
 * @param {LastFuseCityLayout} layout
 * @param {number} collapsedMask
 * @param {number} x
 * @param {number} z
 * @param {number} [margin] Extra metres that still count as on the roof.
 * @returns {LastFuseRoof|null}
 */
export function findLastFuseRoofAt(layout, collapsedMask, x, z, margin = 0) {
  for (const roof of layout.roofs) {
    if (isLastFuseRoofCollapsed(collapsedMask, roof.id)) continue;
    if (Math.abs(x - roof.x) <= roof.width / 2 + margin && Math.abs(z - roof.z) <= roof.depth / 2 + margin) return roof;
  }
  return null;
}

/** @param {number} collapsedMask @param {number} roofCount @returns {number} */
export function countLastFuseStandingRoofs(collapsedMask, roofCount) {
  let standing = 0;
  for (let roofId = 1; roofId <= roofCount; roofId += 1) {
    if (!isLastFuseRoofCollapsed(collapsedMask, roofId)) standing += 1;
  }
  return standing;
}

/**
 * Choose the roof that crumbles after a blast: the one the blast hit when
 * possible, otherwise the standing roof farthest from the centre. Never
 * shrinks the city below its minimum.
 * @param {LastFuseCityLayout} layout
 * @param {LastFuseCityState} city
 * @param {number} blastX
 * @param {number} blastZ
 * @returns {number} Roof ID, or zero when nothing should fall.
 */
export function chooseLastFuseCrumblingRoof(layout, city, blastX, blastZ) {
  const standing = countLastFuseStandingRoofs(city.collapsedMask, layout.roofs.length);
  if (standing <= LAST_FUSE_CITY.minStandingRoofs) return 0;
  const hit = findLastFuseRoofAt(layout, city.collapsedMask, blastX, blastZ, 0.5);
  if (hit) return hit.id;
  let farthest = null;
  let farthestDistance = -1;
  for (const roof of layout.roofs) {
    if (isLastFuseRoofCollapsed(city.collapsedMask, roof.id)) continue;
    const distance = roof.x * roof.x + roof.z * roof.z;
    if (distance > farthestDistance) {
      farthest = roof;
      farthestDistance = distance;
    }
  }
  return farthest ? farthest.id : 0;
}

/**
 * Count down a warned roof and drop it when the warning ends.
 * Mutates the supplied city state.
 * @param {LastFuseCityState} city
 * @param {number} stepSec
 * @returns {boolean} True when a roof fell this step.
 */
export function stepLastFuseCity(city, stepSec) {
  if (city.crumblingRoofId === 0) return false;
  city.crumbleRemainingSec = Math.max(0, city.crumbleRemainingSec - stepSec);
  if (city.crumbleRemainingSec > 0) return false;
  city.collapsedMask = (city.collapsedMask | (1 << (city.crumblingRoofId - 1))) >>> 0;
  city.crumblingRoofId = 0;
  city.collapseSerial += 1;
  return true;
}
