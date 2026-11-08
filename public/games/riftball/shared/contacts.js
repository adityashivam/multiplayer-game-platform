import { createSphereBodyController } from "../../../platform/shared/sphereBody.js";
import { resolveKinematicCharacterSeparation } from "../../../platform/shared/kinematicCharacter.js";
import { RIFTBALL_ACTION_SETTINGS, RIFTBALL_BALL_SETTINGS, RIFTBALL_CHARACTER_SETTINGS, RIFTBALL_COURT } from "./config.js";
import { RIFTBALL_COURT_SOLIDS } from "./court.js";

/** @typedef {import("./simulation.js").RiftballPlayer} RiftballPlayer */
/** @typedef {import("./simulation.js").RiftballBall} RiftballBall */
/** @typedef {import("./config.js").RiftballPlayerId} RiftballPlayerId */
/** @typedef {import("../../../platform/shared/sphereBody.js").SphereTravelSegment} SphereTravelSegment */
/** @typedef {{x:number,y:number,z:number}} RiftballContactPosition */
/**
 * @typedef {object} RiftballBodyContact
 * @property {RiftballPlayer} player
 * @property {number} normalX
 * @property {number} normalY
 * @property {number} normalZ
 * @property {number} penetration
 * @property {number} approachSpeed
 * @property {number} impulse
 */

const CONTACT_STEP_SEC = 1 / 120;
const CONTACT_PADDING = 0.00001;
const PLAYER_CONTACT_RESTITUTION = 0.6;
const PLAYER_CONTACT_RECOIL = 0.06;
const PLAYER_CONTACT_COOLDOWN_SEC = 0.12;
const STRIKE_CONE_MIN_COSINE = 0.35;
const STRIKE_CONTACT_WINDOW_SCALE = 0.72;
const sphereController = createSphereBodyController({ radius: RIFTBALL_COURT.ballRadius, ...RIFTBALL_BALL_SETTINGS });

/**
 * Separate upright player bodies, then translate the pair into the court as a
 * group. This preserves the separation near walls instead of clamping one body
 * back into its opponent. Only caller-owned positions are changed.
 * @param {RiftballPlayer[]} players
 */
export function separateRiftballPlayers(players) {
  resolveKinematicCharacterSeparation(players, RIFTBALL_CHARACTER_SETTINGS);
  const limitX = RIFTBALL_COURT.halfWidth - RIFTBALL_CHARACTER_SETTINGS.radius;
  const limitZ = RIFTBALL_COURT.halfLength - RIFTBALL_CHARACTER_SETTINGS.radius;
  let minimumX = Infinity;
  let maximumX = -Infinity;
  let minimumZ = Infinity;
  let maximumZ = -Infinity;
  for (const player of players) {
    minimumX = Math.min(minimumX, player.x);
    maximumX = Math.max(maximumX, player.x);
    minimumZ = Math.min(minimumZ, player.z);
    maximumZ = Math.max(maximumZ, player.z);
  }
  const shiftX = minimumX < -limitX ? -limitX - minimumX : maximumX > limitX ? limitX - maximumX : 0;
  const shiftZ = minimumZ < -limitZ ? -limitZ - minimumZ : maximumZ > limitZ ? limitZ - maximumZ : 0;
  for (const player of players) {
    player.x += shiftX;
    player.z += shiftZ;
  }
}

/** @param {RiftballBall} ball */
function boundRiftballBallSpeed(ball) {
  const speed = Math.hypot(ball.vx, ball.vy, ball.vz);
  if (speed <= RIFTBALL_BALL_SETTINGS.maxSpeed) return;
  const scale = RIFTBALL_BALL_SETTINGS.maxSpeed / speed;
  ball.vx *= scale;
  ball.vy *= scale;
  ball.vz *= scale;
}

/**
 * A strike has one contact identity and a forward, height-limited arc.
 * @param {Readonly<RiftballPlayer>} player
 * @param {Readonly<RiftballBall>} ball
 * @returns {boolean}
 */
