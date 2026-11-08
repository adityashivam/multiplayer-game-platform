import { getGameDomRefs, getGameControls } from "/platform/frontend-engine/gameDom.js";
import { createNetworkedGameRuntime } from "/platform/frontend-engine/networkedGameRuntime.js";
import { getRuntimePerformanceProfile, subscribeRuntimePerformanceProfile } from "/platform/frontend-engine/performanceSettings.js";
import { isPlatformTouchControlsActive } from "/platform/frontend-engine/touchControlSurface.js";
import { openShareModal } from "/platform/frontend-engine/shareModalBridge.js";
import { hideEndGameModal, registerRematchHandler, showEndGameModal, updateEndGameModal } from "/platform/frontend-engine/endGameBridge.js";
import { RIFTBALL_FIXED_DT_SEC, RIFTBALL_GAME_ID } from "./shared/config.js";
import { createRiftballRound } from "./shared/simulation.js";
import { createRiftballRenderer } from "./rendering/renderer.js";
import { createRiftballControls } from "./client/controls.js";
import { createRiftballMultiplayerSession } from "./client/multiplayer.js";
import { createRiftballPresentedPlayers, createRiftballPresentedBall } from "./client/snapshotPose.js";
import { createRiftballHud } from "./client/hud.js";
import { createRiftballAudio } from "./client/audio.js";
import { createRiftballReplayBuffer } from "./client/replay.js";

const DISPOSE_GAME_EVENT = "kaboom:dispose-game";
const MAX_FRAME_SEC = 0.08;

