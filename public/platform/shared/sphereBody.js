/** Pure bounded sphere motion against static axis-aligned solids and a floor. */

const CONTACT_EPSILON = 1e-8;
const MAX_SOLID_COUNT = 256;
const MAX_DEPENETRATION_PASSES = 4;
const MAX_SUBSTEP_SEC = 1 / 120;

/**
 * @typedef {{x:number,y:number,z:number,vx:number,vy:number,vz:number}} SphereBody
 * @typedef {{minX:number,maxX:number,minY:number,maxY:number,minZ:number,maxZ:number}} SphereSolid
 * @typedef {{startX:number,startY:number,startZ:number,endX:number,endY:number,endZ:number}} SphereTravelSegment
 * @typedef {{fraction:number,normalX:number,normalY:number,normalZ:number}} SphereContact
 * @typedef {object} SphereBodySettings
 * @property {number} [radius=0.4] Positive radius in world units.
 * @property {number} [gravity=18] Downward acceleration in units/second squared.
 * @property {number} [restitution=0.72] Normal velocity retained in [0,1].
 * @property {number} [floorRestitution] Defaults to restitution.
 * @property {number} [linearDamping=0.12] Exponential drag rate per second.
 * @property {number} [groundFriction=1.6] Horizontal deceleration while resting.
 * @property {number} [restSpeed=0.55] Contacts below this normal speed settle.
 * @property {number} [maxSpeed=64] Positive total speed limit.
 * @property {number} [maxDtSec=0.05] Long steps are clamped to this duration.
 * @property {number} [maxSubsteps=8] Integer in [1,64].
 * @property {number} [maxContacts=8] Integer in [1,32], per substep.
 * @typedef {object} SphereBodyContext
 * @property {ReadonlyArray<Readonly<SphereSolid>>} solids At most 256 static boxes.
 * @property {number} [floorY] Optional infinite horizontal floor height.
 * @property {(segment:Readonly<SphereTravelSegment>)=>void} [onTravel] Actual swept segments, excluding depenetration.
 */

const DEFAULT_SPHERE_SETTINGS = Object.freeze({
  radius: 0.4,
  gravity: 18,
  restitution: 0.72,
  linearDamping: 0.12,
  groundFriction: 1.6,
  restSpeed: 0.55,
  maxSpeed: 64,
  maxDtSec: 0.05,
  maxSubsteps: 8,
  maxContacts: 8,
});

/** @param {string} name @param {number} value @param {number} minimum */
function validateSphereNumber(name, value, minimum) {
  if (!Number.isFinite(value) || value < minimum) {
    throw new TypeError(`Sphere body ${name} must be finite and at least ${minimum}.`);
  }
}

/** @param {SphereBodySettings} settings @returns {Required<SphereBodySettings>} */
function parseSphereSettings(settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new TypeError("Sphere body requires a settings object.");
  }
  const sphereSettings = { ...DEFAULT_SPHERE_SETTINGS, ...settings };
  sphereSettings.floorRestitution ??= sphereSettings.restitution;
  for (const key of /** @type {const} */ (["radius", "maxSpeed", "maxDtSec"])) {
    validateSphereNumber(key, sphereSettings[key], Number.MIN_VALUE);
  }
  for (const key of /** @type {const} */ (["gravity", "linearDamping", "groundFriction", "restSpeed", "restitution", "floorRestitution"])) {
    validateSphereNumber(key, sphereSettings[key], 0);
  }
  if (sphereSettings.restitution > 1 || sphereSettings.floorRestitution > 1) {
    throw new TypeError("Sphere body restitution must be within [0,1].");
  }
  for (const [key, maximum] of /** @type {const} */ ([["maxSubsteps", 64], ["maxContacts", 32]])) {
    if (!Number.isInteger(sphereSettings[key]) || sphereSettings[key] < 1 || sphereSettings[key] > maximum) {
      throw new TypeError(`Sphere body ${key} must be an integer in [1,${maximum}].`);
    }
  }
  return sphereSettings;
}

/**
 * Validate caller-owned values before any simulation mutation.
 * @param {SphereBody} body
 * @param {number} dtSec
 * @param {SphereBodyContext} context
 * @returns {void}
 */
