import * as THREE from "three";
import { createDriftlineEnvironment } from "./environment.js";
import { createDriftlineRoad } from "./roadMesh.js";
import { createDriftlineCarViews } from "./carView.js";
import { createDriftlineEffects } from "./effects.js";

/** @typedef {import("../shared/track.js").DriftlineTrack} DriftlineTrack */
/** @typedef {import("../client/snapshotPose.js").DriftlinePresentedCar} DriftlinePresentedCar */
/** @typedef {import("../client/raceEvents.js").DriftlineRaceEvent} DriftlineRaceEvent */
/**
 * Borrowed per-frame presentation state; never mutated by the renderer.
 * @typedef {object} DriftlineRenderFrame
 * @property {number} dtSec
 * @property {number} timeSec
 * @property {string} playerId
 * @property {readonly DriftlinePresentedCar[]} cars
 * @property {readonly DriftlineRaceEvent[]} events
 * @property {string} roundIdentity Changes on rematch.
 * @property {boolean} reducedMotion
 * @typedef {{quality:"low"|"medium"|"high",resolutionScale:number,maxPixelRatio:number,shadows:boolean,shadowMapSize:number,smokeScale:number}} DriftlineRenderQuality
 */

const RENDER_PIXEL_BUDGET = 2400000;
const CAMERA_DISTANCE_M = 6.6;
const CAMERA_HEIGHT_M = 2.3;
const CAMERA_LOOK_AHEAD_M = 5;
const BASE_FOV = 62;
const SPEED_FOV_GAIN = 0.22;
const BOOST_FOV = 7;
const CAMERA_FOLLOW_PER_SEC = 7;
const CAMERA_SWING_SHARE = 0.55;
const SHADOW_FRUSTUM_M = 34;

/**
 * Map the platform runtime performance profile to renderer settings.
 * @param {object|string} [profile]
 * @returns {DriftlineRenderQuality}
 */
export function resolveDriftlineQuality(profile = "high") {
  const settings = typeof profile === "object" && profile ? profile : {};
  const quality = typeof profile === "string"
    ? (["low", "medium", "high"].includes(profile) ? profile : "high")
    : (settings.autoLowEndActive || settings.autoTier === "low" ? "low" : "high");
  const reducedEffects = Boolean(settings.reducedEffects || quality === "low");
  return {
    quality,
    resolutionScale: Number.isFinite(settings.resolutionScale) ? Math.max(0.5, Math.min(1.5, settings.resolutionScale)) : 1,
    maxPixelRatio: quality === "low" ? 1 : quality === "medium" ? 1.4 : 1.8,
    shadows: quality !== "low",
    shadowMapSize: quality === "high" ? 2048 : 1024,
    smokeScale: reducedEffects ? 0.35 : 1,
  };
}

/** @param {number} angle */
function wrapDriftlineAngle(angle) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/**
 * Canvas-only race renderer for one track. The caller owns DOM, input,
 * networking and HUD; this object owns its scene and GPU resources.
 * @param {{canvas:HTMLCanvasElement,track:Readonly<DriftlineTrack>}} options
 */
