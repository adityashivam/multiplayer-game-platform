import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

/** @typedef {import("./liveries.js").DriftlineLivery} DriftlineLivery */

/**
 * Realistic car body, adapted from the Khronos CarConcept sample (CC BY 4.0).
 * See public/games/driftline/assets/cars/CREDITS.md.
 */
export const DRIFTLINE_CAR_MODEL_URL = "/games/driftline/assets/cars/concept-car.glb";
const WHEEL_NODE_NAMES = Object.freeze(["WheelFrontL", "WheelFrontR", "WheelRearL", "WheelRearR"]);
const PAINT_MATERIAL_NAME = "Paint 1 Carmine";
const ACCENT_MATERIAL_NAME = "Paint 2 Carmine";
const RIM_MATERIAL_NAME = "Rim2";
const BRAKE_LIGHT_MATERIAL_NAME = "Brakelight";
const SPIN_AXIS = new THREE.Vector3(1, 0, 0);
const STEER_AXIS = new THREE.Vector3(0, 0, 1);
const STRIPE_MODES = Object.freeze({ none: 0, twin: 1, single: 2, side: 3 });
const PAINT_FINISHES = Object.freeze({
  gloss: { metalness: 0.45, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06, sheen: 0 },
  matte: { metalness: 0.15, roughness: 0.78, clearcoat: 0, clearcoatRoughness: 1, sheen: 0 },
  pearl: { metalness: 0.7, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.04, sheen: 0.6 },
  candy: { metalness: 0.9, roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.03, sheen: 0 },
});
const RIM_FINISHES = Object.freeze({
  chrome: { color: "#dfe3e8", metalness: 1, roughness: 0.16 },
  black: { color: "#16171a", metalness: 0.6, roughness: 0.35 },
  bronze: { color: "#8f5b2c", metalness: 0.9, roughness: 0.3 },
  gold: { color: "#c9a14a", metalness: 1, roughness: 0.22 },
  gunmetal: { color: "#474c55", metalness: 0.9, roughness: 0.3 },
});
/** Anchor points measured from the model: rear deck lip and hood centre, in car space. */
const REAR_DECK = Object.freeze({ y: 0.96, z: -1.72 });
const TAIL_EDGE = Object.freeze({ y: 0.84, z: -1.9 });
const HOOD_CENTER = Object.freeze({ y: 0.9, z: 1.32 });

/**
 * @typedef {object} DriftlineCarModelInstance
 * @property {THREE.Object3D} root
 * @property {THREE.Object3D[]} wheels Front left, front right, rear left, rear right.
 * @property {THREE.Material[]} ownedMaterials Disposed with the instance.
 * @property {THREE.BufferGeometry[]} ownedGeometries Disposed with the instance.
 * @property {THREE.MeshStandardMaterial|null} brakeLight
 */

/** @type {Promise<THREE.Group>|null} */
let templatePromise = null;

/**
 * Store each painted vertex's car-space position and normal once, so the
 * stripe shader stays fixed to the body whatever node transforms or vertex
 * quantization the file uses. Geometry is shared by every car clone.
 * @param {THREE.Group} template
 */
function bakeDriftlineCarSpace(template) {
  template.updateMatrixWorld(true);
  const point = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();
  template.traverse((child) => {
    if (!child.isMesh || child.material?.name !== PAINT_MATERIAL_NAME) return;
    if (child.geometry.getAttribute("carPosition")) child.geometry = child.geometry.clone();
    const positions = child.geometry.getAttribute("position");
    const normals = child.geometry.getAttribute("normal");
    const carPositions = new Float32Array(positions.count * 3);
    const carNormals = new Float32Array(positions.count * 3);
    normalMatrix.getNormalMatrix(child.matrixWorld);
    for (let index = 0; index < positions.count; index += 1) {
      point.fromBufferAttribute(positions, index).applyMatrix4(child.matrixWorld);
      carPositions.set([point.x, point.y, point.z], index * 3);
      if (normals) {
        normal.fromBufferAttribute(normals, index).applyMatrix3(normalMatrix).normalize();
        carNormals.set([normal.x, normal.y, normal.z], index * 3);
      }
    }
    child.geometry.setAttribute("carPosition", new THREE.BufferAttribute(carPositions, 3));
    child.geometry.setAttribute("carNormal", new THREE.BufferAttribute(carNormals, 3));
  });
}

/**
 * Load and cache the shared car template once per page. Rejection leaves
 * callers on the procedural fallback.
 * @returns {Promise<THREE.Group>}
 */
export function loadDriftlineCarTemplate() {
  if (!templatePromise) {
    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    templatePromise = loader.loadAsync(DRIFTLINE_CAR_MODEL_URL).then((gltf) => {
      gltf.scene.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = false;
        }
      });
      bakeDriftlineCarSpace(gltf.scene);
      return gltf.scene;
    });
  }
  return templatePromise;
}

