import * as THREE from "three";
import { DEAD_SHIFT_ARENA, DEAD_SHIFT_COLLIDERS } from "../shared/config.js";
import { createLabelTexture, createStaticMeshBuilder, createSurfaceTexture, createVisualRandom } from "./resources.js";

/**
 * Builds a fixed, meter-scaled room whose cover exactly follows shared collision.
 * @param {THREE.Scene} scene
 * @param {import("./resources.js").DeadShiftRenderResources} resources
 */
export function createContainmentArena(scene, resources) {
  const architecture = new THREE.Group();
  architecture.name = "Containment chamber";
  scene.add(architecture);
  const staticMeshes = createStaticMeshBuilder(resources);
  const standard = (options) => resources.ownMaterial(new THREE.MeshStandardMaterial(options));
  const basic = (options) => resources.ownMaterial(new THREE.MeshBasicMaterial(options));
  const floorTexture = createSurfaceTexture(resources, "floor");
  const concreteTexture = createSurfaceTexture(resources, "concrete");
  const materials = {
    floor: standard({ color: 0x536565, map: floorTexture, roughness: 0.35, metalness: 0.48 }),
    wall: standard({ color: 0x5d7470, map: concreteTexture, roughness: 0.94, metalness: 0.06 }),
    darkWall: standard({ color: 0x263a3c, roughness: 0.85, metalness: 0.2 }),
    steel: standard({ color: 0x35494d, roughness: 0.36, metalness: 0.82 }),
    edge: standard({ color: 0x748780, roughness: 0.42, metalness: 0.84 }),
    black: standard({ color: 0x0b1519, roughness: 0.56, metalness: 0.55 }),
    rust: standard({ color: 0x5f3c2d, roughness: 0.87, metalness: 0.45 }),
    yellow: standard({ color: 0xb39c4d, roughness: 0.68, metalness: 0.28 }),
    crate: standard({ color: 0x3c4e43, roughness: 0.7, metalness: 0.45 }),
    cream: standard({ color: 0xb0b5a1, roughness: 0.86, metalness: 0.12 }),
    red: standard({ color: 0x4e201a, roughness: 0.7, metalness: 0.55 }),
    cyanGlow: standard({ color: 0x7dddd3, emissive: 0x55c9bf, emissiveIntensity: 2.4, roughness: 0.22 }),
    warmGlow: standard({ color: 0xffb767, emissive: 0xff8b35, emissiveIntensity: 3.3, roughness: 0.3 }),
    redGlow: standard({ color: 0xed432c, emissive: 0xc6240d, emissiveIntensity: 3, roughness: 0.3 }),
    glass: standard({ color: 0x31645c, emissive: 0x092c23, emissiveIntensity: 0.9, metalness: 0.56, roughness: 0.2, transparent: true, opacity: 0.65 }),
    water: standard({ color: 0x193536, metalness: 0.92, roughness: 0.13, transparent: true, opacity: 0.58 }),
    blood: standard({ color: 0x321b17, roughness: 0.36, metalness: 0.1, transparent: true, opacity: 0.72 }),
  };
  const halfWidth = DEAD_SHIFT_ARENA.halfWidth;
  const halfDepth = DEAD_SHIFT_ARENA.halfDepth;
  const ceilingHeight = DEAD_SHIFT_ARENA.height;
  const roomWidth = halfWidth * 2;
  const roomDepth = halfDepth * 2;

  staticMeshes.box(materials.floor, [0, -0.15, 0], [roomWidth, 0.3, roomDepth]);
  staticMeshes.box(materials.darkWall, [0, ceilingHeight + 0.1, 0], [roomWidth, 0.3, roomDepth]);
  staticMeshes.box(materials.wall, [0, ceilingHeight / 2, -halfDepth - 0.15], [roomWidth + 0.5, ceilingHeight, 0.3]);
  staticMeshes.box(materials.wall, [0, ceilingHeight / 2, halfDepth + 0.15], [roomWidth + 0.5, ceilingHeight, 0.3]);
  for (const side of [-1, 1]) {
    staticMeshes.box(materials.wall, [side * (halfWidth + 0.15), ceilingHeight / 2, 0], [0.3, ceilingHeight, roomDepth]);
    staticMeshes.box(materials.black, [0, 1.35, side * (halfDepth - 0.05)], [roomWidth, 0.15, 0.13]);
    staticMeshes.box(materials.steel, [side * (halfWidth - 0.1), 0.35, 0], [0.18, 0.7, roomDepth]);
    staticMeshes.box(materials.steel, [0, 0.35, side * (halfDepth - 0.1)], [roomWidth, 0.7, 0.18]);
  }

  for (let x = -12; x <= 12; x += 8) {
    for (const side of [-1, 1]) {
      staticMeshes.box(materials.steel, [x, ceilingHeight / 2, side * 11.7], [0.4, ceilingHeight, 0.45]);
      staticMeshes.box(materials.edge, [x - 0.23, ceilingHeight / 2, side * 11.48], [0.07, ceilingHeight, 0.12]);
      staticMeshes.box(materials.black, [x, 0.25, side * 11.65], [0.9, 0.5, 0.8]);
    }
    staticMeshes.box(materials.steel, [x, ceilingHeight - 0.5, 0], [0.35, 0.65, roomDepth]);
    for (let z = -9; z <= 9; z += 6) {
      staticMeshes.box(materials.black, [x, ceilingHeight - 0.83, z], [1.7, 0.18, 0.66]);
      staticMeshes.box(materials.cyanGlow, [x, ceilingHeight - 0.94, z], [1.35, 0.045, 0.22]);
      staticMeshes.box(materials.edge, [x - 0.55, ceilingHeight - 0.7, z], [0.06, 0.25, 0.65]);
      staticMeshes.box(materials.edge, [x + 0.55, ceilingHeight - 0.7, z], [0.06, 0.25, 0.65]);
    }
  }

  // An observation gallery gives the chamber a human scale above the fight.
  for (const side of [-1, 1]) {
    const z = side * 10.8;
    staticMeshes.box(materials.black, [0, 4.6, z], [roomWidth - 0.6, 0.18, 1.7]);
    staticMeshes.box(materials.edge, [0, 4.52, z - side * 0.85], [roomWidth - 0.5, 0.13, 0.12]);
    staticMeshes.box(materials.steel, [0, 5.65, z - side * 0.85], [roomWidth - 0.6, 0.075, 0.075]);
    staticMeshes.box(materials.steel, [0, 5.12, z - side * 0.85], [roomWidth - 0.6, 0.045, 0.045]);
    for (let x = -14; x <= 14; x += 2) {
      staticMeshes.box(materials.steel, [x, 5.1, z - side * 0.85], [0.06, 1.12, 0.06]);
      staticMeshes.box(materials.rust, [x, 4.25, z], [0.12, 0.7, 1.4], [0.25 * side, 0, 0]);
    }
  }

  for (let x = -12; x <= 12; x += 8) {
    if (x === 4) continue;
    staticMeshes.box(materials.black, [x, 3.3, -11.7], [4.4, 2.05, 0.18]);
    staticMeshes.box(materials.glass, [x, 3.3, -11.58], [4.1, 1.78, 0.05]);
    for (const offset of [-2.11, 0, 2.11]) {
      staticMeshes.box(materials.steel, [x + offset, 3.3, -11.48], [0.09, 2, 0.08]);
    }
    staticMeshes.box(materials.edge, [x, 4.31, -11.49], [4.4, 0.1, 0.13]);
  }

  // Reinforced quarantine gate, vents and floor tracks.
  staticMeshes.box(materials.black, [3.8, 1.8, -11.75], [4.7, 3.6, 0.4]);
  for (let index = 0; index < 9; index += 1) {
    staticMeshes.box(materials.steel, [3.8, 0.21 + index * 0.37, -11.48], [4.1, 0.32, 0.11]);
  }
  staticMeshes.box(materials.yellow, [1.55, 1.8, -11.45], [0.18, 3.6, 0.16]);
  staticMeshes.box(materials.yellow, [6.05, 1.8, -11.45], [0.18, 3.6, 0.16]);
  staticMeshes.box(materials.redGlow, [3.8, 3.78, -11.5], [2.6, 0.11, 0.18]);
  for (let index = 0; index < 10; index += 1) {
    staticMeshes.box(materials.black, [1.55, 0.12 + index * 0.36, -11.34], [0.23, 0.16, 0.02], [0, 0, -0.5]);
    staticMeshes.box(materials.black, [6.05, 0.12 + index * 0.36, -11.34], [0.23, 0.16, 0.02], [0, 0, -0.5]);
  }

  for (const side of [-1, 1]) {
    for (let index = 0; index < 3; index += 1) {
      const pipeY = 6.3 + index * 0.4;
      staticMeshes.cylinder(index === 1 ? materials.rust : materials.steel, [side * 15.25, pipeY, 0], [0.29, roomDepth, 0.29], [Math.PI / 2, 0, 0]);
      for (let z = -10; z <= 10; z += 4) {
        staticMeshes.cylinder(materials.edge, [side * 15.25, pipeY, z], [0.36, 0.13, 0.36], [Math.PI / 2, 0, 0]);
      }
    }
    for (const z of [-7, 1, 8]) {
      staticMeshes.box(materials.black, [side * 15.7, 2.9, z], [0.25, 1.3, 2.1]);
      for (let index = 0; index < 9; index += 1) {
        staticMeshes.box(materials.steel, [side * 15.5, 2.36 + index * 0.13, z], [0.12, 0.06, 1.9]);
      }
    }
  }

  for (const collider of DEAD_SHIFT_COLLIDERS) {
    const { x, z, width, depth, height, id } = collider;
    if (id.startsWith("tank")) {
      const diameter = Math.min(width, depth) * 0.86;
      staticMeshes.box(materials.black, [x, 0.13, z], [width, 0.26, depth]);
      staticMeshes.box(materials.steel, [x, height - 0.09, z], [width, 0.18, depth]);
      for (const sideX of [-1, 1]) {
        for (const sideZ of [-1, 1]) {
          staticMeshes.box(materials.black, [x + sideX * (width / 2 - 0.09), height / 2, z + sideZ * (depth / 2 - 0.09)], [0.18, height, 0.18]);
        }
        staticMeshes.box(materials.glass, [x + sideX * (width / 2 - 0.025), height * 0.52, z], [0.035, height * 0.72, depth - 0.35]);
        staticMeshes.box(materials.glass, [x, height * 0.52, z + sideX * (depth / 2 - 0.025)], [width - 0.35, height * 0.72, 0.035]);
      }
      staticMeshes.cylinder(materials.steel, [x, height * 0.5, z], [diameter, height * 0.95, diameter]);
      staticMeshes.cylinder(materials.glass, [x, height * 0.54, z], [diameter * 1.02, height * 0.55, diameter * 1.02]);
      for (const y of [0.25, height * 0.29, height * 0.8, height - 0.15]) {
        staticMeshes.cylinder(materials.edge, [x, y, z], [diameter * 1.1, 0.12, diameter * 1.1]);
      }
      for (const offset of [-1, 1]) {
        staticMeshes.box(materials.black, [x + offset * diameter * 0.41, height / 2, z], [0.16, height, 0.24]);
        staticMeshes.box(materials.cyanGlow, [x + offset * diameter * 0.3, height / 2, z - diameter * 0.43], [0.045, height * 0.55, 0.05]);
      }
      staticMeshes.sphere(materials.cream, [x, height * 0.63, z - diameter * 0.1], [diameter * 0.32, height * 0.22, diameter * 0.23]);
      staticMeshes.box(materials.darkWall, [x, height * 0.36, z - diameter * 0.1], [diameter * 0.28, height * 0.26, diameter * 0.22], [0, 0, 0.14]);
      staticMeshes.cylinder(materials.rust, [x + diameter * 0.3, height + 0.12, z], [0.18, 0.3, 0.18]);
    } else if (id.startsWith("barrier")) {
      staticMeshes.box(materials.wall, [x, height / 2, z], [width, height, depth]);
      staticMeshes.box(materials.edge, [x, height - 0.03, z], [width + 0.05, 0.08, depth + 0.05]);
      for (const side of [-1, 1]) {
        staticMeshes.box(materials.yellow, [x, height * 0.65, z + side * (depth / 2 + 0.011)], [width * 0.96, 0.26, 0.022]);
        for (let offset = -width / 2 + 0.3; offset < width / 2; offset += 0.5) {
          staticMeshes.box(materials.black, [x + offset, height * 0.65, z + side * (depth / 2 + 0.025)], [0.18, 0.3, 0.025], [0, 0, -0.43]);
        }
      }
    } else {
      const generator = id.startsWith("generator");
      const shellMaterial = generator ? materials.cream : materials.crate;
      staticMeshes.box(materials.black, [x, height / 2, z], [width, height, depth]);
      staticMeshes.box(shellMaterial, [x, height / 2, z], [width - 0.14, height - 0.14, depth + 0.015]);
      staticMeshes.box(shellMaterial, [x, height / 2, z], [width + 0.015, height - 0.14, depth - 0.14]);
      for (const side of [-1, 1]) {
        staticMeshes.box(materials.edge, [x + side * (width / 2 - 0.18), height / 2, z], [0.12, height + 0.03, depth + 0.05]);
        staticMeshes.box(materials.edge, [x, height / 2, z + side * (depth / 2 - 0.18)], [width + 0.05, height + 0.03, 0.1]);
      }
      if (generator) {
        for (let index = 0; index < 10; index += 1) {
          staticMeshes.box(materials.black, [x - width * 0.25 + index * width * 0.055, height * 0.58, z - depth / 2 - 0.026], [0.055, height * 0.44, 0.035]);
        }
        staticMeshes.box(materials.black, [x + width * 0.29, height * 0.72, z - depth / 2 - 0.03], [0.38, 0.32, 0.05]);
        staticMeshes.box(materials.warmGlow, [x + width * 0.29, height * 0.72, z - depth / 2 - 0.06], [0.23, 0.055, 0.02]);
        staticMeshes.cylinder(materials.rust, [x - width * 0.3, height + 0.2, z + depth * 0.25], [0.18, 0.4, 0.18]);
      } else {
        staticMeshes.box(materials.yellow, [x, height * 0.6, z - depth / 2 - 0.03], [0.65, 0.3, 0.035]);
        staticMeshes.box(materials.black, [x, height * 0.6, z - depth / 2 - 0.052], [0.42, 0.05, 0.01]);
        staticMeshes.box(materials.steel, [x, height + 0.03, z], [width * 0.6, 0.07, depth * 0.6]);
      }
    }
  }

  // Flat markings, drains and subtle pooled water break up the vast floor.
  for (const side of [-1, 1]) {
    staticMeshes.box(materials.yellow, [side * 11.5, 0.009, 0], [0.045, 0.014, 21]);
    for (let z = -10; z <= 10; z += 0.42) {
      staticMeshes.box(materials.black, [side * 12.2, 0.012, z], [0.82, 0.018, 0.1]);
    }
    for (let x = -10; x <= 10; x += 1.3) {
      staticMeshes.box(materials.yellow, [x, 0.012, side * 8.8], [0.68, 0.018, 0.035]);
    }
  }
  const random = createVisualRandom(810);
  for (let index = 0; index < 32; index += 1) {
    const x = (random() - 0.5) * 29;
    const z = (random() - 0.5) * 21;
    staticMeshes.cylinder(index % 7 === 0 ? materials.blood : materials.water, [x, 0.012, z], [0.5 + random() * 3.2, 0.012, 0.2 + random() * 1.3]);
  }
  for (let index = 0; index < 14; index += 1) {
    const x = (random() - 0.5) * 29;
    const z = (random() - 0.5) * 21;
    staticMeshes.box(materials.cream, [x, 0.022, z], [0.12 + random() * 0.12, 0.025, 0.2 + random() * 0.12], [0, random() * 6.28, 0]);
  }

  staticMeshes.finish(architecture);

  const labels = [
    { text: "CONTAINMENT", subtitle: "SECTOR 09   /   BIOLOGICAL RESEARCH DIVISION", position: [-7, 5.9, -11.36], scale: [7, 1.75, 1], rotation: 0 },
    { text: "RESTRICTED", subtitle: "DECONTAMINATION LOCK   /   AUTHORIZED PERSONNEL ONLY", position: [3.8, 4.24, -11.29], scale: [4.3, 1.075, 1], rotation: 0 },
    { text: "09", subtitle: "ISOLATION WING", position: [15.55, 3.5, -2.5], scale: [3, 0.75, 1], rotation: -Math.PI / 2 },
    { text: "QUARANTINE", subtitle: "DO NOT BREAK SEAL", position: [-15.55, 3.5, 2], scale: [4, 1, 1], rotation: Math.PI / 2 },
  ];
  for (const label of labels) {
    const texture = createLabelTexture(resources, label.text, label.subtitle);
    const material = basic({ map: texture, transparent: true, opacity: 0.88, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(resources.plane, material);
    mesh.position.fromArray(label.position);
    mesh.scale.fromArray(label.scale);
    mesh.rotation.y = label.rotation;
    architecture.add(mesh);
  }

  const hemisphere = new THREE.HemisphereLight(0xb2d5d1, 0x26302b, 1.65);
  scene.add(hemisphere);
  const keyLight = new THREE.DirectionalLight(0xb9e3dc, 2.2);
  keyLight.position.set(-5, 7.5, 5);
  keyLight.target.position.set(0, 0, -2);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.left = -19;
  keyLight.shadow.camera.right = 19;
  keyLight.shadow.camera.top = 16;
  keyLight.shadow.camera.bottom = -16;
  keyLight.shadow.camera.near = 0.5;
  keyLight.shadow.camera.far = 40;
  keyLight.shadow.bias = -0.0006;
  keyLight.shadow.normalBias = 0.04;
  scene.add(keyLight, keyLight.target);

  const accentLights = [];
  for (const lightOptions of [
    { color: 0xffa34c, position: [-10, 4, -6], intensity: 110, distance: 18 },
    { color: 0xff6242, position: [9, 3.5, 7], intensity: 95, distance: 15 },
    { color: 0x65d7c7, position: [-4, 3, -6], intensity: 38, distance: 9 },
    { color: 0x65d7c7, position: [5, 3, 5], intensity: 32, distance: 9 },
    { color: 0xf34b25, position: [3.8, 4, -10], intensity: 48, distance: 10 },
  ]) {
    const light = new THREE.PointLight(lightOptions.color, lightOptions.intensity, lightOptions.distance, 2);
    light.position.fromArray(lightOptions.position);
    light.userData.baseIntensity = lightOptions.intensity;
    scene.add(light);
    accentLights.push(light);
  }

  const glowMeshes = createStaticMeshBuilder(resources);
  for (const side of [-1, 1]) {
    for (const z of [-6, 6]) {
      glowMeshes.box(materials.black, [side * 15.3, 4.2, z], [0.35, 0.6, 0.65]);
      glowMeshes.box(materials.warmGlow, [side * 15.08, 4.2, z], [0.06, 0.27, 0.42]);
      glowMeshes.box(materials.black, [side * 14.99, 4.15, z], [0.04, 0.035, 0.48]);
    }
  }
  glowMeshes.finish(architecture, { shadows: false });

  const haze = new THREE.Group();
  const hazeMaterial = basic({ color: 0x70c7bd, transparent: true, opacity: 0.025, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  const hazeGeometry = resources.ownGeometry(new THREE.ConeGeometry(2.3, 6.3, 24, 1, true));
  for (const [x, z] of [[-12, -3], [4, -3], [-4, 3], [12, 3]]) {
    const beam = new THREE.Mesh(hazeGeometry, hazeMaterial);
    beam.position.set(x, 4, z);
    haze.add(beam);
  }
  scene.add(haze);

  return {
    update(timeSec, reducedMotion) {
      const flicker = reducedMotion ? 1 : 0.96 + Math.sin(timeSec * 3.1) * 0.025 + Math.sin(timeSec * 17.3) * 0.015;
      accentLights[0].intensity = accentLights[0].userData.baseIntensity * flicker;
    },
    setQuality(profile) {
      keyLight.castShadow = profile !== "low";
      haze.visible = profile !== "low";
      accentLights.forEach((light, index) => { light.visible = profile !== "low" || index < 2; });
    },
    dispose() {
      keyLight.shadow.map?.dispose();
      scene.remove(architecture, haze, hemisphere, keyLight, keyLight.target, ...accentLights);
    },
  };
}
