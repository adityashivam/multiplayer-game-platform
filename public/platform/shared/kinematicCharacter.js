/** Pure upright-cylinder motion against translating platforms with sloped tops. */

const CONTACT_TOLERANCE = 1e-7;
const SUPPORT_TOLERANCE = 1e-5;
const MAX_SLOPED_SUPPORT_REATTACH_DISTANCE = 0.08;
const MAX_PLATFORM_SLOPE_COMPONENT = 1;
const MAX_CONTACTS_PER_SUBSTEP = 6;
const MAX_DEPENETRATION_PASSES = 4;
const MAX_CHARACTER_SUBSTEPS = 128;
const MAX_SEPARATION_ITERATIONS = 32;
const DEFAULT_SEPARATION_ITERATIONS = 6;
const MAX_SUBSTEP_SEC = 1 / 60;

/**
 * @typedef {object} KinematicCharacterBody
 * @property {number} x Horizontal center, in world units.
 * @property {number} y Bottom of the cylinder, in world units; positive Y is up.
 * @property {number} z Horizontal center, in world units.
 * @property {number} vx Motion relative to any grounded support, in units/second.
 * @property {number} vy Vertical speed; zero while grounded.
 * @property {number} vz Motion relative to any grounded support, in units/second.
 * @property {boolean} grounded
 * @property {number} supportId Numeric platform ID; zero means unsupported.
 * @property {number} coyoteSec Remaining grace after leaving support.
 * @property {number} jumpBufferSec Remaining unconsumed jump press.
 * @property {boolean} jumpHeld Previous nonzero step's jump input.
 */

/**
 * @typedef {object} KinematicCharacterInput
 * @property {number} x World-space intent; analog magnitude is retained below one.
 * @property {number} z World-space intent; vectors longer than one are normalized.
 * @property {boolean} jump Jump starts on a rising edge, including a short press.
 */

/**
 * @typedef {object} KinematicPlatform
 * @property {number} id Positive numeric support identifier.
 * @property {number} x Center at the start of the step.
 * @property {number} z Center at the start of the step.
 * @property {number} width Positive X extent.
 * @property {number} depth Positive Z extent.
 * @property {number} topY Upper face at its center at the start of the step.
 * @property {number} thickness Positive vertical distance below the local top.
 * @property {number} vx Constant X velocity during this step.
 * @property {number} vy Constant Y velocity during this step.
 * @property {number} vz Constant Z velocity during this step.
 * @property {number} [slopeX=0] Top-plane X gradient; finite and within [-1,1].
 * @property {number} [slopeZ=0] Top-plane Z gradient; finite and within [-1,1].
 */

/**
 * @typedef {object} KinematicCharacterSettings
 * @property {number} [radius=0.42] Positive horizontal cylinder radius.
 * @property {number} [height=1.5] Positive cylinder height.
 * @property {number} [moveSpeed=8] Positive maximum input speed.
 * @property {number} [acceleration=48] Nonnegative grounded acceleration.
 * @property {number} [airAcceleration=18] Nonnegative airborne acceleration.
 * @property {number} [braking=40] Nonnegative deceleration with no movement intent.
 * @property {number} [gravity=24] Nonnegative downward acceleration.
 * @property {number} [jumpSpeed=9] Positive upward launch speed.
 * @property {number} [coyoteSec=0.1] Nonnegative support grace duration.
 * @property {number} [jumpBufferSec=0.12] Nonnegative early-press duration.
 * @property {number} [maxDtSec=0.1] Positive maximum simulated duration per call.
 * @property {number} [maxSubsteps=12] Integer in [1,128]; sweeps still prevent tunneling at the limit.
 */

/**
 * @typedef {object} KinematicCharacterContext
 * @property {ReadonlyArray<Readonly<KinematicPlatform>>} platforms Start-of-step poses.
 * @property {number} [controlScale=1] Nonnegative acceleration/braking multiplier; zero preserves impulses.
 * @property {number} [speedScale=1] Nonnegative target-speed multiplier.
 */

