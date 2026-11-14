import * as THREE from "three";
import { BUMPER_LINKS_COURSE, BUMPER_LINKS_CUP, BUMPER_LINKS_SWEEPER } from "../shared/config.js";

/** @typedef {import("../shared/course.js").BumperLinksCourse} BumperLinksCourse */

/** Visual water sits above the splash height so balls sink before they reset. */
const WATER_ABOVE_SPLASH_M = 0.9;
const RAIL_MIN_HEIGHT_M = 0.3;
const SCENERY_ROCKS = 14;

/**
 * Static hole meshes plus animated sweeper bars. Geometry is rebuilt only
 * when the hole seed changes; materials are shared for the whole session.
 * @param {THREE.Scene} scene
 */
export function createBumperLinksCourseView(scene) {
  const materials = {
    green: new THREE.MeshStandardMaterial({ color: "#5fd38d", roughness: 0.9 }),
    greenDark: new THREE.MeshStandardMaterial({ color: "#4bbd78", roughness: 0.9 }),
    earth: new THREE.MeshStandardMaterial({ color: "#b98b55", roughness: 1 }),
    rail: new THREE.MeshStandardMaterial({ color: "#f3ead6", roughness: 0.6 }),
    post: new THREE.MeshStandardMaterial({ color: "#ffb547", roughness: 0.45, emissive: "#5a3300", emissiveIntensity: 0.25 }),
    sweeper: new THREE.MeshStandardMaterial({ color: "#ff5d73", roughness: 0.4, emissive: "#40000c", emissiveIntensity: 0.3 }),
    pivot: new THREE.MeshStandardMaterial({ color: "#2b3445", roughness: 0.5 }),
    cup: new THREE.MeshBasicMaterial({ color: "#07130c" }),
    cupRim: new THREE.MeshStandardMaterial({ color: "#e9f2ec", roughness: 0.4 }),
    flagPole: new THREE.MeshStandardMaterial({ color: "#e7edf2", roughness: 0.3 }),
    flag: new THREE.MeshStandardMaterial({ color: "#ff5d73", roughness: 0.6, side: THREE.DoubleSide }),
    tee: new THREE.MeshStandardMaterial({ color: "#3e9a63", roughness: 1 }),
    water: new THREE.MeshStandardMaterial({ color: "#2b8fcb", roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.88 }),
    rock: new THREE.MeshStandardMaterial({ color: "#7c8a7a", roughness: 1, flatShading: true }),
    island: new THREE.MeshStandardMaterial({ color: "#6dbf73", roughness: 1, flatShading: true }),
  };
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), materials.water);
  water.rotation.x = -Math.PI / 2;
  water.receiveShadow = true;
  scene.add(water);

  /** @type {THREE.Group|null} */
  let holeGroup = null;
  /** @type {{bar:THREE.Mesh,phase:number}[]} */
  let sweeperBars = [];
  /** @type {THREE.Mesh|null} */
  let flag = null;
  let builtSeed = -1;
  /** @type {THREE.BufferGeometry[]} */
  let ownedGeometries = [];

  /** @param {import("../../../platform/shared/sphereBody.js").SphereSolid} solid @param {THREE.Material|THREE.Material[]} material */
  function createSolidMesh(solid, material) {
    const mesh = new THREE.Mesh(unitBox, material);
    mesh.scale.set(solid.maxX - solid.minX, solid.maxY - solid.minY, solid.maxZ - solid.minZ);
    mesh.position.set((solid.minX + solid.maxX) / 2, (solid.minY + solid.maxY) / 2, (solid.minZ + solid.maxZ) / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  /** @param {Readonly<BumperLinksCourse>} course */
  function classifyBumperLinksSolid(course, solid) {
    const height = solid.maxY - solid.minY;
    if (height >= BUMPER_LINKS_COURSE.floorThickness - 1e-6) return "floor";
    if (height < RAIL_MIN_HEIGHT_M + 0.1 && (solid.maxX - solid.minX >= BUMPER_LINKS_COURSE.tileSize - 1e-6 || solid.maxZ - solid.minZ >= BUMPER_LINKS_COURSE.tileSize - 1e-6)) return "rail";
    const isPivot = course.sweepers.some((sweeper) => Math.abs((solid.minX + solid.maxX) / 2 - sweeper.x) < 1e-6 && Math.abs((solid.minZ + solid.maxZ) / 2 - sweeper.z) < 1e-6);
    return isPivot ? "pivot" : "post";
  }

  /** @param {Readonly<BumperLinksCourse>} course @param {THREE.Group} group */
  function addBumperLinksScenery(course, group) {
    const centreX = (course.bounds.minX + course.bounds.maxX) / 2;
    const centreZ = (course.bounds.minZ + course.bounds.maxZ) / 2;
    const span = Math.max(course.bounds.maxX - course.bounds.minX, course.bounds.maxZ - course.bounds.minZ);
    const rockGeometry = new THREE.DodecahedronGeometry(1, 0);
    const islandGeometry = new THREE.ConeGeometry(1, 1, 7);
    ownedGeometries.push(rockGeometry, islandGeometry);
    for (let index = 0; index < SCENERY_ROCKS; index += 1) {
      const angle = (index / SCENERY_ROCKS) * Math.PI * 2 + (course.seed % 7);
      const distance = span * 0.75 + 8 + ((course.seed * (index + 3)) % 11);
      const island = index % 3 === 0;
      const mesh = new THREE.Mesh(island ? islandGeometry : rockGeometry, island ? materials.island : materials.rock);
      const size = island ? 4 + (index % 4) * 2 : 0.8 + (index % 3) * 0.6;
      mesh.scale.set(size * (island ? 2.2 : 1), size, size * (island ? 2.2 : 1));
      mesh.position.set(centreX + Math.sin(angle) * distance, course.waterY + WATER_ABOVE_SPLASH_M - 0.2 + (island ? size / 2 - 0.6 : 0), centreZ + Math.cos(angle) * distance);
      group.add(mesh);
    }
  }

  /** @param {Readonly<BumperLinksCourse>} course */
  function buildBumperLinksHole(course) {
    disposeBumperLinksHole();
    builtSeed = course.seed;
    holeGroup = new THREE.Group();
    const floorMaterials = [materials.earth, materials.earth, materials.green, materials.earth, materials.earth, materials.earth];
    const floorDarkMaterials = [materials.earth, materials.earth, materials.greenDark, materials.earth, materials.earth, materials.earth];
    let floorIndex = 0;
    for (const solid of course.solids) {
      const kind = classifyBumperLinksSolid(course, solid);
      if (kind === "floor") {
        holeGroup.add(createSolidMesh(solid, floorIndex % 2 === 0 ? floorMaterials : floorDarkMaterials));
        floorIndex += 1;
      } else if (kind === "rail") {
        holeGroup.add(createSolidMesh(solid, materials.rail));
      } else {
        holeGroup.add(createSolidMesh(solid, kind === "pivot" ? materials.pivot : materials.post));
      }
    }

    const teeMat = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.4), materials.tee);
    ownedGeometries.push(teeMat.geometry);
    teeMat.rotation.set(-Math.PI / 2, 0, course.teeYaw);
    teeMat.position.set(course.tee.x, course.tee.y - 0.215, course.tee.z);
    teeMat.receiveShadow = true;
    holeGroup.add(teeMat);

    const cupHole = new THREE.Mesh(new THREE.CircleGeometry(BUMPER_LINKS_CUP.radius * 0.8, 28), materials.cup);
    const cupRim = new THREE.Mesh(new THREE.RingGeometry(BUMPER_LINKS_CUP.radius * 0.8, BUMPER_LINKS_CUP.radius * 0.92, 28), materials.cupRim);
    ownedGeometries.push(cupHole.geometry, cupRim.geometry);
    for (const disc of [cupHole, cupRim]) {
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(course.cup.x, course.cup.y + 0.004, course.cup.z);
      holeGroup.add(disc);
    }
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 2.2, 8), materials.flagPole);
    ownedGeometries.push(pole.geometry);
    pole.position.set(course.cup.x, course.cup.y + 1.1, course.cup.z);
    pole.castShadow = true;
    const flagShape = new THREE.BufferGeometry();
    flagShape.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, 0.75, -0.22, 0, 0, -0.44, 0], 3));
    flagShape.computeVertexNormals();
    ownedGeometries.push(flagShape);
    flag = new THREE.Mesh(flagShape, materials.flag);
    flag.position.set(course.cup.x, course.cup.y + 2.2, course.cup.z);
    flag.castShadow = true;
    holeGroup.add(pole, flag);

    sweeperBars = course.sweepers.map((sweeper) => {
      const bar = new THREE.Mesh(unitBox, materials.sweeper);
      bar.scale.set(BUMPER_LINKS_SWEEPER.thickness, BUMPER_LINKS_SWEEPER.height * 0.7, BUMPER_LINKS_SWEEPER.length);
      bar.position.set(sweeper.x, sweeper.y + BUMPER_LINKS_SWEEPER.height * 0.4, sweeper.z);
      bar.castShadow = true;
      holeGroup.add(bar);
      return { bar, phase: sweeper.phase };
    });

    addBumperLinksScenery(course, holeGroup);
    water.position.y = course.waterY + WATER_ABOVE_SPLASH_M;
    scene.add(holeGroup);
  }

  function disposeBumperLinksHole() {
    if (!holeGroup) return;
    scene.remove(holeGroup);
    for (const geometry of ownedGeometries) geometry.dispose();
    ownedGeometries = [];
    holeGroup = null;
    sweeperBars = [];
    flag = null;
  }

  return {
    /**
     * @param {Readonly<BumperLinksCourse>} course
     * @param {number} holeTimeSec Presentation hole clock for the sweepers.
     * @param {number} timeSec Monotonic clock for idle motion.
     * @param {boolean} reducedMotion
     */
    update(course, holeTimeSec, timeSec, reducedMotion) {
      if (course.seed !== builtSeed || !holeGroup) buildBumperLinksHole(course);
      for (const { bar, phase } of sweeperBars) bar.rotation.y = phase + BUMPER_LINKS_SWEEPER.angularSpeed * holeTimeSec;
      if (flag && !reducedMotion) flag.rotation.y = Math.sin(timeSec * 1.7) * 0.35;
      water.material.opacity = reducedMotion ? 0.88 : 0.86 + Math.sin(timeSec * 0.8) * 0.03;
    },
    /** Course centre and size, for the overview camera. */
    getWaterY: () => water.position.y,
    dispose() {
      disposeBumperLinksHole();
      water.geometry.dispose();
      unitBox.dispose();
      for (const material of Object.values(materials)) material.dispose();
    },
  };
}