function canRiftballPlayerStrikeBall(player, ball) {
  if (player.action !== "strike" || player.strikeHitId === player.actionId ||
      player.actionTimeSec + CONTACT_PADDING < RIFTBALL_ACTION_SETTINGS.strikeWindupSec ||
      player.actionTimeSec > RIFTBALL_ACTION_SETTINGS.strikeDurationSec * STRIKE_CONTACT_WINDOW_SCALE) return false;
  const offsetX = ball.x - player.x;
  const offsetZ = ball.z - player.z;
  const horizontalDistance = Math.hypot(offsetX, offsetZ);
  if (horizontalDistance > RIFTBALL_ACTION_SETTINGS.strikeRange ||
      ball.y < player.y + 0.05 || ball.y > player.y + RIFTBALL_CHARACTER_SETTINGS.height + RIFTBALL_COURT.ballRadius) return false;
  const directionX = Math.sin(player.strikeFacing);
  const directionZ = Math.cos(player.strikeFacing);
  if (horizontalDistance > CONTACT_PADDING &&
      (offsetX * directionX + offsetZ * directionZ) / horizontalDistance < STRIKE_CONE_MIN_COSINE) return false;
  return true;
}

/**
 * Sample every eligible strike before mutating the ball. Simultaneous forces
 * combine symmetrically; equally powerful opposing strikes make a neutral clash
 * instead of awarding the last socket slot an implicit contact advantage.
 * @param {RiftballPlayer[]} players
 * @param {RiftballBall} ball
 */
function strikeRiftballBall(players, ball) {
  let strikeCount = 0;
  let velocityX = 0;
  let velocityY = 0;
  let velocityZ = 0;
  let greatestPower = -1;
  let lastTouchPlayerId = null;
  for (const player of players) {
    if (!canRiftballPlayerStrikeBall(player, ball)) continue;
    const strikeSpeed = RIFTBALL_ACTION_SETTINGS.quickStrikeSpeed +
      (RIFTBALL_ACTION_SETTINGS.chargedStrikeSpeed - RIFTBALL_ACTION_SETTINGS.quickStrikeSpeed) * player.strikePower;
    velocityX += Math.sin(player.strikeFacing) * strikeSpeed + player.vx * 0.12;
    velocityZ += Math.cos(player.strikeFacing) * strikeSpeed + player.vz * 0.12;
    velocityY += player.grounded ? 3 + player.strikePower * 3.8 :
      RIFTBALL_ACTION_SETTINGS.aerialLiftSpeed + player.strikePower * 4.6 + Math.max(0, player.vy) * 0.2;
    player.strikeHitId = player.actionId;
    player.ballContactCooldownSec = PLAYER_CONTACT_COOLDOWN_SEC;
    strikeCount += 1;
    if (player.strikePower > greatestPower + CONTACT_PADDING) {
      greatestPower = player.strikePower;
      lastTouchPlayerId = player.id;
    } else if (Math.abs(player.strikePower - greatestPower) <= CONTACT_PADDING) {
      lastTouchPlayerId = null;
    }
  }
  if (strikeCount === 0) return;
  ball.vx = velocityX / strikeCount;
  ball.vy = velocityY / strikeCount;
  ball.vz = velocityZ / strikeCount;
  ball.lastTouchPlayerId = lastTouchPlayerId;
  ball.hitSerial += 1;
  boundRiftballBallSpeed(ball);
}

/**
 * Sample all capsule normals and relative speeds before any body is changed.
 * @param {RiftballPlayer[]} players
 * @param {Readonly<RiftballBall>} ball
 * @returns {RiftballBodyContact[]}
 */
function collectRiftballBodyContacts(players, ball) {
  const contacts = [];
  const radius = RIFTBALL_CHARACTER_SETTINGS.radius;
  const contactRadius = radius + RIFTBALL_COURT.ballRadius;
  for (const player of players) {
    const axisY = Math.max(player.y + radius, Math.min(player.y + RIFTBALL_CHARACTER_SETTINGS.height - radius, ball.y));
    const offsetX = ball.x - player.x;
    const offsetY = ball.y - axisY;
    const offsetZ = ball.z - player.z;
    const distance = Math.hypot(offsetX, offsetY, offsetZ);
    if (distance > contactRadius + CONTACT_PADDING * 2) continue;
    const normalX = distance > CONTACT_PADDING ? offsetX / distance : Math.sin(player.facing);
    const normalY = distance > CONTACT_PADDING ? offsetY / distance : 0;
    const normalZ = distance > CONTACT_PADDING ? offsetZ / distance : Math.cos(player.facing);
    contacts.push({
      player, normalX, normalY, normalZ,
      penetration: Math.max(0, contactRadius - distance),
      approachSpeed: (ball.vx - player.vx) * normalX + (ball.vy - player.vy) * normalY + (ball.vz - player.vz) * normalZ,
      impulse: 0,
    });
  }
  // A stable matrix basis also makes floating-point roundoff replay-identical.
  return contacts.sort((first, second) => first.player.slotIndex - second.player.slotIndex);
}

