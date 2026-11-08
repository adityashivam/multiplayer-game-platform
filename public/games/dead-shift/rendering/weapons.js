import * as THREE from "three";
import { DEAD_SHIFT_WEAPONS } from "../shared/config.js";
import { createStaticMeshBuilder } from "./resources.js";

/** Every weapon has its own authored geometry, while all finishes are shared. */
function buildWeaponModel(resources, materials, weaponIndex) {
  const group = new THREE.Group();
  const shapes = createStaticMeshBuilder(resources, { beveled: true });
  const { metal, edge, black, tan, wood, green, red, yellow, lens } = materials;
  const barrel = (position, diameter, length, material = metal) => {
    shapes.cylinder(material, position, [diameter, length, diameter], [Math.PI / 2, 0, 0]);
  };
  const box = (material, position, scale, rotation) => shapes.box(material, position, scale, rotation);

  if (weaponIndex === 0) {
    box(metal, [0, 0.015, -0.07], [0.13, 0.14, 0.43]);
    box(black, [0, 0.04, -0.43], [0.12, 0.12, 0.34]);
    box(tan, [0, -0.025, -0.39], [0.14, 0.08, 0.33]);
    barrel([0, 0.025, -0.68], 0.037, 0.26, edge);
    barrel([0, 0.025, -0.835], 0.064, 0.075, black);
    box(tan, [0, 0.005, 0.22], [0.13, 0.13, 0.26]);
    box(black, [0, -0.015, 0.36], [0.15, 0.19, 0.045]);
    box(black, [0, -0.14, 0.02], [0.076, 0.21, 0.09], [-0.25, 0, 0]);
    box(metal, [0, -0.17, -0.17], [0.084, 0.25, 0.13], [0.17, 0, 0]);
    box(tan, [0, -0.29, -0.19], [0.091, 0.045, 0.15], [0.17, 0, 0]);
    box(edge, [0.07, 0.033, -0.02], [0.014, 0.043, 0.11]);
    box(black, [0.079, 0.032, -0.02], [0.012, 0.022, 0.082]);
    box(black, [0, 0.105, -0.1], [0.07, 0.04, 0.18]);
    box(metal, [-0.042, 0.16, -0.1], [0.02, 0.1, 0.1]);
    box(metal, [0.042, 0.16, -0.1], [0.02, 0.1, 0.1]);
    box(metal, [0, 0.21, -0.1], [0.1, 0.018, 0.1]);
    box(lens, [0, 0.163, -0.14], [0.067, 0.065, 0.008]);
    box(red, [0, 0.162, -0.145], [0.008, 0.008, 0.01]);
    box(black, [0, 0.12, -0.58], [0.03, 0.085, 0.025]);
    for (let index = 0; index < 7; index += 1) {
      box(edge, [0, 0.113, -0.25 - index * 0.043], [0.12, 0.017, 0.018]);
      box(black, [0.076, 0.005, -0.26 - index * 0.043], [0.012, 0.037, 0.018]);
    }
  } else if (weaponIndex === 1) {
    box(black, [0, 0.015, -0.14], [0.145, 0.155, 0.43]);
    box(metal, [0, 0.082, -0.18], [0.13, 0.045, 0.35]);
    barrel([0, 0.028, -0.45], 0.05, 0.22, edge);
    barrel([0, 0.028, -0.57], 0.087, 0.12, black);
    box(black, [0, -0.17, -0.06], [0.075, 0.31, 0.12], [-0.12, 0, 0]);
    box(metal, [0, -0.34, -0.075], [0.085, 0.055, 0.13]);
    box(black, [0, -0.135, 0.08], [0.075, 0.19, 0.09], [-0.22, 0, 0]);
    box(black, [0, -0.12, -0.33], [0.065, 0.16, 0.08]);
    for (const side of [-1, 1]) {
      box(edge, [side * 0.045, 0.02, 0.2], [0.018, 0.028, 0.3]);
    }
    box(black, [0, -0.015, 0.35], [0.14, 0.18, 0.035]);
    box(red, [0.077, 0.06, -0.11], [0.008, 0.021, 0.08]);
    for (let index = 0; index < 5; index += 1) {
      box(edge, [0, 0.112, -0.1 - index * 0.048], [0.105, 0.018, 0.018]);
      box(metal, [0.077, 0.015, -0.18 - index * 0.035], [0.008, 0.04, 0.014]);
    }
    box(metal, [0, 0.145, -0.31], [0.09, 0.055, 0.028]);
    box(black, [0, 0.151, -0.31], [0.06, 0.026, 0.035]);
  } else if (weaponIndex === 2) {
    box(metal, [0, 0.005, -0.1], [0.135, 0.15, 0.38]);
    barrel([0, 0.055, -0.62], 0.066, 0.76, edge);
    barrel([0, -0.03, -0.55], 0.053, 0.68, metal);
    barrel([0, 0.055, -1.015], 0.079, 0.045, black);
    box(wood, [0, -0.025, -0.47], [0.17, 0.12, 0.28]);
    for (let index = 0; index < 7; index += 1) {
      box(black, [0, -0.032, -0.35 - index * 0.039], [0.176, 0.025, 0.013]);
    }
    box(wood, [0, -0.06, 0.23], [0.12, 0.16, 0.36], [-0.15, 0, 0]);
    box(black, [0, -0.09, 0.39], [0.145, 0.21, 0.045]);
    box(wood, [0, -0.15, 0.035], [0.08, 0.17, 0.1], [-0.38, 0, 0]);
    box(black, [0.076, 0.01, -0.09], [0.02, 0.08, 0.21]);
    for (let index = 0; index < 4; index += 1) {
      shapes.cylinder(red, [0.093, 0.02, -0.19 + index * 0.055], [0.035, 0.105, 0.035]);
      shapes.cylinder(yellow, [0.093, -0.027, -0.19 + index * 0.055], [0.038, 0.018, 0.038]);
    }
    box(red, [0, 0.105, -0.91], [0.016, 0.022, 0.018]);
  } else if (weaponIndex === 3) {
    box(metal, [0, 0.015, -0.12], [0.16, 0.16, 0.4]);
    barrel([0, 0.01, -0.5], 0.13, 0.39, black);
    barrel([0, 0.01, -0.71], 0.16, 0.08, edge);
    barrel([0, -0.15, -0.15], 0.31, 0.25, metal);
    for (let index = 0; index < 6; index += 1) {
      const angle = index / 6 * Math.PI * 2;
      barrel([Math.cos(angle) * 0.118, -0.15 + Math.sin(angle) * 0.118, -0.154], 0.075, 0.27, black);
      barrel([Math.cos(angle) * 0.118, -0.15 + Math.sin(angle) * 0.118, -0.005], 0.055, 0.022, yellow);
    }
    box(tan, [0, -0.035, 0.21], [0.14, 0.14, 0.28]);
    box(black, [0, -0.065, 0.35], [0.17, 0.22, 0.045]);
    box(black, [0, -0.15, 0.04], [0.08, 0.19, 0.1], [-0.28, 0, 0]);
    box(tan, [0, -0.12, -0.46], [0.11, 0.12, 0.16]);
    box(yellow, [0.084, 0.04, -0.22], [0.012, 0.035, 0.12]);
    box(metal, [0.095, 0.19, -0.28], [0.035, 0.26, 0.06]);
    box(edge, [0.04, 0.31, -0.28], [0.12, 0.025, 0.06]);
    box(black, [0, 0.13, -0.05], [0.08, 0.08, 0.06]);
  } else {
    barrel([0, 0.04, -0.22], 0.23, 1.23, green);
    barrel([0, 0.04, -0.86], 0.285, 0.12, black);
    barrel([0, 0.04, 0.41], 0.285, 0.12, metal);
    barrel([0, 0.04, 0.48], 0.23, 0.025, black);
    barrel([0, 0.04, -0.93], 0.22, 0.025, black);
    barrel([0, 0.04, -0.927], 0.16, 0.028, yellow);
    for (const z of [-0.57, -0.36, 0.18]) {
      barrel([0, 0.04, z], 0.25, 0.05, metal);
    }
    box(black, [0, -0.18, 0.03], [0.09, 0.28, 0.12], [-0.22, 0, 0]);
    box(black, [0, -0.16, -0.48], [0.09, 0.19, 0.12]);
    box(black, [0, -0.13, 0.27], [0.27, 0.09, 0.26]);
    box(green, [0.18, 0.16, -0.04], [0.12, 0.15, 0.27]);
    barrel([0.18, 0.17, -0.2], 0.1, 0.12, black);
    barrel([0.18, 0.17, -0.27], 0.078, 0.025, lens);
    box(yellow, [0.121, 0.04, -0.1], [0.009, 0.06, 0.29]);
    for (let index = 0; index < 3; index += 1) {
      box(black, [0.128, 0.04, -0.21 + index * 0.09], [0.008, 0.067, 0.034], [Math.PI / 7, 0, 0]);
    }
  }

  // Trigger guard and fasteners create legible close-range material detail.
  if (weaponIndex !== 4) {
    box(edge, [0, -0.13, -0.025], [0.02, 0.019, 0.15]);
    box(edge, [0, -0.095, -0.09], [0.02, 0.08, 0.017]);
    box(black, [0, -0.088, -0.027], [0.02, 0.06, 0.025], [0.25, 0, 0]);
  }
  for (const z of [-0.19, 0.015]) {
    shapes.cylinder(edge, [0.079, 0.015, z], [0.014, 0.012, 0.014], [0, 0, Math.PI / 2]);
  }
  shapes.finish(group, { shadows: false });
  return group;
}

