import * as THREE from "three";
import { DRIFTLINE_CAR_COLORS } from "../shared/config.js";
import {
  createDriftlineCarModelInstance,
  disposeDriftlineCarModelInstance,
  loadDriftlineCarTemplate,
  poseDriftlineCarModelWheels,
} from "./carModel.js";

/** @typedef {import("../client/snapshotPose.js").DriftlinePresentedCar} DriftlinePresentedCar */

const WHEEL_RADIUS_M = 0.36;
const WHEEL_WIDTH_M = 0.27;
const TRACK_HALF_WIDTH_M = 0.86;
const FRONT_AXLE_Z = 1.3;
const REAR_AXLE_Z = -1.32;
const VISUAL_STEER_RAD = 0.42;
const BODY_WIDTH_M = 1.8;
const MAX_CAR_VIEWS = 8;
const LABEL_WIDTH = 128;
const LABEL_HEIGHT = 40;
const BOOST_COLORS = Object.freeze(["#ffb347", "#ff7a3d", "#57d6ff"]);
/** Rear wheel centres of the realistic model, used for smoke and skid marks. */
const MODEL_REAR_TRACK_HALF_WIDTH_M = 0.96;
const MODEL_REAR_AXLE_Z = -1.31;
const MODEL_EXHAUST = Object.freeze({ x: 0.45, y: 0.36, z: -2.02 });

/** Side profile of a low coupe in (forward, up) metres. */
const BODY_PROFILE = Object.freeze([
  [-2.15, 0.3], [2.1, 0.3], [2.2, 0.48], [2.12, 0.68], [1.2, 0.84], [0.75, 0.9],
  [-1.55, 0.94], [-2.05, 0.92], [-2.2, 0.72], [-2.2, 0.42],
]);
const CABIN_PROFILE = Object.freeze([[0.78, 0.88], [0.08, 1.3], [-0.95, 1.3], [-1.62, 0.93]]);

/**
 * Extrude a closed side profile across the car's width, oriented so forward
 * is +Z and width runs along X.
 * @param {ReadonlyArray<readonly [number,number]>} profile
 * @param {number} width
 * @param {number} bevel
 */
function extrudeDriftlineProfile(profile, width, bevel) {
  const shape = new THREE.Shape(profile.map(([forward, up]) => new THREE.Vector2(forward, up)));
  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: width - bevel * 2,
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 3,
    curveSegments: 4,
  });
  geometry.translate(0, 0, -(width - bevel * 2) / 2);
  geometry.rotateY(-Math.PI / 2);
  geometry.computeVertexNormals();
  return geometry;
}

/** Soft oval used as a contact shadow under each car. */
function createDriftlineShadowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(32, 64, 4, 32, 64, 60);
  gradient.addColorStop(0, "#ffffff");
  gradient.addColorStop(0.6, "#888888");
  gradient.addColorStop(1, "#000000");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 64, 128);
  return new THREE.CanvasTexture(canvas);
}

/** Geometry shared by every car. */
function createDriftlineCarGeometry() {
  const tire = new THREE.CylinderGeometry(WHEEL_RADIUS_M, WHEEL_RADIUS_M, WHEEL_WIDTH_M, 20).rotateZ(Math.PI / 2);
  const rim = new THREE.CylinderGeometry(WHEEL_RADIUS_M * 0.62, WHEEL_RADIUS_M * 0.62, WHEEL_WIDTH_M + 0.02, 10).rotateZ(Math.PI / 2);
  return {
    body: extrudeDriftlineProfile(BODY_PROFILE, BODY_WIDTH_M, 0.09),
    cabin: extrudeDriftlineProfile(CABIN_PROFILE, BODY_WIDTH_M - 0.3, 0.05),
    tire,
    rim,
    spoiler: new THREE.BoxGeometry(1.6, 0.06, 0.38),
    spoilerLeg: new THREE.BoxGeometry(0.06, 0.24, 0.12),
    light: new THREE.BoxGeometry(0.46, 0.13, 0.06),
    plate: new THREE.BoxGeometry(1.5, 0.22, 0.05),
    flame: new THREE.ConeGeometry(0.17, 1.1, 10, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -0.55),
    shadow: new THREE.PlaneGeometry(2.2, 4.8).rotateX(-Math.PI / 2),
    label: new THREE.PlaneGeometry(1.6, (1.6 * LABEL_HEIGHT) / LABEL_WIDTH),
  };
}

