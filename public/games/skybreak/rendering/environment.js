import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";
import { SKYBREAK_CANYON_LENGTH_M, SKYBREAK_COURSE_GATES, getSkybreakCanyonPoint, getSkybreakTerrainHeight } from "../shared/terrain.js";

const TERRAIN_SIZE_M = 4600;
const TERRAIN_SEGMENTS = 230;
const CLOUD_COUNT = 70;
const CLOUD_DRIFT_MPS = 4;
const SUN_ELEVATION_DEG = 7;
const SUN_AZIMUTH_DEG = 250;

/** Soft procedural cloud puff on a canvas. */
function createCloudTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  for (let blob = 0; blob < 16; blob += 1) {
    const x = size / 2 + (Math.random() - 0.5) * size * 0.5;
    const y = size / 2 + (Math.random() - 0.5) * size * 0.25;
    const radius = size * (0.15 + Math.random() * 0.2);
    const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, "rgba(255,255,255,0.55)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Tiled wave normals for water, generated on a canvas. */
function createWaterNormals() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  const image = context.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const u = (x / size) * Math.PI * 2;
      const v = (y / size) * Math.PI * 2;
      const slopeX = Math.cos(u * 3 + Math.sin(v * 2)) * 0.5 + Math.cos(u * 7 + v * 5) * 0.25;
      const slopeY = Math.cos(v * 4 + Math.sin(u * 3)) * 0.5 + Math.sin(v * 6 - u * 4) * 0.25;
      const offset = (y * size + x) * 4;
      image.data.set([128 + slopeX * 90, 128 + slopeY * 90, 255, 255], offset);
    }
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/**
 * Sky, lighting environment, terrain, river, sea, clouds and course gates.
 * @param {THREE.Scene} scene
 * @param {THREE.WebGLRenderer} renderer
 * @param {{showGates:boolean}} options
 */
