import * as THREE from "three";
import { RIFTBALL_COURT, RIFTBALL_TEAM_COLORS } from "../shared/config.js";
import { getRiftballCourtBoundaries } from "./presentation.js";
import {
  createRiftballCourtTexture,
  createRiftballStaticBuilder,
  createRiftballVenueLabel,
  createRiftballVisualRandom,
} from "./resources.js";

const VENUE_HALF_WIDTH = 18;
const VENUE_HALF_LENGTH = 23;
const VENUE_CEILING_HEIGHT = 12.6;

/**
 * Premium indoor court, with physical wall surfaces aligned to shared rules.
 * Static detail is merged by material; only ceiling fans and goal light animate.
 * @param {THREE.Scene} scene
 * @param {ReturnType<import("./resources.js").createRiftballResources>} resources
 */
export function createRiftballArena(scene, resources) {
  const arena = new THREE.Group();
  arena.name = "riftball-court";
  scene.add(arena);
  const staticBuilder = createRiftballStaticBuilder(resources);
  const standardMaterial = (settings) => resources.ownMaterial(new THREE.MeshStandardMaterial(settings));
  const concrete = standardMaterial({ color: "#233346", roughness: 0.9, metalness: 0.04 });
  const darkConcrete = standardMaterial({ color: "#111e2f", roughness: 0.88 });
  const structure = standardMaterial({ color: "#293647", roughness: 0.48, metalness: 0.7 });
  const lightMetal = standardMaterial({ color: "#8c9ea6", roughness: 0.38, metalness: 0.72 });
  const courtMaterial = standardMaterial({ color: "#a3b4bb", map: createRiftballCourtTexture(resources), roughness: 0.68, metalness: 0.08 });
  const courtPaint = standardMaterial({ color: "#d1dedf", roughness: 0.73, polygonOffset: true, polygonOffsetFactor: -1 });
  const centerPaint = standardMaterial({ color: "#486276", roughness: 0.76 });
  const glass = resources.ownMaterial(new THREE.MeshPhysicalMaterial({ color: "#91bed4", transparent: true, opacity: 0.14, roughness: 0.27, metalness: 0.05, depthWrite: false, side: THREE.DoubleSide }));
  const warmLamp = standardMaterial({ color: "#fff3d3", emissive: "#ffe9bc", emissiveIntensity: 2.2, roughness: 0.5 });
  const goalMaterials = RIFTBALL_TEAM_COLORS.map((color) => standardMaterial({ color, emissive: color, emissiveIntensity: 0.48, roughness: 0.36, metalness: 0.3 }));
  const teamPaints = RIFTBALL_TEAM_COLORS.map((color) => standardMaterial({ color, roughness: 0.7, transparent: true, opacity: 0.8 }));
  const seatMaterial = standardMaterial({ color: "#284155", roughness: 0.64 });
  const seatAccent = standardMaterial({ color: "#527585", roughness: 0.7 });
  const crowdDark = standardMaterial({ color: "#243345", roughness: 0.98 });
  const crowdLight = standardMaterial({ color: "#758c92", roughness: 0.98 });

  staticBuilder.box(darkConcrete, [0, -0.32, 0], [VENUE_HALF_WIDTH * 2, 0.5, VENUE_HALF_LENGTH * 2]);
  staticBuilder.box(courtMaterial, [0, -0.085, 0], [RIFTBALL_COURT.halfWidth * 2, 0.16, RIFTBALL_COURT.halfLength * 2], undefined, false);
  staticBuilder.box(centerPaint, [0, 0.002, 0], [RIFTBALL_COURT.halfWidth * 2, 0.008, 0.12], undefined, false);

  for (const boundary of getRiftballCourtBoundaries()) {
    if (boundary.id === "court-ceiling") {
      addCourtSafetyNet(arena, resources, boundary);
    } else if (boundary.id.startsWith("wall-")) {
      const [wallX, , wallZ] = boundary.position;
      staticBuilder.box(concrete, [wallX, 0.6, wallZ], [boundary.size[0], 1.2, boundary.size[2]]);
      staticBuilder.box(glass, [wallX, 3.1, wallZ], [boundary.size[0] * 0.3, 3.8, boundary.size[2]], undefined, false);
      staticBuilder.box(structure, [wallX, 1.22, wallZ], [0.24, 0.13, boundary.size[2]]);
      staticBuilder.box(structure, [wallX, 4.98, wallZ], [0.18, 0.14, boundary.size[2]]);
      for (let panelZ = -16.5; panelZ <= 16.5; panelZ += 3.3) {
        staticBuilder.box(structure, [wallX, 3.08, panelZ], [0.16, 3.8, 0.12]);
      }
    } else {
      staticBuilder.box(boundary.id.startsWith("goal-") ? darkConcrete : concrete, boundary.position, boundary.size);
    }
  }

  addCourtMarkings(staticBuilder, resources, courtPaint, centerPaint, teamPaints);
  const goalLights = addGoalDetails(arena, staticBuilder, resources, goalMaterials, teamPaints, lightMetal);
  addVenueArchitecture(staticBuilder, resources, { darkConcrete, concrete, structure, lightMetal, warmLamp, seatMaterial, seatAccent, crowdDark, crowdLight });
  staticBuilder.finish(arena);

  const fans = createCeilingFans(arena, resources, structure, lightMetal);
  const goalPulseSec = [0, 0];
  let previousGoalSerial = null;
  let previousRoundId = null;

  return {
    update(frame) {
      const dtSec = Math.max(0, Math.min(0.06, frame.dtSec || 0));
      const newRound = frame.roundId !== previousRoundId;
      if (newRound) {
        goalPulseSec[0] = 0;
        goalPulseSec[1] = 0;
      } else if (previousGoalSerial != null && frame.goalSerial !== previousGoalSerial && frame.lastScorer) {
        goalPulseSec[frame.lastScorer === "p1" ? 1 : 0] = 0.85;
      }
      for (let goalIndex = 0; goalIndex < 2; goalIndex += 1) {
        goalPulseSec[goalIndex] = Math.max(0, goalPulseSec[goalIndex] - dtSec);
        const pulse = frame.reducedMotion ? 0 : Math.sin(Math.min(1, goalPulseSec[goalIndex] / 0.85) * Math.PI);
        goalMaterials[goalIndex].emissiveIntensity = 0.48 + pulse * 1.1;
        goalLights[goalIndex].intensity = 4 + pulse * 9;
      }
      if (!frame.reducedMotion) {
        for (const fan of fans) fan.rotation.y += dtSec * 0.62;
      }
      previousRoundId = frame.roundId;
      previousGoalSerial = frame.goalSerial;
    },
    setQuality(quality) {
      for (const goalLight of goalLights) goalLight.visible = !quality.reducedEffects;
    },
    dispose() {
      scene.remove(arena);
    },
  };
}

