import * as THREE from "three";
import { EDGEOUT_ARENA } from "../shared/config.js";
import { getEdgeoutArenaHalfExtent, listEdgeoutTiles } from "../shared/arena.js";

/** @typedef {import("../shared/arena.js").EdgeoutArena} EdgeoutArena */

const TILE_GAP_SCALE = 0.94;
const FALL_DURATION_SEC = 2.6;
const FALL_GRAVITY = 14;
const RING_COLORS = Object.freeze(["#ffd166", "#3a4a6e", "#2d3a58", "#435684"]);
const WARNING_COLOR = new THREE.Color("#ff4d5e");
const FRAME_COLOR = new THREE.Color("#2ee6c8");
const FRAME_WARNING_COLOR = new THREE.Color("#ffc24b");
const FRAME_THICKNESS = 0.08;
const FRAME_HEIGHT = 0.1;
const STAR_COUNT = 420;
const ISLAND_COUNT = 9;

/** @param {number} column @param {number} row @returns {number} Stable pseudo-random value in [0, 1). */
function hashEdgeoutTile(column, row) {
  const value = Math.sin(column * 127.1 + row * 311.7) * 43758.5453;
  return value - Math.floor(value);
}

/**
 * Floating tile arena, its glowing boundary and the sky around it. Tiles
 * shake while their ring is warned and tumble away when it collapses. Fall
 * timing is presentation-only and restarts on every new round identity.
 * @param {THREE.Scene} scene
 * @returns {{update(arena:Readonly<EdgeoutArena>,roundIdentity:string,timeSec:number,dtSec:number,reducedMotion:boolean):void,setShadows(enabled:boolean):void,dispose():void}}
 */
