import * as THREE from "three";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

function createBeveledBoxGeometry() {
  const outline = new THREE.Shape();
  outline.moveTo(-0.465, -0.465);
  outline.lineTo(0.465, -0.465);
  outline.lineTo(0.465, 0.465);
  outline.lineTo(-0.465, 0.465);
  outline.closePath();
  const extrudedGeometry = new THREE.ExtrudeGeometry(outline, { depth: 0.93, bevelEnabled: true, bevelSize: 0.035, bevelThickness: 0.035, bevelSegments: 1, steps: 1 });
  extrudedGeometry.center();
  const indexedGeometry = mergeVertices(extrudedGeometry);
  extrudedGeometry.dispose();
  return indexedGeometry;
}

/**
 * A deterministic visual seed keeps surface wear stable between clients.
 * @param {number} seed
 * @returns {() => number}
 */
export function createVisualRandom(seed = 173) {
  let state = seed >>> 0;

  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** @typedef {ReturnType<typeof createRenderResources>} DeadShiftRenderResources */

/** Owns every shared GPU allocation made by the renderer. */
export function createRenderResources() {
  /** @type {Set<THREE.BufferGeometry>} */
  const geometries = new Set();
  /** @type {Set<THREE.Material>} */
  const materials = new Set();
  /** @type {Set<THREE.Texture>} */
  const textures = new Set();

  /**
   * @template {THREE.BufferGeometry} Geometry
   * @param {Geometry} geometry
   * @returns {Geometry}
   */
  const ownGeometry = (geometry) => {
    geometries.add(geometry);
    return geometry;
  };
  /**
   * @template {THREE.Material} Material
   * @param {Material} material
   * @returns {Material}
   */
  const ownMaterial = (material) => {
    materials.add(material);
    return material;
  };
  /**
   * @template {THREE.Texture} Texture
   * @param {Texture} texture
   * @returns {Texture}
   */
  const ownTexture = (texture) => {
    textures.add(texture);
    return texture;
  };

  return {
    ownGeometry,
    ownMaterial,
    ownTexture,
    box: ownGeometry(new THREE.BoxGeometry(1, 1, 1)),
    beveledBox: ownGeometry(createBeveledBoxGeometry()),
    cylinder: ownGeometry(new THREE.CylinderGeometry(0.5, 0.5, 1, 12)),
    sphere: ownGeometry(new THREE.SphereGeometry(0.5, 12, 8)),
    plane: ownGeometry(new THREE.PlaneGeometry(1, 1)),
    cone: ownGeometry(new THREE.ConeGeometry(0.5, 1, 10)),
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
 * Bakes fixed industrial architecture into one mesh per material. Source
 * geometries are temporary; the returned meshes use resource-owned buffers.
 * @param {DeadShiftRenderResources} resources
 * @param {{beveled?: boolean}} options
 */
export function createStaticMeshBuilder(resources, { beveled = false } = {}) {
  const materialGeometries = new Map();
  const transform = new THREE.Object3D();

  function addShape(geometry, material, position, scale, rotation = [0, 0, 0]) {
    transform.position.fromArray(position);
    transform.scale.fromArray(scale);
    transform.rotation.set(...rotation);
    transform.updateMatrix();

    const transformedGeometry = geometry.clone().applyMatrix4(transform.matrix);
    const materialShapes = materialGeometries.get(material) || [];
    materialShapes.push(transformedGeometry);
    materialGeometries.set(material, materialShapes);
  }

  return {
    box(material, position, scale, rotation) {
      addShape(beveled ? resources.beveledBox : resources.box, material, position, scale, rotation);
    },
    cylinder(material, position, scale, rotation) {
      addShape(resources.cylinder, material, position, scale, rotation);
    },
    sphere(material, position, scale, rotation) {
      addShape(resources.sphere, material, position, scale, rotation);
    },
    plane(material, position, scale, rotation) {
      addShape(resources.plane, material, position, scale, rotation);
    },
    finish(parent, { shadows = true } = {}) {
      for (const [material, sourceGeometries] of materialGeometries) {
        const geometry = resources.ownGeometry(mergeGeometries(sourceGeometries));
        const mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = shadows;
        mesh.receiveShadow = true;
        parent.add(mesh);
        for (const sourceGeometry of sourceGeometries) sourceGeometry.dispose();
      }
      materialGeometries.clear();
    },
  };
}

/**
 * Canvas maps are generated locally; no image request or external asset is used.
 * @param {DeadShiftRenderResources} resources
 * @param {"floor" | "concrete"} kind
 * @returns {THREE.CanvasTexture}
 */
export function createSurfaceTexture(resources, kind) {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  const random = createVisualRandom(kind === "floor" ? 41 : 87);
  const floor = kind === "floor";

  context.fillStyle = floor ? "#596365" : "#6b7470";
  context.fillRect(0, 0, size, size);

  for (let index = 0; index < 24000; index += 1) {
    const shade = Math.floor(42 + random() * 106);
    context.fillStyle = `rgba(${shade},${shade + 4},${shade + 3},${0.1 + random() * 0.22})`;
    context.fillRect(random() * size, random() * size, 1 + random() * 3, 1 + random() * 2);
  }

  for (let index = 0; index < 55; index += 1) {
    const x = random() * size;
    const y = random() * size;
    const radius = 10 + random() * 90;
    const stain = context.createRadialGradient(x, y, 0, x, y, radius);
    stain.addColorStop(0, index % 3 ? "rgba(23,35,35,.25)" : "rgba(78,42,20,.22)");
    stain.addColorStop(1, "rgba(15,25,24,0)");
    context.fillStyle = stain;
    context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  context.strokeStyle = "rgba(12,23,25,.65)";
  context.lineWidth = floor ? 4 : 2;
  context.strokeRect(1, 1, size - 2, size - 2);
  context.strokeStyle = "rgba(193,208,198,.17)";
  context.lineWidth = 1;
  context.strokeRect(5, 5, size - 10, size - 10);

  if (floor) {
    for (const x of [18, size - 18]) {
      for (const y of [18, size - 18]) {
        context.fillStyle = "#293c3e";
        context.beginPath();
        context.arc(x, y, 4, 0, Math.PI * 2);
        context.fill();
      }
    }
    for (let index = 0; index < 50; index += 1) {
      context.strokeStyle = "rgba(178,197,184,.10)";
      context.beginPath();
      const x = random() * size;
      const y = random() * size;
      context.moveTo(x, y);
      context.lineTo(x + random() * 60 - 30, y + random() * 12 - 6);
      context.stroke();
    }
  } else {
    for (let index = 0; index < 24; index += 1) {
      const x = random() * size;
      context.fillStyle = "rgba(21,32,31,.13)";
      context.fillRect(x, random() * 200, 2 + random() * 4, 150 + random() * 350);
    }
  }

  const texture = resources.ownTexture(new THREE.CanvasTexture(canvas));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  texture.repeat.set(floor ? 16 : 8, floor ? 12 : 2);
  return texture;
}

export function createLabelTexture(resources, text, subtitle, color = "#d9d1ad") {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = color;
  context.font = "800 106px Arial, sans-serif";
  context.textAlign = "center";
  context.fillText(text, 512, 130);
  context.font = "28px Arial, sans-serif";
  context.fillText(subtitle, 512, 191);
  const texture = resources.ownTexture(new THREE.CanvasTexture(canvas));
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Render articulated actors in shared instance batches instead of one draw per limb.
 * @param {THREE.Scene} scene
 * @param {DeadShiftRenderResources} resources
 */
export function createActorBatcher(scene, resources) {
  const batches = new Map();
  const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  const maximumPartsPerBatch = 1024;

  function registerPart(root, shape, geometry, material) {
    const key = `${geometry.uuid}:${material.uuid}`;
    let batch = batches.get(key);
    if (!batch) {
      const mesh = new THREE.InstancedMesh(geometry, material, maximumPartsPerBatch);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.count = 0;
      scene.add(mesh);
      batch = { mesh, records: [], freeIndices: [] };
      batches.set(key, batch);
    }
    const index = batch.freeIndices.pop() ?? batch.records.length;
    if (index >= maximumPartsPerBatch) return () => {};
    batch.records[index] = { root, shape };
    batch.mesh.count = Math.max(batch.mesh.count, index + 1);

    return () => {
      batch.records[index] = null;
      batch.mesh.setMatrixAt(index, hiddenMatrix);
      batch.freeIndices.push(index);
    };
  }

  return {
    registerPart,
    flush() {
      for (const batch of batches.values()) {
        let visibleInstanceCount = 0;
        for (let index = 0; index < batch.records.length; index += 1) {
          const record = batch.records[index];
          batch.mesh.setMatrixAt(index, record?.root.visible ? record.shape.matrixWorld : hiddenMatrix);
          if (record?.root.visible) visibleInstanceCount = index + 1;
        }
        batch.mesh.count = visibleInstanceCount;
        batch.mesh.visible = visibleInstanceCount > 0;
        if (visibleInstanceCount > 0) {
          batch.mesh.instanceMatrix.clearUpdateRanges();
          batch.mesh.instanceMatrix.addUpdateRange(0, visibleInstanceCount * 16);
          batch.mesh.instanceMatrix.needsUpdate = true;
        }
      }
    },
    setShadows(enabled) {
      for (const batch of batches.values()) batch.mesh.castShadow = enabled;
    },
    dispose() {
      for (const batch of batches.values()) {
        scene.remove(batch.mesh);
        batch.mesh.dispose();
      }
      batches.clear();
    },
  };
}

export function interpolateAngle(current, target, blend) {
  const difference = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + difference * blend;
}
