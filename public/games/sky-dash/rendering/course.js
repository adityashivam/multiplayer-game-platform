import * as THREE from "three";
import {
  SKY_DASH_PLATFORMS,
  SKY_DASH_CHECKPOINTS,
  SKY_DASH_OBSTACLES,
  sampleSkyDashPlatforms,
  sampleSkyDashObstacles,
} from "../shared/course.js";
import { SKY_DASH_FINISH_Z } from "../shared/config.js";
import { createSkyDashSignTexture, createSkyDashStaticBuilder } from "./resources.js";
import { shouldFadeSkyDashGate, writeSkyDashPlatformTransform, writeSkyDashSegmentTransform } from "./presentation.js";

const COURSE_COLORS = Object.freeze({ cream: "#fff7e6", purple: "#7653b8", pink: "#ef6b93", teal: "#34aaa9", ink: "#475783", yellow: "#ffcf66" });

/** @param {import("./resources.js").SkyDashResources} resources */
function createDirectionChevron(resources) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute([
    -0.75, 0, 0.5, 0, 0, -0.25, 0, 0, -0.75,
    -0.75, 0, 0.5, 0, 0, -0.75, -0.75, 0, 0,
    0, 0, -0.25, 0.75, 0, 0.5, 0.75, 0, 0,
    0, 0, -0.25, 0.75, 0, 0, 0, 0, -0.75,
  ], 3));
  geometry.computeVertexNormals();
  return resources.ownGeometry(geometry);
}

/** @param {THREE.Object3D} parent @param {import("./resources.js").SkyDashResources} resources @param {{width:number,topY:number,z:number,title:string,subtitle:string,finish?:boolean}} settings */
function addCourseArch(parent, resources, { width, topY, z, title, subtitle, finish = false }) {
  const arch = new THREE.Group();
  arch.position.set(0, topY, z);
  parent.add(arch);
  const archHalfWidth = width * 0.5 + 0.6;
  // The launch portal sits above the follow camera's forward sight line. The
  // smaller finish portal stays readable as the runner approaches its runway.
  const archHeightScale = finish ? 1 : 1.45;
  const signY = finish ? 5.62 : 8.45;
  const signWidth = finish ? 8.4 : 6.8;
  const archPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-archHalfWidth, -0.45, 0),
    new THREE.Vector3(-archHalfWidth, 3.8 * archHeightScale, 0),
    new THREE.Vector3(-archHalfWidth + 0.8, 5.65 * archHeightScale, 0),
    new THREE.Vector3(0, 6.2 * archHeightScale, 0),
    new THREE.Vector3(archHalfWidth - 0.8, 5.65 * archHeightScale, 0),
    new THREE.Vector3(archHalfWidth, 3.8 * archHeightScale, 0),
    new THREE.Vector3(archHalfWidth, -0.45, 0),
  ], false, "centripetal");
  const archGeometry = resources.ownGeometry(new THREE.TubeGeometry(archPath, 60, 0.36, 10, false));
  const archMesh = new THREE.Mesh(archGeometry, resources.material(finish ? COURSE_COLORS.yellow : COURSE_COLORS.pink, 0.38));
  archMesh.castShadow = true;
  archMesh.receiveShadow = true;
  arch.add(archMesh);

  const trim = createSkyDashStaticBuilder(resources);
  for (const side of [-1, 1]) {
    trim.add(resources.cylinder, resources.material(COURSE_COLORS.purple), [side * archHalfWidth, -0.12, 0], [0.7, 0.32, 0.7]);
    trim.add(resources.cylinder, resources.material(COURSE_COLORS.cream), [side * archHalfWidth, 0.15, 0], [0.4, 0.16, 0.4]);
    for (let stripe = 0; stripe < 3; stripe += 1) {
      trim.add(resources.cylinder, resources.material(COURSE_COLORS.cream), [side * archHalfWidth, 1.15 + stripe * 0.58, 0], [0.375, 0.12, 0.375]);
    }
    trim.add(resources.sphere, resources.material(COURSE_COLORS.cream), [side * (archHalfWidth - 0.36), 4.8 * archHeightScale, 0], [0.18, 0.18, 0.18]);
  }
  trim.add(resources.roundedBox(signWidth, 1.9, 0.35, 0.17), resources.material(COURSE_COLORS.cream), [0, signY, 0.02]);
  trim.finish(arch);

  const signMaterial = resources.ownMaterial(new THREE.MeshStandardMaterial({
    map: createSkyDashSignTexture(resources, title, subtitle, { background: finish ? COURSE_COLORS.pink : COURSE_COLORS.purple, finish }),
    roughness: 0.65,
    side: THREE.DoubleSide,
  }));
  const sign = new THREE.Mesh(resources.plane, signMaterial);
  sign.position.set(0, signY, 0.212);
  sign.scale.set(signWidth - 0.3, 1.67, 1);
  arch.add(sign);
}

