import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** @typedef {ReturnType<typeof createSkyDashResources>} SkyDashResources */

/** Owns the renderer's shared geometry, material and generated texture allocations. */
export function createSkyDashResources() {
  /** @type {Set<THREE.BufferGeometry>} */
  const geometries = new Set();
  /** @type {Set<THREE.Material>} */
  const materials = new Set();
  /** @type {Set<THREE.Texture>} */
  const textures = new Set();
  const materialCache = new Map();
  const boxCache = new Map();

  /** @template {THREE.BufferGeometry} Geometry @param {Geometry} geometry @returns {Geometry} */
  function ownGeometry(geometry) {
    geometries.add(geometry);
    return geometry;
  }

  /** @template {THREE.Material} Material @param {Material} material @returns {Material} */
  function ownMaterial(material) {
    materials.add(material);
    return material;
  }

  /** @template {THREE.Texture} Texture @param {Texture} texture @returns {Texture} */
  function ownTexture(texture) {
    textures.add(texture);
    return texture;
  }

  return {
    ownGeometry,
    ownMaterial,
    ownTexture,
    box: ownGeometry(new THREE.BoxGeometry(1, 1, 1)),
    sphere: ownGeometry(new THREE.SphereGeometry(1, 16, 12)),
    softSphere: ownGeometry(new THREE.SphereGeometry(1, 10, 7)),
    capsule: ownGeometry(new THREE.CapsuleGeometry(0.5, 0.6, 5, 14)),
    cylinder: ownGeometry(new THREE.CylinderGeometry(1, 1, 1, 20)),
    cone: ownGeometry(new THREE.ConeGeometry(1, 1, 16)),
    ring: ownGeometry(new THREE.TorusGeometry(1, 0.045, 6, 40)),
    plane: ownGeometry(new THREE.PlaneGeometry(1, 1)),
    /** Reuses materials across the course, costumes and cosmetic details. */
    material(color, roughness = 0.54, metalness = 0.02) {
      const materialKey = `${color}:${roughness}:${metalness}`;
      if (!materialCache.has(materialKey)) {
        materialCache.set(materialKey, ownMaterial(new THREE.MeshStandardMaterial({ color, roughness, metalness })));
      }
      return materialCache.get(materialKey);
    },
    /** Dimensions remain identical to shared collision geometry, including bevels. */
    roundedBox(width, height, depth, radius = 0.18) {
      const boxKey = `${width}:${height}:${depth}:${radius}`;
      if (!boxCache.has(boxKey)) {
        boxCache.set(boxKey, ownGeometry(new RoundedBoxGeometry(width, height, depth, 3, radius)));
      }
      return boxCache.get(boxKey);
    },
    /**
     * The slab uses a real circular hole, with its local origin at the sampled
     * gate center. The resource owner retains the returned geometry.
     * @param {{y:number,openingRadius:number,frameWidth:number,frameBottomY:number,frameTopY:number,depth:number}} gate
     * @returns {THREE.ExtrudeGeometry}
     */
    gatePanel(gate) {
      const outline = new THREE.Shape();
      outline.moveTo(-gate.frameWidth * 0.5, gate.frameBottomY - gate.y);
      outline.lineTo(gate.frameWidth * 0.5, gate.frameBottomY - gate.y);
      outline.lineTo(gate.frameWidth * 0.5, gate.frameTopY - gate.y);
      outline.lineTo(-gate.frameWidth * 0.5, gate.frameTopY - gate.y);
      outline.closePath();
      const opening = new THREE.Path();
      opening.absarc(0, 0, gate.openingRadius, 0, Math.PI * 2, true);
      outline.holes.push(opening);
      const geometry = ownGeometry(new THREE.ExtrudeGeometry(outline, { depth: gate.depth, steps: 1, bevelEnabled: false, curveSegments: 64 }));
      geometry.translate(0, 0, -gate.depth * 0.5);
      return geometry;
    },
    dispose() {
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      for (const texture of textures) texture.dispose();
      geometries.clear();
      materials.clear();
      textures.clear();
      materialCache.clear();
      boxCache.clear();
    },
  };
}

/**
 * Merges decorative, fixed geometry by material. The temporary clones are
 * released immediately; the resulting buffers belong to the resource owner.
 * @param {SkyDashResources} resources
 */