/** @type {Required<KinematicCharacterSettings>} */
const DEFAULT_CHARACTER_SETTINGS = Object.freeze({
  radius: 0.42,
  height: 1.5,
  moveSpeed: 8,
  acceleration: 48,
  airAcceleration: 18,
  braking: 40,
  gravity: 24,
  jumpSpeed: 9,
  coyoteSec: 0.1,
  jumpBufferSec: 0.12,
  maxDtSec: 0.1,
  maxSubsteps: 12,
});

/** @type {ReadonlyArray<keyof KinematicCharacterSettings>} */
const POSITIVE_CHARACTER_SETTING_KEYS = ["radius", "height", "moveSpeed", "jumpSpeed", "maxDtSec"];
/** @type {ReadonlyArray<keyof KinematicCharacterSettings>} */
const NONNEGATIVE_CHARACTER_SETTING_KEYS = ["acceleration", "airAcceleration", "braking", "gravity", "coyoteSec", "jumpBufferSec"];

/**
 * @param {string} settingName
 * @param {number} settingValue
 * @param {boolean} [allowZero]
 * @throws {TypeError} If the setting is not finite or outside its supported range.
 */
function validateCharacterNumber(settingName, settingValue, allowZero = false) {
  if (!Number.isFinite(settingValue) || (allowZero ? settingValue < 0 : settingValue <= 0)) {
    throw new TypeError(`Kinematic character has invalid ${settingName}.`);
  }
}

/**
 * @param {KinematicCharacterSettings} settings
 * @returns {Required<KinematicCharacterSettings>}
 */
function parseCharacterSettings(settings) {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new TypeError("Kinematic character requires a settings object.");
  }
  const characterSettings = { ...DEFAULT_CHARACTER_SETTINGS, ...settings };
  for (const settingName of POSITIVE_CHARACTER_SETTING_KEYS) {
    validateCharacterNumber(settingName, characterSettings[settingName]);
  }
  for (const settingName of NONNEGATIVE_CHARACTER_SETTING_KEYS) {
    validateCharacterNumber(settingName, characterSettings[settingName], true);
  }
  const { maxSubsteps } = characterSettings;
  if (!Number.isInteger(maxSubsteps) || maxSubsteps < 1 || maxSubsteps > MAX_CHARACTER_SUBSTEPS) {
    throw new TypeError(`Kinematic character maxSubsteps must be an integer in [1,${MAX_CHARACTER_SUBSTEPS}].`);
  }
  return characterSettings;
}

/**
 * Validate sampled slopes before any body mutation. Bounds keep this an arcade
 * walkable-surface controller; games retain ownership of tilt/rotation dynamics.
 * @param {ReadonlyArray<Readonly<KinematicPlatform>>} platforms
 * @throws {TypeError} If either supplied gradient is nonfinite or exceeds one.
 */
function validatePlatformSlopes(platforms) {
  for (const platform of platforms) {
    const slopeX = platform.slopeX === undefined ? 0 : platform.slopeX;
    const slopeZ = platform.slopeZ === undefined ? 0 : platform.slopeZ;
    if (!Number.isFinite(slopeX) || !Number.isFinite(slopeZ) ||
        Math.abs(slopeX) > MAX_PLATFORM_SLOPE_COMPONENT || Math.abs(slopeZ) > MAX_PLATFORM_SLOPE_COMPONENT) {
      throw new TypeError(`Kinematic platform slope gradients must be finite and within [-${MAX_PLATFORM_SLOPE_COMPONENT},${MAX_PLATFORM_SLOPE_COMPONENT}].`);
    }
  }
}

/**
 * Sample the same center-foot top plane used by character contact. Width/depth
 * remain projected X/Z extents; the underside is this height minus thickness.
 * Geometry and coordinates remain caller-owned. Slopes are constant for a call;
 * games sample their own angular motion before each simulation/render step.
 * @param {Readonly<KinematicPlatform>} platform Valid geometry with optional gradients.
 * @param {number} x World-space horizontal sample position.
 * @param {number} z World-space horizontal sample position.
 * @param {number} [elapsedSec=0] Projection from the supplied start pose.
 * @returns {number} World-space surface height, also extrapolated beyond edges.
 */
