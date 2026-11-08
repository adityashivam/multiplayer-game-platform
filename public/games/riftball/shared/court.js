import { RIFTBALL_COURT } from "./config.js";

/** @typedef {import("../../../platform/shared/sphereBody.js").SphereSolid} SphereSolid */
/** @typedef {import("../../../platform/shared/kinematicCharacter.js").KinematicPlatform} KinematicPlatform */

const WALL_THICKNESS = 0.8;
const { halfWidth, halfLength, wallHeight, goalHalfWidth, goalHeight, goalDepth } = RIFTBALL_COURT;

/** @type {ReadonlyArray<Readonly<KinematicPlatform>>} */
export const RIFTBALL_FLOOR_PLATFORMS = Object.freeze([Object.freeze({
  id: 1, x: 0, z: 0, width: halfWidth * 2 + 8, depth: (halfLength + goalDepth) * 2 + 8,
  topY: 0, thickness: 1, vx: 0, vy: 0, vz: 0,
})]);

/**
 * The goal mouth is real geometry: end-wall wings and crossbar surround an
 * opening, with side walls and a back wall behind it. Rendering shares these
 * dimensions; the ball controller receives only ordinary static solids.
 * @returns {ReadonlyArray<Readonly<SphereSolid>>}
 */
function createRiftballCourtSolids() {
  const solids = [
    { minX: -halfWidth - WALL_THICKNESS, maxX: -halfWidth, minY: 0, maxY: wallHeight, minZ: -halfLength - WALL_THICKNESS, maxZ: halfLength + WALL_THICKNESS },
    { minX: halfWidth, maxX: halfWidth + WALL_THICKNESS, minY: 0, maxY: wallHeight, minZ: -halfLength - WALL_THICKNESS, maxZ: halfLength + WALL_THICKNESS },
    { minX: -halfWidth - WALL_THICKNESS, maxX: halfWidth + WALL_THICKNESS, minY: wallHeight, maxY: wallHeight + WALL_THICKNESS, minZ: -halfLength - goalDepth, maxZ: halfLength + goalDepth },
  ];
  for (const side of [-1, 1]) {
    const nearZ = side * halfLength;
    const outerZ = side * (halfLength + WALL_THICKNESS);
    const backZ = side * (halfLength + goalDepth);
    const backOuterZ = side * (halfLength + goalDepth + WALL_THICKNESS);
    const minZ = Math.min(nearZ, outerZ);
    const maxZ = Math.max(nearZ, outerZ);
    solids.push(
      { minX: -halfWidth, maxX: -goalHalfWidth, minY: 0, maxY: wallHeight, minZ, maxZ },
      { minX: goalHalfWidth, maxX: halfWidth, minY: 0, maxY: wallHeight, minZ, maxZ },
      { minX: -goalHalfWidth, maxX: goalHalfWidth, minY: goalHeight, maxY: wallHeight, minZ, maxZ },
      { minX: -goalHalfWidth - WALL_THICKNESS, maxX: -goalHalfWidth, minY: 0, maxY: goalHeight, minZ: Math.min(nearZ, backZ), maxZ: Math.max(nearZ, backZ) },
      { minX: goalHalfWidth, maxX: goalHalfWidth + WALL_THICKNESS, minY: 0, maxY: goalHeight, minZ: Math.min(nearZ, backZ), maxZ: Math.max(nearZ, backZ) },
      { minX: -goalHalfWidth, maxX: goalHalfWidth, minY: goalHeight, maxY: goalHeight + WALL_THICKNESS, minZ: Math.min(nearZ, backZ), maxZ: Math.max(nearZ, backZ) },
      { minX: -goalHalfWidth - WALL_THICKNESS, maxX: goalHalfWidth + WALL_THICKNESS, minY: 0, maxY: goalHeight + WALL_THICKNESS, minZ: Math.min(backZ, backOuterZ), maxZ: Math.max(backZ, backOuterZ) },
    );
  }
  return Object.freeze(solids.map((solid) => Object.freeze(solid)));
}

export const RIFTBALL_COURT_SOLIDS = createRiftballCourtSolids();
