import * as THREE from "three";

/**
 * @typedef {import("./rig.js").RiftballBoneName} RiftballBoneName
 * @typedef {ReadonlyArray<readonly [RiftballBoneName, number]>} BoneInfluences
 * @typedef {{center:readonly number[],width:number,depth:number,weights:BoneInfluences}} AthleteSurfaceRing
 * @typedef {{positions:number[],indices:number[],skinIndices:number[],skinWeights:number[]}} SurfaceBatch
 */

/**
 * Builds a single weighted surface, batched by material. Authored loft profiles
 * preserve the jersey, muscle and footwear silhouettes without rigid limb toys.
 * Temporary source geometries are consumed and disposed by appendGeometry.
 * @param {Record<RiftballBoneName, number>} boneIndices
 */
export function createAthleteSurfaceBuilder(boneIndices) {
  /** @type {Map<number, SurfaceBatch>} */
  const materialBatches = new Map();

  /** @param {number} materialIndex */
  function getSurfaceBatch(materialIndex) {
    if (!materialBatches.has(materialIndex)) {
      materialBatches.set(materialIndex, { positions: [], indices: [], skinIndices: [], skinWeights: [] });
    }
    return /** @type {SurfaceBatch} */ (materialBatches.get(materialIndex));
  }

  /** @param {SurfaceBatch} surfaceBatch @param {number[]} position @param {BoneInfluences} weights */
  function appendWeightedVertex(surfaceBatch, position, weights) {
    const vertexIndex = surfaceBatch.positions.length / 3;
    surfaceBatch.positions.push(...position);
    for (let componentIndex = 0; componentIndex < 4; componentIndex += 1) {
      surfaceBatch.skinIndices.push(weights[componentIndex] ? boneIndices[weights[componentIndex][0]] : 0);
      surfaceBatch.skinWeights.push(weights[componentIndex] ? weights[componentIndex][1] : 0);
    }
    return vertexIndex;
  }

  /**
   * @param {ReadonlyArray<AthleteSurfaceRing>} rings
   * @param {number} materialIndex
   * @param {number} [radialSegments]
   * @param {THREE.Vector3} [depthAxis]
   */
  function appendLoft(rings, materialIndex, radialSegments = 14, depthAxis = new THREE.Vector3(0, 0, 1)) {
    const surfaceBatch = getSurfaceBatch(materialIndex);
    const firstVertex = surfaceBatch.positions.length / 3;
    const tangent = new THREE.Vector3();
    const sideAxis = new THREE.Vector3();
    const position = new THREE.Vector3();

    for (let ringIndex = 0; ringIndex < rings.length; ringIndex += 1) {
      const ring = rings[ringIndex];
      const previousRing = rings[Math.max(0, ringIndex - 1)];
      const nextRing = rings[Math.min(rings.length - 1, ringIndex + 1)];
      tangent.fromArray(nextRing.center).sub(position.fromArray(previousRing.center)).normalize();
      sideAxis.crossVectors(tangent, depthAxis).normalize();

      for (let radialIndex = 0; radialIndex <= radialSegments; radialIndex += 1) {
        const angle = radialIndex / radialSegments * Math.PI * 2;
        position.fromArray(ring.center)
          .addScaledVector(sideAxis, Math.cos(angle) * ring.width)
          .addScaledVector(depthAxis, Math.sin(angle) * ring.depth);
        appendWeightedVertex(surfaceBatch, position.toArray(), ring.weights);
      }
    }

    const rowLength = radialSegments + 1;
    for (let ringIndex = 0; ringIndex < rings.length - 1; ringIndex += 1) {
      for (let radialIndex = 0; radialIndex < radialSegments; radialIndex += 1) {
        const start = firstVertex + ringIndex * rowLength + radialIndex;
        surfaceBatch.indices.push(start, start + rowLength, start + 1, start + 1, start + rowLength, start + rowLength + 1);
      }
    }

    const firstCap = appendWeightedVertex(surfaceBatch, [...rings[0].center], rings[0].weights);
    const lastCap = appendWeightedVertex(surfaceBatch, [...rings.at(-1).center], rings.at(-1).weights);
    for (let radialIndex = 0; radialIndex < radialSegments; radialIndex += 1) {
      surfaceBatch.indices.push(firstCap, firstVertex + radialIndex, firstVertex + radialIndex + 1);
      const lastRingStart = firstVertex + (rings.length - 1) * rowLength;
      surfaceBatch.indices.push(lastCap, lastRingStart + radialIndex + 1, lastRingStart + radialIndex);
    }
  }

  /** @param {THREE.BufferGeometry} geometry @param {number} materialIndex @param {BoneInfluences} weights @param {THREE.Matrix4} transform */
  function appendGeometry(geometry, materialIndex, weights, transform) {
    const surfaceBatch = getSurfaceBatch(materialIndex);
    const firstVertex = surfaceBatch.positions.length / 3;
    geometry.applyMatrix4(transform);
    const positions = geometry.getAttribute("position");
    for (let vertexIndex = 0; vertexIndex < positions.count; vertexIndex += 1) {
      appendWeightedVertex(surfaceBatch, [positions.getX(vertexIndex), positions.getY(vertexIndex), positions.getZ(vertexIndex)], weights);
    }
    if (geometry.index) {
      for (let index = 0; index < geometry.index.count; index += 1) surfaceBatch.indices.push(firstVertex + geometry.index.getX(index));
    } else {
      for (let vertexIndex = 0; vertexIndex < positions.count; vertexIndex += 1) surfaceBatch.indices.push(firstVertex + vertexIndex);
    }
    geometry.dispose();
  }

  function finish() {
    const geometry = new THREE.BufferGeometry();
    const positions = [];
    const indices = [];
    const skinIndices = [];
    const skinWeights = [];
    for (const [materialIndex, surfaceBatch] of materialBatches) {
      const firstVertex = positions.length / 3;
      geometry.addGroup(indices.length, surfaceBatch.indices.length, materialIndex);
      positions.push(...surfaceBatch.positions);
      skinIndices.push(...surfaceBatch.skinIndices);
      skinWeights.push(...surfaceBatch.skinWeights);
      for (const index of surfaceBatch.indices) indices.push(firstVertex + index);
    }
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(skinIndices, 4));
    geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(skinWeights, 4));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }

  return { appendLoft, appendGeometry, finish };
}
