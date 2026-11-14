import { getGameDomRefs, getGameControls } from "/platform/frontend-engine/gameDom.js";
import { createNetworkedGameRuntime } from "/platform/frontend-engine/networkedGameRuntime.js";
import { getRuntimePerformanceProfile, subscribeRuntimePerformanceProfile } from "/platform/frontend-engine/performanceSettings.js";
import { isPlatformTouchControlsActive } from "/platform/frontend-engine/touchControlSurface.js";
import { openShareModal } from "/platform/frontend-engine/shareModalBridge.js";
import { hideEndGameModal, registerRematchHandler, showEndGameModal, updateEndGameModal } from "/platform/frontend-engine/endGameBridge.js";
import { EDGEOUT_DUEL_PLAYER_IDS, EDGEOUT_FIXED_DT_SEC, EDGEOUT_PRACTICE_BOT_IDS, EDGEOUT_PRACTICE_GAME_ID, EDGEOUT_PRACTICE_PLAYER_IDS } from "../shared/config.js";
import { createEdgeoutMatch } from "../shared/simulation.js";
import { createEdgeoutRenderer } from "../rendering/renderer.js";
import { createEdgeoutControls } from "./controls.js";
import { getEdgeoutSeatHeading } from "./inputState.js";
import { createEdgeoutMultiplayerSession } from "./multiplayer.js";
import { createEdgeoutPresentedFighters, listEdgeoutSnapshotFighters } from "./snapshotPose.js";
import { createEdgeoutEventTracker } from "./matchEvents.js";
import { createEdgeoutHud } from "./hud.js";
import { createEdgeoutAudio } from "./audio.js";

const DISPOSE_GAME_EVENT = "kaboom:dispose-game";
const MAX_FRAME_SEC = 0.08;

/**
 * Assemble one Edgeout mode inside the platform's stable host, without
 * browser mode changes. Duel and practice share every client module; only
 * the registered game ID (and so the room namespace) differs.
 * @param {{gameId:string}} options
 * @throws {Error} When the platform canvas is missing.
 */