function validateSphereStep(body, dtSec, context) {
  validateSphereNumber("dtSec", dtSec, 0);
  for (const key of /** @type {const} */ (["x", "y", "z", "vx", "vy", "vz"])) {
    if (!Number.isFinite(body[key])) {
      throw new TypeError(`Sphere body ${key} must be finite.`);
    }
  }
  if (!context || !Array.isArray(context.solids) || context.solids.length > MAX_SOLID_COUNT) {
    throw new TypeError(`Sphere body solids must be an array with at most ${MAX_SOLID_COUNT} boxes.`);
  }
  if (context.floorY !== undefined && !Number.isFinite(context.floorY)) {
    throw new TypeError("Sphere body floorY must be finite.");
  }
  if (context.onTravel !== undefined && typeof context.onTravel !== "function") {
    throw new TypeError("Sphere body onTravel must be a function.");
  }
  for (const solid of context.solids) {
    for (const axis of /** @type {const} */ (["X", "Y", "Z"])) {
      if (!Number.isFinite(solid[`min${axis}`]) || !Number.isFinite(solid[`max${axis}`]) ||
          solid[`max${axis}`] <= solid[`min${axis}`]) {
        throw new TypeError("Sphere body solids require finite positive extents.");
      }
    }
  }
}

/** @param {number} value @param {number} minimum @param {number} maximum */
function clampSphereCoordinate(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

/**
 * Distance to a box is piecewise quadratic along a ray. Splitting only at the
 * six slab crossings gives exact rounded faces, edges and corners without
 * inflating the whole box into a larger cube.
 * @param {SphereBody} body
 * @param {Readonly<SphereSolid>} solid
 * @param {number} durationSec
 * @param {number} radius
 * @returns {SphereContact|null}
 */
function sweepSphereAgainstSolid(body, solid, durationSec, radius) {
  const endX = body.x + body.vx * durationSec;
  const endY = body.y + body.vy * durationSec;
  const endZ = body.z + body.vz * durationSec;
  if (Math.max(body.x, endX) + radius < solid.minX - CONTACT_EPSILON ||
      Math.min(body.x, endX) - radius > solid.maxX + CONTACT_EPSILON ||
      Math.max(body.y, endY) + radius < solid.minY - CONTACT_EPSILON ||
      Math.min(body.y, endY) - radius > solid.maxY + CONTACT_EPSILON ||
      Math.max(body.z, endZ) + radius < solid.minZ - CONTACT_EPSILON ||
      Math.min(body.z, endZ) - radius > solid.maxZ + CONTACT_EPSILON) return null;

  const positions = [body.x, body.y, body.z];
  const deltas = [body.vx * durationSec, body.vy * durationSec, body.vz * durationSec];
  const minima = [solid.minX, solid.minY, solid.minZ];
  const maxima = [solid.maxX, solid.maxY, solid.maxZ];
  const breakpoints = [0, 1];
  for (let axis = 0; axis < 3; axis += 1) {
    if (Math.abs(deltas[axis]) <= CONTACT_EPSILON) continue;
    for (const boundary of [minima[axis], maxima[axis]]) {
      const fraction = (boundary - positions[axis]) / deltas[axis];
      if (fraction > 0 && fraction < 1) breakpoints.push(fraction);
    }
  }
  breakpoints.sort((firstFraction, secondFraction) => firstFraction - secondFraction);
  for (let interval = 0; interval < breakpoints.length - 1; interval += 1) {
    const start = breakpoints[interval];
    const end = breakpoints[interval + 1];
    const midpoint = (start + end) * 0.5;
    let quadratic = 0;
    let projection = 0;
    let constant = -radius * radius;
    for (let axis = 0; axis < 3; axis += 1) {
      const sample = positions[axis] + deltas[axis] * midpoint;
      if (sample >= minima[axis] && sample <= maxima[axis]) continue;
      const offset = positions[axis] - (sample < minima[axis] ? minima[axis] : maxima[axis]);
      quadratic += deltas[axis] * deltas[axis];
      projection += offset * deltas[axis];
      constant += offset * offset;
    }
    if (quadratic <= CONTACT_EPSILON * CONTACT_EPSILON) continue;
    const discriminant = projection * projection - quadratic * constant;
    if (discriminant < 0) continue;
    const fraction = (-projection - Math.sqrt(Math.max(0, discriminant))) / quadratic;
    if (fraction < start - CONTACT_EPSILON || fraction > end + CONTACT_EPSILON) continue;
    const boundedFraction = clampSphereCoordinate(fraction, 0, 1);
    const x = body.x + deltas[0] * boundedFraction;
    const y = body.y + deltas[1] * boundedFraction;
    const z = body.z + deltas[2] * boundedFraction;
    const offsetX = x - clampSphereCoordinate(x, solid.minX, solid.maxX);
    const offsetY = y - clampSphereCoordinate(y, solid.minY, solid.maxY);
    const offsetZ = z - clampSphereCoordinate(z, solid.minZ, solid.maxZ);
    const distance = Math.hypot(offsetX, offsetY, offsetZ);
    const normalX = offsetX / distance;
    const normalY = offsetY / distance;
    const normalZ = offsetZ / distance;
    if (body.vx * normalX + body.vy * normalY + body.vz * normalZ >= -CONTACT_EPSILON) continue;
    return { fraction: boundedFraction, normalX, normalY, normalZ };
  }
  return null;
}

/** @param {SphereBody} body @param {ReadonlyArray<Readonly<SphereSolid>>} solids @param {number|undefined} floorY @param {number} durationSec @param {number} radius */
function findSphereContact(body, solids, floorY, durationSec, radius) {
  let contact = null;
  if (floorY !== undefined && body.vy < -CONTACT_EPSILON) {
    const fraction = (floorY + radius - body.y) / (body.vy * durationSec);
    if (fraction >= -CONTACT_EPSILON && fraction <= 1) {
      contact = { fraction: Math.max(0, fraction), normalX: 0, normalY: 1, normalZ: 0 };
    }
  }
  for (const solid of solids) {
    const candidate = sweepSphereAgainstSolid(body, solid, durationSec, radius);
    if (candidate && (!contact || candidate.fraction < contact.fraction)) contact = candidate;
  }
  return contact;
}

/**
 * Remove existing overlaps without reporting them as traveled goal crossings.
 * @param {SphereBody} body
 * @param {ReadonlyArray<Readonly<SphereSolid>>} solids
 * @param {number|undefined} floorY
 * @param {number} radius
 */
function separateSphereFromSolids(body, solids, floorY, radius) {
  if (floorY !== undefined && body.y < floorY + radius) body.y = floorY + radius;
  for (let pass = 0; pass < MAX_DEPENETRATION_PASSES; pass += 1) {
    let separated = false;
    for (const solid of solids) {
      const offsetX = body.x - clampSphereCoordinate(body.x, solid.minX, solid.maxX);
      const offsetY = body.y - clampSphereCoordinate(body.y, solid.minY, solid.maxY);
      const offsetZ = body.z - clampSphereCoordinate(body.z, solid.minZ, solid.maxZ);
      const distance = Math.hypot(offsetX, offsetY, offsetZ);
      if (distance >= radius - CONTACT_EPSILON) continue;
      let normalX = 0;
      let normalY = 0;
      let normalZ = 0;
      let penetration = radius - distance;
      if (distance > CONTACT_EPSILON) {
        normalX = offsetX / distance;
        normalY = offsetY / distance;
        normalZ = offsetZ / distance;
      } else {
        const exits = [body.x - solid.minX, solid.maxX - body.x, body.y - solid.minY,
          solid.maxY - body.y, body.z - solid.minZ, solid.maxZ - body.z];
        let exit = 0;
        for (let index = 1; index < exits.length; index += 1) if (exits[index] < exits[exit]) exit = index;
        penetration = radius + exits[exit];
        normalX = exit === 0 ? -1 : exit === 1 ? 1 : 0;
        normalY = exit === 2 ? -1 : exit === 3 ? 1 : 0;
        normalZ = exit === 4 ? -1 : exit === 5 ? 1 : 0;
      }
      body.x += normalX * (penetration + CONTACT_EPSILON);
      body.y += normalY * (penetration + CONTACT_EPSILON);
      body.z += normalZ * (penetration + CONTACT_EPSILON);
      const inwardSpeed = body.vx * normalX + body.vy * normalY + body.vz * normalZ;
      if (inwardSpeed < 0) {
        body.vx -= inwardSpeed * normalX;
        body.vy -= inwardSpeed * normalY;
        body.vz -= inwardSpeed * normalZ;
      }
      separated = true;
    }
    if (!separated) break;
  }
}

/** @param {SphereBody} body @param {number} durationSec @param {SphereBodyContext["onTravel"]} onTravel */
function travelSphere(body, durationSec, onTravel) {
  const startX = body.x;
  const startY = body.y;
  const startZ = body.z;
  body.x += body.vx * durationSec;
  body.y += body.vy * durationSec;
  body.z += body.vz * durationSec;
  if (onTravel && durationSec > 0 && (body.x !== startX || body.y !== startY || body.z !== startZ)) {
    onTravel({ startX, startY, startZ, endX: body.x, endY: body.y, endZ: body.z });
  }
}

/**
 * Create a reusable sphere controller. Each step mutates only its body; settings
 * and static geometry remain caller-owned. Travel callbacks receive owned small
 * segments and must not mutate the body. Sweeps prevent tunneling at the work
 * limit; unresolved remaining motion is discarded after maxContacts. Invalid
 * inputs throw before body mutation. A zero step only resolves penetration.
 * @param {SphereBodySettings} [settings]
 * @returns {{step:(body:SphereBody,dtSec:number,context:SphereBodyContext)=>{bounceCount:number}}}
 * @throws {TypeError} For invalid settings, body, duration or static geometry.
 */
export function createSphereBodyController(settings = {}) {
  const sphereSettings = parseSphereSettings(settings);
  const { radius, gravity, restitution, floorRestitution, linearDamping, groundFriction,
    restSpeed, maxSpeed, maxDtSec, maxSubsteps, maxContacts } = sphereSettings;

  /** @param {SphereBody} body @param {number} dtSec @param {SphereBodyContext} context */
  function step(body, dtSec, context) {
    validateSphereStep(body, dtSec, context);
    const { solids, floorY, onTravel } = context;
    const durationSec = Math.min(dtSec, maxDtSec);
    let bounceCount = 0;
    separateSphereFromSolids(body, solids, floorY, radius);
    const substeps = Math.min(maxSubsteps, Math.max(1, Math.ceil(durationSec / MAX_SUBSTEP_SEC)));
    const substepSec = durationSec / substeps;
    for (let index = 0; index < substeps && durationSec > 0; index += 1) {
      const restingOnFloor = floorY !== undefined && body.y <= floorY + radius + CONTACT_EPSILON && body.vy <= 0;
      if (restingOnFloor) {
        body.y = floorY + radius;
        body.vy = 0;
      } else {
        body.vy -= gravity * substepSec;
      }
      const drag = Math.exp(-linearDamping * substepSec);
      body.vx *= drag;
      body.vy *= drag;
      body.vz *= drag;
      if (restingOnFloor) {
        const horizontalSpeed = Math.hypot(body.vx, body.vz);
        const frictionScale = horizontalSpeed > 0 ? Math.max(0, 1 - groundFriction * substepSec / horizontalSpeed) : 0;
        body.vx *= frictionScale;
        body.vz *= frictionScale;
      }
      const speed = Math.hypot(body.vx, body.vy, body.vz);
      if (speed > maxSpeed) {
        body.vx *= maxSpeed / speed;
        body.vy *= maxSpeed / speed;
        body.vz *= maxSpeed / speed;
      }
      let remainingSec = substepSec;
      for (let contactIndex = 0; contactIndex < maxContacts && remainingSec > CONTACT_EPSILON; contactIndex += 1) {
        const contact = findSphereContact(body, solids, floorY, remainingSec, radius);
        if (!contact) {
          travelSphere(body, remainingSec, onTravel);
          break;
        }
        travelSphere(body, remainingSec * contact.fraction, onTravel);
        const { normalX, normalY, normalZ } = contact;
        const inwardSpeed = body.vx * normalX + body.vy * normalY + body.vz * normalZ;
        const isFloor = floorY !== undefined && normalY > 0.999 && Math.abs(body.y - floorY - radius) < CONTACT_EPSILON * 4;
        const bounce = -inwardSpeed > restSpeed ? (isFloor ? floorRestitution : restitution) : 0;
        body.vx -= (1 + bounce) * inwardSpeed * normalX;
        body.vy -= (1 + bounce) * inwardSpeed * normalY;
        body.vz -= (1 + bounce) * inwardSpeed * normalZ;
        if (-inwardSpeed > restSpeed) bounceCount += 1;
        if (isFloor && body.vy < restSpeed) body.vy = 0;
        body.x += normalX * CONTACT_EPSILON;
        body.y += normalY * CONTACT_EPSILON;
        body.z += normalZ * CONTACT_EPSILON;
        if (isFloor && body.vy === 0) body.y = floorY + radius;
        remainingSec *= 1 - contact.fraction;
      }
    }
    return { bounceCount };
  }
  return { step };
}
