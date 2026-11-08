import * as THREE from "three";

/**
 * @param {{head:THREE.Bone,skinMaterial:THREE.Material,hairMaterial:THREE.Material,trimMaterial:THREE.Material,geometries:Set<THREE.BufferGeometry>,materials:Set<THREE.Material>}} options
 */
export function createAthleteFace({ head, skinMaterial, hairMaterial, trimMaterial, geometries, materials }) {
  const faceRoot = new THREE.Group();
  faceRoot.name = "AthleteExpression";
  head.add(faceRoot);
  const eyeWhite = new THREE.MeshStandardMaterial({ color: "#fffaf0", roughness: 0.53 });
  const irisMaterial = new THREE.MeshStandardMaterial({ color: "#143344", roughness: 0.38 });
  const mouthMaterial = new THREE.MeshStandardMaterial({ color: "#432c32", roughness: 0.9 });
  materials.add(eyeWhite);
  materials.add(irisMaterial);
  materials.add(mouthMaterial);
  const roundGeometry = new THREE.SphereGeometry(1, 14, 8);
  const browGeometry = new THREE.BoxGeometry(0.073, 0.017, 0.019);
  geometries.add(roundGeometry);
  geometries.add(browGeometry);
  const eyes = [];
  const pupils = [];
  const brows = [];

  /** @param {THREE.BufferGeometry} geometry @param {THREE.Material} material @param {THREE.Object3D} parent @param {number[]} position @param {number[]} [scale] */
  function addFaceMesh(geometry, material, parent, position, scale = [1, 1, 1]) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.fromArray(position);
    mesh.scale.fromArray(scale);
    mesh.castShadow = false;
    parent.add(mesh);
    return mesh;
  }

  for (const side of [-1, 1]) {
    const eye = new THREE.Group();
    eye.position.set(side * 0.069, 0.171, 0.151);
    faceRoot.add(eye);
    addFaceMesh(roundGeometry, eyeWhite, eye, [0, 0, 0], [0.052, 0.029, 0.018]);
    const pupil = new THREE.Group();
    eye.add(pupil);
    addFaceMesh(roundGeometry, irisMaterial, pupil, [0, 0, 0.016], [0.023, 0.026, 0.009]);
    addFaceMesh(roundGeometry, trimMaterial, pupil, [-0.007, 0.008, 0.023], [0.006, 0.006, 0.003]);
    eyes.push(eye);
    pupils.push(pupil);
    const brow = addFaceMesh(browGeometry, hairMaterial, faceRoot, [side * 0.073, 0.217, 0.148]);
    brow.rotation.z = side * 0.08;
    brows.push(brow);
    addFaceMesh(roundGeometry, skinMaterial, faceRoot, [side * 0.083, 0.105, 0.14], [0.057, 0.034, 0.019]);
  }

  const mouth = new THREE.Group();
  mouth.position.set(0, 0.055, 0.153);
  faceRoot.add(mouth);
  const openMouth = addFaceMesh(roundGeometry, mouthMaterial, mouth, [0, 0, 0], [0.052, 0.016, 0.009]);
  const teeth = addFaceMesh(roundGeometry, eyeWhite, mouth, [0, 0.003, 0.008], [0.039, 0.005, 0.003]);
  const smileCurve = new THREE.QuadraticBezierCurve3(
    new THREE.Vector3(-0.052, 0.012, 0.002),
    new THREE.Vector3(0, -0.024, 0.013),
    new THREE.Vector3(0.052, 0.012, 0.002),
  );
  const smileGeometry = new THREE.TubeGeometry(smileCurve, 12, 0.005, 5, false);
  geometries.add(smileGeometry);
  const smile = addFaceMesh(smileGeometry, mouthMaterial, mouth, [0, 0, 0]);
  let expressionIntensity = 0;
  let lookX = 0;
  let lookY = 0;

  /**
   * Facial motion is presentation only. Eye gaze is clamped inside the sclera;
   * sparse deterministic blinks never depend on network packet frequency.
   * @param {{action:string,stamina:number,chargeSec:number}} playerState
   * @param {{timeSec:number,dtSec:number,reducedMotion?:boolean}} frame
   * @param {THREE.Vector3} localBallDirection
   * @param {number} identityIndex
   * @param {string} [visualAction]
   * @param {number} [dtSec]
   */
  function update(playerState, frame, localBallDirection, identityIndex, visualAction = playerState.action, dtSec = frame.dtSec) {
    const blend = dtSec > 0 ? 1 - Math.exp(-dtSec * 14) : 1;
    const focused = visualAction === "charge" || visualAction === "strike" || visualAction === "dash";
    const happy = visualAction === "victory";
    const hurt = visualAction === "hit" || visualAction === "defeat";
    const targetIntensity = happy ? 1 : hurt ? -1 : focused ? 0.55 : 0;
    expressionIntensity += (targetIntensity - expressionIntensity) * blend;
    const targetLookX = THREE.MathUtils.clamp(localBallDirection.x * 0.008, -0.013, 0.013);
    const targetLookY = THREE.MathUtils.clamp(localBallDirection.y * 0.005, -0.009, 0.009);
    lookX += (targetLookX - lookX) * blend;
    lookY += (targetLookY - lookY) * blend;
    const blinkPhase = (frame.timeSec + identityIndex * 1.73) % 4.7;
    const blink = blinkPhase > 4.48 ? Math.sin((blinkPhase - 4.48) / 0.22 * Math.PI) : 0;
    const eyeOpen = Math.max(0.08, (happy ? 0.7 : focused ? 0.83 : 1) - blink * 0.93);

    for (let eyeIndex = 0; eyeIndex < eyes.length; eyeIndex += 1) {
      eyes[eyeIndex].scale.y = eyeOpen;
      pupils[eyeIndex].position.set(lookX, lookY, 0);
      const side = eyeIndex === 0 ? -1 : 1;
      brows[eyeIndex].rotation.z = side * (hurt ? -0.22 : focused ? 0.28 : happy ? -0.16 : 0.08);
      brows[eyeIndex].position.y = 0.217 + (happy ? 0.015 : hurt ? 0.006 : focused ? -0.008 : 0);
    }

    const tired = Math.max(0, 1 - playerState.stamina / 100);
    openMouth.scale.y = happy ? 0.024 : hurt ? 0.027 : focused ? 0.008 : 0.011 + tired * 0.014;
    openMouth.scale.x = happy ? 0.066 : hurt ? 0.031 : focused ? 0.046 : 0.045;
    teeth.visible = happy || focused;
    teeth.scale.x = happy ? 0.054 : 0.035;
    smile.visible = !focused && !hurt && tired < 0.5;
    smile.scale.y = 0.7 + Math.max(0, expressionIntensity) * 0.7;
    mouth.position.y = 0.055 + (happy ? 0.004 : 0);
  }

  return { update };
}