/**
 * The ball's roof collision is a tensioned safety net, separate from the high
 * architectural ceiling. Sparse lines stay readable from either camera side.
 * @param {THREE.Group} arena
 * @param {ReturnType<import("./resources.js").createRiftballResources>} resources
 * @param {import("./presentation.js").RiftballCourtBoundary} ceiling
 */
function addCourtSafetyNet(arena, resources, ceiling) {
  const halfWidth = ceiling.size[0] / 2;
  const halfLength = ceiling.size[2] / 2;
  const netY = ceiling.position[1] - ceiling.size[1] / 2;
  const strandSpacing = 2.5;
  const strandCoordinates = [];
  for (let netX = -halfWidth; netX <= halfWidth; netX += strandSpacing) {
    strandCoordinates.push(netX, netY, -halfLength, netX, netY, halfLength);
  }
  for (let netZ = -halfLength; netZ <= halfLength; netZ += strandSpacing) {
    strandCoordinates.push(-halfWidth, netY, netZ, halfWidth, netY, netZ);
  }
  const netGeometry = resources.ownGeometry(new THREE.BufferGeometry());
  netGeometry.setAttribute("position", new THREE.Float32BufferAttribute(strandCoordinates, 3));
  const netMaterial = resources.ownMaterial(new THREE.LineBasicMaterial({ color: "#a5bdc6", transparent: true, opacity: 0.11, depthWrite: false }));
  const safetyNet = new THREE.LineSegments(netGeometry, netMaterial);
  safetyNet.name = "riftball-court-safety-net";
  safetyNet.castShadow = false;
  arena.add(safetyNet);
}

