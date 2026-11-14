import * as THREE from "three";
import { SKYBREAK_TEAM_COLORS } from "../shared/config.js";
import { createSkybreakEnvironment } from "./environment.js";
import { createSkybreakJetKit, createSkybreakJetMesh } from "./jetModel.js";
import { createSkybreakEffects } from "./effects.js";

/** @typedef {import("../client/snapshotPose.js").SkybreakPresentedJet} SkybreakPresentedJet */
/** @typedef {import("../client/matchEvents.js").SkybreakEvent} SkybreakEvent */
/**
 * @typedef {object} SkybreakRenderFrame
 * @property {number} dtSec
 * @property {number} timeSec
 * @property {string} playerId
 * @property {readonly SkybreakPresentedJet[]} jets
 * @property {readonly SkybreakEvent[]} events
 * @property {readonly {x:number,y:number,z:number,vx:number,vy:number,vz:number}[]} missiles Display positions.
 * @property {boolean} localFiring
 * @property {number} nextGateIndex
 * @property {{x:number,y:number,z:number,forwardX:number,forwardY:number,forwardZ:number,upX:number,upY:number,upZ:number}|null} ghost
 * @property {string} roundIdentity
 * @property {boolean} reducedMotion
 */

const RENDER_PIXEL_BUDGET = 2400000;
const CHASE_DISTANCE_M = 24;
const CHASE_HEIGHT_M = 6.5;
const LOOK_AHEAD_M = 40;
const BASE_FOV = 64;
const MAX_JET_VIEWS = 8;
const CAMERA_ROLL_SHARE = 0.55;

/** @param {object|string} [profile] */
function resolveSkybreakQuality(profile = "high") {
  const settings = typeof profile === "object" && profile ? profile : {};
  const quality = typeof profile === "string" ? profile : settings.autoLowEndActive || settings.autoTier === "low" ? "low" : "high";
  return {
    resolutionScale: Number.isFinite(settings.resolutionScale) ? Math.max(0.5, Math.min(1.5, settings.resolutionScale)) : 1,
    maxPixelRatio: quality === "low" ? 1 : 1.7,
    shadows: quality !== "low",
    effectScale: settings.reducedEffects || quality === "low" ? 0.4 : 1,
  };
}

/**
 * Canvas-only renderer. The caller owns DOM, input, networking and HUD.
 * @param {{canvas:HTMLCanvasElement,showGates:boolean}} options
 */
