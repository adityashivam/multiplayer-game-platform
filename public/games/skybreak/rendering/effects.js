import * as THREE from "three";
import { SKYBREAK_COMBAT_SETTINGS } from "../shared/config.js";

/** @typedef {import("../client/snapshotPose.js").SkybreakPresentedJet} SkybreakPresentedJet */
/** @typedef {import("../client/matchEvents.js").SkybreakEvent} SkybreakEvent */
/** @typedef {{x:number,y:number,z:number,vx:number,vy:number,vz:number}} SkybreakMissileView */

const POINT_VERTEX_SHADER = `
attribute float size;
attribute float alpha;
attribute vec3 tint;
varying float vAlpha;
varying vec3 vTint;
uniform float pixelScale;
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = min(160.0, size * pixelScale / max(1.0, -mvPosition.z));
  vAlpha = alpha;
  vTint = tint;
  gl_Position = projectionMatrix * mvPosition;
}`;
const POINT_FRAGMENT_SHADER = `
varying float vAlpha;
varying vec3 vTint;
void main() {
  float falloff = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5));
  gl_FragColor = vec4(vTint, vAlpha * falloff);
}`;
const TRACER_CAPACITY = 220;
const TRACER_LENGTH_M = 14;
const TRAIL_POINTS = 36;

/**
 * Pooled soft point particles with per-particle size, alpha and colour.
 * @param {number} capacity
 * @param {THREE.Blending} blending
 */
function createParticlePool(capacity, blending) {
  const positions = new Float32Array(capacity * 3).fill(-1e5);
  const velocities = new Float32Array(capacity * 3);
  const tints = new Float32Array(capacity * 3);
  const sizes = new Float32Array(capacity);
  const alphas = new Float32Array(capacity);
  const life = new Float32Array(capacity);
  const maxLife = new Float32Array(capacity);
  const growth = new Float32Array(capacity);
  const startAlpha = new Float32Array(capacity);
  const gravity = new Float32Array(capacity);
  const geometry = new THREE.BufferGeometry();
  const attributes = {
    position: new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage),
    tint: new THREE.BufferAttribute(tints, 3).setUsage(THREE.DynamicDrawUsage),
    size: new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage),
    alpha: new THREE.BufferAttribute(alphas, 1).setUsage(THREE.DynamicDrawUsage),
  };
  Object.entries(attributes).forEach(([name, attribute]) => geometry.setAttribute(name, attribute));
  const material = new THREE.ShaderMaterial({ uniforms: { pixelScale: { value: 500 } }, vertexShader: POINT_VERTEX_SHADER, fragmentShader: POINT_FRAGMENT_SHADER, transparent: true, depthWrite: false, blending });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  let next = 0;
  const color = new THREE.Color();
  return {
    points, geometry, material,
    spawn(x, y, z, vx, vy, vz, sizeM, lifeSec, growthPerSec, alpha, hex, gravityAccel = 0) {
      const index = next;
      next = (next + 1) % capacity;
      positions.set([x, y, z], index * 3);
      velocities.set([vx, vy, vz], index * 3);
      color.set(hex);
      tints.set([color.r, color.g, color.b], index * 3);
      sizes[index] = sizeM;
      life[index] = lifeSec;
      maxLife[index] = lifeSec;
      growth[index] = growthPerSec;
      startAlpha[index] = alpha;
      alphas[index] = alpha;
      gravity[index] = gravityAccel;
    },
    update(dtSec, drag) {
      const retained = Math.max(0, 1 - drag * dtSec);
      for (let index = 0; index < capacity; index += 1) {
        if (life[index] <= 0) continue;
        life[index] -= dtSec;
        if (life[index] <= 0) {
          alphas[index] = 0;
          positions[index * 3 + 1] = -1e5;
          continue;
        }
        velocities[index * 3] *= retained;
        velocities[index * 3 + 1] = velocities[index * 3 + 1] * retained - gravity[index] * dtSec;
        velocities[index * 3 + 2] *= retained;
        positions[index * 3] += velocities[index * 3] * dtSec;
        positions[index * 3 + 1] += velocities[index * 3 + 1] * dtSec;
        positions[index * 3 + 2] += velocities[index * 3 + 2] * dtSec;
        sizes[index] += growth[index] * dtSec;
        alphas[index] = startAlpha[index] * (life[index] / maxLife[index]);
      }
      Object.values(attributes).forEach((attribute) => { attribute.needsUpdate = true; });
    },
    clear() {
      life.fill(0);
      alphas.fill(0);
      positions.fill(-1e5);
      Object.values(attributes).forEach((attribute) => { attribute.needsUpdate = true; });
    },
  };
}

/**
 * Tracers, missile trails, flares, explosions, hit sparks and wingtip vapour.
 * Purely visual; all hits and deaths come from authority.
 * @param {THREE.Scene} scene
 */