export function createSkybreakEnvironment(scene, renderer, { showGates }) {
  const disposables = [];
  const group = new THREE.Group();
  scene.add(group);

  const sunDirection = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - SUN_ELEVATION_DEG), THREE.MathUtils.degToRad(SUN_AZIMUTH_DEG));
  const configureSky = (sky) => {
    sky.scale.setScalar(20000);
    sky.material.uniforms.turbidity.value = 5;
    sky.material.uniforms.rayleigh.value = 2.2;
    sky.material.uniforms.mieCoefficient.value = 0.006;
    sky.material.uniforms.mieDirectionalG.value = 0.85;
    sky.material.uniforms.sunPosition.value.copy(sunDirection);
    return sky;
  };
  const sky = configureSky(new Sky());
  group.add(sky);
  const environmentScene = new THREE.Scene();
  const environmentSky = configureSky(new Sky());
  environmentScene.add(environmentSky);
  const generator = new THREE.PMREMGenerator(renderer);
  const environmentTarget = generator.fromScene(environmentScene, 0.04);
  scene.environment = environmentTarget.texture;
  scene.environmentIntensity = 0.6;
  generator.dispose();
  environmentSky.geometry.dispose();
  environmentSky.material.dispose();
  disposables.push(environmentTarget, sky.geometry, sky.material);

  const terrainGeometry = new THREE.PlaneGeometry(TERRAIN_SIZE_M, TERRAIN_SIZE_M, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
  terrainGeometry.rotateX(-Math.PI / 2);
  const positions = terrainGeometry.attributes.position;
  for (let index = 0; index < positions.count; index += 1) {
    positions.setY(index, getSkybreakTerrainHeight(positions.getX(index), positions.getZ(index)));
  }
  terrainGeometry.computeVertexNormals();
  const normals = terrainGeometry.attributes.normal;
  const colors = new Float32Array(positions.count * 3);
  const sand = new THREE.Color("#c9a77c");
  const scrub = new THREE.Color("#6e7442");
  const dryGrass = new THREE.Color("#a38f55");
  const rock = new THREE.Color("#7d6a5d");
  const darkRock = new THREE.Color("#4f4540");
  const snow = new THREE.Color("#eef0f3");
  const color = new THREE.Color();
  for (let index = 0; index < positions.count; index += 1) {
    const height = positions.getY(index);
    const steepness = 1 - normals.getY(index);
    const variation = Math.sin(positions.getX(index) * 0.013) * Math.cos(positions.getZ(index) * 0.011) * 0.5 + 0.5;
    color.copy(scrub).lerp(dryGrass, variation);
    if (height < 12) color.copy(sand);
    color.lerp(rock, THREE.MathUtils.smoothstep(steepness, 0.18, 0.4));
    color.lerp(darkRock, THREE.MathUtils.smoothstep(steepness, 0.45, 0.7) * 0.7);
    color.lerp(snow, THREE.MathUtils.smoothstep(height, 360, 430) * (1 - THREE.MathUtils.smoothstep(steepness, 0.35, 0.6)));
    colors.set([color.r, color.g, color.b], index * 3);
  }
  terrainGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const terrainMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0, flatShading: false });
  const terrain = new THREE.Mesh(terrainGeometry, terrainMaterial);
  terrain.receiveShadow = true;
  group.add(terrain);
  disposables.push(terrainGeometry, terrainMaterial);

  const waterNormals = createWaterNormals();
  waterNormals.repeat.set(140, 140);
  const seaGeometry = new THREE.PlaneGeometry(30000, 30000).rotateX(-Math.PI / 2);
  const seaMaterial = new THREE.MeshPhysicalMaterial({ color: "#164a63", roughness: 0.16, metalness: 0.05, normalMap: waterNormals, normalScale: new THREE.Vector2(0.3, 0.3), clearcoat: 0.6, clearcoatRoughness: 0.2 });
  const sea = new THREE.Mesh(seaGeometry, seaMaterial);
  sea.position.y = 0.2;
  group.add(sea);
  disposables.push(waterNormals, seaGeometry, seaMaterial);

  const riverPositions = [];
  const riverIndices = [];
  const riverSteps = 160;
  for (let step = 0; step <= riverSteps; step += 1) {
    const point = getSkybreakCanyonPoint((step / riverSteps) * SKYBREAK_CANYON_LENGTH_M);
    const sideX = -point.directionZ;
    const sideZ = point.directionX;
    riverPositions.push(point.x + sideX * 40, 29, point.z + sideZ * 40, point.x - sideX * 40, 29, point.z - sideZ * 40);
    if (step < riverSteps) riverIndices.push(step * 2, step * 2 + 1, step * 2 + 2, step * 2 + 1, step * 2 + 3, step * 2 + 2);
  }
  const riverGeometry = new THREE.BufferGeometry();
  riverGeometry.setAttribute("position", new THREE.Float32BufferAttribute(riverPositions, 3));
  riverGeometry.setIndex(riverIndices);
  riverGeometry.computeVertexNormals();
  const river = new THREE.Mesh(riverGeometry, new THREE.MeshPhysicalMaterial({ color: "#2b6a7a", roughness: 0.12, metalness: 0.1, side: THREE.DoubleSide }));
  group.add(river);
  disposables.push(riverGeometry, river.material);

  const cloudTexture = createCloudTexture();
  const cloudMaterial = new THREE.SpriteMaterial({ map: cloudTexture, color: "#ffe2cc", transparent: true, depthWrite: false, fog: true, opacity: 0.85 });
  const clouds = [];
  for (let index = 0; index < CLOUD_COUNT; index += 1) {
    const angle = (index / CLOUD_COUNT) * Math.PI * 2 * 3.7;
    const distance = 300 + ((index * 977) % 2600);
    const cloud = new THREE.Sprite(cloudMaterial);
    const scale = 180 + ((index * 131) % 260);
    cloud.scale.set(scale * 1.8, scale * 0.7, 1);
    cloud.position.set(Math.cos(angle) * distance, 650 + ((index * 53) % 650), Math.sin(angle) * distance);
    group.add(cloud);
    clouds.push(cloud);
  }
  disposables.push(cloudTexture, cloudMaterial);

  const gateGroup = new THREE.Group();
  gateGroup.visible = showGates;
  group.add(gateGroup);
  const gateGeometry = new THREE.TorusGeometry(1, 0.045, 10, 56);
  const gateMeshes = SKYBREAK_COURSE_GATES.map((gate) => {
    const material = new THREE.MeshBasicMaterial({ color: "#ffd23f", transparent: true, opacity: 0.9, toneMapped: false });
    const ring = new THREE.Mesh(gateGeometry, material);
    ring.scale.setScalar(gate.radius);
    ring.position.set(gate.x, gate.y, gate.z);
    ring.lookAt(gate.x + gate.forwardX, gate.y + gate.forwardY, gate.z + gate.forwardZ);
    gateGroup.add(ring);
    disposables.push(material);
    return ring;
  });
  disposables.push(gateGeometry);

  return {
    sunDirection,
    /** @param {number} timeSec @param {number} dtSec @param {number} nextGateIndex */
    update(timeSec, dtSec, nextGateIndex) {
      waterNormals.offset.set(timeSec * 0.003, timeSec * 0.005);
      for (const cloud of clouds) cloud.position.x += CLOUD_DRIFT_MPS * dtSec;
      gateMeshes.forEach((ring, index) => {
        ring.visible = index >= nextGateIndex;
        const next = index === nextGateIndex;
        ring.material.opacity = next ? 0.75 + Math.sin(timeSec * 6) * 0.2 : 0.3;
        ring.material.color.set(next ? "#ffd23f" : "#8dffd0");
      });
    },
    dispose() {
      scene.remove(group);
      if (scene.environment === environmentTarget.texture) scene.environment = null;
      disposables.forEach((disposable) => disposable.dispose());
    },
  };
}
