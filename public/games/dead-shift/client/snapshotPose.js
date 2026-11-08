/** @typedef {{id: number, x: number, y: number, z: number}} PositionedEntity */
/** @typedef {{x:number,y:number,z:number,respawnId:number}} DeadShiftPlayerPose */

/**
 * Map the game's bounded entity pools to the SDK's numeric interpolation paths.
 * IDs travel with positions so recycled slots never interpolate from old actors.
 * @param {{players: {p1: DeadShiftPlayerPose, p2: DeadShiftPlayerPose}, enemies: PositionedEntity[], projectiles: PositionedEntity[]}} snapshot
 * @returns {Record<string, number>} Dynamic paths selected by this game adapter.
 */
export function extractDeadShiftPositions(snapshot) {
  const positions = {};
  for (const playerId of ["p1", "p2"]) {
    const playerState = snapshot.players[playerId];
    positions[`${playerId}x`] = playerState.x;
    positions[`${playerId}y`] = playerState.y;
    positions[`${playerId}z`] = playerState.z;
    positions[`${playerId}respawnId`] = playerState.respawnId;
  }
  for (const [index, enemyState] of snapshot.enemies.entries()) {
    copyEntityPose(positions, enemyState, `e${index}`);
  }
  for (const [index, projectileState] of snapshot.projectiles.entries()) {
    copyEntityPose(positions, projectileState, `r${index}`);
  }
  return positions;
}

/**
 * Describe discontinuities explicitly; recycled entity slots and respawns must
 * not produce interpolated positions or extrapolated travel from old actors.
 * @param {Parameters<typeof extractDeadShiftPositions>[0] & {roundId?:number}} snapshot
 * @returns {Record<string,string>} Identities use the same pose paths as positions.
 */
export function extractDeadShiftContinuityKeys(snapshot) {
  const keys = {};
  for (const playerId of ["p1", "p2"]) {
    const identity = `${snapshot.roundId ?? 0}:${snapshot.players[playerId].respawnId ?? 0}`;
    for (const field of ["x", "y", "z", "respawnId"]) keys[`${playerId}${field}`] = identity;
  }
  for (const [prefix, entities] of [["e", snapshot.enemies], ["r", snapshot.projectiles]]) {
    for (const [index, entity] of entities.entries()) {
      const identity = `${snapshot.roundId ?? 0}:${entity.id}`;
      for (const field of ["id", "x", "y", "z"]) keys[`${prefix}${index}${field}`] = identity;
    }
  }
  return keys;
}

/**
 * Apply presentation only within a player's current respawn identity.
 * @param {object} playerState Borrowed authoritative player.
 * @param {Record<string,number>|null} pose
 * @param {"p1"|"p2"} playerId
 * @returns {object} Owned presentation state.
 */
export function createDeadShiftPresentedPlayer(playerState, pose, playerId) {
  if (!pose || pose[`${playerId}respawnId`] !== playerState.respawnId) return { ...playerState };
  return {
    ...playerState,
    x: pose[`${playerId}x`] ?? playerState.x,
    y: pose[`${playerId}y`] ?? playerState.y,
    z: pose[`${playerId}z`] ?? playerState.z,
  };
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
