import { createKinematicCharacterController } from "../../../platform/shared/kinematicCharacter.js";
import {
  RIFTBALL_ACTION_SETTINGS,
  RIFTBALL_CHARACTER_SETTINGS,
  RIFTBALL_COURT,
  RIFTBALL_PLAYER_IDS,
  RIFTBALL_ROUND_DURATION_SEC,
  RIFTBALL_SCORE_TO_WIN,
} from "./config.js";
import { RIFTBALL_FLOOR_PLATFORMS } from "./court.js";
import { stepRiftballContacts } from "./contacts.js";

/** @typedef {import("./config.js").RiftballInputState} RiftballInputState */
/** @typedef {import("./config.js").RiftballPlayerId} RiftballPlayerId */
/** @typedef {import("./config.js").RiftballAction} RiftballAction */
/** @typedef {"waiting"|"countdown"|"playing"|"goal"|"overtime"|"paused"|"finished"} RiftballPhase */
/**
 * Game-owned character body. Y is the feet position. Every field exists before
 * the first snapshot; SDK command queues and ownership metadata are separate.
 * Facing zero points along positive Z. Action time is elapsed, in seconds.
 * @typedef {object} RiftballPlayer
 * @property {RiftballPlayerId} id
 * @property {number} slotIndex
 * @property {number} colorIndex
 * @property {number} x
 * @property {number} y
 * @property {number} z
 * @property {number} vx
 * @property {number} vy
 * @property {number} vz
 * @property {number} facing
 * @property {boolean} grounded
 * @property {number} supportId
 * @property {number} coyoteSec
 * @property {number} jumpBufferSec
 * @property {boolean} jumpHeld
 * @property {boolean} strikeHeld
 * @property {boolean} dashHeld
 * @property {boolean} feintHeld
 * @property {boolean} connected
 * @property {RiftballAction} action
 * @property {number} actionId
 * @property {number} actionTimeSec
 * @property {number} chargeSec
 * @property {number} strikePower Last released charge fraction, retained for animation.
 * @property {number} strikeFacing Aim locked when a strike is released.
 * @property {number} strikeHitId Last action identity that struck the ball.
 * @property {number} strikeCooldownSec
 * @property {number} dashCooldownSec
 * @property {number} dashRemainingSec
 * @property {number} ballContactCooldownSec
 * @property {number} stamina
 * @property {number} score
 * @property {number} seriesWins
 */
/**
 * @typedef {object} RiftballBall
 * @property {number} x
 * @property {number} y Center height, unlike character feet.
 * @property {number} z
 * @property {number} vx
 * @property {number} vy
 * @property {number} vz
 * @property {number} serveId Discontinuous position identity within a round.
 * @property {number} hitSerial
 * @property {number} bounceSerial
 * @property {RiftballPlayerId|null} lastTouchPlayerId
 */
/**
 * @typedef {object} RiftballRound
 * @property {{p1:RiftballPlayer,p2:RiftballPlayer}} players
 * @property {RiftballBall} ball
 * @property {number} roundId
 * @property {number} timeSec Paused during countdown, disconnect and goal reset.
 * @property {number} timer Remaining regulation seconds; zero in overtime.
 * @property {number} durationSec
 * @property {boolean} started
 * @property {number|null} startAt
 * @property {boolean} gameOver
 * @property {RiftballPlayerId|null} winner
 * @property {RiftballPhase} phase
 * @property {boolean} suddenDeath
 * @property {number} goalSerial
 * @property {RiftballPlayerId|null} lastScorer
 * @property {number} goalResetRemainingSec
 */

const MAX_PURE_STEP_SEC = 0.05;
const TIMER_EPSILON_SEC = 1e-7;
const CHARGE_MOVEMENT_SCALE = 0.62;
const characterController = createKinematicCharacterController(RIFTBALL_CHARACTER_SETTINGS);

