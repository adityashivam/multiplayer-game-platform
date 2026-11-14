import * as THREE from "three";
import { getLastFuseCityLayout } from "../shared/city.js";

/** @typedef {import("../client/matchEvents.js").LastFuseMatchEvent} LastFuseMatchEvent */

const SPARK_CAPACITY = 220;
const PUFF_CAPACITY = 48;
const WAVE_POOL_SIZE = 6;
const FIREBALL_POOL_SIZE = 3;
const SPARK_GRAVITY = 14;
const MAX_SHAKE = 0.6;
const FUSE_SPARKS_PER_SEC = 50;

/** Soft radial sprite, drawn once. @param {string} inner @param {string} outer */
function createGlowTexture(inner, outer) {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(1, outer);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/**
 * Pooled blast fireballs, shock rings, sparks, smoke and dust, plus a fuse
 * spark stream and a camera shake budget. All allocation happens up front.
 * @param {THREE.Scene} scene
 */
export function createLastFuseEffects(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const fireTexture = createGlowTexture("rgba(255,240,200,1)", "rgba(255,90,20,0)");
  const smokeTexture = createGlowTexture("rgba(90,88,92,0.75)", "rgba(40,40,44,0)");

  const fireballs = Array.from({ length: FIREBALL_POOL_SIZE }, () => {
    const material = new THREE.SpriteMaterial({ map: fireTexture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    const sprite = new THREE.Sprite(material);
    sprite.visible = false;
    group.add(sprite);
    return { sprite, material, ageSec: 0 };
  });
  const waveGeometry = new THREE.RingGeometry(0.85, 1, 48);
  waveGeometry.rotateX(-Math.PI / 2);
  const waves = Array.from({ length: WAVE_POOL_SIZE }, () => {
    const material = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(waveGeometry, material);
    mesh.visible = false;
    group.add(mesh);
    return { mesh, material, ageSec: 0, durationSec: 0.5, maxScale: 1 };
  });
  const puffs = Array.from({ length: PUFF_CAPACITY }, () => {
    const material = new THREE.SpriteMaterial({ map: smokeTexture, transparent: true, depthWrite: false, toneMapped: false });
    const sprite = new THREE.Sprite(material);
    sprite.visible = false;
    group.add(sprite);
    return { sprite, material, ageSec: 0, lifeSec: 1, vx: 0, vy: 0, vz: 0, size: 1, tint: 1 };
  });
  let nextPuff = 0;

  const sparkPositions = new Float32Array(SPARK_CAPACITY * 3);
  const sparkVelocities = new Float32Array(SPARK_CAPACITY * 3);
  const sparkLife = new Float32Array(SPARK_CAPACITY);
  const sparkGeometry = new THREE.BufferGeometry();
  const sparkAttribute = new THREE.BufferAttribute(sparkPositions, 3);
  sparkAttribute.setUsage(THREE.DynamicDrawUsage);
  sparkGeometry.setAttribute("position", sparkAttribute);
  const sparkMaterial = new THREE.PointsMaterial({ color: "#ffd38a", size: 0.12, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const sparks = new THREE.Points(sparkGeometry, sparkMaterial);
  sparks.frustumCulled = false;
  group.add(sparks);
  let nextSpark = 0;
  let fuseSparkDebt = 0;
  let shake = 0;

  /** @param {number} x @param {number} y @param {number} z @param {number} speed @param {number} up @param {number} lifeSec */
  function emitSpark(x, y, z, speed, up, lifeSec) {
    const index = nextSpark;
    nextSpark = (nextSpark + 1) % SPARK_CAPACITY;
    const angle = Math.random() * Math.PI * 2;
    const spread = Math.random() * speed;
    sparkPositions[index * 3] = x;
    sparkPositions[index * 3 + 1] = y;
    sparkPositions[index * 3 + 2] = z;
    sparkVelocities[index * 3] = Math.cos(angle) * spread;
    sparkVelocities[index * 3 + 1] = up * (0.4 + Math.random());
    sparkVelocities[index * 3 + 2] = Math.sin(angle) * spread;
    sparkLife[index] = lifeSec * (0.5 + Math.random() * 0.5);
  }

  /** @param {number} x @param {number} y @param {number} z @param {number} size @param {number} lifeSec @param {number} tint @param {number} rise */
  function emitPuff(x, y, z, size, lifeSec, tint, rise) {
    const puff = puffs[nextPuff];
    nextPuff = (nextPuff + 1) % PUFF_CAPACITY;
    puff.sprite.visible = true;
    puff.sprite.position.set(x, y, z);
    puff.ageSec = 0;
    puff.lifeSec = lifeSec;
    puff.vx = (Math.random() - 0.5) * 2;
    puff.vy = rise * (0.6 + Math.random() * 0.6);
    puff.vz = (Math.random() - 0.5) * 2;
    puff.size = size;
    puff.tint = tint;
  }

  /** @param {number} x @param {number} y @param {number} z @param {string} color @param {number} maxScale @param {number} durationSec */
  function emitWave(x, y, z, color, maxScale, durationSec) {
    const wave = waves.find((candidate) => !candidate.mesh.visible) ?? waves[0];
    wave.mesh.visible = true;
    wave.mesh.position.set(x, y + 0.08, z);
    wave.material.color.set(color);
    wave.ageSec = 0;
    wave.durationSec = durationSec;
    wave.maxScale = maxScale;
  }

  /** @param {LastFuseMatchEvent} event @param {boolean} reducedMotion @param {number} sparkBudget @param {number} citySeed */
  function spawnEvent(event, reducedMotion, sparkBudget, citySeed) {
    switch (event.kind) {
      case "blast": {
        const fireball = fireballs.find((candidate) => !candidate.sprite.visible) ?? fireballs[0];
        fireball.sprite.visible = true;
        fireball.sprite.position.set(event.x, event.y + 1, event.z);
        fireball.ageSec = 0;
        emitWave(event.x, event.y, event.z, "#ffb36b", 9, 0.55);
        for (let index = 0; index < sparkBudget; index += 1) emitSpark(event.x, event.y + 1, event.z, 12, 9, 1.2);
        for (let index = 0; index < 10; index += 1) emitPuff(event.x + (Math.random() - 0.5) * 2, event.y + 1, event.z + (Math.random() - 0.5) * 2, 3 + Math.random() * 2, 2.6, 0.5, 2.2);
        shake = Math.min(MAX_SHAKE, shake + (reducedMotion ? 0.1 : 0.55));
        break;
      }
      case "pass":
        emitWave(event.x, event.y, event.z, "#ff5d3d", 2.4, 0.35);
        for (let index = 0; index < 14; index += 1) emitSpark(event.x, event.y + 1.1, event.z, 4, 3, 0.4);
        shake = Math.min(MAX_SHAKE, shake + (reducedMotion ? 0 : 0.08));
        break;
      case "armed":
        emitWave(event.x, event.y, event.z, "#ffc24b", 3, 0.5);
        break;
      case "respawn":
        emitWave(event.x, event.y, event.z, "#7fd8ff", 1.8, 0.4);
        break;
      case "crumbleWarning":
      case "collapse": {
        const roof = event.roofId > 0 ? getLastFuseCityLayout(citySeed).roofs[event.roofId - 1] : null;
        if (!roof) break;
        for (let index = 0; index < (event.kind === "collapse" ? 14 : 6); index += 1) {
          emitPuff(roof.x + (Math.random() - 0.5) * roof.width, roof.topY, roof.z + (Math.random() - 0.5) * roof.depth, 3, 2.2, 0.85, 1.5);
        }
        if (event.kind === "collapse") shake = Math.min(MAX_SHAKE, shake + (reducedMotion ? 0.05 : 0.25));
        break;
      }
      default: break;
    }
  }

  let lastWarnedRoofId = 0;

  return {
    /**
     * @param {readonly LastFuseMatchEvent[]} events
     * @param {boolean} reducedMotion
     * @param {number} sparkBudget
     * @param {number} citySeed
     * @param {number} crumblingRoofId Used to place dust on the collapse that follows a warning.
     */
    spawn(events, reducedMotion, sparkBudget, citySeed, crumblingRoofId) {
      for (const event of events) {
        if (event.kind === "collapse") spawnEvent({ ...event, roofId: lastWarnedRoofId }, reducedMotion, sparkBudget, citySeed);
        else spawnEvent(event, reducedMotion, sparkBudget, citySeed);
      }
      if (crumblingRoofId > 0) lastWarnedRoofId = crumblingRoofId;
    },
    /**
     * @param {number} dtSec
     * @param {THREE.Vector3|null} fusePosition Held bomb, for its spark stream.
     */
    update(dtSec, fusePosition) {
      if (fusePosition) {
        fuseSparkDebt += dtSec * FUSE_SPARKS_PER_SEC;
        while (fuseSparkDebt >= 1) {
          fuseSparkDebt -= 1;
          emitSpark(fusePosition.x, fusePosition.y + 0.22, fusePosition.z, 1.2, 1.6, 0.35);
        }
      }
      for (let index = 0; index < SPARK_CAPACITY; index += 1) {
        if (sparkLife[index] <= 0) {
          sparkPositions[index * 3 + 1] = -1000;
          continue;
        }
        sparkLife[index] -= dtSec;
        sparkVelocities[index * 3 + 1] -= SPARK_GRAVITY * dtSec;
        sparkPositions[index * 3] += sparkVelocities[index * 3] * dtSec;
        sparkPositions[index * 3 + 1] += sparkVelocities[index * 3 + 1] * dtSec;
        sparkPositions[index * 3 + 2] += sparkVelocities[index * 3 + 2] * dtSec;
      }
      sparkAttribute.needsUpdate = true;
      for (const fireball of fireballs) {
        if (!fireball.sprite.visible) continue;
        fireball.ageSec += dtSec;
        const progress = fireball.ageSec / 0.7;
        fireball.sprite.scale.setScalar(2 + progress * 9);
        fireball.material.opacity = Math.max(0, 1 - progress);
        if (progress >= 1) fireball.sprite.visible = false;
      }
      for (const wave of waves) {
        if (!wave.mesh.visible) continue;
        wave.ageSec += dtSec;
        const progress = wave.ageSec / wave.durationSec;
        wave.mesh.scale.setScalar(0.3 + progress * wave.maxScale);
        wave.material.opacity = Math.max(0, 0.9 * (1 - progress));
        if (progress >= 1) wave.mesh.visible = false;
      }
      for (const puff of puffs) {
        if (!puff.sprite.visible) continue;
        puff.ageSec += dtSec;
        const progress = puff.ageSec / puff.lifeSec;
        puff.sprite.position.x += puff.vx * dtSec;
        puff.sprite.position.y += puff.vy * dtSec;
        puff.sprite.position.z += puff.vz * dtSec;
        puff.sprite.scale.setScalar(puff.size * (0.6 + progress));
        puff.material.opacity = Math.max(0, (1 - progress) * 0.8);
        puff.material.color.setScalar(puff.tint);
        if (progress >= 1) puff.sprite.visible = false;
      }
      shake = Math.max(0, shake - dtSec * 1.4);
    },
    getShake: () => shake,
    clear() {
      sparkLife.fill(0);
      fireballs.forEach((fireball) => { fireball.sprite.visible = false; });
      waves.forEach((wave) => { wave.mesh.visible = false; });
      puffs.forEach((puff) => { puff.sprite.visible = false; });
      shake = 0;
      lastWarnedRoofId = 0;
    },
    dispose() {
      scene.remove(group);
      [fireTexture, smokeTexture, waveGeometry, sparkGeometry, sparkMaterial].forEach((resource) => resource.dispose());
      fireballs.forEach((fireball) => fireball.material.dispose());
      waves.forEach((wave) => wave.material.dispose());
      puffs.forEach((puff) => puff.material.dispose());
    },
  };
}
