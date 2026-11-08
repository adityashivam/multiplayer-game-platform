import { DEAD_SHIFT_ARENA, DEAD_SHIFT_COLLIDERS, DEAD_SHIFT_ENEMY_TYPES } from "./config.js";
import { clampDeadShiftNumber, hasDeadShiftWalkPath } from "./collision.js";

/**
 * The route graph uses conservative square clearance; body collision has round
 * corners. Project either endpoint to the graph's free space so a player hugging
 * cover (or a crowd pushing an enemy into a corner) cannot make every route fail.
 * The small goal offset remains inside each enemy's melee reach.
 * @param {{x:number,z:number}} position
 * @param {number} radius
 * @returns {{x:number,z:number}}
 */
function projectDeadShiftRouteEndpoint(position, radius) {
  const point = {
    x: clampDeadShiftNumber(position.x, -DEAD_SHIFT_ARENA.halfWidth + radius, DEAD_SHIFT_ARENA.halfWidth - radius),
    z: clampDeadShiftNumber(position.z, -DEAD_SHIFT_ARENA.halfDepth + radius, DEAD_SHIFT_ARENA.halfDepth - radius),
  };
  for (const collider of DEAD_SHIFT_COLLIDERS) {
    const minX = collider.x - collider.width / 2 - radius - 0.02;
    const maxX = collider.x + collider.width / 2 + radius + 0.02;
    const minZ = collider.z - collider.depth / 2 - radius - 0.02;
    const maxZ = collider.z + collider.depth / 2 + radius + 0.02;
    if (point.x < minX || point.x > maxX || point.z < minZ || point.z > maxZ) continue;
    const sideDistances = [point.x - minX, maxX - point.x, point.z - minZ, maxZ - point.z];
    const nearestSide = sideDistances.indexOf(Math.min(...sideDistances));
    if (nearestSide === 0) point.x = minX - 0.01;
    if (nearestSide === 1) point.x = maxX + 0.01;
    if (nearestSide === 2) point.z = minZ - 0.01;
    if (nearestSide === 3) point.z = maxZ + 0.01;
  }
  return point;
}

/**
 * Build reusable visibility routes around fixed cover once, outside room ticks.
 * Each enemy type has its own clearance. Floyd-Warshall precomputes the bounded
 * corner graph so a room only searches visible start/end pairs during a replan.
 * @param {number} radius
 */
function createDeadShiftNavigationGraph(radius) {
  const nodes = [];
  for (const collider of DEAD_SHIFT_COLLIDERS) {
    const offsetX = collider.width / 2 + radius + 0.06;
    const offsetZ = collider.depth / 2 + radius + 0.06;
    for (const sideX of [-1, 1]) {
      for (const sideZ of [-1, 1]) {
        const node = { x: collider.x + sideX * offsetX, z: collider.z + sideZ * offsetZ };
        if (Math.abs(node.x) < DEAD_SHIFT_ARENA.halfWidth - radius &&
            Math.abs(node.z) < DEAD_SHIFT_ARENA.halfDepth - radius && hasDeadShiftWalkPath(node, node, radius)) {
          nodes.push(node);
        }
      }
    }
  }
  const distances = nodes.map((start, startIndex) => nodes.map((end, endIndex) => {
    if (startIndex === endIndex) return 0;
    return hasDeadShiftWalkPath(start, end, radius) ? Math.hypot(end.x - start.x, end.z - start.z) : Infinity;
  }));
  for (let via = 0; via < nodes.length; via += 1) {
    for (let start = 0; start < nodes.length; start += 1) {
      for (let end = 0; end < nodes.length; end += 1) {
        distances[start][end] = Math.min(distances[start][end], distances[start][via] + distances[via][end]);
      }
    }
  }
  return { nodes, distances, radius };
}

const DEAD_SHIFT_NAVIGATION_GRAPHS = Object.fromEntries(DEAD_SHIFT_ENEMY_TYPES.map((enemyType) => [
  enemyType.id, createDeadShiftNavigationGraph(enemyType.radius),
]));

/**
 * Choose the first visible corner on the shortest cover-clearing route.
 * Returned coordinates are values; callers may cache them on their enemy slot.
 * @param {{x:number,z:number,type:import("./config.js").DeadShiftEnemyTypeId}} enemy
 * @param {{x:number,z:number}} target
 * @returns {{x:number,z:number}}
 */
export function getDeadShiftNavigationWaypoint(enemy, target) {
  const graph = DEAD_SHIFT_NAVIGATION_GRAPHS[enemy.type];
  const start = projectDeadShiftRouteEndpoint(enemy, graph.radius);
  if (Math.hypot(start.x - enemy.x, start.z - enemy.z) > 0.01) return start;
  const goal = projectDeadShiftRouteEndpoint(target, graph.radius);
  if (hasDeadShiftWalkPath(enemy, goal, graph.radius)) return goal;
  let bestDistance = Infinity;
  let bestWaypoint = null;
  const visibleEnds = graph.nodes.flatMap((node, index) => hasDeadShiftWalkPath(node, goal, graph.radius)
    ? [{ index, distance: Math.hypot(node.x - goal.x, node.z - goal.z) }]
    : []);
  for (let startIndex = 0; startIndex < graph.nodes.length; startIndex += 1) {
    const node = graph.nodes[startIndex];
    if (!hasDeadShiftWalkPath(enemy, node, graph.radius)) continue;
    const startDistance = Math.hypot(enemy.x - node.x, enemy.z - node.z);
    for (const end of visibleEnds) {
      const distance = startDistance + graph.distances[startIndex][end.index] + end.distance;
      if (distance < bestDistance) {
        bestDistance = distance;
        bestWaypoint = node;
      }
    }
  }
  return bestWaypoint ? { x: bestWaypoint.x, z: bestWaypoint.z } : { x: enemy.x, z: enemy.z };
}
