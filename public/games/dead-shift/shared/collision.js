import { DEAD_SHIFT_ARENA, DEAD_SHIFT_COLLIDERS } from "./config.js";

const COLLISION_EPSILON = 0.0001;

/** @param {number} value @param {number} minimum @param {number} maximum */
export function clampDeadShiftNumber(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

/**
 * Push a vertical body out of world boxes. The body's position is mutated.
 * @param {{x: number,y?: number,z: number}} body
 * @param {number} radius
 * @param {number} [height]
 */
export function constrainDeadShiftBody(body, radius, height = 1.8) {
  for (let pass = 0; pass < 3; pass += 1) {
    body.x = clampDeadShiftNumber(body.x, -DEAD_SHIFT_ARENA.halfWidth + radius, DEAD_SHIFT_ARENA.halfWidth - radius);
    body.z = clampDeadShiftNumber(body.z, -DEAD_SHIFT_ARENA.halfDepth + radius, DEAD_SHIFT_ARENA.halfDepth - radius);
    for (const collider of DEAD_SHIFT_COLLIDERS) {
      if ((body.y || 0) >= collider.height || (body.y || 0) + height <= 0) continue;
      const minX = collider.x - collider.width / 2;
      const maxX = collider.x + collider.width / 2;
      const minZ = collider.z - collider.depth / 2;
      const maxZ = collider.z + collider.depth / 2;
      const nearestX = clampDeadShiftNumber(body.x, minX, maxX);
      const nearestZ = clampDeadShiftNumber(body.z, minZ, maxZ);
      const deltaX = body.x - nearestX;
      const deltaZ = body.z - nearestZ;
      const distance = Math.hypot(deltaX, deltaZ);
      if (distance >= radius) continue;
      if (distance > COLLISION_EPSILON) {
        const correction = (radius - distance + COLLISION_EPSILON) / distance;
        body.x += deltaX * correction;
        body.z += deltaZ * correction;
      } else {
        const distances = [body.x - minX, maxX - body.x, body.z - minZ, maxZ - body.z];
        const nearestSide = distances.indexOf(Math.min(...distances));
        if (nearestSide === 0) body.x = minX - radius - COLLISION_EPSILON;
        if (nearestSide === 1) body.x = maxX + radius + COLLISION_EPSILON;
        if (nearestSide === 2) body.z = minZ - radius - COLLISION_EPSILON;
        if (nearestSide === 3) body.z = maxZ + radius + COLLISION_EPSILON;
      }
    }
  }
}

/**
 * Subdivided horizontal movement avoids crossing thin cover during a long step.
 * @param {{x: number,y?: number,z: number}} body
 * @param {number} deltaX
 * @param {number} deltaZ
 * @param {number} radius
 * @param {number} [height]
 */
export function moveDeadShiftBody(body, deltaX, deltaZ, radius, height = 1.8) {
  const substeps = Math.max(1, Math.min(24, Math.ceil(Math.hypot(deltaX, deltaZ) / (radius * 0.5))));
  for (let index = 0; index < substeps; index += 1) {
    body.x += deltaX / substeps;
    constrainDeadShiftBody(body, radius, height);
    body.z += deltaZ / substeps;
    constrainDeadShiftBody(body, radius, height);
  }
}

/**
 * Intersect a normalized ray with a box; return its first entry and face normal.
 * @param {{x:number,y:number,z:number}} origin
 * @param {{x:number,y:number,z:number}} direction
 * @param {{minX:number,maxX:number,minY:number,maxY:number,minZ:number,maxZ:number}} box
 * @param {number} maximumDistance
 * @returns {{distance:number,nx:number,ny:number,nz:number}|null}
 */
export function intersectDeadShiftBox(origin, direction, box, maximumDistance) {
  let entry = 0;
  let exit = maximumDistance;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (const axis of ["x", "y", "z"]) {
    const minimum = box[`min${axis.toUpperCase()}`];
    const maximum = box[`max${axis.toUpperCase()}`];
    const axisDirection = direction[axis];
    if (Math.abs(axisDirection) < 0.0000001) {
      if (origin[axis] < minimum || origin[axis] > maximum) return null;
      continue;
    }
    let near = (minimum - origin[axis]) / axisDirection;
    let far = (maximum - origin[axis]) / axisDirection;
    let normal = -1;
    if (near > far) {
      [near, far] = [far, near];
      normal = 1;
    }
    if (near > entry) {
      entry = near;
      nx = axis === "x" ? normal : 0;
      ny = axis === "y" ? normal : 0;
      nz = axis === "z" ? normal : 0;
    }
    exit = Math.min(exit, far);
    if (entry > exit) return null;
  }
  return entry <= maximumDistance && exit >= 0 ? { distance: Math.max(0, entry), nx, ny, nz } : null;
}

/**
 * Trace against cover, room walls, floor and ceiling. Padding sweeps a sphere.
 * @param {{x:number,y:number,z:number}} origin
 * @param {{x:number,y:number,z:number}} direction Unit direction.
 * @param {number} maximumDistance
 * @param {number} [padding]
 * @returns {{distance:number,nx:number,ny:number,nz:number}|null}
 */
export function traceDeadShiftWorld(origin, direction, maximumDistance, padding = 0) {
  let nearestHit = null;
  for (const collider of DEAD_SHIFT_COLLIDERS) {
    const colliderHit = intersectDeadShiftBox(origin, direction, {
      minX: collider.x - collider.width / 2 - padding,
      maxX: collider.x + collider.width / 2 + padding,
      minY: -padding,
      maxY: collider.height + padding,
      minZ: collider.z - collider.depth / 2 - padding,
      maxZ: collider.z + collider.depth / 2 + padding,
    }, maximumDistance);
    if (colliderHit && (!nearestHit || colliderHit.distance < nearestHit.distance)) nearestHit = colliderHit;
  }
  const boundaries = [
    { axis: "x", value: -DEAD_SHIFT_ARENA.halfWidth + padding, sign: -1, nx: 1, ny: 0, nz: 0 },
    { axis: "x", value: DEAD_SHIFT_ARENA.halfWidth - padding, sign: 1, nx: -1, ny: 0, nz: 0 },
    { axis: "y", value: padding, sign: -1, nx: 0, ny: 1, nz: 0 },
    { axis: "y", value: DEAD_SHIFT_ARENA.height - padding, sign: 1, nx: 0, ny: -1, nz: 0 },
    { axis: "z", value: -DEAD_SHIFT_ARENA.halfDepth + padding, sign: -1, nx: 0, ny: 0, nz: 1 },
    { axis: "z", value: DEAD_SHIFT_ARENA.halfDepth - padding, sign: 1, nx: 0, ny: 0, nz: -1 },
  ];
  for (const boundary of boundaries) {
    const axisVelocity = direction[boundary.axis];
    if (axisVelocity * boundary.sign <= 0) continue;
    const distance = (boundary.value - origin[boundary.axis]) / axisVelocity;
    if (distance >= 0 && distance <= maximumDistance && (!nearestHit || distance < nearestHit.distance)) {
      nearestHit = { distance, nx: boundary.nx, ny: boundary.ny, nz: boundary.nz };
    }
  }
  return nearestHit;
}

/** @param {{x:number,y:number,z:number}} origin @param {{x:number,y:number,z:number}} target @param {number} [padding] */
export function hasDeadShiftLineOfSight(origin, target, padding = 0) {
  const deltaX = target.x - origin.x;
  const deltaY = target.y - origin.y;
  const deltaZ = target.z - origin.z;
  const distance = Math.hypot(deltaX, deltaY, deltaZ);
  if (distance < 0.001) return true;
  const worldHit = traceDeadShiftWorld(origin, { x: deltaX / distance, y: deltaY / distance, z: deltaZ / distance }, distance, padding);
  return !worldHit || worldHit.distance >= distance - 0.001;
}

/**
 * A horizontal route clearance test uses expanded boxes instead of visual heights.
 * @param {{x:number,z:number}} start
 * @param {{x:number,z:number}} end
 * @param {number} radius
 */
export function hasDeadShiftWalkPath(start, end, radius) {
  const deltaX = end.x - start.x;
  const deltaZ = end.z - start.z;
  const distance = Math.hypot(deltaX, deltaZ);
  if (distance < 0.001) return true;
  const origin = { x: start.x, y: 0.1, z: start.z };
  const direction = { x: deltaX / distance, y: 0, z: deltaZ / distance };
  for (const collider of DEAD_SHIFT_COLLIDERS) {
    const colliderHit = intersectDeadShiftBox(origin, direction, {
      minX: collider.x - collider.width / 2 - radius,
      maxX: collider.x + collider.width / 2 + radius,
      minY: 0,
      maxY: 10,
      minZ: collider.z - collider.depth / 2 - radius,
      maxZ: collider.z + collider.depth / 2 + radius,
    }, distance);
    if (colliderHit && colliderHit.distance < distance - 0.001) return false;
  }
  return true;
}