/** @param {number} colorIndex */
function createDriftlineCarMaterials(colorIndex) {
  const paint = new THREE.Color(DRIFTLINE_CAR_COLORS[colorIndex % DRIFTLINE_CAR_COLORS.length]);
  return {
    paint: new THREE.MeshPhysicalMaterial({ color: paint, metalness: 0.55, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 }),
    glass: new THREE.MeshPhysicalMaterial({ color: "#0d1117", metalness: 0.2, roughness: 0.05, clearcoat: 1 }),
    tire: new THREE.MeshStandardMaterial({ color: "#151515", roughness: 0.9 }),
    rim: new THREE.MeshStandardMaterial({ color: "#c6c9cf", metalness: 0.9, roughness: 0.25 }),
    trim: new THREE.MeshStandardMaterial({ color: "#16161a", roughness: 0.6 }),
    head: new THREE.MeshStandardMaterial({ color: "#fffbe8", emissive: "#fff3c4", emissiveIntensity: 1.6 }),
    tail: new THREE.MeshStandardMaterial({ color: "#5a0d0d", emissive: "#ff2a1a", emissiveIntensity: 0.8 }),
    flame: new THREE.MeshBasicMaterial({ color: "#57d6ff", transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    shadow: new THREE.MeshBasicMaterial({ color: "#000000", transparent: true, opacity: 0.38, depthWrite: false, alphaMap: createDriftlineShadowTexture() }),
  };
}

/**
 * @param {ReturnType<typeof createDriftlineCarGeometry>} geometry
 * @param {number} colorIndex
 * @param {string} labelText
 */
function createDriftlineCarRig(geometry, colorIndex, labelText) {
  const materials = createDriftlineCarMaterials(colorIndex);
  const root = new THREE.Group();
  const turn = new THREE.Group();
  const chassis = new THREE.Group();
  root.add(turn);
  turn.add(chassis);
  const body = new THREE.Mesh(geometry.body, materials.paint);
  const cabin = new THREE.Mesh(geometry.cabin, materials.glass);
  body.castShadow = true;
  cabin.castShadow = true;
  chassis.add(body, cabin);
  const diffuser = new THREE.Mesh(geometry.plate, materials.trim);
  diffuser.position.set(0, 0.42, -2.3);
  chassis.add(diffuser);
  const spoiler = new THREE.Mesh(geometry.spoiler, materials.trim);
  spoiler.position.set(0, 1.18, -1.95);
  chassis.add(spoiler);
  for (const side of [1, -1]) {
    const leg = new THREE.Mesh(geometry.spoilerLeg, materials.trim);
    leg.position.set(side * 0.55, 1.03, -1.95);
    chassis.add(leg);
    const head = new THREE.Mesh(geometry.light, materials.head);
    head.position.set(side * 0.6, 0.6, 2.29);
    const tail = new THREE.Mesh(geometry.light, materials.tail);
    tail.position.set(side * 0.6, 0.72, -2.31);
    chassis.add(head, tail);
  }

  /** @param {number} side @param {number} axleZ */
  const createWheel = (side, axleZ) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * TRACK_HALF_WIDTH_M, WHEEL_RADIUS_M, axleZ);
    const spinner = new THREE.Group();
    const tire = new THREE.Mesh(geometry.tire, materials.tire);
    const rim = new THREE.Mesh(geometry.rim, materials.rim);
    tire.castShadow = true;
    spinner.add(tire, rim);
    pivot.add(spinner);
    turn.add(pivot);
    return { pivot, spinner };
  };
  const wheels = [createWheel(1, FRONT_AXLE_Z), createWheel(-1, FRONT_AXLE_Z), createWheel(1, REAR_AXLE_Z), createWheel(-1, REAR_AXLE_Z)];

  const flames = [0.42, -0.42].map((offsetX) => {
    const flame = new THREE.Mesh(geometry.flame, materials.flame);
    flame.position.set(offsetX, 0.42, -2.33);
    flame.visible = false;
    chassis.add(flame);
    return flame;
  });
  const shadow = new THREE.Mesh(geometry.shadow, materials.shadow);
  shadow.position.y = 0.03;
  turn.add(shadow);

  const labelCanvas = document.createElement("canvas");
  labelCanvas.width = LABEL_WIDTH;
  labelCanvas.height = LABEL_HEIGHT;
  const labelContext = labelCanvas.getContext("2d");
  labelContext.fillStyle = "rgba(18,13,26,0.7)";
  labelContext.beginPath();
  labelContext.roundRect(4, 4, LABEL_WIDTH - 8, LABEL_HEIGHT - 8, 10);
  labelContext.fill();
  labelContext.font = "700 22px 'Space Grotesk', sans-serif";
  labelContext.textAlign = "center";
  labelContext.textBaseline = "middle";
  labelContext.fillStyle = DRIFTLINE_CAR_COLORS[colorIndex % DRIFTLINE_CAR_COLORS.length];
  labelContext.fillText(labelText, LABEL_WIDTH / 2, LABEL_HEIGHT / 2 + 1);
  const labelTexture = new THREE.CanvasTexture(labelCanvas);
  labelTexture.colorSpace = THREE.SRGBColorSpace;
  const labelMaterial = new THREE.MeshBasicMaterial({ map: labelTexture, transparent: true, depthWrite: false, toneMapped: false });
  const label = new THREE.Mesh(geometry.label, labelMaterial);
  label.position.y = 2.3;
  root.add(label);

  return {
    root, turn, chassis, wheels, flames, label, materials, labelTexture, labelMaterial,
    colorIndex,
    /** @type {import("./carModel.js").DriftlineCarModelInstance|null} */
    model: null,
    wheelSpin: 0,
    /** Rear wheel angle frozen while the handbrake locks them, or null. */
    lockedRearSpin: /** @type {number|null} */ (null),
    bodyRoll: 0,
    bodyPitch: 0,
  };
}

