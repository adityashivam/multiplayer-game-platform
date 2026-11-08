import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { createLudoBoard } from "./board.js";
import { createLudoDie } from "./die.js";
import { createLudoPawns } from "./pawns.js";
import { createLudoActionTimeline } from "./presentation.js";
import { createLudoResources } from "./resources.js";

/** @typedef {import("../shared/rules.js").LudoRoundState} LudoRoundState */
/** @typedef {{resolutionScale?:number,maxPixelRatio?:number,pixelRatio?:number,shadows?:boolean,reducedEffects?:boolean,autoLowEndActive?:boolean,autoTier?:string,targetFps?:number}} LudoQualityProfile */
/** @typedef {{snapshot:LudoRoundState|null,playerId:string|null,selectedTokenIndex:number|null,nowMs:number,serverNowMs:number,reducedMotion:boolean,pendingRoll:boolean}} LudoRenderFrame */
/** @typedef {{kind:"piece",playerId:string,tokenIndex:number}|{kind:"die"}} LudoPick */

const MODAL_INPUT_SELECTOR = '[aria-modal="true"], dialog[open]';
const RENDER_PIXEL_BUDGET = 2400000;
const POINTER_DRAG_THRESHOLD_PX = 12;

/** @param {number} value @param {number} minimum @param {number} maximum */
function clampLudoNumber(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

/** @param {"low"|"medium"|"high"|LudoQualityProfile} profile */
function resolveLudoQuality(profile) {
  const lowQuality = profile === "low" || (typeof profile === "object"
    && (profile.reducedEffects || profile.autoLowEndActive || profile.autoTier === "low"));
  const mediumQuality = profile === "medium";
  const qualityOptions = typeof profile === "object" ? profile : {};
  const requestedRatio = qualityOptions.maxPixelRatio ?? qualityOptions.pixelRatio;

  return {
    maxPixelRatio: Number.isFinite(requestedRatio)
      ? clampLudoNumber(requestedRatio, 0.75, 2)
      : lowQuality ? 1.15 : mediumQuality ? 1.5 : 1.75,
    resolutionScale: Number.isFinite(qualityOptions.resolutionScale)
      ? clampLudoNumber(qualityOptions.resolutionScale, 0.5, 1)
      : 1,
    shadows: qualityOptions.shadows ?? !lowQuality,
    shadowMapSize: lowQuality || mediumQuality ? 1024 : 2048,
  };
}

/** @param {THREE.Scene} scene */
function createLudoLighting(scene) {
  const hemisphereLight = new THREE.HemisphereLight("#f0f8ff", "#334255", 1.25);
  scene.add(hemisphereLight);
  const keyLight = new THREE.DirectionalLight("#fff1d8", 2.4);
  keyLight.position.set(-8, 20, 4);
  keyLight.target.position.set(0, 0, 0);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.left = -12;
  keyLight.shadow.camera.right = 12;
  keyLight.shadow.camera.top = 12;
  keyLight.shadow.camera.bottom = -12;
  keyLight.shadow.camera.near = 0.5;
  keyLight.shadow.camera.far = 45;
  keyLight.shadow.bias = -0.00015;
  keyLight.shadow.normalBias = 0.025;
  keyLight.shadow.radius = 3;
  scene.add(keyLight, keyLight.target);
  const rimLight = new THREE.DirectionalLight("#a9d8ff", 1.05);
  rimLight.position.set(9, 10, -10);
  scene.add(rimLight);
  return keyLight;
}

/**
 * Fit projected board bounds to the free host region. The frustum offset moves
 * the composition beside the HUD without changing the canvas or its identity.
 * @param {THREE.OrthographicCamera} camera
 * @param {number} width
 * @param {number} height
 * @param {number} reservedRightPx
 */
function fitLudoCamera(camera, width, height, reservedRightPx) {
  camera.updateMatrixWorld(true);
  const projectedPoint = new THREE.Vector3();
  let minimumX = Infinity;
  let maximumX = -Infinity;
  let minimumY = Infinity;
  let maximumY = -Infinity;

  for (const x of [-8.24, 8.24]) {
    for (const y of [-0.86, 1.5]) {
      for (const z of [-8.24, 8.24]) {
        projectedPoint.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
        minimumX = Math.min(minimumX, projectedPoint.x);
        maximumX = Math.max(maximumX, projectedPoint.x);
        minimumY = Math.min(minimumY, projectedPoint.y);
        maximumY = Math.max(maximumY, projectedPoint.y);
      }
    }
  }

  const reservedWidth = clampLudoNumber(reservedRightPx, 0, width * 0.65);
  const availableWidth = Math.max(1, width - reservedWidth - 18);
  const availableHeight = Math.max(1, height - 20);
  const fittedHeight = Math.max(
    (maximumY - minimumY) * height / availableHeight,
    (maximumX - minimumX) * height / availableWidth,
  );
  const fittedWidth = fittedHeight * width / height;
  const horizontalCenter = (minimumX + maximumX) / 2 + fittedWidth * reservedWidth / (2 * width);
  const verticalCenter = (minimumY + maximumY) / 2;
  camera.left = horizontalCenter - fittedWidth / 2;
  camera.right = horizontalCenter + fittedWidth / 2;
  camera.top = verticalCenter + fittedHeight / 2;
  camera.bottom = verticalCenter - fittedHeight / 2;
  camera.updateProjectionMatrix();
}

/**
 * Procedural tabletop presentation. The caller owns the host, frame scheduler,
 * networking and HUD; this renderer owns GPU resources and canvas picking.
 * Snapshots are borrowed read-only and logical token progress never changes.
 * @param {{canvas:HTMLCanvasElement,onPiecePick?:(playerId:string,tokenIndex:number)=>void,onDicePick?:()=>void}} options
 * @returns {{resize(width:number,height:number,reservedRightPx?:number):void,render(frame:LudoRenderFrame):void,setQuality(profile:"low"|"medium"|"high"|LudoQualityProfile):void,resetPresentation():void,dispose():void}}
 */
export function createLudoRenderer({ canvas, onPiecePick = () => {}, onDicePick = () => {} }) {
  const resources = createLudoResources();
  const renderer = new THREE.WebGLRenderer({
    canvas, antialias: true, alpha: false, powerPreference: "high-performance", stencil: false,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#101e2c");
  const camera = new THREE.OrthographicCamera(-12, 12, 9, -9, 0.1, 100);
  camera.position.set(8, 25, 18);
  camera.lookAt(0, 0.1, 0);
  const keyLight = createLudoLighting(scene);

  const environmentScene = new RoomEnvironment();
  const environmentGenerator = new THREE.PMREMGenerator(renderer);
  const environmentTarget = environmentGenerator.fromScene(environmentScene, 0.06);
  scene.environment = environmentTarget.texture;
  scene.environmentIntensity = 0.3;
  environmentScene.dispose();
  environmentGenerator.dispose();

  const board = createLudoBoard(resources);
  const pawns = createLudoPawns(resources);
  const die = createLudoDie(resources);
  scene.add(board.group, pawns.group, die.group);
  const timeline = createLudoActionTimeline();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const pickables = [];
  const originalCursor = canvas.style.cursor;
  const originalTouchAction = canvas.style.touchAction;
  const listeners = [];
  let quality = resolveLudoQuality("high");
  let width = 1;
  let height = 1;
  let reservedRightPx = 0;
  let disposed = false;
  let pointerDown = null;
  let hoveredPick = null;
  canvas.style.touchAction = "none";

  function updateLudoRenderSize() {
    const devicePixelRatio = Math.max(1, window.devicePixelRatio || 1);
    const pixelBudgetRatio = Math.sqrt(RENDER_PIXEL_BUDGET / (width * height));
    const pixelRatio = Math.min(devicePixelRatio, quality.maxPixelRatio, pixelBudgetRatio) * quality.resolutionScale;
    renderer.setPixelRatio(Math.max(0.5, pixelRatio));
    renderer.setSize(width, height, false);
    fitLudoCamera(camera, width, height, reservedRightPx);
  }

  /** @param {number} nextWidth @param {number} nextHeight @param {number} [nextReservedRightPx] */
  function resize(nextWidth, nextHeight, nextReservedRightPx = 0) {
    if (disposed) return;
    width = Math.max(1, Math.round(nextWidth));
    height = Math.max(1, Math.round(nextHeight));
    reservedRightPx = Math.max(0, nextReservedRightPx);
    updateLudoRenderSize();
  }

  /** @param {"low"|"medium"|"high"|LudoQualityProfile} profile */
  function setQuality(profile) {
    if (disposed) return;
    const nextQuality = resolveLudoQuality(profile);
    renderer.shadowMap.enabled = nextQuality.shadows;
    keyLight.castShadow = nextQuality.shadows;

    if (quality.shadowMapSize !== nextQuality.shadowMapSize) {
      keyLight.shadow.map?.dispose();
      keyLight.shadow.map = null;
      keyLight.shadow.mapSize.set(nextQuality.shadowMapSize, nextQuality.shadowMapSize);
    }

    quality = nextQuality;
    updateLudoRenderSize();
  }

  /** @param {LudoPick|null} pick */
  function setLudoHover(pick) {
    hoveredPick = pick;
    pawns.setHoveredPiece(pick?.kind === "piece" ? `${pick.playerId}:${pick.tokenIndex}` : null);
    die.setHovered(pick?.kind === "die");
    canvas.style.cursor = pick ? "pointer" : originalCursor;
  }

  /** @param {PointerEvent} event */
  function isLudoPointerBlocked(event) {
    return disposed || document.hidden || event.target !== canvas
      || Boolean(document.querySelector(MODAL_INPUT_SELECTOR));
  }

  /** @param {PointerEvent} event @returns {LudoPick|null} */
  function pickLudoObject(event) {
    const rectangle = canvas.getBoundingClientRect();

    if (!rectangle.width || !rectangle.height) return null;

    pointer.set(
      (event.clientX - rectangle.left) / rectangle.width * 2 - 1,
      -((event.clientY - rectangle.top) / rectangle.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const intersections = raycaster.intersectObjects(pickables, false);
    return intersections[0]?.object.userData.ludoPick ?? null;
  }

  /** @param {string} type @param {(event:PointerEvent)=>void} listener */
  function listenLudoPointer(type, listener) {
    canvas.addEventListener(type, listener);
    listeners.push([type, listener]);
  }

  listenLudoPointer("pointerdown", (event) => {
    if (isLudoPointerBlocked(event) || event.button !== 0 || event.isPrimary === false) return;
    const pick = pickLudoObject(event);
    if (!pick) return;

    pointerDown = { id: event.pointerId, x: event.clientX, y: event.clientY, pick };
    canvas.setPointerCapture?.(event.pointerId);
    setLudoHover(pick);
  });

  listenLudoPointer("pointermove", (event) => {
    if (isLudoPointerBlocked(event)) {
      setLudoHover(null);
      return;
    }

    setLudoHover(pickLudoObject(event));
  });

  listenLudoPointer("pointerup", (event) => {
    const pressedPointer = pointerDown;
    pointerDown = null;

    if (!pressedPointer || pressedPointer.id !== event.pointerId || isLudoPointerBlocked(event)) return;
    if (Math.hypot(event.clientX - pressedPointer.x, event.clientY - pressedPointer.y) > POINTER_DRAG_THRESHOLD_PX) return;

    const pick = pickLudoObject(event);
    const samePick = pick?.kind === pressedPointer.pick.kind
      && (pick.kind === "die" || (pick.playerId === pressedPointer.pick.playerId
        && pick.tokenIndex === pressedPointer.pick.tokenIndex));

    if (!samePick) return;
    event.preventDefault();

    if (pick.kind === "die") onDicePick();
    else onPiecePick(pick.playerId, pick.tokenIndex);
  });

  const releaseLudoPointer = () => {
    pointerDown = null;
    setLudoHover(null);
  };
  listenLudoPointer("pointercancel", releaseLudoPointer);
  listenLudoPointer("lostpointercapture", releaseLudoPointer);
  listenLudoPointer("pointerleave", () => {
    if (!pointerDown) setLudoHover(null);
  });

  return {
    resize,
    setQuality,
    /**
     * Call immediately before rendering the first accepted snapshot after a
     * join. Recreated rooms may reuse round/action IDs; GPU and canvas identity
     * remain stable while their presentation baseline is explicitly replaced.
     */
    resetPresentation() {
      if (disposed) return;

      if (pointerDown && canvas.hasPointerCapture?.(pointerDown.id)) {
        canvas.releasePointerCapture(pointerDown.id);
      }

      pointerDown = null;
      pickables.length = 0;
      setLudoHover(null);
      timeline.reset();
      die.resetPresentation();
      pawns.resetPresentation();
    },
    /** @param {LudoRenderFrame} frame */
    render({ snapshot, playerId, selectedTokenIndex, nowMs, serverNowMs, reducedMotion = false, pendingRoll = false }) {
      if (disposed) return;

      if (snapshot) {
        const animation = timeline.sample(snapshot, serverNowMs, nowMs, reducedMotion);
        const canRoll = Boolean(snapshot.started && !snapshot.gameOver && snapshot.phase === "roll"
          && snapshot.currentPlayerId === playerId && !pendingRoll);
        board.setActiveColor(snapshot.started && !snapshot.gameOver
          ? snapshot.players[snapshot.currentPlayerId]?.color : null, nowMs, reducedMotion);
        pawns.update({ snapshot, playerId, selectedTokenIndex, animation, nowMs, reducedMotion });
        die.update({ snapshot, animation, nowMs, reducedMotion, pendingRoll, canRoll });
        pickables.length = 0;
        pickables.push(...pawns.pickables);
        if (canRoll) pickables.push(die.pickable);

        if (hoveredPick && !pickables.some((mesh) => mesh.userData.ludoPick === hoveredPick)) {
          setLudoHover(null);
        }
      } else {
        pickables.length = 0;
        setLudoHover(null);
      }

      renderer.render(scene, camera);
    },
    dispose() {
      if (disposed) return;
      disposed = true;

      for (const [type, listener] of listeners) canvas.removeEventListener(type, listener);
      listeners.length = 0;
      pickables.length = 0;
      if (pointerDown && canvas.hasPointerCapture?.(pointerDown.id)) {
        canvas.releasePointerCapture(pointerDown.id);
      }
      pointerDown = null;
      canvas.style.cursor = originalCursor;
      canvas.style.touchAction = originalTouchAction;
      keyLight.shadow.map?.dispose();
      environmentTarget.dispose();
      resources.dispose();
      scene.clear();
      renderer.renderLists.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