/** Assemble the game inside the platform's stable host, without browser mode changes. */
function startRiftball() {
  const { canvas } = getGameDomRefs();
  if (!canvas) throw new Error("Riftball requires the platform game canvas.");
  const host = canvas.parentElement;
  const previousCanvasStyles = canvas.getAttribute("style");
  canvas.style.cssText = "width:100%;height:100%;max-width:100%;max-height:100%;display:block;object-fit:contain;image-rendering:auto;touch-action:none;";

  const audio = createRiftballAudio();
  const renderer = createRiftballRenderer({ canvas });
  const replay = createRiftballReplayBuffer();
  const controls = createRiftballControls({ canvas, getCameraHeading: renderer.getCameraHeading, onActivate: audio.unlock });
  const hud = createRiftballHud({ host, onEnter: controls.activate, onMute: audio.toggleMute, onSkipReplay: replay.skip });
  const fallbackRound = createRiftballRound();
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
  let endingRoundId = null;
  let rematchPending = false;
  let rivalRequestedRematch = false;
  let lastPresentedGoalSerial = 0;

  function resetPresentation() {
    presentationPose = null;
    resultsShown = false;
    endingRoundId = null;
    rematchPending = false;
    rivalRequestedRematch = false;
    replay.clear();
    controls.setReplayBlocked(false);
    hud.setReplay(false);
    movementRuntime?.reset();
    hideEndGameModal();
  }

  function presentMatchResults(snapshot, playerId) {
    if (!playerId || resultsShown) return;
    resultsShown = true;
    controls.reset();
    const player = snapshot.players[playerId];
    const rival = Object.values(snapshot.players).find((athlete) => athlete.id !== playerId);
    const won = snapshot.winner === playerId;
    showEndGameModal({
      gameId: RIFTBALL_GAME_ID,
      title: won ? "Your court. Your victory." : "The next point is yours.",
      subtitle: `${player.score} — ${rival.score} · Series ${player.seriesWins} — ${rival.seriesWins}`,
      status: rivalRequestedRematch ? "Your rival is ready for another match." : won ? "The winning angle. Ready to defend your court?" : "A new match, a new angle. Ready to run it back?",
      actionLabel: rivalRequestedRematch ? "Accept rematch" : "Run it back",
      phase: "ready",
      winner: snapshot.winner,
    });
  }

  const multiplayer = createRiftballMultiplayerSession({
    controls,
    onState(snapshot, playerId) {
      retainedSnapshot = snapshot;
      if (playerId) controls.setPlayerId(playerId);
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
    fixedDtSec: RIFTBALL_FIXED_DT_SEC,
    maxFrameSec: MAX_FRAME_SEC,
    maxFixedSteps: 5,
    targetRenderFps: initialQuality.targetFps,
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
    if (movementRuntime.step({ nowMs }).rendered) {
      const dtSec = Math.max(0, Math.min(MAX_FRAME_SEC, (nowMs - previousRenderAtMs) / 1000));
      previousRenderAtMs = nowMs;
      const receivedSnapshot = multiplayer.getSnapshot();
      if (receivedSnapshot) retainedSnapshot = receivedSnapshot;
      const snapshot = receivedSnapshot || retainedSnapshot || fallbackRound;
      const playerId = multiplayer.getPlayerId() || "p1";
      controls.setPlayerId(playerId);
      if (snapshot.roundId !== presentedRoundId) {
        presentedRoundId = snapshot.roundId;
        replay.clear();
        audio.reset();
        lastPresentedGoalSerial = snapshot.goalSerial;
      }
      const players = createRiftballPresentedPlayers(snapshot, presentationPose, multiplayer.getLocalPresentation());
      const ball = createRiftballPresentedBall(snapshot, presentationPose);
      const frame = {
        dtSec, timeSec: nowMs / 1000, gameTimeSec: presentationPose?.gameTimeSec ?? snapshot.timeSec,
        roundId: snapshot.roundId, playerId, players, ball,
        phase: snapshot.phase, goalSerial: snapshot.goalSerial, lastScorer: snapshot.lastScorer,
        reducedMotion: reducedMotion.matches, cameraOrbit: controls.getCameraOrbit(), replay: false,
      };
      if (snapshot.started && !snapshot.gameOver) replay.record(frame);
      if (receivedSnapshot?.gameOver && endingRoundId !== snapshot.roundId) {
        endingRoundId = snapshot.roundId;
        // Only replay a recent scoring finish. Timeout victories keep their
        // honest outcome instead of presenting an unrelated earlier goal.
        if (snapshot.goalSerial > lastPresentedGoalSerial && snapshot.lastScorer === snapshot.winner && replay.getStats().durationSec > 0.3) {
          replay.record({
            ...frame,
            players: Object.values(snapshot.players).map((player) => ({ ...player, index: player.slotIndex })),
            ball: { ...snapshot.ball },
          }, { forceSample: true });
          replay.start(nowMs / 1000);
        }
      }
      const replayFrame = replay.sample(nowMs / 1000);
      controls.setReplayBlocked(Boolean(replayFrame));
      hud.setReplay(Boolean(replayFrame));
      renderer.render(replayFrame ? { ...replayFrame, dtSec, reducedMotion: reducedMotion.matches } : frame);
      const localPlayer = players.find((athlete) => athlete.id === playerId);
      audio.update({ snapshot, player: localPlayer, ball });
      hud.update({ snapshot: receivedSnapshot || retainedSnapshot, playerId, players, engaged: controls.isEngaged(), nowMs, touchActive: isPlatformTouchControlsActive(RIFTBALL_GAME_ID) });
      if (receivedSnapshot?.gameOver && !replayFrame) presentMatchResults(snapshot, multiplayer.getPlayerId());
      lastPresentedGoalSerial = snapshot.goalSerial;
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
    replay.clear();
    hud.dispose();
    audio.dispose();
    renderer.dispose();
    if (previousCanvasStyles === null) canvas.removeAttribute("style");
    else canvas.setAttribute("style", previousCanvasStyles);
  }

  window.addEventListener(DISPOSE_GAME_EVENT, disposeGame);
  animationFrameId = requestAnimationFrame(renderFrame);
}

startRiftball();
