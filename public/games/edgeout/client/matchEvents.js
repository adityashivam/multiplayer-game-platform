/** @typedef {import("../shared/simulation.js").EdgeoutMatch} EdgeoutMatch */
/** @typedef {import("./snapshotPose.js").EdgeoutPresentedFighter} EdgeoutPresentedFighter */
/**
 * One presentation event for effects, audio and HUD. Kinds:
 * hit/blocked/guardBreak/parry come from authoritative serials, swing and dash
 * from presented action identities, ringOut/collapse/round from match state.
 * @typedef {object} EdgeoutMatchEvent
 * @property {"swing"|"dash"|"hit"|"blocked"|"guardBreak"|"parry"|"ringOut"|"collapse"|"round"} kind
 * @property {string|null} fighterId Fighter the event happened to.
 * @property {number} x
 * @property {number} z
 * @property {number} power Normalized strength from zero to one.
 */

const STRONG_HIT_SPEED = 18;

/**
 * Turn successive snapshots and presented fighters into discrete events.
 * Serial baselines reset on a new match, so reconnects and rematches never
 * replay old effects. The returned array is reused per call.
 * @returns {{update(snapshot:Readonly<EdgeoutMatch>,fighters:readonly EdgeoutPresentedFighter[]):EdgeoutMatchEvent[],reset():void}}
 */
export function createEdgeoutEventTracker() {
  /** @type {EdgeoutMatchEvent[]} */
  const events = [];
  const fighterBaselines = new Map();
  let matchId = null;
  let roundSerial = 0;
  let ringOutSerial = 0;
  let collapseIdentity = "";

  function reset() {
    fighterBaselines.clear();
    matchId = null;
  }

  /** @param {EdgeoutMatchEvent["kind"]} kind @param {{id:string,x:number,z:number}|null} fighter @param {number} power */
  function pushEvent(kind, fighter, power) {
    events.push({ kind, fighterId: fighter?.id ?? null, x: fighter?.x ?? 0, z: fighter?.z ?? 0, power });
  }

  return {
    reset,
    update(snapshot, fighters) {
      events.length = 0;
      const currentCollapseIdentity = `${snapshot.roundNumber}:${snapshot.arena.collapseSerial}`;
      if (snapshot.matchId !== matchId) {
        matchId = snapshot.matchId;
        fighterBaselines.clear();
        roundSerial = snapshot.roundSerial;
        ringOutSerial = snapshot.ringOutSerial;
        collapseIdentity = currentCollapseIdentity;
      }

      for (const fighter of fighters) {
        const baseline = fighterBaselines.get(fighter.id);
        if (!baseline) {
          fighterBaselines.set(fighter.id, { hitSerial: fighter.hitSerial, parrySerial: fighter.parrySerial, actionId: fighter.actionId });
          continue;
        }
        if (fighter.hitSerial !== baseline.hitSerial) {
          const kind = fighter.lastHitKind === "blocked" ? "blocked" : fighter.lastHitKind === "guardBreak" ? "guardBreak" : "hit";
          if (fighter.lastHitKind !== "parried") pushEvent(kind, fighter, Math.min(1, fighter.lastHitSpeed / STRONG_HIT_SPEED));
        }
        if (fighter.parrySerial !== baseline.parrySerial) pushEvent("parry", fighter, 1);
        if (fighter.actionId !== baseline.actionId) {
          if (fighter.action === "shove") pushEvent("swing", fighter, fighter.shovePower);
          else if (fighter.action === "dash") pushEvent("dash", fighter, 0.6);
        }
        baseline.hitSerial = fighter.hitSerial;
        baseline.parrySerial = fighter.parrySerial;
        baseline.actionId = fighter.actionId;
      }

      if (snapshot.ringOutSerial !== ringOutSerial) {
        const fallen = fighters.find((fighter) => fighter.id === snapshot.lastRingOutId) ?? null;
        pushEvent("ringOut", fallen, 1);
        ringOutSerial = snapshot.ringOutSerial;
      }
      if (currentCollapseIdentity !== collapseIdentity) {
        if (snapshot.arena.collapseSerial > 0) pushEvent("collapse", null, snapshot.arena.collapseSerial / 4);
        collapseIdentity = currentCollapseIdentity;
      }
      if (snapshot.roundSerial !== roundSerial) {
        const roundWinner = fighters.find((fighter) => fighter.id === snapshot.roundWinnerId) ?? null;
        pushEvent("round", roundWinner, snapshot.gameOver ? 1 : 0.6);
        roundSerial = snapshot.roundSerial;
      }
      return events;
    },
  };
}