/**
 * Swap the procedural body for the realistic model, keeping flames, label and
 * contact shadow. The procedural parts stay hidden as a fallback.
 * @param {ReturnType<typeof createDriftlineCarRig>} rig
 * @param {THREE.Group} template
 */
function attachDriftlineCarModel(rig, template) {
  const paint = new THREE.Color(DRIFTLINE_CAR_COLORS[rig.colorIndex % DRIFTLINE_CAR_COLORS.length]);
  rig.model = createDriftlineCarModelInstance(template, paint);
  for (const child of rig.chassis.children) if (!rig.flames.includes(child)) child.visible = false;
  for (const wheel of rig.wheels) wheel.pivot.visible = false;
  rig.flames.forEach((flame, index) => flame.position.set((index === 0 ? 1 : -1) * MODEL_EXHAUST.x, MODEL_EXHAUST.y, MODEL_EXHAUST.z));
  rig.chassis.add(rig.model.root);
}

/**
 * Car rigs keyed by car ID, created on first sight and bounded. Visual
 * transforms (wheel spin, steering, body roll and pitch) never feed back
 * into simulation.
 * @param {THREE.Scene} scene
 * @returns {{update(cars:readonly DriftlinePresentedCar[],playerId:string,camera:THREE.Camera,dtSec:number):void,dispose():void}}
 */