export function getKinematicPlatformTopY(platform, x, z, elapsedSec = 0) {
  return platform.topY + platform.vy * elapsedSec +
    (platform.slopeX ?? 0) * (x - platform.x - platform.vx * elapsedSec) +
    (platform.slopeZ ?? 0) * (z - platform.z - platform.vz * elapsedSec);
}

/**
 * Circle/rectangle footprint contact, with exact rounded corners.
 * @param {number} x
 * @param {number} z
 * @param {number} minX
 * @param {number} maxX
 * @param {number} minZ
 * @param {number} maxZ
 * @param {number} radiusSquared
 * @returns {boolean}
 */
function overlapsPlatformFootprint(x, z, minX, maxX, minZ, maxZ, radiusSquared) {
  const offsetX = x - Math.max(minX, Math.min(maxX, x));
  const offsetZ = z - Math.max(minZ, Math.min(maxZ, z));
  return offsetX * offsetX + offsetZ * offsetZ < radiusSquared - CONTACT_TOLERANCE * CONTACT_TOLERANCE;
}

/**
 * Revalidate support after platform removal, external impulses or edge crossing.
 * Platform velocities are not stored in the body or added to its own velocity.
 * @param {KinematicCharacterBody} body
 * @param {ReadonlyArray<Readonly<KinematicPlatform>>} platforms
 * @param {number} elapsedSec
 * @param {number} radius
 * @param {boolean} [allowSurfaceReattach] Permit a small sampled tilt-height change only for prior support.
 * @returns {Readonly<KinematicPlatform> | null}
 */
function recordCharacterSupport(body, platforms, elapsedSec, radius, allowSurfaceReattach = false) {
  let support = null;
  const previousSupportId = body.grounded ? body.supportId : 0;
  if (body.vy <= CONTACT_TOLERANCE) {
    for (const platform of platforms) {
      const topY = getKinematicPlatformTopY(platform, body.x, body.z, elapsedSec);
      const canReattachSurface = allowSurfaceReattach && previousSupportId === platform.id &&
        (platform.slopeX !== undefined || platform.slopeZ !== undefined);
      const supportTolerance = canReattachSurface ? MAX_SLOPED_SUPPORT_REATTACH_DISTANCE : SUPPORT_TOLERANCE;
      if (Math.abs(body.y - topY) > supportTolerance) {
        continue;
      }
      const centerX = platform.x + platform.vx * elapsedSec;
      const centerZ = platform.z + platform.vz * elapsedSec;
      if (overlapsPlatformFootprint(body.x, body.z,
        centerX - platform.width / 2, centerX + platform.width / 2,
        centerZ - platform.depth / 2, centerZ + platform.depth / 2, radius * radius) &&
          (!support || platform.id < support.id)) {
        support = platform;
      }
    }
  }
  body.grounded = support !== null;
  body.supportId = support?.id ?? 0;
  if (support) {
    body.y = getKinematicPlatformTopY(support, body.x, body.z, elapsedSec);
    body.vy = 0;
  }
  return support;
}

/**
 * Resolve pre-existing intersections, including game-owned positional push-outs.
 * Work is bounded; mutually contradictory solid geometry may remain unresolved.
 * @param {KinematicCharacterBody} body
 * @param {ReadonlyArray<Readonly<KinematicPlatform>>} platforms
 * @param {number} elapsedSec
 * @param {number} radius
 * @param {number} height
 */
