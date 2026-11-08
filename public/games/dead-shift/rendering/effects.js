import * as THREE from "three";
import { DEAD_SHIFT_MAX_PROJECTILES, DEAD_SHIFT_WEAPONS } from "../shared/config.js";
import { createVisualRandom } from "./resources.js";

const PARTICLE_LIMIT = 384;
const TRACER_LIMIT = 48;
const BLAST_LIMIT = 8;
const ACID_PATCH_LIMIT = 12;
const EVENT_HISTORY_LIMIT = 512;

/**
 * Bounded effects are visual only; all impacts and blast positions come from snapshots.
 * @param {THREE.Scene} scene
 * @param {import("./resources.js").DeadShiftRenderResources} resources
 */
export function createArenaEffects(scene, resources) {
  const random = createVisualRandom(191);
  const positions = new Float32Array(PARTICLE_LIMIT * 3);
  const colors = new Float32Array(PARTICLE_LIMIT * 3);
  const sizes = new Float32Array(PARTICLE_LIMIT);
  const alphas = new Float32Array(PARTICLE_LIMIT);
  const particles = Array.from({ length: PARTICLE_LIMIT }, () => ({ lifeSec: 0, durationSec: 1, vx: 0, vy: 0, vz: 0, gravity: 0 }));
  const geometry = resources.ownGeometry(new THREE.BufferGeometry());
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute("particleSize", new THREE.BufferAttribute(sizes, 1).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute("particleAlpha", new THREE.BufferAttribute(alphas, 1).setUsage(THREE.DynamicDrawUsage));
  const particleMaterial = resources.ownMaterial(new THREE.ShaderMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    uniforms: { pixelRatio: { value: 1 } },
    vertexShader: `
      attribute float particleSize;
      attribute float particleAlpha;
      varying vec3 effectColor;
      varying float effectAlpha;
      uniform float pixelRatio;
      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * viewPosition;
        gl_PointSize = clamp(particleSize * 410.0 * pixelRatio / max(0.2, -viewPosition.z), 1.0, 100.0);
        effectColor = color;
        effectAlpha = particleAlpha;
      }
    `,
    fragmentShader: `
      varying vec3 effectColor;
      varying float effectAlpha;
      void main() {
        float radius = length(gl_PointCoord - vec2(0.5)) * 2.0;
        float opacity = (1.0 - smoothstep(0.15, 1.0, radius)) * effectAlpha;
        if (opacity < 0.01) discard;
        gl_FragColor = vec4(effectColor, opacity);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  }));
  const points = new THREE.Points(geometry, particleMaterial);
  points.frustumCulled = false;
  scene.add(points);
  let nextParticleIndex = 0;
  let activeParticleLimit = PARTICLE_LIMIT;

  function emitParticles(position, count, color, speed = 2, size = 0.12, durationSec = 0.5, gravity = 5) {
    for (let index = 0; index < count; index += 1) {
      const particleIndex = nextParticleIndex++ % activeParticleLimit;
      const particle = particles[particleIndex];
      const offset = particleIndex * 3;
      positions[offset] = position.x;
      positions[offset + 1] = position.y;
      positions[offset + 2] = position.z;
      colors[offset] = color[0];
      colors[offset + 1] = color[1];
      colors[offset + 2] = color[2];
      sizes[particleIndex] = size * (0.6 + random() * 0.8);
      particle.durationSec = durationSec * (0.65 + random() * 0.7);
      particle.lifeSec = particle.durationSec;
      particle.vx = (random() - 0.5) * speed * 2;
      particle.vy = (random() * 0.8 + 0.2) * speed;
      particle.vz = (random() - 0.5) * speed * 2;
      particle.gravity = gravity;
    }
  }

  const tracerPositions = new Float32Array(TRACER_LIMIT * 6);
  const tracerGeometry = resources.ownGeometry(new THREE.BufferGeometry());
  tracerGeometry.setAttribute("position", new THREE.BufferAttribute(tracerPositions, 3).setUsage(THREE.DynamicDrawUsage));
  const tracerMaterial = resources.ownMaterial(new THREE.LineBasicMaterial({ color: 0xffcf8b, transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending, depthWrite: false }));
  const tracerLines = new THREE.LineSegments(tracerGeometry, tracerMaterial);
  tracerLines.frustumCulled = false;
  scene.add(tracerLines);
  const tracerLives = new Float32Array(TRACER_LIMIT);
  let nextTracerIndex = 0;

  function emitTracer(start, end) {
    const index = nextTracerIndex++ % TRACER_LIMIT;
    const offset = index * 6;
    tracerPositions[offset] = start.x;
    tracerPositions[offset + 1] = start.y;
    tracerPositions[offset + 2] = start.z;
    tracerPositions[offset + 3] = end.x;
    tracerPositions[offset + 4] = end.y;
    tracerPositions[offset + 5] = end.z;
    tracerLives[index] = 0.065;
  }

  const ringGeometry = resources.ownGeometry(new THREE.TorusGeometry(1, 0.025, 4, 40));
  const blasts = Array.from({ length: BLAST_LIMIT }, () => {
    const material = resources.ownMaterial(new THREE.MeshBasicMaterial({ color: 0xffa357, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    const ring = new THREE.Mesh(ringGeometry, material);
    ring.rotation.x = Math.PI / 2;
    ring.visible = false;
    scene.add(ring);
    return { ring, lifeSec: 0, radius: 3 };
  });
  const blastLights = [new THREE.PointLight(0xff9842, 0, 10, 2), new THREE.PointLight(0xffbd64, 0, 10, 2)];
  scene.add(...blastLights);
  let nextBlastIndex = 0;
  let lightEffectsEnabled = true;

  function emitExplosion(position, weaponIndex) {
    const blast = blasts[nextBlastIndex++ % BLAST_LIMIT];
    blast.lifeSec = 0.42;
    blast.radius = DEAD_SHIFT_WEAPONS[weaponIndex]?.splashRadius || 3;
    blast.ring.visible = true;
    blast.ring.position.set(position.x, Math.max(0.035, position.y * 0.25), position.z);
    emitParticles(position, 34, [2.7, 0.8, 0.17], 5.8, 0.32, 0.65, 5);
    emitParticles(position, 16, [0.19, 0.22, 0.2], 2.2, 0.75, 1.3, -0.6);
    if (lightEffectsEnabled) {
      const light = blastLights[nextBlastIndex % blastLights.length];
      light.position.set(position.x, position.y + 0.6, position.z);
      light.intensity = 180;
    }
  }

  const patches = Array.from({ length: ACID_PATCH_LIMIT }, () => {
    const material = resources.ownMaterial(new THREE.MeshBasicMaterial({ color: 0x9cbb43, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    const mesh = new THREE.Mesh(resources.cylinder, material);
    mesh.scale.set(1.1, 0.015, 1.1);
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, lifeSec: 0 };
  });
  let nextPatchIndex = 0;

  const rocketMaterial = resources.ownMaterial(new THREE.MeshStandardMaterial({ color: 0x727a49, roughness: 0.4, metalness: 0.65 }));
  const projectileMetal = resources.ownMaterial(new THREE.MeshStandardMaterial({ color: 0x263534, roughness: 0.37, metalness: 0.8 }));
  const projectileStripe = resources.ownMaterial(new THREE.MeshStandardMaterial({ color: 0xc6a743, roughness: 0.4, metalness: 0.35 }));
  const acidMaterial = resources.ownMaterial(new THREE.MeshStandardMaterial({ color: 0xacd255, emissive: 0x608f19, emissiveIntensity: 1.8, roughness: 0.22 }));
  const projectileSlots = Array.from({ length: DEAD_SHIFT_MAX_PROJECTILES }, () => ({ id: 0, kind: "", mesh: null, trailSec: 0 }));
  const forward = new THREE.Vector3(0, 0, -1);
  const velocity = new THREE.Vector3();

  function createProjectileModel(kind) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(kind === "acid" || kind === "grenade" ? resources.sphere : resources.cylinder, kind === "acid" ? acidMaterial : kind === "rocket" ? rocketMaterial : projectileMetal);
    body.scale.set(kind === "acid" ? 0.25 : 0.16, kind === "rocket" ? 0.58 : 0.2, kind === "acid" ? 0.25 : 0.16);
    if (kind === "rocket") body.rotation.x = Math.PI / 2;
    group.add(body);
    if (kind === "rocket") {
      const nose = new THREE.Mesh(resources.cone, projectileStripe);
      nose.scale.set(0.16, 0.22, 0.16);
      nose.rotation.x = -Math.PI / 2;
      nose.position.z = -0.37;
      group.add(nose);
      for (const side of [-1, 1]) {
        const fin = new THREE.Mesh(resources.box, projectileMetal);
        fin.position.z = 0.19;
        fin.scale.set(side === 1 ? 0.28 : 0.025, side === 1 ? 0.025 : 0.28, 0.15);
        group.add(fin);
      }
    } else if (kind === "grenade") {
      const stripe = new THREE.Mesh(resources.cylinder, projectileStripe);
      stripe.scale.set(0.17, 0.055, 0.17);
      group.add(stripe);
    }
    scene.add(group);
    return group;
  }

  const seenEventIds = new Set();
  const eventHistory = [];

  function recordSnapshotEffects(events, players, playerId) {
    const eventStates = Array.isArray(events) ? events : Object.values(events || {});
    for (const event of eventStates) {
      if (!event.id || seenEventIds.has(event.id)) continue;
      seenEventIds.add(event.id);
      eventHistory.push(event.id);
      if (eventHistory.length > EVENT_HISTORY_LIMIT) seenEventIds.delete(eventHistory.shift());
      if (event.kind === "shot") {
        const actor = players?.[event.actorId];
        if (actor && event.actorId !== playerId && DEAD_SHIFT_WEAPONS[event.weapon]?.kind === "hitscan") {
          emitTracer({ x: actor.x, y: actor.y + 1.4, z: actor.z }, event);
          emitParticles({ x: actor.x - Math.sin(actor.yaw) * 0.6, y: actor.y + 1.4, z: actor.z - Math.cos(actor.yaw) * 0.6 }, 3, [3, 1.6, 0.5], 0.3, 0.18, 0.065, 0);
        }
      } else if (event.kind === "hit" || event.kind === "headshot" || event.kind === "kill") {
        const headshot = event.kind === "headshot";
        emitParticles(event, event.kind === "kill" ? 14 : headshot ? 10 : 6, headshot ? [0.76, 0.29, 0.13] : [0.38, 0.075, 0.045], headshot ? 2.3 : 1.4, headshot ? 0.16 : 0.12, 0.45, 5);
      } else if (event.kind === "explosion") {
        emitExplosion(event, event.weapon);
      } else if (event.kind === "acid") {
        emitParticles(event, 17, [0.65, 0.9, 0.13], 2.4, 0.18, 0.65, 5);
        const patch = patches[nextPatchIndex++ % ACID_PATCH_LIMIT];
        patch.lifeSec = 2.1;
        patch.mesh.position.set(event.x, 0.03, event.z);
        patch.mesh.visible = true;
      }
    }
  }

  return {
    recordSnapshotEffects,
    resetRound() {
      seenEventIds.clear();
      eventHistory.length = 0;
      for (const particle of particles) particle.lifeSec = 0;
      alphas.fill(0);
      tracerLives.fill(0);
      for (const blast of blasts) {
        blast.lifeSec = 0;
        blast.ring.visible = false;
      }
      for (const patch of patches) {
        patch.lifeSec = 0;
        patch.mesh.visible = false;
      }
      for (const light of blastLights) light.intensity = 0;
      for (const slot of projectileSlots) {
        slot.id = 0;
        if (slot.mesh) slot.mesh.visible = false;
      }
    },
    localShot(player, input, weaponIndex) {
      if (DEAD_SHIFT_WEAPONS[weaponIndex].kind !== "hitscan") return;
      const yaw = input?.yaw ?? player.yaw;
      const pitch = input?.pitch ?? player.pitch;
      const distance = Math.min(28, DEAD_SHIFT_WEAPONS[weaponIndex].range);
      const directionX = -Math.sin(yaw) * Math.cos(pitch);
      const directionY = Math.sin(pitch);
      const directionZ = -Math.cos(yaw) * Math.cos(pitch);
      const start = { x: player.x + directionX * 0.65 + Math.cos(yaw) * 0.2, y: player.y + 1.43 + directionY * 0.6, z: player.z + directionZ * 0.65 - Math.sin(yaw) * 0.2 };
      const end = { x: player.x + directionX * distance, y: player.y + 1.65 + directionY * distance, z: player.z + directionZ * distance };
      emitTracer(start, end);
    },
    update({ dtSec, projectiles, reducedMotion }) {
      for (let index = 0; index < PARTICLE_LIMIT; index += 1) {
        const particle = particles[index];
        particle.lifeSec = Math.max(0, particle.lifeSec - dtSec);
        alphas[index] = Math.min(1, particle.lifeSec / Math.min(0.2, particle.durationSec));
        if (!particle.lifeSec) continue;
        const offset = index * 3;
        positions[offset] += particle.vx * dtSec;
        positions[offset + 1] += particle.vy * dtSec;
        positions[offset + 2] += particle.vz * dtSec;
        particle.vy -= particle.gravity * dtSec;
        if (positions[offset + 1] < 0.03) {
          positions[offset + 1] = 0.03;
          particle.vy = 0;
          particle.vx *= 0.8;
          particle.vz *= 0.8;
        }
      }
      for (const attribute of Object.values(geometry.attributes)) attribute.needsUpdate = true;

      for (let index = 0; index < TRACER_LIMIT; index += 1) {
        tracerLives[index] = Math.max(0, tracerLives[index] - dtSec);
        if (!tracerLives[index]) {
          const offset = index * 6;
          tracerPositions[offset + 3] = tracerPositions[offset];
          tracerPositions[offset + 4] = tracerPositions[offset + 1];
          tracerPositions[offset + 5] = tracerPositions[offset + 2];
        }
      }
      tracerGeometry.attributes.position.needsUpdate = true;

      for (const blast of blasts) {
        blast.lifeSec = Math.max(0, blast.lifeSec - dtSec);
        blast.ring.visible = blast.lifeSec > 0 && !reducedMotion;
        const progress = 1 - blast.lifeSec / 0.42;
        blast.ring.scale.setScalar(0.2 + progress * blast.radius);
        blast.ring.material.opacity = Math.max(0, 0.65 * (1 - progress));
      }
      for (const light of blastLights) light.intensity *= Math.exp(-dtSec * 15);
      for (const patch of patches) {
        patch.lifeSec = Math.max(0, patch.lifeSec - dtSec);
        patch.mesh.visible = patch.lifeSec > 0;
        patch.mesh.material.opacity = Math.min(0.46, patch.lifeSec * 0.35);
      }

      const projectileStates = Array.isArray(projectiles) ? projectiles : Object.values(projectiles || {});
      for (let index = 0; index < projectileSlots.length; index += 1) {
        const slot = projectileSlots[index];
        const projectile = projectileStates[index];
        if (!projectile?.id) {
          if (slot.mesh) slot.mesh.visible = false;
          slot.id = 0;
          continue;
        }
        if (!slot.mesh || slot.kind !== projectile.kind) {
          if (slot.mesh) scene.remove(slot.mesh);
          slot.mesh = createProjectileModel(projectile.kind);
          slot.kind = projectile.kind;
        }
        slot.mesh.visible = true;
        const blend = slot.id !== projectile.id ? 1 : 1 - Math.exp(-dtSec * 27);
        slot.mesh.position.lerp(velocity.set(projectile.x, projectile.y, projectile.z), blend);
        if (projectile.kind === "rocket") {
          velocity.set(projectile.vx, projectile.vy, projectile.vz).normalize();
          slot.mesh.quaternion.setFromUnitVectors(forward, velocity);
        } else if (!reducedMotion) {
          slot.mesh.rotation.x += dtSec * 5;
          slot.mesh.rotation.z += dtSec * 3;
        }
        slot.trailSec -= dtSec;
        if (slot.trailSec <= 0) {
          slot.trailSec = reducedMotion ? 0.12 : 0.045;
          if (projectile.kind === "rocket") emitParticles(projectile, 2, [0.7, 0.43, 0.2], 0.35, 0.18, 0.42, -0.3);
          if (projectile.kind === "acid") emitParticles(projectile, 1, [0.5, 0.7, 0.15], 0.08, 0.12, 0.3, 0);
        }
        slot.id = projectile.id;
      }
    },
    setPixelRatio(pixelRatio) {
      particleMaterial.uniforms.pixelRatio.value = pixelRatio;
    },
    setQuality(profile) {
      activeParticleLimit = profile === "low" ? 128 : profile === "medium" ? 256 : PARTICLE_LIMIT;
      lightEffectsEnabled = profile !== "low";
      for (const light of blastLights) light.visible = lightEffectsEnabled;
    },
    getStats() {
      return {
        particles: particles.filter((particle) => particle.lifeSec > 0).length,
        projectiles: projectileSlots.filter((slot) => slot.id).length,
      };
    },
    dispose() {
      scene.remove(points, tracerLines, ...blastLights);
      for (const blast of blasts) scene.remove(blast.ring);
      for (const patch of patches) scene.remove(patch.mesh);
      for (const slot of projectileSlots) if (slot.mesh) scene.remove(slot.mesh);
      seenEventIds.clear();
    },
  };
}
