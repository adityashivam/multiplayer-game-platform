import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import {
  LUDO_COLORS,
  LUDO_HOME_LANES,
  LUDO_PALETTE,
  LUDO_RING_CELLS,
  LUDO_SAFE_INDICES,
  LUDO_START_INDICES,
  LUDO_YARD_CELLS,
} from "../shared/config.js";
import { bakeLudoStaticMeshes, createLudoCanvasTexture, createLudoContactTexture } from "./resources.js";

/** @typedef {import("./resources.js").LudoResources} LudoResources */

const BOARD_IVORY = "#f1eddf";
const HOME_CENTERS = Object.freeze({
  red: [-4.5, -4.5], green: [4.5, -4.5], yellow: [4.5, 4.5], blue: [-4.5, 4.5],
});

/** @param {number} width @param {number} depth @param {number} height @param {number} radius */
function createLudoRoundedSlab(width, depth, height, radius) {
  const left = -width / 2;
  const top = -depth / 2;
  const shape = new THREE.Shape();
  shape.moveTo(left + radius, top);
  shape.lineTo(left + width - radius, top);
  shape.quadraticCurveTo(left + width, top, left + width, top + radius);
  shape.lineTo(left + width, top + depth - radius);
  shape.quadraticCurveTo(left + width, top + depth, left + width - radius, top + depth);
  shape.lineTo(left + radius, top + depth);
  shape.quadraticCurveTo(left, top + depth, left, top + depth - radius);
  shape.lineTo(left, top + radius);
  shape.quadraticCurveTo(left, top, left + radius, top);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: height, bevelEnabled: true, bevelSegments: 2,
    steps: 1, bevelSize: 0.025, bevelThickness: 0.025, curveSegments: 5,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, -height / 2, 0);
  return geometry;
}

/** @param {CanvasRenderingContext2D} context @param {number} x @param {number} y @param {number} radius */
function drawLudoSafeStar(context, x, y, radius) {
  context.beginPath();

  for (let vertex = 0; vertex < 10; vertex += 1) {
    const angle = -Math.PI / 2 + vertex * Math.PI / 5;
    const vertexRadius = vertex % 2 === 0 ? radius : radius * 0.46;
    const vertexX = x + Math.cos(angle) * vertexRadius;
    const vertexY = y + Math.sin(angle) * vertexRadius;

    if (vertex === 0) context.moveTo(vertexX, vertexY);
    else context.lineTo(vertexX, vertexY);
  }

  context.closePath();
}

/** @param {LudoResources} resources @param {boolean} coloredStart */
function createLudoSafeMarker(resources, coloredStart) {
  const texture = createLudoCanvasTexture(resources, 128, (context, size) => {
    drawLudoSafeStar(context, size / 2, size / 2, 35);
    context.strokeStyle = coloredStart ? "rgba(255,255,255,0.92)" : "rgba(52,70,83,0.48)";
    context.fillStyle = coloredStart ? "rgba(255,255,255,0.15)" : "rgba(52,70,83,0.035)";
    context.lineWidth = 6;
    context.lineJoin = "round";
    context.fill();
    context.stroke();
  });

  return resources.material(new THREE.MeshBasicMaterial({
    map: texture, transparent: true, depthWrite: false, polygonOffset: true,
    polygonOffsetFactor: -1, toneMapped: false,
  }));
}

