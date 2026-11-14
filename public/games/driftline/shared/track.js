/**
 * @typedef {object} DriftlineTrackDefinition
 * @property {string} id
 * @property {string} name
 * @property {ReadonlyArray<readonly [number,number,number,number?]>} controlPoints Closed loop of [x, z, height, width?] in metres.
 * @property {number} defaultWidthM
 * @property {number} runoffM Gravel between the road edge and the barrier.
 * @property {number} surfaceGrip Multiplies tyre grip on the road.
 * @property {number} runoffGrip Multiplies tyre grip on the runoff.
 * @property {number} [sampleSpacingM]
 *
 * @typedef {object} DriftlineTrack
 * @property {string} id
 * @property {string} name
 * @property {number} sampleCount
 * @property {number} lengthM Lap length along the centre line.
 * @property {number} spacingM
 * @property {Float64Array} x
 * @property {Float64Array} y Road height.
 * @property {Float64Array} z
 * @property {Float64Array} tangentX Unit direction of travel.
 * @property {Float64Array} tangentZ
 * @property {Float64Array} distance Arc length at each sample.
 * @property {Float64Array} halfWidth Road half width.
 * @property {Float64Array} curvature Signed: positive bends toward +yaw (left).
 * @property {number} runoffM
 * @property {number} surfaceGrip
 * @property {number} runoffGrip
 *
 * @typedef {object} DriftlineTrackPosition Caller-owned query result, reused across calls.
 * @property {number} index Nearest sample.
 * @property {number} along Arc length of the projected point, in [0, lengthM).
 * @property {number} lateral Signed offset; positive toward the track's +yaw side.
 * @property {number} height Road height at the projected point.
 * @property {number} halfWidth
 * @property {number} tangentX
 * @property {number} tangentZ
 */

const DENSE_SAMPLES_PER_SEGMENT = 24;
const LOCAL_SEARCH_LIMIT = 40;

/** @param {number} value @param {number} count */
function wrapIndex(value, count) {
  return ((value % count) + count) % count;
}

/**
 * Centripetal Catmull-Rom through a closed loop of control points.
 * @param {DriftlineTrackDefinition} definition
 * @returns {{x:number,y:number,z:number,width:number}[]}
 */
function sampleDriftlineSpline(definition) {
  const points = definition.controlPoints.map(([x, z, y, width]) => ({ x, y, z, width: width ?? definition.defaultWidthM }));
  const dense = [];
  const count = points.length;
  for (let segment = 0; segment < count; segment += 1) {
    const p0 = points[wrapIndex(segment - 1, count)];
    const p1 = points[segment];
    const p2 = points[wrapIndex(segment + 1, count)];
    const p3 = points[wrapIndex(segment + 2, count)];
    const knot = (a, b) => Math.max(1e-4, Math.sqrt(Math.hypot(b.x - a.x, b.z - a.z)));
    const t1 = knot(p0, p1);
    const t2 = t1 + knot(p1, p2);
    const t3 = t2 + knot(p2, p3);
    for (let step = 0; step < DENSE_SAMPLES_PER_SEGMENT; step += 1) {
      const t = t1 + ((t2 - t1) * step) / DENSE_SAMPLES_PER_SEGMENT;
      const blend = (field) => {
        const a1 = ((t1 - t) * p0[field] + t * p1[field]) / t1;
        const a2 = ((t2 - t) * p1[field] + (t - t1) * p2[field]) / (t2 - t1);
        const a3 = ((t3 - t) * p2[field] + (t - t2) * p3[field]) / (t3 - t2);
        const b1 = ((t2 - t) * a1 + t * a2) / t2;
        const b2 = ((t3 - t) * a2 + (t - t1) * a3) / (t3 - t1);
        return ((t2 - t) * b1 + (t - t1) * b2) / (t2 - t1);
      };
      const local = (t - t1) / (t2 - t1);
      dense.push({ x: blend("x"), z: blend("z"), y: p1.y + (p2.y - p1.y) * (3 * local * local - 2 * local * local * local), width: p1.width + (p2.width - p1.width) * local });
    }
  }
  return dense;
}