/**
 * Paint with optional stripes drawn in car space: twin and single stripes on
 * upward-facing panels, a side band on the flanks.
 * @param {THREE.MeshPhysicalMaterial} source
 * @param {THREE.Color} paintColor
 * @param {Readonly<DriftlineLivery>} livery
 */
function createDriftlinePaint(source, paintColor, livery) {
  const paint = /** @type {THREE.MeshPhysicalMaterial} */ (source.clone());
  const finish = PAINT_FINISHES[livery.finish] ?? PAINT_FINISHES.gloss;
  paint.color.copy(paintColor);
  paint.metalness = finish.metalness;
  paint.roughness = finish.roughness;
  if ("clearcoat" in paint) {
    paint.clearcoat = finish.clearcoat;
    paint.clearcoatRoughness = finish.clearcoatRoughness;
    paint.sheen = finish.sheen;
    paint.sheenColor?.copy(paintColor).lerp(new THREE.Color("#ffffff"), 0.6);
  }
  if (livery.finish === "matte") paint.normalMap = null;
  const stripeMode = STRIPE_MODES[livery.stripes] ?? 0;
  if (stripeMode === 0) return paint;

  const stripeColor = new THREE.Color(livery.stripeColor);
  paint.onBeforeCompile = (shader) => {
    shader.uniforms.stripeColor = { value: stripeColor };
    shader.uniforms.stripeMode = { value: stripeMode };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 carPosition;\nattribute vec3 carNormal;\nvarying vec3 vCarPosition;\nvarying vec3 vCarNormal;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvCarPosition = carPosition;\nvCarNormal = carNormal;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 stripeColor;\nuniform int stripeMode;\nvarying vec3 vCarPosition;\nvarying vec3 vCarNormal;")
      .replace("#include <color_fragment>", `#include <color_fragment>
      float stripeMask = 0.0;
      float upward = smoothstep(0.35, 0.55, vCarNormal.y);
      if (stripeMode == 1) {
        float lane = abs(abs(vCarPosition.x) - 0.33);
        stripeMask = (1.0 - smoothstep(0.075, 0.085, lane)) * upward;
      } else if (stripeMode == 2) {
        stripeMask = (1.0 - smoothstep(0.17, 0.18, abs(vCarPosition.x))) * upward;
      } else if (stripeMode == 3) {
        float sideways = smoothstep(0.55, 0.75, abs(vCarNormal.x));
        float band = 1.0 - smoothstep(0.035, 0.045, abs(vCarPosition.y - 0.5));
        stripeMask = band * sideways;
      }
      diffuseColor.rgb = mix(diffuseColor.rgb, stripeColor, stripeMask);`);
  };
  paint.customProgramCacheKey = () => "driftline-striped-paint";
  return paint;
}

/**
 * Bolt-on parts in car space (Y up, +Z forward). Wings use dark carbon;
 * scoops and ducktails match the body paint.
 * @param {readonly import("./liveries.js").DriftlineBodyAddon[]} addons
 * @param {THREE.Material} paint
 * @param {THREE.Material} carbon
 * @param {THREE.BufferGeometry[]} ownedGeometries
 */
function createDriftlineAddons(addons, paint, carbon, ownedGeometries) {
  const group = new THREE.Group();
  const addMesh = (geometry, material, x, y, z, tiltX = 0) => {
    ownedGeometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    mesh.rotation.x = tiltX;
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  };
  for (const addon of addons) {
    if (addon === "hoodScoop") {
      addMesh(new THREE.BoxGeometry(0.46, 0.09, 0.56), paint, 0, HOOD_CENTER.y + 0.04, HOOD_CENTER.z, -0.12);
      addMesh(new THREE.BoxGeometry(0.36, 0.05, 0.04), carbon, 0, HOOD_CENTER.y + 0.07, HOOD_CENTER.z + 0.27);
    } else if (addon === "ducktail") {
      addMesh(new THREE.BoxGeometry(1.5, 0.05, 0.22), paint, 0, TAIL_EDGE.y + 0.07, TAIL_EDGE.z + 0.05, 0.38);
    } else if (addon === "gtWing") {
      addMesh(new THREE.BoxGeometry(1.78, 0.04, 0.36), carbon, 0, REAR_DECK.y + 0.36, REAR_DECK.z - 0.05, 0.14);
      for (const side of [1, -1]) {
        addMesh(new THREE.BoxGeometry(0.035, 0.36, 0.2), carbon, side * 0.45, REAR_DECK.y + 0.17, REAR_DECK.z);
        addMesh(new THREE.BoxGeometry(0.03, 0.16, 0.42), carbon, side * 0.89, REAR_DECK.y + 0.36, REAR_DECK.z - 0.05);
      }
    } else if (addon === "lowWing") {
      addMesh(new THREE.BoxGeometry(1.5, 0.035, 0.28), carbon, 0, REAR_DECK.y + 0.14, REAR_DECK.z - 0.04, 0.1);
      for (const side of [1, -1]) addMesh(new THREE.BoxGeometry(0.03, 0.14, 0.14), carbon, side * 0.4, REAR_DECK.y + 0.06, REAR_DECK.z);
    }
  }
  return group;
}

