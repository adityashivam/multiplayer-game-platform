/** @typedef {import("../shared/match.js").SkybreakMatch} SkybreakMatch */
/** @typedef {import("./snapshotPose.js").SkybreakPresentedJet} SkybreakPresentedJet */
/**
 * @typedef {object} SkybreakEvent
 * @property {"hit"|"hitConfirm"|"kill"|"explode"|"flare"|"missileLaunch"|"gate"|"runFinish"|"respawn"} kind
 * @property {string|null} jetId Jet the event happened to.
 * @property {string|null} otherId Killer for kills.
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} value Kind-specific: gate number, run time or kill serial.
 * @property {string} [cause]
 */

/**
 * Turn successive snapshots into discrete presentation events. Baselines
 * reset on a new match so rejoins and rematches never replay old effects.
 * The returned array is reused per call.
 */
export function createSkybreakEventTracker() {
  /** @type {SkybreakEvent[]} */
  const events = [];
  const baselines = new Map();
  let matchId = null;
  let killSerial = 0;

  /** @param {SkybreakEvent["kind"]} kind @param {SkybreakPresentedJet|null} jet @param {number} value @param {string|null} [otherId] @param {string} [cause] */
  function pushEvent(kind, jet, value, otherId = null, cause) {
    events.push({ kind, jetId: jet?.id ?? null, otherId, x: jet?.x ?? 0, y: jet?.y ?? 0, z: jet?.z ?? 0, value, cause });
  }

  return {
    reset() {
      baselines.clear();
      matchId = null;
    },
    /** @param {Readonly<SkybreakMatch>} snapshot @param {readonly SkybreakPresentedJet[]} jets */
    update(snapshot, jets) {
      events.length = 0;
      if (snapshot.matchId !== matchId) {
        matchId = snapshot.matchId;
        baselines.clear();
        killSerial = snapshot.killSerial;
      }
      for (const jet of jets) {
        const baseline = baselines.get(jet.id);
        if (!baseline) {
          baselines.set(jet.id, { hitSerial: jet.hitSerial, hitConfirmSerial: jet.hitConfirmSerial, deathSerial: jet.deathSerial, flareSerial: jet.flareSerial, missiles: jet.missiles, gateIndex: jet.gateIndex, runSerial: jet.runSerial, respawnId: jet.respawnId });
          continue;
        }
        if (jet.hitSerial !== baseline.hitSerial) pushEvent("hit", jet, 1);
        if (jet.hitConfirmSerial !== baseline.hitConfirmSerial) pushEvent("hitConfirm", jet, jet.hitConfirmSerial - baseline.hitConfirmSerial);
        if (jet.deathSerial !== baseline.deathSerial) pushEvent("explode", jet, 1, null, jet.lastDeathCause ?? undefined);
        if (jet.flareSerial !== baseline.flareSerial) pushEvent("flare", jet, 1);
        if (jet.missiles < baseline.missiles) pushEvent("missileLaunch", jet, 1);
        if (jet.gateIndex > baseline.gateIndex) pushEvent("gate", jet, jet.gateIndex);
        if (jet.runSerial !== baseline.runSerial && jet.lastRunSec > 0 && !jet.runActive && jet.alive) pushEvent("runFinish", jet, jet.lastRunSec);
        if (jet.respawnId !== baseline.respawnId) pushEvent("respawn", jet, 1);
        Object.assign(baseline, { hitSerial: jet.hitSerial, hitConfirmSerial: jet.hitConfirmSerial, deathSerial: jet.deathSerial, flareSerial: jet.flareSerial, missiles: jet.missiles, gateIndex: jet.gateIndex, runSerial: jet.runSerial, respawnId: jet.respawnId });
      }
      for (const kill of snapshot.killFeed) {
        if (kill.serial <= killSerial) continue;
        const victim = jets.find((jet) => jet.id === kill.victimId) ?? null;
        pushEvent("kill", victim, kill.serial, kill.killerId, kill.cause);
      }
      killSerial = Math.max(killSerial, snapshot.killSerial);
      return events;
    },
  };
}
