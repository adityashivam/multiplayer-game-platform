import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";

/**
 * Realistic car body, adapted from the Khronos CarConcept sample (CC BY 4.0).
 * See public/games/driftline/assets/cars/CREDITS.md.
 */
export const DRIFTLINE_CAR_MODEL_URL = "/games/driftline/assets/cars/concept-car.glb";
const WHEEL_NODE_NAMES = Object.freeze(["WheelFrontL", "WheelFrontR", "WheelRearL", "WheelRearR"]);
const PAINT_MATERIAL_NAME = "Paint 1 Carmine";
const BRAKE_LIGHT_MATERIAL_NAME = "Brakelight";
const SPIN_AXIS = new THREE.Vector3(1, 0, 0);
const STEER_AXIS = new THREE.Vector3(0, 0, 1);

/**
 * @typedef {object} DriftlineCarModelInstance
 * @property {THREE.Object3D} root
 * @property {THREE.Object3D[]} wheels Front left, front right, rear left, rear right.
 * @property {THREE.MeshPhysicalMaterial|THREE.MeshStandardMaterial|null} paint Owned by this instance.
 * @property {THREE.MeshPhysicalMaterial|THREE.MeshStandardMaterial|null} brakeLight Owned by this instance.
 */

/** @type {Promise<THREE.Group>|null} */
let templatePromise = null;

/**
 * Load and cache the shared car template once per page. Geometry and most
 * materials are shared by every car; rejection leaves callers on the fallback.
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
      return gltf.scene;
    });
  }
  return templatePromise;
}

/**
 * Clone the template for one car: shared geometry, an owned paint colour and
 * an owned brake-light material so lights and colours stay independent.
 * @param {THREE.Group} template
 * @param {THREE.Color} paintColor
 * @returns {DriftlineCarModelInstance}
 */
export function createDriftlineCarModelInstance(template, paintColor) {
  const root = template.clone(true);
  let paint = null;
  let brakeLight = null;
  root.traverse((child) => {
    if (!child.isMesh) return;
    const materialName = child.material?.name;
    if (materialName === PAINT_MATERIAL_NAME) {
      paint ??= child.material.clone();
      paint.color.copy(paintColor);
      child.material = paint;
    } else if (materialName === BRAKE_LIGHT_MATERIAL_NAME) {
      brakeLight ??= child.material.clone();
      brakeLight.emissive.set("#ff1a0a");
      child.material = brakeLight;
    }
  });
  const wheels = WHEEL_NODE_NAMES.map((name) => root.getObjectByName(name));
  if (wheels.some((wheel) => !wheel)) throw new Error("Car model is missing a named wheel node.");
  return { root, wheels, paint, brakeLight };
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
 * Release materials owned by one instance; shared template resources stay.
 * @param {DriftlineCarModelInstance} instance
 */
export function disposeDriftlineCarModelInstance(instance) {
  instance.paint?.dispose();
  instance.brakeLight?.dispose();
}
