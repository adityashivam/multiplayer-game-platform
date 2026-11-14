import { getGameDomRefs, getGameControls } from "/platform/frontend-engine/gameDom.js";
import { createNetworkedGameRuntime } from "/platform/frontend-engine/networkedGameRuntime.js";
import { getRuntimePerformanceProfile, subscribeRuntimePerformanceProfile } from "/platform/frontend-engine/performanceSettings.js";
import { isPlatformTouchControlsActive } from "/platform/frontend-engine/touchControlSurface.js";
import { openShareModal } from "/platform/frontend-engine/shareModalBridge.js";
import { hideEndGameModal, registerRematchHandler, showEndGameModal, updateEndGameModal } from "/platform/frontend-engine/endGameBridge.js";
import {
  LAST_FUSE_FIXED_DT_SEC,
  LAST_FUSE_ONLINE_BOT_IDS,
  LAST_FUSE_ONLINE_PLAYER_IDS,
  LAST_FUSE_PRACTICE_BOT_IDS,
  LAST_FUSE_PRACTICE_GAME_ID,
  LAST_FUSE_PRACTICE_PLAYER_IDS,
} from "../shared/config.js";
import { createLastFuseMatch, rankLastFuseRunners } from "../shared/match.js";
import { createLastFuseRenderer } from "../rendering/renderer.js";
import { createLastFuseControls } from "./controls.js";
import { getLastFuseSpawnHeading } from "./inputState.js";
import { createLastFuseMultiplayerSession } from "./multiplayer.js";
import { createLastFusePresentedRunners, listLastFuseSnapshotRunners } from "./snapshotPose.js";
import { createLastFuseEventTracker } from "./matchEvents.js";
import { createLastFuseHud } from "./hud.js";
import { nameLastFuseRunner } from "./runnerNames.js";
import { createLastFuseAudio } from "./audio.js";

const DISPOSE_GAME_EVENT = "kaboom:dispose-game";
const MAX_FRAME_SEC = 0.08;
const CAMERA_TURN_RAD = Math.PI / 4;
const NEAR_BOMB_M = 7;

/**
 * Assemble one Last Fuse mode inside the platform host. Online and practice
 * share every client module; only the registered game ID differs.
 * @param {{gameId:string}} options
 * @throws {Error} When the platform canvas is missing.
 */