/** Flags and paint are decorative; their posts sit outside the walkable bounds. */
function addCheckpointGate(parent, resources, checkpoint, platform) {
  const gate = new THREE.Group();
  gate.position.set(checkpoint.x, checkpoint.y, checkpoint.z);
  parent.add(gate);
  const trim = createSkyDashStaticBuilder(resources);
  const poleX = platform.width * 0.5 + 0.35;
  const flagMaterial = resources.material(checkpoint.id % 2 ? COURSE_COLORS.yellow : COURSE_COLORS.pink);
  for (const side of [-1, 1]) {
    trim.add(resources.cylinder, resources.material(COURSE_COLORS.cream), [side * poleX, 1.7, 0], [0.055, 3.4, 0.055]);
    trim.add(resources.sphere, resources.material(COURSE_COLORS.yellow), [side * poleX, 3.45, 0], [0.15, 0.15, 0.15]);
    trim.add(resources.box, flagMaterial, [side * (poleX + 0.56), 2.85, 0], [1.05, 0.75, 0.045]);
    trim.add(resources.box, resources.material(COURSE_COLORS.cream), [side * (poleX + 0.56), 2.85, 0.03], [0.12, 0.75, 0.025]);
    trim.add(resources.cylinder, resources.material(COURSE_COLORS.purple), [side * poleX, -0.15, 0], [0.28, 0.3, 0.28]);
  }
  trim.add(resources.box, resources.material(COURSE_COLORS.cream), [0, 0.007, 0], [platform.width - 0.5, 0.012, 0.12]);
  trim.add(resources.box, flagMaterial, [0, 0.009, -0.27], [platform.width - 0.5, 0.012, 0.28]);
  trim.finish(gate);
}

/** @param {import("./resources.js").SkyDashResources} resources @param {(typeof SKY_DASH_PLATFORMS)[number]} platform @param {THREE.BufferGeometry} chevron */
function createCoursePlatform(resources, platform, chevron) {
  const group = new THREE.Group();
  group.position.set(platform.x, platform.topY, platform.z);
  const builder = createSkyDashStaticBuilder(resources);
  const platformColor = new THREE.Color(platform.color);
  const sideColor = `#${platformColor.clone().multiplyScalar(0.79).getHexString()}`;
  const undersideColor = "#738db0";
  const topMaterial = resources.material(platform.color, 0.64);

  // Walkable surfaces end at the exact dimensions of the collision rectangles.
  builder.add(resources.roundedBox(platform.width, platform.thickness - 0.14, platform.depth, 0.18), resources.material(sideColor), [0, -(platform.thickness + 0.14) * 0.5, 0]);
  builder.add(resources.roundedBox(platform.width - 0.08, 0.17, platform.depth - 0.08, 0.075), topMaterial, [0, -0.085, 0]);
  builder.add(resources.roundedBox(platform.width - 0.6, 0.3, platform.depth - 0.6, 0.12), resources.material(undersideColor), [0, -platform.thickness + 0.07, 0]);

  const seamMaterial = resources.material(COURSE_COLORS.cream);
  const rimOffsetX = platform.width * 0.5 - 0.28;
  for (const side of [-1, 1]) {
    builder.add(resources.box, seamMaterial, [side * rimOffsetX, 0.006, 0], [0.06, 0.01, platform.depth - 0.75]);
    const studCount = Math.ceil(platform.depth / 4);
    for (let stud = 0; stud < studCount; stud += 1) {
      const studZ = -platform.depth * 0.5 + 1.5 + stud * (platform.depth - 3) / Math.max(1, studCount - 1);
      builder.add(resources.sphere, seamMaterial, [side * (platform.width * 0.5 - 0.1), -platform.thickness * 0.54, studZ], [0.055, 0.09, 0.09]);
    }
  }

  const arrowZs = platform.depth > 14 ? [-platform.depth * 0.29, platform.depth * 0.29] : [0];
  for (const arrowZ of arrowZs) {
    if (platform.id === 10) continue;
    builder.add(chevron, seamMaterial, [0, 0.014, arrowZ], [0.85, 1, 0.85]);
  }
  if (platform.seesaw) {
    const paddingMaterial = resources.material(COURSE_COLORS.purple);
    for (const side of [-1, 1]) {
      builder.add(resources.roundedBox(0.32, 0.12, platform.depth - 0.45, 0.055), paddingMaterial, [side * (platform.width * 0.5 - 0.22), -0.052, 0]);
      builder.add(resources.box, seamMaterial, [0, 0.016, side * platform.depth * 0.28], [0.14, 0.012, platform.depth * 0.27]);
      builder.add(resources.box, seamMaterial, [side * platform.width * 0.26, 0.016, 0], [0.5, 0.012, 0.12]);
    }
    builder.add(resources.cylinder, resources.material(COURSE_COLORS.purple), [0, -0.015, 0], [0.32, 0.05, 0.32]);
    builder.add(resources.cylinder, resources.material(COURSE_COLORS.cream), [0, 0.013, 0], [0.2, 0.01, 0.2]);
  } else if (platform.amplitude) {
    const padRing = resources.ownGeometry(new THREE.TorusGeometry(1.3, 0.025, 5, 40));
    builder.add(padRing, seamMaterial, [0, 0.018, 0], [1, 1, 1], [-Math.PI * 0.5, 0, 0]);
    builder.add(resources.cylinder, resources.material(COURSE_COLORS.purple), [0, -platform.thickness - 0.13, 0], [1.3, 0.32, 1.3]);
    builder.add(resources.cylinder, resources.material(COURSE_COLORS.cream), [0, -platform.thickness - 0.31, 0], [0.75, 0.08, 0.75]);
  }
  builder.finish(group);
  return group;
}

