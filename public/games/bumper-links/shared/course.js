import {
  BUMPER_LINKS_BALL_SETTINGS,
  BUMPER_LINKS_COURSE,
  BUMPER_LINKS_SWEEPER,
} from "./config.js";

/** @typedef {import("../../../platform/shared/sphereBody.js").SphereSolid} SphereSolid */
/** @typedef {import("./config.js").BumperLinksTileKind} BumperLinksTileKind */
/** @typedef {import("./config.js").BumperLinksTileFeature} BumperLinksTileFeature */
/**
 * One green tile. `entry` and `exit` are direction indexes (see DIRECTIONS)
 * of travel into and out of the tile; -1 at the tee and the cup.
 * @typedef {{col:number,row:number,kind:BumperLinksTileKind,feature:BumperLinksTileFeature,height:number,entry:number,exit:number,openSide:number}} BumperLinksTile
 * @typedef {{x:number,y:number,z:number,phase:number}} BumperLinksSweeper
 * @typedef {{x:number,y:number,z:number}} BumperLinksPoint
 * @typedef {object} BumperLinksCourse
 * @property {number} seed
 * @property {BumperLinksTile[]} tiles In play order, tee first.
 * @property {SphereSolid[]} solids Every static box: floors, rails and posts.
 * @property {BumperLinksPoint} tee Centre of a ball resting at the back of the tee.
 * @property {number} teeYaw Heading from the tee towards the next tile.
 * @property {BumperLinksPoint} cup Cup centre at green height.
 * @property {BumperLinksSweeper[]} sweepers
 * @property {{x:number,z:number}[]} path Tile centres in order, ending at the cup.
 * @property {{minX:number,maxX:number,minZ:number,maxZ:number}} bounds
 * @property {number} waterY Balls below this height have splashed.
 * @property {Map<string,SphereSolid[]>} [cells] Solids near each grid cell; absent on hand-built test courses.
 */

/** Travel directions as grid steps; index 0 heads along +Z (yaw 0). */
const DIRECTIONS = Object.freeze([
  Object.freeze({ col: 0, row: 1 }),
  Object.freeze({ col: 1, row: 0 }),
  Object.freeze({ col: 0, row: -1 }),
  Object.freeze({ col: -1, row: 0 }),
]);