export function startEdgeout({ gameId }) {
  const { canvas } = getGameDomRefs();
  if (!canvas) throw new Error("Edgeout requires the platform game canvas.");
  const practice = gameId === EDGEOUT_PRACTICE_GAME_ID;
  const host = canvas.parentElement;
  const previousCanvasStyles = canvas.getAttribute("style");
  canvas.style.cssText = "width:100%;height:100%;max-width:100%;max-height:100%;display:block;object-fit:contain;image-rendering:auto;touch-action:none;";

  const fallbackMatch = practice
    ? createEdgeoutMatch({ playerIds: EDGEOUT_PRACTICE_PLAYER_IDS, botIds: EDGEOUT_PRACTICE_BOT_IDS })
    : createEdgeoutMatch({ playerIds: EDGEOUT_DUEL_PLAYER_IDS });
  const audio = createEdgeoutAudio();
  const renderer = createEdgeoutRenderer({ canvas });
  const eventTracker = createEdgeoutEventTracker();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const initialQuality = getRuntimePerformanceProfile();
  /** @type {import("./snapshotPose.js").EdgeoutPresentedFighter[]} */
  let presentedFighters = [];
  let presentationPose = null;
  let movementRuntime = null;
  let retainedSnapshot = null;
  let resultsShown = false;
  let rematchPending = false;
  let rivalRequestedRematch = false;
  let disposed = false;
  let animationFrameId = 0;
  let previousFrameAtMs = performance.now();

  /** @param {object} snapshot @param {string} playerId */
  function getSeatHeading(snapshot, playerId) {
    const fighters = listEdgeoutSnapshotFighters(snapshot);
    const localFighter = fighters.find((fighter) => fighter.id === playerId);
    return getEdgeoutSeatHeading(localFighter?.slotIndex ?? 0, fighters.length);
  }

  const controls = createEdgeoutControls({
    canvas,
    gameId,
    getCameraHeading: renderer.getCameraHeading,
    projectPointerToGround: renderer.projectPointerToGround,
    getLocalFighterPosition() {
      const playerId = multiplayer?.getPlayerId();
      const localFighter = presentedFighters.find((fighter) => fighter.id === playerId);
      return localFighter ? { x: localFighter.x, z: localFighter.z } : null;
    },
    onActivate: audio.unlock,
  });
  const hud = createEdgeoutHud({ host, practice, onEnter: controls.activate, onMute: audio.toggleMute });

  function resetPresentation() {
    presentationPose = null;
    resultsShown = false;
    rematchPending = false;
    rivalRequestedRematch = false;
    eventTracker.reset();
    renderer.clearEffects();
    movementRuntime?.reset();
    hideEndGameModal();
  }

  /** @param {object} snapshot @param {string} playerId */
  function presentMatchResults(snapshot, playerId) {
    if (!playerId || resultsShown) return;
    resultsShown = true;
    controls.reset();
    const fighters = listEdgeoutSnapshotFighters(snapshot);
    const you = fighters.find((fighter) => fighter.id === playerId);
    const rival = fighters.find((fighter) => fighter.id !== playerId);
    const won = snapshot.winner === playerId;
    showEndGameModal({
      gameId,
      title: won ? "Last one standing." : "Knocked off the edge.",
      subtitle: `Rounds ${you.roundWins} — ${rival.roundWins} · Series ${you.seriesWins} — ${rival.seriesWins}`,
      status: rivalRequestedRematch ? "Your rival is ready for another match."
        : practice ? (won ? "The CPU wants a rematch." : "Learn the timing and run it back.")
        : won ? "Ready to defend the arena?" : "Read their shove. Parry. Run it back?",
      actionLabel: rivalRequestedRematch ? "Accept rematch" : practice ? "Spar again" : "Run it back",
      phase: "ready",
      winner: snapshot.winner,
    });
  }

  const multiplayer = createEdgeoutMultiplayerSession({
    gameId,
    controls,
    onState(snapshot) {
      retainedSnapshot = snapshot;
    },
    onReset: resetPresentation,
    onJoined: () => hud.clearError(),
    onError: (message, retry) => hud.showError(message, retry),
    onRematchRequested() {
      rivalRequestedRematch = true;
      updateEndGameModal({ actionLabel: "Accept rematch", status: "Your rival is ready for another match.", phase: "ready" });
    },
  });
  movementRuntime = createNetworkedGameRuntime({
    session: multiplayer,
    fixedDtSec: EDGEOUT_FIXED_DT_SEC,
    maxFrameSec: MAX_FRAME_SEC,
    maxFixedSteps: 5,
    targetRenderFps: initialQuality.targetFps,
    applyPose: (pose) => { presentationPose = pose; },
  });
  registerRematchHandler(() => {
    if (rematchPending) return;
    rematchPending = true;
    multiplayer.requestRematch();
    updateEndGameModal({ phase: "waiting", status: practice ? "Resetting the arena…" : "Waiting for your rival…" });
  });
  const unsubscribeStart = getGameControls().menu.start.onPress(() => {
    if (controls.isBlocked() || practice) return;
    controls.reset();
    openShareModal();
  });

  function resizeRenderer() {
    const { width, height } = host.getBoundingClientRect();
    if (width > 0 && height > 0) renderer.resize(width, height);
  }
  renderer.setQuality(initialQuality);
  const resizeObserver = new ResizeObserver(resizeRenderer);
  resizeObserver.observe(host);
  const unsubscribeQuality = subscribeRuntimePerformanceProfile((profile) => {
    movementRuntime.setTargetRenderFps(profile.targetFps);
    renderer.setQuality(profile);
    resizeRenderer();
  });
  resizeRenderer();

  function renderFrame(nowMs) {
    if (disposed) return;
    if (movementRuntime.step({ nowMs }).rendered) {
      const dtSec = Math.max(0, Math.min(MAX_FRAME_SEC, (nowMs - previousFrameAtMs) / 1000));
      previousFrameAtMs = nowMs;
      const receivedSnapshot = multiplayer.getSnapshot();
      if (receivedSnapshot) retainedSnapshot = receivedSnapshot;
      const snapshot = receivedSnapshot || retainedSnapshot || fallbackMatch;
      const playerId = multiplayer.getPlayerId() || "p1";
      const seatHeading = getSeatHeading(snapshot, playerId);
      renderer.setCameraHeading(seatHeading);
      presentedFighters = createEdgeoutPresentedFighters(snapshot, presentationPose, multiplayer.getLocalPresentation());
      const events = receivedSnapshot || retainedSnapshot ? eventTracker.update(snapshot, presentedFighters) : [];
      renderer.render({
        dtSec,
        timeSec: nowMs / 1000,
        playerId,
        cameraHeading: seatHeading,
        fighters: presentedFighters,
        arena: snapshot.arena,
        roundIdentity: `${snapshot.matchId}:${snapshot.roundNumber}`,
        events,
        reducedMotion: reducedMotion.matches,
      });
      audio.play(events);
      hud.update({
        snapshot: receivedSnapshot || retainedSnapshot,
        playerId,
        fighters: presentedFighters,
        events,
        engaged: controls.isEngaged(),
        nowMs,
        touchActive: isPlatformTouchControlsActive(gameId),
      });
      if (receivedSnapshot?.gameOver) presentMatchResults(snapshot, multiplayer.getPlayerId());
    }
    animationFrameId = requestAnimationFrame(renderFrame);
  }

  function disposeGame() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(animationFrameId);
    window.removeEventListener(DISPOSE_GAME_EVENT, disposeGame);
    unsubscribeStart();
    unsubscribeQuality();
    resizeObserver.disconnect();
    registerRematchHandler(null);
    hideEndGameModal();
    controls.dispose();
    multiplayer.dispose();
    movementRuntime.destroy();
    hud.dispose();
    audio.dispose();
    renderer.dispose();
    if (previousCanvasStyles === null) canvas.removeAttribute("style");
    else canvas.setAttribute("style", previousCanvasStyles);
  }

  window.addEventListener(DISPOSE_GAME_EVENT, disposeGame);
  animationFrameId = requestAnimationFrame(renderFrame);
}