function createGlovedArms(resources, materials) {
  const group = new THREE.Group();
  const shapes = createStaticMeshBuilder(resources, { beveled: true });
  shapes.box(materials.cloth, [0.12, -0.24, 0.2], [0.14, 0.18, 0.42], [-0.5, -0.18, -0.14]);
  shapes.box(materials.black, [0.035, -0.15, 0.045], [0.11, 0.19, 0.12], [-0.28, 0, -0.12]);
  shapes.box(materials.cloth, [-0.24, -0.28, -0.16], [0.14, 0.17, 0.53], [-0.28, -0.5, 0.22]);
  shapes.box(materials.black, [-0.085, -0.105, -0.4], [0.12, 0.13, 0.2], [-0.16, 0.12, -0.16]);
  shapes.box(materials.edge, [-0.12, -0.045, -0.4], [0.12, 0.025, 0.11], [0, 0, -0.17]);
  for (let index = 0; index < 4; index += 1) {
    shapes.box(materials.black, [-0.04, -0.065 - index * 0.027, -0.42], [0.1, 0.022, 0.05]);
    shapes.box(materials.black, [-0.025, -0.105 - index * 0.028, 0.014], [0.07, 0.024, 0.06]);
  }
  shapes.finish(group, { shadows: false });
  return group;
}

