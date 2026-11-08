import { sampleSkyDashSeesaws } from "../shared/course.js";

/** @typedef {{id:string,x:number,y:number,z:number,respawnId:number}} SkyDashRunnerPose */
const MAX_SEESAW_LOOKAHEAD_SEC = 0.15;

/**
 * Map game-defined human/bot identifiers to the SDK's dynamic numeric pose paths.
 * Respawn identity prevents a recycled position being blended across the course.
 * @param {{players:Record<string,SkyDashRunnerPose>,bots:SkyDashRunnerPose[],timeSec:number}} snapshot
 * @returns {Record<string,number>} Interpolator-owned numeric path map.
 */
export function extractSkyDashPositions(snapshot) {
  const pose = { courseTimeSec: snapshot.timeSec };
  for (const seesaw of snapshot.seesaws || []) pose[`seesaw.${seesaw.platformId}.angle`] = seesaw.angle;
  for (const runner of [...Object.values(snapshot.players), ...snapshot.bots]) {
    pose[`${runner.id}.x`] = runner.x;
    pose[`${runner.id}.y`] = runner.y;
    pose[`${runner.id}.z`] = runner.z;
    pose[`${runner.id}.respawnId`] = runner.respawnId;
  }
  return pose;
}

/** @param {Parameters<typeof extractSkyDashPositions>[0] & {roundId?:number}} snapshot @returns {Record<string,string>} */
export function extractSkyDashContinuityKeys(snapshot) {
  const keys = {};
  for (const runner of [...Object.values(snapshot.players), ...snapshot.bots]) {
    const identity = `${snapshot.roundId ?? 0}:${runner.respawnId}`;
    for (const field of ["x", "y", "z", "respawnId"]) keys[`${runner.id}.${field}`] = identity;
  }
  return keys;
}

/**
 * Render local interactive geometry at the predicted player's clock. Remote
 * racers retain delayed interpolation, while a sweeper never visibly lags the
 * collision shape used for the local player's prediction.
 * @param {Record<string,number>|null} remotePose
 * @param {{x:number,y:number,z:number,courseTimeSec:number}|null} localPose
 * @param {{players:Record<string,SkyDashRunnerPose>,bots:SkyDashRunnerPose[],timeSec:number}|null} snapshot
 * @param {string|null} playerId
 * @returns {Record<string,number>|null}
 */
export function composeSkyDashRenderPose(remotePose, localPose, snapshot, playerId) {
  if (!snapshot) return null;
  const pose = remotePose || extractSkyDashPositions(snapshot);
  if (!playerId || !localPose) return pose;
  const localSeesawPose = {};
  for (const seesaw of snapshot.seesaws || []) {
    const key = `seesaw.${seesaw.platformId}.angle`;
    if (Number.isFinite(localPose[key])) localSeesawPose[key] = localPose[key];
  }
  return {
    ...pose,
    ...localSeesawPose,
    courseTimeSec: localPose.courseTimeSec,
    [`${playerId}.x`]: localPose.x,
    [`${playerId}.y`]: localPose.y,
    [`${playerId}.z`]: localPose.z,
    [`${playerId}.respawnId`]: snapshot.players[playerId].respawnId,
  };
}

/**
 * Create render-owned actor values, using authority while identity is changing.
 * @template {SkyDashRunnerPose} Runner
 * @param {{players:Record<string,Runner>,bots:Runner[]}} snapshot
 * @param {Record<string,number>|null} pose
 * @returns {Runner[]}
 */
export function createSkyDashPresentedRunners(snapshot, pose) {
  return [...Object.values(snapshot.players), ...snapshot.bots].map((runner) => {
    const hasMatchingIdentity = pose?.[`${runner.id}.respawnId`] === runner.respawnId;
    return {
      ...runner,
      x: hasMatchingIdentity ? pose[`${runner.id}.x`] ?? runner.x : runner.x,
      y: hasMatchingIdentity ? pose[`${runner.id}.y`] ?? runner.y : runner.y,
      z: hasMatchingIdentity ? pose[`${runner.id}.z`] ?? runner.z : runner.z,
    };
  });
}

/** Keep rendered seesaw angles aligned with predicted contact; authority remains immutable. */
export function createSkyDashPresentedSeesaws(snapshot, pose) {
  return (snapshot.seesaws || []).map((seesaw) => ({ ...seesaw, angle: pose?.[`seesaw.${seesaw.platformId}.angle`] ?? seesaw.angle }));
}

/**
 * SDK replay context is read-only. Keep the predicted course clock on the owned
 * player clone so each replay step samples the moving geometry at its own time.
 * @param {SkyDashRunnerPose & {predictionTimeSec?:number}} runner
 * @param {import("../shared/config.js").SkyDashInputState} input
 * @param {number} dtSec
 * @param {{active:boolean,timeSec:number}} context
 * @param {(runner:object,input:object,dtSec:number,context:object)=>void} simulate
 */
export function stepSkyDashPrediction(runner, input, dtSec, context, simulate) {
  const timeSec = runner.predictionTimeSec ?? context.timeSec;
  const baseSeesaws = runner.predictionBaseSeesaws || context.seesaws || [];
  const seesawElapsedSec = runner.predictionSeesawElapsedSec || 0;
  simulate(runner, input, dtSec, { active: context.active, timeSec, seesaws: sampleSkyDashSeesaws(baseSeesaws, seesawElapsedSec) });
  runner.predictionTimeSec = timeSec + (context.active ? dtSec : 0);
  runner.predictionSeesawElapsedSec = Math.min(MAX_SEESAW_LOOKAHEAD_SEC, seesawElapsedSec + (context.active ? dtSec : 0));
  runner.predictionSeesaws = sampleSkyDashSeesaws(baseSeesaws, runner.predictionSeesawElapsedSec);
}
