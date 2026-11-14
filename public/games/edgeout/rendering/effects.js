import * as THREE from "three";

/** @typedef {import("../client/matchEvents.js").EdgeoutMatchEvent} EdgeoutMatchEvent */

const WAVE_POOL_SIZE = 10;
const PILLAR_POOL_SIZE = 2;
const SPARK_CAPACITY = 128;
const WAVE_DURATION_SEC = 0.38;
const PILLAR_DURATION_SEC = 1;
const SPARK_GRAVITY = 9;
const MAX_SHAKE = 0.45;
const EVENT_STYLES = Object.freeze({
  hit: { color: "#ffffff", waveScale: 2.3, sparks: 18, shake: 0.22 },
  blocked: { color: "#9fd8ff", waveScale: 1.3, sparks: 6, shake: 0.06 },
  guardBreak: { color: "#ffb347", waveScale: 2.6, sparks: 22, shake: 0.3 },
  parry: { color: "#fff36b", waveScale: 3.2, sparks: 26, shake: 0.16 },
  swing: { color: "#cfe6ff", waveScale: 0.9, sparks: 0, shake: 0 },
  dash: { color: "#2ee6c8", waveScale: 1.1, sparks: 0, shake: 0 },
  ringOut: { color: "#ff6f91", waveScale: 0, sparks: 0, shake: 0.4 },
  collapse: { color: "#ffc24b", waveScale: 0, sparks: 0, shake: 0.18 },
  round: { color: "#2ee6c8", waveScale: 0, sparks: 0, shake: 0 },
});

/**
 * Pooled hit waves, spark bursts and ring-out pillars, plus a camera shake
 * budget. All allocation happens at construction; spawning reuses objects.
 * @param {THREE.Scene} scene
 * @returns {{spawn(events:readonly EdgeoutMatchEvent[],reducedMotion:boolean,particleLimit:number):void,update(dtSec:number):void,getShake():number,clear():void,dispose():void}}
 */
