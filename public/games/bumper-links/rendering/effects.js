import * as THREE from "three";

/** @typedef {import("../client/matchEvents.js").BumperLinksClientEvent} BumperLinksClientEvent */
/** @typedef {import("../client/snapshotPose.js").BumperLinksPresentedBall} BumperLinksPresentedBall */

const PARTICLE_CAPACITY = 160;
const RING_CAPACITY = 6;
const GRAVITY_M_PER_SEC2 = 9;

/**
 * Pooled splash droplets, cup sparkles and expanding rings. Nothing here
 * allocates per frame after creation.
 * @param {THREE.Scene} scene
 */
export function createBumperLinksEffects(scene) {
  const positions = new Float32Array(PARTICLE_CAPACITY * 3);
  const colors = new Float32Array(PARTICLE_CAPACITY * 3);
  const velocities = new Float32Array(PARTICLE_CAPACITY * 3);
  const lives = new Float32Array(PARTICLE_CAPACITY);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({ size: 0.14, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  scene.add(points);
  const ringGeometry = new THREE.RingGeometry(0.8, 1, 32);
  const rings = Array.from({ length: RING_CAPACITY }, () => {
    const ringMaterial = new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0, depthWrite: false });
    const mesh = new THREE.Mesh(ringGeometry, ringMaterial);
    mesh.rotation.x = -Math.PI / 2;
    mesh.visible = false;
    scene.add(mesh);
    return { mesh, material: ringMaterial, ageSec: 0, lifeSec: 0, growth: 0 };
  });
  const tint = new THREE.Color();
  let nextParticle = 0;
  let nextRing = 0;
  for (let index = 0; index < PARTICLE_CAPACITY; index += 1) positions[index * 3 + 1] = -1000;

  /** @param {number} x @param {number} y @param {number} z @param {string} color @param {number} count @param {number} speed @param {number} lift */
  function burst(x, y, z, color, count, speed, lift) {
    tint.set(color);
    for (let created = 0; created < count; created += 1) {
      const index = nextParticle;
      nextParticle = (nextParticle + 1) % PARTICLE_CAPACITY;
      const angle = Math.random() * Math.PI * 2;
      const horizontal = speed * (0.4 + Math.random() * 0.6);
      positions[index * 3] = x;
      positions[index * 3 + 1] = y;
      positions[index * 3 + 2] = z;
      velocities[index * 3] = Math.sin(angle) * horizontal;
      velocities[index * 3 + 1] = lift * (0.6 + Math.random() * 0.6);
      velocities[index * 3 + 2] = Math.cos(angle) * horizontal;
      colors[index * 3] = tint.r;
      colors[index * 3 + 1] = tint.g;
      colors[index * 3 + 2] = tint.b;
      lives[index] = 0.7 + Math.random() * 0.5;
    }
  }

  /** @param {number} x @param {number} y @param {number} z @param {string} color @param {number} growth @param {number} lifeSec */
  function ring(x, y, z, color, growth, lifeSec) {
    const slot = rings[nextRing];
    nextRing = (nextRing + 1) % RING_CAPACITY;
    slot.mesh.position.set(x, y, z);
    slot.mesh.scale.setScalar(0.2);
    slot.mesh.visible = true;
    slot.material.color.set(color);
    slot.ageSec = 0;
    slot.lifeSec = lifeSec;
    slot.growth = growth;
  }

  return {
    /**
     * @param {readonly BumperLinksClientEvent[]} events
     * @param {readonly BumperLinksPresentedBall[]} balls
     * @param {{cup:{x:number,y:number,z:number},waterY:number,reducedMotion:boolean}} context
     */
    spawn(events, balls, { cup, waterY, reducedMotion }) {
      const scale = reducedMotion ? 0.35 : 1;
      for (const event of events) {
        if (event.type === "sink") {
          burst(cup.x, cup.y + 0.1, cup.z, "#ffe27a", Math.round(36 * scale), 1.6, 3.6);
          ring(cup.x, cup.y + 0.02, cup.z, "#ffe27a", 2.2, 0.7);
        } else if (event.type === "splash" || event.type === "knockout") {
          burst(event.x, waterY + 0.05, event.z, "#d8f3ff", Math.round(30 * scale), 1.2, 4);
          ring(event.x, waterY + 0.02, event.z, "#d8f3ff", 3, 1.1);
        } else if (event.type === "shot") {
          const ball = balls.find((candidate) => candidate.id === event.ballId);
          if (ball) ring(ball.x, ball.y - 0.2, ball.z, "#ffffff", 0.9, 0.35);
        }
      }
    },
    /** @param {number} dtSec */
    update(dtSec) {
      for (let index = 0; index < PARTICLE_CAPACITY; index += 1) {
        if (lives[index] <= 0) continue;
        lives[index] -= dtSec;
        if (lives[index] <= 0) {
          positions[index * 3 + 1] = -1000;
          continue;
        }
        velocities[index * 3 + 1] -= GRAVITY_M_PER_SEC2 * dtSec;
        positions[index * 3] += velocities[index * 3] * dtSec;
        positions[index * 3 + 1] += velocities[index * 3 + 1] * dtSec;
        positions[index * 3 + 2] += velocities[index * 3 + 2] * dtSec;
      }
      geometry.attributes.position.needsUpdate = true;
      geometry.attributes.color.needsUpdate = true;
      for (const slot of rings) {
        if (!slot.mesh.visible) continue;
        slot.ageSec += dtSec;
        const progress = slot.ageSec / slot.lifeSec;
        if (progress >= 1) {
          slot.mesh.visible = false;
          continue;
        }
        slot.mesh.scale.setScalar(0.2 + progress * slot.growth);
        slot.material.opacity = (1 - progress) * 0.85;
      }
    },
    clear() {
      lives.fill(0);
      for (let index = 0; index < PARTICLE_CAPACITY; index += 1) positions[index * 3 + 1] = -1000;
      geometry.attributes.position.needsUpdate = true;
      for (const slot of rings) slot.mesh.visible = false;
    },
    dispose() {
      scene.remove(points);
      geometry.dispose();
      material.dispose();
      for (const slot of rings) {
        scene.remove(slot.mesh);
        slot.material.dispose();
      }
      ringGeometry.dispose();
    },
  };
}