/** @param {Readonly<RiftballContactPosition>} position @param {RiftballPlayer[]} players @returns {boolean} */
function isRiftballContactPositionClear(position, players) {
  const ballRadius = RIFTBALL_COURT.ballRadius;
  if (position.y < ballRadius) return false;
  for (const solid of RIFTBALL_COURT_SOLIDS) {
    const offsetX = position.x - Math.max(solid.minX, Math.min(solid.maxX, position.x));
    const offsetY = position.y - Math.max(solid.minY, Math.min(solid.maxY, position.y));
    const offsetZ = position.z - Math.max(solid.minZ, Math.min(solid.maxZ, position.z));
    if (offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ < ballRadius * ballRadius - 1e-9) return false;
  }
  const characterRadius = RIFTBALL_CHARACTER_SETTINGS.radius;
  const contactRadius = characterRadius + ballRadius;
  for (const player of players) {
    const axisY = Math.max(player.y + characterRadius, Math.min(player.y + RIFTBALL_CHARACTER_SETTINGS.height - characterRadius, position.y));
    if ((position.x - player.x) ** 2 + (position.y - axisY) ** 2 + (position.z - player.z) ** 2 < contactRadius * contactRadius - 1e-9) return false;
  }
  return true;
}

/**
 * Find a nearby point outside both capsule volumes. Ordinary normal push-outs
 * are candidates, as are the two horizontal circle intersections and vertical
 * exits. This resolves opposing constraints without repeatedly pushing the ball
 * through whichever athlete happens to be visited last. Equal-distance choices
 * use world coordinates, so reversing the owner array cannot change the escape.
 * @param {RiftballBodyContact[]} contacts
 * @param {RiftballPlayer[]} players
 * @param {RiftballBall} ball
 */
function separateRiftballBallFromPlayers(contacts, players, ball) {
  if (!contacts.some((contact) => contact.penetration > 0)) return;
  const radius = RIFTBALL_CHARACTER_SETTINGS.radius;
  const contactRadius = radius + RIFTBALL_COURT.ballRadius + CONTACT_PADDING;
  let bestPosition = null;
  let bestDistanceSquared = Infinity;

  /** @param {RiftballContactPosition} position */
  function considerContactPosition(position) {
    if (!isRiftballContactPositionClear(position, players)) return;
    const distanceSquared = (position.x - ball.x) ** 2 + (position.y - ball.y) ** 2 + (position.z - ball.z) ** 2;
    const isEqualDistance = Math.abs(distanceSquared - bestDistanceSquared) <= 1e-9;
    const winsCoordinateTie = bestPosition && (position.y > bestPosition.y ||
      (position.y === bestPosition.y && (position.x > bestPosition.x || (position.x === bestPosition.x && position.z > bestPosition.z))));
    if (distanceSquared < bestDistanceSquared - 1e-9 || (isEqualDistance && winsCoordinateTie)) {
      bestPosition = position;
      bestDistanceSquared = distanceSquared;
    }
  }

  let topExitY = -Infinity;
  let bottomExitY = Infinity;
  for (const contact of contacts) {
    const { player, normalX, normalY, normalZ, penetration } = contact;
    considerContactPosition({ x: ball.x + normalX * (penetration + CONTACT_PADDING),
      y: ball.y + normalY * (penetration + CONTACT_PADDING), z: ball.z + normalZ * (penetration + CONTACT_PADDING) });
    const axisY = Math.max(player.y + radius, Math.min(player.y + RIFTBALL_CHARACTER_SETTINGS.height - radius, ball.y));
    const horizontalRadius = Math.sqrt(Math.max(0, contactRadius ** 2 - (ball.y - axisY) ** 2));
    const horizontalDistance = Math.hypot(ball.x - player.x, ball.z - player.z);
    const directionX = horizontalDistance > CONTACT_PADDING ? (ball.x - player.x) / horizontalDistance : Math.sin(player.facing);
    const directionZ = horizontalDistance > CONTACT_PADDING ? (ball.z - player.z) / horizontalDistance : Math.cos(player.facing);
    considerContactPosition({ x: player.x + directionX * horizontalRadius, y: ball.y, z: player.z + directionZ * horizontalRadius });
    topExitY = Math.max(topExitY, player.y + RIFTBALL_CHARACTER_SETTINGS.height + RIFTBALL_COURT.ballRadius + CONTACT_PADDING);
    bottomExitY = Math.min(bottomExitY, player.y - RIFTBALL_COURT.ballRadius - CONTACT_PADDING);
  }
  if (contacts.length === 2) {
    const first = contacts[0].player;
    const second = contacts[1].player;
    const distance = Math.hypot(second.x - first.x, second.z - first.z);
    if (distance > CONTACT_PADDING) {
      const firstAxisY = Math.max(first.y + radius, Math.min(first.y + RIFTBALL_CHARACTER_SETTINGS.height - radius, ball.y));
      const secondAxisY = Math.max(second.y + radius, Math.min(second.y + RIFTBALL_CHARACTER_SETTINGS.height - radius, ball.y));
      const firstRadiusSquared = contactRadius ** 2 - (ball.y - firstAxisY) ** 2;
      const secondRadiusSquared = contactRadius ** 2 - (ball.y - secondAxisY) ** 2;
      const along = (firstRadiusSquared - secondRadiusSquared + distance * distance) / (2 * distance);
      const perpendicularSquared = firstRadiusSquared - along * along;
      if (perpendicularSquared >= 0) {
        const directionX = (second.x - first.x) / distance;
        const directionZ = (second.z - first.z) / distance;
        const perpendicular = Math.sqrt(perpendicularSquared);
        for (const side of [-1, 1]) {
          considerContactPosition({ x: first.x + directionX * along - directionZ * perpendicular * side,
            y: ball.y, z: first.z + directionZ * along + directionX * perpendicular * side });
        }
      }
    }
  }
  considerContactPosition({ x: ball.x, y: topExitY, z: ball.z });
  considerContactPosition({ x: ball.x, y: bottomExitY, z: ball.z });
  if (bestPosition) {
    ball.x = bestPosition.x;
    ball.y = bestPosition.y;
    ball.z = bestPosition.z;
  }
}

