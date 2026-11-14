import * as THREE from "three";
import { getLastFuseCityLayout, isLastFuseRoofCollapsed } from "../shared/city.js";

/** @typedef {import("../shared/city.js").LastFuseCityState} LastFuseCityState */

const WINDOW_TEXTURE_SIZE = 256;
const FACADE_TILE_M = 6;
const SKYLINE_COUNT = 140;
const SKYLINE_INNER_M = 55;
const SKYLINE_OUTER_M = 170;
const COLLAPSE_SINK_SEC = 1.3;
const NEON_COLORS = Object.freeze(["#ff3d6e", "#2ee6ff", "#ffb02e", "#9b6bff", "#4dff9a"]);

/**
 * Night facade: concrete with a grid of windows, some lit warm, some cool,
 * most dark. Drawn once on a canvas.
 * @param {number} seed
 */
function createWindowTexture(seed) {
  const canvas = document.createElement("canvas");
  canvas.width = WINDOW_TEXTURE_SIZE;
  canvas.height = WINDOW_TEXTURE_SIZE;
  const context = canvas.getContext("2d");
  context.fillStyle = "#1d1f26";
  context.fillRect(0, 0, WINDOW_TEXTURE_SIZE, WINDOW_TEXTURE_SIZE);
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const columns = 8;
  const rows = 8;
  const cell = WINDOW_TEXTURE_SIZE / columns;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const roll = random();
      context.fillStyle = roll < 0.16 ? "#ffd59a" : roll < 0.24 ? "#bfe3ff" : roll < 0.28 ? "#ffefc9" : "#0c0e13";
      context.fillRect(column * cell + 6, row * cell + 7, cell - 12, cell - 13);
    }
  }
  context.fillStyle = "#2a2d36";
  for (let row = 0; row <= rows; row += 1) context.fillRect(0, row * cell - 2, WINDOW_TEXTURE_SIZE, 3);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