export function createEdgeoutEffects(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const waveGeometry = new THREE.RingGeometry(0.82, 1, 40);
  waveGeometry.rotateX(-Math.PI / 2);
  const waves = Array.from({ length: WAVE_POOL_SIZE }, () => {
    const material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(waveGeometry, material);
    mesh.visible = false;
    group.add(mesh);
    return { mesh, material, ageSec: 0, maxScale: 1 };
  });
  const pillarGeometry = new THREE.CylinderGeometry(0.7, 1.3, 24, 20, 1, true);
  pillarGeometry.translate(0, -12, 0);
  const pillars = Array.from({ length: PILLAR_POOL_SIZE }, () => {
    const material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(pillarGeometry, material);
    mesh.visible = false;
    group.add(mesh);
    return { mesh, material, ageSec: 0 };
  });

  const sparkPositions = new Float32Array(SPARK_CAPACITY * 3);
  const sparkVelocities = new Float32Array(SPARK_CAPACITY * 3);
  const sparkLife = new Float32Array(SPARK_CAPACITY);
  const sparkGeometry = new THREE.BufferGeometry();
  const sparkAttribute = new THREE.BufferAttribute(sparkPositions, 3);
  sparkAttribute.setUsage(THREE.DynamicDrawUsage);
  sparkGeometry.setAttribute("position", sparkAttribute);
  const sparkMaterial = new THREE.PointsMaterial({ color: "#fff4c2", size: 0.14, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const sparks = new THREE.Points(sparkGeometry, sparkMaterial);
  sparks.frustumCulled = false;
  group.add(sparks);
  for (let index = 0; index < SPARK_CAPACITY; index += 1) sparkPositions[index * 3 + 1] = -500;

  let nextWave = 0;
  let nextPillar = 0;
  let nextSpark = 0;
  let shake = 0;

  /** @param {number} x @param {number} z @param {string} color @param {number} scale */
  function spawnWave(x, z, color, scale) {
    const wave = waves[nextWave];
    nextWave = (nextWave + 1) % WAVE_POOL_SIZE;
    wave.ageSec = 0;
    wave.maxScale = scale;
    wave.material.color.set(color);
    wave.mesh.position.set(x, 0.08, z);
    wave.mesh.visible = true;
  }

  /** @param {number} x @param {number} z @param {string} color */
  function spawnPillar(x, z, color) {
    const pillar = pillars[nextPillar];
    nextPillar = (nextPillar + 1) % PILLAR_POOL_SIZE;
    pillar.ageSec = 0;
    pillar.material.color.set(color);
    pillar.mesh.position.set(x, 0, z);
    pillar.mesh.visible = true;
  }

  /** @param {number} x @param {number} z @param {number} count @param {number} power */
  function spawnSparks(x, z, count, power) {
    for (let sparkIndex = 0; sparkIndex < count; sparkIndex += 1) {
      const index = nextSpark;
      nextSpark = (nextSpark + 1) % SPARK_CAPACITY;
      const angle = Math.random() * Math.PI * 2;
      const speed = 3 + Math.random() * 5 * (0.5 + power);
      sparkPositions[index * 3] = x;
      sparkPositions[index * 3 + 1] = 1 + Math.random() * 0.4;
      sparkPositions[index * 3 + 2] = z;
      sparkVelocities[index * 3] = Math.cos(angle) * speed;
      sparkVelocities[index * 3 + 1] = 2 + Math.random() * 4;
      sparkVelocities[index * 3 + 2] = Math.sin(angle) * speed;
      sparkLife[index] = 0.35 + Math.random() * 0.3;
    }
  }

  return {
    spawn(events, reducedMotion, particleLimit) {
      for (const event of events) {
        const style = EVENT_STYLES[event.kind];
        if (!style) continue;
        if (style.waveScale > 0) spawnWave(event.x, event.z, style.color, style.waveScale * (0.6 + 0.6 * event.power));
        if (style.sparks > 0) spawnSparks(event.x, event.z, Math.min(particleLimit, Math.round(style.sparks * (0.5 + event.power))), event.power);
        if (event.kind === "ringOut") spawnPillar(event.x, event.z, style.color);
        if (!reducedMotion) shake = Math.min(MAX_SHAKE, shake + style.shake * (0.5 + 0.5 * event.power));
      }
    },
    update(dtSec) {
      for (const wave of waves) {
        if (!wave.mesh.visible) continue;
        wave.ageSec += dtSec;
        const progress = wave.ageSec / WAVE_DURATION_SEC;
        if (progress >= 1) {
          wave.mesh.visible = false;
          continue;
        }
        wave.mesh.scale.setScalar(0.25 + wave.maxScale * progress);
        wave.material.opacity = 0.85 * (1 - progress);
      }
      for (const pillar of pillars) {
        if (!pillar.mesh.visible) continue;
        pillar.ageSec += dtSec;
        const progress = pillar.ageSec / PILLAR_DURATION_SEC;
        if (progress >= 1) {
          pillar.mesh.visible = false;
          continue;
        }
        pillar.material.opacity = 0.55 * (1 - progress);
        pillar.mesh.scale.set(1 + progress * 0.6, 1, 1 + progress * 0.6);
      }
      for (let index = 0; index < SPARK_CAPACITY; index += 1) {
        if (sparkLife[index] <= 0) continue;
        sparkLife[index] -= dtSec;
        if (sparkLife[index] <= 0) {
          sparkPositions[index * 3 + 1] = -500;
          continue;
        }
        sparkVelocities[index * 3 + 1] -= SPARK_GRAVITY * dtSec;
        sparkPositions[index * 3] += sparkVelocities[index * 3] * dtSec;
        sparkPositions[index * 3 + 1] += sparkVelocities[index * 3 + 1] * dtSec;
        sparkPositions[index * 3 + 2] += sparkVelocities[index * 3 + 2] * dtSec;
      }
      sparkAttribute.needsUpdate = true;
      shake = Math.max(0, shake - dtSec * 1.6);
    },
    getShake: () => shake,
    clear() {
      for (const wave of waves) wave.mesh.visible = false;
      for (const pillar of pillars) pillar.mesh.visible = false;
      sparkLife.fill(0);
      for (let index = 0; index < SPARK_CAPACITY; index += 1) sparkPositions[index * 3 + 1] = -500;
      sparkAttribute.needsUpdate = true;
      shake = 0;
    },
    dispose() {
      scene.remove(group);
      waveGeometry.dispose();
      pillarGeometry.dispose();
      sparkGeometry.dispose();
      sparkMaterial.dispose();
      for (const wave of waves) wave.material.dispose();
      for (const pillar of pillars) pillar.material.dispose();
    },
  };
}