/** The fulcrum stays level below the tilting deck and follows its moving center. */
function createSeesawFulcrum(resources, platform) {
  const support = new THREE.Group();
  const outline = new THREE.Shape();
  outline.moveTo(-0.85, -1.1);
  outline.lineTo(0.85, -1.1);
  outline.lineTo(0, -0.04);
  outline.closePath();
  const wedgeGeometry = resources.ownGeometry(new THREE.ExtrudeGeometry(outline, { depth: 2.3, steps: 1, bevelEnabled: true, bevelSize: 0.055, bevelThickness: 0.04, bevelSegments: 2 }));
  wedgeGeometry.translate(0, -platform.thickness, -1.15);
  const builder = createSkyDashStaticBuilder(resources);
  builder.add(wedgeGeometry, resources.material(COURSE_COLORS.purple), [0, 0, 0]);
  builder.add(resources.cylinder, resources.material(COURSE_COLORS.cream), [0, -platform.thickness - 0.05, 0], [0.18, 2.65, 0.18], [Math.PI * 0.5, 0, 0]);
  builder.add(resources.roundedBox(2.1, 0.22, 2.75, 0.1), resources.material(COURSE_COLORS.teal), [0, -platform.thickness - 1.25, 0]);
  builder.finish(support);
  return support;
}

/**
 * A complete visible slab surrounds the canonical circular opening. Its rim's
 * inner edge meets the empty hole exactly, rather than reducing its clearance.
 * GPU resources belong to the supplied owner; the caller attaches the group.
 * @param {import("./resources.js").SkyDashResources} resources
 * @param {{x:number,y:number,z:number,openingRadius:number,radius:number,frameWidth:number,frameBottomY:number,frameTopY:number,depth:number}} obstacle
 */
