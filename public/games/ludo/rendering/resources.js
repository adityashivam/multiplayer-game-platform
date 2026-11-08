import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** @typedef {ReturnType<typeof createLudoResources>} LudoResources */

/** Own every GPU allocation once, including resources shared by many pawns. */
export function createLudoResources() {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();

  return {
    /** @template {THREE.BufferGeometry} T @param {T} geometry @returns {T} */
    geometry(geometry) {
      geometries.add(geometry);
      return geometry;
    },
    /** @template {THREE.Material} T @param {T} material @returns {T} */
    material(material) {
      materials.add(material);
      return material;
    },
    /** @template {THREE.Texture} T @param {T} texture @returns {T} */
    texture(texture) {
      textures.add(texture);
      return texture;
    },
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
      geometries.clear();
      materials.clear();
      textures.clear();
    },
  };
}

/**
 * Bake fixed architecture by material and shadow policy. Instanced tracks and
 * animated pieces stay outside this group; a colorful board needs few draws.
 * @param {THREE.Group} staticGroup
 * @param {LudoResources} resources
 */
export function bakeLudoStaticMeshes(staticGroup, resources) {
  const batches = new Map();
  staticGroup.updateMatrixWorld(true);

  staticGroup.traverse((mesh) => {
    if (!mesh.isMesh || mesh.isInstancedMesh || Array.isArray(mesh.material)) return;

    const key = `${mesh.material.uuid}:${mesh.castShadow}:${mesh.receiveShadow}`;
    const batch = batches.get(key) ?? {
      material: mesh.material,
      castShadow: mesh.castShadow,
      receiveShadow: mesh.receiveShadow,
      geometries: [],
    };
    const transformedGeometry = mesh.geometry.index
      ? mesh.geometry.toNonIndexed()
      : mesh.geometry.clone();

    transformedGeometry.applyMatrix4(mesh.matrixWorld);
    batch.geometries.push(transformedGeometry);
    batches.set(key, batch);
  });

  staticGroup.clear();

  for (const batch of batches.values()) {
    const mergedGeometry = resources.geometry(mergeGeometries(batch.geometries));
    const bakedMesh = new THREE.Mesh(mergedGeometry, batch.material);
    bakedMesh.castShadow = batch.castShadow;
    bakedMesh.receiveShadow = batch.receiveShadow;
    staticGroup.add(bakedMesh);

    for (const geometry of batch.geometries) geometry.dispose();
  }
}

/**
 * @param {LudoResources} resources
 * @param {number} size
 * @param {(context:CanvasRenderingContext2D,size:number)=>void} drawTexture
 * @returns {THREE.CanvasTexture}
 */
export function createLudoCanvasTexture(resources, size, drawTexture) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  drawTexture(context, size);

  const texture = resources.texture(new THREE.CanvasTexture(canvas));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** @param {LudoResources} resources @returns {THREE.CanvasTexture} */
export function createLudoContactTexture(resources) {
  return createLudoCanvasTexture(resources, 128, (context, size) => {
    const gradient = context.createRadialGradient(size / 2, size / 2, 4, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "rgba(0,0,0,0.65)");
    gradient.addColorStop(0.38, "rgba(0,0,0,0.35)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  });
}

/** @param {number} value @returns {number} */
export function clampLudoUnit(value) {
  return Math.max(0, Math.min(1, value));
}

/** @param {number} value @returns {number} */
export function easeLudoSmooth(value) {
  const boundedValue = clampLudoUnit(value);
  return boundedValue * boundedValue * (3 - 2 * boundedValue);
}
