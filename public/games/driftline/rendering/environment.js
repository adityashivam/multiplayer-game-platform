import * as THREE from "three";
import { Sky } from "three/addons/objects/Sky.js";

/** @typedef {import("../shared/track.js").DriftlineTrack} DriftlineTrack */

const TERRAIN_MARGIN_M = 260;
const TERRAIN_SEGMENTS = 180;
const SEA_LEVEL = -7;
const ROAD_FLATTEN_M = 6;
const ROAD_BLEND_M = 32;
const HASH_CELL_M = 24;
const TREE_COUNT = 520;
const ROCK_COUNT = 140;
const SUN_ELEVATION_DEG = 4;
const SUN_AZIMUTH_DEG = 235;

/** Smooth value noise in [0, 1); cheap and dependency-free. @param {number} x @param {number} z */
function noise2(x, z) {
  const hash = (ix, iz) => {
    const value = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453;
    return value - Math.floor(value);
  };
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const top = hash(ix, iz) + (hash(ix + 1, iz) - hash(ix, iz)) * sx;
  const bottom = hash(ix, iz + 1) + (hash(ix + 1, iz + 1) - hash(ix, iz + 1)) * sx;
  return top + (bottom - top) * sz;
}

/** @param {number} x @param {number} z */
function fractalNoise(x, z) {
  return noise2(x, z) * 0.55 + noise2(x * 2.1, z * 2.1) * 0.28 + noise2(x * 4.3, z * 4.3) * 0.17;
}

/**
 * Bucket track samples so nearest-road queries scan a few cells, not the lap.
 * @param {Readonly<DriftlineTrack>} track
 */