/** @param {number} value @param {number} minimum @param {number} maximum */
function clampRiftballNumber(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

/** @param {number} dtSec @returns {number} */
export function getRiftballStepDuration(dtSec) {
  return Number.isFinite(dtSec) ? clampRiftballNumber(dtSec, 0, MAX_PURE_STEP_SEC) : 0;
}

/** @param {RiftballPlayerId} id @param {number} slotIndex @returns {RiftballPlayer} */
export function createRiftballPlayer(id, slotIndex) {
  const facing = slotIndex === 0 ? Math.PI : 0;
  return {
    id,
    slotIndex,
    colorIndex: slotIndex,
    x: 0,
    y: 0,
    z: slotIndex === 0 ? RIFTBALL_COURT.playerSpawnZ : -RIFTBALL_COURT.playerSpawnZ,
    vx: 0,
    vy: 0,
    vz: 0,
    facing,
    grounded: true,
    supportId: 1,
    coyoteSec: 0,
    jumpBufferSec: 0,
    jumpHeld: false,
    strikeHeld: false,
    dashHeld: false,
    feintHeld: false,
    connected: false,
    action: "idle",
    actionId: 0,
    actionTimeSec: 0,
    chargeSec: 0,
    strikePower: 0,
    strikeFacing: facing,
    strikeHitId: -1,
    strikeCooldownSec: 0,
    dashCooldownSec: 0,
    dashRemainingSec: 0,
    ballContactCooldownSec: 0,
    stamina: 100,
    score: 0,
    seriesWins: 0,
  };
}

/** @returns {RiftballBall} */
function createRiftballBall() {
  return {
    x: 0, y: RIFTBALL_COURT.ballRadius, z: 0,
    vx: 0, vy: 0, vz: 0,
    serveId: 1, hitSerial: 0, bounceSerial: 0, lastTouchPlayerId: null,
  };
}

/** Create a pure independent match; players begin unconnected. @returns {RiftballRound} */
export function createRiftballRound() {
  return {
    players: { p1: createRiftballPlayer("p1", 0), p2: createRiftballPlayer("p2", 1) },
    ball: createRiftballBall(),
    roundId: 1,
    timeSec: 0,
    timer: RIFTBALL_ROUND_DURATION_SEC,
    durationSec: RIFTBALL_ROUND_DURATION_SEC,
    started: false,
    startAt: null,
    gameOver: false,
    winner: null,
    phase: "waiting",
    suddenDeath: false,
    goalSerial: 0,
    lastScorer: null,
    goalResetRemainingSec: 0,
  };
}

/** @param {RiftballPlayer} player @param {RiftballAction} action @param {boolean} [restart] */
function beginRiftballAction(player, action, restart = false) {
  if (player.action === action && !restart) return;
  player.action = action;
  player.actionId += 1;
  player.actionTimeSec = 0;
}

/**
 * Cancel held action edges on ownership changes without changing pose, scores,
 * stamina, cooldowns or series wins. Velocity is frozen while awaiting rejoin.
 * @param {RiftballPlayer} player
 */
export function resetRiftballPlayerControls(player) {
  player.jumpHeld = false;
  player.strikeHeld = false;
  player.dashHeld = false;
  player.feintHeld = false;
  player.jumpBufferSec = 0;
  player.chargeSec = 0;
  player.dashRemainingSec = 0;
  player.vx = 0;
  player.vy = 0;
  player.vz = 0;
  if (player.action !== "victory" && player.action !== "defeat") beginRiftballAction(player, "idle");
}

/** @param {RiftballPlayer} player @param {number} stepSec */
function stepRiftballPlayerTimers(player, stepSec) {
  player.actionTimeSec += stepSec;
  player.strikeCooldownSec = Math.max(0, player.strikeCooldownSec - stepSec);
  player.dashCooldownSec = Math.max(0, player.dashCooldownSec - stepSec);
  player.dashRemainingSec = Math.max(0, player.dashRemainingSec - stepSec);
  player.ballContactCooldownSec = Math.max(0, player.ballContactCooldownSec - stepSec);
  if (player.action !== "charge" && player.dashRemainingSec <= 0) {
    player.stamina = Math.min(100, player.stamina + RIFTBALL_ACTION_SETTINGS.staminaRecoveryPerSec * stepSec);
  }
}

/** @param {RiftballPlayer} player */
function containRiftballPlayer(player) {
  const limitX = RIFTBALL_COURT.halfWidth - RIFTBALL_CHARACTER_SETTINGS.radius;
  const limitZ = RIFTBALL_COURT.halfLength - RIFTBALL_CHARACTER_SETTINGS.radius;
  if (player.x < -limitX || player.x > limitX) {
    player.x = clampRiftballNumber(player.x, -limitX, limitX);
    if (player.vx * player.x > 0) player.vx = 0;
  }
  if (player.z < -limitZ || player.z > limitZ) {
    player.z = clampRiftballNumber(player.z, -limitZ, limitZ);
    if (player.vz * player.z > 0) player.vz = 0;
  }
}

/**
 * Shared local movement and action timing. Mutates only this character; the
 * world owns contact, goals and clock. Input vectors are world-space X/Z.
 * A paused step consumes no edges or timers. Nonfinite/negative steps do no work.
 * @param {RiftballPlayer} player
 * @param {Readonly<RiftballInputState>} input
 * @param {number} dtSec
 * @param {{active:boolean,timeSec:number}} context
 */
export function stepRiftballPlayer(player, input, dtSec, { active }) {
  if (!active) return;
  const stepSec = getRiftballStepDuration(dtSec);
  if (stepSec <= 0) return;
  stepRiftballPlayerTimers(player, stepSec);

  const moveX = Number.isFinite(input.moveX) ? clampRiftballNumber(input.moveX, -1, 1) : 0;
  const moveZ = Number.isFinite(input.moveZ) ? clampRiftballNumber(input.moveZ, -1, 1) : 0;
  const aimX = Number.isFinite(input.aimX) ? clampRiftballNumber(input.aimX, -1, 1) : 0;
  const aimZ = Number.isFinite(input.aimZ) ? clampRiftballNumber(input.aimZ, -1, 1) : 0;
  const movementLength = Math.hypot(moveX, moveZ);
  const aimLength = Math.hypot(aimX, aimZ);
  const strikePressed = Boolean(input.strike) && !player.strikeHeld;
  const strikeReleased = !input.strike && player.strikeHeld;
  const dashPressed = Boolean(input.dash) && !player.dashHeld;
  const feintPressed = Boolean(input.feint) && !player.feintHeld;
  player.strikeHeld = Boolean(input.strike);
  player.dashHeld = Boolean(input.dash);
  player.feintHeld = Boolean(input.feint);
  if (player.action !== "strike") {
    if (aimLength > 0.1) player.facing = Math.atan2(aimX, aimZ);
    else if (movementLength > 0.1) player.facing = Math.atan2(moveX, moveZ);
  }

  if (player.action === "strike" && player.actionTimeSec >= RIFTBALL_ACTION_SETTINGS.strikeDurationSec) beginRiftballAction(player, "idle");
  if (player.action === "feint" && player.actionTimeSec >= RIFTBALL_ACTION_SETTINGS.feintDurationSec) beginRiftballAction(player, "idle");
  if (feintPressed && player.action === "charge" && player.stamina >= RIFTBALL_ACTION_SETTINGS.feintStaminaCost) {
    player.stamina -= RIFTBALL_ACTION_SETTINGS.feintStaminaCost;
    player.chargeSec = 0;
    beginRiftballAction(player, "feint", true);
  } else if (strikeReleased && player.action === "charge") {
    player.strikePower = clampRiftballNumber(player.chargeSec / RIFTBALL_ACTION_SETTINGS.maxChargeSec, 0, 1);
    player.strikeFacing = player.facing;
    player.chargeSec = 0;
    player.strikeCooldownSec = RIFTBALL_ACTION_SETTINGS.strikeCooldownSec;
    beginRiftballAction(player, "strike", true);
  } else if (strikePressed && player.strikeCooldownSec <= 0 &&
      player.action !== "strike" && player.action !== "feint" && player.dashRemainingSec <= 0) {
    player.chargeSec = 0;
    beginRiftballAction(player, "charge", true);
  }
  if (player.action === "charge") player.chargeSec = Math.min(RIFTBALL_ACTION_SETTINGS.maxChargeSec, player.chargeSec + stepSec);
  if (dashPressed && player.dashCooldownSec <= 0 && player.stamina >= RIFTBALL_ACTION_SETTINGS.dashStaminaCost &&
      player.action !== "strike" && player.action !== "feint") {
    const directionX = movementLength > 0.1 ? moveX / movementLength : Math.sin(player.facing);
    const directionZ = movementLength > 0.1 ? moveZ / movementLength : Math.cos(player.facing);
    const dashSpeed = RIFTBALL_CHARACTER_SETTINGS.moveSpeed * RIFTBALL_ACTION_SETTINGS.dashSpeedScale;
    player.vx = directionX * dashSpeed;
    player.vz = directionZ * dashSpeed;
    player.chargeSec = 0;
    player.stamina -= RIFTBALL_ACTION_SETTINGS.dashStaminaCost;
    player.dashCooldownSec = RIFTBALL_ACTION_SETTINGS.dashCooldownSec;
    player.dashRemainingSec = RIFTBALL_ACTION_SETTINGS.dashDurationSec;
    beginRiftballAction(player, "dash", true);
  }

  const wasGrounded = player.grounded;
  characterController.step(player, { x: moveX, z: moveZ, jump: Boolean(input.jump) }, stepSec, {
    platforms: RIFTBALL_FLOOR_PLATFORMS,
    controlScale: player.dashRemainingSec > 0 ? 0 : 1,
    speedScale: player.action === "charge" ? CHARGE_MOVEMENT_SCALE : 1,
  });
  containRiftballPlayer(player);
  const lockedAction = player.action === "charge" || player.action === "strike" || player.action === "feint";
  if (!lockedAction) {
    if (player.dashRemainingSec > 0) beginRiftballAction(player, "dash");
    else if (!player.grounded) beginRiftballAction(player, "jump", wasGrounded);
    else beginRiftballAction(player, Math.hypot(player.vx, player.vz) > 0.3 ? "run" : "idle");
  }
}

/** @param {RiftballRound} round @param {RiftballPlayerId} winner */
function finishRiftballMatch(round, winner) {
  if (round.gameOver) return;
  round.gameOver = true;
  round.winner = winner;
  round.phase = "finished";
  round.goalResetRemainingSec = 0;
  round.players[winner].seriesWins += 1;
  for (const playerId of RIFTBALL_PLAYER_IDS) {
    const player = round.players[playerId];
    resetRiftballPlayerControls(player);
    beginRiftballAction(player, playerId === winner ? "victory" : "defeat", true);
  }
}

/** @param {RiftballRound} round */
function resetRiftballServe(round) {
  for (const playerId of RIFTBALL_PLAYER_IDS) {
    const player = round.players[playerId];
    const nextPlayer = createRiftballPlayer(playerId, player.slotIndex);
    nextPlayer.connected = player.connected;
    nextPlayer.score = player.score;
    nextPlayer.seriesWins = player.seriesWins;
    nextPlayer.actionId = player.actionId + 1;
    Object.assign(player, nextPlayer);
  }
  const nextBall = createRiftballBall();
  nextBall.serveId = round.ball.serveId + 1;
  nextBall.hitSerial = round.ball.hitSerial;
  nextBall.bounceSerial = round.ball.bounceSerial;
  Object.assign(round.ball, nextBall);
  round.phase = round.suddenDeath ? "overtime" : "playing";
  round.goalResetRemainingSec = 0;
}

/** @param {RiftballRound} round @param {RiftballPlayerId} scorer */
function recordRiftballGoal(round, scorer) {
  round.players[scorer].score += 1;
  round.goalSerial += 1;
  round.lastScorer = scorer;
  if (round.players[scorer].score >= RIFTBALL_SCORE_TO_WIN || round.suddenDeath) {
    finishRiftballMatch(round, scorer);
    return;
  }
  round.phase = "goal";
  round.goalResetRemainingSec = RIFTBALL_ACTION_SETTINGS.goalPauseSec;
  for (const player of Object.values(round.players)) resetRiftballPlayerControls(player);
}

/**
 * Advance shared contacts, scoring and match time once after player commands.
 * Authority calls this entry point; prediction uses the score-free contact
 * helper. Long durations clamp to .05s and paused/completed rounds are inert.
 * @param {RiftballRound} round
 * @param {number} dtSec
 */
export function stepRiftballWorld(round, dtSec) {
  if (!round.started || round.gameOver) return;
  const stepSec = getRiftballStepDuration(dtSec);
  if (stepSec <= 0) return;
  if (round.phase === "goal") {
    round.goalResetRemainingSec = Math.max(0, round.goalResetRemainingSec - stepSec);
    if (round.goalResetRemainingSec <= TIMER_EPSILON_SEC) resetRiftballServe(round);
    return;
  }
  round.phase = round.suddenDeath ? "overtime" : "playing";
  const scorer = stepRiftballContacts(Object.values(round.players), round.ball, stepSec);
  round.timeSec += stepSec;
  round.timer = Math.max(0, round.timer - stepSec);
  if (scorer) recordRiftballGoal(round, scorer);
  if (!round.gameOver && round.timer <= TIMER_EPSILON_SEC) {
    round.timer = 0;
    if (round.players.p1.score !== round.players.p2.score) {
      finishRiftballMatch(round, round.players.p1.score > round.players.p2.score ? "p1" : "p2");
    } else {
      round.suddenDeath = true;
      if (round.phase !== "goal") round.phase = "overtime";
    }
  }
}