export function createSkyDashCircularGate(resources, obstacle) {
  const root = new THREE.Group();
  root.position.set(obstacle.x, obstacle.y, obstacle.z);
  const bottomY = obstacle.frameBottomY - obstacle.y;
  const topY = obstacle.frameTopY - obstacle.y;
  // The padded rim occupies the inner half of this recessed edge. Its tube
  // remains inside the slab's full depth, with the exact canonical empty hole.
  const slabGeometry = resources.gatePanel({ ...obstacle, openingRadius: obstacle.openingRadius + obstacle.radius });
  const slab = new THREE.Mesh(slabGeometry, [resources.material("#b8e5e1", 0.72), resources.material(COURSE_COLORS.teal, 0.56)]);
  slab.castShadow = true;
  slab.receiveShadow = true;
  root.add(slab);

  const trim = createSkyDashStaticBuilder(resources);
  const rimGeometry = resources.ownGeometry(new THREE.TorusGeometry(obstacle.openingRadius + obstacle.radius, obstacle.radius, 10, 40, Math.PI * 0.5));
  for (let quarter = 0; quarter < 4; quarter += 1) {
    trim.add(rimGeometry, resources.material(quarter % 2 ? COURSE_COLORS.cream : "#31d3d8", 0.38), [0, 0, 0], [1, 1, 1], [0, 0, quarter * Math.PI * 0.5]);
  }
  for (const side of [-1, 1]) {
    trim.add(resources.box, resources.material(COURSE_COLORS.cream), [side * (obstacle.frameWidth * 0.5 - 0.14), (bottomY + topY) * 0.5, obstacle.depth * 0.5 + 0.005], [0.11, topY - bottomY - 0.2, 0.014]);
    trim.add(resources.box, resources.material(COURSE_COLORS.cream), [side * (obstacle.openingRadius + 2), -0.4, obstacle.depth * 0.5 + 0.012], [0.45, 0.17, 0.015], [0, 0, side * -0.55]);
    trim.add(resources.box, resources.material(COURSE_COLORS.cream), [side * (obstacle.openingRadius + 2), 0, obstacle.depth * 0.5 + 0.012], [0.45, 0.17, 0.015], [0, 0, side * 0.55]);
  }
  trim.add(resources.box, resources.material(COURSE_COLORS.cream), [0, topY - 0.15, obstacle.depth * 0.5 + 0.005], [obstacle.frameWidth - 0.3, 0.11, 0.014]);
  trim.add(resources.box, resources.material(COURSE_COLORS.purple), [0, bottomY + 0.085, obstacle.depth * 0.5 + 0.005], [obstacle.frameWidth - 0.1, 0.12, 0.014]);
  trim.finish(root);

  // Per-gate opacity is the only reason these otherwise shared materials need
  // copies. The bounded set keeps a wing from hiding the followed runner.
  const opacityMaterials = new Map();
  function createOpacityMaterial(material) {
    if (!opacityMaterials.has(material)) {
      const opacityMaterial = resources.ownMaterial(material.clone());
      opacityMaterial.transparent = true;
      opacityMaterials.set(material, opacityMaterial);
    }
    return opacityMaterials.get(material);
  }
  root.traverse((child) => {
    if (!child.isMesh) return;
    child.material = Array.isArray(child.material) ? child.material.map(createOpacityMaterial) : createOpacityMaterial(child.material);
  });
  let opacity = 1;
  return {
    root,
    rotor: null,
    updateVisibility(cameraPosition, runnerState, dtSec, reducedMotion) {
      const nextOpacity = cameraPosition && runnerState && shouldFadeSkyDashGate(obstacle, cameraPosition, runnerState) ? 0.16 : 1;
      opacity += (nextOpacity - opacity) * (reducedMotion ? 1 : 1 - Math.exp(-Math.max(0, dtSec) * 14));
      if (Math.abs(opacity - nextOpacity) < 0.001) opacity = nextOpacity;
      for (const material of opacityMaterials.values()) {
        material.opacity = opacity;
        material.depthWrite = opacity >= 0.999;
      }
    },
  };
}

/** Canonical endpoints also support vertical and diagonal rotating gate spokes. */
function createCapsuleBar(resources, obstacle) {
  const root = new THREE.Group();
  const material = resources.material(obstacle.color, 0.38);
  const bar = new THREE.Mesh(resources.cylinder, material);
  bar.matrixAutoUpdate = false;
  bar.castShadow = true;
  bar.receiveShadow = true;
  root.add(bar);
  const startCap = new THREE.Mesh(resources.sphere, material);
  const endCap = new THREE.Mesh(resources.sphere, material);
  startCap.castShadow = true;
  endCap.castShadow = true;
  startCap.receiveShadow = true;
  endCap.receiveShadow = true;
  root.add(startCap, endCap);
  const stripeMaterial = resources.material(COURSE_COLORS.cream);
  for (const stripeY of [-0.32, 0.32]) {
    const stripe = new THREE.Mesh(resources.cylinder, stripeMaterial);
    stripe.position.y = stripeY;
    stripe.scale.set(1.004, 0.045, 1.004);
    stripe.castShadow = true;
    stripe.receiveShadow = true;
    bar.add(stripe);
  }
  return {
    root,
    rotor: null,
    update(sample) {
      writeSkyDashSegmentTransform(sample, bar.matrix.elements);
      bar.matrixWorldNeedsUpdate = true;
      startCap.position.set(sample.ax, sample.ay, sample.az);
      endCap.position.set(sample.bx, sample.by, sample.bz);
      startCap.scale.setScalar(sample.radius);
      endCap.scale.setScalar(sample.radius);
    },
  };
}