function createTrackSampleIndex(track) {
  const buckets = new Map();
  for (let index = 0; index < track.sampleCount; index += 1) {
    const key = `${Math.floor(track.x[index] / HASH_CELL_M)},${Math.floor(track.z[index] / HASH_CELL_M)}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(index);
  }
  return {
    /** @returns {{distance:number,index:number}} Nearest sample within three cells, or Infinity. */
    nearest(x, z) {
      const cellX = Math.floor(x / HASH_CELL_M);
      const cellZ = Math.floor(z / HASH_CELL_M);
      let best = { distance: Infinity, index: -1 };
      for (let offsetX = -3; offsetX <= 3; offsetX += 1) {
        for (let offsetZ = -3; offsetZ <= 3; offsetZ += 1) {
          for (const index of buckets.get(`${cellX + offsetX},${cellZ + offsetZ}`) ?? []) {
            const distance = Math.hypot(x - track.x[index], z - track.z[index]);
            if (distance < best.distance) best = { distance, index };
          }
        }
      }
      return best;
    },
  };
}

/**
 * Coastal land: the sea lies south of the shoreline curve, hills rise to the
 * north, and the ground eases flat to the road surface near the track.
 * @param {Readonly<DriftlineTrack>} track
 * @param {ReturnType<typeof createTrackSampleIndex>} sampleIndex
 */
function createCoastHeight(track, sampleIndex) {
  return (x, z) => {
    const shoreZ = 175 + Math.sin(x * 0.012) * 25 + Math.sin(x * 0.031) * 8;
    const inland = Math.max(0, shoreZ - z);
    const hills = fractalNoise(x * 0.008, z * 0.008) * 42 * Math.min(1, inland / 160) + inland * 0.04;
    const beach = SEA_LEVEL + Math.min(9, inland * 0.12);
    let natural = Math.max(beach, beach + hills - 4);
    if (z > shoreZ) natural = SEA_LEVEL - Math.min(14, (z - shoreZ) * 0.25);
    const nearest = sampleIndex.nearest(x, z);
    if (nearest.index < 0) return natural;
    const roadEdge = track.halfWidth[nearest.index] + track.runoffM + ROAD_FLATTEN_M;
    const roadHeight = track.y[nearest.index] - 0.12;
    if (nearest.distance <= roadEdge) return roadHeight;
    const blend = Math.min(1, (nearest.distance - roadEdge) / ROAD_BLEND_M);
    const eased = blend * blend * (3 - 2 * blend);
    return roadHeight + (natural - roadHeight) * eased;
  };
}

/** Canvas noise normal map for the sea; generated, never downloaded. */
function createWaveNormalTexture() {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  const image = context.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const angleX = (x / size) * Math.PI * 2;
      const angleY = (y / size) * Math.PI * 2;
      const slopeX = Math.cos(angleX * 3 + Math.sin(angleY * 2)) * 0.5 + Math.cos(angleX * 7 + angleY * 5) * 0.25;
      const slopeY = Math.cos(angleY * 4 + Math.sin(angleX * 3)) * 0.5 + Math.sin(angleY * 6 - angleX * 4) * 0.25;
      const offset = (y * size + x) * 4;
      image.data[offset] = 128 + slopeX * 90;
      image.data[offset + 1] = 128 + slopeY * 90;
      image.data[offset + 2] = 255;
      image.data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(60, 60);
  return texture;
}

/**
 * Sunset sky, environment lighting, animated sea, coastal terrain and
 * instanced scenery for one track. Owns its GPU resources.
 * @param {THREE.Scene} scene
 * @param {THREE.WebGLRenderer} renderer
 * @param {Readonly<DriftlineTrack>} track
 * @returns {{sunDirection:THREE.Vector3,update(timeSec:number):void,dispose():void}}
 */
export function createDriftlineEnvironment(scene, renderer, track) {
  const disposables = [];
  const group = new THREE.Group();
  scene.add(group);

  const sky = new Sky();
  sky.scale.setScalar(4000);
  const sunDirection = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - SUN_ELEVATION_DEG), THREE.MathUtils.degToRad(SUN_AZIMUTH_DEG));
  Object.assign(sky.material.uniforms.turbidity, { value: 6 });
  Object.assign(sky.material.uniforms.rayleigh, { value: 2.6 });
  Object.assign(sky.material.uniforms.mieCoefficient, { value: 0.008 });
  Object.assign(sky.material.uniforms.mieDirectionalG, { value: 0.86 });
  sky.material.uniforms.sunPosition.value.copy(sunDirection);
  group.add(sky);
  const environmentScene = new THREE.Scene();
  const environmentSky = new Sky();
  environmentSky.scale.setScalar(4000);
  for (const name of ["turbidity", "rayleigh", "mieCoefficient", "mieDirectionalG"]) {
    environmentSky.material.uniforms[name].value = sky.material.uniforms[name].value;
  }
  environmentSky.material.uniforms.sunPosition.value.copy(sunDirection);
  environmentScene.add(environmentSky);
  const environmentGenerator = new THREE.PMREMGenerator(renderer);
  const environmentTarget = environmentGenerator.fromScene(environmentScene, 0.04);
  scene.environment = environmentTarget.texture;
  scene.environmentIntensity = 0.55;
  environmentGenerator.dispose();
  environmentSky.geometry.dispose();
  environmentSky.material.dispose();
  disposables.push(environmentTarget, sky.geometry, sky.material);

  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let index = 0; index < track.sampleCount; index += 1) {
    minX = Math.min(minX, track.x[index]);
    maxX = Math.max(maxX, track.x[index]);
    minZ = Math.min(minZ, track.z[index]);
    maxZ = Math.max(maxZ, track.z[index]);
  }
  const centerX = (minX + maxX) / 2;
  const centerZ = (minZ + maxZ) / 2;
  const terrainSize = Math.max(maxX - minX, maxZ - minZ) + TERRAIN_MARGIN_M * 2;
  const sampleIndex = createTrackSampleIndex(track);
  const heightAt = createCoastHeight(track, sampleIndex);

  const terrainGeometry = new THREE.PlaneGeometry(terrainSize, terrainSize, TERRAIN_SEGMENTS, TERRAIN_SEGMENTS);
  terrainGeometry.rotateX(-Math.PI / 2);
  const positions = terrainGeometry.attributes.position;
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index) + centerX;
    const z = positions.getZ(index) + centerZ;
    positions.setXYZ(index, x, heightAt(x, z), z);
  }
  terrainGeometry.computeVertexNormals();
  const colors = new Float32Array(positions.count * 3);
  const sand = new THREE.Color("#d9b58a");
  const grass = new THREE.Color("#7f8f45");
  const dryGrass = new THREE.Color("#b49a55");
  const rock = new THREE.Color("#7c6a5e");
  const shoulder = new THREE.Color("#8d7b60");
  const mixed = new THREE.Color();
  const normals = terrainGeometry.attributes.normal;
  for (let index = 0; index < positions.count; index += 1) {
    const x = positions.getX(index);
    const y = positions.getY(index);
    const z = positions.getZ(index);
    const steepness = 1 - normals.getY(index);
    const variation = fractalNoise(x * 0.03, z * 0.03);
    mixed.copy(grass).lerp(dryGrass, variation);
    if (y < SEA_LEVEL + 3.5) mixed.copy(sand);
    if (steepness > 0.22) mixed.lerp(rock, Math.min(1, (steepness - 0.22) * 3));
    const near = sampleIndex.nearest(x, z);
    if (near.index >= 0 && near.distance < track.halfWidth[near.index] + track.runoffM + ROAD_FLATTEN_M + 4) mixed.lerp(shoulder, 0.6);
    colors[index * 3] = mixed.r;
    colors[index * 3 + 1] = mixed.g;
    colors[index * 3 + 2] = mixed.b;
  }
  terrainGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const terrainMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  const terrain = new THREE.Mesh(terrainGeometry, terrainMaterial);
  terrain.receiveShadow = true;
  group.add(terrain);
  disposables.push(terrainGeometry, terrainMaterial);

  const waveNormals = createWaveNormalTexture();
  const seaGeometry = new THREE.PlaneGeometry(6000, 6000);
  seaGeometry.rotateX(-Math.PI / 2);
  const seaMaterial = new THREE.MeshPhysicalMaterial({
    color: "#1b4a66",
    roughness: 0.18,
    metalness: 0.05,
    normalMap: waveNormals,
    normalScale: new THREE.Vector2(0.35, 0.35),
    clearcoat: 0.6,
    clearcoatRoughness: 0.25,
  });
  const sea = new THREE.Mesh(seaGeometry, seaMaterial);
  sea.position.y = SEA_LEVEL + 0.4;
  group.add(sea);
  disposables.push(waveNormals, seaGeometry, seaMaterial);

  const scatter = (count, accept) => {
    const placements = [];
    let attempt = 0;
    while (placements.length < count && attempt < count * 30) {
      attempt += 1;
      const x = centerX + (noise2(attempt * 0.73, 11.3) - 0.5) * terrainSize * 0.92;
      const z = centerZ + (noise2(19.7, attempt * 0.61) - 0.5) * terrainSize * 0.92;
      const near = sampleIndex.nearest(x, z);
      const clearance = near.index >= 0 ? near.distance - track.halfWidth[near.index] - track.runoffM : Infinity;
      const y = heightAt(x, z);
      if (accept(x, y, z, clearance)) placements.push({ x, y, z, seed: noise2(x * 0.37, z * 0.41) });
    }
    return placements;
  };

  const treePlacements = scatter(TREE_COUNT, (_x, y, _z, clearance) => clearance > 10 && y > SEA_LEVEL + 4);
  const trunkGeometry = new THREE.CylinderGeometry(0.18, 0.28, 2.2, 6).translate(0, 1.1, 0);
  const crownGeometry = new THREE.ConeGeometry(1.6, 5.2, 7).translate(0, 4.6, 0);
  const trunkMaterial = new THREE.MeshStandardMaterial({ color: "#5a3d2b", roughness: 0.9 });
  const crownMaterial = new THREE.MeshStandardMaterial({ color: "#3f5f32", roughness: 0.85, flatShading: true });
  const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, treePlacements.length);
  const crowns = new THREE.InstancedMesh(crownGeometry, crownMaterial, treePlacements.length);
  const matrix = new THREE.Matrix4();
  const crownColor = new THREE.Color();
  treePlacements.forEach((placement, index) => {
    const scale = 0.75 + placement.seed * 0.9;
    matrix.compose(new THREE.Vector3(placement.x, placement.y - 0.2, placement.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, placement.seed * 6, 0)), new THREE.Vector3(scale, scale * (0.9 + placement.seed * 0.4), scale));
    trunks.setMatrixAt(index, matrix);
    crowns.setMatrixAt(index, matrix);
    crowns.setColorAt(index, crownColor.set("#3f5f32").offsetHSL(placement.seed * 0.05 - 0.02, 0, placement.seed * 0.08 - 0.04));
  });
  trunks.castShadow = true;
  crowns.castShadow = true;
  group.add(trunks, crowns);
  disposables.push(trunkGeometry, crownGeometry, trunkMaterial, crownMaterial, trunks, crowns);

  const rockPlacements = scatter(ROCK_COUNT, (_x, y, _z, clearance) => clearance > 5 && y > SEA_LEVEL - 2);
  const rockGeometry = new THREE.DodecahedronGeometry(1, 0);
  const rockMaterial = new THREE.MeshStandardMaterial({ color: "#8a7464", roughness: 0.95, flatShading: true });
  const rocks = new THREE.InstancedMesh(rockGeometry, rockMaterial, rockPlacements.length);
  rockPlacements.forEach((placement, index) => {
    const scale = 0.8 + placement.seed * 3.2;
    matrix.compose(new THREE.Vector3(placement.x, placement.y, placement.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(placement.seed * 3, placement.seed * 9, 0)), new THREE.Vector3(scale, scale * 0.7, scale * 1.1));
    rocks.setMatrixAt(index, matrix);
  });
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  group.add(rocks);
  disposables.push(rockGeometry, rockMaterial, rocks);

  const lighthouse = new THREE.Group();
  const towerGeometry = new THREE.CylinderGeometry(2.2, 3.2, 22, 16, 6);
  const stripeColors = [];
  const towerPositions = towerGeometry.attributes.position;
  for (let index = 0; index < towerPositions.count; index += 1) {
    const band = Math.floor((towerPositions.getY(index) + 11) / 3.7) % 2;
    const color = band ? new THREE.Color("#f2ece4") : new THREE.Color("#c2412f");
    stripeColors.push(color.r, color.g, color.b);
  }
  towerGeometry.setAttribute("color", new THREE.Float32BufferAttribute(stripeColors, 3));
  const towerMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
  const tower = new THREE.Mesh(towerGeometry, towerMaterial);
  tower.position.y = 11;
  tower.castShadow = true;
  const lampGeometry = new THREE.CylinderGeometry(1.9, 1.9, 2.4, 12);
  const lampMaterial = new THREE.MeshStandardMaterial({ color: "#fff2c4", emissive: "#ffd36a", emissiveIntensity: 3 });
  const lamp = new THREE.Mesh(lampGeometry, lampMaterial);
  lamp.position.y = 23.2;
  const capGeometry = new THREE.ConeGeometry(2.6, 2.6, 12);
  const cap = new THREE.Mesh(capGeometry, new THREE.MeshStandardMaterial({ color: "#2a2a30", roughness: 0.5 }));
  cap.position.y = 25.6;
  lighthouse.add(tower, lamp, cap);
  const lighthouseX = maxX + 40;
  const lighthouseZ = maxZ + 15;
  lighthouse.position.set(lighthouseX, heightAt(lighthouseX, lighthouseZ) - 0.5, lighthouseZ);
  group.add(lighthouse);
  disposables.push(towerGeometry, towerMaterial, lampGeometry, lampMaterial, capGeometry, cap.material);

  return {
    sunDirection,
    update(timeSec) {
      waveNormals.offset.set(timeSec * 0.004, timeSec * 0.0065);
      lampMaterial.emissiveIntensity = 2.6 + Math.sin(timeSec * 2.2) * 0.6;
    },
    dispose() {
      scene.remove(group);
      if (scene.environment === environmentTarget.texture) scene.environment = null;
      for (const disposable of disposables) disposable.dispose();
    },
  };
}