function addCourtMarkings(builder, resources, courtPaint, centerPaint, teamPaints) {
  const { halfWidth, halfLength, goalHalfWidth } = RIFTBALL_COURT;
  const stripeHeight = 0.012;
  for (const direction of [-1, 1]) {
    builder.box(courtPaint, [direction * (halfWidth - 0.42), stripeHeight, 0], [0.07, 0.012, (halfLength - 0.5) * 2], undefined, false);
    builder.box(courtPaint, [0, stripeHeight, direction * (halfLength - 0.5)], [(halfWidth - 0.42) * 2, 0.012, 0.07], undefined, false);
    const teamIndex = direction === 1 ? 0 : 1;
    builder.box(teamPaints[teamIndex], [0, -0.025, direction * (halfLength + RIFTBALL_COURT.goalDepth / 2)], [goalHalfWidth * 2, 0.05, RIFTBALL_COURT.goalDepth], undefined, false);
    builder.box(teamPaints[teamIndex], [0, stripeHeight + 0.002, direction * (halfLength - 0.08)], [goalHalfWidth * 2, 0.012, 0.09], undefined, false);
    for (const side of [-1, 1]) {
      builder.box(courtPaint, [side * (goalHalfWidth + 0.75), stripeHeight, direction * (halfLength - 2.2)], [0.065, 0.012, 4.4], undefined, false);
    }
    builder.box(courtPaint, [0, stripeHeight, direction * (halfLength - 4.4)], [(goalHalfWidth + 0.75) * 2, 0.012, 0.065], undefined, false);
    builder.cylinder(courtPaint, [0, 0.015, direction * 9.9], [0.15, 0.015, 0.15], undefined, false);
  }
  const centerCircle = new THREE.RingGeometry(3.1, 3.16, 96);
  builder.geometry(centerCircle, courtPaint, [0, 0.016, 0], [1, 1, 1], [-Math.PI / 2, 0, 0]);
  centerCircle.dispose();
  const centerDisk = new THREE.CircleGeometry(0.14, 24);
  builder.geometry(centerDisk, courtPaint, [0, 0.018, 0], [1, 1, 1], [-Math.PI / 2, 0, 0]);
  centerDisk.dispose();
  for (const direction of [-1, 1]) {
    builder.box(centerPaint, [direction * 7.8, 0.013, 0], [0.08, 0.01, 4], undefined, false);
  }
}

function addGoalDetails(arena, builder, resources, goalMaterials, teamPaints, lightMetal) {
  const { halfLength, goalHalfWidth, goalHeight, goalDepth } = RIFTBALL_COURT;
  const goalLights = [];
  const netCoordinates = [];
  const goalFrameWidth = 0.18;
  for (const direction of [1, -1]) {
    const teamIndex = direction === 1 ? 0 : 1;
    const goalZ = direction * halfLength;
    const backZ = direction * (halfLength + goalDepth - 0.035);
    for (const side of [-1, 1]) {
      const postX = side * (goalHalfWidth + goalFrameWidth / 2);
      builder.box(lightMetal, [postX, goalHeight / 2, goalZ], [goalFrameWidth, goalHeight, 0.22]);
      builder.box(goalMaterials[teamIndex], [postX - side * 0.016, goalHeight / 2, goalZ - direction * 0.122], [0.065, goalHeight, 0.025], undefined, false);
      builder.box(goalMaterials[teamIndex], [side * (goalHalfWidth - 0.03), 0.06, direction * (halfLength + goalDepth / 2)], [0.035, 0.08, goalDepth], undefined, false);
    }
    builder.box(lightMetal, [0, goalHeight + goalFrameWidth / 2, goalZ], [(goalHalfWidth + goalFrameWidth) * 2, goalFrameWidth, 0.22]);
    builder.box(goalMaterials[teamIndex], [0, goalHeight + goalFrameWidth / 2, goalZ - direction * 0.122], [(goalHalfWidth + goalFrameWidth) * 2, 0.065, 0.025], undefined, false);
    builder.box(teamPaints[teamIndex], [0, goalHeight / 2, backZ - direction * 0.03], [goalHalfWidth * 1.5, 1.2, 0.02], undefined, false);
    for (let gridX = -goalHalfWidth; gridX <= goalHalfWidth; gridX += 0.4) {
      netCoordinates.push(gridX, 0.05, backZ, gridX, goalHeight, backZ);
    }
    for (let gridY = 0.1; gridY <= goalHeight; gridY += 0.4) {
      netCoordinates.push(-goalHalfWidth, gridY, backZ, goalHalfWidth, gridY, backZ);
    }
    const goalLight = new THREE.PointLight(RIFTBALL_TEAM_COLORS[teamIndex], 4, 9, 2);
    goalLight.position.set(0, 2, goalZ - direction * 0.8);
    arena.add(goalLight);
    goalLights.push(goalLight);
  }
  const netGeometry = resources.ownGeometry(new THREE.BufferGeometry());
  netGeometry.setAttribute("position", new THREE.Float32BufferAttribute(netCoordinates, 3));
  const netMaterial = resources.ownMaterial(new THREE.LineBasicMaterial({ color: "#a4bec7", transparent: true, opacity: 0.42 }));
  arena.add(new THREE.LineSegments(netGeometry, netMaterial));
  return goalLights;
}

