import * as THREE from "three";

/**
 * Procedural fighter, an original design: lofted fuselage, swept wing with
 * leading-edge root extensions, twin canted tails, all-moving tailplanes,
 * gold-tinted canopy, twin afterburning nozzles and rail missiles. Built in
 * local space with +Z forward and +Y up; about 16 m long.
 */

/** Fuselage stations: [z, half width, half height, centre height]. */
const FUSELAGE_STATIONS = Object.freeze([
  [-7.9, 0.9, 0.62, 0], [-7.2, 1.15, 0.72, 0.02], [-5.5, 1.35, 0.85, 0.06], [-3, 1.5, 0.95, 0.1],
  [-0.5, 1.48, 1.0, 0.14], [1.8, 1.22, 0.98, 0.2], [3.6, 0.92, 0.82, 0.18], [5.4, 0.62, 0.6, 0.12],
  [7, 0.32, 0.34, 0.06], [8.2, 0.03, 0.03, 0.02],
]);
const RING_SEGMENTS = 28;
const SUPERELLIPSE = 2.6;

/** Lofted fuselage with smooth normals and UVs (u around, v along). */
function createFuselageGeometry() {
  const positions = [];
  const uvs = [];
  const indices = [];
  FUSELAGE_STATIONS.forEach(([z, halfWidth, halfHeight, centre], station) => {
    for (let segment = 0; segment <= RING_SEGMENTS; segment += 1) {
      const angle = (segment / RING_SEGMENTS) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const x = Math.sign(cos) * Math.abs(cos) ** (2 / SUPERELLIPSE) * halfWidth;
      const belly = sin < 0 ? 0.82 : 1;
      const y = centre + Math.sign(sin) * Math.abs(sin) ** (2 / SUPERELLIPSE) * halfHeight * belly;
      positions.push(x, y, z);
      uvs.push(segment / RING_SEGMENTS, station / (FUSELAGE_STATIONS.length - 1));
    }
  });
  const stride = RING_SEGMENTS + 1;
  for (let station = 0; station < FUSELAGE_STATIONS.length - 1; station += 1) {
    for (let segment = 0; segment < RING_SEGMENTS; segment += 1) {
      const a = station * stride + segment;
      const b = a + stride;
      indices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A thin lifting surface from a planform in (outward, forward) metres,
 * extruded downward by its thickness and bevelled for a rounded edge.
 * @param {ReadonlyArray<readonly [number,number]>} planform
 * @param {number} thickness
 */
function createSurfaceGeometry(planform, thickness) {
  const shape = new THREE.Shape(planform.map(([outward, forward]) => new THREE.Vector2(outward, forward)));
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true, bevelThickness: thickness * 0.35, bevelSize: thickness * 0.35, bevelSegments: 2, curveSegments: 2 });
  geometry.rotateX(Math.PI / 2);
  geometry.translate(0, thickness / 2, 0);
  geometry.computeVertexNormals();
  return geometry;
}

/** Grey panel-lined skin with subtle weathering, drawn on a canvas. */
function createPanelTexture() {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  context.fillStyle = "#8a929b";
  context.fillRect(0, 0, size, size);
  const image = context.getImageData(0, 0, size, size);
  for (let index = 0; index < image.data.length; index += 4) {
    const grain = (Math.random() - 0.5) * 10;
    image.data[index] += grain;
    image.data[index + 1] += grain;
    image.data[index + 2] += grain;
  }
  context.putImageData(image, 0, 0);
  context.globalAlpha = 0.12;
  for (let patch = 0; patch < 40; patch += 1) {
    context.fillStyle = Math.random() > 0.5 ? "#6f7780" : "#a3aab2";
    context.fillRect(Math.random() * size, Math.random() * size, 20 + Math.random() * 90, 14 + Math.random() * 60);
  }
  context.globalAlpha = 0.55;
  context.strokeStyle = "#3d434a";
  context.lineWidth = 1.2;
  for (let line = 0; line < 14; line += 1) {
    const offset = (line / 14) * size + Math.random() * 12;
    context.beginPath();
    context.moveTo(offset, 0);
    context.lineTo(offset + Math.random() * 8, size);
    context.stroke();
    context.beginPath();
    context.moveTo(0, offset);
    context.lineTo(size, offset + Math.random() * 8);
    context.stroke();
  }
  context.globalAlpha = 0.5;
  context.fillStyle = "#3d434a";
  for (let rivet = 0; rivet < 260; rivet += 1) context.fillRect(Math.random() * size, Math.random() * size, 1.5, 1.5);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** Shared geometry and textures; build once per renderer. */
export function createSkybreakJetKit() {
  const panel = createPanelTexture();
  const wingPlanform = [[0.9, 3.4], [1.7, 1.2], [6.6, -2.6], [6.7, -3.5], [0.9, -4.3]];
  const tailplanePlanform = [[0, 0.9], [2.6, -0.6], [2.6, -1.3], [0, -1.1]];
  const finPlanform = [[0, 0], [2.9, -2.6], [2.9, -3.3], [0, -2.6]];
  const canopy = new THREE.SphereGeometry(1, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2);
  canopy.scale(0.62, 0.62, 2.1);
  const nozzle = new THREE.CylinderGeometry(0.56, 0.62, 1.1, 22, 1, true).rotateX(Math.PI / 2);
  const intake = new THREE.BoxGeometry(0.85, 0.95, 2.8);
  const missileBody = new THREE.CylinderGeometry(0.1, 0.1, 2.7, 10).rotateX(Math.PI / 2);
  const missileNose = new THREE.ConeGeometry(0.1, 0.4, 10).rotateX(Math.PI / 2).translate(0, 0, 1.55);
  const missileFin = new THREE.BoxGeometry(0.44, 0.02, 0.3);
  const flame = new THREE.ConeGeometry(0.42, 3.4, 16, 1, true).rotateX(-Math.PI / 2).translate(0, 0, -1.7);
  const glow = new THREE.CircleGeometry(0.5, 20);
  const navLight = new THREE.SphereGeometry(0.09, 8, 6);
  return {
    panel,
    geometry: {
      fuselage: createFuselageGeometry(),
      wing: createSurfaceGeometry(wingPlanform, 0.16),
      tailplane: createSurfaceGeometry(tailplanePlanform, 0.1),
      fin: (() => {
        const geometry = createSurfaceGeometry(finPlanform, 0.12);
        geometry.rotateZ(Math.PI / 2);
        return geometry;
      })(),
      canopy, nozzle, intake, missileBody, missileNose, missileFin, flame, glow, navLight,
    },
    dispose() {
      panel.dispose();
      Object.values(this.geometry).forEach((geometry) => geometry.dispose());
    },
  };
}

/**
 * Build one jet. Materials are owned per jet so tail colours, afterburner
 * glow and visibility stay independent; geometry and the skin texture are
 * shared through the kit.
 * @param {ReturnType<typeof createSkybreakJetKit>} kit
 * @param {string} accentColor
 */
export function createSkybreakJetMesh(kit, accentColor) {
  const geometry = kit.geometry;
  const skin = new THREE.MeshPhysicalMaterial({ color: "#c3c9cf", map: kit.panel, metalness: 0.45, roughness: 0.5, clearcoat: 0.25, clearcoatRoughness: 0.4 });
  const accent = new THREE.MeshPhysicalMaterial({ color: new THREE.Color("#8a929b").lerp(new THREE.Color(accentColor), 0.55), map: kit.panel, metalness: 0.4, roughness: 0.5 });
  const dark = new THREE.MeshStandardMaterial({ color: "#22262b", metalness: 0.7, roughness: 0.45 });
  const canopy = new THREE.MeshPhysicalMaterial({ color: "#b8913a", metalness: 0.95, roughness: 0.06, clearcoat: 1, clearcoatRoughness: 0.02 });
  const flameMaterial = new THREE.MeshBasicMaterial({ color: "#ffb15c", transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  const glowMaterial = new THREE.MeshBasicMaterial({ color: "#ff7a3d", transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const missileMaterial = new THREE.MeshStandardMaterial({ color: "#e4e6e8", metalness: 0.3, roughness: 0.5 });
  const red = new THREE.MeshBasicMaterial({ color: "#ff2a2a", toneMapped: false });
  const green = new THREE.MeshBasicMaterial({ color: "#2aff6a", toneMapped: false });
  const white = new THREE.MeshBasicMaterial({ color: "#ffffff", toneMapped: false });
  const materials = [skin, accent, dark, canopy, flameMaterial, glowMaterial, missileMaterial, red, green, white];

  const root = new THREE.Group();
  const add = (mesh, parent = root) => {
    mesh.castShadow = true;
    parent.add(mesh);
    return mesh;
  };
  add(new THREE.Mesh(geometry.fuselage, skin));
  const canopyMesh = add(new THREE.Mesh(geometry.canopy, canopy));
  canopyMesh.position.set(0, 0.92, 2.3);
  for (const side of [1, -1]) {
    const wing = add(new THREE.Mesh(geometry.wing, skin));
    wing.position.set(0, -0.05, 0);
    wing.scale.x = side;
    const intake = add(new THREE.Mesh(geometry.intake, skin));
    intake.position.set(side * 1.3, -0.25, 1.4);
    const fin = add(new THREE.Mesh(geometry.fin, accent));
    fin.position.set(side * 1.0, 0.75, -3.9);
    fin.rotation.z = side * -0.26;
    fin.scale.x = side;
    const nozzle = add(new THREE.Mesh(geometry.nozzle, dark));
    nozzle.position.set(side * 0.58, 0.05, -8.2);
    const glow = new THREE.Mesh(geometry.glow, glowMaterial);
    glow.position.set(side * 0.58, 0.05, -8.6);
    glow.rotation.y = Math.PI;
    root.add(glow);
    const flame = new THREE.Mesh(geometry.flame, flameMaterial);
    flame.position.set(side * 0.58, 0.05, -8.7);
    root.add(flame);
    const navLight = new THREE.Mesh(geometry.navLight, side > 0 ? red : green);
    navLight.position.set(side * 6.7, 0.05, -3.05);
    root.add(navLight);
  }
  const tailLight = new THREE.Mesh(geometry.navLight, white);
  tailLight.position.set(0, 0.4, -8.05);
  root.add(tailLight);

  const tailplanes = [1, -1].map((side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 1.25, 0, -6.4);
    const tailplane = add(new THREE.Mesh(geometry.tailplane, skin), pivot);
    tailplane.scale.x = side;
    root.add(pivot);
    return pivot;
  });

  const missiles = [1, -1].map((side) => {
    const missile = new THREE.Group();
    missile.position.set(side * 3.4, -0.32, -1.1);
    add(new THREE.Mesh(geometry.missileBody, missileMaterial), missile);
    add(new THREE.Mesh(geometry.missileNose, dark), missile);
    for (const angle of [0, Math.PI / 2]) {
      const fin = new THREE.Mesh(geometry.missileFin, dark);
      fin.position.z = -1.15;
      fin.rotation.z = angle;
      missile.add(fin);
    }
    root.add(missile);
    return missile;
  });

  const flames = root.children.filter((child) => child.isMesh && child.material === flameMaterial);
  return {
    root,
    tailplanes,
    missiles,
    flames,
    materials,
    flameMaterial,
    glowMaterial,
    /**
     * Pose control surfaces and engine effects. Tailplanes deflect together
     * for pitch and differentially for roll, as all-moving stabilators do.
     * @param {{pitchInput:number,rollInput:number,boosting:boolean,missiles:number,speed:number}} jet
     * @param {number} timeSec
     */
    animate(jet, timeSec) {
      tailplanes[0].rotation.x = -jet.pitchInput * 0.32 + jet.rollInput * 0.22;
      tailplanes[1].rotation.x = -jet.pitchInput * 0.32 - jet.rollInput * 0.22;
      missiles[0].visible = jet.missiles >= 1;
      missiles[1].visible = jet.missiles >= 2;
      const burn = jet.boosting ? 1 : 0.18;
      flameMaterial.opacity = jet.boosting ? 0.85 : 0.18;
      glowMaterial.opacity = 0.3 + burn * 0.6;
      const flicker = 0.9 + Math.sin(timeSec * 63) * 0.06 + Math.sin(timeSec * 37) * 0.05;
      for (const flame of flames) flame.scale.set(1, 1, (0.35 + burn * 0.9) * flicker);
    },
    dispose() {
      materials.forEach((material) => material.dispose());
    },
  };
}
