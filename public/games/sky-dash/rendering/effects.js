import * as THREE from "three";

const MAXIMUM_PARTICLES = 96;
const PARTICLE_COLORS = Object.freeze(["#fff5df", "#ffcf66", "#ef6b93", "#9b82e4", "#55d4cf"]);

/**
 * Small impact puffs, dash trails and finish confetti share a fixed pool. Event
 * observations are pruned with the active runners, so rematches cannot grow it.
 * @param {THREE.Scene} scene
 * @param {import("./resources.js").SkyDashResources} resources
 */
export function createSkyDashEffects(scene, resources) {
  const material = resources.material("#ffffff", 0.78);
  const puffs = new THREE.InstancedMesh(resources.softSphere, material, MAXIMUM_PARTICLES);
  const confetti = new THREE.InstancedMesh(resources.box, material, MAXIMUM_PARTICLES);
  puffs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  confetti.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  puffs.frustumCulled = false;
  confetti.frustumCulled = false;
  puffs.count = 0;
  confetti.count = 0;
  scene.add(puffs, confetti);
  const particles = Array.from({ length: MAXIMUM_PARTICLES }, () => ({
    active: false, confetti: false, age: 0, life: 1,
    x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0,
    size: 0.1, color: 0, angle: 0,
  }));
  const observations = new Map();
  const transform = new THREE.Object3D();
  const particleColor = new THREE.Color();
  let particleLimit = MAXIMUM_PARTICLES;
  let cursor = 0;
  let activeCount = 0;

  function emitParticle(x, y, z, vx, vy, vz, size, color, isConfetti, life) {
    if (particleLimit <= 0) return;
    cursor = (cursor + 1) % particleLimit;
    const particle = particles[cursor];
    particle.active = true;
    particle.confetti = isConfetti;
    particle.age = 0;
    particle.life = life;
    particle.x = x;
    particle.y = y;
    particle.z = z;
    particle.vx = vx;
    particle.vy = vy;
    particle.vz = vz;
    particle.size = size;
    particle.color = color;
    particle.angle = cursor * 2.4;
  }

  function emitPuff(runnerState, count, celebration = false) {
    const boundedCount = Math.min(count, particleLimit);
    for (let index = 0; index < boundedCount; index += 1) {
      const angle = index * 2.39996 + runnerState.x * 0.23;
      const radialSpeed = celebration ? 2.8 + index % 3 : 1.1 + (index % 3) * 0.3;
      emitParticle(
        runnerState.x,
        runnerState.y + (celebration ? 1.1 : 0.15),
        runnerState.z,
        Math.cos(angle) * radialSpeed,
        celebration ? 4 + index % 4 : 0.8 + (index % 3) * 0.25,
        Math.sin(angle) * radialSpeed,
        celebration ? 0.08 + (index % 3) * 0.02 : 0.1 + (index % 3) * 0.03,
        celebration ? index % PARTICLE_COLORS.length : 0,
        celebration,
        celebration ? 1.4 + (index % 5) * 0.15 : 0.5,
      );
    }
  }

  return {
    update({ runners, dtSec, reducedMotion }) {
      if (reducedMotion) {
        for (const particle of particles) particle.active = false;
      }
      const activeIds = new Set();
      for (const runnerState of runners) {
        activeIds.add(runnerState.id);
        let previous = observations.get(runnerState.id);
        if (!previous) {
          previous = { action: runnerState.action, grounded: runnerState.grounded, respawnId: runnerState.respawnId, finished: runnerState.finished, trailSec: 0 };
          observations.set(runnerState.id, previous);
        }
        if (!reducedMotion) {
          if (runnerState.finished && !previous.finished) emitPuff(runnerState, 30, true);
          else if (runnerState.respawnId !== previous.respawnId) emitPuff(runnerState, 9);
          else if (runnerState.action === "hit" && previous.action !== "hit") emitPuff(runnerState, 7);
          else if (runnerState.grounded && !previous.grounded) emitPuff(runnerState, 4);
          if (runnerState.action === "dash") {
            previous.trailSec += dtSec;
            if (previous.trailSec > 0.04) {
              previous.trailSec %= 0.04;
              const headingX = Math.sin(runnerState.yaw || 0);
              const headingZ = -Math.cos(runnerState.yaw || 0);
              emitParticle(runnerState.x - headingX * 0.5, runnerState.y + 0.5, runnerState.z - headingZ * 0.5, -headingX * 2, 0.1, -headingZ * 2, 0.13, 4, false, 0.3);
            }
          } else {
            previous.trailSec = 0;
          }
        }
        previous.action = runnerState.action;
        previous.grounded = runnerState.grounded;
        previous.respawnId = runnerState.respawnId;
        previous.finished = runnerState.finished;
      }
      for (const runnerId of observations.keys()) {
        if (!activeIds.has(runnerId)) observations.delete(runnerId);
      }

      let puffCount = 0;
      let confettiCount = 0;
      for (let index = 0; index < particleLimit; index += 1) {
        const particle = particles[index];
        if (!particle.active) continue;
        particle.age += dtSec;
        if (particle.age >= particle.life) {
          particle.active = false;
          continue;
        }
        const remaining = 1 - particle.age / particle.life;
        particle.vy -= dtSec * (particle.confetti ? 5.5 : 2.2);
        particle.x += particle.vx * dtSec;
        particle.y += particle.vy * dtSec;
        particle.z += particle.vz * dtSec;
        transform.position.set(particle.x, particle.y, particle.z);
        transform.rotation.set(particle.confetti ? particle.age * 7 : 0, particle.angle + particle.age * 3, particle.confetti ? particle.age * 5 : 0);
        const size = particle.size * Math.min(1, remaining * 3);
        transform.scale.set(size, particle.confetti ? size * 0.25 : size * 0.8, particle.confetti ? size * 1.7 : size);
        transform.updateMatrix();
        particleColor.set(PARTICLE_COLORS[particle.color]);
        const mesh = particle.confetti ? confetti : puffs;
        const instanceIndex = particle.confetti ? confettiCount++ : puffCount++;
        mesh.setMatrixAt(instanceIndex, transform.matrix);
        mesh.setColorAt(instanceIndex, particleColor);
      }
      puffs.count = puffCount;
      confetti.count = confettiCount;
      activeCount = puffCount + confettiCount;
      if (puffCount) {
        puffs.instanceMatrix.needsUpdate = true;
        puffs.instanceColor.needsUpdate = true;
      }
      if (confettiCount) {
        confetti.instanceMatrix.needsUpdate = true;
        confetti.instanceColor.needsUpdate = true;
      }
    },
    setParticleLimit(limit) {
      particleLimit = Math.max(0, Math.min(MAXIMUM_PARTICLES, Math.trunc(limit)));
      cursor = 0;
      for (let index = particleLimit; index < particles.length; index += 1) particles[index].active = false;
    },
    reset() {
      for (const particle of particles) particle.active = false;
      observations.clear();
      puffs.count = 0;
      confetti.count = 0;
      activeCount = 0;
    },
    getCount: () => activeCount,
    dispose() {
      observations.clear();
      scene.remove(puffs, confetti);
      puffs.dispose();
      confetti.dispose();
    },
  };
}