/**
 * Build an immutable, evenly spaced track from a definition. Pure and
 * deterministic; call once per definition and share the result.
 * @param {DriftlineTrackDefinition} definition
 * @returns {Readonly<DriftlineTrack>}
 * @throws {TypeError} When the loop has fewer than four control points.
 */
export function buildDriftlineTrack(definition) {
  if (!Array.isArray(definition.controlPoints) || definition.controlPoints.length < 4) {
    throw new TypeError("A Driftline track needs at least four control points.");
  }
  const spacingM = definition.sampleSpacingM ?? 2;
  const dense = sampleDriftlineSpline(definition);
  const cumulative = [0];
  for (let index = 1; index <= dense.length; index += 1) {
    const previous = dense[index - 1];
    const current = dense[index % dense.length];
    cumulative.push(cumulative[index - 1] + Math.hypot(current.x - previous.x, current.z - previous.z));
  }
  const lengthM = cumulative[dense.length];
  const sampleCount = Math.max(8, Math.round(lengthM / spacingM));
  const track = {
    id: definition.id,
    name: definition.name,
    sampleCount,
    lengthM,
    spacingM: lengthM / sampleCount,
    x: new Float64Array(sampleCount),
    y: new Float64Array(sampleCount),
    z: new Float64Array(sampleCount),
    tangentX: new Float64Array(sampleCount),
    tangentZ: new Float64Array(sampleCount),
    distance: new Float64Array(sampleCount),
    halfWidth: new Float64Array(sampleCount),
    curvature: new Float64Array(sampleCount),
    runoffM: definition.runoffM,
    surfaceGrip: definition.surfaceGrip,
    runoffGrip: definition.runoffGrip,
  };

  let denseIndex = 0;
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const targetDistance = sample * track.spacingM;
    while (cumulative[denseIndex + 1] < targetDistance) denseIndex += 1;
    const span = cumulative[denseIndex + 1] - cumulative[denseIndex] || 1;
    const amount = (targetDistance - cumulative[denseIndex]) / span;
    const from = dense[denseIndex];
    const to = dense[(denseIndex + 1) % dense.length];
    track.x[sample] = from.x + (to.x - from.x) * amount;
    track.y[sample] = from.y + (to.y - from.y) * amount;
    track.z[sample] = from.z + (to.z - from.z) * amount;
    track.halfWidth[sample] = (from.width + (to.width - from.width) * amount) / 2;
    track.distance[sample] = targetDistance;
  }
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const next = (sample + 1) % sampleCount;
    const previous = wrapIndex(sample - 1, sampleCount);
    const dx = track.x[next] - track.x[previous];
    const dz = track.z[next] - track.z[previous];
    const length = Math.hypot(dx, dz) || 1;
    track.tangentX[sample] = dx / length;
    track.tangentZ[sample] = dz / length;
  }
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const next = (sample + 1) % sampleCount;
    const previous = wrapIndex(sample - 1, sampleCount);
    const headingNext = Math.atan2(track.tangentX[next], track.tangentZ[next]);
    const headingPrevious = Math.atan2(track.tangentX[previous], track.tangentZ[previous]);
    let turn = headingNext - headingPrevious;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    track.curvature[sample] = turn / (2 * track.spacingM);
  }
  return Object.freeze(track);
}

/** @returns {DriftlineTrackPosition} A reusable query result. */
export function createDriftlineTrackPosition() {
  return { index: -1, along: 0, lateral: 0, height: 0, halfWidth: 0, tangentX: 0, tangentZ: 1 };
}

/** @param {Readonly<DriftlineTrack>} track @param {number} index @param {number} x @param {number} z */
function distanceSquaredToSample(track, index, x, z) {
  const dx = x - track.x[index];
  const dz = z - track.z[index];
  return dx * dx + dz * dz;
}

/**
 * Find the nearest sample by walking downhill from a hint, falling back to a
 * full scan when the hint is unknown or the walk runs too far. Writes the
 * projection into `target` and returns it; allocates nothing.
 * @param {Readonly<DriftlineTrack>} track
 * @param {number} x
 * @param {number} z
 * @param {number} hintIndex Previous index, or -1.
 * @param {DriftlineTrackPosition} target
 * @returns {DriftlineTrackPosition}
 */
