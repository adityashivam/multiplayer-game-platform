import { createFightAttackCueTracker, createFightCombatEventFeed } from "./presentation.js";
import { readFightCompactHudLayout } from "./hudLayout.js";

/** @typedef {import("./shared/simulation.js").FightPlayerId} FightPlayerId */
/** @typedef {import("./shared/simulation.js").FightPlayerState} FightPlayerState */
/** @typedef {import("./shared/simulation.js").FightAttackType} FightAttackType */
/** @typedef {import("./presentation.js").FightAnimationSample} FightAnimationSample */
/**
 * @typedef {object} FightCombatEvent
 * @property {number} id
 * @property {"hit" | "block" | "parry" | "guard-break"} kind
 * @property {FightAttackType} attackType
 * @property {number} damage
 * @property {number} x
 * @property {number} y Sprite origin, not visible body position.
 */

const FIGHT_VIEW_WIDTH = 1280;
const FIGHT_VIEW_HEIGHT = 720;
const FIGHT_VISIBLE_BODY_OFFSET_Y = 390;
const MAX_COMBAT_EFFECTS = 20;
const COMBAT_EFFECT_LIFETIME_MS = 460;
const HEALTH_TRAIL_DELAY_MS = 260;
const FIGHT_PALETTE = Object.freeze({
  ink: "#10181d",
  cream: "#fff4dc",
  muted: "#bcc9c4",
  gold: "#ebc477",
  cyan: "#71e5de",
  warning: "#ef8b69",
  track: "rgba(13,24,28,.86)",
});

/**
 * Keep effects on the rendered canvas content and compact HUD in host CSS pixels.
 * Neither canvas sizing nor platform shell geometry changes.
 * @param {HTMLCanvasElement} gameCanvas
 */
function createFightOverlayCanvas(gameCanvas) {
  const host = gameCanvas.parentElement;
  if (!host) return null;

  const previousHostPosition = host.style.position;
  const needsPosition = window.getComputedStyle(host).position === "static";
  if (needsPosition) host.style.position = "relative";

  const overlayCanvas = document.createElement("canvas");
  overlayCanvas.width = FIGHT_VIEW_WIDTH;
  overlayCanvas.height = FIGHT_VIEW_HEIGHT;
  overlayCanvas.setAttribute("aria-hidden", "true");
  overlayCanvas.dataset.fightPresentation = "true";
  Object.assign(overlayCanvas.style, {
    position: "absolute",
    pointerEvents: "none",
    zIndex: "4",
  });
  host.appendChild(overlayCanvas);

  const compactHudCanvas = document.createElement("canvas");
  compactHudCanvas.setAttribute("aria-hidden", "true");
  compactHudCanvas.dataset.fightCompactHud = "true";
  Object.assign(compactHudCanvas.style, {
    position: "absolute",
    top: "0",
    left: "0",
    pointerEvents: "none",
    zIndex: "4",
  });
  host.appendChild(compactHudCanvas);

  let displayWidth = 1280;
  let hudTopInset = 0;
  let hudPixelRatio = 1;
  let hudViewport = { width: 0, height: 0 };
  /** @type {ReturnType<typeof readFightCompactHudLayout> | null} */
  let compactHudLayout = null;
  function syncOverlayBounds() {
    const canvasBounds = gameCanvas.getBoundingClientRect();
    const hostBounds = host.getBoundingClientRect();
    const contentWidth = Math.min(canvasBounds.width, canvasBounds.height * FIGHT_VIEW_WIDTH / FIGHT_VIEW_HEIGHT);
    const contentHeight = contentWidth * FIGHT_VIEW_HEIGHT / FIGHT_VIEW_WIDTH;
    const contentLeft = canvasBounds.left + (canvasBounds.width - contentWidth) / 2;
    const contentTop = canvasBounds.top + (canvasBounds.height - contentHeight) / 2;
    const toolbarBounds = host.parentElement?.querySelector('[aria-label="Game session controls"]')?.getBoundingClientRect();
    displayWidth = contentWidth;
    hudTopInset = toolbarBounds && contentWidth > 0 ? Math.max(0, toolbarBounds.bottom - contentTop + 8) * FIGHT_VIEW_WIDTH / contentWidth : 0;
    hudPixelRatio = Math.min(2, window.devicePixelRatio || 1);
    hudViewport = { width: hostBounds.width, height: hostBounds.height };
    compactHudLayout = readFightCompactHudLayout({
      hostWidth: hostBounds.width,
      hostHeight: hostBounds.height,
      stageLeft: contentLeft - hostBounds.left,
      stageTop: contentTop - hostBounds.top,
      stageWidth: contentWidth,
      stageHeight: contentHeight,
      toolbarBottom: toolbarBounds ? toolbarBounds.bottom - hostBounds.top : 0,
    });
    Object.assign(overlayCanvas.style, {
      left: `${canvasBounds.left - hostBounds.left + (canvasBounds.width - contentWidth) / 2}px`,
      top: `${canvasBounds.top - hostBounds.top + (canvasBounds.height - contentHeight) / 2}px`,
      width: `${contentWidth}px`,
      height: `${contentHeight}px`,
    });
    compactHudCanvas.width = Math.round(hostBounds.width * hudPixelRatio);
    compactHudCanvas.height = Math.round(hostBounds.height * hudPixelRatio);
    compactHudCanvas.style.width = `${hostBounds.width}px`;
    compactHudCanvas.style.height = `${hostBounds.height}px`;
  }

  const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(syncOverlayBounds) : null;
  resizeObserver?.observe(gameCanvas);
  resizeObserver?.observe(host);
  window.addEventListener("resize", syncOverlayBounds);
  syncOverlayBounds();

  return {
    canvas: overlayCanvas,
    compactHudCanvas,
    getDisplayWidth: () => displayWidth,
    getHudTopInset: () => hudTopInset,
    getHudPixelRatio: () => hudPixelRatio,
    getHudViewport: () => hudViewport,
    getCompactHudLayout: () => compactHudLayout,
    destroy() {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", syncOverlayBounds);
      overlayCanvas.remove();
      compactHudCanvas.remove();
      if (needsPosition) host.style.position = previousHostPosition;
    },
  };
}

