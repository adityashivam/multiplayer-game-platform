import * as THREE from "three";
import { DRIFTLINE_REAR_WHEELS } from "./carView.js";

/** @typedef {import("../client/snapshotPose.js").DriftlinePresentedCar} DriftlinePresentedCar */
/** @typedef {import("../client/raceEvents.js").DriftlineRaceEvent} DriftlineRaceEvent */

const SMOKE_CAPACITY = 320;
const SPARK_CAPACITY = 96;
const SKID_CAPACITY = 1800;
const SKID_FADE_SEC = 14;
const SKID_WIDTH_M = 0.24;
const SKID_MIN_SEGMENT_M = 0.35;
const SMOKE_INTERVAL_SEC = 0.05;
/** Smoke from far cars costs fill rate for little visible benefit. */
const SMOKE_MAX_DISTANCE_M = 90;
/** Point sprites larger than this many device pixels are clamped to bound overdraw. */
const MAX_POINT_SIZE_CSS_PX = 110;

const POINT_VERTEX_SHADER = `
attribute float size;
attribute float alpha;
varying float vAlpha;
uniform float pixelScale;
uniform float maxPointSize;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = min(maxPointSize, size * pixelScale / max(0.5, -mvPosition.z));
  vAlpha = alpha;
  gl_Position = projectionMatrix * mvPosition;
}`;
const POINT_FRAGMENT_SHADER = `
uniform vec3 color;
varying float vAlpha;
void main() {
  vec2 offset = gl_PointCoord - 0.5;
  float falloff = smoothstep(0.5, 0.0, length(offset));
  gl_FragColor = vec4(color, vAlpha * falloff);
}`;
const SKID_VERTEX_SHADER = `
attribute float birth;
uniform float timeSec;
varying float vAlpha;
void main() {
  vAlpha = clamp(1.0 - (timeSec - birth) / ${SKID_FADE_SEC.toFixed(1)}, 0.0, 1.0) * 0.55;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const SKID_FRAGMENT_SHADER = `
