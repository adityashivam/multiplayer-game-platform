/**
 * Sunset Cliffs: a coastal loop. A long start straight along the shore leads
 * into a fast climbing sweeper, a cliff-top esses, a tight hairpin above the
 * sea, and a descending double-apex back to the line. The sea lies to the
 * south (+Z). Points are [x, z, height, width] in metres.
 * @type {import("../track.js").DriftlineTrackDefinition}
 */
export const SUNSET_CLIFFS_TRACK = Object.freeze({
  id: "sunset-cliffs",
  name: "Sunset Cliffs",
  defaultWidthM: 13,
  runoffM: 4,
  surfaceGrip: 1,
  runoffGrip: 0.7,
  sampleSpacingM: 2,
  controlPoints: Object.freeze([
    [-160, 120, 0, 14],
    [-60, 126, 0, 14],
    [40, 120, 0.5, 14],
    [120, 100, 2],
    [175, 55, 5],
    [195, -10, 8],
    [175, -70, 11],
    [125, -95, 12],
    [80, -80, 12],
    [40, -105, 12],
    [-5, -130, 13],
    [-50, -112, 13, 12],
    [-68, -78, 12, 12],
    [-52, -50, 11, 13],
    [-22, -36, 10, 14],
    [-4, -12, 9.5, 15],
    [-24, 12, 9, 14],
    [-75, 4, 8],
    [-125, -24, 7],
    [-175, -55, 6],
    [-225, -20, 4],
    [-235, 45, 2],
    [-210, 100, 0.5, 14],
  ]),
});
