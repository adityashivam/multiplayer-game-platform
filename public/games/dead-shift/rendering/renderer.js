import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { DEAD_SHIFT_PLAYER_SETTINGS } from "../shared/config.js";
import { createContainmentArena } from "./arena.js";
import { createArenaActors } from "./characters.js";
import { createArenaEffects } from "./effects.js";
import { createRenderResources } from "./resources.js";
import { createFirstPersonWeapons } from "./weapons.js";
import { advanceDeadShiftAimBlend, DEAD_SHIFT_AIM_FOV_DEG, DEAD_SHIFT_CAMERA_FOV_DEG } from "./aimPresentation.js";

/** @typedef {"low" | "medium" | "high"} RenderQuality */
/** @typedef {import("../shared/simulation.js").DeadShiftPlayerState} DeadShiftPlayerState */
/** @typedef {import("../shared/config.js").DeadShiftInputState} DeadShiftInputState */
/** @typedef {{autoTier?: "low" | "medium" | "balanced", autoLowEndActive?: boolean, resolutionScale?: number, targetFps?: number, reducedEffects?: boolean}} RuntimeQualityProfile */
/** @typedef {{fps: number, cpuFrameMs: number, drawCalls: number, triangles: number, geometries: number, textures: number, pixelRatio: number, quality: RenderQuality, particles: number, projectiles: number}} DeadShiftRendererStats */
/**
 * @typedef {object} DeadShiftRenderFrame
 * @property {number} dtSec Render delta, independent of simulation cadence.
 * @property {number} timeSec Monotonic animation time in seconds.
 * @property {number | null} [roundId] Server round identity; null during snapshot recovery.
 * @property {string} playerId
 * @property {DeadShiftPlayerState} localPlayer Predicted movement and authoritative combat fields.
 * @property {{p1: DeadShiftPlayerState, p2: DeadShiftPlayerState}} players
 * @property {import("../shared/simulation.js").DeadShiftEnemyState[]} enemies
 * @property {import("../shared/simulation.js").DeadShiftProjectileState[]} projectiles
 * @property {import("../shared/simulation.js").DeadShiftEvent[]} events
 * @property {DeadShiftInputState & {aiming?: boolean}} input Current local aim and controls, including presentation-only ADS.
 * @property {boolean} moving
 * @property {boolean} reducedMotion
 */

const QUALITY_PIXEL_RATIOS = Object.freeze({ low: 1, medium: 1.35, high: 1.7 });

/**
 * Creates a canvas-only Three.js renderer. The caller retains ownership of the
 * canvas, frame scheduling, input, DOM and network session. This object owns all
 * Three.js scenes, pooled visual effects, GPU resources and the WebGL renderer.
 * @param {{canvas: HTMLCanvasElement}} options
 * @returns {{resize(width: number, height: number): void, render(frame: DeadShiftRenderFrame): void, setQuality(profile: RenderQuality | RuntimeQualityProfile): void, getStats(): DeadShiftRendererStats, dispose(): void}}
 */
