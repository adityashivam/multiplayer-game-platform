import { FIGHT_COMBAT, FIGHT_MOVEMENT } from "./shared/simulation.js";

/** @typedef {keyof import("./shared/simulation.js").FightInputState} FightInputKey */
/** @typedef {import("./shared/simulation.js").FightAttackType} FightAttackType */
/** @typedef {"a" | "b" | "x" | "y"} FightFaceAction */
/** @typedef {"idle" | "run" | "jump" | "attack" | "death"} FightSpritePose */
/** @typedef {FightAttackType | "idle" | "run" | "jump" | "landing" | "slide" | "dodge" | "guard" | "death"} FightAnimationClipId */
/** @typedef {FightAttackType | "jump" | "slide" | "dodge" | "guard" | "idle" | "run" | "death"} FightAuthoredClipId */
/** @typedef {"neutral" | "guard" | "crouch" | "dash" | "stun"} FightStance */

/**
 * @typedef {object} FightAnimationSample
 * @property {FightSpritePose} pose
 * @property {FightAnimationClipId} clipId Authored sequence; broad pose remains available to effects.
 * @property {number} frame Local frame within the named clip, before its atlas offset.
 * @property {FightStance} stance
 * @property {number} attackId
 * @property {number} presentationId Locally monotonic swing occurrence, independent of prediction rollback.
 * @property {FightAttackType | null} attackType
 * @property {"idle" | "startup" | "active" | "recovery"} phase
 * @property {number} progress
 */

/**
 * @typedef {object} FightAnimationPlayer
 * @property {number} y
 * @property {number} vx
 * @property {number} vy
 * @property {boolean} attacking
 * @property {number} attackId
 * @property {FightAttackType | null} attackType
 * @property {number} attackTimer
 * @property {boolean} dead
 * @property {boolean} [guarding]
 * @property {boolean} [crouching]
 * @property {number} [dashTimer]
 * @property {"dodge" | "slide" | null} [dashType]
 * @property {number} [stunTimer]
 * @property {number} [guardBrokenTimer]
 */

/**
 * @typedef {object} FightAuthoredAttack
 * @property {number} duration
 * @property {number} startupSec
 * @property {number} activeSec
 */

const DIRECTION_DOUBLE_TAP_MS = 240;
const SPRITE_FRAME_RATES = Object.freeze({ idle: 12, run: 18, death: 10 });
const FIGHT_LANDING_HOLD_MS = 90;
const FIGHT_GUARD_RAISE_SEC = 0.16;
const FIGHT_AIRBORNE_TOLERANCE_PX = 5;

/**
 * Map the velocity phase to the seven airborne poses. The eighth pose belongs
 * exclusively to ground contact, so a delayed snapshot cannot loop a landing.
 * @param {number} velocityY
 * @param {number} jumpSpeed
 * @returns {number}
 */
function readFightJumpPhaseFrame(velocityY, jumpSpeed) {
  const velocityRatio = velocityY / Math.max(1, Math.abs(jumpSpeed));
  if (velocityRatio < -0.9) {
    return 0;
  }
  if (velocityRatio < -0.6) {
    return 1;
  }
  if (velocityRatio < -0.14) {
    return 2;
  }
  if (velocityRatio < 0.14) {
    return 3;
  }
  if (velocityRatio < 0.4) {
    return 4;
  }
  if (velocityRatio < 0.75) {
    return 5;
  }
  return 6;
}

/** @type {Readonly<Record<string, FightInputKey>>} Keyboard codes are browser-defined, not game state keys. */
const FIGHT_KEY_BINDINGS = Object.freeze({
  ArrowLeft: "left", KeyA: "left",
  ArrowRight: "right", KeyD: "right",
  ArrowUp: "jump", KeyW: "jump", Space: "jump",
  ArrowDown: "crouch", KeyS: "crouch",
  KeyJ: "attack", KeyZ: "attack",
  KeyK: "heavyAttack", KeyX: "heavyAttack",
  KeyU: "aerialAttack", KeyY: "aerialAttack",
  KeyL: "block", KeyC: "block",
  KeyI: "specialAttack", KeyV: "specialAttack",
  ShiftLeft: "dash", ShiftRight: "dash",
});

