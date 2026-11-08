import * as THREE from "three";
import { RIFTBALL_ACTION_SETTINGS, RIFTBALL_CHARACTER_SETTINGS, RIFTBALL_PLAYER_IDS } from "../shared/config.js";
import { createRiftballAthleteModel } from "./athlete/model.js";
import { createRiftballAthleteClips } from "./athlete/clips.js";

/**
 * @typedef {object} RiftballRenderAthlete
 * @property {string} id
 * @property {number} [index]
 * @property {number} [slotIndex]
 * @property {number} [colorIndex]
 * @property {string} [name]
 * @property {boolean} [connected]
 * @property {number} x
 * @property {number} y Authoritative feet height.
 * @property {number} z
 * @property {number} vx
 * @property {number} vy
 * @property {number} vz
 * @property {number} facing Canonical forward is +Z.
 * @property {boolean} grounded
 * @property {import("../shared/config.js").RiftballAction} action
 * @property {number} actionId Stable identity for a single authoritative action.
 * @property {number} actionTimeSec Elapsed authoritative action time.
 * @property {number} chargeSec
 * @property {number} [strikePower] Persisted release power, in [0,1].
 * @property {number} stamina
 * @property {number} score
 * @property {number} seriesWins
 * @typedef {{dtSec:number,timeSec:number,gameTimeSec:number,roundId:string|number,playerId?:string,ball?:{x:number,y:number,z:number},phase:string,goalSerial:number,lastScorer?:string|null,reducedMotion?:boolean,replay?:boolean}} RiftballAthleteFrame
 */

const LANDING_CLIP_DURATION_SEC = 0.2;
const MAX_VISUAL_FRAME_DT_SEC = 0.05;
const ACTION_CLOCK_CORRECTION_THRESHOLD_SEC = 0.09;
const POWER_STRIKE_THRESHOLD = 0.5;
const LOOPING_CLIPS = new Set(["idle", "run"]);
const IDENTITY_QUATERNION = new THREE.Quaternion();
const FOOT_SUPPORT_CORNERS = Object.freeze([
  [-0.105, -0.115, -0.112], [0.105, -0.115, -0.112],
  [-0.105, -0.115, 0.257], [0.105, -0.115, 0.257],
]);

/** @param {RiftballRenderAthlete} playerState @param {boolean} landing */
function selectAthleteClip(playerState, landing) {
  if (playerState.action === "victory" || playerState.action === "defeat") return playerState.action;
  if (playerState.action === "strike") {
    const strikePower = playerState.strikePower ?? playerState.chargeSec / RIFTBALL_ACTION_SETTINGS.maxChargeSec;
    return strikePower >= POWER_STRIKE_THRESHOLD ? "powerStrike" : "quickStrike";
  }
  if (playerState.action === "charge" || playerState.action === "dash" || playerState.action === "feint" || playerState.action === "hit") return playerState.action;
  if (landing) return "land";
  if (!playerState.grounded || playerState.action === "jump") return "jump";
  const planarSpeed = Math.hypot(playerState.vx || 0, playerState.vz || 0);
  return planarSpeed > 0.4 ? "run" : "idle";
}

/**
 * @param {ReturnType<typeof createRiftballAthleteModel>} model
 * @param {THREE.Matrix4} inverseRootMatrix
 * @param {THREE.Vector3} supportPoint
 */
function plantAthleteFeet(model, inverseRootMatrix, supportPoint) {
  inverseRootMatrix.copy(model.root.matrixWorld).invert();
  let minimumFootY = Infinity;
  for (const foot of model.feet) {
    for (const corner of FOOT_SUPPORT_CORNERS) {
      supportPoint.fromArray(corner).applyMatrix4(foot.matrixWorld).applyMatrix4(inverseRootMatrix);
      minimumFootY = Math.min(minimumFootY, supportPoint.y);
    }
  }
  // This changes the visual pelvis only. The root remains at authoritative feet.
  model.bones.Hips.position.y -= THREE.MathUtils.clamp(minimumFootY, -0.24, 0.5);
  model.root.updateMatrixWorld(true);
}

/**
 * Owns bounded athlete models, animation mixers and their GPU resources. Updates
 * read player states without mutating them. Render cadence advances stable
 * actions between snapshots; snapshot elapsed time only corrects clock drift.
 * The caller owns the scene and renderer and retains their full lifecycle.
 * @param {THREE.Scene|THREE.Group} scene
 */