function resolveCharacterPlatformPenetration(body, platforms, elapsedSec, radius, height) {
  for (let pass = 0; pass < MAX_DEPENETRATION_PASSES; pass += 1) {
    let separated = false;
    for (const platform of platforms) {
      const topY = getKinematicPlatformTopY(platform, body.x, body.z, elapsedSec);
      const bottomY = topY - platform.thickness;
      if (body.y >= topY - CONTACT_TOLERANCE || body.y + height <= bottomY + CONTACT_TOLERANCE) {
        continue;
      }
      const centerX = platform.x + platform.vx * elapsedSec;
      const centerZ = platform.z + platform.vz * elapsedSec;
      const minX = centerX - platform.width / 2;
      const maxX = centerX + platform.width / 2;
      const minZ = centerZ - platform.depth / 2;
      const maxZ = centerZ + platform.depth / 2;
      const offsetX = body.x - Math.max(minX, Math.min(maxX, body.x));
      const offsetZ = body.z - Math.max(minZ, Math.min(maxZ, body.z));
      const distanceSquared = offsetX * offsetX + offsetZ * offsetZ;
      if (distanceSquared >= radius * radius - CONTACT_TOLERANCE * CONTACT_TOLERANCE) {
        continue;
      }

      let normalX = 0;
      let normalY = 0;
      let normalZ = 0;
      let penetration;
      if (distanceSquared > CONTACT_TOLERANCE * CONTACT_TOLERANCE) {
        const distance = Math.sqrt(distanceSquared);
        penetration = radius - distance;
        normalX = offsetX / distance;
        normalZ = offsetZ / distance;
      } else {
        penetration = body.x - minX + radius;
        normalX = -1;
        if (maxX - body.x + radius < penetration) {
          penetration = maxX - body.x + radius;
          normalX = 1;
        }
        if (body.z - minZ + radius < penetration) {
          penetration = body.z - minZ + radius;
          normalX = 0;
          normalZ = -1;
        }
        if (maxZ - body.z + radius < penetration) {
          penetration = maxZ - body.z + radius;
          normalX = 0;
          normalZ = 1;
        }
      }
      if (topY - body.y <= penetration) {
        penetration = topY - body.y;
        normalX = 0;
        normalY = 1;
        normalZ = 0;
      }
      if (body.y + height - bottomY < penetration) {
        penetration = body.y + height - bottomY;
        normalX = 0;
        normalY = -1;
        normalZ = 0;
      }

      body.x += normalX * penetration;
      body.y += normalY * penetration;
      body.z += normalZ * penetration;
      const inwardSpeed = body.vx * normalX + body.vy * normalY + body.vz * normalZ;
      if (inwardSpeed < 0) {
        body.vx -= normalX * inwardSpeed;
        body.vy -= normalY * inwardSpeed;
        body.vz -= normalZ * inwardSpeed;
      }
      separated = true;
    }
    if (!separated) {
      break;
    }
  }
}

/**
 * @typedef {object} CharacterSweepContact
 * @property {number} fraction
 * @property {number} normalX
 * @property {number} normalY
 * @property {number} normalZ
 * @property {Readonly<KinematicPlatform>} platform
 */

/**
 * Sweep a cylinder through the platform-relative frame. Vertical faces, side
 * faces and rounded X/Z corners are tested continuously, independent of speed.
 * @param {KinematicCharacterBody} body
 * @param {{x:number,y:number,z:number}} worldVelocity
 * @param {ReadonlyArray<Readonly<KinematicPlatform>>} platforms
 * @param {number} elapsedSec
 * @param {number} durationSec
 * @param {number} radius
 * @param {number} height
 * @returns {CharacterSweepContact | null}
 */
