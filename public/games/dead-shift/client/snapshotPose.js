/** @typedef {{id: number, x: number, y: number, z: number}} PositionedEntity */

/**
 * Map the game's bounded entity pools to the SDK's numeric interpolation paths.
 * IDs travel with positions so recycled slots never interpolate from old actors.
 * @param {{players: {p1: {x:number,y:number,z:number}, p2: {x:number,y:number,z:number}}, enemies: PositionedEntity[], projectiles: PositionedEntity[]}} snapshot
 * @returns {Record<string, number>} Dynamic paths selected by this game adapter.
 */
export function extractDeadShiftPositions(snapshot) {
  const positions = {};
  for (const playerId of ["p1", "p2"]) {
    const playerState = snapshot.players[playerId];
    positions[`${playerId}x`] = playerState.x;
    positions[`${playerId}y`] = playerState.y;
    positions[`${playerId}z`] = playerState.z;
  }
  for (const [index, enemyState] of snapshot.enemies.entries()) {
    copyEntityPose(positions, enemyState, `e${index}`);
  }
  for (const [index, projectileState] of snapshot.projectiles.entries()) {
    copyEntityPose(positions, projectileState, `r${index}`);
  }
  return positions;
}

/** @param {Record<string, number>} positions @param {PositionedEntity} entityState @param {string} prefix */
function copyEntityPose(positions, entityState, prefix) {
  positions[`${prefix}id`] = entityState.id;
  positions[`${prefix}x`] = entityState.x;
  positions[`${prefix}y`] = entityState.y;
  positions[`${prefix}z`] = entityState.z;
}

/**
 * Read an interpolated position only while its identity matches current authority.
 * @param {PositionedEntity} entityState
 * @param {Record<string, number>|null} pose
 * @param {string} prefix
 * @returns {{x:number,y:number,z:number}}
 */
export function readDeadShiftEntityPosition(entityState, pose, prefix) {
  if (!pose || pose[`${prefix}id`] !== entityState.id) {
    return { x: entityState.x, y: entityState.y, z: entityState.z };
  }
  return { x: pose[`${prefix}x`], y: pose[`${prefix}y`], z: pose[`${prefix}z`] };
}
