import * as THREE from "three";
import { createLastFuseCityView } from "./cityView.js";
import { createLastFuseRunnerViews } from "./runnerView.js";
import { createLastFuseEffects } from "./effects.js";

/** @typedef {import("../client/snapshotPose.js").LastFusePresentedRunner} LastFusePresentedRunner */
/** @typedef {import("../client/matchEvents.js").LastFuseMatchEvent} LastFuseMatchEvent */
/**
 * Borrowed per-frame presentation state. The renderer never mutates it and
 * never feeds anything back into simulation.
 * @typedef {object} LastFuseRenderFrame
 * @property {number} dtSec Render cadence delta, already capped by the caller.
 * @property {number} timeSec Monotonic presentation clock.
 * @property {string} playerId Local runner ID; the camera follows it.
 * @property {readonly LastFusePresentedRunner[]} runners
 * @property {Readonly<import("../shared/city.js").LastFuseCityState>} city
 * @property {Readonly<import("../shared/match.js").LastFuseBomb>} bomb
 * @property {import("../shared/config.js").LastFusePhase} phase
 * @property {readonly LastFuseMatchEvent[]} events
 * @property {boolean} reducedMotion
 */
/** @typedef {{quality:"low"|"high",resolutionScale:number,maxPixelRatio:number,shadows:boolean,shadowMapSize:number,sparkBudget:number}} LastFuseRenderQuality */

const RENDER_PIXEL_BUDGET = 2200000;
const CAMERA_PITCH_RAD = 0.6;
const CAMERA_DISTANCE_M = 11.5;
const CAMERA_FOLLOW_PER_SEC = 7;
const CAMERA_TURN_PER_SEC = 7;
const CAMERA_LOOK_HEIGHT_M = 1.2;
const SPECTATE_HEIGHT_M = 18;

/**
 * Map the platform's runtime performance profile to renderer settings.
 * @param {object|string} [profile]
 * @returns {LastFuseRenderQuality}
 */
export function resolveLastFuseQuality(profile = "high") {
  const settings = typeof profile === "object" && profile ? profile : {};
  const quality = profile === "low" || settings.autoLowEndActive || settings.autoTier === "low" ? "low" : "high";
  const reducedEffects = Boolean(settings.reducedEffects || quality === "low");
  const resolutionScale = Number.isFinite(settings.resolutionScale) ? Math.max(0.5, Math.min(1.5, settings.resolutionScale)) : 1;
  return {
    quality,
    resolutionScale,
    maxPixelRatio: quality === "low" ? 1 : 1.8,
    shadows: quality !== "low",
    shadowMapSize: 2048,
    sparkBudget: reducedEffects ? 30 : 90,
  };
}

/**
 * Canvas-only rooftop renderer with a chase camera behind the local runner.
 * The caller owns DOM, input, scheduling, networking and HUD.
 * @param {{canvas:HTMLCanvasElement}} options
 */