export function startLastFuse({ gameId }) {
  const { canvas } = getGameDomRefs();
  if (!canvas) throw new Error("Last Fuse requires the platform game canvas.");
  const practice = gameId === LAST_FUSE_PRACTICE_GAME_ID;
  const host = canvas.parentElement;
  const previousCanvasStyles = canvas.getAttribute("style");
  canvas.style.cssText = "width:100%;height:100%;max-width:100%;max-height:100%;display:block;object-fit:contain;image-rendering:auto;touch-action:none;";

  const fallbackMatch = practice
    ? createLastFuseMatch({ playerIds: LAST_FUSE_PRACTICE_PLAYER_IDS, botIds: LAST_FUSE_PRACTICE_BOT_IDS })
    : createLastFuseMatch({ playerIds: LAST_FUSE_ONLINE_PLAYER_IDS, botIds: LAST_FUSE_ONLINE_BOT_IDS });
  const audio = createLastFuseAudio();
  const renderer = createLastFuseRenderer({ canvas });
  const eventTracker = createLastFuseEventTracker();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const initialQuality = getRuntimePerformanceProfile();
  let presentationPose = null;
  let movementRuntime = null;
  let retainedSnapshot = null;
  let headingIdentity = "";
  let resultsShown = false;
  let rematchPending = false;
  let rivalRequestedRematch = false;
  let disposed = false;
  let animationFrameId = 0;
  let previousFrameAtMs = performance.now();

  const controls = createLastFuseControls({
    canvas,
    gameId,
    getCameraHeading: renderer.getCameraHeading,
    onTurnCamera: (direction) => renderer.turnCamera(direction * CAMERA_TURN_RAD),
    onActivate: audio.unlock,
  });
  const hud = createLastFuseHud({ host, practice, onEnter: controls.activate, onMute: audio.toggleMute });

  function resetPresentation() {
    presentationPose = null;
    resultsShown = false;
    rematchPending = false;
    rivalRequestedRematch = false;
    headingIdentity = "";
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
    const runners = listLastFuseSnapshotRunners(snapshot);
    const ranked = rankLastFuseRunners(runners);
    const you = runners.find((runner) => runner.id === playerId);
    const place = ranked.indexOf(you) + 1;
    const won = snapshot.winner === playerId;
    const winner = ranked[0];
    showEndGameModal({
      gameId,
      title: won ? "Nobody could pin it on you." : `Finished #${place} of ${runners.length}.`,
      subtitle: `${you.points} points · ${you.roundWins} round win${you.roundWins === 1 ? "" : "s"} · ${you.passes} passes`,
      status: rivalRequestedRematch ? "Your rival wants another run."
        : won ? "Light another fuse?" : `${nameLastFuseRunner(winner, playerId)} took it with ${winner.points} points. Again?`,
      actionLabel: rivalRequestedRematch ? "Accept rematch" : practice ? "Run again" : "Rematch",
      phase: "ready",
      winner: snapshot.winner,
    });
  }

  const multiplayer = createLastFuseMultiplayerSession({
    gameId,
    controls,
    onReset: resetPresentation,
    onJoined: () => hud.clearError(),
    onError: (message, retry) => hud.showError(message, retry),
    onRematchRequested() {
      rivalRequestedRematch = true;
      updateEndGameModal({ actionLabel: "Accept rematch", status: "Your rival wants another run.", phase: "ready" });
    },
  });
  movementRuntime = createNetworkedGameRuntime({
    session: multiplayer,
    fixedDtSec: LAST_FUSE_FIXED_DT_SEC,
    maxFrameSec: MAX_FRAME_SEC,
    maxFixedSteps: 5,
    targetRenderFps: initialQuality.targetFps,
    applyPose: (pose) => { presentationPose = pose; },
  });
  registerRematchHandler(() => {
    if (rematchPending) return;
    rematchPending = true;
    multiplayer.requestRematch();
    updateEndGameModal({ phase: "waiting", status: practice ? "Building a new city…" : "Waiting for your rival…" });
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

  /**
   * Face the city centre from the spawn roof once per round and life.
   * @param {object} snapshot
   * @param {import("./snapshotPose.js").LastFusePresentedRunner|undefined} localRunner
   */
  function alignCameraToSpawn(snapshot, localRunner) {
    if (!localRunner) return;
    const identity = `${snapshot.matchId}:${snapshot.roundNumber}`;
    if (identity === headingIdentity) return;
    headingIdentity = identity;
    renderer.setCameraHeading(getLastFuseSpawnHeading(localRunner.x, localRunner.z));
  }

  function renderFrame(nowMs) {
    if (disposed) return;
    if (movementRuntime.step({ nowMs }).rendered) {
      const dtSec = Math.max(0, Math.min(MAX_FRAME_SEC, (nowMs - previousFrameAtMs) / 1000));
      previousFrameAtMs = nowMs;
      const receivedSnapshot = multiplayer.getSnapshot();
      if (receivedSnapshot) retainedSnapshot = receivedSnapshot;
      const snapshot = retainedSnapshot || fallbackMatch;
      const playerId = multiplayer.getPlayerId() || "p1";
      const runners = createLastFusePresentedRunners(snapshot, presentationPose, multiplayer.getLocalPresentation());
      const localRunner = runners.find((runner) => runner.id === playerId);
      alignCameraToSpawn(snapshot, localRunner);
      const events = retainedSnapshot ? eventTracker.update(snapshot, runners) : [];
      renderer.render({
        dtSec,
        timeSec: nowMs / 1000,
        playerId,
        runners,
        city: snapshot.city,
        bomb: snapshot.bomb,
        phase: snapshot.phase,
        events,
        reducedMotion: reducedMotion.matches,
      });
      const holder = snapshot.bomb.holderId ? runners.find((runner) => runner.id === snapshot.bomb.holderId) : null;
      audio.play(events, playerId);
      audio.updateFuse({
        active: snapshot.phase === "playing" && Boolean(holder),
        fuseSec: snapshot.bomb.fuseSec,
        near: Boolean(holder && localRunner && (holder === localRunner || Math.hypot(holder.x - localRunner.x, holder.z - localRunner.z) < NEAR_BOMB_M)),
      });
      hud.update({
        snapshot: retainedSnapshot,
        playerId,
        runners,
        events,
        project: renderer.project,
        heading: renderer.getViewHeading(),
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
