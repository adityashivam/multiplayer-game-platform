import { getGameDomRefs, getGameControls } from "/platform/frontend-engine/gameDom.js";
import { createNetworkedGameRuntime } from "/platform/frontend-engine/networkedGameRuntime.js";
import { getRuntimePerformanceProfile, subscribeRuntimePerformanceProfile } from "/platform/frontend-engine/performanceSettings.js";
import { isPlatformTouchControlsActive } from "/platform/frontend-engine/touchControlSurface.js";
import { openShareModal } from "/platform/frontend-engine/shareModalBridge.js";
import { hideEndGameModal, registerRematchHandler, showEndGameModal, updateEndGameModal } from "/platform/frontend-engine/endGameBridge.js";
import {
  BUMPER_LINKS_FIXED_DT_SEC,
  BUMPER_LINKS_MATCH_SETTINGS,
  BUMPER_LINKS_ONLINE_BOT_IDS,
  BUMPER_LINKS_ONLINE_PLAYER_IDS,
  BUMPER_LINKS_PRACTICE_BOT_IDS,
  BUMPER_LINKS_PRACTICE_GAME_ID,
  BUMPER_LINKS_PRACTICE_PLAYER_IDS,
  BUMPER_LINKS_SOLVER_SETTINGS,
} from "../shared/config.js";
import { createBumperLinksCourse } from "../shared/course.js";
import { createBumperLinksMatch, rankBumperLinksBalls } from "../shared/match.js";
import { findBumperLinksPathPointAhead } from "../shared/solver.js";
import { createBumperLinksRenderer } from "../rendering/renderer.js";
import { createBumperLinksControls } from "./controls.js";
import { predictBumperLinksAimLine } from "./aim.js";
import { createBumperLinksMultiplayerSession } from "./multiplayer.js";
import {
  createBumperLinksPresentedBalls,
  getBumperLinksPresentedHoleTime,
  listBumperLinksSnapshotBalls,
} from "./snapshotPose.js";
import { createBumperLinksEventTracker } from "./matchEvents.js";
import { createBumperLinksHud } from "./hud.js";
import { nameBumperLinksBall } from "./ballNames.js";
import { createBumperLinksAudio } from "./audio.js";

const DISPOSE_GAME_EVENT = "kaboom:dispose-game";
const MAX_FRAME_SEC = 0.08;
/** The aim line previews this power until the player starts charging. */
const PREVIEW_POWER = 0.35;

/**
 * Assemble one Bumper Links mode inside the platform host. Online and
 * practice share every client module; only the registered game ID differs.
 * @param {{gameId:string}} options
 * @throws {Error} When the platform canvas is missing.
 */
