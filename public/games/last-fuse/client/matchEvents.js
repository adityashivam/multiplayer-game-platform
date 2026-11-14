/** @typedef {import("../shared/match.js").LastFuseMatch} LastFuseMatch */
/** @typedef {import("./snapshotPose.js").LastFusePresentedRunner} LastFusePresentedRunner */
/**
 * One presentation event for effects, audio and HUD.
 * @typedef {object} LastFuseMatchEvent
 * @property {"armed"|"pass"|"blast"|"fall"|"crumbleWarning"|"collapse"|"jump"|"dash"|"respawn"|"round"} kind
 * @property {string|null} runnerId Runner the event happened to.
 * @property {string|null} fromId Previous holder for a pass.
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} roofId Roof for crumble events, else zero.
 */

/**
 * Turn successive snapshots and presented runners into discrete events.
 * Baselines reset on a new match, so reconnects and rematches never replay
 * old effects. The returned array is reused per call.
 * @returns {{update(snapshot:Readonly<LastFuseMatch>,runners:readonly LastFusePresentedRunner[]):LastFuseMatchEvent[],reset():void}}
 */
export function createLastFuseEventTracker() {
  /** @type {LastFuseMatchEvent[]} */
  const events = [];
  const runnerBaselines = new Map();
  let matchId = null;
  let roundNumber = 0;
  let passSerial = 0;
  let blastSerial = 0;
  let fallSerial = 0;
  let roundSerial = 0;
  let collapseSerial = 0;
  let crumblingRoofId = 0;

  function reset() {
    runnerBaselines.clear();
    matchId = null;
  }

  /**
   * @param {LastFuseMatchEvent["kind"]} kind
   * @param {{id:string,x:number,y:number,z:number}|null} runner
   * @param {Partial<LastFuseMatchEvent>} [extra]
   */
  function pushEvent(kind, runner, extra = {}) {
    events.push({ kind, runnerId: runner?.id ?? null, fromId: null, x: runner?.x ?? 0, y: runner?.y ?? 0, z: runner?.z ?? 0, roofId: 0, ...extra });
  }

  /** @param {Readonly<LastFuseMatch>} snapshot */
  function adoptBaselines(snapshot) {
    matchId = snapshot.matchId;
    roundNumber = snapshot.roundNumber;
    passSerial = snapshot.bomb.passSerial;
    blastSerial = snapshot.bomb.blastSerial;
    fallSerial = snapshot.fallSerial;
    roundSerial = snapshot.roundSerial;
    collapseSerial = snapshot.city.collapseSerial;
    crumblingRoofId = snapshot.city.crumblingRoofId;
    runnerBaselines.clear();
  }

  return {
    reset,
    update(snapshot, runners) {
      events.length = 0;
      if (snapshot.matchId !== matchId) adoptBaselines(snapshot);
      const newRound = snapshot.roundNumber !== roundNumber;
      if (newRound) {
        roundNumber = snapshot.roundNumber;
        collapseSerial = snapshot.city.collapseSerial;
        crumblingRoofId = snapshot.city.crumblingRoofId;
      }
      const findRunner = (runnerId) => runners.find((runner) => runner.id === runnerId) ?? null;

      for (const runner of runners) {
        const baseline = runnerBaselines.get(runner.id);
        if (!baseline || newRound) {
          runnerBaselines.set(runner.id, { actionId: runner.actionId, respawnId: runner.respawnId });
          continue;
        }
        if (runner.actionId !== baseline.actionId) {
          if (runner.action === "jump") pushEvent("jump", runner);
          else if (runner.action === "dash") pushEvent("dash", runner);
        }
        if (runner.respawnId !== baseline.respawnId) pushEvent("respawn", runner);
        baseline.actionId = runner.actionId;
        baseline.respawnId = runner.respawnId;
      }

      const bomb = snapshot.bomb;
      if (bomb.passSerial !== passSerial) {
        const holder = findRunner(bomb.holderId);
        if (holder) pushEvent(bomb.lastPassFromId ? "pass" : "armed", holder, { fromId: bomb.lastPassFromId });
        passSerial = bomb.passSerial;
      }
      if (bomb.blastSerial !== blastSerial) {
        events.push({ kind: "blast", runnerId: bomb.lastBlastId, fromId: null, x: bomb.blastX, y: bomb.blastY, z: bomb.blastZ, roofId: 0 });
        blastSerial = bomb.blastSerial;
      }
      if (snapshot.fallSerial !== fallSerial) {
        pushEvent("fall", findRunner(snapshot.lastFallId));
        fallSerial = snapshot.fallSerial;
      }
      if (snapshot.city.crumblingRoofId !== crumblingRoofId) {
        if (snapshot.city.crumblingRoofId > 0) pushEvent("crumbleWarning", null, { roofId: snapshot.city.crumblingRoofId });
        crumblingRoofId = snapshot.city.crumblingRoofId;
      }
      if (snapshot.city.collapseSerial !== collapseSerial) {
        pushEvent("collapse", null);
        collapseSerial = snapshot.city.collapseSerial;
      }
      if (snapshot.roundSerial !== roundSerial) {
        pushEvent("round", findRunner(snapshot.roundWinnerId));
        roundSerial = snapshot.roundSerial;
      }
      return events;
    },
  };
}
