/**
 * Remember how this navigation entered a room. A room assignment created after
 * entering /games/<id> preserves creator intent; a shared room URL never gains it.
 * @returns {{update:(entry:{gameId:string|null,roomId:string|null,phase:string,joined:boolean,connectedPlayers:number,requiredPlayers:number})=>{autoInvite:boolean,closeInvite:boolean,isCreatorEntry:boolean}}}
 */
export function createRoomInvitePolicy() {
  let entry = null;
  return {
    update({ gameId, roomId, phase, joined, connectedPlayers, requiredPlayers }) {
      if (!gameId) {
        entry = null;
        return { autoInvite: false, closeInvite: true, isCreatorEntry: false };
      }
      if (!entry || entry.gameId !== gameId || (entry.roomId && roomId && entry.roomId !== roomId)) {
        entry = { gameId, roomId, isCreatorEntry: !roomId, autoInviteShown: false, previousPhase: null };
      }
      if (roomId) entry.roomId = roomId;
      const closeInvite = phase === "countdown" || phase === "error" || ((phase === "playing" || phase === "finished") && phase !== entry.previousPhase);
      const autoInvite = entry.isCreatorEntry && !entry.autoInviteShown && Boolean(roomId && joined) &&
        phase === "waiting" && connectedPlayers < requiredPlayers;
      if (autoInvite) entry.autoInviteShown = true;
      entry.previousPhase = phase;
      return { autoInvite, closeInvite, isCreatorEntry: entry.isCreatorEntry };
    },
  };
}