/** @param {THREE.Scene} scene @param {import("./resources.js").SkyDashResources} resources */
function createSkyScenery(scene, resources) {
  const scenery = new THREE.Group();
  scene.add(scenery);
  const cloudShapes = createSkyDashStaticBuilder(resources);
  const cloudMaterial = resources.material("#f6fbfa", 1, 0);
  const islandMaterial = resources.material("#b3d0d9", 0.92);
  const islandTop = resources.material("#acd9ce", 0.92);
  let visualSeed = 151;
  function random() {
    visualSeed = (Math.imul(visualSeed, 1664525) + 1013904223) >>> 0;
    return visualSeed / 4294967296;
  }

  for (let cloud = 0; cloud < 42; cloud += 1) {
    const side = cloud % 2 ? -1 : 1;
    const x = side * (14 + random() * 45);
    const z = 25 - random() * 205;
    const y = cloud < 32 ? -5 - random() * 5 : 8 + random() * 12;
    const size = 1.6 + random() * 3.6;
    for (let puff = 0; puff < 4; puff += 1) {
      cloudShapes.add(resources.softSphere, cloudMaterial, [x + (puff - 1.5) * size * 0.7, y + Math.sin(puff * 1.8) * size * 0.28, z + (random() - 0.5) * size], [size * (0.8 + random() * 0.4), size * 0.47, size * 0.76]);
    }
  }
  for (let island = 0; island < 8; island += 1) {
    const side = island % 2 ? -1 : 1;
    const x = side * (33 + random() * 25);
    const y = -7 + random() * 7;
    const z = 4 - island * 23;
    const size = 4 + random() * 4;
    cloudShapes.add(resources.softSphere, islandMaterial, [x, y - size * 0.6, z], [size, size, size * 0.8]);
    cloudShapes.add(resources.sphere, islandTop, [x, y, z], [size * 1.06, size * 0.2, size * 0.84]);
    cloudShapes.add(resources.softSphere, cloudMaterial, [x + 1, y + size * 0.3, z], [size * 0.52, size * 0.35, size * 0.45]);
  }
  cloudShapes.finish(scenery, false);
  for (const mesh of scenery.children) mesh.receiveShadow = false;

  const balloons = new THREE.Group();
  scenery.add(balloons);
  const balloonShapes = createSkyDashStaticBuilder(resources);
  for (let balloon = 0; balloon < 8; balloon += 1) {
    const side = balloon % 2 ? -1 : 1;
    const x = side * (21 + (balloon % 3) * 5);
    const z = -11 - balloon * 18;
    const y = 7 + (balloon % 3) * 2;
    const color = [COURSE_COLORS.pink, COURSE_COLORS.yellow, "#a18ae0"][balloon % 3];
    balloonShapes.add(resources.sphere, resources.material(color, 0.4), [x, y, z], [1.1, 1.45, 1.1]);
    balloonShapes.add(resources.cone, resources.material(color, 0.4), [x, y - 1.46, z], [0.16, 0.24, 0.16], [Math.PI, 0, 0]);
    balloonShapes.add(resources.cylinder, resources.material(COURSE_COLORS.cream), [x, y - 3.15, z], [0.012, 3.2, 0.012]);
  }
  balloonShapes.finish(balloons, false);
  return { scenery, balloons };
}

/**
 * Shared samples drive every moving contact surface and obstacle. Cosmetic
 * supports sit below decks or outside their edges and never suggest hidden walls.
 * @param {THREE.Scene} scene
 * @param {import("./resources.js").SkyDashResources} resources
 */