/** Gritty concrete roof with tar seams, drawn once. */
function createRoofTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext("2d");
  context.fillStyle = "#4a4a4d";
  context.fillRect(0, 0, 128, 128);
  for (let index = 0; index < 900; index += 1) {
    const shade = 60 + Math.floor(Math.random() * 30);
    context.fillStyle = `rgb(${shade},${shade},${shade + 3})`;
    context.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  context.strokeStyle = "#2c2c2f";
  context.lineWidth = 2;
  for (let line = 0; line <= 128; line += 32) {
    context.beginPath();
    context.moveTo(line, 0);
    context.lineTo(line, 128);
    context.moveTo(0, line);
    context.lineTo(128, line);
    context.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/**
 * Box geometry whose side UVs repeat per metre band so windows keep their
 * size on every building.
 * @param {number} width
 * @param {number} height
 * @param {number} depth
 */
function createFacadeGeometry(width, height, depth) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const uv = geometry.attributes.uv;
  const normal = geometry.attributes.normal;
  for (let index = 0; index < uv.count; index += 1) {
    const horizontal = Math.abs(normal.getX(index)) > 0.5 ? depth : width;
    uv.setXY(index, uv.getX(index) * horizontal / FACADE_TILE_M, uv.getY(index) * height / FACADE_TILE_M);
  }
  return geometry;
}

/**
 * Rooftop city, skyline, street and neon. Rebuilds buildings when the round's
 * seed changes; animates the warned roof and collapses.
 * @param {THREE.Scene} scene
 */
export function createLastFuseCityView(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const windowTextures = [createWindowTexture(11), createWindowTexture(29), createWindowTexture(47)];
  const facadeMaterials = windowTextures.map((texture) => new THREE.MeshStandardMaterial({
    map: texture,
    emissiveMap: texture,
    emissive: new THREE.Color("#ffffff"),
    emissiveIntensity: 0.55,
    roughness: 0.85,
    metalness: 0.05,
  }));
  const roofTexture = createRoofTexture();
  const roofMaterial = new THREE.MeshStandardMaterial({ map: roofTexture, roughness: 0.92, metalness: 0 });
  const ledgeMaterial = new THREE.MeshStandardMaterial({ color: "#6b6a68", roughness: 0.8 });
  const warningMaterial = new THREE.MeshBasicMaterial({ color: "#ff3b30", transparent: true, opacity: 0, toneMapped: false, depthWrite: false });
  const neonMaterials = NEON_COLORS.map((color) => new THREE.MeshBasicMaterial({ color, toneMapped: false }));

  const street = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshStandardMaterial({ color: "#121318", roughness: 0.95 }));
  street.rotation.x = -Math.PI / 2;
  street.receiveShadow = true;
  group.add(street);

  const skylineGeometry = new THREE.BoxGeometry(1, 1, 1);
  skylineGeometry.translate(0, 0.5, 0);
  const skyline = new THREE.InstancedMesh(skylineGeometry, facadeMaterials[1], SKYLINE_COUNT);
  const skylineMatrix = new THREE.Matrix4();
  const skylineScale = new THREE.Vector3();
  const skylinePosition = new THREE.Vector3();
  const identityRotation = new THREE.Quaternion();
  for (let index = 0; index < SKYLINE_COUNT; index += 1) {
    const angle = index * 2.399963;
    const distance = SKYLINE_INNER_M + ((index * 37) % 100) / 100 * (SKYLINE_OUTER_M - SKYLINE_INNER_M);
    const height = 20 + ((index * 53) % 70);
    const width = 8 + ((index * 17) % 10);
    skylinePosition.set(Math.cos(angle) * distance, 0, Math.sin(angle) * distance);
    skylineScale.set(width, height, width * (0.7 + ((index * 7) % 6) / 10));
    skylineMatrix.compose(skylinePosition, identityRotation, skylineScale);
    skyline.setMatrixAt(index, skylineMatrix);
  }
  group.add(skyline);

  const buildingGroup = new THREE.Group();
  group.add(buildingGroup);
  /** @type {{root:THREE.Group,warning:THREE.Mesh,id:number,baseY:number,collapsedAtSec:number|null}[]} */
  let buildings = [];
  let builtSeed = -1;
  const ownedGeometries = [];
  const ownedMaterials = [];

  function clearBuildings() {
    buildingGroup.clear();
    ownedGeometries.forEach((geometry) => geometry.dispose());
    ownedGeometries.length = 0;
    ownedMaterials.forEach((material) => material.dispose());
    ownedMaterials.length = 0;
    buildings = [];
  }

  /** @param {number} seed */
  function buildCity(seed) {
    clearBuildings();
    builtSeed = seed;
    const layout = getLastFuseCityLayout(seed);
    for (const roof of layout.roofs) {
      const root = new THREE.Group();
      const facadeGeometry = createFacadeGeometry(roof.width, roof.topY, roof.depth);
      const facade = new THREE.Mesh(facadeGeometry, facadeMaterials[roof.id % facadeMaterials.length]);
      facade.position.y = roof.topY / 2;
      facade.castShadow = true;
      facade.receiveShadow = true;
      const roofGeometry = new THREE.PlaneGeometry(roof.width, roof.depth);
      const uv = roofGeometry.attributes.uv;
      for (let index = 0; index < uv.count; index += 1) uv.setXY(index, uv.getX(index) * roof.width / 4, uv.getY(index) * roof.depth / 4);
      const top = new THREE.Mesh(roofGeometry, roofMaterial);
      top.rotation.x = -Math.PI / 2;
      top.position.y = roof.topY + 0.01;
      top.receiveShadow = true;
      const ledgeGeometry = new THREE.BoxGeometry(roof.width + 0.2, 0.18, roof.depth + 0.2);
      const ledge = new THREE.Mesh(ledgeGeometry, ledgeMaterial);
      ledge.position.y = roof.topY - 0.25;
      const warningGeometry = new THREE.PlaneGeometry(roof.width, roof.depth);
      const warning = new THREE.Mesh(warningGeometry, warningMaterial.clone());
      warning.rotation.x = -Math.PI / 2;
      warning.position.y = roof.topY + 0.03;
      root.add(facade, top, ledge, warning);
      if (roof.id % 3 === 0) {
        const signGeometry = new THREE.PlaneGeometry(Math.min(3.2, roof.width * 0.5), 0.7);
        const sign = new THREE.Mesh(signGeometry, neonMaterials[roof.id % neonMaterials.length]);
        const facesX = roof.id % 2 === 0;
        sign.position.set(facesX ? roof.width / 2 + 0.02 : 0, roof.topY - 2.4 - (roof.id % 4), facesX ? 0 : roof.depth / 2 + 0.02);
        sign.rotation.y = facesX ? Math.PI / 2 : 0;
        root.add(sign);
        ownedGeometries.push(signGeometry);
      }
      root.position.set(roof.x, 0, roof.z);
      buildingGroup.add(root);
      ownedGeometries.push(facadeGeometry, roofGeometry, ledgeGeometry, warningGeometry);
      ownedMaterials.push(warning.material);
      buildings.push({ root, warning, id: roof.id, baseY: 0, collapsedAtSec: null });
    }
  }

  return {
    /**
     * @param {Readonly<LastFuseCityState>} city
     * @param {number} timeSec
     * @param {boolean} reducedMotion
     */
    update(city, timeSec, reducedMotion) {
      if (city.seed !== builtSeed) buildCity(city.seed);
      for (const building of buildings) {
        const collapsed = isLastFuseRoofCollapsed(city.collapsedMask, building.id);
        if (collapsed && building.collapsedAtSec === null) building.collapsedAtSec = timeSec;
        if (!collapsed) building.collapsedAtSec = null;
        const warned = city.crumblingRoofId === building.id;
        building.warning.material.opacity = warned ? 0.25 + 0.25 * Math.sin(timeSec * 18) : 0;
        building.root.rotation.z = warned && !reducedMotion ? Math.sin(timeSec * 40) * 0.004 : 0;
        if (building.collapsedAtSec === null) {
          building.root.visible = true;
          building.root.position.y = 0;
          continue;
        }
        const progress = Math.min(1, (timeSec - building.collapsedAtSec) / COLLAPSE_SINK_SEC);
        building.root.position.y = -progress * progress * 30;
        building.root.visible = progress < 1;
      }
    },
    dispose() {
      clearBuildings();
      scene.remove(group);
      windowTextures.forEach((texture) => texture.dispose());
      facadeMaterials.forEach((material) => material.dispose());
      neonMaterials.forEach((material) => material.dispose());
      roofTexture.dispose();
      [roofMaterial, ledgeMaterial, warningMaterial, street.material].forEach((material) => material.dispose());
      [street.geometry, skylineGeometry].forEach((geometry) => geometry.dispose());
    },
  };
}
