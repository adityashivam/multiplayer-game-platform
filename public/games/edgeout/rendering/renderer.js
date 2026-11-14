import * as THREE from "three";
import { createEdgeoutArenaView } from "./arenaView.js";
import { createEdgeoutFighterViews } from "./fighterView.js";
import { createEdgeoutEffects } from "./effects.js";

/** @typedef {import("../client/snapshotPose.js").EdgeoutPresentedFighter} EdgeoutPresentedFighter */
/** @typedef {import("../client/matchEvents.js").EdgeoutMatchEvent} EdgeoutMatchEvent */
/** @typedef {import("../shared/arena.js").EdgeoutArena} EdgeoutArena */
/**
 * Borrowed per-frame presentation state. The renderer never mutates it and
 * never feeds anything back into simulation.
 * @typedef {object} EdgeoutRenderFrame
 * @property {number} dtSec Render cadence delta, already capped by the caller.
 * @property {number} timeSec Monotonic presentation clock.
 * @property {string} playerId Local fighter ID, for highlighting.
 * @property {number} cameraHeading Seat heading; zero looks along +Z.
 * @property {readonly EdgeoutPresentedFighter[]} fighters
 * @property {Readonly<EdgeoutArena>} arena
 * @property {string} roundIdentity Changes when a round respawns everyone.
 * @property {readonly EdgeoutMatchEvent[]} events
 * @property {boolean} reducedMotion
 */
/**
 * @typedef {{quality:"low"|"medium"|"high",resolutionScale:number,maxPixelRatio:number,shadows:boolean,shadowMapSize:number,particleLimit:number}} EdgeoutRenderQuality
 */

const RENDER_PIXEL_BUDGET = 2200000;
const CAMERA_PITCH_RAD = 0.92;
const CAMERA_FOLLOW_PER_SEC = 4;
const MIN_CAMERA_DISTANCE = 13;
const MAX_CAMERA_DISTANCE = 19;
const ARENA_FOCUS_WEIGHT = 0.45;
/** Aim slightly above the floor so the near edge and its fighter stay in frame. */
const CAMERA_LOOK_HEIGHT = 0.9;

/**
 * Map the platform's runtime performance profile to renderer settings.
 * @param {object|string} [profile]
 * @returns {EdgeoutRenderQuality}
 */
export function resolveEdgeoutQuality(profile = "high") {
  const settings = typeof profile === "object" && profile ? profile : {};
  const quality = typeof profile === "string"
    ? (["low", "medium", "high"].includes(profile) ? profile : "high")
    : (settings.autoLowEndActive || settings.autoTier === "low" ? "low" : "high");
  const reducedEffects = Boolean(settings.reducedEffects || quality === "low");
  const resolutionScale = Number.isFinite(settings.resolutionScale) ? Math.max(0.5, Math.min(1.5, settings.resolutionScale)) : 1;
  return {
    quality,
    resolutionScale,
    maxPixelRatio: quality === "low" ? 1 : quality === "medium" ? 1.4 : 1.8,
    shadows: quality !== "low",
    shadowMapSize: quality === "high" ? 2048 : 1024,
    particleLimit: reducedEffects ? 8 : 26,
  };
}

/**
 * Canvas-only sky-arena renderer. The caller owns DOM, input, scheduling,
 * networking and HUD; this object owns its scene and GPU resources.
 * @param {{canvas:HTMLCanvasElement}} options
 */