/** @param {THREE.Group} group @param {THREE.BufferGeometry} geometry @param {THREE.Material} material @param {[number,number,number]} position @param {boolean} [castsShadow] */
function addLudoBoardMesh(group, geometry, material, position, castsShadow = false) {
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(...position);
  mesh.castShadow = castsShadow;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

/** @param {LudoResources} resources @param {THREE.Group} group */
function createLudoTableSurface(resources, group) {
  const surfaceTexture = createLudoCanvasTexture(resources, 256, (context, size) => {
    context.fillStyle = "#101e2c";
    context.fillRect(0, 0, size, size);
    context.fillStyle = "rgba(255,255,255,0.025)";

    for (let row = 0; row < size; row += 4) {
      for (let column = row % 8; column < size; column += 8) {
        context.fillRect(column, row, 1, 1);
      }
    }
  });
  surfaceTexture.wrapS = THREE.RepeatWrapping;
  surfaceTexture.wrapT = THREE.RepeatWrapping;
  surfaceTexture.repeat.set(16, 16);

  const surface = new THREE.Mesh(
    resources.geometry(new THREE.PlaneGeometry(120, 120)),
    resources.material(new THREE.MeshStandardMaterial({ map: surfaceTexture, roughness: 0.96, metalness: 0.03 })),
  );
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = -0.87;
  surface.receiveShadow = true;
  group.add(surface);

  const boardContact = new THREE.Mesh(
    resources.geometry(new THREE.PlaneGeometry(22, 22)),
    resources.material(new THREE.MeshBasicMaterial({
      map: createLudoContactTexture(resources), transparent: true, opacity: 0.67, depthWrite: false,
    })),
  );
  boardContact.rotation.x = -Math.PI / 2;
  boardContact.position.y = -0.86;
  group.add(boardContact);
}

/** @param {LudoResources} resources @param {THREE.Group} staticGroup */
function createLudoBoardFoundation(resources, staticGroup) {
  const navyMaterial = resources.material(new THREE.MeshPhysicalMaterial({
    color: "#102b43", roughness: 0.28, metalness: 0.28, clearcoat: 0.65, clearcoatRoughness: 0.25,
  }));
  const brassMaterial = resources.material(new THREE.MeshStandardMaterial({ color: "#b6a47c", roughness: 0.3, metalness: 0.8 }));
  const ivoryMaterial = resources.material(new THREE.MeshStandardMaterial({ color: BOARD_IVORY, roughness: 0.63, metalness: 0.02 }));

  addLudoBoardMesh(staticGroup, resources.geometry(new RoundedBoxGeometry(16.15, 0.7, 16.15, 4, 0.24)), navyMaterial, [0, -0.42, 0], true);
  addLudoBoardMesh(staticGroup, resources.geometry(createLudoRoundedSlab(15.97, 15.97, 0.04, 0.32)), brassMaterial, [0, -0.055, 0]);
  addLudoBoardMesh(staticGroup, resources.geometry(createLudoRoundedSlab(15.86, 15.86, 0.07, 0.29)), navyMaterial, [0, -0.01, 0]);
  addLudoBoardMesh(staticGroup, resources.geometry(createLudoRoundedSlab(15.24, 15.24, 0.08, 0.12)), ivoryMaterial, [0, 0.075, 0]);

  const screwGeometry = resources.geometry(new THREE.SphereGeometry(0.045, 8, 5));

  for (const x of [-7.78, 7.78]) {
    for (const z of [-7.78, 7.78]) {
      const screw = addLudoBoardMesh(staticGroup, screwGeometry, brassMaterial, [x, 0.05, z]);
      screw.scale.y = 0.4;
    }
  }

  const labelTexture = createLudoCanvasTexture(resources, 512, (context, size) => {
    context.fillStyle = "#b9c7cc";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.font = "500 33px 'Space Grotesk', sans-serif";
    context.fillText("L U D O   T A B L E", size / 2, size / 2);
  });
  const labelMaterial = resources.material(new THREE.MeshBasicMaterial({ map: labelTexture, transparent: true, depthWrite: false, toneMapped: false }));
  const label = addLudoBoardMesh(staticGroup, resources.geometry(new THREE.PlaneGeometry(2.5, 2.5)), labelMaterial, [0, 0.046, 7.79]);
  label.rotation.x = -Math.PI / 2;
  label.scale.y = 0.13;

  return { brassMaterial, ivoryMaterial };
}

/** @param {LudoResources} resources @param {THREE.Group} staticGroup @param {THREE.Material} brassMaterial */
function createLudoHomes(resources, staticGroup, brassMaterial) {
  const homeMaterials = new Map();
  const homeGeometry = resources.geometry(createLudoRoundedSlab(5.92, 5.92, 0.12, 0.25));
  const insetGeometry = resources.geometry(createLudoRoundedSlab(4.93, 4.93, 0.08, 0.28));
  const wellGeometry = resources.geometry(new THREE.CylinderGeometry(0.66, 0.66, 0.035, 36));
  const wellRingGeometry = resources.geometry(new THREE.TorusGeometry(0.61, 0.025, 7, 40));
  const innerWellGeometry = resources.geometry(new THREE.CircleGeometry(0.51, 32));
  const insetMaterial = resources.material(new THREE.MeshStandardMaterial({ color: "#fffaf0", roughness: 0.62 }));

  for (const color of LUDO_COLORS) {
    const [homeX, homeZ] = HOME_CENTERS[color];
    const palette = LUDO_PALETTE[color];
    const homeMaterial = resources.material(new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(palette.color).multiplyScalar(0.65), emissive: palette.color, emissiveIntensity: 0.015,
      roughness: 0.29, metalness: 0.11, clearcoat: 0.9, clearcoatRoughness: 0.22,
    }));
    const wellMaterial = resources.material(new THREE.MeshStandardMaterial({
      color: new THREE.Color(palette.color).multiplyScalar(0.72), roughness: 0.55, metalness: 0.04,
    }));
    const wellFaceMaterial = resources.material(new THREE.MeshStandardMaterial({
      color: palette.light, roughness: 0.65,
    }));
    homeMaterials.set(color, homeMaterial);
    addLudoBoardMesh(staticGroup, homeGeometry, homeMaterial, [homeX, 0.19, homeZ]);
    addLudoBoardMesh(staticGroup, insetGeometry, insetMaterial, [homeX, 0.3, homeZ]);

    for (const [column, row] of LUDO_YARD_CELLS[color]) {
      addLudoBoardMesh(staticGroup, wellGeometry, wellMaterial, [column - 7, 0.366, row - 7]);
      const wellRing = addLudoBoardMesh(staticGroup, wellRingGeometry, brassMaterial, [column - 7, 0.389, row - 7]);
      wellRing.rotation.x = -Math.PI / 2;
      const wellFace = addLudoBoardMesh(staticGroup, innerWellGeometry, wellFaceMaterial, [column - 7, 0.388, row - 7]);
      wellFace.rotation.x = -Math.PI / 2;
    }

    const yardCells = LUDO_YARD_CELLS[color];
    const centerX = (yardCells[0][0] + yardCells[3][0]) / 2 - 7;
    const centerZ = (yardCells[0][1] + yardCells[3][1]) / 2 - 7;
    const medallion = addLudoBoardMesh(staticGroup,
      resources.geometry(new THREE.CylinderGeometry(0.23, 0.23, 0.025, 4)),
      homeMaterial, [centerX, 0.37, centerZ]);
    medallion.rotation.y = Math.PI / 4;
  }

  return homeMaterials;
}