export function startBumperLinks({ gameId }) {
  const { canvas } = getGameDomRefs();
  if (!canvas) throw new Error("Bumper Links requires the platform game canvas.");
  const practice = gameId === BUMPER_LINKS_PRACTICE_GAME_ID;
  const host = canvas.parentElement;
  const previousCanvasStyles = canvas.getAttribute("style");
  canvas.style.cssText = "width:100%;height:100%;max-width:100%;max-height:100%;display:block;object-fit:contain;image-rendering:auto;touch-action:none;";

  const fallbackMatch = practice
    ? createBumperLinksMatch({ playerIds: BUMPER_LINKS_PRACTICE_PLAYER_IDS, botIds: BUMPER_LINKS_PRACTICE_BOT_IDS })
    : createBumperLinksMatch({ playerIds: BUMPER_LINKS_ONLINE_PLAYER_IDS, botIds: BUMPER_LINKS_ONLINE_BOT_IDS });
  const audio = createBumperLinksAudio();
  const renderer = createBumperLinksRenderer({ canvas });
  const eventTracker = createBumperLinksEventTracker();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const initialQuality = getRuntimePerformanceProfile();
  /** @type {import("./aim.js").BumperLinksAimPoint[]} */
  const aimPoints = [];
  let course = fallbackMatch.course;
  let presentationPose = null;
  let movementRuntime = null;
  let retainedSnapshot = null;
  let aimIdentity = "";
  let headingHole = -1;
  let resultsShown = false;
  let rematchPending = false;
  let rivalRequestedRematch = false;
  let disposed = false;
  let animationFrameId = 0;
  let previousFrameAtMs = performance.now();

  const controls = createBumperLinksControls({
    canvas,
    gameId,
    getCameraHeading: renderer.getCameraHeading,
    onActivate: audio.unlock,
  });
  const hud = createBumperLinksHud({ host, practice, onEnter: controls.activate, onMute: audio.toggleMute });

  function resetPresentation() {
    presentationPose = null;
    resultsShown = false;
    rematchPending = false;
    rivalRequestedRematch = false;
    aimIdentity = "";
    headingHole = -1;
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
    const balls = listBumperLinksSnapshotBalls(snapshot);
    const ranked = rankBumperLinksBalls(balls);
    const you = balls.find((ball) => ball.id === playerId);
    const place = ranked.indexOf(you) + 1;
    const won = snapshot.winner === playerId;
    const winner = ranked[0];
    showEndGameModal({
      gameId,
      title: won ? "Champion of the links." : `Finished #${place} of ${balls.length}.`,
      subtitle: `${you.points} points · ${you.totalStrokes} strokes · ${you.knockouts} knockout${you.knockouts === 1 ? "" : "s"}`,
      status: rivalRequestedRematch ? "Your rival wants another round."
        : won ? "Play another six?" : `${nameBumperLinksBall(winner, playerId)} won with ${winner.points} points. Again?`,
      actionLabel: rivalRequestedRematch ? "Accept rematch" : practice ? "Play again" : "Rematch",
      phase: "ready",
      winner: snapshot.winner,
    });
  }

  const multiplayer = createBumperLinksMultiplayerSession({
    gameId,
    controls,
    onReset: resetPresentation,
    onJoined: () => hud.clearError(),
    onError: (message, retry) => hud.showError(message, retry),
    onRematchRequested() {
      rivalRequestedRematch = true;
      updateEndGameModal({ actionLabel: "Accept rematch", status: "Your rival wants another round.", phase: "ready" });
    },
  });
  movementRuntime = createNetworkedGameRuntime({
    session: multiplayer,
    fixedDtSec: BUMPER_LINKS_FIXED_DT_SEC,
    maxFrameSec: MAX_FRAME_SEC,
    maxFixedSteps: 5,
    targetRenderFps: initialQuality.targetFps,
    applyPose: (pose) => { presentationPose = pose; },
  });
  registerRematchHandler(() => {
    if (rematchPending) return;
    rematchPending = true;
    multiplayer.requestRematch();
    updateEndGameModal({ phase: "waiting", status: practice ? "Building six new holes…" : "Waiting for your rival…" });
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

  /** @param {object} snapshot */
  function resolveBumperLinksCourse(snapshot) {
    if (course.seed !== snapshot.holeSeed) course = createBumperLinksCourse(snapshot.holeSeed);
    return course;
  }

  /**
   * Point the aim down the course each time the local ball comes to a new
   * rest, and face the tee's heading at the start of every hole.
   * @param {object} snapshot @param {object} authorityBall @param {boolean} ready
   */
  function alignBumperLinksAim(snapshot, authorityBall, ready) {
    if (snapshot.holeSerial !== headingHole) {
      headingHole = snapshot.holeSerial;
      renderer.snapHeading(course.teeYaw);
    }
    if (!ready) return;
    const identity = `${snapshot.matchId}:${snapshot.holeSerial}:${authorityBall.shotId}:${authorityBall.lifeId}`;
    if (identity === aimIdentity) return;
    aimIdentity = identity;
    const target = findBumperLinksPathPointAhead(course, authorityBall.x, authorityBall.z, BUMPER_LINKS_SOLVER_SETTINGS.lookAheadM);
    controls.setAimYaw(Math.atan2(target.x - authorityBall.x, target.z - authorityBall.z));
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
      const holeCourse = resolveBumperLinksCourse(snapshot);
      const balls = createBumperLinksPresentedBalls(snapshot, presentationPose);
      const authorityBall = snapshot.players?.[playerId];
      const ready = Boolean(retainedSnapshot && authorityBall && snapshot.started && snapshot.phase === "playing" &&
        authorityBall.atRest && !authorityBall.sunk && authorityBall.strokes < BUMPER_LINKS_MATCH_SETTINGS.maxStrokes);
      if (authorityBall) alignBumperLinksAim(snapshot, authorityBall, ready);
      const aimView = controls.update(dtSec, ready);
      if (ready && !controls.isDragging()) renderer.setTargetHeading(aimView.aimYaw);

      let aim = null;
      if (ready) {
        const power = aimView.power > 0 ? aimView.power : PREVIEW_POWER;
        const count = predictBumperLinksAimLine(holeCourse, authorityBall, aimView.aimYaw, power, aimPoints);
        aim = { points: aimPoints, count, power: aimView.power };
      }
      const events = retainedSnapshot ? eventTracker.update(snapshot) : [];
      renderer.render({
        dtSec,
        timeSec: nowMs / 1000,
        playerId,
        course: holeCourse,
        balls,
        holeTimeSec: getBumperLinksPresentedHoleTime(snapshot, presentationPose),
        phase: snapshot.phase,
        events,
        ready,
        aim,
        reducedMotion: reducedMotion.matches,
      });
      audio.play(events, playerId);
      hud.update({
        snapshot: retainedSnapshot,
        course: holeCourse,
        playerId,
        balls,
        events,
        power: aimView.power,
        ready,
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
