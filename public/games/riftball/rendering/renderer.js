import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RIFTBALL_COURT } from "../shared/config.js";
import { createRiftballArena } from "./arena.js";
import { createRiftballAthletes } from "./athletes.js";
import { createRiftballEffects } from "./effects.js";
import { createRiftballCameraController, resolveRiftballQuality } from "./presentation.js";
import { createRiftballResources } from "./resources.js";

/**
 * @typedef {object} RiftballRenderPlayer
 * @property {string} id
 * @property {number} index
 * @property {number} x
 * @property {number} y Feet height, independent of character visual transforms.
 * @property {number} z
 * @property {number} vx
 * @property {number} vy
 * @property {number} vz
 * @property {number} facing Yaw with forward (sin(yaw),0,cos(yaw)).
 * @property {boolean} grounded
 * @property {import("../shared/config.js").RiftballAction} action
 * @property {number} actionId Stable animation identity.
 * @property {number} actionTimeSec
 * @property {number} chargeSec
 * @property {number} stamina
 * @property {number} score
 * @property {number} seriesWins
 */
/**
 * @typedef {object} RiftballRenderBall
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} vx
 * @property {number} vy
 * @property {number} vz
 * @property {number} serveId
 * @property {number} hitSerial
 * @property {number} bounceSerial
 * @property {string|null} lastTouchPlayerId
 */
/**
 * @typedef {object} RiftballRenderFrame
 * @property {number} dtSec Render cadence delta; capped for damping and effects.
 * @property {number} timeSec Monotonic presentation clock.
 * @property {number} gameTimeSec Smoothed authoritative game clock.
 * @property {number|string|null} roundId
 * @property {string} playerId
 * @property {{p1:RiftballRenderPlayer,p2:RiftballRenderPlayer}|RiftballRenderPlayer[]} players
 * @property {RiftballRenderBall} ball
 * @property {string} phase
 * @property {number} goalSerial
 * @property {string|null} lastScorer
 * @property {boolean} reducedMotion
 * @property {{yaw:number,pitch:number}} cameraOrbit Relative orbit, in radians.
 * @property {boolean} replay
 */
/** @typedef {{fps:number,cpuFrameMs:number,drawCalls:number,triangles:number,geometries:number,textures:number,pixelRatio:number,quality:string,particles:number,trailSamples:number,motes:number,athletes:number}} RiftballRendererStats */

const RENDER_PIXEL_BUDGET = 2200000;
const WAITING_PLAYERS = Object.freeze([0, 1].map((index) => Object.freeze({
  id: index === 0 ? "p1" : "p2",
  index,
  x: 0,
  y: 0,
  z: (index === 0 ? 1 : -1) * RIFTBALL_COURT.playerSpawnZ,
  vx: 0,
  vy: 0,
  vz: 0,
  facing: index === 0 ? Math.PI : 0,
  grounded: true,
  action: "idle",
  actionId: 0,
  actionTimeSec: 0,
  chargeSec: 0,
  stamina: 100,
  score: 0,
  seriesWins: 0,
})));
const WAITING_BALL = Object.freeze({ x: 0, y: RIFTBALL_COURT.ballRadius, z: 0, vx: 0, vy: 0, vz: 0, serveId: 0, hitSerial: 0, bounceSerial: 0, lastTouchPlayerId: null });

/**
 * Canvas-only indoor sport renderer. The caller owns DOM, input, scheduling,
 * network state and HUD. This object owns its scene and GPU resources, accepts
 * borrowed frame state, and never changes authoritative or predicted poses.
 * @param {{canvas:HTMLCanvasElement}} options
 * @returns {{resize(width:number,height:number):void,setQuality(profile:import("./presentation.js").RiftballRenderQuality|import("./presentation.js").RiftballQualityProfile):void,render(frame:RiftballRenderFrame):void,getCameraHeading():number,getStats():RiftballRendererStats,dispose():void}}
 */