export function createEdgeoutRenderer({ canvas }) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: true, powerPreference: "high-performance", stencil: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#0b1124");
  scene.fog = new THREE.Fog("#0d1630", 30, 95);
  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 220);
  scene.add(new THREE.HemisphereLight("#cfe2ff", "#2a2140", 1.6));
  const keyLight = new THREE.DirectionalLight("#fff1d6", 2.8);
  keyLight.position.set(-7, 16, 9);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  Object.assign(keyLight.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 50 });
  keyLight.shadow.bias = -0.0002;
  keyLight.shadow.normalBias = 0.03;
  const rimLight = new THREE.DirectionalLight("#7a6cff", 1.2);
  rimLight.position.set(8, 6, -10);
  scene.add(keyLight, keyLight.target, rimLight);

  const arenaView = createEdgeoutArenaView(scene);
  const fighterViews = createEdgeoutFighterViews(scene);
  const effects = createEdgeoutEffects(scene);
  const cameraFocus = new THREE.Vector3();
  const desiredFocus = new THREE.Vector3();
  const cameraPosition = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const floorHit = new THREE.Vector3();
  let quality = resolveEdgeoutQuality();
  let cameraDistance = MIN_CAMERA_DISTANCE;
  let cameraHeading = Math.PI;
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
   * Frame the standing fighters and the arena centre. Distance grows with
   * their spread and on narrow screens; position follows with damping.
   * @param {EdgeoutRenderFrame} frame
   */
  function updateCamera(frame) {
    let count = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    desiredFocus.set(0, 0, 0);
    for (const fighter of frame.fighters) {
      if (fighter.eliminated || fighter.y < -3) continue;
      desiredFocus.x += fighter.x;
      desiredFocus.z += fighter.z;
      minX = Math.min(minX, fighter.x);
      maxX = Math.max(maxX, fighter.x);
      minZ = Math.min(minZ, fighter.z);
      maxZ = Math.max(maxZ, fighter.z);
      count += 1;
    }
    const spread = count > 1 ? Math.hypot(maxX - minX, maxZ - minZ) : 0;
    if (count > 0) desiredFocus.multiplyScalar((1 - ARENA_FOCUS_WEIGHT) / count);
    const aspect = viewportWidth / Math.max(1, viewportHeight);
    const portraitScale = aspect < 1 ? 1.45 : aspect < 1.4 ? 1.15 : 1;
    const desiredDistance = Math.min(MAX_CAMERA_DISTANCE, MIN_CAMERA_DISTANCE + spread * 0.45) * portraitScale;
    const follow = cameraInitialized ? Math.min(1, frame.dtSec * CAMERA_FOLLOW_PER_SEC) : 1;
    cameraInitialized = true;
    cameraHeading = frame.cameraHeading;
    cameraFocus.lerp(desiredFocus, follow);
    cameraDistance += (desiredDistance - cameraDistance) * follow;

    const horizontal = Math.cos(CAMERA_PITCH_RAD) * cameraDistance;
    cameraPosition.set(
      cameraFocus.x - Math.sin(cameraHeading) * horizontal,
      Math.sin(CAMERA_PITCH_RAD) * cameraDistance,
      cameraFocus.z - Math.cos(cameraHeading) * horizontal,
    );
    const shake = effects.getShake();
    if (shake > 0) {
      cameraPosition.x += (Math.random() - 0.5) * shake;
      cameraPosition.y += (Math.random() - 0.5) * shake;
    }
    camera.position.copy(cameraPosition);
    camera.lookAt(cameraFocus.x, CAMERA_LOOK_HEIGHT, cameraFocus.z);
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
      quality = resolveEdgeoutQuality(profile);
      renderer.shadowMap.enabled = quality.shadows;
      keyLight.castShadow = quality.shadows;
      keyLight.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
      keyLight.shadow.map?.dispose();
      keyLight.shadow.map = null;
      arenaView.setShadows(quality.shadows);
      applyPixelRatio();
    },
    /** @param {EdgeoutRenderFrame} frame */
    render(frame) {
      arenaView.update(frame.arena, frame.roundIdentity, frame.timeSec, frame.dtSec, frame.reducedMotion);
      effects.spawn(frame.events, frame.reducedMotion, quality.particleLimit);
      effects.update(frame.dtSec);
      updateCamera(frame);
      fighterViews.update(frame.fighters, frame.playerId, camera, frame.timeSec, frame.dtSec, frame.reducedMotion);
      renderer.render(scene, camera);
    },
    /** Seat heading used to turn screen-relative movement into world axes. */
    getCameraHeading: () => cameraHeading,
    /** Set the seat heading before the first frame so early input maps correctly. */
    setCameraHeading(heading) {
      if (Number.isFinite(heading)) cameraHeading = heading;
    },
    /**
     * Intersect a pointer with the arena floor plane.
     * @param {number} clientX
     * @param {number} clientY
     * @returns {{x:number,z:number}|null} World X/Z, or null when the ray misses.
     */
    projectPointerToGround(clientX, clientY) {
      const bounds = canvas.getBoundingClientRect();
      if (bounds.width <= 0 || bounds.height <= 0) return null;
      pointerNdc.set(((clientX - bounds.left) / bounds.width) * 2 - 1, -((clientY - bounds.top) / bounds.height) * 2 + 1);
      raycaster.setFromCamera(pointerNdc, camera);
      return raycaster.ray.intersectPlane(floorPlane, floorHit) ? { x: floorHit.x, z: floorHit.z } : null;
    },
    clearEffects: () => effects.clear(),
    dispose() {
      arenaView.dispose();
      fighterViews.dispose();
      effects.dispose();
      keyLight.shadow.map?.dispose();
      renderer.dispose();
    },
  };
}