/**
 * Solve the two normal impulses together from one velocity sample. The diagonal
 * includes the athlete's horizontal inverse mass; off-diagonal terms account
 * for both contacts acting on the same ball. Negative impulses are discarded,
 * retaining unilateral contact and preventing sequential energy amplification.
 * @param {RiftballBodyContact[]} contacts
 * @param {RiftballBall} ball
 */
function applyRiftballBodyImpulses(contacts, ball) {
  const incoming = contacts.filter((contact) => contact.approachSpeed < 0);
  for (const contact of incoming) {
    const inverseMass = 1 + PLAYER_CONTACT_RECOIL * (contact.normalX ** 2 + contact.normalZ ** 2);
    contact.impulse = -(1 + PLAYER_CONTACT_RESTITUTION) * contact.approachSpeed / inverseMass;
  }
  if (incoming.length === 2) {
    const [first, second] = incoming;
    const firstMass = 1 + PLAYER_CONTACT_RECOIL * (first.normalX ** 2 + first.normalZ ** 2);
    const secondMass = 1 + PLAYER_CONTACT_RECOIL * (second.normalX ** 2 + second.normalZ ** 2);
    const coupling = first.normalX * second.normalX + first.normalY * second.normalY + first.normalZ * second.normalZ;
    const firstTarget = -(1 + PLAYER_CONTACT_RESTITUTION) * first.approachSpeed;
    const secondTarget = -(1 + PLAYER_CONTACT_RESTITUTION) * second.approachSpeed;
    const determinant = firstMass * secondMass - coupling * coupling;
    if (determinant > 1e-9) {
      const firstImpulse = (secondMass * firstTarget - coupling * secondTarget) / determinant;
      const secondImpulse = (firstMass * secondTarget - coupling * firstTarget) / determinant;
      if (firstImpulse >= 0 && secondImpulse >= 0) {
        first.impulse = firstImpulse;
        second.impulse = secondImpulse;
      } else if (firstImpulse < 0) first.impulse = 0;
      else second.impulse = 0;
    }
  }
  let impulseX = 0;
  let impulseY = 0;
  let impulseZ = 0;
  let greatestCueImpulse = 0;
  let lastTouchPlayerId = null;
  for (const contact of incoming) {
    const { player, normalX, normalY, normalZ, impulse } = contact;
    impulseX += impulse * normalX;
    impulseY += impulse * normalY;
    impulseZ += impulse * normalZ;
    player.vx -= impulse * normalX * PLAYER_CONTACT_RECOIL;
    player.vz -= impulse * normalZ * PLAYER_CONTACT_RECOIL;
    if (impulse <= 0 || contact.approachSpeed >= -1.2 || player.ballContactCooldownSec > 0) continue;
    player.ballContactCooldownSec = PLAYER_CONTACT_COOLDOWN_SEC;
    if (impulse > greatestCueImpulse + CONTACT_PADDING) {
      greatestCueImpulse = impulse;
      lastTouchPlayerId = player.id;
    } else if (Math.abs(impulse - greatestCueImpulse) <= CONTACT_PADDING) lastTouchPlayerId = null;
  }
  ball.vx += impulseX;
  ball.vy += impulseY;
  ball.vz += impulseZ;
  if (greatestCueImpulse > 0) {
    ball.hitSerial += 1;
    ball.lastTouchPlayerId = lastTouchPlayerId;
  }
  boundRiftballBallSpeed(ball);
}