/** @param {CanvasRenderingContext2D} context @param {string} label @param {number} x @param {number} y @param {number} size @param {string} fill @param {CanvasTextAlign} [align="left"] */
function drawFightLabel(context, label, x, y, size, fill, align = "left") {
  context.fillStyle = fill;
  context.font = `600 ${size}px "Space Grotesk", system-ui, sans-serif`;
  context.textAlign = align;
  context.textBaseline = "middle";
  context.fillText(label, x, y);
}

/** @param {number} value @param {number} maximum @returns {number} */
function readMeterFraction(value, maximum) {
  return Math.max(0, Math.min(1, (Number.isFinite(value) ? value : 0) / maximum));
}

/**
 * Render Fight HUD, slash/impact feedback and short synthesized sounds. Health,
 * guard, meter and hit counts always come from authority. This owns its overlay,
 * media-query subscription and audio context, all released by destroy().
 * @param {object} config
 * @param {HTMLCanvasElement | null} config.canvas
 * @param {{MAX_HEALTH: number, MAX_GUARD: number, MAX_SPECIAL: number, PARRY_WINDOW_SEC: number}} config.combat
 * @param {Readonly<Record<FightAttackType, {label: string}>>} config.attackDefinitions
 */
export function createFightCombatPresentation({ canvas, combat, attackDefinitions }) {
  const overlay = canvas ? createFightOverlayCanvas(canvas) : null;
  const context = overlay?.canvas.getContext("2d");
  const compactHudContext = overlay?.compactHudCanvas.getContext("2d");
  const combatEventFeed = createFightCombatEventFeed();
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reducedMotion = motionQuery.matches;
  let audioContext = null;
  let audioUnlocked = false;
  let destroyed = false;
  let inputMethod = "touch";
  let cameraImpulseUntilMs = 0;
  let cameraImpulseMagnitude = 0;
  let combatEventsInitialized = false;
  /** @type {(FightCombatEvent & {startedAtMs: number})[]} */
  const combatEffects = [];
  const healthTrails = {
    p1: { health: combat.MAX_HEALTH, targetHealth: combat.MAX_HEALTH, changedAtMs: 0 },
    p2: { health: combat.MAX_HEALTH, targetHealth: combat.MAX_HEALTH, changedAtMs: 0 },
  };
  const attackCueTracker = createFightAttackCueTracker();

  const updateReducedMotion = () => {
    reducedMotion = motionQuery.matches;
    if (reducedMotion) cameraImpulseUntilMs = 0;
  };
  motionQuery.addEventListener?.("change", updateReducedMotion);

  /** Audio is created only after an actual control interaction. */
  function unlockAudio() {
    if (destroyed) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    try {
      audioContext ??= new AudioContextClass();
      audioContext.resume()?.catch(() => {});
      audioUnlocked = true;
    } catch {
      audioUnlocked = false;
    }
  }

  /** @param {"swing" | FightCombatEvent["kind"]} kind @param {FightAttackType} [attackType] */
  function playCombatTone(kind, attackType) {
    if (!audioUnlocked || !audioContext || audioContext.state !== "running") return;
    const audioNow = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const isParry = kind === "parry";
    const isSwing = kind === "swing";
    const isSpecial = attackType === "special";
    const durationSec = isSwing ? 0.075 : isParry ? 0.16 : 0.10;

    oscillator.type = isParry ? "sine" : isSwing ? "triangle" : "square";
    oscillator.frequency.setValueAtTime(isParry ? 920 : isSwing ? (isSpecial ? 380 : 220) : 125, audioNow);
    oscillator.frequency.exponentialRampToValueAtTime(isParry ? 1380 : isSwing ? 90 : 45, audioNow + durationSec);
    gain.gain.setValueAtTime(0, audioNow);
    gain.gain.linearRampToValueAtTime(isSwing ? 0.022 : 0.035, audioNow + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.001, audioNow + durationSec);
    oscillator.connect(gain);
    gain.connect(audioContext.destination);
    oscillator.start(audioNow);
    oscillator.stop(audioNow + durationSec);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }

  /** @param {FightCombatEvent[] | undefined} combatEvents @param {number} nowMs */
  function recordCombatEvents(combatEvents, nowMs) {
    const unseenEvents = combatEventFeed.consume(combatEvents);
    if (!combatEventsInitialized) {
      combatEventsInitialized = true;
      return;
    }
    for (const combatEvent of unseenEvents) {
      combatEffects.push({ ...combatEvent, startedAtMs: nowMs });
      if (combatEffects.length > MAX_COMBAT_EFFECTS) combatEffects.shift();
      playCombatTone(combatEvent.kind, combatEvent.attackType);
      if (!reducedMotion) {
        cameraImpulseUntilMs = nowMs + 105;
        cameraImpulseMagnitude = combatEvent.attackType === "special" || combatEvent.kind === "guard-break" ? 5 :
          combatEvent.kind === "parry" || combatEvent.attackType === "heavy" ? 3.5 : 2;
      }
    }
  }

  /** @param {FightPlayerState} playerState @param {FightAnimationSample} animation @returns {string} */
  function readCombatStatus(playerState, animation) {
    if (playerState.dead) return "DOWN";
    if (playerState.guardBrokenTimer > 0) return "GUARD BROKEN";
    if (animation.stance === "stun") return "STAGGERED";
    if (animation.stance === "dash") return animation.clipId === "slide" ? "SLIDE" : "DODGE";
    if (animation.stance === "guard") return playerState.guardTimer <= combat.PARRY_WINDOW_SEC ? "PARRY WINDOW" : "GUARD";
    if (animation.attackType) return attackDefinitions[animation.attackType]?.label.toUpperCase() ?? "STRIKE";
    if (animation.stance === "crouch") return "LOW STANCE";
    return "";
  }

  /** @param {FightPlayerId} playerId @param {number} health @param {number} nowMs @param {number} deltaSec @returns {number} */
  function updateHealthTrail(playerId, health, nowMs, deltaSec) {
    const healthTrail = healthTrails[playerId];
    if (health !== healthTrail.targetHealth) {
      healthTrail.targetHealth = health;
      healthTrail.changedAtMs = nowMs;
    }
    if (reducedMotion || health >= healthTrail.health) {
      healthTrail.health = health;
    } else if (nowMs - healthTrail.changedAtMs > HEALTH_TRAIL_DELAY_MS) {
      healthTrail.health += (health - healthTrail.health) * (1 - Math.exp(-deltaSec * 7));
    }
    return healthTrail.health;
  }

  /** @param {FightPlayerId} playerId @param {FightPlayerState} playerState @param {FightAnimationSample} animation @param {FightPlayerId | null} localPlayerId @param {number} nowMs @param {number} deltaSec */
  function drawPlayerHud(playerId, playerState, animation, localPlayerId, nowMs, deltaSec) {
    const mirrored = playerId === "p2";
    const left = mirrored ? 738 : 38;
    const width = 504;
    const accent = mirrored ? FIGHT_PALETTE.cyan : FIGHT_PALETTE.gold;
    const align = mirrored ? "right" : "left";
    const outerX = mirrored ? left + width : left;
    const innerX = mirrored ? left : left + width;
    const nameSize = 24;
    const detailSize = 17;
    const trailHealth = updateHealthTrail(playerId, playerState.health, nowMs, deltaSec);

    drawFightLabel(context, `${playerId === localPlayerId ? "YOU · " : ""}${mirrored ? "KENJI" : "SAMURAI"}`, outerX, 36, nameSize, FIGHT_PALETTE.cream, align);
    drawFightLabel(context, `${Math.max(0, Math.ceil(playerState.health))} / ${combat.MAX_HEALTH}`, innerX, 36, detailSize, FIGHT_PALETTE.muted, mirrored ? "left" : "right");

    context.fillStyle = FIGHT_PALETTE.track;
    context.fillRect(left, 60, width, 25);
    const trailWidth = width * readMeterFraction(trailHealth, combat.MAX_HEALTH);
    context.fillStyle = FIGHT_PALETTE.warning;
    context.fillRect(mirrored ? left + width - trailWidth : left, 60, trailWidth, 25);
    const healthWidth = width * readMeterFraction(playerState.health, combat.MAX_HEALTH);
    context.fillStyle = accent;
    context.fillRect(mirrored ? left + width - healthWidth : left, 60, healthWidth, 25);
    context.fillStyle = "rgba(255,255,255,.25)";
    context.fillRect(mirrored ? left + width - healthWidth : left, 60, healthWidth, 3);

    context.fillStyle = FIGHT_PALETTE.track;
    context.fillRect(left, 95, width * 0.45, 7);
    context.fillStyle = playerState.guardBrokenTimer > 0 ? FIGHT_PALETTE.warning : FIGHT_PALETTE.muted;
    context.fillRect(left, 95, width * 0.45 * readMeterFraction(playerState.guardMeter, combat.MAX_GUARD), 7);
    drawFightLabel(context, "GUARD", left + width * 0.45 + 12, 99, 14, FIGHT_PALETTE.muted);

    context.fillStyle = FIGHT_PALETTE.track;
    context.fillRect(left, 118, width, 8);
    const specialFraction = readMeterFraction(playerState.specialMeter, combat.MAX_SPECIAL);
    context.fillStyle = specialFraction >= 1 ? FIGHT_PALETTE.cream : accent;
    context.fillRect(mirrored ? left + width * (1 - specialFraction) : left, 118, width * specialFraction, 8);
    drawFightLabel(context, specialFraction >= 1 ? "SPECIAL READY" : "SPECIAL", outerX, 146, detailSize, specialFraction >= 1 ? FIGHT_PALETTE.cream : FIGHT_PALETTE.muted, align);
    drawFightLabel(context, readCombatStatus(playerState, animation), innerX, 146, detailSize, accent, mirrored ? "left" : "right");

    if (playerState.comboHits > 1 && playerState.comboHitTimer > 0) {
      drawFightLabel(context, `${playerState.comboHits} HIT COMBO`, outerX, 198, 25, accent, align);
    }
  }

  /** @returns {void} Reset transforms after a resize and clear the host-sized HUD. */
  function clearCompactHud() {
    if (!compactHudContext || !overlay) return;
    const pixelRatio = overlay.getHudPixelRatio();
    const hudViewport = overlay.getHudViewport();
    compactHudContext.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    compactHudContext.clearRect(0, 0, hudViewport.width, hudViewport.height);
  }

  /**
   * Draw resources in CSS pixels so a narrow game view keeps readable text.
   * @param {{p1: FightPlayerState, p2: FightPlayerState}} players
   * @param {FightPlayerId | null} localPlayerId
   * @param {number} timer
   * @param {number} nowMs
   * @param {number} deltaSec
   */
  function drawCompactCombatHud(players, localPlayerId, timer, nowMs, deltaSec) {
    if (!compactHudContext) return;
    const hudLayout = overlay.getCompactHudLayout();
    if (!hudLayout) return;
    const { hud, legend } = hudLayout;
    const playerColumnWidth = (hud.width - 64) / 2;

    compactHudContext.save();
    compactHudContext.translate(hud.x, hud.y);
    compactHudContext.fillStyle = "rgba(9,19,23,.92)";
    compactHudContext.fillRect(0, 0, hud.width, hud.height);

    for (const playerId of ["p1", "p2"]) {
      const playerState = players[playerId];
      const mirrored = playerId === "p2";
      const left = mirrored ? hud.width - playerColumnWidth : 0;
      const accent = mirrored ? FIGHT_PALETTE.cyan : FIGHT_PALETTE.gold;
      const name = `${playerId === localPlayerId ? "YOU · " : ""}${mirrored ? "KENJI" : "SAMURAI"}`;
      const nameX = mirrored ? left + playerColumnWidth : left;
      const healthX = mirrored ? left : left + playerColumnWidth;
      drawFightLabel(compactHudContext, name, nameX, 7, 10.5, FIGHT_PALETTE.cream, mirrored ? "right" : "left");
      drawFightLabel(compactHudContext, String(Math.max(0, Math.ceil(playerState.health))), healthX, 7, 10, FIGHT_PALETTE.muted, mirrored ? "left" : "right");

      compactHudContext.fillStyle = FIGHT_PALETTE.track;
      compactHudContext.fillRect(left, 17, playerColumnWidth, 7);
      const trailWidth = playerColumnWidth * readMeterFraction(updateHealthTrail(playerId, playerState.health, nowMs, deltaSec), combat.MAX_HEALTH);
      compactHudContext.fillStyle = FIGHT_PALETTE.warning;
      compactHudContext.fillRect(mirrored ? left + playerColumnWidth - trailWidth : left, 17, trailWidth, 7);
      const healthWidth = playerColumnWidth * readMeterFraction(playerState.health, combat.MAX_HEALTH);
      compactHudContext.fillStyle = accent;
      compactHudContext.fillRect(mirrored ? left + playerColumnWidth - healthWidth : left, 17, healthWidth, 7);

      const resourceWidth = (playerColumnWidth - 8) / 2;
      const specialLeft = left + resourceWidth + 8;
      const specialReady = playerState.specialMeter >= combat.MAX_SPECIAL;
      drawFightLabel(compactHudContext, "GUARD", left, 34, 9.5, FIGHT_PALETTE.muted);
      drawFightLabel(compactHudContext, String(Math.ceil(playerState.guardMeter)), left + resourceWidth, 34, 9.5, FIGHT_PALETTE.muted, "right");
      drawFightLabel(compactHudContext, specialReady ? "READY" : "SPECIAL", specialLeft, 34, 9.5, specialReady ? FIGHT_PALETTE.cream : FIGHT_PALETTE.muted);
      if (!specialReady) drawFightLabel(compactHudContext, String(Math.floor(playerState.specialMeter)), specialLeft + resourceWidth, 34, 9.5, FIGHT_PALETTE.muted, "right");
      compactHudContext.fillStyle = FIGHT_PALETTE.track;
      compactHudContext.fillRect(left, 43, resourceWidth, 3);
      compactHudContext.fillRect(specialLeft, 43, resourceWidth, 3);
      compactHudContext.fillStyle = playerState.guardBrokenTimer > 0 ? FIGHT_PALETTE.warning : FIGHT_PALETTE.muted;
      compactHudContext.fillRect(left, 43, resourceWidth * readMeterFraction(playerState.guardMeter, combat.MAX_GUARD), 3);
      compactHudContext.fillStyle = specialReady ? FIGHT_PALETTE.cream : accent;
      compactHudContext.fillRect(specialLeft, 43, resourceWidth * readMeterFraction(playerState.specialMeter, combat.MAX_SPECIAL), 3);
    }
    drawFightLabel(compactHudContext, "DUEL", hud.width / 2, 5, 9, FIGHT_PALETTE.muted, "center");
    drawFightLabel(compactHudContext, String(Math.max(0, Math.ceil(timer))).padStart(2, "0"), hud.width / 2, 27, 25, timer <= 10 ? FIGHT_PALETTE.warning : FIGHT_PALETTE.cream, "center");
    compactHudContext.restore();

    compactHudContext.save();
    compactHudContext.translate(legend.x, legend.y);
    compactHudContext.fillStyle = "rgba(9,19,23,.92)";
    compactHudContext.fillRect(0, 0, legend.width, legend.height);
    const touchLabels = ["A LIGHT", "X HEAVY", "Y LAUNCH", "B GUARD"];
    for (let actionIndex = 0; actionIndex < touchLabels.length; actionIndex += 1) {
      drawFightLabel(compactHudContext, touchLabels[actionIndex], legend.width * (actionIndex + 0.5) / touchLabels.length, 10, 10.5, FIGHT_PALETTE.cream, "center");
    }
    drawFightLabel(compactHudContext, "↓ + X SWEEP  ·  B + Y SPECIAL", legend.width / 2, 27, 10, FIGHT_PALETTE.muted, "center");
    drawFightLabel(compactHudContext, "DOUBLE-TAP: DODGE  ·  ↓ + DOUBLE-TAP: SLIDE", legend.width / 2, 44, 10, FIGHT_PALETTE.muted, "center");
    compactHudContext.restore();
  }

  /** @param {FightPlayerState} playerState @param {FightAnimationSample} animation @param {{x: number, y: number}} playerPose */
  function drawFighterFeedback(playerState, animation, playerPose) {
    if (playerState.dead) return;
    const bodyY = playerPose.y - FIGHT_VISIBLE_BODY_OFFSET_Y;
    const facing = playerState.dir;
    context.save();
    if (animation.stance === "guard") {
      context.strokeStyle = FIGHT_PALETTE.cyan;
      context.lineWidth = 5;
      context.globalAlpha = 0.65;
      context.beginPath();
      context.ellipse(playerPose.x + facing * 38, bodyY + 20, 68, 94, 0, facing > 0 ? -1.1 : 2.04, facing > 0 ? 1.1 : 4.24);
      context.stroke();
    }
    if (animation.stance === "dash" && !reducedMotion) {
      context.strokeStyle = FIGHT_PALETTE.cream;
      context.globalAlpha = 0.35;
      context.lineWidth = 4;
      for (let streakIndex = 0; streakIndex < 3; streakIndex += 1) {
        context.beginPath();
        context.moveTo(playerPose.x - facing * (40 + streakIndex * 12), bodyY + streakIndex * 20);
        context.lineTo(playerPose.x - facing * (145 + streakIndex * 20), bodyY + streakIndex * 20);
        context.stroke();
      }
    }
    if (animation.phase === "active") {
      const isSpecial = animation.attackType === "special";
      const isHeavy = animation.attackType === "heavy" || animation.attackType === "finisher";
      context.strokeStyle = isSpecial ? FIGHT_PALETTE.cyan : FIGHT_PALETTE.cream;
      context.lineWidth = isSpecial ? 12 : isHeavy ? 9 : 5;
      context.globalAlpha = reducedMotion ? 0.35 : 0.78;
      context.beginPath();
      context.ellipse(playerPose.x + facing * 36, bodyY + 15, isSpecial ? 165 : 105, isHeavy ? 72 : 46, facing * -0.35, facing > 0 ? -1.3 : 1.85, facing > 0 ? 1.3 : 4.4);
      context.stroke();
    }
    context.restore();
  }

  /** @param {number} nowMs */
  function drawCombatEffects(nowMs) {
    for (let effectIndex = combatEffects.length - 1; effectIndex >= 0; effectIndex -= 1) {
      const combatEffect = combatEffects[effectIndex];
      const elapsedMs = nowMs - combatEffect.startedAtMs;
      if (elapsedMs > COMBAT_EFFECT_LIFETIME_MS) {
        combatEffects.splice(effectIndex, 1);
        continue;
      }
      const progress = elapsedMs / COMBAT_EFFECT_LIFETIME_MS;
      const effectColor = combatEffect.kind === "parry" || combatEffect.kind === "block" ? FIGHT_PALETTE.cyan :
        combatEffect.kind === "guard-break" ? FIGHT_PALETTE.warning : FIGHT_PALETTE.cream;
      const bodyY = combatEffect.y - FIGHT_VISIBLE_BODY_OFFSET_Y;
      context.save();
      context.globalAlpha = 1 - progress;
      context.strokeStyle = effectColor;
      context.lineWidth = combatEffect.kind === "parry" ? 5 : 3;

      if (progress < 0.5) {
        const sparkCount = reducedMotion ? 4 : 8;
        for (let sparkIndex = 0; sparkIndex < sparkCount; sparkIndex += 1) {
          const angle = sparkIndex * Math.PI * 2 / sparkCount + combatEffect.id * 0.7;
          const nearRadius = 8 + progress * 90;
          const farRadius = nearRadius + (reducedMotion ? 8 : 20) * (1 - progress);
          context.beginPath();
          context.moveTo(combatEffect.x + Math.cos(angle) * nearRadius, bodyY + Math.sin(angle) * nearRadius);
          context.lineTo(combatEffect.x + Math.cos(angle) * farRadius, bodyY + Math.sin(angle) * farRadius);
          context.stroke();
        }
      }
      const label = combatEffect.kind === "hit" ? `−${combatEffect.damage}` :
        combatEffect.kind === "guard-break" ? "GUARD BREAK" : combatEffect.kind.toUpperCase();
      drawFightLabel(context, label, Math.max(100, Math.min(1180, combatEffect.x)), bodyY - 62 - (reducedMotion ? 0 : progress * 40), combatEffect.kind === "hit" ? 34 : 28, effectColor, "center");
      context.restore();
    }
  }

  return {
    unlockAudio,
    recordCombatEvents,
    /** @param {"keyboard" | "touch"} nextInputMethod */
    setInputMethod(nextInputMethod) { inputMethod = nextInputMethod; },
    /** @param {string} errorMessage */
    renderRoomJoinError(errorMessage) {
      if (!context || destroyed) return;
      context.clearRect(0, 0, FIGHT_VIEW_WIDTH, FIGHT_VIEW_HEIGHT);
      clearCompactHud();
      if (overlay.getDisplayWidth() < 600 && compactHudContext) {
        const hudViewport = overlay.getHudViewport();
        compactHudContext.fillStyle = "rgba(8,18,22,.94)";
        compactHudContext.fillRect(0, 0, hudViewport.width, hudViewport.height);
        drawFightLabel(compactHudContext, "ROOM FULL", hudViewport.width / 2, hudViewport.height / 2 - 16, 22, FIGHT_PALETTE.cream, "center");
        drawFightLabel(compactHudContext, "Open Home to choose another match.", hudViewport.width / 2, hudViewport.height / 2 + 18, 11, FIGHT_PALETTE.muted, "center");
        return;
      }
      context.fillStyle = "rgba(8,18,22,.90)";
      context.fillRect(0, 0, FIGHT_VIEW_WIDTH, FIGHT_VIEW_HEIGHT);
      drawFightLabel(context, "ROOM FULL", 640, 320, 42, FIGHT_PALETTE.cream, "center");
      drawFightLabel(context, errorMessage, 640, 388, 27, FIGHT_PALETTE.muted, "center");
    },
    /** @param {number} nowMs @returns {{x: number, y: number}} */
    getCameraOffset(nowMs) {
      if (reducedMotion || nowMs >= cameraImpulseUntilMs) return { x: 0, y: 0 };
      const decay = (cameraImpulseUntilMs - nowMs) / 105;
      return { x: Math.sin(nowMs * 0.14) * cameraImpulseMagnitude * decay, y: Math.cos(nowMs * 0.18) * cameraImpulseMagnitude * decay * 0.55 };
    },
    /**
     * @param {object} frame
     * @param {{p1: FightPlayerState, p2: FightPlayerState}} frame.players
     * @param {{p1: FightPlayerState, p2: FightPlayerState}} frame.presentationPlayers Local copied prediction and remote authority.
     * @param {{p1: FightAnimationSample, p2: FightAnimationSample}} frame.animations
     * @param {{p1: {x: number, y: number}, p2: {x: number, y: number}}} frame.poses
     * @param {FightPlayerId | null} frame.localPlayerId
     * @param {number} frame.timer
     * @param {number} frame.nowMs
     * @param {number} frame.deltaSec
     */
    render({ players, presentationPlayers, animations, poses, localPlayerId, timer, nowMs, deltaSec }) {
      if (!context || destroyed) return;
      const compact = overlay.getDisplayWidth() < 600;
      const hudTopInset = overlay.getHudTopInset();
      context.clearRect(0, 0, FIGHT_VIEW_WIDTH, FIGHT_VIEW_HEIGHT);
      clearCompactHud();
      if (compact) {
        drawCompactCombatHud(players, localPlayerId, timer, nowMs, deltaSec);
      } else {
        const topShade = context.createLinearGradient(0, 0, 0, 200 + hudTopInset);
        topShade.addColorStop(0, "rgba(8,18,22,.94)");
        topShade.addColorStop(0.7, "rgba(8,18,22,.65)");
        topShade.addColorStop(1, "rgba(8,18,22,0)");
        context.fillStyle = topShade;
        context.fillRect(0, 0, FIGHT_VIEW_WIDTH, 200 + hudTopInset);

        context.save();
        context.translate(0, hudTopInset);
        drawPlayerHud("p1", players.p1, animations.p1, localPlayerId, nowMs, deltaSec);
        drawPlayerHud("p2", players.p2, animations.p2, localPlayerId, nowMs, deltaSec);
        drawFightLabel(context, "DUEL", 640, 31, 18, FIGHT_PALETTE.muted, "center");
        drawFightLabel(context, String(Math.max(0, Math.ceil(timer))).padStart(2, "0"), 640, 79, 57, timer <= 10 ? FIGHT_PALETTE.warning : FIGHT_PALETTE.cream, "center");
        context.restore();
      }

      for (const playerId of ["p1", "p2"]) {
        const animation = animations[playerId];
        const attackCue = attackCueTracker.consumeAttackCue(playerId, animation);
        if (attackCue) {
          playCombatTone("swing", attackCue);
        }
        drawFighterFeedback(presentationPlayers[playerId], animation, poses[playerId]);
      }
      drawCombatEffects(nowMs);

      if (compact) return;
      context.fillStyle = "rgba(9,19,23,.87)";
      context.fillRect(0, 636, FIGHT_VIEW_WIDTH, 84);
      context.fillStyle = "rgba(235,196,119,.18)";
      context.fillRect(38, 636, 1204, 1);
      drawFightLabel(context, inputMethod === "keyboard" ? "J / Z  LIGHT     K / X  HEAVY     U / Y  LAUNCH     L / C  GUARD" : "A  LIGHT     X HEAVY     Y  LAUNCH     B  HOLD GUARD", 640, 664, 21, FIGHT_PALETTE.cream, "center");
      drawFightLabel(context, inputMethod === "keyboard" ? "↓ + HEAVY  SWEEP  ·  I / V  SPECIAL  ·  SHIFT  DODGE  ·  ↓ + SHIFT  SLIDE" : "↓ + X  SWEEP  ·  B + Y  SPECIAL  ·  DOUBLE-TAP ← / →  DODGE  ·  ↓ + DOUBLE-TAP  SLIDE", 640, 698, 18, FIGHT_PALETTE.muted, "center");
    },
    reset() {
      combatEventFeed.reset();
      combatEventsInitialized = false;
      combatEffects.length = 0;
      attackCueTracker.reset();
      cameraImpulseUntilMs = 0;
      for (const healthTrail of Object.values(healthTrails)) {
        healthTrail.health = combat.MAX_HEALTH;
        healthTrail.targetHealth = combat.MAX_HEALTH;
        healthTrail.changedAtMs = 0;
      }
      context?.clearRect(0, 0, FIGHT_VIEW_WIDTH, FIGHT_VIEW_HEIGHT);
      clearCompactHud();
    },
    destroy() {
      destroyed = true;
      motionQuery.removeEventListener?.("change", updateReducedMotion);
      overlay?.destroy();
      audioContext?.close()?.catch(() => {});
      audioContext = null;
      combatEffects.length = 0;
    },
  };
}
