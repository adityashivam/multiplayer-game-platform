import * as THREE from "three";
import { LUDO_COLORS, LUDO_LIMITS, LUDO_PALETTE } from "../shared/config.js";
import { getLudoTokenCell } from "../shared/rules.js";
import { getLudoStackOffset } from "./presentation.js";
import { clampLudoUnit, createLudoContactTexture, easeLudoSmooth } from "./resources.js";

/** @typedef {import("./resources.js").LudoResources} LudoResources */
/** @typedef {import("../shared/rules.js").LudoRoundState} LudoRoundState */
/** @typedef {import("./presentation.js").LudoActionFrame} LudoActionFrame */

const TRACK_GROUND_Y = 0.25;
const YARD_GROUND_Y = 0.395;

/** @param {number} progress */
function getLudoPawnGroundY(progress) {
  return progress < 0 ? YARD_GROUND_Y : TRACK_GROUND_Y;
}

/** @param {LudoResources} resources */
function createLudoPawnGeometry(resources) {
  const profile = [
    [0, 0], [0.30, 0], [0.35, 0.025], [0.36, 0.07], [0.35, 0.12],
    [0.29, 0.17], [0.22, 0.23], [0.18, 0.38], [0.18, 0.47],
    [0.21, 0.55], [0.27, 0.61], [0.30, 0.70], [0.30, 0.79],
    [0.27, 0.89], [0.19, 0.98], [0.09, 1.025], [0, 1.04],
  ].map(([radius, height]) => new THREE.Vector2(radius, height));

  return {
    body: resources.geometry(new THREE.LatheGeometry(profile, 36)),
    baseAccent: resources.geometry(new THREE.TorusGeometry(0.328, 0.018, 7, 36)),
    collar: resources.geometry(new THREE.TorusGeometry(0.202, 0.012, 6, 32)),
    legalRing: resources.geometry(new THREE.RingGeometry(0.425, 0.49, 40)),
    shadow: resources.geometry(new THREE.PlaneGeometry(1.25, 1.25)),
  };
}

/**
 * @param {LudoResources} resources
 * @param {ReturnType<typeof createLudoPawnGeometry>} geometries
 * @param {{body:THREE.Material,ring:THREE.Material,accent:THREE.Material,shadow:THREE.Material}} materials
 * @param {string} playerId
 * @param {number} tokenIndex
 * @param {string} color
 */
function createLudoPawn(resources, geometries, materials, playerId, tokenIndex, color) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(geometries.body, materials.body);
  body.castShadow = true;
  body.receiveShadow = true;
  body.userData.ludoPick = { kind: "piece", playerId, tokenIndex };
  group.add(body);

  const baseAccent = new THREE.Mesh(geometries.baseAccent, materials.accent);
  baseAccent.rotation.x = -Math.PI / 2;
  baseAccent.position.y = 0.125;
  group.add(baseAccent);

  const collar = new THREE.Mesh(geometries.collar, materials.accent);
  collar.rotation.x = -Math.PI / 2;
  collar.position.y = 0.535;
  group.add(collar);

  const legalMaterial = resources.material(materials.ring.clone());
  const legalRing = new THREE.Mesh(geometries.legalRing, legalMaterial);
  legalRing.rotation.x = -Math.PI / 2;
  legalRing.visible = false;

  const shadow = new THREE.Mesh(geometries.shadow, materials.shadow);
  shadow.rotation.x = -Math.PI / 2;

  return {
    group, body, legalRing, legalMaterial, shadow, playerId, tokenIndex, color,
    visible: false,
    progress: -1,
    targetX: 0, targetZ: 0, groundY: YARD_GROUND_Y, targetScale: 1,
    previousX: 0, previousZ: 0, previousGroundY: YARD_GROUND_Y,
  };
}

