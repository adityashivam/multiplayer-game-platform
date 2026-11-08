import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/**
 * Owns arena/effect GPU allocations. Athlete resources have their own lifecycle.
 * @returns {{ownGeometry:<T extends THREE.BufferGeometry>(geometry:T)=>T,ownMaterial:<T extends THREE.Material>(material:T)=>T,ownTexture:<T extends THREE.Texture>(texture:T)=>T,box:THREE.BoxGeometry,cylinder:THREE.CylinderGeometry,sphere:THREE.SphereGeometry,plane:THREE.PlaneGeometry,dispose():void}}
 */
export function createRiftballResources() {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  const ownGeometry = (geometry) => { geometries.add(geometry); return geometry; };
  const ownMaterial = (material) => { materials.add(material); return material; };
  const ownTexture = (texture) => { textures.add(texture); return texture; };

  return {
    ownGeometry,
    ownMaterial,
    ownTexture,
    box: ownGeometry(new THREE.BoxGeometry(1, 1, 1)),
    cylinder: ownGeometry(new THREE.CylinderGeometry(0.5, 0.5, 1, 12)),
    sphere: ownGeometry(new THREE.SphereGeometry(0.5, 12, 8)),
    plane: ownGeometry(new THREE.PlaneGeometry(1, 1)),
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
 * Bakes static architecture into one mesh per material and shadow policy, so
 * room detail does not add a draw call for every rail, seat or ceiling beam.
 * @param {ReturnType<typeof createRiftballResources>} resources
 */
export function createRiftballStaticBuilder(resources) {
  const batches = new Map();
  const transform = new THREE.Object3D();

  function addShape(geometry, material, position, scale, rotation = [0, 0, 0], castsShadow = true) {
    transform.position.fromArray(position);
    transform.scale.fromArray(scale);
    transform.rotation.set(...rotation);
    transform.updateMatrix();
    const batchKey = `${material.uuid}:${castsShadow}`;
    let batch = batches.get(batchKey);
    if (!batch) {
      batch = { material, castsShadow, geometries: [] };
      batches.set(batchKey, batch);
    }
    batch.geometries.push(geometry.clone().applyMatrix4(transform.matrix));
  }

  return {
    box(material, position, scale, rotation, castsShadow) {
      addShape(resources.box, material, position, scale, rotation, castsShadow);
    },
    cylinder(material, position, scale, rotation, castsShadow) {
      addShape(resources.cylinder, material, position, scale, rotation, castsShadow);
    },
    sphere(material, position, scale, rotation, castsShadow) {
      addShape(resources.sphere, material, position, scale, rotation, castsShadow);
    },
    plane(material, position, scale, rotation, castsShadow = false) {
      addShape(resources.plane, material, position, scale, rotation, castsShadow);
    },
    geometry(geometry, material, position, scale, rotation, castsShadow = false) {
      addShape(geometry, material, position, scale, rotation, castsShadow);
    },
    finish(parent) {
      for (const batch of batches.values()) {
        const geometry = resources.ownGeometry(mergeGeometries(batch.geometries));
        const mesh = new THREE.Mesh(geometry, batch.material);
        mesh.castShadow = batch.castsShadow;
        mesh.receiveShadow = true;
        parent.add(mesh);
        for (const sourceGeometry of batch.geometries) sourceGeometry.dispose();
      }
      batches.clear();
    },
  };
}

/** Deterministic decorative noise; never used by simulation. @param {number} seed */
export function createRiftballVisualRandom(seed) {
  let randomState = seed >>> 0;
  return () => {
    randomState = (randomState * 1664525 + 1013904223) >>> 0;
    return randomState / 4294967296;
  };
}

/** @param {ReturnType<typeof createRiftballResources>} resources */
export function createRiftballCourtTexture(resources) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 1024;
  const context = canvas.getContext("2d");
  const random = createRiftballVisualRandom(403);
  context.fillStyle = "#344c62";
  context.fillRect(0, 0, 1024, 1024);
  for (let index = 0; index < 18000; index += 1) {
    const shade = 80 + Math.floor(random() * 80);
    context.fillStyle = `rgba(${shade},${shade + 8},${shade + 16},${random() * 0.06})`;
    context.fillRect(random() * 1024, random() * 1024, 1 + random() * 2, 1 + random() * 2);
  }
  context.strokeStyle = "rgba(9,24,39,0.13)";
  context.lineWidth = 1;
  for (let index = 1; index < 12; index += 1) {
    context.beginPath();
    context.moveTo(0, index * 1024 / 12);
    context.lineTo(1024, index * 1024 / 12);
    context.stroke();
  }
  const texture = resources.ownTexture(new THREE.CanvasTexture(canvas));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** @param {ReturnType<typeof createRiftballResources>} resources */
export function createRiftballVenueLabel(resources) {
  const canvas = document.createElement("canvas");
  canvas.width = 1536;
  canvas.height = 384;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, 1536, 384);
  context.textAlign = "center";
  context.fillStyle = "#eaf6f5";
  context.font = "900 194px Arial, sans-serif";
  context.fillText("RIFTBALL", 768, 224);
  context.fillStyle = "#8cb6c0";
  context.font = "500 32px Arial, sans-serif";
  context.fillText("D U E L   /   T H E   I N D O O R   C O U R T", 768, 304);
  const texture = resources.ownTexture(new THREE.CanvasTexture(canvas));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Soft contact under the airborne ball. @param {ReturnType<typeof createRiftballResources>} resources */
export function createRiftballContactTexture(resources) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(64, 64, 6, 64, 64, 64);
  gradient.addColorStop(0, "rgba(0,8,18,0.7)");
  gradient.addColorStop(0.42, "rgba(0,8,18,0.4)");
  gradient.addColorStop(1, "rgba(0,8,18,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  return resources.ownTexture(new THREE.CanvasTexture(canvas));
}