varying float vAlpha;
void main() { gl_FragColor = vec4(0.05, 0.05, 0.06, vAlpha); }`;

/**
 * Pooled particle system drawn as soft round points with per-particle size
 * and alpha. All buffers are allocated once.
 * @param {number} capacity
 * @param {string} color
 * @param {THREE.Blending} blending
 */
function createDriftlineParticles(capacity, color, blending) {
  const positions = new Float32Array(capacity * 3).fill(-1000);
  const velocities = new Float32Array(capacity * 3);
  const sizes = new Float32Array(capacity);
  const alphas = new Float32Array(capacity);
  const life = new Float32Array(capacity);
  const maxLife = new Float32Array(capacity);
  const growth = new Float32Array(capacity);
  const geometry = new THREE.BufferGeometry();
  const positionAttribute = new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage);
  const sizeAttribute = new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage);
  const alphaAttribute = new THREE.BufferAttribute(alphas, 1).setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("position", positionAttribute);
  geometry.setAttribute("size", sizeAttribute);
  geometry.setAttribute("alpha", alphaAttribute);
  const material = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color(color) }, pixelScale: { value: 400 }, maxPointSize: { value: 96 } },
    vertexShader: POINT_VERTEX_SHADER,
    fragmentShader: POINT_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    blending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  let next = 0;
  let startAlpha = 0.4;
  return {
    points,
    material,
    geometry,
    setStartAlpha(value) { startAlpha = value; },
    spawn(x, y, z, velocityX, velocityY, velocityZ, sizeM, lifeSec, growthPerSec) {
      const index = next;
      next = (next + 1) % capacity;
      positions[index * 3] = x;
      positions[index * 3 + 1] = y;
      positions[index * 3 + 2] = z;
      velocities[index * 3] = velocityX;
      velocities[index * 3 + 1] = velocityY;
      velocities[index * 3 + 2] = velocityZ;
      sizes[index] = sizeM;
      life[index] = lifeSec;
      maxLife[index] = lifeSec;
      growth[index] = growthPerSec;
      alphas[index] = startAlpha;
    },
    update(dtSec, gravity, drag) {
      const retained = Math.max(0, 1 - drag * dtSec);
      for (let index = 0; index < capacity; index += 1) {
        if (life[index] <= 0) continue;
        life[index] -= dtSec;
        if (life[index] <= 0) {
          alphas[index] = 0;
          positions[index * 3 + 1] = -1000;
          continue;
        }
        velocities[index * 3] *= retained;
        velocities[index * 3 + 1] = velocities[index * 3 + 1] * retained - gravity * dtSec;
        velocities[index * 3 + 2] *= retained;
        positions[index * 3] += velocities[index * 3] * dtSec;
        positions[index * 3 + 1] += velocities[index * 3 + 1] * dtSec;
        positions[index * 3 + 2] += velocities[index * 3 + 2] * dtSec;
        sizes[index] += growth[index] * dtSec;
        alphas[index] = startAlpha * (life[index] / maxLife[index]);
      }
      positionAttribute.needsUpdate = true;
      sizeAttribute.needsUpdate = true;
      alphaAttribute.needsUpdate = true;
    },
    clear() {
      life.fill(0);
      alphas.fill(0);
      positions.fill(-1000);
      positionAttribute.needsUpdate = true;
      alphaAttribute.needsUpdate = true;
    },
  };
}

/**
 * Tyre smoke, fading skid marks and wall sparks. Emission reads presented
 * car state only; nothing here affects the race.
 * @param {THREE.Scene} scene
 * @returns {{update(cars:readonly DriftlinePresentedCar[],events:readonly DriftlineRaceEvent[],timeSec:number,dtSec:number,pixelScale:number,smokeScale:number,camera:{x:number,z:number},pixelRatio:number):void,clear():void,dispose():void}}
 */
export function createDriftlineEffects(scene) {
  const smoke = createDriftlineParticles(SMOKE_CAPACITY, "#e9dcd0", THREE.NormalBlending);
  smoke.setStartAlpha(0.34);
  const sparks = createDriftlineParticles(SPARK_CAPACITY, "#ffb347", THREE.AdditiveBlending);
  sparks.setStartAlpha(1);
  scene.add(smoke.points, sparks.points);

  const skidPositions = new Float32Array(SKID_CAPACITY * 6 * 3);
  const skidBirths = new Float32Array(SKID_CAPACITY * 6).fill(-1000);
  const skidGeometry = new THREE.BufferGeometry();
  const skidPositionAttribute = new THREE.BufferAttribute(skidPositions, 3).setUsage(THREE.DynamicDrawUsage);
  const skidBirthAttribute = new THREE.BufferAttribute(skidBirths, 1).setUsage(THREE.DynamicDrawUsage);
  skidGeometry.setAttribute("position", skidPositionAttribute);
  skidGeometry.setAttribute("birth", skidBirthAttribute);
  const skidMaterial = new THREE.ShaderMaterial({
    uniforms: { timeSec: { value: 0 } },
    vertexShader: SKID_VERTEX_SHADER,
    fragmentShader: SKID_FRAGMENT_SHADER,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  });
  const skids = new THREE.Mesh(skidGeometry, skidMaterial);
  skids.frustumCulled = false;
  scene.add(skids);
  let nextSkid = 0;
  /** Last mark point per car and rear wheel; reused objects, inactive when not marking. */
  const lastMarks = new Map();
  const skidCorner = [0, 0, 0];
  const smokeTimers = new Map();

  /** Two triangles from the previous to the current wheel point. */
  function addSkidSegment(fromX, fromY, fromZ, toX, toY, toZ, timeSec) {
    const directionX = toX - fromX;
    const directionZ = toZ - fromZ;
    const length = Math.hypot(directionX, directionZ) || 1;
    const sideX = (-directionZ / length) * SKID_WIDTH_M * 0.5;
    const sideZ = (directionX / length) * SKID_WIDTH_M * 0.5;
    const base = nextSkid * 6;
    const writeCorner = (offset, x, y, z) => {
      skidCorner[0] = x;
      skidCorner[1] = y;
      skidCorner[2] = z;
      skidPositions.set(skidCorner, (base + offset) * 3);
      skidBirths[base + offset] = timeSec;
    };
    writeCorner(0, fromX + sideX, fromY, fromZ + sideZ);
    writeCorner(1, fromX - sideX, fromY, fromZ - sideZ);
    writeCorner(2, toX + sideX, toY, toZ + sideZ);
    writeCorner(3, fromX - sideX, fromY, fromZ - sideZ);
    writeCorner(4, toX - sideX, toY, toZ - sideZ);
    writeCorner(5, toX + sideX, toY, toZ + sideZ);
    nextSkid = (nextSkid + 1) % SKID_CAPACITY;
    skidPositionAttribute.needsUpdate = true;
    skidBirthAttribute.needsUpdate = true;
  }

  return {
    update(cars, events, timeSec, dtSec, pixelScale, smokeScale, camera, pixelRatio) {
      smoke.material.uniforms.pixelScale.value = pixelScale;
      sparks.material.uniforms.pixelScale.value = pixelScale;
      smoke.material.uniforms.maxPointSize.value = MAX_POINT_SIZE_CSS_PX * pixelRatio;
      sparks.material.uniforms.maxPointSize.value = MAX_POINT_SIZE_CSS_PX * pixelRatio;
      skidMaterial.uniforms.timeSec.value = timeSec;
      for (const car of cars) {
        const speed = Math.hypot(car.vx, car.vz);
        const sliding = Math.abs(car.driftAngle) > 0.16 && speed > 5;
        const locked = car.handbrake && speed > 4;
        const burnout = car.throttle > 0.8 && speed < 7 && speed > 0.3;
        const marking = (sliding || locked || burnout) && !car.onRunoff;
        const sinYaw = Math.sin(car.yaw);
        const cosYaw = Math.cos(car.yaw);
        let timer = (smokeTimers.get(car.id) ?? 0) - dtSec;
        const nearCamera = Math.abs(car.x - camera.x) < SMOKE_MAX_DISTANCE_M && Math.abs(car.z - camera.z) < SMOKE_MAX_DISTANCE_M;
        const emitSmoke = marking && nearCamera && timer <= 0 && smokeScale > 0;
        if (emitSmoke) timer = SMOKE_INTERVAL_SEC / smokeScale;
        smokeTimers.set(car.id, timer);
        DRIFTLINE_REAR_WHEELS.forEach((wheel, wheelIndex) => {
          const key = `${car.id}:${wheelIndex}`;
          const worldX = car.x + wheel.x * cosYaw + wheel.z * sinYaw;
          const worldZ = car.z - wheel.x * sinYaw + wheel.z * cosYaw;
          const worldY = car.y + 0.04;
          let last = lastMarks.get(key);
          if (!last) {
            last = { x: 0, y: 0, z: 0, active: false };
            lastMarks.set(key, last);
          }
          if (marking) {
            const gap = Math.hypot(worldX - last.x, worldZ - last.z);
            if (!last.active || gap > SKID_MIN_SEGMENT_M) {
              if (last.active && gap < 4) addSkidSegment(last.x, last.y, last.z, worldX, worldY, worldZ, timeSec);
              last.x = worldX;
              last.y = worldY;
              last.z = worldZ;
              last.active = true;
            }
            if (emitSmoke) {
              const intensity = Math.min(1, Math.abs(car.driftAngle) * 1.6 + (locked ? 0.5 : 0) + (burnout ? 0.6 : 0));
              smoke.spawn(worldX, car.y + 0.3, worldZ, car.vx * 0.25 + (Math.random() - 0.5), 0.6 + Math.random() * 0.6, car.vz * 0.25 + (Math.random() - 0.5),
                0.6 + intensity * 0.6, 1.1 + Math.random() * 0.8 * intensity, 2.2 + intensity * 1.8);
            }
          } else {
            last.active = false;
          }
        });
      }
      for (const event of events) {
        if (event.kind !== "wallHit" && event.kind !== "contact") continue;
        const count = event.kind === "wallHit" ? Math.min(24, 6 + Math.round(event.value * 2)) : 10;
        for (let spark = 0; spark < count; spark += 1) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 3 + Math.random() * 6;
          sparks.spawn(event.x, event.y + 0.5, event.z, Math.cos(angle) * speed, 2 + Math.random() * 4, Math.sin(angle) * speed, 0.16, 0.35 + Math.random() * 0.3, 0);
        }
      }
      smoke.update(dtSec, -0.25, 0.9);
      sparks.update(dtSec, 14, 0.5);
    },
    clear() {
      smoke.clear();
      sparks.clear();
      skidBirths.fill(-1000);
      skidBirthAttribute.needsUpdate = true;
      lastMarks.clear();
      smokeTimers.clear();
    },
    dispose() {
      scene.remove(smoke.points, sparks.points, skids);
      smoke.geometry.dispose();
      smoke.material.dispose();
      sparks.geometry.dispose();
      sparks.material.dispose();
      skidGeometry.dispose();
      skidMaterial.dispose();
    },
  };
}
