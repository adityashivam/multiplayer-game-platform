import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { SKY_DASH_MAX_RUNNERS } from "../shared/config.js";
import { createSkyDashResources } from "./resources.js";
import { createSkyDashCourse } from "./course.js";
import { createSkyDashRunners } from "./runners.js";
import { createSkyDashEffects } from "./effects.js";
import { getSkyDashCameraTargets, resolveSkyDashQuality } from "./presentation.js";

/** @typedef {import("./runners.js").SkyDashRenderRunner} SkyDashRenderRunner */
/**
 * @typedef {object} SkyDashRenderFrame
 * @property {number} dtSec Render delta, independent of simulation cadence.
 * @property {number} timeSec Monotonic render animation clock.
 * @property {number} courseTimeSec Smoothed authoritative analytic world clock.
 * @property {number|null} [roundId]
 * @property {string} playerId
 * @property {SkyDashRenderRunner[]} runners
 * @property {{platformId:number,angle:number,angularVelocity:number}[]} [seesaws] Bounded predicted authoritative platform poses.
 * @property {boolean} [reducedMotion]
 * @property {number} [cameraOrbit] Optional presentation-only relative orbit, in radians.
 */

const WAITING_RUNNERS = Object.freeze(Array.from({ length: 5 }, (_, index) => Object.freeze({
  id: `waiting-${index}`,
  name: ["You", "Friend", "Wobble", "Biscuit", "Noodle"][index],
  isBot: index >= 2,
  colorIndex: index,
  x: (index - 2) * 1.7,
  y: 0,
  z: 2 + (index % 2) * 1.3,
  yaw: 0,
  vx: 0,
  vy: 0,
  vz: 0,
  grounded: true,
  action: "idle",
  respawnId: 0,
})));

/** @param {THREE.Scene} scene @param {import("./resources.js").SkyDashResources} resources */
function createSkyDashSky(scene, resources) {
  const material = resources.ownMaterial(new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color("#78cbe5") },
      horizonColor: { value: new THREE.Color("#d8eff0") },
      bottomColor: { value: new THREE.Color("#f5dce1") },
    },
    vertexShader: `
      varying vec3 skyDirection;
      void main() {
        skyDirection = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 skyDirection;
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform vec3 bottomColor;
      void main() {
        float height = normalize(skyDirection).y;
        vec3 sky = mix(horizonColor, topColor, smoothstep(0.0, 0.8, height));
        sky = mix(sky, bottomColor, 1.0 - smoothstep(-0.8, 0.05, height));
        gl_FragColor = vec4(sky, 1.0);
        #include <colorspace_fragment>
      }
    `,
  }));
  const sky = new THREE.Mesh(resources.ownGeometry(new THREE.SphereGeometry(260, 24, 16)), material);
  sky.renderOrder = -10;
  sky.frustumCulled = false;
  scene.add(sky);
  return sky;
}

/**
 * Canvas-only third-person presentation. The caller owns frame scheduling,
 * inputs, networking, HUD and the canvas; this object owns all GPU allocations.
 * `render` accepts immutable snapshots and never mutates simulation positions.
 * @param {{canvas:HTMLCanvasElement}} options
 * @returns {{resize(width:number,height:number):void,setQuality(profile:import("./presentation.js").SkyDashRenderQuality|import("./presentation.js").SkyDashQualityProfile):void,render(frame:SkyDashRenderFrame):void,getStats():{fps:number,cpuFrameMs:number,drawCalls:number,triangles:number,geometries:number,textures:number,pixelRatio:number,quality:string,particles:number},dispose():void}}
 */