/** @param {string} keyboardCode @returns {FightInputKey | null} */
export function readFightKeyboardInput(keyboardCode) {
  return Object.hasOwn(FIGHT_KEY_BINDINGS, keyboardCode) ? FIGHT_KEY_BINDINGS[keyboardCode] : null;
}

/**
 * Merge keyboard and touch holds without one source releasing another. Repeated
 * browser pointer/touch starts do not create extra action or double-tap edges.
 * @param {(inputKey: FightInputKey, active: boolean) => void} setInputFlag
 * @param {{edgeKeys?: ReadonlyArray<FightInputKey>}} [options]
 */
export function createFightInputController(setInputFlag, { edgeKeys = [] } = {}) {
  const actionEdgeKeys = new Set(edgeKeys);
  /** @type {Map<FightInputKey, Set<string>>} */
  const inputSources = new Map();
  /** @type {Map<string, FightInputKey>} */
  const actionSources = new Map();
  /** @type {{ left: number | null, right: number | null }} */
  const directionTapTimes = { left: null, right: null };

  /** @param {FightInputKey} inputKey @returns {boolean} */
  function isHeld(inputKey) {
    return Boolean(inputSources.get(inputKey)?.size);
  }

  /**
   * @param {FightInputKey} inputKey
   * @param {string} sourceId Stable identity for the physical control.
   * @param {boolean} active
   * @param {number} [nowMs=0] Monotonic input time, used for horizontal double taps.
   */
  function setHeld(inputKey, sourceId, active, nowMs = 0) {
    const heldSources = inputSources.get(inputKey) ?? new Set();
    const wasHeld = heldSources.size > 0;
    const wasSourceHeld = heldSources.has(sourceId);
    if (active) {
      heldSources.add(sourceId);
    } else {
      heldSources.delete(sourceId);
    }
    inputSources.set(inputKey, heldSources);

    const nextHeld = heldSources.size > 0;
    if (actionEdgeKeys.has(inputKey)) {
      if (active && !wasSourceHeld) {
        setInputFlag(inputKey, true);
        setInputFlag(inputKey, false);
      }
      return;
    }
    if (wasHeld === nextHeld) return;
    setInputFlag(inputKey, nextHeld);

    if (nextHeld && (inputKey === "left" || inputKey === "right")) {
      const previousTapMs = directionTapTimes[inputKey];
      if (previousTapMs !== null && nowMs > previousTapMs && nowMs - previousTapMs <= DIRECTION_DOUBLE_TAP_MS) {
        setHeld("dash", "direction-double-tap", true, nowMs);
        setHeld("dash", "direction-double-tap", false, nowMs);
        directionTapTimes[inputKey] = null;
      } else {
        directionTapTimes[inputKey] = nowMs;
      }
    }
  }

  /**
   * Remember the resolved chord until release, even if guard is released first.
   * @param {FightFaceAction} action
   * @param {string} sourceId
   * @param {boolean} active
   * @param {number} [nowMs=0]
   */
  function setAction(action, sourceId, active, nowMs = 0) {
    const actionKey = actionSources.get(sourceId) ?? (
      action === "a" ? "attack" :
        action === "x" ? "heavyAttack" :
          action === "b" ? "block" :
            isHeld("block") ? "specialAttack" : "aerialAttack"
    );
    if (active) {
      actionSources.set(sourceId, actionKey);
    } else {
      actionSources.delete(sourceId);
    }
    setHeld(actionKey, sourceId, active, nowMs);
  }

  return {
    setHeld,
    setAction,
    isHeld,
    reset() {
      for (const [inputKey, heldSources] of inputSources) {
        if (heldSources.size) setInputFlag(inputKey, false);
      }
      inputSources.clear();
      actionSources.clear();
      directionTapTimes.left = null;
      directionTapTimes.right = null;
    },
  };
}