/** Small deterministic PRNG so the browser and server build identical holes. */
export function createBumperLinksRandom(seed) {
  let value = seed >>> 0;
  return function nextBumperLinksRandom() {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Wrap a heading into [-PI, PI], the range the input schema accepts.
 * @param {number} yaw
 */
export function wrapBumperLinksYaw(yaw) {
  return Math.atan2(Math.sin(yaw), Math.cos(yaw));
}

/** @param {number} direction Index into DIRECTIONS. */
export function getBumperLinksDirectionYaw(direction) {
  return wrapBumperLinksYaw((direction * Math.PI) / 2);
}

/** @param {number} col @param {number} row */
function cellKey(col, row) {
  return `${col},${row}`;
}

/**
 * Seeded walk that never revisits or touches an earlier tile except its
 * predecessor, so every rail belongs to exactly one tile.
 * @param {()=>number} random
 * @param {number} tileCount
 * @returns {{col:number,row:number}[]|null}
 */
function walkBumperLinksCells(random, tileCount) {
  const cells = [{ col: 0, row: 0 }];
  const occupied = new Set([cellKey(0, 0)]);
  let direction = 0;
  while (cells.length < tileCount) {
    const current = cells.at(-1);
    const turns = random() < 0.55 ? [0, 1, -1] : random() < 0.5 ? [1, -1, 0] : [-1, 1, 0];
    let placed = false;
    for (const turn of turns) {
      const nextDirection = (direction + turn + 4) % 4;
      const col = current.col + DIRECTIONS[nextDirection].col;
      const row = current.row + DIRECTIONS[nextDirection].row;
      if (occupied.has(cellKey(col, row))) continue;
      const touchesEarlier = DIRECTIONS.some((step) => {
        const key = cellKey(col + step.col, row + step.row);
        return key !== cellKey(current.col, current.row) && occupied.has(key);
      });
      if (touchesEarlier) continue;
      cells.push({ col, row });
      occupied.add(cellKey(col, row));
      direction = nextDirection;
      placed = true;
      break;
    }
    if (!placed) return null;
  }
  return cells;
}

/** @param {{col:number,row:number}} from @param {{col:number,row:number}} to */
function findDirection(from, to) {
  return DIRECTIONS.findIndex((step) => from.col + step.col === to.col && from.row + step.row === to.row);
}

/**
 * Assign kinds, heights and features along the walk.
 * @param {()=>number} random
 * @param {{col:number,row:number}[]} cells
 * @returns {BumperLinksTile[]}
 */
function describeBumperLinksTiles(random, cells) {
  const settings = BUMPER_LINKS_COURSE;
  const lastIndex = cells.length - 1;
  let height = 0;
  let drops = 0;
  let sweepers = 0;
  return cells.map((cell, index) => {
    const entry = index > 0 ? findDirection(cells[index - 1], cell) : -1;
    const exit = index < lastIndex ? findDirection(cell, cells[index + 1]) : -1;
    /** @type {BumperLinksTileKind} */
    let kind = "straight";
    if (index === 0) kind = "tee";
    else if (index === lastIndex) kind = "cup";
    else if (entry !== exit) kind = "corner";

    /** @type {BumperLinksTileFeature} */
    let feature = "none";
    const middle = index > 0 && index < lastIndex;
    if (middle && index >= 2 && drops < settings.maxDrops && random() < settings.dropChance) {
      feature = "drop";
      drops += 1;
      height -= settings.dropHeight;
    } else if (middle && kind === "straight" && sweepers === 0 && random() < settings.sweeperChance) {
      feature = "sweeper";
      sweepers += 1;
    } else if (middle && random() < settings.bumperChance) {
      feature = "bumpers";
    }

    let openSide = -1;
    if (kind === "straight" && feature !== "sweeper" && random() < settings.openRailChance) {
      openSide = (exit + (random() < 0.5 ? 1 : 3)) % 4;
    }
    return { col: cell.col, row: cell.row, kind, feature, height: Math.round(height * 1000) / 1000, entry, exit, openSide };
  });
}

/**
 * @param {number} centreX @param {number} centreZ @param {number} side
 * @param {number} height @returns {SphereSolid}
 */
function createRailSolid(centreX, centreZ, side, height) {
  const half = BUMPER_LINKS_COURSE.tileSize / 2;
  const thickness = BUMPER_LINKS_COURSE.railThickness;
  const minY = height;
  const maxY = height + BUMPER_LINKS_COURSE.railHeight;
  if (side === 0) return { minX: centreX - half, maxX: centreX + half, minY, maxY, minZ: centreZ + half - thickness, maxZ: centreZ + half };
  if (side === 2) return { minX: centreX - half, maxX: centreX + half, minY, maxY, minZ: centreZ - half, maxZ: centreZ - half + thickness };
  if (side === 1) return { minX: centreX + half - thickness, maxX: centreX + half, minY, maxY, minZ: centreZ - half, maxZ: centreZ + half };
  return { minX: centreX - half, maxX: centreX - half + thickness, minY, maxY, minZ: centreZ - half, maxZ: centreZ + half };
}

/** @param {number} x @param {number} z @param {number} size @param {number} height @param {number} baseY */
function createPostSolid(x, z, size, height, baseY) {
  return { minX: x - size / 2, maxX: x + size / 2, minY: baseY, maxY: baseY + height, minZ: z - size / 2, maxZ: z + size / 2 };
}

/**
 * Bumper posts kept apart so a ball always fits between them.
 * @param {()=>number} random @param {number} centreX @param {number} centreZ @param {number} height
 * @returns {SphereSolid[]}
 */
function createBumperPosts(random, centreX, centreZ, height) {
  const settings = BUMPER_LINKS_COURSE;
  const count = 2 + Math.floor(random() * 2);
  /** @type {{x:number,z:number}[]} */
  const placed = [];
  for (let attempt = 0; attempt < 24 && placed.length < count; attempt += 1) {
    const x = centreX + (random() * 2 - 1) * 1.1;
    const z = centreZ + (random() * 2 - 1) * 1.1;
    if (placed.every((post) => Math.hypot(post.x - x, post.z - z) > 1.1)) placed.push({ x, z });
  }
  return placed.map((post) => createPostSolid(post.x, post.z, settings.postSize, settings.postHeight, height));
}

/**
 * Build one hole's static geometry from a seed. Pure and deterministic, so
 * clients rebuild it from the snapshot's seed instead of receiving boxes.
 * @param {number} seed Any integer.
 * @returns {BumperLinksCourse}
 */
export function createBumperLinksCourse(seed) {
  const settings = BUMPER_LINKS_COURSE;
  const random = createBumperLinksRandom(seed);
  const tileCount = settings.minTiles + Math.floor(random() * (settings.maxTiles - settings.minTiles + 1));
  let cells = null;
  for (let attempt = 0; attempt < settings.walkAttempts && !cells; attempt += 1) {
    cells = walkBumperLinksCells(random, tileCount);
  }
  cells ??= Array.from({ length: tileCount }, (_unused, row) => ({ col: 0, row }));
  const tiles = describeBumperLinksTiles(random, cells);

  const size = settings.tileSize;
  const radius = BUMPER_LINKS_BALL_SETTINGS.radius;
  /** @type {SphereSolid[]} */
  const solids = [];
  /** @type {BumperLinksSweeper[]} */
  const sweepers = [];
  /** @type {Map<string,SphereSolid[]>} */
  const cellsIndex = new Map();
  const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };

  for (const tile of tiles) {
    const centreX = tile.col * size;
    const centreZ = tile.row * size;
    /** @type {SphereSolid[]} */
    const tileSolids = [{
      minX: centreX - size / 2, maxX: centreX + size / 2,
      minY: tile.height - settings.floorThickness, maxY: tile.height,
      minZ: centreZ - size / 2, maxZ: centreZ + size / 2,
    }];
    const connected = new Set([tile.exit, tile.entry === -1 ? -1 : (tile.entry + 2) % 4]);
    for (let side = 0; side < 4; side += 1) {
      if (connected.has(side) || side === tile.openSide) continue;
      tileSolids.push(createRailSolid(centreX, centreZ, side, tile.height));
    }
    if (tile.feature === "bumpers") tileSolids.push(...createBumperPosts(random, centreX, centreZ, tile.height));
    if (tile.feature === "sweeper") {
      sweepers.push({ x: centreX, y: tile.height, z: centreZ, phase: random() * Math.PI * 2 });
      tileSolids.push(createPostSolid(centreX, centreZ, 0.3, settings.postHeight, tile.height));
    }
    solids.push(...tileSolids);
    for (const step of [{ col: 0, row: 0 }, ...DIRECTIONS, { col: 1, row: 1 }, { col: 1, row: -1 }, { col: -1, row: 1 }, { col: -1, row: -1 }]) {
      const key = cellKey(tile.col + step.col, tile.row + step.row);
      if (!cellsIndex.has(key)) cellsIndex.set(key, []);
      cellsIndex.get(key).push(...tileSolids);
    }
    bounds.minX = Math.min(bounds.minX, centreX - size / 2);
    bounds.maxX = Math.max(bounds.maxX, centreX + size / 2);
    bounds.minZ = Math.min(bounds.minZ, centreZ - size / 2);
    bounds.maxZ = Math.max(bounds.maxZ, centreZ + size / 2);
  }

  const teeTile = tiles[0];
  const cupTile = tiles.at(-1);
  const teeStep = DIRECTIONS[teeTile.exit];
  const cupStep = DIRECTIONS[cupTile.entry];
  const tee = { x: teeTile.col * size - teeStep.col * 0.8, y: teeTile.height + radius, z: teeTile.row * size - teeStep.row * 0.8 };
  const cup = { x: cupTile.col * size + cupStep.col * 0.6, y: cupTile.height, z: cupTile.row * size + cupStep.row * 0.6 };
  const path = tiles.slice(0, -1).map((tile) => ({ x: tile.col * size, z: tile.row * size }));
  path.push({ x: cup.x, z: cup.z });

  return {
    seed,
    tiles,
    solids,
    tee,
    teeYaw: getBumperLinksDirectionYaw(teeTile.exit),
    cup,
    sweepers,
    path,
    bounds,
    waterY: Math.min(...tiles.map((tile) => tile.height)) - settings.waterDepth,
    cells: cellsIndex,
  };
}

/**
 * Fill `out` with the solids that can touch a ball near (x, z). Off the
 * course the list is empty and the ball falls to the water.
 * @param {Readonly<BumperLinksCourse>} course
 * @param {number} x @param {number} z
 * @param {SphereSolid[]} out Reused by the caller; cleared first.
 * @returns {SphereSolid[]} `out`.
 */
export function listBumperLinksNearbySolids(course, x, z, out) {
  out.length = 0;
  if (!course.cells) {
    for (const solid of course.solids) out.push(solid);
    return out;
  }
  const size = BUMPER_LINKS_COURSE.tileSize;
  const nearby = course.cells.get(cellKey(Math.round(x / size), Math.round(z / size)));
  if (nearby) for (const solid of nearby) out.push(solid);
  return out;
}

/**
 * Distance left to the cup along the course path from the closest point on
 * it, plus a small share of the sideways offset so balls near a rail rank
 * below balls on the line.
 * @param {Readonly<BumperLinksCourse>} course
 * @param {number} x @param {number} z
 * @returns {number} Metres; 0 at the cup.
 */
export function measureBumperLinksRemainingPath(course, x, z) {
  const path = course.path;
  if (path.length === 1) return Math.hypot(path[0].x - x, path[0].z - z);
  let best = Infinity;
  let tailLength = 0;
  for (let index = path.length - 2; index >= 0; index -= 1) {
    const start = path[index];
    const end = path[index + 1];
    const segmentX = end.x - start.x;
    const segmentZ = end.z - start.z;
    const lengthSq = segmentX * segmentX + segmentZ * segmentZ;
    const along = lengthSq > 0 ? Math.max(0, Math.min(1, ((x - start.x) * segmentX + (z - start.z) * segmentZ) / lengthSq)) : 0;
    const closestX = start.x + segmentX * along;
    const closestZ = start.z + segmentZ * along;
    const sideways = Math.hypot(x - closestX, z - closestZ);
    const remaining = Math.sqrt(lengthSq) * (1 - along) + tailLength + sideways * 0.3;
    if (sideways < 2.4 && remaining < best) best = remaining;
    tailLength += Math.sqrt(lengthSq);
  }
  if (best === Infinity) {
    const cup = path.at(-1);
    return tailLength + Math.hypot(cup.x - x, cup.z - z);
  }
  return best;
}

/**
 * Current bar of a sweeper, centred on its pivot.
 * @param {Readonly<BumperLinksSweeper>} sweeper
 * @param {number} timeSec Hole clock.
 * @param {{ax:number,az:number,bx:number,bz:number,angle:number}} out
 * @returns {{ax:number,az:number,bx:number,bz:number,angle:number}} `out`.
 */
export function getBumperLinksSweeperSegment(sweeper, timeSec, out) {
  const angle = sweeper.phase + BUMPER_LINKS_SWEEPER.angularSpeed * timeSec;
  const halfLength = BUMPER_LINKS_SWEEPER.length / 2;
  const dirX = Math.sin(angle) * halfLength;
  const dirZ = Math.cos(angle) * halfLength;
  out.ax = sweeper.x - dirX;
  out.az = sweeper.z - dirZ;
  out.bx = sweeper.x + dirX;
  out.bz = sweeper.z + dirZ;
  out.angle = angle;
  return out;
}