export function createSkyDashCourse(scene, resources) {
  const course = new THREE.Group();
  scene.add(course);
  const chevron = createDirectionChevron(resources);
  const platforms = new Map();
  const seesawSupports = new Map();
  for (const platform of SKY_DASH_PLATFORMS) {
    const mesh = createCoursePlatform(resources, platform, chevron);
    mesh.matrixAutoUpdate = false;
    platforms.set(platform.id, mesh);
    course.add(mesh);
    if (platform.seesaw) {
      const support = createSeesawFulcrum(resources, platform);
      seesawSupports.set(platform.id, support);
      course.add(support);
    }
  }

  addCourseArch(course, resources, { width: 16, topY: 0, z: -7.5, title: "SKY DASH", subtitle: "A LITTLE COURAGE. A LOT OF AIR." });
  addCourseArch(course, resources, { width: 17, topY: 1.2, z: SKY_DASH_FINISH_Z, title: "FINISH", subtitle: "HEAD IN THE CLOUDS. FEET ON THE LINE.", finish: true });
  for (const checkpoint of SKY_DASH_CHECKPOINTS) {
    if (checkpoint.id === 0) continue;
    const platform = SKY_DASH_PLATFORMS.find((coursePlatform) => coursePlatform.id === checkpoint.platformId);
    addCheckpointGate(course, resources, checkpoint, platform);
  }

  const paint = createSkyDashStaticBuilder(resources);
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 20; column += 1) {
      paint.add(resources.box, resources.material((row + column) % 2 ? COURSE_COLORS.purple : COURSE_COLORS.cream), [-7.6 + column * 0.8, 1.214, SKY_DASH_FINISH_Z + row * 0.8], [0.8, 0.012, 0.8]);
    }
  }
  for (let lane = 0; lane < 5; lane += 1) {
    paint.add(resources.box, resources.material(COURSE_COLORS.cream), [-4.8 + lane * 2.4, 0.011, 0.6], [1.4, 0.012, 0.08]);
    paint.add(resources.box, resources.material(COURSE_COLORS.cream), [-4.8 + lane * 2.4, 0.011, 2], [0.06, 0.012, 2.8]);
  }
  paint.finish(course, false);

  const obstacles = new Map();
  for (const obstacle of SKY_DASH_OBSTACLES) {
    if (obstacle.kind === "gate") {
      const gate = createSkyDashCircularGate(resources, obstacle);
      obstacles.set(obstacle.id, gate);
      course.add(gate.root);
      continue;
    }
    if (obstacle.kind === "hurdle" || obstacle.kind === "gate-spoke") {
      const capsuleBar = createCapsuleBar(resources, obstacle);
      obstacles.set(obstacle.id, capsuleBar);
      course.add(capsuleBar.root);
      continue;
    }
    const root = new THREE.Group();
    const rotor = new THREE.Group();
    const details = createSkyDashStaticBuilder(resources);
    root.add(rotor);
    course.add(root);
    const obstacleMaterial = resources.material(obstacle.color, 0.38);
    if (obstacle.kind === "sweeper") {
      root.position.set(obstacle.x, obstacle.y, obstacle.z);
      details.add(resources.cylinder, obstacleMaterial, [0, 0, 0], [obstacle.radius, obstacle.halfLength * 2, obstacle.radius], [0, 0, Math.PI * 0.5]);
      for (const side of [-1, 1]) {
        details.add(resources.sphere, obstacleMaterial, [side * obstacle.halfLength, 0, 0], [obstacle.radius, obstacle.radius, obstacle.radius]);
        details.add(resources.cylinder, resources.material(COURSE_COLORS.cream), [side * obstacle.halfLength * 0.65, 0, 0], [obstacle.radius + 0.004, 0.19, obstacle.radius + 0.004], [0, 0, Math.PI * 0.5]);
      }
      // The hub stays inside the bar's collision radius and remains jumpable.
      details.add(resources.cylinder, resources.material(COURSE_COLORS.purple), [0, 0, 0], [obstacle.radius * 0.96, obstacle.radius * 1.8, obstacle.radius * 0.96]);
      details.add(resources.sphere, resources.material(COURSE_COLORS.cream), [0, obstacle.radius * 0.8, 0], [0.12, 0.075, 0.12]);
    } else if (obstacle.kind === "hammer") {
      root.position.set(obstacle.x, obstacle.y, obstacle.z);
      const frame = createSkyDashStaticBuilder(resources);
      for (const side of [-1, 1]) {
        frame.add(resources.cylinder, resources.material(COURSE_COLORS.purple), [side * 8.6 - obstacle.x, (1.2 - obstacle.y) * 0.5, 0], [0.14, obstacle.y - 1.2, 0.14]);
        frame.add(resources.cylinder, resources.material(COURSE_COLORS.cream), [side * 8.6 - obstacle.x, 1.5 - obstacle.y, 0], [0.17, 0.18, 0.17]);
      }
      frame.add(resources.cylinder, resources.material(COURSE_COLORS.purple), [-obstacle.x, 0.12, 0], [0.15, 17.2, 0.15], [0, 0, Math.PI * 0.5]);
      frame.add(resources.cylinder, resources.material(COURSE_COLORS.cream), [0, 0.12, 0], [0.23, 0.65, 0.23], [Math.PI * 0.5, 0, 0]);
      frame.finish(root);
      // A fine suspension cable communicates the sampled sphere's swing. It is
      // narrower than a runner and above the obstacle's contact envelope.
      details.add(resources.cylinder, resources.material(COURSE_COLORS.cream), [0, -obstacle.length * 0.5, 0], [0.035, obstacle.length, 0.035]);
      details.add(resources.sphere, obstacleMaterial, [0, -obstacle.length, 0], [obstacle.radius, obstacle.radius, obstacle.radius]);
      details.add(resources.ring, resources.material(COURSE_COLORS.cream), [0, -obstacle.length, 0], [obstacle.radius, obstacle.radius, obstacle.radius], [Math.PI * 0.5, 0, 0]);
    } else {
      const sphere = new THREE.Mesh(resources.sphere, obstacleMaterial);
      sphere.scale.setScalar(obstacle.radius);
      sphere.castShadow = true;
      sphere.receiveShadow = true;
      rotor.add(sphere);
      details.add(resources.ring, resources.material(COURSE_COLORS.cream), [0, 0, 0], [obstacle.radius + 0.005, obstacle.radius + 0.005, obstacle.radius + 0.005], [Math.PI * 0.5, 0, 0]);
      details.add(resources.sphere, resources.material(COURSE_COLORS.cream), [0, 0.22, 0.94], [0.12, 0.12, 0.06]);
      details.add(resources.sphere, resources.material(COURSE_COLORS.purple), [-0.21, 0.24, 0.94], [0.07, 0.11, 0.04]);
      details.add(resources.sphere, resources.material(COURSE_COLORS.purple), [0.21, 0.24, 0.94], [0.07, 0.11, 0.04]);
    }
    details.finish(rotor);
    obstacles.set(obstacle.id, { root, rotor });
  }

  const skyScenery = createSkyScenery(scene, resources);
  return {
    update(courseTimeSec, timeSec, reducedMotion, { seesaws = [], camera = null, localRunner = null, dtSec = 1 / 60 } = {}) {
      const sampledPlatforms = sampleSkyDashPlatforms(courseTimeSec, seesaws);
      for (const platform of sampledPlatforms) {
        const deck = platforms.get(platform.id);
        writeSkyDashPlatformTransform(platform, deck.matrix.elements);
        deck.matrixWorldNeedsUpdate = true;
        seesawSupports.get(platform.id)?.position.set(platform.x, platform.topY, platform.z);
      }
      for (const obstacle of sampleSkyDashObstacles(courseTimeSec)) {
        const visual = obstacles.get(obstacle.id);
        visual.updateVisibility?.(camera?.position, localRunner, dtSec, reducedMotion);
        if (visual.update) {
          visual.update(obstacle);
        } else if (obstacle.kind === "gate") {
          continue;
        } else if (obstacle.kind === "sweeper") {
          visual.rotor.rotation.y = -obstacle.angle;
        } else if (obstacle.kind === "hammer") {
          visual.rotor.rotation.z = obstacle.angle;
        } else {
          visual.root.position.set(obstacle.x, obstacle.y, obstacle.z);
          visual.rotor.rotation.z = Math.sin(timeSec * 3 + obstacle.id) * (reducedMotion ? 0.02 : 0.08);
        }
      }
      skyScenery.balloons.position.y = reducedMotion ? 0 : Math.sin(timeSec * 0.5) * 0.22;
      return sampledPlatforms;
    },
    setQuality(quality) {
      skyScenery.balloons.visible = quality !== "low";
    },
    dispose() {
      scene.remove(course);
      scene.remove(skyScenery.scenery);
    },
  };
}