/**
 * Clone the template for one car and dress it in a livery. Geometry is
 * shared; paint, accent, rims, brake lights and add-ons are owned per car.
 * Looks only: nothing here touches simulation.
 * @param {THREE.Group} template
 * @param {THREE.Color} paintColor
 * @param {Readonly<DriftlineLivery>} livery
 * @returns {DriftlineCarModelInstance}
 */
export function createDriftlineCarModelInstance(template, paintColor, livery) {
  const root = template.clone(true);
  /** @type {THREE.Material[]} */
  const ownedMaterials = [];
  /** @type {THREE.BufferGeometry[]} */
  const ownedGeometries = [];
  const replacements = new Map();
  const replace = (material, create) => {
    if (!replacements.has(material)) {
      const owned = create(material);
      replacements.set(material, owned);
      ownedMaterials.push(owned);
    }
    return replacements.get(material);
  };
  let paint = null;
  let brakeLight = null;
  root.traverse((child) => {
    if (!child.isMesh) return;
    const name = child.material?.name;
    if (name === PAINT_MATERIAL_NAME) {
      paint = replace(child.material, (source) => createDriftlinePaint(source, paintColor, livery));
      child.material = paint;
    } else if (name === ACCENT_MATERIAL_NAME && livery.accentColor) {
      child.material = replace(child.material, (source) => {
        const accent = source.clone();
        accent.color.set(livery.accentColor);
        return accent;
      });
    } else if (name === RIM_MATERIAL_NAME) {
      child.material = replace(child.material, (source) => {
        const rim = source.clone();
        const finish = RIM_FINISHES[livery.rims] ?? RIM_FINISHES.chrome;
        rim.color.set(finish.color);
        rim.metalness = finish.metalness;
        rim.roughness = finish.roughness;
        return rim;
      });
    } else if (name === BRAKE_LIGHT_MATERIAL_NAME) {
      brakeLight = replace(child.material, (source) => {
        const light = source.clone();
        light.emissive.set("#ff1a0a");
        return light;
      });
      child.material = brakeLight;
    }
  });
  const wheels = WHEEL_NODE_NAMES.map((name) => root.getObjectByName(name));
  if (wheels.some((wheel) => !wheel)) throw new Error("Car model is missing a named wheel node.");
  if (livery.addons.length > 0 && paint) {
    const carbon = new THREE.MeshStandardMaterial({ color: "#121316", metalness: 0.4, roughness: 0.35 });
    ownedMaterials.push(carbon);
    root.add(createDriftlineAddons(livery.addons, paint, carbon, ownedGeometries));
  }
  return { root, wheels, ownedMaterials, ownedGeometries, brakeLight };
}

const steerRotation = new THREE.Quaternion();
const spinRotation = new THREE.Quaternion();

/**
 * Pose the model's wheels. They live in the model's Z-up frame: X is the
 * axle and Z is up, so steering turns about Z and rolling spins about X.
 * Replaces the authored rest rotation, which has the front wheels turned.
 * @param {DriftlineCarModelInstance} instance
 * @param {number} steerRad Positive turns toward +yaw (left).
 * @param {number} frontSpinRad
 * @param {number} rearSpinRad
 */
export function poseDriftlineCarModelWheels(instance, steerRad, frontSpinRad, rearSpinRad) {
  steerRotation.setFromAxisAngle(STEER_AXIS, steerRad);
  instance.wheels.forEach((wheel, index) => {
    const front = index < 2;
    spinRotation.setFromAxisAngle(SPIN_AXIS, front ? frontSpinRad : rearSpinRad);
    if (front) wheel.quaternion.multiplyQuaternions(steerRotation, spinRotation);
    else wheel.quaternion.copy(spinRotation);
  });
}

/**
 * Release resources owned by one instance; shared template resources stay.
 * @param {DriftlineCarModelInstance} instance
 */
export function disposeDriftlineCarModelInstance(instance) {
  instance.ownedMaterials.forEach((material) => material.dispose());
  instance.ownedGeometries.forEach((geometry) => geometry.dispose());
}