export function createRiftballAthletes(scene) {
  const athleteGroup = new THREE.Group();
  athleteGroup.name = "riftball-athletes";
  scene.add(athleteGroup);
  /** @type {Map<string, ReturnType<typeof createAthleteRecord>>} */
  const athleteRecords = new Map();
  const inverseRootMatrix = new THREE.Matrix4();
  const supportPoint = new THREE.Vector3();
  const localBallDirection = new THREE.Vector3();
  const inverseFacing = new THREE.Quaternion();
  const headGaze = new THREE.Quaternion();
  const gazeEuler = new THREE.Euler();
  const presentPlayerIds = new Set();
  let disposed = false;

  /** @param {RiftballRenderAthlete} playerState */
  function createAthleteRecord(playerState) {
    const identityIndex = playerState.colorIndex ?? playerState.index ?? playerState.slotIndex ?? RIFTBALL_PLAYER_IDS.indexOf(/** @type {"p1"|"p2"} */ (playerState.id));
    const model = createRiftballAthleteModel(Math.max(0, identityIndex));
    model.root.name = `riftball-athlete-${playerState.id}`;
    const clips = createRiftballAthleteClips();
    model.root.animations = Object.values(clips);
    model.body.animations = model.root.animations;
    const mixer = new THREE.AnimationMixer(model.root);
    athleteGroup.add(model.root);
    return {
      model, clips, mixer, identityIndex,
      actionIdentity: "", clipName: "idle", elapsedSec: 0,
      lastSnapshotElapsedSec: 0, gaitElapsedSec: 0,
      landingElapsedSec: LANDING_CLIP_DURATION_SEC,
      grounded: playerState.grounded, roundId: /** @type {string|number|null} */ (null),
      facing: playerState.facing || 0,
      animatedHeadQuaternion: model.bones.Head.quaternion.clone(),
      activeAction: /** @type {THREE.AnimationAction|null} */ (null),
    };
  }

  /** @param {ReturnType<typeof createAthleteRecord>} athleteRecord */
  function disposeAthleteRecord(athleteRecord) {
    athleteRecord.mixer.stopAllAction();
    athleteRecord.mixer.uncacheRoot(athleteRecord.model.root);
    athleteRecord.model.root.animations = [];
    athleteRecord.model.body.animations = [];
    athleteRecord.model.dispose();
  }

  /** @param {ReturnType<typeof createAthleteRecord>} athleteRecord @param {RiftballRenderAthlete} playerState @param {RiftballAthleteFrame} frame @param {number} dtSec */
  function updateAthleteRecord(athleteRecord, playerState, frame, dtSec) {
    const { model, mixer, clips } = athleteRecord;
    // The mixer skips writes for unchanged tracks. Remove the previous frame's
    // gaze before evaluating animation so that offset cannot accumulate.
    model.bones.Head.quaternion.copy(athleteRecord.animatedHeadQuaternion);
    const changedRound = athleteRecord.roundId !== frame.roundId;
    if (changedRound) {
      athleteRecord.actionIdentity = "";
      athleteRecord.gaitElapsedSec = 0;
      athleteRecord.landingElapsedSec = LANDING_CLIP_DURATION_SEC;
      athleteRecord.facing = playerState.facing || 0;
      athleteRecord.roundId = frame.roundId;
    }
    if (!changedRound && !athleteRecord.grounded && playerState.grounded) athleteRecord.landingElapsedSec = 0;
    else athleteRecord.landingElapsedSec += dtSec;
    athleteRecord.grounded = playerState.grounded;

    const landing = athleteRecord.landingElapsedSec < LANDING_CLIP_DURATION_SEC;
    const goalReaction = frame.phase === "goal";
    const clipName = goalReaction ? playerState.id === frame.lastScorer ? "victory" : "hit" : selectAthleteClip(playerState, landing);
    const actionIdentity = goalReaction ? `${frame.roundId}:goal:${frame.goalSerial}:${clipName}` : `${frame.roundId}:${playerState.actionId}:${clipName}`;
    const changedAction = actionIdentity !== athleteRecord.actionIdentity;
    const snapshotElapsedSec = Math.max(0, playerState.actionTimeSec || 0);
    if (changedAction) {
      athleteRecord.actionIdentity = actionIdentity;
      athleteRecord.clipName = clipName;
      athleteRecord.elapsedSec = goalReaction ? 0 : clipName === "land" ? athleteRecord.landingElapsedSec : snapshotElapsedSec;
      athleteRecord.lastSnapshotElapsedSec = snapshotElapsedSec;
      mixer.stopAllAction();
      const activeAction = mixer.clipAction(clips[clipName]);
      activeAction.reset();
      activeAction.setLoop(LOOPING_CLIPS.has(clipName) ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
      activeAction.clampWhenFinished = true;
      activeAction.play();
      athleteRecord.activeAction = activeAction;
    } else {
      athleteRecord.elapsedSec += dtSec;
      if (frame.replay && !goalReaction) {
        athleteRecord.elapsedSec = snapshotElapsedSec;
      } else if (!goalReaction && snapshotElapsedSec !== athleteRecord.lastSnapshotElapsedSec) {
        const driftSec = snapshotElapsedSec - athleteRecord.elapsedSec;
        if (Math.abs(driftSec) > ACTION_CLOCK_CORRECTION_THRESHOLD_SEC) {
          athleteRecord.elapsedSec += THREE.MathUtils.clamp(driftSec, -dtSec * 0.5, dtSec * 0.5);
        }
        athleteRecord.lastSnapshotElapsedSec = snapshotElapsedSec;
      }
    }

    const planarSpeed = Math.hypot(playerState.vx || 0, playerState.vz || 0);
    athleteRecord.gaitElapsedSec += dtSec * THREE.MathUtils.clamp(planarSpeed / RIFTBALL_CHARACTER_SETTINGS.moveSpeed, 0.35, 1.5);
    const clipTimeSec = clipName === "run" ? athleteRecord.gaitElapsedSec : athleteRecord.elapsedSec;
    // setTime evaluates authored tracks without accumulating packet-driven phase.
    athleteRecord.activeAction.paused = false;
    athleteRecord.activeAction.enabled = true;
    mixer.setTime(Math.max(0, clipTimeSec));
    athleteRecord.animatedHeadQuaternion.copy(model.bones.Head.quaternion);

    model.root.position.set(playerState.x, playerState.y, playerState.z);
    const targetFacing = clipName === "run" ? Math.atan2(playerState.vx || 0, playerState.vz || 0) : playerState.facing || 0;
    const facingDelta = Math.atan2(Math.sin(targetFacing - athleteRecord.facing), Math.cos(targetFacing - athleteRecord.facing));
    const immediateAim = changedAction && (clipName === "quickStrike" || clipName === "powerStrike" || clipName === "charge");
    athleteRecord.facing += facingDelta * (immediateAim ? 1 : dtSec > 0 ? 1 - Math.exp(-dtSec * 20) : 1);
    model.root.rotation.y = athleteRecord.facing;

    if (frame.ball) {
      localBallDirection.set(frame.ball.x - playerState.x, frame.ball.y - playerState.y - 1.6, frame.ball.z - playerState.z);
      inverseFacing.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, -athleteRecord.facing);
      localBallDirection.applyQuaternion(inverseFacing);
    } else {
      localBallDirection.set(0, 0, 3);
    }
    const horizontalDistance = Math.hypot(localBallDirection.x, localBallDirection.z);
    const gazeScale = playerState.action === "victory" || playerState.action === "defeat" ? 0.2 : 1;
    const headYaw = THREE.MathUtils.clamp(Math.atan2(localBallDirection.x, Math.max(0.3, localBallDirection.z)), -0.25, 0.25) * gazeScale;
    const headPitch = THREE.MathUtils.clamp(-Math.atan2(localBallDirection.y, Math.max(1, horizontalDistance)), -0.14, 0.15) * gazeScale;
    headGaze.setFromEuler(gazeEuler.set(headPitch, headYaw, 0));
    if (frame.reducedMotion) headGaze.slerp(IDENTITY_QUATERNION, 0.5);
    model.bones.Head.quaternion.multiply(headGaze).normalize();
    model.root.updateMatrixWorld(true);
    if (playerState.grounded) plantAthleteFeet(model, inverseRootMatrix, supportPoint);
    model.skeleton.update();
    model.face.update(playerState, frame, localBallDirection, athleteRecord.identityIndex, goalReaction ? clipName : playerState.action, dtSec);
    const chargeRatio = THREE.MathUtils.clamp(playerState.chargeSec / RIFTBALL_ACTION_SETTINGS.maxChargeSec, 0, 1);
    model.impactMaterial.emissiveIntensity = 0.03 + chargeRatio * 0.75;
    model.contactRing.visible = playerState.grounded;
    model.contactRing.material.opacity = playerState.id === frame.playerId ? 0.6 : 0.25;
  }

  return {
    /** @param {ReadonlyArray<RiftballRenderAthlete>} players @param {RiftballAthleteFrame} frame */
    update(players, frame) {
      if (disposed) return;
      const dtSec = THREE.MathUtils.clamp(frame.dtSec || 0, 0, MAX_VISUAL_FRAME_DT_SEC);
      presentPlayerIds.clear();
      const playerCount = Math.min(players.length, RIFTBALL_PLAYER_IDS.length);
      for (let playerIndex = 0; playerIndex < playerCount; playerIndex += 1) {
        const playerState = players[playerIndex];
        presentPlayerIds.add(playerState.id);
        if (!athleteRecords.has(playerState.id)) athleteRecords.set(playerState.id, createAthleteRecord(playerState));
        updateAthleteRecord(athleteRecords.get(playerState.id), playerState, frame, dtSec);
      }
      for (const [playerId, athleteRecord] of athleteRecords) {
        if (!presentPlayerIds.has(playerId)) {
          disposeAthleteRecord(athleteRecord);
          athleteRecords.delete(playerId);
        }
      }
    },
    getStats() {
      let bones = 0;
      let clips = 0;
      let triangles = 0;
      let geometries = 0;
      let materials = 0;
      for (const { model } of athleteRecords.values()) {
        bones += model.skeleton.bones.length;
        clips += model.body.animations.length;
        geometries += model.geometries.size;
        materials += model.materials.size;
        model.root.traverse((node) => {
          if (node.isMesh) triangles += (node.geometry.index ? node.geometry.index.count : node.geometry.getAttribute("position").count) / 3;
        });
      }
      return { athletes: athleteRecords.size, skinnedMeshes: athleteRecords.size, bones, clips, triangles, geometries, materials, disposed };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const athleteRecord of athleteRecords.values()) disposeAthleteRecord(athleteRecord);
      athleteRecords.clear();
      athleteGroup.removeFromParent();
      athleteGroup.clear();
    },
  };
}