export function createSkybreakRenderer({ canvas, showGates }) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: true, powerPreference: "high-performance", stencil: false, logarithmicDepthBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog("#d8a07c", 900, 5200);
  const camera = new THREE.PerspectiveCamera(BASE_FOV, 1, 0.5, 30000);
  const environment = createSkybreakEnvironment(scene, renderer, { showGates });
  scene.add(new THREE.HemisphereLight("#ffd9bf", "#3d3a44", 0.9));
  const sun = new THREE.DirectionalLight("#ffc08a", 3.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 400 });
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  const kit = createSkybreakJetKit();
  /** @type {Map<string,ReturnType<typeof createSkybreakJetMesh>>} */
  const jetViews = new Map();
  const ghostView = createSkybreakJetMesh(kit, "#8dffd0");
  ghostView.materials.forEach((material) => {
    material.transparent = true;
    material.opacity = 0.28;
    material.depthWrite = false;
  });
  ghostView.root.traverse((child) => { child.castShadow = false; });
  ghostView.root.visible = false;
  scene.add(ghostView.root);
  const effects = createSkybreakEffects(scene);
  const missileGeometry = new THREE.CylinderGeometry(0.12, 0.12, 2.7, 8).rotateX(Math.PI / 2);
  const missileMaterial = new THREE.MeshStandardMaterial({ color: "#e4e6e8", metalness: 0.3, roughness: 0.5 });
  const missileMeshes = Array.from({ length: 12 }, () => {
    const mesh = new THREE.Mesh(missileGeometry, missileMaterial);
    mesh.visible = false;
    scene.add(mesh);
    return mesh;
  });

  const basis = new THREE.Matrix4();
  const forward = new THREE.Vector3();
  const up = new THREE.Vector3();
  const right = new THREE.Vector3();
  const cameraUp = new THREE.Vector3(0, 1, 0);
  const desiredPosition = new THREE.Vector3();
  const lookTarget = new THREE.Vector3();
  const projected = new THREE.Vector3();
  const projection = { x: 0, y: 0, visible: false };
  const worldUpShare = new THREE.Vector3(0, 1 - CAMERA_ROLL_SHARE, 0);
  const seenJetIds = new Set();
  let quality = resolveSkybreakQuality();
  let viewportWidth = 1;
  let viewportHeight = 1;
  let cameraReady = false;
  let presentedIdentity = "";
  let shake = 0;

  function applyPixelRatio() {
    const budgetRatio = Math.sqrt(RENDER_PIXEL_BUDGET / Math.max(1, viewportWidth * viewportHeight));
    renderer.setPixelRatio(Math.max(0.5, Math.min((window.devicePixelRatio || 1) * quality.resolutionScale, quality.maxPixelRatio, budgetRatio)));
    renderer.setSize(viewportWidth, viewportHeight, false);
  }

  /**
   * Orient an object so its +Z faces forward and +Y faces up.
   * @param {THREE.Object3D} object
   * @param {{x:number,y:number,z:number,forwardX:number,forwardY:number,forwardZ:number,upX:number,upY:number,upZ:number}} pose
   */
  function placeSkybreakObject(object, pose) {
    forward.set(pose.forwardX, pose.forwardY, pose.forwardZ);
    up.set(pose.upX, pose.upY, pose.upZ);
    right.crossVectors(up, forward).normalize();
    basis.makeBasis(right, up, forward);
    object.quaternion.setFromRotationMatrix(basis);
    object.position.set(pose.x, pose.y, pose.z);
  }

  /** @param {SkybreakPresentedJet|undefined} jet @param {number} dtSec @param {boolean} reducedMotion */
  function updateSkybreakCamera(jet, dtSec, reducedMotion) {
    if (!jet) {
      camera.position.set(0, 900, 1600);
      camera.lookAt(0, 300, 0);
      return;
    }
    desiredPosition.set(
      jet.x - jet.forwardX * CHASE_DISTANCE_M + jet.upX * CHASE_HEIGHT_M,
      jet.y - jet.forwardY * CHASE_DISTANCE_M + jet.upY * CHASE_HEIGHT_M,
      jet.z - jet.forwardZ * CHASE_DISTANCE_M + jet.upZ * CHASE_HEIGHT_M,
    );
    // Rigid chase: position never lags, so the view stays tight at any frame
    // rate. Only the roll blend below is smoothed.
    if (jet.alive || !cameraReady) camera.position.copy(desiredPosition);
    cameraReady = true;
    lookTarget.set(jet.x + jet.forwardX * LOOK_AHEAD_M, jet.y + jet.forwardY * LOOK_AHEAD_M, jet.z + jet.forwardZ * LOOK_AHEAD_M);
    cameraUp.lerp(up.set(jet.upX, jet.upY, jet.upZ).multiplyScalar(CAMERA_ROLL_SHARE).add(worldUpShare).normalize(), Math.min(1, dtSec * 6));
    camera.up.copy(cameraUp);
    camera.lookAt(lookTarget);
    if (shake > 0 && !reducedMotion) {
      camera.position.x += (Math.random() - 0.5) * shake;
      camera.position.y += (Math.random() - 0.5) * shake;
    }
    shake = Math.max(0, shake - dtSec * 3);
    const targetFov = BASE_FOV + (jet.speed - 150) * 0.06 + (jet.boosting ? 6 : 0);
    camera.fov += (targetFov - camera.fov) * Math.min(1, dtSec * 3);
    camera.updateProjectionMatrix();
    sun.position.set(jet.x + environment.sunDirection.x * 200, jet.y + Math.max(80, environment.sunDirection.y * 200), jet.z + environment.sunDirection.z * 200);
    sun.target.position.set(jet.x, jet.y, jet.z);
  }

  return {
    /** @param {number} width @param {number} height */
    resize(width, height) {
      viewportWidth = Math.max(1, Math.round(width));
      viewportHeight = Math.max(1, Math.round(height));
      camera.aspect = viewportWidth / viewportHeight;
      camera.updateProjectionMatrix();
      applyPixelRatio();
    },
    /** @param {object|string} profile */
    setQuality(profile) {
      quality = resolveSkybreakQuality(profile);
      renderer.shadowMap.enabled = quality.shadows;
      sun.castShadow = quality.shadows;
      applyPixelRatio();
    },
    /**
     * Project a world point to CSS pixels over the canvas. Reuses one object.
     * @param {number} x @param {number} y @param {number} z
     */
    project(x, y, z) {
      projected.set(x, y, z).project(camera);
      projection.visible = projected.z < 1 && Math.abs(projected.x) < 1.1 && Math.abs(projected.y) < 1.1;
      projection.x = (projected.x * 0.5 + 0.5) * viewportWidth;
      projection.y = (-projected.y * 0.5 + 0.5) * viewportHeight;
      return projection;
    },
    /** @param {SkybreakRenderFrame} frame */
    render(frame) {
      if (frame.roundIdentity !== presentedIdentity) {
        presentedIdentity = frame.roundIdentity;
        effects.clear();
        cameraReady = false;
      }
      const seen = seenJetIds;
      seen.clear();
      for (const jet of frame.jets) {
        let view = jetViews.get(jet.id);
        if (!view) {
          if (jetViews.size >= MAX_JET_VIEWS) continue;
          view = createSkybreakJetMesh(kit, SKYBREAK_TEAM_COLORS[jet.colorIndex % SKYBREAK_TEAM_COLORS.length]);
          jetViews.set(jet.id, view);
          scene.add(view.root);
        }
        seen.add(jet.id);
        view.root.visible = jet.alive;
        if (!jet.alive) continue;
        placeSkybreakObject(view.root, jet);
        view.animate(jet, frame.timeSec);
      }
      for (const [jetId, view] of jetViews) if (!seen.has(jetId)) view.root.visible = false;
      for (const event of frame.events) {
        if ((event.kind === "hit" && event.jetId === frame.playerId) || (event.kind === "explode" && Math.hypot(event.x - camera.position.x, event.y - camera.position.y, event.z - camera.position.z) < 300)) shake = Math.min(2.5, shake + 1.2);
      }
      missileMeshes.forEach((mesh, index) => {
        const missile = frame.missiles[index];
        mesh.visible = Boolean(missile);
        if (!missile) return;
        mesh.position.set(missile.x, missile.y, missile.z);
        mesh.lookAt(missile.x + missile.vx, missile.y + missile.vy, missile.z + missile.vz);
      });
      ghostView.root.visible = Boolean(frame.ghost);
      if (frame.ghost) placeSkybreakObject(ghostView.root, frame.ghost);
      const local = frame.jets.find((jet) => jet.id === frame.playerId);
      updateSkybreakCamera(local, frame.dtSec, frame.reducedMotion);
      environment.update(frame.timeSec, frame.dtSec, frame.nextGateIndex);
      const pixelScale = (viewportHeight * renderer.getPixelRatio()) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
      effects.update({ jets: frame.jets, events: frame.events, missiles: frame.missiles, playerId: frame.playerId, localFiring: frame.localFiring, dtSec: frame.dtSec, pixelScale, effectScale: quality.effectScale });
      renderer.render(scene, camera);
    },
    dispose() {
      environment.dispose();
      effects.dispose();
      for (const view of jetViews.values()) view.dispose();
      ghostView.dispose();
      kit.dispose();
      missileGeometry.dispose();
      missileMaterial.dispose();
      renderer.dispose();
    },
  };
}