export function createDriftlineRenderer({ canvas, track }) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: true, powerPreference: "high-performance", stencil: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog("#e7a37a", 160, 900);
  const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.2, 5000);
  const environment = createDriftlineEnvironment(scene, renderer, track);
  scene.add(new THREE.HemisphereLight("#ffd2b0", "#4a3a3a", 0.9));
  const sun = new THREE.DirectionalLight("#ffb07a", 3.2);
  sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -SHADOW_FRUSTUM_M, right: SHADOW_FRUSTUM_M, top: SHADOW_FRUSTUM_M, bottom: -SHADOW_FRUSTUM_M, near: 1, far: 260 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  const road = createDriftlineRoad(scene, track);
  const carViews = createDriftlineCarViews(scene);
  const effects = createDriftlineEffects(scene);

  const cameraPosition = new THREE.Vector3();
  const cameraTarget = new THREE.Vector3();
  const desiredPosition = new THREE.Vector3();
  const desiredTarget = new THREE.Vector3();
  let quality = resolveDriftlineQuality();
  let viewportWidth = 1;
  let viewportHeight = 1;
  let cameraHeading = Math.atan2(track.tangentX[0], track.tangentZ[0]);
  let cameraReady = false;
  let presentedIdentity = "";

  function applyPixelRatio() {
    const budgetRatio = Math.sqrt(RENDER_PIXEL_BUDGET / Math.max(1, viewportWidth * viewportHeight));
    renderer.setPixelRatio(Math.max(0.5, Math.min((window.devicePixelRatio || 1) * quality.resolutionScale, quality.maxPixelRatio, budgetRatio)));
    renderer.setSize(viewportWidth, viewportHeight, false);
  }

  /**
   * Chase camera that swings partway toward the direction of travel, so a
   * drift shows its angle, and widens its view with speed and boost.
   * @param {DriftlinePresentedCar|undefined} car
   * @param {number} dtSec
   */
  function updateCamera(car, dtSec) {
    if (!car) {
      camera.position.set(track.x[0] - 30, track.y[0] + 18, track.z[0] - 30);
      camera.lookAt(track.x[0], track.y[0], track.z[0]);
      return;
    }
    const speed = Math.hypot(car.vx, car.vz);
    const travelHeading = speed > 3 ? Math.atan2(car.vx, car.vz) : car.yaw;
    const swing = wrapDriftlineAngle(travelHeading - car.yaw) * CAMERA_SWING_SHARE;
    const targetHeading = car.yaw + swing;
    const follow = cameraReady ? Math.min(1, dtSec * CAMERA_FOLLOW_PER_SEC) : 1;
    cameraHeading = wrapDriftlineAngle(cameraHeading + wrapDriftlineAngle(targetHeading - cameraHeading) * follow);
    const distance = CAMERA_DISTANCE_M + speed * 0.03;
    desiredPosition.set(car.x - Math.sin(cameraHeading) * distance, car.y + CAMERA_HEIGHT_M, car.z - Math.cos(cameraHeading) * distance);
    desiredTarget.set(car.x + Math.sin(cameraHeading) * CAMERA_LOOK_AHEAD_M, car.y + 0.9, car.z + Math.cos(cameraHeading) * CAMERA_LOOK_AHEAD_M);
    if (!cameraReady) {
      cameraPosition.copy(desiredPosition);
      cameraTarget.copy(desiredTarget);
      cameraReady = true;
    } else {
      cameraPosition.lerp(desiredPosition, Math.min(1, dtSec * CAMERA_FOLLOW_PER_SEC * 1.4));
      cameraTarget.lerp(desiredTarget, Math.min(1, dtSec * CAMERA_FOLLOW_PER_SEC * 2));
    }
    camera.position.copy(cameraPosition);
    camera.lookAt(cameraTarget);
    const targetFov = BASE_FOV + speed * SPEED_FOV_GAIN + (car.boostSec > 0 ? BOOST_FOV : 0);
    camera.fov += (targetFov - camera.fov) * Math.min(1, dtSec * 3);
    camera.updateProjectionMatrix();

    sun.position.set(car.x + environment.sunDirection.x * 120, car.y + Math.max(40, environment.sunDirection.y * 120), car.z + environment.sunDirection.z * 120);
    sun.target.position.set(car.x, car.y, car.z);
  }

  return {
    /** @param {number} width @param {number} height CSS pixels */
    resize(width, height) {
      viewportWidth = Math.max(1, Math.round(width));
      viewportHeight = Math.max(1, Math.round(height));
      camera.aspect = viewportWidth / viewportHeight;
      camera.updateProjectionMatrix();
      applyPixelRatio();
    },
    /** @param {object|string} profile Platform runtime performance profile. */
    setQuality(profile) {
      quality = resolveDriftlineQuality(profile);
      renderer.shadowMap.enabled = quality.shadows;
      sun.castShadow = quality.shadows;
      sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
      applyPixelRatio();
    },
    /** @param {DriftlineRenderFrame} frame */
    render(frame) {
      if (frame.roundIdentity !== presentedIdentity) {
        presentedIdentity = frame.roundIdentity;
        effects.clear();
        cameraReady = false;
      }
      const localCar = frame.cars.find((car) => car.id === frame.playerId);
      environment.update(frame.timeSec);
      updateCamera(localCar, frame.dtSec);
      carViews.update(frame.cars, frame.playerId, camera, frame.dtSec);
      const pixelScale = (viewportHeight * renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
      effects.update(frame.cars, frame.events, frame.timeSec, frame.dtSec, pixelScale,
        frame.reducedMotion ? quality.smokeScale * 0.5 : quality.smokeScale, camera.position, renderer.getPixelRatio());
      renderer.render(scene, camera);
    },
    dispose() {
      environment.dispose();
      road.dispose();
      carViews.dispose();
      effects.dispose();
      sun.shadow.map?.dispose();
      renderer.dispose();
    },
  };
}