export function createSkyDashRenderer({ canvas }) {
  const resources = createSkyDashResources();
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: true, powerPreference: "high-performance", stencil: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#d8eff0");
  scene.fog = new THREE.Fog("#d8eff0", 65, 190);
  const camera = new THREE.PerspectiveCamera(56, 1, 0.1, 330);
  const sky = createSkyDashSky(scene, resources);
  scene.add(new THREE.HemisphereLight("#eeffff", "#c4b1c9", 1.35));
  const sun = new THREE.DirectionalLight("#fff3da", 2.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -19;
  sun.shadow.camera.right = 19;
  sun.shadow.camera.top = 23;
  sun.shadow.camera.bottom = -18;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 75;
  sun.shadow.bias = -0.0002;
  sun.shadow.normalBias = 0.035;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight("#bbdef3", 0.5);
  fill.position.set(20, 9, -35);
  scene.add(fill);

  const environmentScene = new RoomEnvironment();
  const environmentGenerator = new THREE.PMREMGenerator(renderer);
  const environmentTarget = environmentGenerator.fromScene(environmentScene, 0.06);
  scene.environment = environmentTarget.texture;
  scene.environmentIntensity = 0.32;
  environmentScene.dispose();
  environmentGenerator.dispose();

  const course = createSkyDashCourse(scene, resources);
  const runners = createSkyDashRunners(scene, resources);
  const effects = createSkyDashEffects(scene, resources);
  const cameraLookAt = new THREE.Vector3();
  const desiredCamera = new THREE.Vector3();
  const desiredLookAt = new THREE.Vector3();
  let qualitySettings = resolveSkyDashQuality("high");
  let width = 1;
  let height = 1;
  let pixelRatio = 1;
  let disposed = false;
  let cameraReady = false;
  let followedRunnerId = "";
  let followedRespawnId = -1;
  let currentRoundId = null;
  let cameraGroundY = 0;
  let smoothedFps = 60;
  let cpuFrameMs = 0;

  function resize(nextWidth, nextHeight) {
    if (disposed) return;
    width = Math.max(1, Math.round(Number.isFinite(nextWidth) ? nextWidth : 1));
    height = Math.max(1, Math.round(Number.isFinite(nextHeight) ? nextHeight : 1));
    const devicePixelRatio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
    const pixelBudgetRatio = Math.sqrt(2300000 / (width * height));
    pixelRatio = Math.min(pixelBudgetRatio, Math.max(0.5, Math.min(devicePixelRatio, qualitySettings.maxPixelRatio) * qualitySettings.resolutionScale));
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    cameraReady = false;
  }

  function setQuality(profile) {
    if (disposed) return;
    const previousShadowSize = qualitySettings.shadowMapSize;
    qualitySettings = resolveSkyDashQuality(profile);
    renderer.shadowMap.enabled = qualitySettings.shadows;
    sun.castShadow = qualitySettings.shadows;
    if (previousShadowSize !== qualitySettings.shadowMapSize) {
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
      sun.shadow.mapSize.set(qualitySettings.shadowMapSize, qualitySettings.shadowMapSize);
    }
    runners.setQuality(qualitySettings.quality);
    course.setQuality(qualitySettings.quality);
    effects.setParticleLimit(qualitySettings.particleLimit);
    resize(width, height);
  }

  function render(frame) {
    if (disposed) return;
    const renderStart = performance.now();
    const dtSec = Math.max(0, Math.min(0.06, Number.isFinite(frame?.dtSec) ? frame.dtSec : 1 / 60));
    const timeSec = Number.isFinite(frame?.timeSec) ? frame.timeSec : 0;
    const courseTimeSec = Number.isFinite(frame?.courseTimeSec) ? frame.courseTimeSec : 0;
    const reducedMotion = Boolean(frame?.reducedMotion);
    const activeRunners = frame?.runners?.length ? frame.runners.slice(0, SKY_DASH_MAX_RUNNERS) : WAITING_RUNNERS;
    const playerId = frame?.runners?.length ? frame.playerId : WAITING_RUNNERS[0].id;
    const localRunner = activeRunners.find((runnerState) => runnerState.id === playerId) || activeRunners[0];
    const newRound = frame?.roundId != null && frame.roundId !== currentRoundId;
    const snapCamera = !cameraReady || localRunner.id !== followedRunnerId || localRunner.respawnId !== followedRespawnId || newRound;
    if (newRound) {
      currentRoundId = frame.roundId;
      effects.reset();
    }
    if (snapCamera || localRunner.grounded) cameraGroundY = Math.max(0, localRunner.y);
    const cameraTargets = getSkyDashCameraTargets(localRunner, { aspect: camera.aspect, orbit: frame?.cameraOrbit || 0, groundY: cameraGroundY });
    desiredCamera.set(cameraTargets.x, cameraTargets.y, cameraTargets.z);
    desiredLookAt.set(cameraTargets.targetX, cameraTargets.targetY, cameraTargets.targetZ);
    const cameraBlend = snapCamera ? 1 : 1 - Math.exp(-dtSec * (reducedMotion ? 12 : 7.5));
    camera.position.lerp(desiredCamera, cameraBlend);
    cameraLookAt.lerp(desiredLookAt, cameraBlend);
    camera.lookAt(cameraLookAt);
    cameraReady = true;
    followedRunnerId = localRunner.id;
    followedRespawnId = localRunner.respawnId;
    sky.position.copy(camera.position);
    sun.position.set(localRunner.x - 15, cameraGroundY + 30, localRunner.z + 13);
    sun.target.position.set(localRunner.x, cameraGroundY, localRunner.z - 8);

    const sampledPlatforms = course.update(courseTimeSec, timeSec, reducedMotion, { seesaws: frame?.seesaws || [], camera, localRunner, dtSec });
    runners.update({ runners: activeRunners, playerId, dtSec, timeSec, reducedMotion, platforms: sampledPlatforms, camera });
    effects.update({ runners: activeRunners, dtSec, reducedMotion });
    renderer.render(scene, camera);
    smoothedFps += ((dtSec > 0 ? 1 / dtSec : smoothedFps) - smoothedFps) * 0.06;
    cpuFrameMs += (performance.now() - renderStart - cpuFrameMs) * 0.08;
  }

  setQuality("high");
  return {
    resize,
    setQuality,
    render,
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
        particles: effects.getCount(),
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      effects.dispose();
      runners.dispose();
      course.dispose();
      environmentTarget.dispose();
      sun.shadow.map?.dispose();
      scene.clear();
      resources.dispose();
      renderer.renderLists.dispose();
      renderer.dispose();
    },
  };
}
