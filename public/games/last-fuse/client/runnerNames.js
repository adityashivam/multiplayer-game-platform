/**
 * Short display name: the local runner is YOU, the other human RIVAL, bots
 * are numbered.
 * @param {{id:string,isBot:boolean,slotIndex:number}} runner
 * @param {string} playerId
 * @returns {string}
 */
export function nameLastFuseRunner(runner, playerId) {
  if (runner.id === playerId) return "YOU";
  if (!runner.isBot) return "RIVAL";
  return `BOT ${runner.id.replace(/\D/g, "") || runner.slotIndex}`;
}
