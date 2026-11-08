import { getGameDomRefs, getGameControls } from "/platform/frontend-engine/gameDom.js";
import { createPluggablePoseRuntime } from "/platform/frontend-engine/pluggablePoseRuntime.js";
import { getRuntimePerformanceProfile, subscribeRuntimePerformanceProfile } from "/platform/frontend-engine/performanceSettings.js";
import { openShareModal } from "/platform/frontend-engine/shareModalBridge.js";
import { hideEndGameModal, registerRematchHandler, showEndGameModal, updateEndGameModal } from "/platform/frontend-engine/endGameBridge.js";
import { DEAD_SHIFT_FIXED_DT_SEC, DEAD_SHIFT_GAME_ID } from "./shared/config.js";
import { createDeadShiftPlayer } from "./shared/simulation.js";
import { createDeadShiftRenderer } from "./rendering/renderer.js";
import { createDeadShiftControls } from "./client/controls.js";
import { createDeadShiftMultiplayerSession } from "./client/multiplayer.js";
import { createDeadShiftHud } from "./client/hud.js";
import { createDeadShiftAudio } from "./client/audio.js";
import { readDeadShiftEntityPosition } from "./client/snapshotPose.js";
import { isPlatformTouchControlsActive } from "/platform/frontend-engine/touchControlSurface.js";