export function createRiftballRenderer({ canvas }) {
  const resources = createRiftballResources();
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: true, powerPreference: "high-performance", stencil: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#101d2c");
  scene.fog = new THREE.Fog("#17283b", 36, 80);
  const camera = new THREE.PerspectiveCamera(58, 1, 0.12, 105);
  const hemisphereLight = new THREE.HemisphereLight("#edf6ff", "#3b4a58", 1.9);
  scene.add(hemisphereLight);
  const keyLight = new THREE.DirectionalLight("#ffedcb", 3.0);
  keyLight.position.set(-5, 11.1, 6);
  keyLight.target.position.set(0, 0, 0);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.left = -23;
  keyLight.shadow.camera.right = 23;
  keyLight.shadow.camera.top = 24;
  keyLight.shadow.camera.bottom = -24;
  keyLight.shadow.camera.near = 0.5;
  keyLight.shadow.camera.far = 52;
  keyLight.shadow.bias = -0.00015;
  keyLight.shadow.normalBias = 0.025;
  keyLight.shadow.radius = 3;
  scene.add(keyLight, keyLight.target);
  const rimLight = new THREE.DirectionalLight("#9fd4ee", 1.05);
  rimLight.position.set(6, 8.5, -12);
  scene.add(rimLight);

  const environmentScene = new RoomEnvironment();
  const environmentGenerator = new THREE.PMREMGenerator(renderer);
  const environmentTarget = environmentGenerator.fromScene(environmentScene, 0.06);
  scene.environment = environmentTarget.texture;
  scene.environmentIntensity = 0.3;
  environmentScene.dispose();
  environmentGenerator.dispose();

  const arena = createRiftballArena(scene, resources);
  const athletes = createRiftballAthletes(scene);
  const effects = createRiftballEffects(scene, resources);
  const cameraController = createRiftballCameraController();
  const cameraTarget = new THREE.Vector3();
  const renderFrame = {
    dtSec: 1 / 60,
    timeSec: 0,
    gameTimeSec: 0,
    roundId: null,
    playerId: "p1",
    players: WAITING_PLAYERS,
    ball: WAITING_BALL,
    phase: "waiting",
    goalSerial: 0,
    lastScorer: null,
    reducedMotion: false,
    cameraOrbit: { yaw: 0, pitch: 0 },
    replay: false,
  };
  let qualitySettings = resolveRiftballQuality("high");
  let width = 1;
  let height = 1;
  let pixelRatio = 1;
  let disposed = false;
  let cameraHeading = Math.PI;
  let smoothedFps = 60;
  let cpuFrameMs = 0;

  function resize(nextWidth, nextHeight) {
    if (disposed) return;
    width = Math.max(1, Math.round(Number.isFinite(nextWidth) ? nextWidth : 1));
    height = Math.max(1, Math.round(Number.isFinite(nextHeight) ? nextHeight : 1));
    const devicePixelRatio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
    const pixelBudgetRatio = Math.sqrt(RENDER_PIXEL_BUDGET / (width * height));
    pixelRatio = Math.max(0.4, Math.min(pixelBudgetRatio, Math.min(devicePixelRatio, qualitySettings.maxPixelRatio) * qualitySettings.resolutionScale));
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    cameraController.reset();
  }

  function setQuality(profile) {
    if (disposed) return;
    const previousShadowSize = qualitySettings.shadowMapSize;
    qualitySettings = resolveRiftballQuality(profile);
    renderer.shadowMap.enabled = qualitySettings.shadows;
    keyLight.castShadow = qualitySettings.shadows;
    if (previousShadowSize !== qualitySettings.shadowMapSize) {
      keyLight.shadow.map?.dispose();
      keyLight.shadow.map = null;
      keyLight.shadow.mapSize.set(qualitySettings.shadowMapSize, qualitySettings.shadowMapSize);
    }
    arena.setQuality(qualitySettings);
    effects.setQuality(qualitySettings);
    resize(width, height);
  }

  function render(frame) {
    if (disposed) return;
    const renderStartMs = performance.now();
    const dtSec = Math.max(0, Math.min(0.06, Number.isFinite(frame?.dtSec) ? frame.dtSec : 1 / 60));
    const framePlayers = frame?.players;
    const hasPlayers = Array.isArray(framePlayers) ? framePlayers.length > 0 : framePlayers && Object.keys(framePlayers).length > 0;
    renderFrame.dtSec = dtSec;
    renderFrame.timeSec = Number.isFinite(frame?.timeSec) ? frame.timeSec : 0;
    renderFrame.gameTimeSec = Number.isFinite(frame?.gameTimeSec) ? frame.gameTimeSec : 0;
    renderFrame.roundId = frame?.roundId ?? null;
    renderFrame.playerId = hasPlayers ? frame.playerId : "p1";
    renderFrame.players = hasPlayers ? framePlayers : WAITING_PLAYERS;
    renderFrame.ball = frame?.ball || WAITING_BALL;
    renderFrame.phase = frame?.phase || "waiting";
    renderFrame.goalSerial = frame?.goalSerial || 0;
    renderFrame.lastScorer = frame?.lastScorer || null;
    renderFrame.reducedMotion = Boolean(frame?.reducedMotion);
    renderFrame.cameraOrbit.yaw = Number.isFinite(frame?.cameraOrbit?.yaw) ? frame.cameraOrbit.yaw : 0;
    renderFrame.cameraOrbit.pitch = Number.isFinite(frame?.cameraOrbit?.pitch) ? frame.cameraOrbit.pitch : 0;
    renderFrame.replay = Boolean(frame?.replay);

    const view = cameraController.update(renderFrame, camera.aspect);
    camera.position.set(view.x, view.y, view.z);
    cameraTarget.set(view.targetX, view.targetY, view.targetZ);
    camera.lookAt(cameraTarget);
    if (Math.abs(camera.fov - view.fov) > 0.02) {
      camera.fov = view.fov;
      camera.updateProjectionMatrix();
    }
    cameraHeading = view.heading;
    arena.update(renderFrame);
    athletes.update(renderFrame.players, renderFrame);
    effects.update(renderFrame);
    renderer.render(scene, camera);
    if (dtSec > 0) smoothedFps += (1 / dtSec - smoothedFps) * 0.055;
    cpuFrameMs += (performance.now() - renderStartMs - cpuFrameMs) * 0.08;
  }

  setQuality("high");

  return {
    resize,
    setQuality,
    render,
    getCameraHeading() {
      return cameraHeading;
    },
    getStats() {
      return {
        fps: smoothedFps,
        cpuFrameMs,
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        geometries: renderer.info.memory.geometries,
        textures: renderer.info.memory.textures,
        pixelRatio,
        quality: qualitySettings.quality,
        ...effects.getStats(),
        athletes: athletes.getStats().athletes,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      effects.dispose();
      athletes.dispose();
      arena.dispose();
      environmentTarget.dispose();
      keyLight.shadow.map?.dispose();
      scene.clear();
      resources.dispose();
      renderer.renderLists.dispose();
      renderer.dispose();
    },
  };
}