/** @param {LudoResources} resources @param {THREE.Group} group @param {THREE.Group} staticGroup */
function createLudoTrack(resources, group, staticGroup) {
  const tileGeometry = resources.geometry(new RoundedBoxGeometry(0.935, 0.12, 0.935, 2, 0.045));
  const tileMaterial = resources.material(new THREE.MeshPhysicalMaterial({
    color: "#ffffff", roughness: 0.47, metalness: 0.015, clearcoat: 0.3, clearcoatRoughness: 0.4,
  }));
  const tileCount = LUDO_RING_CELLS.length + LUDO_COLORS.length * 6;
  const tiles = new THREE.InstancedMesh(tileGeometry, tileMaterial, tileCount);
  const tileTransform = new THREE.Object3D();
  const tileColor = new THREE.Color();
  let tileIndex = 0;

  function addTrackTile(column, row, color) {
    tileTransform.position.set(column - 7, 0.18, row - 7);
    tileTransform.updateMatrix();
    tiles.setMatrixAt(tileIndex, tileTransform.matrix);
    tiles.setColorAt(tileIndex, tileColor.set(color));
    tileIndex += 1;
  }

  for (let ringIndex = 0; ringIndex < LUDO_RING_CELLS.length; ringIndex += 1) {
    const [column, row] = LUDO_RING_CELLS[ringIndex];
    const startColor = LUDO_COLORS.find((color) => LUDO_START_INDICES[color] === ringIndex);
    addTrackTile(column, row, startColor
      ? new THREE.Color(LUDO_PALETTE[startColor].color).multiplyScalar(0.8)
      : "#faf6e9");
  }

  for (const color of LUDO_COLORS) {
    const laneColor = new THREE.Color(LUDO_PALETTE[color].color)
      .lerp(new THREE.Color("#fff5e0"), 0.06)
      .multiplyScalar(0.75);

    for (const [column, row] of LUDO_HOME_LANES[color]) {
      addTrackTile(column, row, laneColor);
    }
  }

  tiles.receiveShadow = true;
  group.add(tiles);

  const markerGeometry = resources.geometry(new THREE.PlaneGeometry(0.75, 0.75));
  const safeMaterial = createLudoSafeMarker(resources, false);
  const startMaterial = createLudoSafeMarker(resources, true);
  const arrowMaterial = resources.material(new THREE.MeshBasicMaterial({ color: "#fff9e7", toneMapped: false }));
  const arrowShape = new THREE.Shape();
  arrowShape.moveTo(-0.12, -0.06);
  arrowShape.lineTo(0.01, -0.06);
  arrowShape.lineTo(0.01, -0.13);
  arrowShape.lineTo(0.17, 0);
  arrowShape.lineTo(0.01, 0.13);
  arrowShape.lineTo(0.01, 0.06);
  arrowShape.lineTo(-0.12, 0.06);
  arrowShape.closePath();
  const arrowGeometry = resources.geometry(new THREE.ShapeGeometry(arrowShape));
  arrowGeometry.rotateX(-Math.PI / 2);

  for (const ringIndex of LUDO_SAFE_INDICES) {
    const [column, row] = LUDO_RING_CELLS[ringIndex];
    const startColor = LUDO_COLORS.find((color) => LUDO_START_INDICES[color] === ringIndex);
    const marker = addLudoBoardMesh(staticGroup, markerGeometry, startColor ? startMaterial : safeMaterial, [column - 7, 0.247, row - 7]);
    marker.rotation.x = -Math.PI / 2;
    marker.scale.setScalar(startColor ? 0.7 : 1);

    if (startColor) {
      const quarterTurn = LUDO_COLORS.indexOf(startColor) * Math.PI / 2;
      const arrow = addLudoBoardMesh(staticGroup, arrowGeometry, arrowMaterial, [column - 7, 0.25, row - 7]);
      arrow.rotation.y = -quarterTurn;
      arrow.position.x += Math.sin(quarterTurn) * 0.3;
      arrow.position.z += Math.cos(quarterTurn) * 0.3;
    }
  }
}