function findCharacterSweepContact(body, worldVelocity, platforms, elapsedSec, durationSec, radius, height) {
  let earliestContact = null;

  for (const platform of platforms) {
    const centerX = platform.x + platform.vx * elapsedSec;
    const centerZ = platform.z + platform.vz * elapsedSec;
    const minX = centerX - platform.width / 2;
    const maxX = centerX + platform.width / 2;
    const minZ = centerZ - platform.depth / 2;
    const maxZ = centerZ + platform.depth / 2;
    const topY = getKinematicPlatformTopY(platform, body.x, body.z, elapsedSec);
    const bottomY = topY - platform.thickness;
    const slopeX = platform.slopeX ?? 0;
    const slopeZ = platform.slopeZ ?? 0;
    const deltaX = (worldVelocity.x - platform.vx) * durationSec;
    const deltaY = (worldVelocity.y - platform.vy) * durationSec;
    const deltaZ = (worldVelocity.z - platform.vz) * durationSec;
    const planeDeltaY = deltaY - slopeX * deltaX - slopeZ * deltaZ;

    /**
     * @param {number} fraction
     * @param {number} normalX
     * @param {number} normalY
     * @param {number} normalZ
     */
    function recordContact(fraction, normalX, normalY, normalZ) {
      if (fraction < -CONTACT_TOLERANCE || fraction > 1 + CONTACT_TOLERANCE ||
          (earliestContact && fraction >= earliestContact.fraction - CONTACT_TOLERANCE)) {
        return;
      }
      const approachDistance = normalY !== 0
        ? planeDeltaY * normalY
        : deltaX * normalX + deltaZ * normalZ;
      if (approachDistance >= -CONTACT_TOLERANCE) {
        return;
      }
      const boundedFraction = Math.max(0, Math.min(1, fraction));
      const contactX = body.x + deltaX * boundedFraction;
      const contactY = body.y + deltaY * boundedFraction;
      const contactZ = body.z + deltaZ * boundedFraction;
      const localTopY = topY + (slopeX * deltaX + slopeZ * deltaZ) * boundedFraction;
      if (normalY !== 0) {
        if (!overlapsPlatformFootprint(contactX, contactZ, minX, maxX, minZ, maxZ, radius * radius)) {
          return;
        }
      } else if (contactY >= localTopY - CONTACT_TOLERANCE ||
          contactY + height <= localTopY - platform.thickness + CONTACT_TOLERANCE) {
        return;
      }
      earliestContact = { fraction: boundedFraction, normalX, normalY, normalZ, platform };
    }

    if (planeDeltaY < -CONTACT_TOLERANCE && body.y >= topY - CONTACT_TOLERANCE) {
      recordContact((topY - body.y) / planeDeltaY, 0, 1, 0);
    } else if (planeDeltaY > CONTACT_TOLERANCE && body.y + height <= bottomY + CONTACT_TOLERANCE) {
      recordContact((bottomY - body.y - height) / planeDeltaY, 0, -1, 0);
    }

    if (Math.abs(deltaX) > CONTACT_TOLERANCE) {
      const normalX = deltaX > 0 ? -1 : 1;
      const boundaryX = deltaX > 0 ? minX - radius : maxX + radius;
      const fraction = (boundaryX - body.x) / deltaX;
      const contactZ = body.z + deltaZ * fraction;
      if (contactZ >= minZ - CONTACT_TOLERANCE && contactZ <= maxZ + CONTACT_TOLERANCE) {
        recordContact(fraction, normalX, 0, 0);
      }
    }
    if (Math.abs(deltaZ) > CONTACT_TOLERANCE) {
      const normalZ = deltaZ > 0 ? -1 : 1;
      const boundaryZ = deltaZ > 0 ? minZ - radius : maxZ + radius;
      const fraction = (boundaryZ - body.z) / deltaZ;
      const contactX = body.x + deltaX * fraction;
      if (contactX >= minX - CONTACT_TOLERANCE && contactX <= maxX + CONTACT_TOLERANCE) {
        recordContact(fraction, 0, 0, normalZ);
      }
    }

    const horizontalDeltaSquared = deltaX * deltaX + deltaZ * deltaZ;
    if (horizontalDeltaSquared <= CONTACT_TOLERANCE * CONTACT_TOLERANCE) {
      continue;
    }
    for (let cornerIndex = 0; cornerIndex < 4; cornerIndex += 1) {
      const positiveX = (cornerIndex & 1) !== 0;
      const positiveZ = (cornerIndex & 2) !== 0;
      const cornerX = positiveX ? maxX : minX;
      const cornerZ = positiveZ ? maxZ : minZ;
      const offsetX = body.x - cornerX;
      const offsetZ = body.z - cornerZ;
      const projection = offsetX * deltaX + offsetZ * deltaZ;
      const discriminant = projection * projection - horizontalDeltaSquared *
        (offsetX * offsetX + offsetZ * offsetZ - radius * radius);
      if (discriminant < 0) {
        continue;
      }
      const fraction = (-projection - Math.sqrt(discriminant)) / horizontalDeltaSquared;
      const normalX = (offsetX + deltaX * fraction) / radius;
      const normalZ = (offsetZ + deltaZ * fraction) / radius;
      if ((positiveX ? normalX >= -CONTACT_TOLERANCE : normalX <= CONTACT_TOLERANCE) &&
          (positiveZ ? normalZ >= -CONTACT_TOLERANCE : normalZ <= CONTACT_TOLERANCE)) {
        recordContact(fraction, normalX, 0, normalZ);
      }
    }
  }
  return earliestContact;
}

