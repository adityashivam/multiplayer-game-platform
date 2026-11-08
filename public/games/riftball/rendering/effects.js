import * as THREE from "three";
import { RIFTBALL_ACTION_SETTINGS, RIFTBALL_COURT, RIFTBALL_TEAM_COLORS } from "../shared/config.js";
import { createRiftballTrailHistory } from "./presentation.js";
import { createRiftballContactTexture, createRiftballVisualRandom } from "./resources.js";

const MAXIMUM_IMPACT_PARTICLES = 72;
const MAXIMUM_MOTES = 54;

/**
 * Physical ball, soft contact shadow, bounded trail and impact pools. Events are
 * observed through identities; effects never invent a contact or mutate state.
 * @param {THREE.Scene} scene
 * @param {ReturnType<import("./resources.js").createRiftballResources>} resources
 */
export function createRiftballEffects(scene, resources) {
  const effects = new THREE.Group();
  effects.name = "riftball-effects";
  scene.add(effects);
  const ballGroup = new THREE.Group();
  ballGroup.name = "riftball-energy-ball";
  const ballMaterial = resources.ownMaterial(new THREE.MeshStandardMaterial({ color: "#fff3cd", emissive: "#ffe8ad", emissiveIntensity: 0.62, roughness: 0.3, metalness: 0.3 }));
  const ballMesh = new THREE.Mesh(resources.ownGeometry(new THREE.IcosahedronGeometry(RIFTBALL_COURT.ballRadius, 3)), ballMaterial);
  ballMesh.castShadow = true;
  ballMesh.receiveShadow = true;
  ballGroup.add(ballMesh);
  const seamMaterial = resources.ownMaterial(new THREE.MeshStandardMaterial({ color: "#354d59", metalness: 0.65, roughness: 0.3 }));
  const seamGeometry = resources.ownGeometry(new THREE.TorusGeometry(RIFTBALL_COURT.ballRadius + 0.001, 0.019, 5, 40));
  for (let ringIndex = 0; ringIndex < 3; ringIndex += 1) {
    const seam = new THREE.Mesh(seamGeometry, seamMaterial);
    if (ringIndex === 1) seam.rotation.x = Math.PI / 2;
    if (ringIndex === 2) seam.rotation.y = Math.PI / 2;
    ballGroup.add(seam);
  }
  effects.add(ballGroup);
  const ballGlow = new THREE.PointLight("#ffe6b6", 2, 4.2, 2);
  effects.add(ballGlow);
  const shadowMaterial = resources.ownMaterial(new THREE.MeshBasicMaterial({ map: createRiftballContactTexture(resources), transparent: true, depthWrite: false, opacity: 0.8, polygonOffset: true, polygonOffsetFactor: -2 }));
  const ballShadow = new THREE.Mesh(resources.plane, shadowMaterial);
  ballShadow.rotation.x = -Math.PI / 2;
  ballShadow.renderOrder = 1;
  effects.add(ballShadow);

  const trail = createRiftballTrailHistory();
  const trailMaterial = resources.ownMaterial(new THREE.MeshBasicMaterial({ color: "#ffe9b5", transparent: true, opacity: 0.19, depthWrite: false, blending: THREE.AdditiveBlending }));
  const trailMesh = new THREE.InstancedMesh(resources.ownGeometry(new THREE.SphereGeometry(1, 8, 6)), trailMaterial, 24);
  trailMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  trailMesh.frustumCulled = false;
  trailMesh.count = 0;
  effects.add(trailMesh);

  const impactMaterial = resources.ownMaterial(new THREE.MeshBasicMaterial({ color: "#fff6cf", transparent: true, opacity: 0.85, depthWrite: false }));
  const impactMesh = new THREE.InstancedMesh(resources.ownGeometry(new THREE.IcosahedronGeometry(1, 0)), impactMaterial, MAXIMUM_IMPACT_PARTICLES);
  impactMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  impactMesh.frustumCulled = false;
  impactMesh.count = 0;
  effects.add(impactMesh);
  const impactParticles = Array.from({ length: MAXIMUM_IMPACT_PARTICLES }, () => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, remainingSec: 0, durationSec: 0.4, scale: 0.04 }));
  const impactRandom = createRiftballVisualRandom(601);
  const transform = new THREE.Object3D();
  const goalRings = RIFTBALL_TEAM_COLORS.map((color, goalIndex) => {
    const ringMaterial = resources.ownMaterial(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
    const ringMesh = new THREE.Mesh(resources.ownGeometry(new THREE.RingGeometry(0.96, 1, 64)), ringMaterial);
    ringMesh.rotation.x = -Math.PI / 2;
    ringMesh.position.set(0, 0.035, (goalIndex === 0 ? 1 : -1) * (RIFTBALL_COURT.halfLength - 0.9));
    ringMesh.visible = false;
    effects.add(ringMesh);
    return { mesh: ringMesh, material: ringMaterial, remainingSec: 0 };
  });
  const aimMaterial = resources.ownMaterial(new THREE.MeshBasicMaterial({ color: "#d4fff5", transparent: true, opacity: 0.4, depthWrite: false, side: THREE.DoubleSide }));
  const aimGuide = new THREE.Group();
  for (let dashIndex = 0; dashIndex < 5; dashIndex += 1) {
    const dash = new THREE.Mesh(resources.box, aimMaterial);
    dash.position.set(0, 0, 1.0 + dashIndex * 0.4);
    dash.scale.set(0.045, 0.008, 0.2);
    aimGuide.add(dash);
  }
  const aimHead = new THREE.Mesh(resources.ownGeometry(new THREE.ConeGeometry(0.16, 0.36, 3)), aimMaterial);
  aimHead.rotation.x = Math.PI / 2;
  aimHead.position.z = 3.13;
  aimHead.scale.z = 0.035;
  aimGuide.add(aimHead);
  aimGuide.visible = false;
  effects.add(aimGuide);

  const motePositions = new Float32Array(MAXIMUM_MOTES * 3);
  const moteOrigins = new Float32Array(MAXIMUM_MOTES * 3);
  const moteRandom = createRiftballVisualRandom(771);
  for (let moteIndex = 0; moteIndex < MAXIMUM_MOTES; moteIndex += 1) {
    moteOrigins[moteIndex * 3] = (moteRandom() * 2 - 1) * 9;
    moteOrigins[moteIndex * 3 + 1] = 2 + moteRandom() * 7;
    moteOrigins[moteIndex * 3 + 2] = (moteRandom() * 2 - 1) * 16;
  }
  const moteGeometry = resources.ownGeometry(new THREE.BufferGeometry());
  moteGeometry.setAttribute("position", new THREE.BufferAttribute(motePositions, 3));
  const moteMaterial = resources.ownMaterial(new THREE.PointsMaterial({ color: "#c8dacc", size: 0.025, transparent: true, opacity: 0.27, depthWrite: false, sizeAttenuation: true }));
  const motes = new THREE.Points(moteGeometry, moteMaterial);
  motes.frustumCulled = false;
  effects.add(motes);

  let particleLimit = MAXIMUM_IMPACT_PARTICLES;
  let reducedEffects = false;
  let previousRoundId = null;
  let previousServeId = null;
  let previousHitSerial = null;
  let previousBounceSerial = null;
  let previousGoalSerial = null;
  let activeParticleCount = 0;

  function resetTransientEffects() {
    trail.reset();
    trailMesh.count = 0;
    impactMesh.count = 0;
    activeParticleCount = 0;
    for (const particle of impactParticles) particle.remainingSec = 0;
    for (const goalRing of goalRings) {
      goalRing.remainingSec = 0;
      goalRing.mesh.visible = false;
    }
  }

  function emitImpactParticles(ball, strongContact) {
    const burstCount = Math.min(particleLimit, strongContact ? 18 : 7);
    let emittedCount = 0;
    for (const particle of impactParticles) {
      if (emittedCount >= burstCount) break;
      if (particle.remainingSec > 0) continue;
      const angle = impactRandom() * Math.PI * 2;
      const speed = (strongContact ? 3.5 : 1.8) + impactRandom() * 2.5;
      particle.x = ball.x;
      particle.y = ball.y;
      particle.z = ball.z;
      particle.vx = Math.sin(angle) * speed;
      particle.vy = 0.8 + impactRandom() * 3;
      particle.vz = Math.cos(angle) * speed;
      particle.durationSec = 0.24 + impactRandom() * 0.16;
      particle.remainingSec = particle.durationSec;
      particle.scale = (strongContact ? 0.052 : 0.032) + impactRandom() * 0.028;
      emittedCount += 1;
    }
  }

  return {
    update(frame) {
      const ball = frame.ball;
      if (!ball) {
        ballGroup.visible = false;
        ballShadow.visible = false;
        ballGlow.visible = false;
        resetTransientEffects();
        return;
      }
      const dtSec = Math.max(0, Math.min(0.06, frame.dtSec || 0));
      const reset = previousRoundId !== frame.roundId || previousServeId !== ball.serveId;
      if (reset) resetTransientEffects();
      const hitChanged = !reset && previousHitSerial != null && previousHitSerial !== ball.hitSerial;
      const bounceChanged = !reset && previousBounceSerial != null && previousBounceSerial !== ball.bounceSerial;
      if (!frame.reducedMotion && (hitChanged || bounceChanged)) emitImpactParticles(ball, hitChanged);
      if (!reset && previousGoalSerial != null && previousGoalSerial !== frame.goalSerial && frame.lastScorer && !frame.reducedMotion) {
        goalRings[frame.lastScorer === "p1" ? 1 : 0].remainingSec = 0.75;
      }

      ballGroup.visible = true;
      ballGroup.position.set(ball.x, ball.y, ball.z);
      if (!frame.reducedMotion) {
        ballGroup.rotation.x += (ball.vz || 0) * dtSec / RIFTBALL_COURT.ballRadius;
        ballGroup.rotation.z -= (ball.vx || 0) * dtSec / RIFTBALL_COURT.ballRadius;
      }
      ballGlow.visible = !reducedEffects;
      ballGlow.position.copy(ballGroup.position);
      ballShadow.visible = true;
      ballShadow.position.set(ball.x, 0.025, ball.z);
      const ballAltitude = Math.max(0, ball.y - RIFTBALL_COURT.ballRadius);
      const shadowScale = Math.min(2.7, 1.45 + ballAltitude * 0.16);
      ballShadow.scale.set(shadowScale, shadowScale, 1);
      shadowMaterial.opacity = Math.max(0.22, 0.82 - ballAltitude * 0.07);
      trail.update(ball, dtSec, { roundId: frame.roundId, reducedMotion: frame.reducedMotion, limit: reducedEffects ? 8 : 24 });
      trailMesh.count = trail.getCount();
      for (let sampleIndex = 0; sampleIndex < trailMesh.count; sampleIndex += 1) {
        const sample = trail.getSample(sampleIndex);
        const lifeRatio = Math.max(0, 1 - sample.ageSec / 0.2);
        const scale = RIFTBALL_COURT.ballRadius * lifeRatio * 0.75;
        transform.position.set(sample.x, sample.y, sample.z);
        transform.scale.setScalar(scale);
        transform.rotation.set(0, 0, 0);
        transform.updateMatrix();
        trailMesh.setMatrixAt(sampleIndex, transform.matrix);
      }
      trailMesh.instanceMatrix.needsUpdate = trailMesh.count > 0;

      activeParticleCount = 0;
      for (const particle of impactParticles) {
        if (frame.reducedMotion || activeParticleCount >= particleLimit) particle.remainingSec = 0;
        if (particle.remainingSec <= 0) continue;
        particle.remainingSec = Math.max(0, particle.remainingSec - dtSec);
        particle.x += particle.vx * dtSec;
        particle.y = Math.max(0.04, particle.y + particle.vy * dtSec);
        particle.z += particle.vz * dtSec;
        particle.vy -= dtSec * 7;
        const lifeRatio = particle.remainingSec / particle.durationSec;
        transform.position.set(particle.x, particle.y, particle.z);
        transform.scale.setScalar(particle.scale * lifeRatio);
        transform.rotation.set(particle.x, particle.z, particle.y);
        transform.updateMatrix();
        impactMesh.setMatrixAt(activeParticleCount, transform.matrix);
        activeParticleCount += 1;
      }
      impactMesh.count = activeParticleCount;
      impactMesh.instanceMatrix.needsUpdate = activeParticleCount > 0;
      for (const goalRing of goalRings) {
        goalRing.remainingSec = frame.reducedMotion ? 0 : Math.max(0, goalRing.remainingSec - dtSec);
        const lifeRatio = goalRing.remainingSec / 0.75;
        goalRing.mesh.visible = lifeRatio > 0;
        goalRing.mesh.scale.setScalar(1.5 + (1 - lifeRatio) * 4.2);
        goalRing.material.opacity = lifeRatio * 0.6;
      }

      const players = Array.isArray(frame.players) ? frame.players : Object.values(frame.players || {});
      const localPlayer = players.find((playerState) => playerState.id === frame.playerId);
      aimGuide.visible = Boolean(localPlayer && localPlayer.action === "charge");
      if (aimGuide.visible) {
        aimGuide.position.set(localPlayer.x, 0.035, localPlayer.z);
        aimGuide.rotation.y = localPlayer.facing || 0;
        const chargeRatio = Math.min(1, (localPlayer.chargeSec || 0) / RIFTBALL_ACTION_SETTINGS.maxChargeSec);
        aimGuide.scale.set(1, 1, 0.7 + chargeRatio * 0.6);
        aimMaterial.opacity = 0.3 + chargeRatio * 0.24;
      }
      motes.visible = !reducedEffects && !frame.reducedMotion;
      if (motes.visible) {
        const timeSec = frame.timeSec || 0;
        for (let moteIndex = 0; moteIndex < MAXIMUM_MOTES; moteIndex += 1) {
          const offset = moteIndex * 3;
          motePositions[offset] = moteOrigins[offset] + Math.sin(timeSec * 0.12 + moteIndex) * 0.22;
          motePositions[offset + 1] = moteOrigins[offset + 1] + Math.sin(timeSec * 0.17 + moteIndex * 0.31) * 0.17;
          motePositions[offset + 2] = moteOrigins[offset + 2] + Math.cos(timeSec * 0.1 + moteIndex) * 0.25;
        }
        moteGeometry.attributes.position.needsUpdate = true;
      }
      previousRoundId = frame.roundId;
      previousServeId = ball.serveId;
      previousHitSerial = ball.hitSerial;
      previousBounceSerial = ball.bounceSerial;
      previousGoalSerial = frame.goalSerial;
    },
    setQuality(quality) {
      particleLimit = Math.min(MAXIMUM_IMPACT_PARTICLES, quality.particleLimit);
      reducedEffects = quality.reducedEffects;
    },
    getStats() {
      return { particles: activeParticleCount, trailSamples: trail.getCount(), motes: motes.visible ? MAXIMUM_MOTES : 0 };
    },
    dispose() {
      resetTransientEffects();
      trailMesh.dispose();
      impactMesh.dispose();
      scene.remove(effects);
    },
  };
}