export function createDeadShiftRenderer({ canvas }) {
  const resources = createRenderResources();
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: "high-performance", stencil: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.autoClear = false;
  renderer.info.autoReset = false;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x102426);
  scene.fog = new THREE.FogExp2(0x173b3b, 0.022);
  const camera = new THREE.PerspectiveCamera(DEAD_SHIFT_CAMERA_FOV_DEG, 1, 0.06, 75);
  camera.rotation.order = "YXZ";

  const environmentScene = new RoomEnvironment();
  const environmentGenerator = new THREE.PMREMGenerator(renderer);
  const environmentTarget = environmentGenerator.fromScene(environmentScene, 0.06);
  scene.environment = environmentTarget.texture;
  scene.environmentIntensity = 0.4;
  environmentScene.dispose();
  environmentGenerator.dispose();

  const arena = createContainmentArena(scene, resources);
  const actors = createArenaActors(scene, resources);
  const effects = createArenaEffects(scene, resources);
  const weapons = createFirstPersonWeapons(resources);
  weapons.scene.environment = environmentTarget.texture;
  weapons.scene.environmentIntensity = 0.65;

  const finishScene = new THREE.Scene();
  const finishCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const finishMaterial = resources.ownMaterial(new THREE.ShaderMaterial({
    transparent: true,
    depthTest: false,
    depthWrite: false,
    uniforms: { damage: { value: 0 }, time: { value: 0 } },
    vertexShader: `
      varying vec2 screenUv;
      void main() {
        screenUv = uv;
        gl_Position = vec4(position.xy * 2.0, 0.0, 1.0);
      }
    `,
    fragmentShader: `
      varying vec2 screenUv;
      uniform float damage;
      uniform float time;
      void main() {
        vec2 centered = screenUv * 2.0 - 1.0;
        float edge = smoothstep(0.25, 1.4, length(centered));
        float grain = fract(sin(dot(screenUv + time * 0.001, vec2(12.9898, 78.233))) * 43758.5453);
        vec3 tint = mix(vec3(0.012, 0.025, 0.025), vec3(0.24, 0.012, 0.005), damage);
        gl_FragColor = vec4(tint, edge * (0.27 + damage * 0.44) + grain * 0.018);
      }
    `,
  }));
  const finishQuad = new THREE.Mesh(resources.plane, finishMaterial);
  finishQuad.frustumCulled = false;
  finishScene.add(finishQuad);

  let width = 1;
  let height = 1;
  let pixelRatio = 1;
  let resolutionScale = 1;
  /** @type {RenderQuality} */
  let quality = "high";
  let disposed = false;
  let smoothedFps = 60;
  let cpuFrameMs = 0;
  let lastPlayerHealth = 100;
  let damageFlashSec = 0;
  let livingCameraHeight = DEAD_SHIFT_PLAYER_SETTINGS.eyeHeight;
  let currentRoundId = null;
  let aimBlend = 0;

  function resize(nextWidth, nextHeight) {
    if (disposed) return;
    width = Math.max(1, Math.round(nextWidth));
    height = Math.max(1, Math.round(nextHeight));
    const devicePixelRatio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
    // A pixel budget also bounds fill rate on large external displays.
    const pixelBudgetRatio = Math.sqrt(2300000 / (width * height));
    pixelRatio = Math.max(0.5, Math.min(devicePixelRatio, QUALITY_PIXEL_RATIOS[quality]) * resolutionScale);
    pixelRatio = Math.min(pixelRatio, pixelBudgetRatio);
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    weapons.resize(width, height);
    effects.setPixelRatio(pixelRatio);
  }

  function setQuality(profile) {
    if (disposed) return;
    if (typeof profile === "string") {
      quality = profile === "low" || profile === "medium" ? profile : "high";
      resolutionScale = 1;
    } else {
      const lowEffects = profile?.autoLowEndActive || profile?.autoTier === "low" || profile?.resolutionScale <= 0.6;
      const mediumEffects = profile?.autoTier === "medium" || profile?.reducedEffects || profile?.targetFps <= 45;
      quality = lowEffects ? "low" : mediumEffects ? "medium" : "high";
      resolutionScale = Number.isFinite(profile?.resolutionScale) ? Math.max(0.6, Math.min(1, profile.resolutionScale)) : 1;
    }
    renderer.shadowMap.enabled = quality !== "low";
    arena.setQuality(quality);
    actors.setQuality(quality);
    effects.setQuality(quality);
    resize(width, height);
  }

  function render(frame) {
    if (disposed || !frame.localPlayer) return;
    const renderStart = performance.now();
    const dtSec = Math.max(0, Math.min(0.06, Number.isFinite(frame.dtSec) ? frame.dtSec : 1 / 60));
    const timeSec = Number.isFinite(frame.timeSec) ? frame.timeSec : 0;
    const localPlayer = frame.localPlayer;
    const reducedMotion = Boolean(frame.reducedMotion);
    const normalizedFrame = { ...frame, dtSec, timeSec, reducedMotion };
    if (Number.isSafeInteger(frame.roundId) && frame.roundId > 0 && frame.roundId !== currentRoundId) {
      currentRoundId = frame.roundId;
      weapons.resetRound();
      effects.resetRound();
      damageFlashSec = 0;
      lastPlayerHealth = localPlayer.health;
      aimBlend = 0;
    }
    const dead = localPlayer.health <= 0 || localPlayer.respawnRemaining > 0;
    aimBlend = advanceDeadShiftAimBlend(aimBlend, Boolean(frame.input?.aiming && !dead && localPlayer.reloadRemaining <= 0), dtSec, reducedMotion);
    const fieldOfViewDeg = DEAD_SHIFT_CAMERA_FOV_DEG + (DEAD_SHIFT_AIM_FOV_DEG - DEAD_SHIFT_CAMERA_FOV_DEG) * aimBlend;
    if (Math.abs(camera.fov - fieldOfViewDeg) > 0.0001) {
      camera.fov = fieldOfViewDeg;
      camera.updateProjectionMatrix();
    }
    livingCameraHeight += ((dead ? 0.55 : DEAD_SHIFT_PLAYER_SETTINGS.eyeHeight) - livingCameraHeight) * (1 - Math.exp(-dtSec * 7));
    const movementBob = !reducedMotion && frame.moving && !dead ? Math.sin(timeSec * 16) * 0.012 * (1 - aimBlend * 0.8) : 0;
    camera.position.set(localPlayer.x || 0, (localPlayer.y || 0) + livingCameraHeight + movementBob, localPlayer.z || 0);
    camera.rotation.set(frame.input?.pitch ?? localPlayer.pitch ?? 0, frame.input?.yaw ?? localPlayer.yaw ?? 0, 0, "YXZ");

    arena.update(timeSec, reducedMotion);
    actors.update(normalizedFrame);
    const weaponFeedback = weapons.update(normalizedFrame);
    if (weaponFeedback.fired) effects.localShot(localPlayer, frame.input, weaponFeedback.weaponIndex);
    if (frame.roundId !== null) effects.recordSnapshotEffects(frame.events, frame.players, frame.playerId);
    effects.update(normalizedFrame);

    if (frame.roundId !== null) {
      if (localPlayer.health < lastPlayerHealth) damageFlashSec = 0.35;
      lastPlayerHealth = localPlayer.health;
    }
    damageFlashSec = Math.max(0, damageFlashSec - dtSec);
    finishMaterial.uniforms.damage.value = Math.min(1, damageFlashSec * 2 + Math.max(0, (35 - localPlayer.health) / 60));
    finishMaterial.uniforms.time.value = reducedMotion ? 0 : timeSec;

    renderer.info.reset();
    renderer.clear();
    renderer.render(scene, camera);
    if (!dead) {
      renderer.clearDepth();
      renderer.render(weapons.scene, weapons.camera);
    }
    renderer.clearDepth();
    renderer.render(finishScene, finishCamera);
    smoothedFps += ((dtSec ? 1 / dtSec : 60) - smoothedFps) * (1 - Math.exp(-dtSec * 3));
    cpuFrameMs += ((performance.now() - renderStart) - cpuFrameMs) * 0.1;
  }

  setQuality("high");

  return {
    resize,
    render,
    setQuality,
    getStats() {
      return {
        fps: Math.round(smoothedFps),
        cpuFrameMs: Math.round(cpuFrameMs * 100) / 100,
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        pixelRatio: Math.round(pixelRatio * 100) / 100,
        quality,
        ...effects.getStats(),
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      actors.dispose();
      effects.dispose();
      arena.dispose();
      weapons.dispose();
      scene.clear();
      finishScene.clear();
      environmentTarget.dispose();
      resources.dispose();
      renderer.renderLists.dispose();
      renderer.dispose();
    },
  };
}