/** @param {LudoResources} resources */
function createLudoArrivalSparkles(resources) {
  const group = new THREE.Group();
  const sparkleGeometry = resources.geometry(new THREE.OctahedronGeometry(0.055));
  const sparkleMaterial = resources.material(new THREE.MeshBasicMaterial({ color: "#ffda7b", toneMapped: false }));
  const sparkles = [];

  for (let index = 0; index < 12; index += 1) {
    const sparkle = new THREE.Mesh(sparkleGeometry, sparkleMaterial);
    group.add(sparkle);
    sparkles.push(sparkle);
  }

  group.visible = false;

  return {
    group,
    /** @param {number} progress @param {number} x @param {number} z */
    update(progress, x, z) {
      group.visible = progress > 0 && progress < 1;

      if (!group.visible) return;

      group.position.set(x, TRACK_GROUND_Y + 0.2, z);

      for (let index = 0; index < sparkles.length; index += 1) {
        const angle = index * Math.PI * 2 / sparkles.length;
        const distance = 0.3 + progress * 0.8;
        sparkles[index].position.set(
          Math.cos(angle) * distance,
          Math.sin(Math.PI * progress) * (0.45 + (index % 3) * 0.2),
          Math.sin(angle) * distance,
        );
        sparkles[index].scale.setScalar(1 - progress);
        sparkles[index].rotation.set(progress * 5, angle + progress * 3, 0);
      }
    },
  };
}

/**
 * Actual-player pawn models, with render-only hops and bounded shared-cell
 * layouts. Logical progress remains owned by the immutable server snapshot.
 * @param {LudoResources} resources
 */