const DISPOSE_GAME_EVENT = "kaboom:dispose-game";
const MAX_FRAME_SEC = 0.08;
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/** Assemble game presentation and adapt the existing platform lifecycle. */
function startDeadShift() {
  const { canvas } = getGameDomRefs();
  if (!canvas) throw new Error("Dead Shift requires the platform game canvas.");
  const host = canvas.parentElement;
  const previousCanvasStyles = canvas.getAttribute("style");
  canvas.style.cssText = "width:100%;height:100%;max-width:100%;max-height:100%;display:block;object-fit:contain;image-rendering:auto;touch-action:none;";

  const audio = createDeadShiftAudio();
  const renderer = createDeadShiftRenderer({ canvas });
  const controls = createDeadShiftControls({ canvas, onActivate: audio.unlock });
  const hud = createDeadShiftHud({
    host,
    onEnter: controls.activate,
    onSelectWeapon: controls.selectWeapon,
    onMute: audio.toggleMute,
  });
  const reducedMotionPreference = window.matchMedia(REDUCED_MOTION_QUERY);
  const initialQualityProfile = getRuntimePerformanceProfile();
  const fallbackPlayer = createDeadShiftPlayer("p1");
  let disposed = false;
  let animationFrameId = 0;
  let previousFrameAtMs = performance.now();
  let previousRenderAtMs = previousFrameAtMs;
  let presentationPose = null;
  let roundOver = false;
  let rematchPending = false;
  let presentedRoundId = null;
  let movementRuntime = null;

  function resetPresentation() {
    presentationPose = null;
    roundOver = false;
    rematchPending = false;
    movementRuntime?.reset();
    hideEndGameModal();
  }

  function presentRoundResults(snapshot, playerId) {
    if (!snapshot.gameOver || roundOver || !playerId) return;
    roundOver = true;
    controls.reset();
    if (document.pointerLockElement === canvas) document.exitPointerLock();
    const opponentId = playerId === "p1" ? "p2" : "p1";
    const ownKills = snapshot.players[playerId].kills;
    const rivalKills = snapshot.players[opponentId].kills;
    showEndGameModal({
      gameId: DEAD_SHIFT_GAME_ID,
      title: snapshot.winner === "tie" ? "Dead heat" : snapshot.winner === playerId ? "You survived the shift" : "Your rival takes the shift",
      subtitle: `${ownKills} ${ownKills === 1 ? "elimination" : "eliminations"} · Rival ${rivalKills}`,
      status: "90 seconds. One containment breach.",
      actionLabel: "Challenge again",
      phase: "ready",
      winner: snapshot.winner,
    });
  }

  const multiplayer = createDeadShiftMultiplayerSession({
    controls,
    onState: presentRoundResults,
    onReset: resetPresentation,
    onJoined: () => hud.clearError(),
    onError: (message, retry) => hud.showError(message, retry),
    onRematchRequested: () => updateEndGameModal({ actionLabel: "Accept rematch", status: "Your rival is ready for another shift.", phase: "ready" }),
  });
  movementRuntime = createPluggablePoseRuntime({
    fixedDtSec: DEAD_SHIFT_FIXED_DT_SEC,
    maxFrameSec: MAX_FRAME_SEC,
    maxFixedSteps: 5,
    targetRenderFps: initialQualityProfile.targetFps,
    samplePose: ({ nowMs, fixedDtSec }) => multiplayer.samplePose({ nowMs, deltaSec: fixedDtSec }),
    applyPose: (pose) => { presentationPose = pose; },
  });

  registerRematchHandler(() => {
    if (rematchPending) return;
    rematchPending = true;
    multiplayer.requestRematch();
    updateEndGameModal({ phase: "waiting", status: "Waiting for your rival…" });
  });
  const unsubscribeStartButton = getGameControls().menu.start.onPress(() => {
    controls.reset();
    openShareModal();
  });

  function resizeRenderer() {
    const { width, height } = host.getBoundingClientRect();
    if (width > 0 && height > 0) renderer.resize(width, height);
  }
  const resizeObserver = new ResizeObserver(resizeRenderer);
  resizeObserver.observe(host);
  renderer.setQuality(initialQualityProfile);
  const unsubscribeQuality = subscribeRuntimePerformanceProfile((profile) => {
    movementRuntime.setTargetRenderFps(profile.targetFps);
    renderer.setQuality(profile);
    resizeRenderer();
  });
  resizeRenderer();

  /** Render visual motion every frame while the SDK captures fixed-rate input. */
  function renderFrame(nowMs) {
    if (disposed) return;
    const frameDtSec = Math.max(0, Math.min(MAX_FRAME_SEC, (nowMs - previousFrameAtMs) / 1000));
    previousFrameAtMs = nowMs;
    controls.advance(frameDtSec);
    const runtimeStep = movementRuntime.step({ nowMs });
    if (!runtimeStep.rendered) {
      animationFrameId = requestAnimationFrame(renderFrame);
      return;
    }
    const dtSec = Math.max(0, Math.min(MAX_FRAME_SEC, (nowMs - previousRenderAtMs) / 1000));
    previousRenderAtMs = nowMs;
    const snapshot = multiplayer.getSnapshot();
    if (snapshot && snapshot.roundId !== presentedRoundId) {
      presentedRoundId = snapshot.roundId;
      audio.reset();
      hud.reset();
    }
    const playerId = multiplayer.getPlayerId() || "p1";
    const players = createPresentedPlayers(snapshot?.players, presentationPose);
    const localPlayer = players[playerId] || fallbackPlayer;
    const aim = controls.getAim();
    localPlayer.yaw = aim.yaw;
    localPlayer.pitch = aim.pitch;
    localPlayer.weapon = controls.getWeapon();
    const lastInput = multiplayer.getInput();
    const active = snapshot?.started && !snapshot.gameOver && snapshot.players.p1.connected && snapshot.players.p2.connected && localPlayer.health > 0;
    const input = {
      ...lastInput,
      ...aim,
      weapon: controls.getWeapon(),
      fire: Boolean(active && !controls.isBlocked() && lastInput.fire),
      aiming: Boolean(active && controls.isAiming()),
    };
    const moving = Boolean(active && (Math.abs(input.moveX) > 0.05 || Math.abs(input.moveZ) > 0.05));
    renderer.render({
      dtSec,
      timeSec: nowMs / 1000,
      playerId,
      roundId: snapshot?.roundId ?? null,
      localPlayer,
      players,
      enemies: createPresentedEntities(snapshot?.enemies, presentationPose, "e"),
      projectiles: createPresentedEntities(snapshot?.projectiles, presentationPose, "r"),
      events: snapshot?.events || [],
      input,
      moving,
      reducedMotion: reducedMotionPreference.matches,
    });
    audio.update({ snapshot, playerId, input, moving, timeSec: nowMs / 1000 });
    hud.update({
      snapshot,
      playerId,
      weapon: controls.getWeapon(),
      engaged: controls.isEngaged(),
      nowMs,
      pointerLocked: document.pointerLockElement === canvas,
      blocked: controls.isBlocked(),
      platformTouchActive: isPlatformTouchControlsActive(DEAD_SHIFT_GAME_ID),
    });
    animationFrameId = requestAnimationFrame(renderFrame);
  }

  function disposeGame() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(animationFrameId);
    window.removeEventListener(DISPOSE_GAME_EVENT, disposeGame);
    unsubscribeStartButton();
    unsubscribeQuality();
    resizeObserver.disconnect();
    registerRematchHandler(null);
    hideEndGameModal();
    controls.dispose();
    multiplayer.dispose();
    movementRuntime.destroy();
    audio.dispose();
    hud.dispose();
    renderer.dispose();
    if (previousCanvasStyles === null) canvas.removeAttribute("style");
    else canvas.setAttribute("style", previousCanvasStyles);
  }

  window.addEventListener(DISPOSE_GAME_EVENT, disposeGame);
  animationFrameId = requestAnimationFrame(renderFrame);
}

/** Copy authority before applying render-only positions; never mutate retained snapshots. */
function createPresentedPlayers(authoritativePlayers, pose) {
  if (!authoritativePlayers) return { p1: { ...createDeadShiftPlayer("p1"), connected: true }, p2: { ...createDeadShiftPlayer("p2"), connected: false } };
  const players = {};
  for (const playerId of ["p1", "p2"]) {
    const playerState = authoritativePlayers[playerId];
    players[playerId] = {
      ...playerState,
      x: pose?.[`${playerId}x`] ?? playerState.x,
      y: pose?.[`${playerId}y`] ?? playerState.y,
      z: pose?.[`${playerId}z`] ?? playerState.z,
    };
  }
  return players;
}

/** Bounded game pools use SDK interpolation only while their slot identity matches. */
function createPresentedEntities(authoritativeEntities, pose, prefix) {
  return (authoritativeEntities || []).map((entityState, index) => ({
    ...entityState,
    ...readDeadShiftEntityPosition(entityState, pose, `${prefix}${index}`),
  }));
}

startDeadShift();
