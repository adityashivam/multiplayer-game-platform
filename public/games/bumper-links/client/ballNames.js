const BOT_ID_PREFIX = "bot";

/**
 * Short HUD name from the local player's point of view.
 * @param {{id:string}} ball
 * @param {string|null} playerId Local seat.
 * @returns {string}
 */
export function nameBumperLinksBall(ball, playerId) {
  if (ball.id === playerId) return "You";
  if (ball.id.startsWith(BOT_ID_PREFIX)) return `Bot ${ball.id.slice(BOT_ID_PREFIX.length)}`;
  return "Rival";
}