export function createSkyDashStaticBuilder(resources) {
  /** @type {Map<THREE.Material, THREE.BufferGeometry[]>} */
  const materialShapes = new Map();
  const transform = new THREE.Object3D();

  return {
    /** @param {THREE.BufferGeometry} geometry @param {THREE.Material} material @param {number[]} position @param {number[]} scale @param {number[]} [rotation] */
    add(geometry, material, position, scale = [1, 1, 1], rotation = [0, 0, 0]) {
      transform.position.fromArray(position);
      transform.scale.fromArray(scale);
      transform.rotation.set(rotation[0], rotation[1], rotation[2]);
      transform.updateMatrix();

      const shapes = materialShapes.get(material) || [];
      const transformedGeometry = geometry.index ? geometry.toNonIndexed() : geometry.clone();
      // Standard primitives use indices/UVs while flat course paint does not.
      // Normalize that representation before combining a material's surfaces.
      if (!transformedGeometry.getAttribute("uv")) {
        transformedGeometry.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(transformedGeometry.getAttribute("position").count * 2), 2));
      }
      shapes.push(transformedGeometry.applyMatrix4(transform.matrix));
      materialShapes.set(material, shapes);
    },
    /** @param {THREE.Object3D} parent @param {boolean} [castShadow] */
    finish(parent, castShadow = true) {
      for (const [material, shapes] of materialShapes) {
        const mesh = new THREE.Mesh(resources.ownGeometry(mergeGeometries(shapes)), material);
        mesh.castShadow = castShadow;
        mesh.receiveShadow = true;
        parent.add(mesh);
        for (const geometry of shapes) geometry.dispose();
      }
      materialShapes.clear();
    },
  };
}

/**
 * Articulated runners share instance batches, so eyes and fingers do not cost a
 * draw call each. The fixed capacity bounds GPU allocations and CPU iteration.
 * @param {THREE.Scene} scene
 */
export function createSkyDashActorBatcher(scene) {
  const batches = new Map();
  const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
  const maximumPartsPerBatch = 256;
  let castShadows = true;

  return {
    /** @param {THREE.Object3D} root @param {THREE.Object3D} shape @param {THREE.BufferGeometry} geometry @param {THREE.Material} material @param {THREE.ColorRepresentation} [color] */
    register(root, shape, geometry, material, color = "#ffffff") {
      const batchKey = `${geometry.uuid}:${material.uuid}`;
      let batch = batches.get(batchKey);
      if (!batch) {
        const mesh = new THREE.InstancedMesh(geometry, material, maximumPartsPerBatch);
        mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        mesh.frustumCulled = false;
        mesh.castShadow = castShadows;
        mesh.receiveShadow = true;
        mesh.count = 0;
        scene.add(mesh);
        batch = { mesh, parts: [] };
        batches.set(batchKey, batch);
      }
      if (batch.parts.length >= maximumPartsPerBatch) return { setColor() {} };
      const partIndex = batch.parts.length;
      batch.parts.push({ root, shape });
      batch.mesh.setColorAt(partIndex, new THREE.Color(color));
      batch.mesh.instanceColor.needsUpdate = true;
      return {
        setColor(nextColor) {
          batch.mesh.setColorAt(partIndex, new THREE.Color(nextColor));
          batch.mesh.instanceColor.needsUpdate = true;
        },
      };
    },
    flush() {
      for (const batch of batches.values()) {
        let visibleCount = 0;
        for (let index = 0; index < batch.parts.length; index += 1) {
          const part = batch.parts[index];
          batch.mesh.setMatrixAt(index, part.root.visible ? part.shape.matrixWorld : hiddenMatrix);
          if (part.root.visible) visibleCount = index + 1;
        }
        batch.mesh.count = visibleCount;
        batch.mesh.visible = visibleCount > 0;
        if (visibleCount) batch.mesh.instanceMatrix.needsUpdate = true;
      }
    },
    setShadows(enabled) {
      castShadows = enabled;
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

/** Locally generated signs avoid downloads and stay crisp at course scale. */
export function createSkyDashSignTexture(resources, title, subtitle, { color = "#ffffff", background = "#7653b8", finish = false } = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024;
  canvas.height = 256;
  const context = canvas.getContext("2d");
  context.fillStyle = background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "rgba(255,255,255,.12)";
  for (let index = -1; index < 13; index += 1) {
    context.beginPath();
    context.moveTo(index * 100, 0);
    context.lineTo(index * 100 + 120, 0);
    context.lineTo(index * 100 - 10, 256);
    context.lineTo(index * 100 - 130, 256);
    context.fill();
  }
  if (finish) {
    for (let column = 0; column < 32; column += 1) {
      context.fillStyle = column % 2 ? "#fff7e6" : "#352960";
      context.fillRect(column * 32, 0, 32, 17);
      context.fillRect(column * 32, 239, 32, 17);
    }
  }
  context.textAlign = "center";
  context.fillStyle = color;
  context.font = "900 115px 'Space Grotesk', Arial, sans-serif";
  context.fillText(title, 512, 147);
  context.font = "700 27px Manrope, Arial, sans-serif";
  context.fillText(subtitle, 512, 199);

  const texture = resources.ownTexture(new THREE.CanvasTexture(canvas));
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