/** @param {RiftballPlayer[]} players @param {RiftballBall} ball */
function reboundRiftballFromPlayers(players, ball) {
  const initialContacts = collectRiftballBodyContacts(players, ball);
  if (initialContacts.length === 0) return;
  separateRiftballBallFromPlayers(initialContacts, players, ball);
  const resolvedContacts = collectRiftballBodyContacts(players, ball);
  applyRiftballBodyImpulses(resolvedContacts.length ? resolvedContacts : initialContacts, ball);
}

/**
 * A goal requires the complete sphere to cross the line inside the opening.
 * Check the actual swept segment, before any later post/back-wall rebound.
 * @param {Readonly<SphereTravelSegment>} segment
 * @returns {RiftballPlayerId|null}
 */
export function getRiftballGoalCrossing(segment) {
  const goalLine = RIFTBALL_COURT.halfLength + RIFTBALL_COURT.ballRadius;
  for (const side of [-1, 1]) {
    const start = segment.startZ * side;
    const end = segment.endZ * side;
    if (start > goalLine || end <= goalLine || end <= start) continue;
    const fraction = (goalLine - start) / (end - start);
    const crossingX = segment.startX + (segment.endX - segment.startX) * fraction;
    const crossingY = segment.startY + (segment.endY - segment.startY) * fraction;
    if (Math.abs(crossingX) <= RIFTBALL_COURT.goalHalfWidth - RIFTBALL_COURT.ballRadius &&
        crossingY >= RIFTBALL_COURT.ballRadius - CONTACT_PADDING &&
        crossingY <= RIFTBALL_COURT.goalHeight - RIFTBALL_COURT.ballRadius) {
      return side < 0 ? "p1" : "p2";
    }
  }
  return null;
}

/**
 * Positional body contact can push the last fraction of the sphere across the
 * line without a velocity travel segment. Check that corrected sphere only
 * after static-solid depenetration, so posts/crossbar still exclude the goal.
 * @param {Readonly<RiftballBall>} ball
 * @returns {RiftballPlayerId|null}
 */
function getRiftballGoalOccupancy(ball) {
  if (Math.abs(ball.x) > RIFTBALL_COURT.goalHalfWidth - RIFTBALL_COURT.ballRadius ||
      ball.y < RIFTBALL_COURT.ballRadius - CONTACT_PADDING ||
      ball.y > RIFTBALL_COURT.goalHeight - RIFTBALL_COURT.ballRadius) return null;
  const goalLine = RIFTBALL_COURT.halfLength + RIFTBALL_COURT.ballRadius;
  if (ball.z < -goalLine) return "p1";
  if (ball.z > goalLine) return "p2";
  return null;
}

/**
 * Shared bounded contact world for authority and an owned prediction preview.
 * No clock, score or winner is mutated. The caller owns all passed bodies.
 * @param {RiftballPlayer[]} players Stable slot order.
 * @param {RiftballBall} ball
 * @param {number} dtSec Finite duration in [0,0.05].
 * @returns {RiftballPlayerId|null} First legal goal crossing in this step.
 */
export function stepRiftballContacts(players, ball, dtSec) {
  separateRiftballPlayers(players);
  strikeRiftballBall(players, ball);
  let goalScorer = null;
  const substeps = Math.max(1, Math.ceil(dtSec / CONTACT_STEP_SEC));
  const substepSec = dtSec / substeps;
  for (let index = 0; index < substeps; index += 1) {
    reboundRiftballFromPlayers(players, ball);
    const motionReport = sphereController.step(ball, substepSec, {
      solids: RIFTBALL_COURT_SOLIDS,
      floorY: 0,
      onTravel: (segment) => {
        goalScorer ||= getRiftballGoalCrossing(segment);
      },
    });
    ball.bounceSerial += motionReport.bounceCount;
    reboundRiftballFromPlayers(players, ball);
    // Resolve body push-outs against walls/floor without inventing travel events.
    sphereController.step(ball, 0, { solids: RIFTBALL_COURT_SOLIDS, floorY: 0 });
    goalScorer ||= getRiftballGoalOccupancy(ball);
    if (goalScorer) break;
  }
  return goalScorer;
}
