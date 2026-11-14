import * as THREE from "three";
import { createBumperLinksCourseView } from "./courseView.js";
import { createBumperLinksBallViews } from "./ballView.js";
import { createBumperLinksEffects } from "./effects.js";

/** @typedef {import("../client/snapshotPose.js").BumperLinksPresentedBall} BumperLinksPresentedBall */
/** @typedef {import("../client/matchEvents.js").BumperLinksClientEvent} BumperLinksClientEvent */
/** @typedef {import("../shared/course.js").BumperLinksCourse} BumperLinksCourse */
/**
 * Borrowed per-frame presentation state. The renderer never mutates it and
 * never feeds anything back into simulation.
 * @typedef {object} BumperLinksRenderFrame
 * @property {number} dtSec Render cadence delta, already capped by the caller.
 * @property {number} timeSec Monotonic presentation clock.
 * @property {string} playerId Local ball ID; the camera follows it.
 * @property {Readonly<BumperLinksCourse>} course
 * @property {readonly BumperLinksPresentedBall[]} balls
 * @property {number} holeTimeSec Interpolated hole clock for sweepers.
 * @property {import("../shared/config.js").BumperLinksPhase} phase
 * @property {readonly BumperLinksClientEvent[]} events
 * @property {boolean} ready Local ball can be putted now.
 * @property {{points:readonly import("../client/aim.js").BumperLinksAimPoint[],count:number,power:number}|null} aim
 * @property {boolean} reducedMotion
 * @typedef {{quality:"low"|"high",resolutionScale:number,maxPixelRatio:number,shadows:boolean,shadowMapSize:number}} BumperLinksRenderQuality
 */

const RENDER_PIXEL_BUDGET = 2200000;
const CAMERA_PITCH_RAD = 0.52;
const CAMERA_DISTANCE_M = 6.2;
const CAMERA_LOOK_HEIGHT_M = 0.4;
const CAMERA_FOLLOW_PER_SEC = 5;
const CAMERA_TURN_PER_SEC = 6;
const OVERVIEW_PITCH_RAD = 0.95;
const OVERVIEW_DISTANCE_SCALE = 1.05;
const OVERVIEW_MIN_DISTANCE_M = 16;

/**
 * Map the platform's runtime performance profile to renderer settings.
 * @param {object|string} [profile]
 * @returns {BumperLinksRenderQuality}
 */
export function resolveBumperLinksQuality(profile = "high") {
  const settings = typeof profile === "object" && profile ? profile : {};
  const quality = profile === "low" || settings.autoLowEndActive || settings.autoTier === "low" ? "low" : "high";
  const resolutionScale = Number.isFinite(settings.resolutionScale) ? Math.max(0.5, Math.min(1.5, settings.resolutionScale)) : 1;
  return {
    quality,
    resolutionScale,
    maxPixelRatio: quality === "low" ? 1 : 1.8,
    shadows: quality !== "low",
    shadowMapSize: 2048,
  };
}

/**
 * Canvas-only sunny course renderer. The camera sits behind the local ball
 * along its aim; once the ball is in the cup it pulls up to an overview.
 * The caller owns DOM, input, scheduling, networking and HUD.
 * @param {{canvas:HTMLCanvasElement}} options
 */