/**
 * Slide through at most six solid contacts; discard any unresolved remaining
 * movement at the bound rather than integrating unchecked through geometry.
 * @param {KinematicCharacterBody} body
 * @param {{x:number,y:number,z:number}} worldVelocity Mutated to the slide velocity.
 * @param {ReadonlyArray<Readonly<KinematicPlatform>>} platforms
 * @param {number} elapsedSec
 * @param {number} durationSec
 * @param {number} radius
 * @param {number} height
 * @param {Readonly<KinematicPlatform> | null} initialSupport Previously grounded surface, if any.
 * @returns {Readonly<KinematicPlatform> | null} Initial support or the last platform contacted from above.
 */
function moveCharacterThroughPlatforms(body, worldVelocity, platforms, elapsedSec, durationSec, radius, height, initialSupport) {
  let remainingSec = durationSec;
  let contactTimeSec = elapsedSec;
  let landingPlatform = initialSupport;
  for (let contactIndex = 0; contactIndex < MAX_CONTACTS_PER_SUBSTEP && remainingSec > CONTACT_TOLERANCE; contactIndex += 1) {
    const contact = findCharacterSweepContact(body, worldVelocity, platforms,
      contactTimeSec, remainingSec, radius, height);
    const movementSec = remainingSec * (contact?.fraction ?? 1);
    body.x += worldVelocity.x * movementSec;
    body.y += worldVelocity.y * movementSec;
    body.z += worldVelocity.z * movementSec;
    if (!contact) {
      return landingPlatform;
    }
    remainingSec -= movementSec;
    contactTimeSec += movementSec;

    const { normalX, normalY, normalZ, platform } = contact;
    if (normalY > 0) {
      landingPlatform = platform;
    }
    const relativeVx = worldVelocity.x - platform.vx;
    const relativeVz = worldVelocity.z - platform.vz;
    const inwardSpeed = normalY !== 0
      ? (worldVelocity.y - platform.vy - (platform.slopeX ?? 0) * relativeVx -
        (platform.slopeZ ?? 0) * relativeVz) * normalY
      : relativeVx * normalX + relativeVz * normalZ;
    worldVelocity.x -= normalX * inwardSpeed;
    worldVelocity.y -= normalY * inwardSpeed;
    worldVelocity.z -= normalZ * inwardSpeed;

    if (normalY === 0 && landingPlatform) {
      const supportX = landingPlatform.x + landingPlatform.vx * contactTimeSec;
      const supportZ = landingPlatform.z + landingPlatform.vz * contactTimeSec;
      if (Math.abs(body.y - getKinematicPlatformTopY(landingPlatform, body.x, body.z, contactTimeSec)) <= SUPPORT_TOLERANCE &&
          overlapsPlatformFootprint(body.x, body.z,
            supportX - landingPlatform.width / 2, supportX + landingPlatform.width / 2,
            supportZ - landingPlatform.depth / 2, supportZ + landingPlatform.depth / 2, radius * radius)) {
        worldVelocity.y = landingPlatform.vy +
          (landingPlatform.slopeX ?? 0) * (worldVelocity.x - landingPlatform.vx) +
          (landingPlatform.slopeZ ?? 0) * (worldVelocity.z - landingPlatform.vz);
      }
    }
  }
  return landingPlatform;
}

/**
 * Apply an edge-triggered jump without inheriting support translation twice.
 * @param {KinematicCharacterBody} body
 * @param {number} jumpSpeed
 */
function startCharacterJump(body, jumpSpeed) {
  body.vy = jumpSpeed;
  body.grounded = false;
  body.supportId = 0;
  body.coyoteSec = 0;
  body.jumpBufferSec = 0;
}