/**
 * Advance only presentation time: snapshots and reconciliation can neither
 * restart an existing swing nor truncate it on an ordinary correction. Hit
 * stun, death and paused rounds interrupt actions. This track owns its timing
 * and never retains or mutates simulation state.
 * @param {object} config
 * @param {Readonly<Partial<Record<FightAttackType, FightAuthoredAttack>>>} config.attackDefinitions
 * @param {number} config.groundY
 * @param {Partial<Record<FightSpritePose, number>>} config.frameCounts Original sheet frame counts.
 * @param {Readonly<Partial<Record<FightAuthoredClipId, {frameCount: number, holdFrame?: number}>>>} [config.moveClips]
 * @param {{DASH_DURATION_SEC: number, SLIDE_DURATION_SEC: number}} [config.combat]
 * @param {number} [config.jumpSpeed]
 * @param {number} [config.gravity]
 */
export function createFightAnimationTrack({
  attackDefinitions,
  groundY,
  frameCounts,
  moveClips = {},
  combat = FIGHT_COMBAT,
  jumpSpeed = FIGHT_MOVEMENT.JUMP_SPEED,
  gravity = FIGHT_MOVEMENT.GRAVITY,
}) {
  /** @type {{ id: number, presentationId: number, type: FightAttackType, startedAtMs: number, definition: FightAuthoredAttack } | null} */
  let currentAttack = null;
  /** @type {{type: "dodge" | "slide", startedAtMs: number, durationSec: number} | null} */
  let currentMobility = null;
  let lastAttackId = 0;
  let lastPresentationId = 0;
  /** @type {"dodge" | "slide" | null} */
  let lastDashType = null;
  /** @type {FightSpritePose | null} */
  let previousPose = null;
  /** @type {FightAnimationClipId | null} */
  let previousClipId = null;
  let poseStartedAtMs = 0;
  let lastSampleAtMs = 0;
  let wasAirborne = false;
  let landingUntilMs = 0;
  let observedJumpY = NaN;
  let observedJumpVelocityY = NaN;
  let observedJumpAtMs = 0;

  /** @param {FightAnimationClipId} clipId @returns {number} */
  function readFightClipFrameCount(clipId) {
    const authoredClipId = clipId === "landing" ? "jump" : clipId;
    const authoredClip = Object.hasOwn(moveClips, authoredClipId)
      ? moveClips[/** @type {FightAuthoredClipId} */ (authoredClipId)] : null;
    if (authoredClip) {
      return Math.max(1, authoredClip.frameCount);
    }
    if (Object.hasOwn(attackDefinitions, clipId)) {
      return Math.max(1, frameCounts.attack ?? 1);
    }
    const fallbackPose = clipId === "run" ? "run" : clipId === "death" ? "death" :
      clipId === "jump" || clipId === "landing" ? "jump" : "idle";
    return Math.max(1, frameCounts[fallbackPose] ?? frameCounts.idle ?? 1);
  }

  /** @param {FightAnimationPlayer} playerState @param {number} nowMs @param {boolean} interrupted */
  function recordFightMobilityPhase(playerState, nowMs, interrupted) {
    const dashType = playerState.dashTimer > 0 ? playerState.dashType ?? "dodge" : null;
    if (interrupted || !dashType) {
      currentMobility = null;
    } else if (dashType !== lastDashType) {
      const durationSec = dashType === "slide" ? combat.SLIDE_DURATION_SEC : combat.DASH_DURATION_SEC;
      const elapsedSec = Math.max(0, Math.min(durationSec, durationSec - playerState.dashTimer));
      currentMobility = { type: dashType, durationSec, startedAtMs: nowMs - elapsedSec * 1000 };
    }
    lastDashType = dashType;
  }

  /** @param {FightAnimationPlayer} playerState @param {number} nowMs @param {boolean} active @returns {boolean} */
  function recordFightJumpPhase(playerState, nowMs, active) {
    const airborne = active && !playerState.dead &&
      (playerState.y < groundY - FIGHT_AIRBORNE_TOLERANCE_PX || playerState.vy < 0);
    if (airborne) {
      landingUntilMs = 0;
      if (playerState.y !== observedJumpY || playerState.vy !== observedJumpVelocityY || !wasAirborne) {
        observedJumpY = playerState.y;
        observedJumpVelocityY = playerState.vy;
        observedJumpAtMs = nowMs;
      }
    } else if (wasAirborne && active && !playerState.dead) {
      landingUntilMs = nowMs + FIGHT_LANDING_HOLD_MS;
    } else if (!active || playerState.dead) {
      landingUntilMs = 0;
    }
    wasAirborne = airborne;
    return airborne;
  }

  /**
   * @param {FightAnimationPlayer} playerState Caller-owned simulation sample.
   * @param {number} nowMs Monotonic render time.
   * @param {{active?: boolean}} [options] Paused rounds cancel ongoing action visuals.
   * @returns {FightAnimationSample}
   */
  function sample(playerState, nowMs, { active = true } = {}) {
    nowMs = Math.max(lastSampleAtMs, nowMs);
    lastSampleAtMs = nowMs;
    const stunned = playerState.stunTimer > 0 || playerState.guardBrokenTimer > 0;
    const interrupted = playerState.dead || stunned || !active;

    // Rejected prediction may rewind the simulation counter while its authored
    // visual finishes. Idle authority establishes a new baseline; an older active
    // snapshot alone must not restart the swing that is already on screen.
    if (!playerState.attacking && playerState.attackId < lastAttackId) {
      lastAttackId = playerState.attackId;
    }

    const attackDefinition = playerState.attackType ? attackDefinitions[playerState.attackType] : null;
    if (!interrupted && playerState.attacking && attackDefinition && playerState.attackId > lastAttackId) {
      const elapsedSec = Math.max(0, Math.min(attackDefinition.duration, attackDefinition.duration - playerState.attackTimer));
      lastPresentationId += 1;
      currentAttack = {
        id: playerState.attackId,
        presentationId: lastPresentationId,
        type: playerState.attackType,
        startedAtMs: nowMs - elapsedSec * 1000,
        definition: attackDefinition,
      };
      lastAttackId = playerState.attackId;
    }

    if (interrupted || (currentAttack && nowMs - currentAttack.startedAtMs >= currentAttack.definition.duration * 1000)) {
      currentAttack = null;
    }
    if (interrupted) {
      lastAttackId = Math.max(lastAttackId, playerState.attackId);
    }

    recordFightMobilityPhase(playerState, nowMs, interrupted);
    const airborne = recordFightJumpPhase(playerState, nowMs, active);

    const stance = !active || playerState.dead ? "neutral" : stunned ? "stun" :
      currentMobility ? "dash" : playerState.guarding ? "guard" :
        playerState.crouching ? "crouch" : "neutral";
    const pose = playerState.dead ? "death" : !active ? "idle" : currentAttack ? "attack" :
      airborne ? "jump" : stance === "dash" ||
        (Math.abs(playerState.vx) > 5 && stance === "neutral") ? "run" : "idle";
    const clipId = playerState.dead ? "death" : !active ? "idle" : currentAttack ? currentAttack.type :
      currentMobility ? currentMobility.type : airborne ? "jump" :
        stance === "guard" ? "guard" : stance === "crouch" ? "sweep" :
          nowMs < landingUntilMs && !stunned ? "landing" : pose === "run" ? "run" : "idle";
    if (pose !== previousPose || clipId !== previousClipId) {
      previousPose = pose;
      previousClipId = clipId;
      poseStartedAtMs = nowMs;
    }

    const clipFrameCount = readFightClipFrameCount(clipId);
    let frame = 0;
    let progress = 0;
    /** @type {FightAnimationSample["phase"]} */
    let phase = "idle";
    if (currentAttack) {
      const elapsedSec = Math.max(0, (nowMs - currentAttack.startedAtMs) / 1000);
      const { duration, startupSec, activeSec } = currentAttack.definition;
      progress = Math.min(1, elapsedSec / duration);
      let spriteProgress;
      if (elapsedSec < startupSec) {
        phase = "startup";
        spriteProgress = 0.25 * elapsedSec / Math.max(startupSec, 0.001);
      } else if (elapsedSec < startupSec + activeSec) {
        phase = "active";
        spriteProgress = 0.25 + 0.45 * (elapsedSec - startupSec) / Math.max(activeSec, 0.001);
      } else {
        phase = "recovery";
        spriteProgress = 0.7 + 0.3 * (elapsedSec - startupSec - activeSec) / Math.max(duration - startupSec - activeSec, 0.001);
      }
      frame = Math.min(clipFrameCount - 1, Math.floor(spriteProgress * clipFrameCount));
    } else if (currentMobility) {
      progress = Math.min(1, Math.max(0, (nowMs - currentMobility.startedAtMs) / 1000 / currentMobility.durationSec));
      frame = Math.min(clipFrameCount - 1, Math.floor(progress * clipFrameCount));
    } else if (clipId === "landing") {
      frame = clipFrameCount - 1;
    } else if (clipId === "jump") {
      const renderVelocityY = observedJumpVelocityY + gravity * Math.max(0, nowMs - observedJumpAtMs) / 1000;
      if (clipFrameCount <= 2) {
        frame = renderVelocityY < 0 ? 0 : clipFrameCount - 1;
      } else {
        frame = Math.min(clipFrameCount - 2, readFightJumpPhaseFrame(renderVelocityY, jumpSpeed));
      }
    } else if (stance === "crouch") {
      frame = Math.max(0, Math.min(clipFrameCount - 1, moveClips.sweep?.holdFrame ?? 0));
    } else {
      const elapsedSec = Math.max(0, (nowMs - poseStartedAtMs) / 1000);
      if (clipId === "death") {
        frame = Math.min(clipFrameCount - 1, Math.floor(elapsedSec * SPRITE_FRAME_RATES.death));
      } else if (clipId === "guard") {
        frame = Math.min(clipFrameCount - 1, Math.floor(elapsedSec / FIGHT_GUARD_RAISE_SEC * clipFrameCount));
      } else {
        frame = Math.floor(elapsedSec * SPRITE_FRAME_RATES[pose]) % clipFrameCount;
      }
    }

    return {
      pose,
      clipId,
      frame,
      stance,
      attackId: currentAttack?.id ?? lastAttackId,
      presentationId: currentAttack?.presentationId ?? lastPresentationId,
      attackType: currentAttack?.type ?? null,
      phase,
      progress,
    };
  }

  return {
    sample,
    reset() {
      currentAttack = null;
      currentMobility = null;
      lastAttackId = 0;
      lastPresentationId = 0;
      lastDashType = null;
      previousPose = null;
      previousClipId = null;
      poseStartedAtMs = 0;
      lastSampleAtMs = 0;
      wasAirborne = false;
      landingUntilMs = 0;
      observedJumpY = NaN;
      observedJumpVelocityY = NaN;
      observedJumpAtMs = 0;
    },
  };
}