export function createDriftlineCarViews(scene) {
  const geometry = createDriftlineCarGeometry();
  /** @type {Map<string,ReturnType<typeof createDriftlineCarRig>>} */
  const rigs = new Map();
  const seen = new Set();
  /** @type {THREE.Group|null} */
  let modelTemplate = null;
  let disposed = false;
  loadDriftlineCarTemplate().then((template) => {
    if (disposed) return;
    modelTemplate = template;
    for (const rig of rigs.values()) if (!rig.model) attachDriftlineCarModel(rig, template);
  }).catch((error) => console.warn("Driftline car model unavailable; using the procedural car.", error));

  return {
    update(cars, playerId, camera, dtSec) {
      seen.clear();
      for (const car of cars) {
        let rig = rigs.get(car.id);
        if (!rig) {
          if (rigs.size >= MAX_CAR_VIEWS) continue;
          rig = createDriftlineCarRig(geometry, car.colorIndex, car.isBot ? `BOT ${car.slotIndex + 1}` : car.id.toUpperCase());
          rigs.set(car.id, rig);
          scene.add(rig.root);
          if (modelTemplate) attachDriftlineCarModel(rig, modelTemplate);
        }
        seen.add(car.id);
        rig.root.visible = true;
        rig.root.position.set(car.x, car.y, car.z);
        rig.turn.rotation.y = car.yaw;

        const forwardSpeed = car.vx * Math.sin(car.yaw) + car.vz * Math.cos(car.yaw);
        const lateralSpeed = car.vx * Math.cos(car.yaw) - car.vz * Math.sin(car.yaw);
        rig.wheelSpin += (forwardSpeed / WHEEL_RADIUS_M) * dtSec;
        const rearSpin = rig.wheelSpin + (car.throttle > 0.5 && Math.abs(car.driftAngle) > 0.2 ? dtSec * 12 : 0);
        if (car.handbrake) rig.lockedRearSpin ??= rearSpin;
        else rig.lockedRearSpin = null;
        const rearWheelSpin = rig.lockedRearSpin ?? rearSpin;
        if (rig.model) {
          poseDriftlineCarModelWheels(rig.model, -car.steer * VISUAL_STEER_RAD, rig.wheelSpin, rearWheelSpin);
        } else {
          rig.wheels.forEach((wheel, index) => {
            wheel.spinner.rotation.x = index < 2 ? rig.wheelSpin : rearWheelSpin;
            if (index < 2) wheel.pivot.rotation.y = -car.steer * VISUAL_STEER_RAD;
          });
        }
        const blend = Math.min(1, dtSec * 6);
        rig.bodyRoll += (Math.max(-0.07, Math.min(0.07, lateralSpeed * 0.012)) - rig.bodyRoll) * blend;
        rig.bodyPitch += ((car.brake > 0.1 ? 0.025 : car.throttle > 0.5 ? -0.018 : 0) - rig.bodyPitch) * blend;
        rig.chassis.rotation.set(rig.bodyPitch, 0, rig.bodyRoll);

        const braking = car.brake > 0.1 || car.handbrake;
        rig.materials.tail.emissiveIntensity = braking ? 3.2 : 0.8;
        if (rig.model?.brakeLight) rig.model.brakeLight.emissiveIntensity = braking ? 8 : 2;
        const boosting = car.boostSec > 0;
        for (const flame of rig.flames) {
          flame.visible = boosting;
          if (boosting) flame.scale.set(1, 1, 0.8 + Math.random() * 0.5 + car.boostTier * 0.25);
        }
        if (boosting) rig.materials.flame.color.set(BOOST_COLORS[Math.max(0, Math.min(2, car.boostTier - 1))]);
        rig.label.visible = car.id !== playerId;
        rig.label.quaternion.copy(camera.quaternion);
      }
      for (const [carId, rig] of rigs) if (!seen.has(carId)) rig.root.visible = false;
    },
    dispose() {
      disposed = true;
      for (const rig of rigs.values()) {
        scene.remove(rig.root);
        if (rig.model) disposeDriftlineCarModelInstance(rig.model);
        rig.materials.shadow.alphaMap?.dispose();
        Object.values(rig.materials).forEach((material) => material.dispose());
        rig.labelTexture.dispose();
        rig.labelMaterial.dispose();
      }
      rigs.clear();
      Object.values(geometry).forEach((shape) => shape.dispose());
    },
  };
}

/** Rear wheel contact points in car space, for smoke and skid marks. */
export const DRIFTLINE_REAR_WHEELS = Object.freeze([
  Object.freeze({ x: MODEL_REAR_TRACK_HALF_WIDTH_M, z: MODEL_REAR_AXLE_Z }),
  Object.freeze({ x: -MODEL_REAR_TRACK_HALF_WIDTH_M, z: MODEL_REAR_AXLE_Z }),
]);
