import { getGameDomRefs, getGameControls } from "/platform/frontend-engine/gameDom.js";
import { createNetworkedGameRuntime } from "/platform/frontend-engine/networkedGameRuntime.js";
import { getRuntimePerformanceProfile, subscribeRuntimePerformanceProfile } from "/platform/frontend-engine/performanceSettings.js";
import { isPlatformTouchControlsActive } from "/platform/frontend-engine/touchControlSurface.js";
import { openShareModal } from "/platform/frontend-engine/shareModalBridge.js";
import { hideEndGameModal, registerRematchHandler, showEndGameModal, updateEndGameModal } from "/platform/frontend-engine/endGameBridge.js";
import {
  DRIFTLINE_FIXED_DT_SEC,
  DRIFTLINE_PRACTICE_BOT_IDS,
  DRIFTLINE_PRACTICE_GAME_ID,
  DRIFTLINE_PRACTICE_PLAYER_IDS,
  DRIFTLINE_RACE_BOT_IDS,
  DRIFTLINE_RACE_PLAYER_IDS,
} from "../shared/config.js";
import { createDriftlineRace } from "../shared/race.js";
import { getDriftlineTrack } from "../shared/tracks/index.js";
import { createDriftlineRenderer } from "../rendering/renderer.js";
import { createDriftlineControls } from "./controls.js";
import { createDriftlineMultiplayerSession } from "./multiplayer.js";
import { createDriftlinePresentedCars, listDriftlineSnapshotCars } from "./snapshotPose.js";
import { createDriftlineEventTracker } from "./raceEvents.js";
import { createDriftlineHud } from "./hud.js";
import { createDriftlineAudio } from "./audio.js";

const DISPOSE_GAME_EVENT = "kaboom:dispose-game";
const MAX_FRAME_SEC = 0.08;

/** @param {number} seconds */
function formatResultTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${(seconds - minutes * 60).toFixed(2).padStart(5, "0")}`;
}

/**
 * Assemble one Driftline mode inside the platform's stable host. Race and
 * practice share every client module; only the registered game ID differs.
 * @param {{gameId:string}} options
 * @throws {Error} When the platform canvas is missing.
 */
export function startDriftline({ gameId }) {
  const { canvas } = getGameDomRefs();
  if (!canvas) throw new Error("Driftline requires the platform game canvas.");
  const practice = gameId === DRIFTLINE_PRACTICE_GAME_ID;
  const host = canvas.parentElement;
  const previousCanvasStyles = canvas.getAttribute("style");
  canvas.style.cssText = "width:100%;height:100%;max-width:100%;max-height:100%;display:block;object-fit:contain;image-rendering:auto;touch-action:none;";

  const fallbackRace = practice
    ? createDriftlineRace({ playerIds: DRIFTLINE_PRACTICE_PLAYER_IDS, botIds: DRIFTLINE_PRACTICE_BOT_IDS })
    : createDriftlineRace({ playerIds: DRIFTLINE_RACE_PLAYER_IDS, botIds: DRIFTLINE_RACE_BOT_IDS });
  const track = getDriftlineTrack(fallbackRace.trackId);
  const audio = createDriftlineAudio();
  const renderer = createDriftlineRenderer({ canvas, track });
  const eventTracker = createDriftlineEventTracker();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const initialQuality = getRuntimePerformanceProfile();
  const controls = createDriftlineControls({ canvas, gameId, onActivate: audio.unlock });
  const hud = createDriftlineHud({ host, practice, track, onEnter: controls.activate, onMute: audio.toggleMute });
  let presentationPose = null;
  let movementRuntime = null;
  let retainedSnapshot = null;
  let resultsShown = false;
  let rematchPending = false;
  let rivalRequestedRematch = false;
  let disposed = false;
  let animationFrameId = 0;
  let previousFrameAtMs = performance.now();

  function resetPresentation() {
    presentationPose = null;
    resultsShown = false;
    rematchPending = false;
    rivalRequestedRematch = false;
    eventTracker.reset();
    movementRuntime?.reset();
    hideEndGameModal();
  }

  /** @param {object} snapshot @param {string} playerId */
  function presentRaceResults(snapshot, playerId) {
    if (!playerId || resultsShown) return;
    resultsShown = true;
    controls.reset();
    const cars = listDriftlineSnapshotCars(snapshot);
    const car = cars.find((candidate) => candidate.id === playerId);
    const won = snapshot.winner === playerId;
    const timeText = car.finished ? formatResultTime(car.finishTimeSec) : "DNF";
    const bestText = car.bestLapSec > 0 ? formatResultTime(car.bestLapSec) : "—";
    showEndGameModal({
      gameId,
      title: won ? "Checkered flag. You win." : `Finished P${car.position} of ${cars.length}.`,
      subtitle: `Race ${timeText} · Best lap ${bestText}`,
      status: rivalRequestedRematch ? "Your rival wants another race." : won ? "Defend the line?" : "Find the faster line. Run it back?",
      actionLabel: rivalRequestedRematch ? "Accept rematch" : practice ? "Race again" : "Rematch",
      phase: "ready",
      winner: snapshot.winner,
    });
  }

  const multiplayer = createDriftlineMultiplayerSession({
    gameId,
    controls,
    onReset: resetPresentation,
    onJoined: () => hud.clearError(),
    onError: (message, retry) => hud.showError(message, retry),
    onRematchRequested() {
      rivalRequestedRematch = true;
      updateEndGameModal({ actionLabel: "Accept rematch", status: "Your rival wants another race.", phase: "ready" });
    },
  });
  movementRuntime = createNetworkedGameRuntime({
    session: multiplayer,
    fixedDtSec: DRIFTLINE_FIXED_DT_SEC,
    maxFrameSec: MAX_FRAME_SEC,
    maxFixedSteps: 5,
    targetRenderFps: initialQuality.targetFps,
    applyPose: (pose) => { presentationPose = pose; },
  });
  registerRematchHandler(() => {
    if (rematchPending) return;
    rematchPending = true;
    multiplayer.requestRematch();
    updateEndGameModal({ phase: "waiting", status: practice ? "Resetting the grid…" : "Waiting for your rival…" });
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
      const snapshot = receivedSnapshot || retainedSnapshot || fallbackRace;
      const playerId = multiplayer.getPlayerId() || "p1";
      const cars = createDriftlinePresentedCars(snapshot, presentationPose, multiplayer.getLocalPresentation());
      const events = receivedSnapshot || retainedSnapshot ? eventTracker.update(snapshot, cars) : [];
      renderer.render({
        dtSec,
        timeSec: nowMs / 1000,
        playerId,
        cars,
        events,
        roundIdentity: String(snapshot.matchId),
        reducedMotion: reducedMotion.matches,
      });
      audio.update(cars.find((car) => car.id === playerId) ?? null, events);
      hud.update({
        snapshot: receivedSnapshot || retainedSnapshot,
        playerId,
        cars,
        events,
        engaged: controls.isEngaged(),
        nowMs,
        touchActive: isPlatformTouchControlsActive(gameId),
      });
      if (receivedSnapshot?.gameOver) presentRaceResults(snapshot, multiplayer.getPlayerId());
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