export function locateOnDriftlineTrack(track, x, z, hintIndex, target) {
  const count = track.sampleCount;
  let best = -1;
  if (hintIndex >= 0 && hintIndex < count) {
    best = hintIndex;
    let bestDistance = distanceSquaredToSample(track, best, x, z);
    for (let steps = 0; steps < LOCAL_SEARCH_LIMIT; steps += 1) {
      const forward = (best + 1) % count;
      const backward = wrapIndex(best - 1, count);
      const forwardDistance = distanceSquaredToSample(track, forward, x, z);
      const backwardDistance = distanceSquaredToSample(track, backward, x, z);
      if (forwardDistance < bestDistance && forwardDistance <= backwardDistance) {
        best = forward;
        bestDistance = forwardDistance;
      } else if (backwardDistance < bestDistance) {
        best = backward;
        bestDistance = backwardDistance;
      } else {
        break;
      }
    }
    const maxReach = track.halfWidth[best] + track.runoffM + 6;
    if (bestDistance > maxReach * maxReach) best = -1;
  }
  if (best < 0) {
    let bestDistance = Infinity;
    for (let index = 0; index < count; index += 1) {
      const distance = distanceSquaredToSample(track, index, x, z);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    }
  }

  const tangentX = track.tangentX[best];
  const tangentZ = track.tangentZ[best];
  const offsetX = x - track.x[best];
  const offsetZ = z - track.z[best];
  const forwardOffset = offsetX * tangentX + offsetZ * tangentZ;
  const next = forwardOffset >= 0 ? (best + 1) % count : best;
  const previous = forwardOffset >= 0 ? best : wrapIndex(best - 1, count);
  const segmentLength = track.spacingM;
  const amount = Math.max(0, Math.min(1, forwardOffset >= 0 ? forwardOffset / segmentLength : 1 + forwardOffset / segmentLength));

  target.index = best;
  target.along = wrapDriftlineDistance(track, track.distance[best] + forwardOffset);
  target.lateral = offsetX * tangentZ - offsetZ * tangentX;
  target.height = track.y[previous] + (track.y[next] - track.y[previous]) * amount;
  target.halfWidth = track.halfWidth[best];
  target.tangentX = tangentX;
  target.tangentZ = tangentZ;
  return target;
}

/**
 * @param {Readonly<DriftlineTrack>} track
 * @param {number} distance Any arc length.
 * @returns {number} The same point within [0, lengthM).
 */
export function wrapDriftlineDistance(track, distance) {
  return ((distance % track.lengthM) + track.lengthM) % track.lengthM;
}

/**
 * Shortest signed travel between two arc lengths across the start line.
 * @param {Readonly<DriftlineTrack>} track
 * @param {number} from
 * @param {number} to
 */
export function getDriftlineTravel(track, from, to) {
  let travel = to - from;
  if (travel > track.lengthM / 2) travel -= track.lengthM;
  if (travel < -track.lengthM / 2) travel += track.lengthM;
  return travel;
}

/**
 * World pose of a point given by arc length and lateral offset.
 * @param {Readonly<DriftlineTrack>} track
 * @param {number} along
 * @param {number} lateral Positive toward the track's +yaw side.
 * @returns {{x:number,y:number,z:number,yaw:number,index:number}}
 */
export function getDriftlineTrackPoint(track, along, lateral) {
  const wrapped = wrapDriftlineDistance(track, along);
  const index = Math.min(track.sampleCount - 1, Math.floor(wrapped / track.spacingM));
  const next = (index + 1) % track.sampleCount;
  const amount = (wrapped - track.distance[index]) / track.spacingM;
  const tangentX = track.tangentX[index];
  const tangentZ = track.tangentZ[index];
  return {
    x: track.x[index] + (track.x[next] - track.x[index]) * amount + tangentZ * lateral,
    y: track.y[index] + (track.y[next] - track.y[index]) * amount,
    z: track.z[index] + (track.z[next] - track.z[index]) * amount - tangentX * lateral,
    yaw: Math.atan2(tangentX, tangentZ),
    index,
  };
}