export function createLastFuseRenderer({ canvas }) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: true, powerPreference: "high-performance", stencil: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#0b0f1c");
  scene.fog = new THREE.Fog("#141a2b", 40, 190);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
  scene.add(new THREE.HemisphereLight("#8095c8", "#1a1410", 1.1));
  const moon = new THREE.DirectionalLight("#c7d6ff", 1.6);
  moon.position.set(-30, 60, 20);
  moon.castShadow = true;
  Object.assign(moon.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 10, far: 140 });
  moon.shadow.bias = -0.0004;
  moon.shadow.normalBias = 0.04;
  scene.add(moon, moon.target);
  const cityGlow = new THREE.PointLight("#ff8a3c", 30, 70, 1.6);
  cityGlow.position.set(0, 4, 0);
  scene.add(cityGlow);
  const bombLight = new THREE.PointLight("#ff4a1c", 0, 9, 1.8);
  scene.add(bombLight);

  const cityView = createLastFuseCityView(scene);
  const runnerViews = createLastFuseRunnerViews(scene);
  const effects = createLastFuseEffects(scene);
  const focus = new THREE.Vector3();
  const desiredFocus = new THREE.Vector3();
  const projected = new THREE.Vector3();
  const projection = { x: 0, y: 0, visible: false };
  let quality = resolveLastFuseQuality();
  let cameraHeading = 0;
  let targetHeading = 0;
  let cameraInitialized = false;
  let viewportWidth = 1;
  let viewportHeight = 1;

  function applyPixelRatio() {
    const budgetRatio = Math.sqrt(RENDER_PIXEL_BUDGET / Math.max(1, viewportWidth * viewportHeight));
    const pixelRatio = Math.max(0.5, Math.min((window.devicePixelRatio || 1) * quality.resolutionScale, quality.maxPixelRatio, budgetRatio));
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(viewportWidth, viewportHeight, false);
  }

  /**
   * Follow the local runner from behind; while out, watch the bomb holder.
   * @param {LastFuseRenderFrame} frame
   */
  function updateCamera(frame) {
    const local = frame.runners.find((runner) => runner.id === frame.playerId);
    const holder = frame.bomb.holderId ? frame.runners.find((runner) => runner.id === frame.bomb.holderId) : null;
    const spectating = !local || local.eliminated;
    const subject = spectating ? holder : local;
    if (subject) desiredFocus.set(subject.x, Math.max(subject.y, 14), subject.z);
    else desiredFocus.set(0, SPECTATE_HEIGHT_M, 0);
    if (local?.fallen) desiredFocus.y = Math.max(desiredFocus.y, 16);

    const follow = cameraInitialized ? Math.min(1, frame.dtSec * CAMERA_FOLLOW_PER_SEC) : 1;
    const turn = cameraInitialized ? Math.min(1, frame.dtSec * CAMERA_TURN_PER_SEC) : 1;
    cameraInitialized = true;
    focus.lerp(desiredFocus, follow);
    cameraHeading += Math.atan2(Math.sin(targetHeading - cameraHeading), Math.cos(targetHeading - cameraHeading)) * turn;

    const distance = CAMERA_DISTANCE_M * (spectating ? 1.5 : 1) * (viewportWidth < viewportHeight ? 1.35 : 1);
    const horizontal = Math.cos(CAMERA_PITCH_RAD) * distance;
    camera.position.set(
      focus.x - Math.sin(cameraHeading) * horizontal,
      focus.y + CAMERA_LOOK_HEIGHT_M + Math.sin(CAMERA_PITCH_RAD) * distance,
      focus.z - Math.cos(cameraHeading) * horizontal,
    );
    const shake = effects.getShake();
    if (shake > 0) {
      camera.position.x += (Math.random() - 0.5) * shake;
      camera.position.y += (Math.random() - 0.5) * shake;
    }
    camera.lookAt(focus.x, focus.y + CAMERA_LOOK_HEIGHT_M, focus.z);
    moon.target.position.set(focus.x, 0, focus.z);
    moon.position.set(focus.x - 30, 60, focus.z + 20);
  }

  return {
    /** @param {number} width CSS pixels @param {number} height CSS pixels */
    resize(width, height) {
      viewportWidth = Math.max(1, Math.round(width));
      viewportHeight = Math.max(1, Math.round(height));
      camera.aspect = viewportWidth / viewportHeight;
      camera.updateProjectionMatrix();
      applyPixelRatio();
    },
    /** @param {object|string} profile Platform runtime performance profile. */
    setQuality(profile) {
      quality = resolveLastFuseQuality(profile);
      renderer.shadowMap.enabled = quality.shadows;
      moon.castShadow = quality.shadows;
      moon.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
      moon.shadow.map?.dispose();
      moon.shadow.map = null;
      applyPixelRatio();
    },
    /** @param {LastFuseRenderFrame} frame */
    render(frame) {
      cityView.update(frame.city, frame.timeSec, frame.reducedMotion);
      effects.spawn(frame.events, frame.reducedMotion, quality.sparkBudget, frame.city.seed, frame.city.crumblingRoofId);
      updateCamera(frame);
      const fuseFraction = frame.bomb.fuseTotalSec > 0 ? frame.bomb.fuseSec / frame.bomb.fuseTotalSec : 1;
      const holderId = frame.phase === "playing" ? frame.bomb.holderId : null;
      const bombPosition = runnerViews.update(frame.runners, frame.playerId, holderId, fuseFraction, camera, frame.timeSec, frame.dtSec, frame.reducedMotion);
      bombLight.intensity = bombPosition ? 6 + (1 - fuseFraction) * 10 + Math.sin(frame.timeSec * 30) * 2 : 0;
      if (bombPosition) bombLight.position.copy(bombPosition);
      effects.update(frame.dtSec, bombPosition);
      renderer.render(scene, camera);
    },
    /** Camera heading used to turn screen-relative movement into world axes. */
    getCameraHeading: () => targetHeading,
    /** Smoothed heading the camera currently looks along, for the minimap. */
    getViewHeading: () => cameraHeading,
    /** Snap the camera heading, for a new round or spawn. @param {number} heading */
    setCameraHeading(heading) {
      if (!Number.isFinite(heading)) return;
      targetHeading = heading;
      cameraHeading = heading;
    },
    /** Turn the camera by a step; movement follows the target heading at once. @param {number} deltaRad */
    turnCamera(deltaRad) {
      if (Number.isFinite(deltaRad)) targetHeading += deltaRad;
    },
    /**
     * Project a world point into normalised viewport coordinates.
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @returns {{x:number,y:number,visible:boolean}} Reused output; copy before the next call.
     */
    project(x, y, z) {
      projected.set(x, y, z).project(camera);
      projection.visible = projected.z < 1;
      projection.x = (projected.x + 1) / 2;
      projection.y = (1 - projected.y) / 2;
      return projection;
    },
    clearEffects: () => effects.clear(),
    dispose() {
      cityView.dispose();
      runnerViews.dispose();
      effects.dispose();
      moon.shadow.map?.dispose();
      renderer.dispose();
    },
  };
}