export function createEdgeoutArenaView(scene) {
  const tiles = listEdgeoutTiles().map((tile) => ({ ...tile, hash: hashEdgeoutTile(tile.column, tile.row) }));
  const tileSize = EDGEOUT_ARENA.tileSize * TILE_GAP_SCALE;
  const group = new THREE.Group();
  scene.add(group);

  const tileGeometry = new THREE.BoxGeometry(tileSize, EDGEOUT_ARENA.tileThickness, tileSize);
  tileGeometry.translate(0, -EDGEOUT_ARENA.tileThickness / 2, 0);
  const tileMaterial = new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0.12 });
  const tileMesh = new THREE.InstancedMesh(tileGeometry, tileMaterial, tiles.length);
  tileMesh.receiveShadow = true;
  tileMesh.castShadow = true;
  const rockGeometry = new THREE.ConeGeometry(tileSize * 0.55, 1.8, 5, 1);
  rockGeometry.rotateX(Math.PI);
  rockGeometry.translate(0, -EDGEOUT_ARENA.tileThickness - 0.9, 0);
  const rockMaterial = new THREE.MeshStandardMaterial({ color: "#1b2236", roughness: 0.9, flatShading: true });
  const rockMesh = new THREE.InstancedMesh(rockGeometry, rockMaterial, tiles.length);
  const baseColors = tiles.map((tile) => new THREE.Color(RING_COLORS[Math.min(tile.ring, RING_COLORS.length - 1)])
    .offsetHSL(0, 0, (tile.column + tile.row) % 2 === 0 ? 0.03 : -0.02));
  tiles.forEach((_tile, index) => tileMesh.setColorAt(index, baseColors[index]));
  group.add(tileMesh, rockMesh);

  const frameMaterial = new THREE.MeshBasicMaterial({ color: FRAME_COLOR, toneMapped: false });
  const frameGeometry = new THREE.BoxGeometry(1, FRAME_HEIGHT, FRAME_THICKNESS);
  const frameBars = [0, 1, 2, 3].map(() => {
    const bar = new THREE.Mesh(frameGeometry, frameMaterial);
    group.add(bar);
    return bar;
  });

  const starGeometry = new THREE.BufferGeometry();
  const starPositions = new Float32Array(STAR_COUNT * 3);
  for (let index = 0; index < STAR_COUNT; index += 1) {
    const theta = hashEdgeoutTile(index, 3) * Math.PI * 2;
    const height = hashEdgeoutTile(index, 7) * 2 - 0.35;
    const radius = 70 + hashEdgeoutTile(index, 11) * 25;
    starPositions[index * 3] = Math.cos(theta) * radius;
    starPositions[index * 3 + 1] = height * 45;
    starPositions[index * 3 + 2] = Math.sin(theta) * radius;
  }
  starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
  const starMaterial = new THREE.PointsMaterial({ color: "#c9d8ff", size: 0.35, sizeAttenuation: true, fog: false, transparent: true, opacity: 0.8 });
  const stars = new THREE.Points(starGeometry, starMaterial);
  group.add(stars);

  const glowMaterial = new THREE.MeshBasicMaterial({ color: "#1fb5a8", transparent: true, opacity: 0.18, depthWrite: false, toneMapped: false });
  const glow = new THREE.Mesh(new THREE.CircleGeometry(16, 48), glowMaterial);
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = -14;
  group.add(glow);

  const islandGeometry = new THREE.IcosahedronGeometry(1, 0);
  const islandMaterial = new THREE.MeshStandardMaterial({ color: "#26304a", roughness: 0.95, flatShading: true });
  const islands = new THREE.InstancedMesh(islandGeometry, islandMaterial, ISLAND_COUNT);
  const islandMatrix = new THREE.Matrix4();
  for (let index = 0; index < ISLAND_COUNT; index += 1) {
    const angle = (index / ISLAND_COUNT) * Math.PI * 2 + hashEdgeoutTile(index, 1);
    const distance = 22 + hashEdgeoutTile(index, 2) * 18;
    const scale = 0.8 + hashEdgeoutTile(index, 5) * 2.4;
    islandMatrix.compose(
      new THREE.Vector3(Math.cos(angle) * distance, -6 - hashEdgeoutTile(index, 9) * 14, Math.sin(angle) * distance),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(hashEdgeoutTile(index, 4) * 3, hashEdgeoutTile(index, 6) * 3, 0)),
      new THREE.Vector3(scale, scale * 0.7, scale),
    );
    islands.setMatrixAt(index, islandMatrix);
  }
  group.add(islands);

  /** Render time each ring began to fall, or null while it stands. */
  const ringFallStartSec = new Array(EDGEOUT_ARENA.rings).fill(null);
  const tileMatrix = new THREE.Matrix4();
  const tilePosition = new THREE.Vector3();
  const tileRotation = new THREE.Quaternion();
  const tileEuler = new THREE.Euler();
  const tileScale = new THREE.Vector3(1, 1, 1);
  const hiddenScale = new THREE.Vector3(0, 0, 0);
  const tileColor = new THREE.Color();
  let presentedIdentity = "";
  let frameHalfExtent = getEdgeoutArenaHalfExtent(EDGEOUT_ARENA.rings);

  /** @param {number} halfExtent @param {boolean} warning */
  function placeFrame(halfExtent, warning) {
    const length = halfExtent * 2 + FRAME_THICKNESS;
    frameBars[0].position.set(0, FRAME_HEIGHT / 2, halfExtent);
    frameBars[1].position.set(0, FRAME_HEIGHT / 2, -halfExtent);
    frameBars[2].position.set(halfExtent, FRAME_HEIGHT / 2, 0);
    frameBars[3].position.set(-halfExtent, FRAME_HEIGHT / 2, 0);
    frameBars[0].scale.x = length;
    frameBars[1].scale.x = length;
    frameBars[2].scale.x = length;
    frameBars[3].scale.x = length;
    frameBars[2].rotation.y = Math.PI / 2;
    frameBars[3].rotation.y = Math.PI / 2;
    frameMaterial.color.copy(warning ? FRAME_WARNING_COLOR : FRAME_COLOR);
    for (const bar of frameBars) bar.visible = halfExtent > 0.05;
  }

  return {
    update(arena, roundIdentity, timeSec, dtSec, reducedMotion) {
      if (roundIdentity !== presentedIdentity) {
        const joiningLate = presentedIdentity === "";
        presentedIdentity = roundIdentity;
        for (let ring = 0; ring < EDGEOUT_ARENA.rings; ring += 1) {
          ringFallStartSec[ring] = ring >= arena.intactRings && joiningLate ? timeSec - FALL_DURATION_SEC : null;
        }
      }
      for (let ring = 0; ring < EDGEOUT_ARENA.rings; ring += 1) {
        if (ring >= arena.intactRings && ringFallStartSec[ring] === null) ringFallStartSec[ring] = timeSec;
        if (ring < arena.intactRings) ringFallStartSec[ring] = null;
      }

      const warningStrength = arena.warningRing >= 0 ? 1 - arena.warningRemainingSec / EDGEOUT_ARENA.warningSec : 0;
      tiles.forEach((tile, index) => {
        const fallStartSec = ringFallStartSec[tile.ring];
        tileColor.copy(baseColors[index]);
        if (fallStartSec !== null) {
          const fallSec = timeSec - fallStartSec;
          if (fallSec >= FALL_DURATION_SEC) {
            tileMatrix.compose(tilePosition.set(tile.x, -200, tile.z), tileRotation.identity(), hiddenScale);
          } else {
            const spin = (tile.hash - 0.5) * 3 * fallSec;
            tileEuler.set(spin, tile.hash * fallSec, -spin * 0.7);
            tileMatrix.compose(
              tilePosition.set(tile.x, -0.5 * FALL_GRAVITY * fallSec * fallSec, tile.z),
              tileRotation.setFromEuler(tileEuler),
              tileScale,
            );
            tileColor.multiplyScalar(Math.max(0.35, 1 - fallSec / FALL_DURATION_SEC));
          }
        } else if (tile.ring === arena.warningRing) {
          const shake = reducedMotion ? 0 : (0.02 + 0.07 * warningStrength) * Math.sin(timeSec * 42 + tile.hash * 20);
          tileMatrix.compose(tilePosition.set(tile.x + shake, shake * 0.5, tile.z - shake), tileRotation.identity(), tileScale);
          const pulse = 0.5 + 0.5 * Math.sin(timeSec * (reducedMotion ? 4 : 14));
          tileColor.lerp(WARNING_COLOR, (0.25 + 0.55 * warningStrength) * pulse);
        } else {
          tileMatrix.compose(tilePosition.set(tile.x, 0, tile.z), tileRotation.identity(), tileScale);
        }
        tileMesh.setMatrixAt(index, tileMatrix);
        rockMesh.setMatrixAt(index, tileMatrix);
        tileMesh.setColorAt(index, tileColor);
      });
      tileMesh.instanceMatrix.needsUpdate = true;
      rockMesh.instanceMatrix.needsUpdate = true;
      if (tileMesh.instanceColor) tileMesh.instanceColor.needsUpdate = true;

      const targetHalfExtent = getEdgeoutArenaHalfExtent(arena.intactRings);
      frameHalfExtent += (targetHalfExtent - frameHalfExtent) * Math.min(1, dtSec * 6);
      if (Math.abs(targetHalfExtent - frameHalfExtent) < 0.01) frameHalfExtent = targetHalfExtent;
      placeFrame(frameHalfExtent, arena.warningRing >= 0);
      stars.rotation.y = reducedMotion ? 0 : timeSec * 0.004;
      glowMaterial.opacity = 0.14 + 0.06 * Math.sin(timeSec * 0.8);
    },
    setShadows(enabled) {
      tileMesh.castShadow = enabled;
    },
    dispose() {
      scene.remove(group);
      for (const disposable of [tileGeometry, tileMaterial, rockGeometry, rockMaterial, frameGeometry, frameMaterial,
        starGeometry, starMaterial, glow.geometry, glowMaterial, islandGeometry, islandMaterial]) disposable.dispose();
      tileMesh.dispose();
      rockMesh.dispose();
      islands.dispose();
    },
  };
}