function addVenueArchitecture(builder, resources, materials) {
  const { darkConcrete, concrete, structure, lightMetal, warmLamp, seatMaterial, seatAccent, crowdDark, crowdLight } = materials;
  const labelMaterial = resources.ownMaterial(new THREE.MeshBasicMaterial({ map: createRiftballVenueLabel(resources), transparent: true, depthWrite: false }));
  const random = createRiftballVisualRandom(1701);
  builder.box(darkConcrete, [0, VENUE_CEILING_HEIGHT, 0], [VENUE_HALF_WIDTH * 2, 0.32, VENUE_HALF_LENGTH * 2], undefined, false);
  for (const direction of [-1, 1]) {
    builder.box(concrete, [direction * VENUE_HALF_WIDTH, 6.2, 0], [0.5, 12.4, VENUE_HALF_LENGTH * 2]);
    builder.box(concrete, [0, 6.2, direction * VENUE_HALF_LENGTH], [VENUE_HALF_WIDTH * 2, 12.4, 0.5]);
    builder.box(structure, [0, 6, direction * (VENUE_HALF_LENGTH - 0.29)], [31, 0.16, 0.18]);
    builder.plane(labelMaterial, [0, 7.5, direction * (VENUE_HALF_LENGTH - 0.3)], [13.7, 3.42, 1], [0, direction === 1 ? Math.PI : 0, 0]);

    for (let tier = 0; tier < 3; tier += 1) {
      const tierX = direction * (12.1 + tier * 1.55);
      const tierY = 1.9 + tier * 0.75;
      builder.box(darkConcrete, [tierX, tierY / 2, 0], [1.5, tierY, 29]);
      builder.box(tier % 2 ? seatAccent : seatMaterial, [tierX, tierY + 0.27, 0], [0.75, 0.18, 27.9]);
      builder.box(seatMaterial, [tierX + direction * 0.33, tierY + 0.68, 0], [0.15, 0.66, 27.9]);
      for (let seatIndex = 0; seatIndex < 23; seatIndex += 1) {
        const seatZ = (seatIndex - 11) * 1.14;
        builder.box(lightMetal, [tierX, tierY + 0.39, seatZ], [0.82, 0.04, 0.035], undefined, false);
        if (random() > 0.53) {
          const spectatorMaterial = random() > 0.77 ? crowdLight : crowdDark;
          builder.box(spectatorMaterial, [tierX, tierY + 0.65, seatZ + 0.2], [0.42, 0.56, 0.3], undefined, false);
          builder.sphere(spectatorMaterial, [tierX, tierY + 1.1, seatZ + 0.15], [0.33, 0.38, 0.34], undefined, false);
        }
      }
    }
    builder.box(structure, [direction * 11.15, 2.7, 0], [0.08, 0.08, 29.4]);
    for (let railZ = -14.7; railZ <= 14.7; railZ += 2.94) {
      builder.box(structure, [direction * 11.15, 1.7, railZ], [0.075, 2, 0.075]);
    }
  }

  for (let trussZ = -18; trussZ <= 18; trussZ += 6) {
    builder.box(structure, [0, 11.8, trussZ], [35.4, 0.22, 0.24], undefined, false);
    builder.box(structure, [0, 10.8, trussZ], [35.4, 0.17, 0.17], undefined, false);
    for (let trussX = -15; trussX <= 15; trussX += 3) {
      builder.box(structure, [trussX, 11.3, trussZ], [0.12, 1.1, 0.1], [0, 0, 0.6], false);
    }
  }
  for (const lampX of [-6, 6]) {
    for (const lampZ of [-12, -4, 4, 12]) {
      builder.box(structure, [lampX, 11.58, lampZ], [3.7, 0.25, 1.45], undefined, false);
      builder.box(warmLamp, [lampX, 11.43, lampZ], [3.4, 0.035, 1.2], undefined, false);
    }
  }
  for (const direction of [-1, 1]) {
    for (const pillarZ of [-19.8, -6.6, 6.6, 19.8]) {
      builder.box(structure, [direction * 17.5, 6, pillarZ], [0.45, 12, 0.7]);
    }
  }
}

function createCeilingFans(arena, resources, structure, lightMetal) {
  const fans = [];
  for (const fanZ of [-9, 0, 9]) {
    const fan = new THREE.Group();
    fan.position.set(0, 10.85, fanZ);
    const fanBuilder = createRiftballStaticBuilder(resources);
    fanBuilder.cylinder(lightMetal, [0, 0, 0], [0.36, 0.27, 0.36]);
    for (let bladeIndex = 0; bladeIndex < 4; bladeIndex += 1) {
      const angle = bladeIndex * Math.PI / 2;
      fanBuilder.box(structure, [Math.sin(angle) * 1.02, 0, Math.cos(angle) * 1.02], [0.3, 0.055, 1.9], [0, angle, 0]);
    }
    fanBuilder.finish(fan);
    fan.traverse((fanPart) => { fanPart.castShadow = false; });
    arena.add(fan);
    fans.push(fan);
  }
  return fans;
}