export function createBumperLinksRenderer({ canvas }) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: true, powerPreference: "high-performance", stencil: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#8fd3ff");
  scene.fog = new THREE.Fog("#a9ddff", 45, 170);
  const camera = new THREE.PerspectiveCamera(52, 1, 0.05, 400);
  scene.add(new THREE.HemisphereLight("#e8f6ff", "#3c6b45", 1.25));
  const sun = new THREE.DirectionalLight("#fff3d6", 2.1);
  sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 5, far: 90 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  const courseView = createBumperLinksCourseView(scene);
  const ballViews = createBumperLinksBallViews(scene);
  const effects = createBumperLinksEffects(scene);
  const focus = new THREE.Vector3();
  const desiredFocus = new THREE.Vector3();
  const projected = new THREE.Vector3();
  const projection = { x: 0, y: 0, visible: false };
  let quality = resolveBumperLinksQuality();
  let cameraHeading = 0;
  let targetHeading = 0;
  let cameraDistance = CAMERA_DISTANCE_M;
  let cameraPitch = CAMERA_PITCH_RAD;
  let cameraInitialized = false;
  let viewportWidth = 1;
  let viewportHeight = 1;

  function applyPixelRatio() {
    const budgetRatio = Math.sqrt(RENDER_PIXEL_BUDGET / Math.max(1, viewportWidth * viewportHeight));
    const pixelRatio = Math.max(0.5, Math.min((window.devicePixelRatio || 1) * quality.resolutionScale, quality.maxPixelRatio, budgetRatio));
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(viewportWidth, viewportHeight, false);
  }

  /** @param {BumperLinksRenderFrame} frame */
  function updateCamera(frame) {
    const local = frame.balls.find((ball) => ball.id === frame.playerId);
    const overview = !local || local.sunk || frame.phase === "holeOver" || frame.phase === "finished";
    const bounds = frame.course.bounds;
    let desiredDistance = CAMERA_DISTANCE_M;
    let desiredPitch = CAMERA_PITCH_RAD;
    if (overview) {
      const span = Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ);
      desiredFocus.set((bounds.minX + bounds.maxX) / 2, frame.course.cup.y, (bounds.minZ + bounds.maxZ) / 2);
      desiredDistance = Math.max(OVERVIEW_MIN_DISTANCE_M, span * OVERVIEW_DISTANCE_SCALE);
      desiredPitch = OVERVIEW_PITCH_RAD;
    } else {
      desiredFocus.set(local.x, local.y, local.z);
    }
    if (viewportWidth < viewportHeight) desiredDistance *= 1.3;

    const follow = cameraInitialized ? Math.min(1, frame.dtSec * CAMERA_FOLLOW_PER_SEC) : 1;
    const turn = cameraInitialized ? Math.min(1, frame.dtSec * CAMERA_TURN_PER_SEC) : 1;
    cameraInitialized = true;
    focus.lerp(desiredFocus, follow);
    cameraDistance += (desiredDistance - cameraDistance) * follow;
    cameraPitch += (desiredPitch - cameraPitch) * follow;
    cameraHeading += Math.atan2(Math.sin(targetHeading - cameraHeading), Math.cos(targetHeading - cameraHeading)) * turn;

    const horizontal = Math.cos(cameraPitch) * cameraDistance;
    camera.position.set(
      focus.x - Math.sin(cameraHeading) * horizontal,
      focus.y + CAMERA_LOOK_HEIGHT_M + Math.sin(cameraPitch) * cameraDistance,
      focus.z - Math.cos(cameraHeading) * horizontal,
    );
    camera.lookAt(focus.x, focus.y + CAMERA_LOOK_HEIGHT_M, focus.z);
    sun.target.position.set(focus.x, focus.y, focus.z);
    sun.position.set(focus.x + 18, focus.y + 34, focus.z + 10);
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
      quality = resolveBumperLinksQuality(profile);
      renderer.shadowMap.enabled = quality.shadows;
      sun.castShadow = quality.shadows;
      sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
      applyPixelRatio();
    },
    /** @param {BumperLinksRenderFrame} frame */
    render(frame) {
      courseView.update(frame.course, frame.holeTimeSec, frame.timeSec, frame.reducedMotion);
      effects.spawn(frame.events, frame.balls, { cup: frame.course.cup, waterY: courseView.getWaterY(), reducedMotion: frame.reducedMotion });
      updateCamera(frame);
      ballViews.updateBalls(frame.balls, frame.playerId, { ready: frame.ready, timeSec: frame.timeSec, reducedMotion: frame.reducedMotion });
      ballViews.updateAim(frame.aim?.points ?? null, frame.aim?.count ?? 0, frame.aim?.power ?? 0);
      effects.update(frame.dtSec);
      renderer.render(scene, camera);
    },
    /** Heading the camera is turning towards; drag aim is measured against it. */
    getCameraHeading: () => targetHeading,
    /** Smoothed heading the camera looks along now. */
    getViewHeading: () => cameraHeading,
    /** Turn the camera to look along a heading; it eases there. @param {number} heading */
    setTargetHeading(heading) {
      if (Number.isFinite(heading)) targetHeading = heading;
    },
    /** Snap straight to a heading, for a new hole. @param {number} heading */
    snapHeading(heading) {
      if (!Number.isFinite(heading)) return;
      targetHeading = heading;
      cameraHeading = heading;
      cameraInitialized = false;
    },
    /**
     * Project a world point into normalised viewport coordinates.
     * @param {number} x @param {number} y @param {number} z
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
      courseView.dispose();
      ballViews.dispose();
      effects.dispose();
      sun.shadow.map?.dispose();
      renderer.dispose();
    },
  };
}