/**
 * Owns the isolated foreground scene. The render loop calls update; firing
 * feedback is locally rate limited and confirmed shot IDs never retrigger it.
 * @param {import("./resources.js").DeadShiftRenderResources} resources
 */
export function createFirstPersonWeapons(resources) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(63, 1, 0.02, 5);
  const standard = (options) => resources.ownMaterial(new THREE.MeshStandardMaterial(options));
  const materials = {
    metal: standard({ color: 0x334650, metalness: 0.86, roughness: 0.29 }),
    edge: standard({ color: 0x657f85, metalness: 0.9, roughness: 0.26 }),
    black: standard({ color: 0x102027, metalness: 0.25, roughness: 0.6 }),
    tan: standard({ color: 0x8f8b64, metalness: 0.12, roughness: 0.66 }),
    wood: standard({ color: 0x774c2e, metalness: 0.05, roughness: 0.65 }),
    green: standard({ color: 0x586449, metalness: 0.48, roughness: 0.48 }),
    red: standard({ color: 0xc9422b, emissive: 0x6c190e, emissiveIntensity: 0.35, roughness: 0.5 }),
    yellow: standard({ color: 0xc8ae5d, roughness: 0.58, metalness: 0.25 }),
    cloth: standard({ color: 0x375052, roughness: 0.92 }),
    lens: standard({ color: 0x4e9c92, emissive: 0x134c46, emissiveIntensity: 0.6, roughness: 0.12, metalness: 0.8 }),
  };
  const weaponRoot = new THREE.Group();
  scene.add(weaponRoot);
  const models = DEAD_SHIFT_WEAPONS.map((weapon, index) => {
    const model = buildWeaponModel(resources, materials, index);
    model.visible = index === 0;
    weaponRoot.add(model);
    return model;
  });
  const arms = createGlovedArms(resources, materials);
  weaponRoot.add(arms);
  scene.add(new THREE.HemisphereLight(0xb6d7d7, 0x1f2e29, 2.2));
  const keyLight = new THREE.DirectionalLight(0xb8ded6, 3.3);
  keyLight.position.set(-2, 3, 2);
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0xffab6b, 2.1);
  rimLight.position.set(2, 0.2, -3);
  scene.add(rimLight);
  const muzzleLight = new THREE.PointLight(0xffb35f, 0, 2.5, 2);
  muzzleLight.position.set(0, 0.02, -0.8);
  weaponRoot.add(muzzleLight);
  const flashMaterial = resources.ownMaterial(new THREE.MeshBasicMaterial({ color: 0xffd99c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  const flash = new THREE.Mesh(resources.sphere, flashMaterial);
  weaponRoot.add(flash);
  const flareMaterial = resources.ownMaterial(new THREE.MeshBasicMaterial({ color: 0xff9c43, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
  const flare = new THREE.Mesh(resources.plane, flareMaterial);
  weaponRoot.add(flare);
  let weaponIndex = 0;
  let recoil = 0;
  let flashSec = 0;
  let fireCooldownSec = 0;
  let switchSec = 0;
  let lastShotId = 0;
  let bobPhase = 0;
  let predictedShots = 0;

  return {
    scene,
    camera,
    resetRound() {
      recoil = 0;
      flashSec = 0;
      fireCooldownSec = 0;
      switchSec = 0;
      lastShotId = 0;
      predictedShots = 0;
    },
    resize(width, height) {
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
    update({ localPlayer, input, dtSec, timeSec, moving, reducedMotion, roundId }) {
      const nextWeapon = Math.max(0, Math.min(models.length - 1, Math.round(input?.weapon ?? localPlayer.weapon ?? 0)));
      if (nextWeapon !== weaponIndex) {
        models[weaponIndex].visible = false;
        models[nextWeapon].visible = true;
        weaponIndex = nextWeapon;
        switchSec = 0.2;
        predictedShots = 0;
      }
      const definition = DEAD_SHIFT_WEAPONS[weaponIndex];
      const dead = localPlayer.health <= 0 || localPlayer.respawnRemaining > 0;
      scene.visible = !dead;
      const reloading = localPlayer.reloadRemaining > 0;
      const fire = Boolean(input?.fire);
      const hasAuthority = roundId !== null;
      let fired = false;
      fireCooldownSec = Math.max(0, fireCooldownSec - dtSec);

      const confirmedShots = hasAuthority ? Math.max(0, (localPlayer.shotId || 0) - lastShotId) : 0;
      if (confirmedShots > 0) {
        if (fire && !dead && !predictedShots && fireCooldownSec <= 0) fired = true;
        predictedShots = Math.max(0, predictedShots - confirmedShots);
        lastShotId = localPlayer.shotId;
      }
      if (hasAuthority && !dead && !reloading && fire && localPlayer.ammo > 0 && fireCooldownSec <= 0) {
        fired = true;
        predictedShots = Math.min(8, predictedShots + 1);
        fireCooldownSec = definition.fireIntervalSec;
      }
      if (fired) {
        recoil = weaponIndex >= 2 ? 1 : weaponIndex === 1 ? 0.45 : 0.65;
        flashSec = 0.055;
      }
      recoil *= Math.exp(-dtSec * 14);
      flashSec = Math.max(0, flashSec - dtSec);
      switchSec = Math.max(0, switchSec - dtSec);
      bobPhase += dtSec * (input?.sprint ? 12 : 8.6) * (moving ? 1 : 0.2);
      const movementScale = reducedMotion ? 0 : moving ? 1 : 0.12;
      const reloadProgress = reloading ? 1 - Math.min(1, localPlayer.reloadRemaining / definition.reloadSec) : 0;
      const reloadArc = reloading ? Math.sin(reloadProgress * Math.PI) : 0;
      const narrow = camera.aspect < 1;
      weaponRoot.position.set(narrow ? 0.18 : 0.28, -0.27 + Math.cos(bobPhase * 2) * 0.008 * movementScale - reloadArc * 0.18 - switchSec * 0.8, -0.6 + recoil * 0.055);
      weaponRoot.rotation.set(recoil * (reducedMotion ? 0.018 : 0.08) - reloadArc * 0.37, 0.025 + Math.sin(bobPhase) * 0.008 * movementScale, -0.035 + reloadArc * 0.42);
      arms.position.z = weaponIndex === 2 ? -0.06 : weaponIndex === 4 ? -0.035 : 0;
      arms.rotation.z = reloading ? Math.sin(reloadProgress * Math.PI * 2) * 0.12 : 0;
      const muzzleZ = [-0.86, -0.64, -1.05, -0.77, -0.96][weaponIndex];
      flash.position.set(0, 0.035, muzzleZ);
      flare.position.copy(flash.position);
      const flashScale = weaponIndex === 2 ? 0.27 : weaponIndex >= 3 ? 0.32 : 0.16;
      flash.scale.set(flashScale, flashScale * 0.6, flashScale * 1.5);
      flare.scale.set(flashScale * 2.6, flashScale * 0.5, 1);
      flare.rotation.z = timeSec * 47;
      flashMaterial.opacity = flashSec > 0 ? 0.9 : 0;
      flareMaterial.opacity = flashSec > 0 ? 0.7 : 0;
      muzzleLight.intensity = flashSec > 0 ? 18 : 0;
      return { fired, weaponIndex };
    },
    dispose() {
      scene.clear();
      weaponRoot.clear();
      models.length = 0;
      arms.clear();
    },
  };
}
