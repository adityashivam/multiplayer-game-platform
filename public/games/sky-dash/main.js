import { getGameDomRefs, getGameControls } from "/platform/frontend-engine/gameDom.js";
import { createPluggablePoseRuntime } from "/platform/frontend-engine/pluggablePoseRuntime.js";
import { getRuntimePerformanceProfile, subscribeRuntimePerformanceProfile } from "/platform/frontend-engine/performanceSettings.js";
import { isPlatformTouchControlsActive } from "/platform/frontend-engine/touchControlSurface.js";
import { openShareModal } from "/platform/frontend-engine/shareModalBridge.js";
import { hideEndGameModal, registerRematchHandler, showEndGameModal, updateEndGameModal } from "/platform/frontend-engine/endGameBridge.js";
import { SKY_DASH_FIXED_DT_SEC, SKY_DASH_GAME_ID } from "./shared/config.js";
import { createSkyDashRound } from "./shared/simulation.js";
import { createSkyDashRenderer } from "./rendering/renderer.js";
import { createSkyDashControls } from "./client/controls.js";
import { createSkyDashMultiplayerSession } from "./client/multiplayer.js";
import { createSkyDashPresentedRunners, createSkyDashPresentedSeesaws } from "./client/snapshotPose.js";
import { createSkyDashHud } from "./client/hud.js";
import { createSkyDashAudio } from "./client/audio.js";

const DISPOSE_GAME_EVENT = "kaboom:dispose-game";
const MAX_FRAME_SEC = 0.08;

/** Assemble game-owned presentation within the platform's stable host surface. */
function startSkyDash() {
  const { canvas } = getGameDomRefs();
  if (!canvas) throw new Error("Sky Dash requires the platform game canvas.");
  const host = canvas.parentElement;
  const previousCanvasStyles = canvas.getAttribute("style");
  canvas.style.cssText = "width:100%;height:100%;max-width:100%;max-height:100%;display:block;object-fit:contain;image-rendering:auto;touch-action:none;";

  const audio = createSkyDashAudio();
  const renderer = createSkyDashRenderer({ canvas });
  const controls = createSkyDashControls({ canvas, onActivate: audio.unlock });
  const hud = createSkyDashHud({ host, onEnter: controls.activate, onMute: audio.toggleMute });
  const fallbackRound = createSkyDashRound();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const initialQuality = getRuntimePerformanceProfile();
  let disposed = false;
  let animationFrameId = 0;
  let previousFrameAtMs = performance.now();
  let previousRenderAtMs = previousFrameAtMs;
  let presentationPose = null;
  let movementRuntime = null;
  let presentedRoundId = null;
  let retainedSnapshot = null;
  let resultsShown = false;
  let rematchPending = false;

  function resetPresentation() {
    presentationPose = null;
    resultsShown = false;
    rematchPending = false;
    movementRuntime?.reset();
    hideEndGameModal();
  }

  function presentRaceResults(snapshot, playerId) {
    if (!snapshot.gameOver || !playerId || resultsShown) return;
    resultsShown = true;
    controls.reset();
    const runners = [...Object.values(snapshot.players), ...snapshot.bots].sort((first, second) => first.rank - second.rank);
    const runner = snapshot.players[playerId];
    const champion = runners.find((actor) => actor.id === snapshot.winner);
    const finishDetail = runner.finished ? `Finished in ${runner.finishTimeSec.toFixed(2)}s` : `${runner.checkpoint} checkpoints reached`;
    showEndGameModal({
      gameId: SKY_DASH_GAME_ID,
      title: snapshot.winner === playerId ? "A sky-high victory" : "What a race!",
      subtitle: `You placed ${runner.rank} of ${runners.length} · ${finishDetail}`,
      status: champion ? `${champion.id === playerId ? "You take" : `${champion.name} takes`} the crown. Ready for another run?` : "Ready for another run?",
      actionLabel: "Race again",
      phase: "ready",
      winner: snapshot.winner,
    });
  }

  const multiplayer = createSkyDashMultiplayerSession({
    controls,
    onState: presentRaceResults,
    onReset: resetPresentation,
    onJoined: () => hud.clearError(),
    onError: (message, retry) => hud.showError(message, retry),
    onRematchRequested: () => updateEndGameModal({ actionLabel: "Accept rematch", status: "Your rival is ready for another race.", phase: "ready" }),
  });
  movementRuntime = createPluggablePoseRuntime({
    fixedDtSec: SKY_DASH_FIXED_DT_SEC,
    maxFrameSec: MAX_FRAME_SEC,
    maxFixedSteps: 5,
    targetRenderFps: initialQuality.targetFps,
    samplePose: ({ nowMs, fixedDtSec }) => multiplayer.samplePose({ nowMs, deltaSec: fixedDtSec }),
    applyPose: (pose) => { presentationPose = pose; },
  });
  registerRematchHandler(() => {
    if (rematchPending) return;
    rematchPending = true;
    multiplayer.requestRematch();
    updateEndGameModal({ phase: "waiting", status: "Waiting for your rival…" });
  });
  const unsubscribeStart = getGameControls().menu.start.onPress(() => {
    if (controls.isBlocked()) return;
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
    const frameDtSec = Math.max(0, Math.min(MAX_FRAME_SEC, (nowMs - previousFrameAtMs) / 1000));
    previousFrameAtMs = nowMs;
    controls.advance(frameDtSec);
    const runtimeStep = movementRuntime.step({ nowMs });
    if (runtimeStep.rendered) {
      const dtSec = Math.max(0, Math.min(MAX_FRAME_SEC, (nowMs - previousRenderAtMs) / 1000));
      previousRenderAtMs = nowMs;
      const receivedSnapshot = multiplayer.getSnapshot();
      if (receivedSnapshot) retainedSnapshot = receivedSnapshot;
      // Transport ownership can reset before its next snapshot. Keep the last
      // scene visible instead of returning the camera/course to the launch pad.
      const snapshot = receivedSnapshot || retainedSnapshot;
      const playerId = multiplayer.getPlayerId() || "p1";
      if (snapshot && snapshot.roundId !== presentedRoundId) {
        presentedRoundId = snapshot.roundId;
        audio.reset();
      }
      const runners = createSkyDashPresentedRunners(snapshot || fallbackRound, presentationPose);
      const localRunner = runners.find((runner) => runner.id === playerId);
      renderer.render({
        dtSec, timeSec: nowMs / 1000,
        courseTimeSec: snapshot?.started ? presentationPose?.courseTimeSec ?? snapshot.timeSec : snapshot?.timeSec ?? 0,
        roundId: snapshot?.roundId ?? 0,
        playerId, runners,
        seesaws: createSkyDashPresentedSeesaws(snapshot || fallbackRound, presentationPose),
        reducedMotion: reducedMotion.matches,
        cameraOrbit: controls.getCameraOrbit(),
      });
      audio.update(localRunner);
      hud.update({ snapshot, playerId, engaged: controls.isEngaged(), nowMs, touchActive: isPlatformTouchControlsActive(SKY_DASH_GAME_ID) });
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

startSkyDash();