/**
 * Emit one attack cue per local presentation occurrence. Simulation attack IDs
 * may be reused after correction; presentation IDs remain monotonic until reset.
 */
export function createFightAttackCueTracker() {
  const lastPresentationIds = { p1: 0, p2: 0 };

  return {
    /**
     * @param {import("./shared/simulation.js").FightPlayerId} playerId
     * @param {FightAnimationSample} animation
     * @returns {FightAttackType | null} Attack kind only when a new cue is due.
     */
    consumeAttackCue(playerId, animation) {
      if (!animation.attackType || animation.presentationId <= lastPresentationIds[playerId]) {
        return null;
      }
      lastPresentationIds[playerId] = animation.presentationId;
      return animation.attackType;
    },
    reset() {
      lastPresentationIds.p1 = 0;
      lastPresentationIds.p2 = 0;
    },
  };
}

/**
 * Consume the server's bounded, oldest-first event ring once per match. The
 * numeric high-water mark also rejects an old event after it leaves the ring.
 * Event values remain caller-owned and are never changed.
 */
export function createFightCombatEventFeed() {
  let lastEventId = 0;

  return {
    /**
     * @template {{id: number}} CombatEvent
     * @param {CombatEvent[] | undefined} combatEvents
     * @returns {CombatEvent[]}
     */
    consume(combatEvents) {
      const unseenEvents = [];
      for (const combatEvent of combatEvents ?? []) {
        if (!Number.isSafeInteger(combatEvent.id) || combatEvent.id <= lastEventId) continue;
        lastEventId = combatEvent.id;
        unseenEvents.push(combatEvent);
      }
      return unseenEvents;
    },
    reset() {
      lastEventId = 0;
    },
  };
}
