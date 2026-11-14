import * as THREE from "three";

/** @typedef {import("../shared/track.js").DriftlineTrack} DriftlineTrack */

const ROAD_TEXTURE_REPEAT_M = 12;
const CURB_WIDTH_M = 1.1;
const CURB_STRIPE_M = 3;
const RAIL_HEIGHT_M = 0.75;
const POST_SPACING_M = 4;
const ROAD_LIFT_M = 0.02;

/** Asphalt with edge lines and a dashed centre line, drawn on a canvas. */
function createAsphaltTexture() {
  const width = 256;
  const height = 512;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.fillStyle = "#3a3a40";
  context.fillRect(0, 0, width, height);
  const image = context.getImageData(0, 0, width, height);
  for (let index = 0; index < image.data.length; index += 4) {
    const grain = (Math.random() - 0.5) * 26;
    image.data[index] += grain;
    image.data[index + 1] += grain;
    image.data[index + 2] += grain;
  }
  context.putImageData(image, 0, 0);
  context.fillStyle = "rgba(240,236,228,0.9)";
  context.fillRect(10, 0, 6, height);
  context.fillRect(width - 16, 0, 6, height);
  context.fillStyle = "rgba(255,210,90,0.85)";
  for (let y = 0; y < height; y += 128) context.fillRect(width / 2 - 3, y, 6, 64);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/**
 * Build a ribbon between two lateral offsets along the whole lap.
 * @param {Readonly<DriftlineTrack>} track
 * @param {(index:number)=>number} innerOffset Signed lateral offset of one edge.
 * @param {(index:number)=>number} outerOffset Signed lateral offset of the other edge.
 * @param {(index:number)=>number} heightOffset Height above the road surface.
 * @param {((index:number)=>THREE.Color)|null} colorAt Optional per-sample colour.
 * @param {number} [outerHeightOffset] Extra height on the outer edge, for walls.
 */
function createTrackRibbon(track, innerOffset, outerOffset, heightOffset, colorAt, outerHeightOffset = 0) {
  const count = track.sampleCount + 1;
  const positions = new Float32Array(count * 2 * 3);
  const uvs = new Float32Array(count * 2 * 2);
  const colors = colorAt ? new Float32Array(count * 2 * 3) : null;
  const indices = [];
  for (let step = 0; step < count; step += 1) {
    const index = step % track.sampleCount;
    const sideX = track.tangentZ[index];
    const sideZ = -track.tangentX[index];
    const height = track.y[index] + heightOffset(index);
    const inner = innerOffset(index);
    const outer = outerOffset(index);
    positions.set([track.x[index] + sideX * inner, height, track.z[index] + sideZ * inner], step * 6);
    positions.set([track.x[index] + sideX * outer, height + outerHeightOffset, track.z[index] + sideZ * outer], step * 6 + 3);
    const along = step === track.sampleCount ? track.lengthM : track.distance[index];
    uvs.set([0, along / ROAD_TEXTURE_REPEAT_M, 1, along / ROAD_TEXTURE_REPEAT_M], step * 4);
    if (colors) {
      const color = colorAt(index);
      colors.set([color.r, color.g, color.b, color.r, color.g, color.b], step * 6);
    }
    if (step < count - 1) {
      const base = step * 2;
      // Keep faces pointing up whichever edge lies on the +yaw side.
      if (inner > outer) indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
      else indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  if (colors) geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Road, curbs, gravel runoff, guard rails with posts, and the start gantry.
 * @param {THREE.Scene} scene
 * @param {Readonly<DriftlineTrack>} track
 * @returns {{dispose():void}}
 */
export function createDriftlineRoad(scene, track) {
  const group = new THREE.Group();
  const disposables = [];
  scene.add(group);

  const asphalt = createAsphaltTexture();
  const roadMaterial = new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.82, metalness: 0.02 });
  const roadGeometry = createTrackRibbon(track, (index) => track.halfWidth[index], (index) => -track.halfWidth[index], () => ROAD_LIFT_M, null);
  const road = new THREE.Mesh(roadGeometry, roadMaterial);
  road.receiveShadow = true;
  group.add(road);
  disposables.push(asphalt, roadMaterial, roadGeometry);

  const red = new THREE.Color("#d8362b");
  const white = new THREE.Color("#f3eee6");
  const stripe = (index) => (Math.floor(track.distance[index] / CURB_STRIPE_M) % 2 === 0 ? red : white);
  const curbMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
  const gravelMaterial = new THREE.MeshStandardMaterial({ color: "#a58f72", roughness: 1 });
  for (const side of [1, -1]) {
    const curbGeometry = createTrackRibbon(track, (index) => side * track.halfWidth[index], (index) => side * (track.halfWidth[index] + CURB_WIDTH_M), () => ROAD_LIFT_M + 0.03, stripe);
    const gravelGeometry = createTrackRibbon(track, (index) => side * (track.halfWidth[index] + CURB_WIDTH_M), (index) => side * (track.halfWidth[index] + track.runoffM + 0.4), () => ROAD_LIFT_M - 0.01, null);
    const railGeometry = createTrackRibbon(track, (index) => side * (track.halfWidth[index] + track.runoffM + 0.45), (index) => side * (track.halfWidth[index] + track.runoffM + 0.45), () => 0.35, null, RAIL_HEIGHT_M);
    const curb = new THREE.Mesh(curbGeometry, curbMaterial);
    const gravel = new THREE.Mesh(gravelGeometry, gravelMaterial);
    curb.receiveShadow = true;
    gravel.receiveShadow = true;
    group.add(curb, gravel);
    const railMaterial = new THREE.MeshStandardMaterial({ color: "#c9ccd2", metalness: 0.75, roughness: 0.35, side: THREE.DoubleSide });
    const rail = new THREE.Mesh(railGeometry, railMaterial);
    rail.castShadow = true;
    group.add(rail);
    disposables.push(curbGeometry, gravelGeometry, railGeometry, railMaterial);
  }
  disposables.push(curbMaterial, gravelMaterial);

  const postSpacing = Math.max(1, Math.round(POST_SPACING_M / track.spacingM));
  const postCount = Math.ceil(track.sampleCount / postSpacing) * 2;
  const postGeometry = new THREE.BoxGeometry(0.14, 1.2, 0.14).translate(0, 0.6, 0);
  const postMaterial = new THREE.MeshStandardMaterial({ color: "#6f747c", metalness: 0.6, roughness: 0.5 });
  const posts = new THREE.InstancedMesh(postGeometry, postMaterial, postCount);
  const matrix = new THREE.Matrix4();
  let postIndex = 0;
  for (let index = 0; index < track.sampleCount; index += postSpacing) {
    for (const side of [1, -1]) {
      const offset = side * (track.halfWidth[index] + track.runoffM + 0.55);
      matrix.makeTranslation(track.x[index] + track.tangentZ[index] * offset, track.y[index], track.z[index] - track.tangentX[index] * offset);
      posts.setMatrixAt(postIndex, matrix);
      postIndex += 1;
    }
  }
  posts.count = postIndex;
  posts.castShadow = true;
  group.add(posts);
  disposables.push(postGeometry, postMaterial, posts);

  const checkerCanvas = document.createElement("canvas");
  checkerCanvas.width = 128;
  checkerCanvas.height = 16;
  const checkerContext = checkerCanvas.getContext("2d");
  for (let column = 0; column < 16; column += 1) {
    for (let row = 0; row < 2; row += 1) {
      checkerContext.fillStyle = (column + row) % 2 === 0 ? "#f4f4f4" : "#18181c";
      checkerContext.fillRect(column * 8, row * 8, 8, 8);
    }
  }
  const checkerTexture = new THREE.CanvasTexture(checkerCanvas);
  checkerTexture.colorSpace = THREE.SRGBColorSpace;
  checkerTexture.magFilter = THREE.NearestFilter;
  const startWidth = track.halfWidth[0] * 2;
  const startGeometry = new THREE.PlaneGeometry(startWidth, 2).rotateX(-Math.PI / 2);
  const startMaterial = new THREE.MeshStandardMaterial({ map: checkerTexture, roughness: 0.7 });
  const startLine = new THREE.Mesh(startGeometry, startMaterial);
  const startYaw = Math.atan2(track.tangentX[0], track.tangentZ[0]);
  startLine.position.set(track.x[0], track.y[0] + ROAD_LIFT_M + 0.02, track.z[0]);
  startLine.rotation.y = startYaw;
  startLine.receiveShadow = true;
  group.add(startLine);
  disposables.push(checkerTexture, startGeometry, startMaterial);

  const bannerCanvas = document.createElement("canvas");
  bannerCanvas.width = 512;
  bannerCanvas.height = 64;
  const bannerContext = bannerCanvas.getContext("2d");
  bannerContext.fillStyle = "#1a1220";
  bannerContext.fillRect(0, 0, 512, 64);
  bannerContext.fillStyle = "#ff7a3d";
  bannerContext.fillRect(0, 56, 512, 8);
  bannerContext.font = "700 40px 'Space Grotesk', sans-serif";
  bannerContext.textAlign = "center";
  bannerContext.textBaseline = "middle";
  bannerContext.fillStyle = "#fff4ea";
  bannerContext.fillText("DRIFTLINE · SUNSET CLIFFS", 256, 30);
  const bannerTexture = new THREE.CanvasTexture(bannerCanvas);
  bannerTexture.colorSpace = THREE.SRGBColorSpace;
  const gantry = new THREE.Group();
  const pillarGeometry = new THREE.BoxGeometry(0.6, 7, 0.6).translate(0, 3.5, 0);
  const pillarMaterial = new THREE.MeshStandardMaterial({ color: "#2b2530", metalness: 0.5, roughness: 0.4 });
  const span = startWidth + 2 * (track.runoffM + 1);
  for (const side of [1, -1]) {
    const pillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
    pillar.position.x = (side * span) / 2;
    pillar.castShadow = true;
    gantry.add(pillar);
  }
  const bannerGeometry = new THREE.BoxGeometry(span, 1.6, 0.4);
  const bannerMaterials = [pillarMaterial, pillarMaterial, pillarMaterial, pillarMaterial,
    new THREE.MeshStandardMaterial({ map: bannerTexture, emissive: "#ffffff", emissiveMap: bannerTexture, emissiveIntensity: 0.35 }),
    new THREE.MeshStandardMaterial({ map: bannerTexture, emissive: "#ffffff", emissiveMap: bannerTexture, emissiveIntensity: 0.35 })];
  const banner = new THREE.Mesh(bannerGeometry, bannerMaterials);
  banner.position.y = 7.4;
  banner.castShadow = true;
  gantry.add(banner);
  gantry.position.set(track.x[0], track.y[0], track.z[0]);
  gantry.rotation.y = startYaw;
  group.add(gantry);
  disposables.push(bannerTexture, pillarGeometry, pillarMaterial, bannerGeometry, bannerMaterials[4], bannerMaterials[5]);

  return {
    dispose() {
      scene.remove(group);
      for (const disposable of disposables) disposable.dispose();
    },
  };
}