export function createSkybreakEffects(scene) {
  const fire = createParticlePool(420, THREE.AdditiveBlending);
  const smoke = createParticlePool(900, THREE.NormalBlending);
  scene.add(smoke.points, fire.points);

  const tracerPositions = new Float32Array(TRACER_CAPACITY * 6).fill(-1e5);
  const tracerVelocity = new Float32Array(TRACER_CAPACITY * 3);
  const tracerLife = new Float32Array(TRACER_CAPACITY);
  const tracerGeometry = new THREE.BufferGeometry();
  const tracerAttribute = new THREE.BufferAttribute(tracerPositions, 3).setUsage(THREE.DynamicDrawUsage);
  tracerGeometry.setAttribute("position", tracerAttribute);
  const tracerMaterial = new THREE.LineBasicMaterial({ color: "#ffe9a6", transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const tracers = new THREE.LineSegments(tracerGeometry, tracerMaterial);
  tracers.frustumCulled = false;
  scene.add(tracers);
  let nextTracer = 0;
  /** Per-jet gun timers so tracers match the fire rate at any frame rate. */
  const gunTimers = new Map();

  /** Wingtip vapour: a ribbon of recent tip positions per jet and side. */
  // Additive so a fading vertex colour fades the vapour out rather than darkening it.
  const trailMaterial = new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0.45, depthWrite: false, side: THREE.DoubleSide, vertexColors: true, blending: THREE.AdditiveBlending });
  const trails = new Map();
  const trailGroup = new THREE.Group();
  scene.add(trailGroup);

  function getTrail(key) {
    let trail = trails.get(key);
    if (!trail) {
      const positions = new Float32Array(TRAIL_POINTS * 2 * 3);
      const colors = new Float32Array(TRAIL_POINTS * 2 * 3);
      const indices = [];
      for (let index = 0; index < TRAIL_POINTS - 1; index += 1) {
        const base = index * 2;
        indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
      geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
      geometry.setIndex(indices);
      const mesh = new THREE.Mesh(geometry, trailMaterial);
      mesh.frustumCulled = false;
      trailGroup.add(mesh);
      trail = { mesh, geometry, points: [], strength: [] };
      trails.set(key, trail);
    }
    return trail;
  }

  /** @param {{x:number,y:number,z:number}} jet @param {number} count @param {number} power */
  function explode(jet, count, power) {
    for (let index = 0; index < count; index += 1) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      const speed = (10 + Math.random() * 35) * power;
      const vx = Math.sin(phi) * Math.cos(theta) * speed;
      const vy = Math.cos(phi) * speed;
      const vz = Math.sin(phi) * Math.sin(theta) * speed;
      fire.spawn(jet.x, jet.y, jet.z, vx, vy, vz, 6 + Math.random() * 6 * power, 0.5 + Math.random() * 0.6, 14 * power, 1, Math.random() > 0.4 ? "#ffb347" : "#ff5a2a");
      smoke.spawn(jet.x, jet.y, jet.z, vx * 0.4, vy * 0.4 + 4, vz * 0.4, 8 * power, 2.5 + Math.random() * 2, 9, 0.35, "#8a7d78", -1);
    }
  }

  return {
    /**
     * @param {object} frame
     * @param {readonly SkybreakPresentedJet[]} frame.jets
     * @param {readonly SkybreakEvent[]} frame.events
     * @param {readonly SkybreakMissileView[]} frame.missiles
     * @param {string} frame.playerId
     * @param {boolean} frame.localFiring Local trigger, for instant tracers.
     * @param {number} frame.dtSec
     * @param {number} frame.pixelScale
     * @param {number} frame.effectScale From zero to one.
     */
    update({ jets, events, missiles, playerId, localFiring, dtSec, pixelScale, effectScale }) {
      fire.material.uniforms.pixelScale.value = pixelScale;
      smoke.material.uniforms.pixelScale.value = pixelScale;
      for (const event of events) {
        if (event.kind === "explode") explode(event, Math.round(40 * effectScale) + 8, 1.4);
        else if (event.kind === "hit") for (let spark = 0; spark < 8; spark += 1) fire.spawn(event.x, event.y, event.z, (Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60, 1.2, 0.25, 0, 1, "#ffe9a6");
        else if (event.kind === "flare") {
          const jet = jets.find((candidate) => candidate.id === event.jetId);
          for (let flare = 0; flare < 6; flare += 1) {
            fire.spawn(event.x, event.y, event.z, (jet?.forwardX ?? 0) * 40 + (Math.random() - 0.5) * 50, -20 - Math.random() * 20, (jet?.forwardZ ?? 0) * 40 + (Math.random() - 0.5) * 50, 5, 2.4, -0.5, 1, "#fff2c2", 9);
          }
        }
      }
      for (const jet of jets) {
        if (!jet.alive) {
          gunTimers.delete(jet.id);
          continue;
        }
        const firing = jet.id === playerId ? localFiring && jet.overheatSec <= 0 : jet.cannonFiring;
        let timer = gunTimers.get(jet.id) ?? 0;
        timer -= dtSec;
        while (firing && timer <= 0) {
          const index = nextTracer;
          nextTracer = (nextTracer + 1) % TRACER_CAPACITY;
          const speed = SKYBREAK_COMBAT_SETTINGS.bulletSpeed + jet.speed;
          const spread = 0.004;
          const directionX = jet.forwardX + (Math.random() - 0.5) * spread;
          const directionY = jet.forwardY + (Math.random() - 0.5) * spread;
          const directionZ = jet.forwardZ + (Math.random() - 0.5) * spread;
          tracerVelocity.set([directionX * speed, directionY * speed, directionZ * speed], index * 3);
          const muzzleX = jet.x + jet.forwardX * 8 + jet.upX * 0.3;
          const muzzleY = jet.y + jet.forwardY * 8 + jet.upY * 0.3;
          const muzzleZ = jet.z + jet.forwardZ * 8 + jet.upZ * 0.3;
          tracerPositions.set([muzzleX, muzzleY, muzzleZ, muzzleX, muzzleY, muzzleZ], index * 6);
          tracerLife[index] = SKYBREAK_COMBAT_SETTINGS.bulletLifeSec;
          timer += SKYBREAK_COMBAT_SETTINGS.fireIntervalSec;
        }
        gunTimers.set(jet.id, firing ? timer : 0);

        const rightX = jet.forwardY * jet.upZ - jet.forwardZ * jet.upY;
        const rightY = jet.forwardZ * jet.upX - jet.forwardX * jet.upZ;
        const rightZ = jet.forwardX * jet.upY - jet.forwardY * jet.upX;
        const vapour = Math.max(0, Math.min(1, (jet.gForce - 3.5) / 4)) * effectScale;
        for (const side of [1, -1]) {
          const trail = getTrail(`${jet.id}:${side}`);
          trail.points.unshift([jet.x + rightX * 6.7 * side - jet.forwardX * 3, jet.y + rightY * 6.7 * side - jet.forwardY * 3, jet.z + rightZ * 6.7 * side - jet.forwardZ * 3]);
          trail.strength.unshift(vapour);
          if (trail.points.length > TRAIL_POINTS) {
            trail.points.pop();
            trail.strength.pop();
          }
        }
      }
      for (let index = 0; index < TRACER_CAPACITY; index += 1) {
        if (tracerLife[index] <= 0) continue;
        tracerLife[index] -= dtSec;
        const base = index * 6;
        if (tracerLife[index] <= 0) {
          tracerPositions.fill(-1e5, base, base + 6);
          continue;
        }
        const vx = tracerVelocity[index * 3];
        const vy = tracerVelocity[index * 3 + 1];
        const vz = tracerVelocity[index * 3 + 2];
        tracerPositions[base] += vx * dtSec;
        tracerPositions[base + 1] += vy * dtSec;
        tracerPositions[base + 2] += vz * dtSec;
        const inverse = TRACER_LENGTH_M / (Math.hypot(vx, vy, vz) || 1);
        tracerPositions[base + 3] = tracerPositions[base] - vx * inverse;
        tracerPositions[base + 4] = tracerPositions[base + 1] - vy * inverse;
        tracerPositions[base + 5] = tracerPositions[base + 2] - vz * inverse;
      }
      tracerAttribute.needsUpdate = true;

      for (const missile of missiles) {
        smoke.spawn(missile.x, missile.y, missile.z, (Math.random() - 0.5) * 3, 1, (Math.random() - 0.5) * 3, 2.2, 1.6, 4, 0.45 * effectScale + 0.1, "#d9d4cf");
        fire.spawn(missile.x, missile.y, missile.z, 0, 0, 0, 2.4, 0.06, 0, 1, "#ffcf7a");
      }

      for (const trail of trails.values()) {
        const positions = trail.geometry.attributes.position.array;
        const colors = trail.geometry.attributes.color.array;
        for (let index = 0; index < TRAIL_POINTS; index += 1) {
          const point = trail.points[Math.min(index, trail.points.length - 1)] ?? [0, -1e5, 0];
          const fade = (trail.strength[index] ?? 0) * (1 - index / TRAIL_POINTS);
          positions.set([point[0], point[1] + 0.15, point[2], point[0], point[1] - 0.15, point[2]], index * 6);
          colors.set([fade, fade, fade, fade, fade, fade], index * 6);
        }
        trail.geometry.attributes.position.needsUpdate = true;
        trail.geometry.attributes.color.needsUpdate = true;
      }
      fire.update(dtSec, 1.6);
      smoke.update(dtSec, 0.6);
    },
    clear() {
      fire.clear();
      smoke.clear();
      tracerLife.fill(0);
      tracerPositions.fill(-1e5);
      tracerAttribute.needsUpdate = true;
      for (const trail of trails.values()) {
        trail.points.length = 0;
        trail.strength.length = 0;
      }
    },
    dispose() {
      scene.remove(smoke.points, fire.points, tracers, trailGroup);
      [fire, smoke].forEach((pool) => {
        pool.geometry.dispose();
        pool.material.dispose();
      });
      tracerGeometry.dispose();
      tracerMaterial.dispose();
      for (const trail of trails.values()) trail.geometry.dispose();
      trailMaterial.dispose();
    },
  };
}