/** @param {LudoResources} resources @param {THREE.Group} staticGroup @param {THREE.Material} brassMaterial */
function createLudoCenter(resources, staticGroup, brassMaterial) {
  const triangleCorners = {
    red: [[-1.47, -1.47], [0, 0], [-1.47, 1.47]],
    green: [[-1.47, -1.47], [1.47, -1.47], [0, 0]],
    yellow: [[1.47, -1.47], [1.47, 1.47], [0, 0]],
    blue: [[-1.47, 1.47], [0, 0], [1.47, 1.47]],
  };

  for (const color of LUDO_COLORS) {
    const triangleGeometry = new THREE.BufferGeometry();
    triangleGeometry.setAttribute("position", new THREE.Float32BufferAttribute(
      triangleCorners[color].flatMap(([x, z]) => [x, 0, z]), 3,
    ));
    triangleGeometry.setAttribute("uv", new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 2));
    triangleGeometry.computeVertexNormals();
    const triangleMaterial = resources.material(new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(LUDO_PALETTE[color].color).multiplyScalar(0.7), roughness: 0.35, metalness: 0.1,
      clearcoat: 0.6, side: THREE.DoubleSide,
    }));
    addLudoBoardMesh(staticGroup, resources.geometry(triangleGeometry), triangleMaterial, [0, 0.255, 0]);
  }

  addLudoBoardMesh(staticGroup, resources.geometry(createLudoRoundedSlab(1.10, 1.10, 0.045, 0.14)), brassMaterial, [0, 0.28, 0]);
  const hubMaterial = resources.material(new THREE.MeshStandardMaterial({ color: "#18364b", metalness: 0.2, roughness: 0.4 }));
  addLudoBoardMesh(staticGroup, resources.geometry(createLudoRoundedSlab(1.02, 1.02, 0.04, 0.11)), hubMaterial, [0, 0.325, 0]);
}

/**
 * Construct the fixed four-color board. Empty homes remain decorative; pawns
 * are created separately only for players actually present in the snapshot.
 * @param {LudoResources} resources
 */
export function createLudoBoard(resources) {
  const group = new THREE.Group();
  const staticGroup = new THREE.Group();
  group.add(staticGroup);
  createLudoTableSurface(resources, group);
  const { brassMaterial } = createLudoBoardFoundation(resources, staticGroup);
  const homeMaterials = createLudoHomes(resources, staticGroup, brassMaterial);
  createLudoTrack(resources, group, staticGroup);
  createLudoCenter(resources, staticGroup, brassMaterial);
  bakeLudoStaticMeshes(staticGroup, resources);

  return {
    group,
    /** @param {string|null} color @param {number} nowMs @param {boolean} reducedMotion */
    setActiveColor(color, nowMs, reducedMotion) {
      for (const [homeColor, material] of homeMaterials) {
        material.emissiveIntensity = homeColor === color
          ? 0.07 + (reducedMotion ? 0 : Math.sin(nowMs * 0.0028) * 0.025)
          : 0.005;
      }
    },
  };
}