/**
 * Create pure configurable 3D arcade movement with optional sloped top planes.
 * Each step mutates only the body; input, settings and platforms remain caller-owned and unchanged. Geometry is
 * sampled at the start of the call and translated at its supplied velocity.
 * A zero-duration step only resolves penetration/support, retaining jump edges
 * and timers. Invalid durations throw; long durations clamp to maxDtSec.
 * @param {KinematicCharacterSettings} [settings]
 * @returns {{step:(body:KinematicCharacterBody,input:Readonly<KinematicCharacterInput>,dtSec:number,context:KinematicCharacterContext)=>void}}
 * @throws {TypeError} If dimensions, rates or work limits are invalid.
 */
export function createKinematicCharacterController(settings = {}) {
  const characterSettings = parseCharacterSettings(settings);
  const { radius, height, moveSpeed, acceleration, airAcceleration, braking, gravity,
    jumpSpeed, coyoteSec, jumpBufferSec, maxDtSec, maxSubsteps } = characterSettings;

  /**
   * @param {KinematicCharacterBody} body
   * @param {Readonly<KinematicCharacterInput>} input
   * @param {number} dtSec
   * @param {KinematicCharacterContext} context
   * @returns {void}
   * @throws {TypeError} If duration, scales or sampled platform gradients are invalid.
   */
  function step(body, input, dtSec, { platforms, controlScale = 1, speedScale = 1 }) {
    validateCharacterNumber("dtSec", dtSec, true);
    validateCharacterNumber("controlScale", controlScale, true);
    validateCharacterNumber("speedScale", speedScale, true);
    validatePlatformSlopes(platforms);
    const durationSec = Math.min(dtSec, maxDtSec);
    resolveCharacterPlatformPenetration(body, platforms, 0, radius, height);
    let support = recordCharacterSupport(body, platforms, 0, radius, true);
    if (durationSec === 0) {
      return;
    }

    const jumpPressed = Boolean(input.jump) && !body.jumpHeld;
    body.jumpHeld = Boolean(input.jump);
    if (jumpPressed) {
      body.jumpBufferSec = jumpBufferSec;
    }
    const intentLength = Math.hypot(input.x, input.z);
    const intentScale = intentLength > 1 ? 1 / intentLength : 1;
    const targetVx = input.x * intentScale * moveSpeed * speedScale;
    const targetVz = input.z * intentScale * moveSpeed * speedScale;
    const estimatedSpeed = Math.hypot(body.vx + (support?.vx ?? 0),
      body.vy + (support?.vy ?? 0), body.vz + (support?.vz ?? 0)) +
      moveSpeed * speedScale + gravity * durationSec;
    const substeps = Math.min(maxSubsteps, Math.max(1, Math.ceil(durationSec / MAX_SUBSTEP_SEC),
      Math.ceil(estimatedSpeed * durationSec / (radius * 0.5))));
    const substepSec = durationSec / substeps;

    for (let substepIndex = 0; substepIndex < substeps; substepIndex += 1) {
      const elapsedSec = substepIndex * substepSec;
      support = recordCharacterSupport(body, platforms, elapsedSec, radius);
      if (body.grounded) {
        body.coyoteSec = coyoteSec;
      }
      if ((body.jumpBufferSec > 0 || (jumpPressed && substepIndex === 0)) &&
          (body.grounded || body.coyoteSec > 0)) {
        startCharacterJump(body, jumpSpeed);
        support = null;
      }

      const velocityChangeX = targetVx - body.vx;
      const velocityChangeZ = targetVz - body.vz;
      const velocityChangeLength = Math.hypot(velocityChangeX, velocityChangeZ);
      const accelerationRate = intentLength > CONTACT_TOLERANCE
        ? (body.grounded ? acceleration : airAcceleration)
        : braking;
      if (velocityChangeLength > 0 && controlScale > 0) {
        const accelerationScale = Math.min(1, accelerationRate * controlScale * substepSec / velocityChangeLength);
        body.vx += velocityChangeX * accelerationScale;
        body.vz += velocityChangeZ * accelerationScale;
      }
      body.vy -= gravity * substepSec;

      const carryVx = support?.vx ?? 0;
      const carryVy = support?.vy ?? 0;
      const carryVz = support?.vz ?? 0;
      const surfaceClimbVy = (support?.slopeX ?? 0) * body.vx + (support?.slopeZ ?? 0) * body.vz;
      const worldVelocity = { x: body.vx + carryVx, y: body.vy + carryVy + surfaceClimbVy, z: body.vz + carryVz };
      const landingPlatform = moveCharacterThroughPlatforms(body, worldVelocity, platforms,
        elapsedSec, substepSec, radius, height, support);
      body.vx = worldVelocity.x - carryVx;
      body.vy = worldVelocity.y - carryVy - surfaceClimbVy;
      body.vz = worldVelocity.z - carryVz;
      if (landingPlatform && Math.abs(body.y - getKinematicPlatformTopY(landingPlatform,
        body.x, body.z, elapsedSec + substepSec)) <= SUPPORT_TOLERANCE) {
        body.vy = 0;
      }
      resolveCharacterPlatformPenetration(body, platforms, elapsedSec + substepSec, radius, height);
      recordCharacterSupport(body, platforms, elapsedSec + substepSec, radius);

      body.jumpBufferSec = Math.max(0, body.jumpBufferSec - substepSec);
      body.coyoteSec = body.grounded ? coyoteSec : Math.max(0, body.coyoteSec - substepSec);
      if (body.grounded && body.jumpBufferSec > 0) {
        startCharacterJump(body, jumpSpeed);
      }
    }
  }
  return { step };
}