export function createLudoPawns(resources) {
  const group = new THREE.Group();
  const geometries = createLudoPawnGeometry(resources);
  const accentMaterial = resources.material(new THREE.MeshStandardMaterial({ color: "#e9c981", metalness: 0.82, roughness: 0.23 }));
  const shadowMaterial = resources.material(new THREE.MeshBasicMaterial({
    map: createLudoContactTexture(resources), transparent: true, depthWrite: false, opacity: 0.62,
  }));
  const pawnMaterials = new Map();

  for (const color of LUDO_COLORS) {
    pawnMaterials.set(color, {
      body: resources.material(new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(LUDO_PALETTE[color].color).multiplyScalar(0.8), roughness: 0.2, metalness: 0.2,
        clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 1.1,
      })),
      ring: resources.material(new THREE.MeshBasicMaterial({
        color: LUDO_PALETTE[color].color, transparent: true, opacity: 0.85,
        depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
      })),
      accent: accentMaterial,
      shadow: shadowMaterial,
    });
  }

  const models = new Map();
  const pickables = [];
  const arrivalSparkles = createLudoArrivalSparkles(resources);
  group.add(arrivalSparkles.group);
  let observedRoundId = null;
  let observedRevision = null;
  let hoveredKey = null;

  /** @param {LudoRoundState} snapshot */
  function recordLudoPawnTargets(snapshot) {
    const cellOccupants = new Map();

    for (const model of models.values()) {
      model.visible = false;
    }

    for (const playerId of snapshot.playerIds) {
      const playerState = snapshot.players[playerId];

      for (let tokenIndex = 0; tokenIndex < playerState.tokens.length; tokenIndex += 1) {
        const key = `${playerId}:${tokenIndex}`;
        let model = models.get(key);

        if (!model) {
          model = createLudoPawn(resources, geometries, pawnMaterials.get(playerState.color), playerId, tokenIndex, playerState.color);
          group.add(model.group, model.legalRing, model.shadow);
          models.set(key, model);
        }

        const progress = playerState.tokens[tokenIndex];
        const cell = getLudoTokenCell(playerState.color, progress, tokenIndex);
        const cellKey = `${cell.column}:${cell.row}`;
        const occupants = cellOccupants.get(cellKey) ?? [];

        if (model.progress !== progress || observedRoundId !== snapshot.roundId) {
          model.previousX = model.targetX;
          model.previousZ = model.targetZ;
          model.previousGroundY = model.groundY;
        }

        model.visible = true;
        model.progress = progress;
        model.cellColumn = cell.column;
        model.cellRow = cell.row;
        model.groundY = getLudoPawnGroundY(progress);
        occupants.push(model);
        cellOccupants.set(cellKey, occupants);
      }
    }

    for (const occupants of cellOccupants.values()) {
      for (let index = 0; index < occupants.length; index += 1) {
        const model = occupants[index];
        const layout = getLudoStackOffset(index, occupants.length);
        model.targetX = model.cellColumn - 7 + layout.x;
        model.targetZ = model.cellRow - 7 + layout.z;
        model.targetScale = layout.scale;
      }
    }

    observedRoundId = snapshot.roundId;
    observedRevision = snapshot.revision;
  }

  /** @param {ReturnType<typeof createLudoPawn>} model @param {LudoActionFrame} animation */
  function animateLudoMovingPawn(model, animation) {
    const action = animation.action;
    const stepCount = action.from < 0 ? 1 : Math.max(1, action.to - action.from);
    const travelDurationMs = stepCount * LUDO_LIMITS.STEP_DURATION_MS;

    if (animation.elapsedMs >= travelDurationMs) {
      const landingProgress = clampLudoUnit((animation.elapsedMs - travelDurationMs) / LUDO_LIMITS.MOVE_LANDING_MS);
      const landingLift = Math.sin(landingProgress * Math.PI) * (action.kind === "finish" ? 0.22 : 0.075);
      model.group.position.y += landingLift;
      const settlingScale = 1 + Math.sin(landingProgress * Math.PI) * 0.05;
      model.group.scale.multiplyScalar(settlingScale);

      if (action.kind === "finish") {
        arrivalSparkles.update(landingProgress, model.targetX, model.targetZ);
      }

      return;
    }

    const stepIndex = Math.min(stepCount - 1, Math.floor(animation.elapsedMs / LUDO_LIMITS.STEP_DURATION_MS));
    const stepProgress = (animation.elapsedMs - stepIndex * LUDO_LIMITS.STEP_DURATION_MS) / LUDO_LIMITS.STEP_DURATION_MS;
    const easedStep = easeLudoSmooth(stepProgress);
    const fromProgress = action.from < 0 ? -1 : action.from + stepIndex;
    const toProgress = action.from < 0 ? 0 : fromProgress + 1;
    const fromCell = getLudoTokenCell(model.color, fromProgress, model.tokenIndex);
    const toCell = getLudoTokenCell(model.color, toProgress, model.tokenIndex);
    const fromX = stepIndex === 0 ? model.previousX : fromCell.column - 7;
    const fromZ = stepIndex === 0 ? model.previousZ : fromCell.row - 7;
    const toX = stepIndex === stepCount - 1 ? model.targetX : toCell.column - 7;
    const toZ = stepIndex === stepCount - 1 ? model.targetZ : toCell.row - 7;
    const fromGroundY = getLudoPawnGroundY(fromProgress);
    const toGroundY = getLudoPawnGroundY(toProgress);
    const lift = Math.sin(stepProgress * Math.PI) * 0.48;
    const scaleBlend = stepIndex === stepCount - 1 ? easedStep : 0;

    model.group.position.set(
      THREE.MathUtils.lerp(fromX, toX, easedStep),
      THREE.MathUtils.lerp(fromGroundY, toGroundY, easedStep) + lift,
      THREE.MathUtils.lerp(fromZ, toZ, easedStep),
    );
    model.group.scale.setScalar(THREE.MathUtils.lerp(1, model.targetScale, scaleBlend));
    model.group.rotation.z = -(toX - fromX) * Math.sin(stepProgress * Math.PI) * 0.11;
    model.group.rotation.x = (toZ - fromZ) * Math.sin(stepProgress * Math.PI) * 0.11;
  }

  /** @param {ReturnType<typeof createLudoPawn>} model @param {LudoActionFrame} animation */
  function animateLudoCapturedPawn(model, animation) {
    const action = animation.action;
    const stepCount = action.from < 0 ? 1 : Math.max(1, action.to - action.from);
    const travelDurationMs = stepCount * LUDO_LIMITS.STEP_DURATION_MS;
    const returnProgress = clampLudoUnit((animation.elapsedMs - travelDurationMs) / LUDO_LIMITS.MOVE_LANDING_MS);
    const easedReturn = easeLudoSmooth(returnProgress);

    model.group.position.set(
      THREE.MathUtils.lerp(model.previousX, model.targetX, easedReturn),
      THREE.MathUtils.lerp(model.previousGroundY, model.groundY, easedReturn) + Math.sin(returnProgress * Math.PI) * 1.1,
      THREE.MathUtils.lerp(model.previousZ, model.targetZ, easedReturn),
    );
    model.group.scale.setScalar(0.8 + easedReturn * 0.2);
    model.group.rotation.y = returnProgress * Math.PI * 2;
  }

  return {
    group,
    pickables,
    /** @param {string|null} key */
    setHoveredPiece(key) {
      hoveredKey = key;
    },
    resetPresentation() {
      observedRoundId = null;
      observedRevision = null;
      hoveredKey = null;
      pickables.length = 0;
      arrivalSparkles.group.visible = false;

      for (const model of models.values()) {
        model.visible = false;
        model.group.visible = false;
        model.shadow.visible = false;
        model.legalRing.visible = false;
      }
    },
    /** @param {{snapshot:LudoRoundState,playerId:string|null,selectedTokenIndex:number|null,animation:LudoActionFrame|null,nowMs:number,reducedMotion:boolean}} frame */
    update({ snapshot, playerId, selectedTokenIndex, animation, nowMs, reducedMotion }) {
      if (observedRoundId !== snapshot.roundId || observedRevision !== snapshot.revision) {
        recordLudoPawnTargets(snapshot);
      }

      const canChoose = snapshot.started && !snapshot.gameOver && snapshot.phase === "choose"
        && snapshot.currentPlayerId === playerId;
      pickables.length = 0;
      arrivalSparkles.group.visible = false;

      for (const [key, model] of models) {
        model.group.visible = model.visible;
        model.shadow.visible = model.visible;

        if (!model.visible) {
          model.legalRing.visible = false;
          continue;
        }

        const legal = canChoose && model.playerId === playerId
          && snapshot.legalTokenIndices.includes(model.tokenIndex);
        const selected = legal && selectedTokenIndex === model.tokenIndex;
        const hovered = legal && hoveredKey === key;
        const pulse = reducedMotion ? 0 : Math.sin(nowMs * 0.0055 + model.tokenIndex * 0.7);
        model.group.position.set(model.targetX, model.groundY, model.targetZ);
        model.group.rotation.set(0, 0, 0);
        model.group.scale.setScalar(model.targetScale * (hovered ? 1.045 : 1));

        if (animation && animation.action.kind !== "roll") {
          const action = animation.action;

          if (action.playerId === model.playerId && action.tokenIndex === model.tokenIndex) {
            animateLudoMovingPawn(model, animation);
          } else if (action.capturedPlayerId === model.playerId && action.capturedTokenIndex === model.tokenIndex) {
            animateLudoCapturedPawn(model, animation);
          }
        }

        model.shadow.position.set(model.group.position.x, model.groundY + 0.006, model.group.position.z);
        const shadowScale = model.group.scale.x * (1 + Math.max(0, model.group.position.y - model.groundY) * 0.28);
        model.shadow.scale.setScalar(shadowScale);

        model.legalRing.visible = legal;
        model.legalRing.position.set(model.targetX, model.groundY + 0.013, model.targetZ);
        model.legalRing.scale.setScalar(model.targetScale * (selected ? 1.11 : 1) * (1 + pulse * 0.035));
        model.legalMaterial.opacity = selected || hovered ? 1 : 0.58 + pulse * 0.14;

        if (legal) pickables.push(model.body);
      }
    },
  };
}
