import { RIFTBALL_COURT } from "../shared/config.js";

/** @typedef {"low"|"medium"|"high"} RiftballRenderQuality */
/** @typedef {{resolutionScale?:number,targetFps?:number,reducedEffects?:boolean,autoTier?:string,autoLowEndActive?:boolean}} RiftballQualityProfile */
/** @typedef {{quality:RiftballRenderQuality,resolutionScale:number,targetFps:number,reducedEffects:boolean,maxPixelRatio:number,shadows:boolean,shadowMapSize:number,particleLimit:number}} RiftballQualitySettings */
/** @typedef {{id:string,position:[number,number,number],size:[number,number,number]}} RiftballCourtBoundary */
/** @typedef {{x:number,y:number,z:number,targetX:number,targetY:number,targetZ:number,heading:number,fov:number}} RiftballCameraView */

const COURT_WALL_THICKNESS = 0.3;
const CAMERA_WALL_CLEARANCE = 0.6;
const CAMERA_MIN_PITCH = -0.32;
const CAMERA_MAX_PITCH = 0.62;
const CAMERA_MAX_ELEVATION = 11.4;
const CAMERA_FOLLOW_DISTANCE = 6.4;
const CAMERA_FOLLOW_HEIGHT = 3.6;

/** @param {number} value @param {number} minimum @param {number} maximum */
function clampRiftballValue(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

/** @param {number|undefined} value @param {number} fallback */
function finiteRiftballValue(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Fit the local silhouette and the physical ball to the chosen view direction.
 * Uses camera-space projections rather than a fixed distance heuristic, which
 * keeps a far backcourt return readable when the camera reaches an end wall.
 * @param {RiftballCameraView} candidate
 * @param {import("./renderer.js").RiftballRenderPlayer} player
 * @param {import("./renderer.js").RiftballRenderBall} ball
 * @param {number} aspect
 * @param {number} minimumFov
 */
function getRiftballFramingFov(candidate, player, ball, aspect, minimumFov) {
  const forwardX = candidate.targetX - candidate.x;
  const forwardY = candidate.targetY - candidate.y;
  const forwardZ = candidate.targetZ - candidate.z;
  const forwardLength = Math.max(0.001, Math.hypot(forwardX, forwardY, forwardZ));
  const normalizedX = forwardX / forwardLength;
  const normalizedY = forwardY / forwardLength;
  const normalizedZ = forwardZ / forwardLength;
  const horizontalLength = Math.max(0.001, Math.hypot(normalizedX, normalizedZ));
  const rightX = -normalizedZ / horizontalLength;
  const rightZ = normalizedX / horizontalLength;
  const upX = -rightZ * normalizedY;
  const upY = horizontalLength;
  const upZ = rightX * normalizedY;
  const boundedAspect = clampRiftballValue(finiteRiftballValue(aspect, 1.7), 0.35, 3.5);
  let maximumTangent = Math.tan(minimumFov * Math.PI / 360);

  function includeFramingPoint(x, y, z) {
    const deltaX = x - candidate.x;
    const deltaY = y - candidate.y;
    const deltaZ = z - candidate.z;
    const depth = Math.max(0.1, deltaX * normalizedX + deltaY * normalizedY + deltaZ * normalizedZ);
    const horizontalTangent = Math.abs(deltaX * rightX + deltaZ * rightZ) / (depth * boundedAspect);
    const verticalTangent = Math.abs(deltaX * upX + deltaY * upY + deltaZ * upZ) / depth;
    maximumTangent = Math.max(maximumTangent, horizontalTangent * 1.12, verticalTangent * 1.12);
  }

  includeFramingPoint(player.x, player.y + 0.05, player.z);
  includeFramingPoint(player.x, player.y + 1.95, player.z);
  includeFramingPoint(ball.x - RIFTBALL_COURT.ballRadius, ball.y, ball.z);
  includeFramingPoint(ball.x + RIFTBALL_COURT.ballRadius, ball.y, ball.z);
  includeFramingPoint(ball.x, ball.y - RIFTBALL_COURT.ballRadius, ball.z);
  includeFramingPoint(ball.x, ball.y + RIFTBALL_COURT.ballRadius, ball.z);
  return Math.min(boundedAspect < 0.9 ? 112 : 86, 2 * Math.atan(maximumTangent) * 180 / Math.PI);
}

/**
 * Physical court architecture. Every visible collision wall uses these pieces;
 * the open 6.4 by 3.2 goal mouths remain open at both authoritative end planes.
 * @returns {RiftballCourtBoundary[]}
 */
export function getRiftballCourtBoundaries() {
  const { halfWidth, halfLength, wallHeight, goalHalfWidth, goalHeight, goalDepth } = RIFTBALL_COURT;
  const wallHalfThickness = COURT_WALL_THICKNESS / 2;
  const endWingWidth = halfWidth - goalHalfWidth;
  const endWingX = goalHalfWidth + endWingWidth / 2;
  /** @type {RiftballCourtBoundary[]} */
  const boundaries = [
    { id: "wall-east", position: [halfWidth + wallHalfThickness, wallHeight / 2, 0], size: [COURT_WALL_THICKNESS, wallHeight, halfLength * 2 + COURT_WALL_THICKNESS * 2] },
    { id: "wall-west", position: [-halfWidth - wallHalfThickness, wallHeight / 2, 0], size: [COURT_WALL_THICKNESS, wallHeight, halfLength * 2 + COURT_WALL_THICKNESS * 2] },
    { id: "court-ceiling", position: [0, wallHeight + wallHalfThickness, 0], size: [halfWidth * 2, COURT_WALL_THICKNESS, (halfLength + goalDepth) * 2] },
  ];

  for (const [endName, direction] of [["north", -1], ["south", 1]]) {
    const endZ = direction * (halfLength + wallHalfThickness);
    const goalCenterZ = direction * (halfLength + goalDepth / 2);
    for (const [wingName, wingDirection] of [["left", -1], ["right", 1]]) {
      boundaries.push({
        id: `end-${endName}-${wingName}`,
        position: [wingDirection * endWingX, wallHeight / 2, endZ],
        size: [endWingWidth, wallHeight, COURT_WALL_THICKNESS],
      });
      boundaries.push({
        id: `goal-${endName}-${wingName}`,
        position: [wingDirection * (goalHalfWidth + wallHalfThickness), goalHeight / 2, goalCenterZ],
        size: [COURT_WALL_THICKNESS, goalHeight, goalDepth],
      });
    }
    boundaries.push({
      id: `end-${endName}-lintel`,
      position: [0, goalHeight + (wallHeight - goalHeight) / 2, endZ],
      size: [goalHalfWidth * 2, wallHeight - goalHeight, COURT_WALL_THICKNESS],
    });
    boundaries.push({
      id: `goal-${endName}-back`,
      position: [0, goalHeight / 2, direction * (halfLength + goalDepth + wallHalfThickness)],
      size: [goalHalfWidth * 2, goalHeight, COURT_WALL_THICKNESS],
    });
    boundaries.push({
      id: `goal-${endName}-roof`,
      position: [0, goalHeight + wallHalfThickness, goalCenterZ],
      size: [goalHalfWidth * 2, COURT_WALL_THICKNESS, goalDepth],
    });
  }

  return boundaries;
}

/**
 * Resolve the platform quality contract without allowing invalid dimensions or
 * unbounded particle counts. A quality change affects presentation only.
 * @param {RiftballRenderQuality|RiftballQualityProfile} [profile="high"]
 * @returns {RiftballQualitySettings}
 */
export function resolveRiftballQuality(profile = "high") {
  const profileSettings = typeof profile === "object" && profile ? profile : {};
  const quality = typeof profile === "string"
    ? (["low", "medium", "high"].includes(profile) ? profile : "high")
    : (profileSettings.autoLowEndActive || profileSettings.autoTier === "low" ? "low" : "high");
  const reducedEffects = Boolean(profileSettings.reducedEffects || quality === "low");

  return {
    quality,
    resolutionScale: clampRiftballValue(finiteRiftballValue(profileSettings.resolutionScale, 1), 0.5, 1.5),
    targetFps: clampRiftballValue(finiteRiftballValue(profileSettings.targetFps, 60), 30, 120),
    reducedEffects,
    maxPixelRatio: quality === "low" ? 1 : quality === "medium" ? 1.4 : 1.8,
    shadows: quality !== "low",
    shadowMapSize: quality === "high" ? 2048 : 1024,
    particleLimit: reducedEffects ? 20 : quality === "medium" ? 48 : 72,
  };
}

/**
 * Damped third-person camera with stable attack-direction orientation. The ball
 * moves the framing and distance, never automatically rotates behind a player.
 * Returned view is owned by the controller and reused until its next update.
 * @returns {{update(frame:import("./renderer.js").RiftballRenderFrame,aspect:number):RiftballCameraView,reset():void}}
 */
export function createRiftballCameraController() {
  /** @type {RiftballCameraView} */
  const view = { x: 0, y: 5, z: 15, targetX: 0, targetY: 1, targetZ: 0, heading: Math.PI, fov: 58 };
  const candidate = { ...view };
  let ready = false;
  let followedPlayerId = "";
  let followedRoundId = null;
  let followedServeId = null;
  let replayActive = false;

  return {
    update(frame, aspect) {
      const players = Array.isArray(frame.players) ? frame.players : Object.values(frame.players || {});
      const player = players.find((playerState) => playerState.id === frame.playerId) || players[0];
      if (!player) return view;

      const ball = frame.ball || { x: 0, y: RIFTBALL_COURT.ballRadius, z: 0, serveId: 0 };
      const portraitFactor = clampRiftballValue((1.2 - finiteRiftballValue(aspect, 1.7)) / 0.65, 0, 1);
      const playerX = finiteRiftballValue(player.x);
      const playerY = Math.max(0, finiteRiftballValue(player.y));
      const playerZ = finiteRiftballValue(player.z);
      const baseHeading = player.index === 1 || player.id === "p2" ? 0 : Math.PI;
      const orbitYaw = finiteRiftballValue(frame.cameraOrbit?.yaw);
      const orbitPitch = clampRiftballValue(finiteRiftballValue(frame.cameraOrbit?.pitch), CAMERA_MIN_PITCH, CAMERA_MAX_PITCH);
      const heading = baseHeading + orbitYaw;
      const forwardX = Math.sin(heading);
      const forwardZ = Math.cos(heading);
      const ballDeltaX = finiteRiftballValue(ball.x) - playerX;
      const ballDeltaZ = finiteRiftballValue(ball.z) - playerZ;
      const ballDistance = Math.hypot(ballDeltaX, ballDeltaZ);
      const ballBehindDistance = Math.max(0, -(ballDeltaX * forwardX + ballDeltaZ * forwardZ));
      const behindFraming = clampRiftballValue((ballBehindDistance - 2) / 5, 0, 1);
      const framingDistance = Math.min(10, ballDistance) * (1 - behindFraming) + ballDistance * behindFraming;
      const focusWeight = ballDistance > 0 ? framingDistance / ballDistance * (0.32 + behindFraming * 0.28) : 0;
      const lateralBallDistance = ballDeltaX * forwardZ - ballDeltaZ * forwardX;
      const sideFraming = clampRiftballValue((Math.abs(lateralBallDistance) - 6) / 10, 0, 1);
      const adaptiveFraming = Math.max(behindFraming, sideFraming);
      const followDistance = Math.max(CAMERA_FOLLOW_DISTANCE + portraitFactor * 1.4 + Math.abs(lateralBallDistance) * portraitFactor * 0.35, ballBehindDistance + 2.2);
      const shoulderOffset = 0.9 * (1 - portraitFactor * 0.6);
      const lateralFraming = lateralBallDistance * adaptiveFraming * (0.25 + portraitFactor * 0.6);
      const desiredX = playerX - forwardX * followDistance + forwardZ * (shoulderOffset + lateralFraming);
      const desiredZ = playerZ - forwardZ * followDistance - forwardX * (shoulderOffset + lateralFraming);
      const maximumX = RIFTBALL_COURT.halfWidth - CAMERA_WALL_CLEARANCE;
      const maximumZ = RIFTBALL_COURT.halfLength - CAMERA_WALL_CLEARANCE;
      const boundedX = clampRiftballValue(desiredX, -maximumX, maximumX);
      const boundedZ = clampRiftballValue(desiredZ, -maximumZ, maximumZ);
      const wallCompression = Math.hypot(desiredX - boundedX, desiredZ - boundedZ);
      const desiredY = Math.min(CAMERA_MAX_ELEVATION, CAMERA_FOLLOW_HEIGHT + playerY * 0.32 + portraitFactor * 0.9 + orbitPitch * 5 + wallCompression * 0.66 + ballBehindDistance * (0.07 + behindFraming * 0.38) + sideFraming * 3);
      const forwardFraming = 1.3 * (1 - behindFraming);
      let targetX = playerX + forwardX * forwardFraming + ballDeltaX * focusWeight;
      let targetZ = playerZ + forwardZ * forwardFraming + ballDeltaZ * focusWeight;
      let targetY = 1.12 + playerY * 0.5 + clampRiftballValue(finiteRiftballValue(ball.y) - 0.4, 0, 7) * (0.19 + behindFraming * 0.17);
      if (adaptiveFraming > 0) {
        const playerDirectionX = playerX - boundedX;
        const playerDirectionY = playerY + 0.95 - desiredY;
        const playerDirectionZ = playerZ - boundedZ;
        const playerDistance = Math.max(0.1, Math.hypot(playerDirectionX, playerDirectionY, playerDirectionZ));
        const ballDirectionX = ball.x - boundedX;
        const ballDirectionY = ball.y - desiredY;
        const ballDirectionZ = ball.z - boundedZ;
        const cameraBallDistance = Math.max(0.1, Math.hypot(ballDirectionX, ballDirectionY, ballDirectionZ));
        const angularTargetX = boundedX + (playerDirectionX / playerDistance + ballDirectionX / cameraBallDistance) * 6;
        const angularTargetY = desiredY + (playerDirectionY / playerDistance + ballDirectionY / cameraBallDistance) * 6;
        const angularTargetZ = boundedZ + (playerDirectionZ / playerDistance + ballDirectionZ / cameraBallDistance) * 6;
        targetX += (angularTargetX - targetX) * adaptiveFraming;
        targetY += (angularTargetY - targetY) * adaptiveFraming;
        targetZ += (angularTargetZ - targetZ) * adaptiveFraming;
      }
      candidate.x = boundedX;
      candidate.y = desiredY;
      candidate.z = boundedZ;
      candidate.targetX = targetX;
      candidate.targetY = targetY;
      candidate.targetZ = targetZ;
      const framingFov = getRiftballFramingFov(candidate, player, ball, aspect, 58 + portraitFactor * 10 + behindFraming * 4);
      const nextReplay = Boolean(frame.replay);
      const snap = !ready || frame.playerId !== followedPlayerId || frame.roundId !== followedRoundId || ball.serveId !== followedServeId || replayActive !== nextReplay;
      const dtSec = clampRiftballValue(finiteRiftballValue(frame.dtSec, 1 / 60), 0, 0.06);
      const blend = snap ? 1 : 1 - Math.exp(-dtSec * (frame.reducedMotion ? 11 : 7.5));

      view.x += (boundedX - view.x) * blend;
      view.y += (desiredY - view.y) * blend;
      view.z += (boundedZ - view.z) * blend;
      view.targetX += (targetX - view.targetX) * blend;
      view.targetY += (targetY - view.targetY) * blend;
      view.targetZ += (targetZ - view.targetZ) * blend;
      view.fov += (framingFov - view.fov) * blend;
      view.heading = Math.atan2(view.targetX - view.x, view.targetZ - view.z);
      ready = true;
      followedPlayerId = frame.playerId;
      followedRoundId = frame.roundId;
      followedServeId = ball.serveId;
      replayActive = nextReplay;
      return view;
    },
    reset() {
      ready = false;
    },
  };
}

/**
 * Reusable, fixed-size ball trail history. Serve/round changes and teleports
 * clear old points before emission, so a restart never draws a court-wide tail.
 * Samples are borrowed until the next update; no per-frame array is allocated.
 * @param {number} [maximumSamples=24]
 */
export function createRiftballTrailHistory(maximumSamples = 24) {
  const capacity = Math.round(clampRiftballValue(finiteRiftballValue(maximumSamples, 24), 1, 32));
  const samples = Array.from({ length: capacity }, () => ({ x: 0, y: 0, z: 0, ageSec: 0 }));
  let count = 0;
  let previousServeId = null;
  let previousRoundId = null;
  let previousX = 0;
  let previousY = 0;
  let previousZ = 0;
  let emittedX = 0;
  let emittedY = 0;
  let emittedZ = 0;
  let ready = false;

  return {
    update(ball, dtSec, { roundId, reducedMotion = false, limit = capacity } = {}) {
      const frameDtSec = clampRiftballValue(finiteRiftballValue(dtSec), 0, 0.1);
      const deltaDistance = Math.hypot(ball.x - previousX, ball.y - previousY, ball.z - previousZ);
      const reset = !ready || previousServeId !== ball.serveId || previousRoundId !== roundId || deltaDistance > 8;
      const sampleLimit = Math.round(clampRiftballValue(finiteRiftballValue(limit, capacity), 0, capacity));
      if (reset || reducedMotion || sampleLimit === 0) {
        count = 0;
        emittedX = ball.x;
        emittedY = ball.y;
        emittedZ = ball.z;
      }

      let liveCount = 0;
      for (let sampleIndex = 0; sampleIndex < count; sampleIndex += 1) {
        const sample = samples[sampleIndex];
        const ageSec = sample.ageSec + frameDtSec;
        if (ageSec > 0.2) continue;
        const liveSample = samples[liveCount];
        liveSample.x = sample.x;
        liveSample.y = sample.y;
        liveSample.z = sample.z;
        liveSample.ageSec = ageSec;
        liveCount += 1;
      }
      count = liveCount;
      const speed = Math.hypot(ball.vx || 0, ball.vy || 0, ball.vz || 0);
      const emittedDistance = Math.hypot(ball.x - emittedX, ball.y - emittedY, ball.z - emittedZ);
      if (!reset && !reducedMotion && emittedDistance > 0.075 && speed > 2.5 && sampleLimit > 0) {
        if (count >= sampleLimit) {
          const discardedCount = count - sampleLimit + 1;
          for (let sampleIndex = discardedCount; sampleIndex < count; sampleIndex += 1) {
            Object.assign(samples[sampleIndex - discardedCount], samples[sampleIndex]);
          }
          count -= discardedCount;
        }
        const sample = samples[count];
        sample.x = ball.x;
        sample.y = ball.y;
        sample.z = ball.z;
        sample.ageSec = 0;
        count += 1;
        emittedX = ball.x;
        emittedY = ball.y;
        emittedZ = ball.z;
      }
      if (count > sampleLimit) count = sampleLimit;
      previousServeId = ball.serveId;
      previousRoundId = roundId;
      previousX = ball.x;
      previousY = ball.y;
      previousZ = ball.z;
      ready = true;
    },
    getCount() {
      return count;
    },
    getSample(index) {
      return index >= 0 && index < count ? samples[index] : null;
    },
    reset() {
      count = 0;
      ready = false;
    },
  };
}