/**
 * Separate vertically overlapping cylinders using stable caller array order.
 * Only X/Z positions are mutated: no collision impulses or game-specific state
 * are introduced. Callers filter finished/respawning actors before passing the
 * array, and may run a zero-duration world step afterwards to revalidate support.
 * Coincident centers use a deterministic X direction. Iterations are bounded;
 * dense crowds can retain a small residual overlap at the configured limit.
 * @param {ReadonlyArray<KinematicCharacterBody>} bodies
 * @param {{radius:number,height:number,iterations?:number}} settings
 * @returns {void}
 * @throws {TypeError} If dimensions or the bounded iteration count are invalid.
 */
export function resolveKinematicCharacterSeparation(bodies, { radius, height, iterations = DEFAULT_SEPARATION_ITERATIONS }) {
  validateCharacterNumber("separation radius", radius);
  validateCharacterNumber("separation height", height);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_SEPARATION_ITERATIONS) {
    throw new TypeError(`Character separation iterations must be an integer in [1,${MAX_SEPARATION_ITERATIONS}].`);
  }
  const diameter = radius * 2;
  const positionCorrections = new Float64Array(bodies.length * 2);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    positionCorrections.fill(0);
    let separated = false;
    for (let firstIndex = 0; firstIndex < bodies.length; firstIndex += 1) {
      const firstBody = bodies[firstIndex];
      for (let secondIndex = firstIndex + 1; secondIndex < bodies.length; secondIndex += 1) {
        const secondBody = bodies[secondIndex];
        if (firstBody.y + height <= secondBody.y || secondBody.y + height <= firstBody.y) {
          continue;
        }
        const offsetX = secondBody.x - firstBody.x;
        const offsetZ = secondBody.z - firstBody.z;
        const distanceSquared = offsetX * offsetX + offsetZ * offsetZ;
        if (distanceSquared >= diameter * diameter) {
          continue;
        }
        const distance = Math.sqrt(distanceSquared);
        const normalX = distance > CONTACT_TOLERANCE ? offsetX / distance : 1;
        const normalZ = distance > CONTACT_TOLERANCE ? offsetZ / distance : 0;
        const correction = (diameter - distance) / 2;
        positionCorrections[firstIndex * 2] -= normalX * correction;
        positionCorrections[firstIndex * 2 + 1] -= normalZ * correction;
        positionCorrections[secondIndex * 2] += normalX * correction;
        positionCorrections[secondIndex * 2 + 1] += normalZ * correction;
        separated = true;
      }
    }
    if (!separated) {
      break;
    }
    for (let bodyIndex = 0; bodyIndex < bodies.length; bodyIndex += 1) {
      bodies[bodyIndex].x += positionCorrections[bodyIndex * 2];
      bodies[bodyIndex].z += positionCorrections[bodyIndex * 2 + 1];
    }
  }
}
