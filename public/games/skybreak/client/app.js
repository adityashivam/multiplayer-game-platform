import { getGameDomRefs, getGameControls } from "/platform/frontend-engine/gameDom.js";
import { createNetworkedGameRuntime } from "/platform/frontend-engine/networkedGameRuntime.js";
import { getRuntimePerformanceProfile, subscribeRuntimePerformanceProfile } from "/platform/frontend-engine/performanceSettings.js";
import { isPlatformTouchControlsActive } from "/platform/frontend-engine/touchControlSurface.js";
import { openShareModal } from "/platform/frontend-engine/shareModalBridge.js";
import { hideEndGameModal, registerRematchHandler, showEndGameModal, updateEndGameModal } from "/platform/frontend-engine/endGameBridge.js";
import {
  SKYBREAK_DOGFIGHT_BOT_IDS,
  SKYBREAK_DOGFIGHT_PLAYER_IDS,
  SKYBREAK_FIXED_DT_SEC,
  SKYBREAK_PRACTICE_BOT_IDS,
  SKYBREAK_PRACTICE_GAME_ID,
  SKYBREAK_PRACTICE_PLAYER_IDS,
  SKYBREAK_TIME_TRIAL_GAME_ID,
  SKYBREAK_TIME_TRIAL_PLAYER_IDS,
} from "../shared/config.js";
import { createSkybreakMatch } from "../shared/match.js";
import { createSkybreakRenderer } from "../rendering/renderer.js";
import { createSkybreakControls } from "./controls.js";
import { SKYBREAK_INTERPOLATION_DELAY_MS, createSkybreakMultiplayerSession } from "./multiplayer.js";
import { createSkybreakPresentedJets, listSkybreakSnapshotJets } from "./snapshotPose.js";
import { createSkybreakEventTracker } from "./matchEvents.js";
import { createSkybreakHud } from "./hud.js";
import { createSkybreakAudio } from "./audio.js";
import { createSkybreakGhost } from "./ghost.js";

const DISPOSE_GAME_EVENT = "kaboom:dispose-game";
const MAX_FRAME_SEC = 0.08;
const LOCK_WARNING_PROGRESS = 0.3;

/**
 * Where missiles are now in the same delayed timeline as interpolated rivals:
 * extrapolate from the latest snapshot, minus the interpolation delay.
 * @param {readonly {x:number,y:number,z:number,vx:number,vy:number,vz:number}[]} missiles
 * @param {number} ageSec Time since the snapshot arrived.
 * @param {{x:number,y:number,z:number,vx:number,vy:number,vz:number}[]} target Reused output.
 */
function placeSkybreakMissiles(missiles, ageSec, target) {
  const leadSec = Math.max(0, ageSec - SKYBREAK_INTERPOLATION_DELAY_MS / 1000);
  target.length = missiles.length;
  missiles.forEach((missile, index) => {
    const view = target[index] ?? (target[index] = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });
    view.x = missile.x + missile.vx * leadSec;
    view.y = missile.y + missile.vy * leadSec;
    view.z = missile.z + missile.vz * leadSec;
    view.vx = missile.vx;
    view.vy = missile.vy;
    view.vz = missile.vz;
  });
  return target;
}

/**
 * Assemble one Skybreak mode inside the platform host. Dogfight, practice
 * and time trial share every module; only the registered game ID differs.
 * @param {{gameId:string}} options
 * @throws {Error} When the platform canvas is missing.
 */
export function startSkybreak({ gameId }) {
  const { canvas } = getGameDomRefs();
  if (!canvas) throw new Error("Skybreak requires the platform game canvas.");
  const timeTrial = gameId === SKYBREAK_TIME_TRIAL_GAME_ID;
  const practice = gameId === SKYBREAK_PRACTICE_GAME_ID;
  const host = canvas.parentElement;
  const previousCanvasStyles = canvas.getAttribute("style");
  canvas.style.cssText = "width:100%;height:100%;max-width:100%;max-height:100%;display:block;object-fit:contain;image-rendering:auto;touch-action:none;";

  const fallbackMatch = timeTrial
    ? createSkybreakMatch({ mode: "timeTrial", playerIds: SKYBREAK_TIME_TRIAL_PLAYER_IDS })
    : createSkybreakMatch({ mode: "dogfight", playerIds: practice ? SKYBREAK_PRACTICE_PLAYER_IDS : SKYBREAK_DOGFIGHT_PLAYER_IDS, botIds: practice ? SKYBREAK_PRACTICE_BOT_IDS : SKYBREAK_DOGFIGHT_BOT_IDS });
  const audio = createSkybreakAudio();
  const renderer = createSkybreakRenderer({ canvas, showGates: timeTrial });
  const ghost = createSkybreakGhost();
  const eventTracker = createSkybreakEventTracker();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const initialQuality = getRuntimePerformanceProfile();
  const controls = createSkybreakControls({ canvas, gameId, onActivate: audio.unlock });
  const hud = createSkybreakHud({ host, mode: timeTrial ? "timeTrial" : "dogfight", practice, onEnter: controls.activate, onMute: audio.toggleMute });
  const missileViews = [];
  let presentationPose = null;
  let movementRuntime = null;
  let retainedSnapshot = null;
  let snapshotReceivedAtMs = 0;
  let resultsShown = false;
  let rematchPending = false;
  let rivalRequestedRematch = false;
  let newBestUntilMs = 0;
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
  function presentDogfightResults(snapshot, playerId) {
    if (!playerId || resultsShown) return;
    resultsShown = true;
    controls.reset();
    const jets = listSkybreakSnapshotJets(snapshot);
    const ranked = [...jets].sort((jetA, jetB) => jetB.kills - jetA.kills || jetA.deaths - jetB.deaths);
    const jet = jets.find((candidate) => candidate.id === playerId);
    const place = ranked.indexOf(jet) + 1;
    const won = snapshot.winner === playerId;
    showEndGameModal({
      gameId,
      title: won ? "Ace of the sky." : `Finished #${place} of ${jets.length}.`,
      subtitle: `${jet.kills} kills · ${jet.deaths} deaths`,
      status: rivalRequestedRematch ? "Your rival wants another sortie." : won ? "Defend the sky?" : "Manage your speed, lead your shots. Again?",
      actionLabel: rivalRequestedRematch ? "Accept rematch" : practice ? "Fly again" : "Rematch",
      phase: "ready",
      winner: snapshot.winner,
    });
  }

  const multiplayer = createSkybreakMultiplayerSession({
    gameId,
    controls,
    onReset: resetPresentation,
    onJoined: () => hud.clearError(),
    onError: (message, retry) => hud.showError(message, retry),
    onRematchRequested() {
      rivalRequestedRematch = true;
      updateEndGameModal({ actionLabel: "Accept rematch", status: "Your rival wants another sortie.", phase: "ready" });
    },
  });
  movementRuntime = createNetworkedGameRuntime({
    session: multiplayer,
    fixedDtSec: SKYBREAK_FIXED_DT_SEC,
    maxFrameSec: MAX_FRAME_SEC,
    maxFixedSteps: 5,
    targetRenderFps: initialQuality.targetFps,
    applyPose: (pose) => { presentationPose = pose; },
  });
  registerRematchHandler(() => {
    if (rematchPending) return;
    rematchPending = true;
    multiplayer.requestRematch();
    updateEndGameModal({ phase: "waiting", status: practice ? "Rearming…" : "Waiting for your rival…" });
  });
  const unsubscribeStart = getGameControls().menu.start.onPress(() => {
    if (controls.isBlocked() || practice || timeTrial) return;
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
      if (receivedSnapshot && receivedSnapshot !== retainedSnapshot) {
        retainedSnapshot = receivedSnapshot;
        snapshotReceivedAtMs = nowMs;
      }
      const snapshot = retainedSnapshot || fallbackMatch;
      const playerId = multiplayer.getPlayerId() || "p1";
      const jets = createSkybreakPresentedJets(snapshot, presentationPose, multiplayer.getLocalPresentation());
      const events = retainedSnapshot ? eventTracker.update(snapshot, jets) : [];
      const localJet = jets.find((jet) => jet.id === playerId);
      if (timeTrial && localJet) {
        ghost.record(localJet);
        for (const event of events) {
          if (event.kind === "runFinish" && event.jetId === playerId && ghost.finish(event.value)) newBestUntilMs = nowMs + 3000;
        }
      }
      const threat = localJet?.incomingMissile ? "incoming"
        : jets.some((jet) => jet.id !== playerId && jet.lockTargetId === playerId && jet.lockProgress > LOCK_WARNING_PROGRESS) ? "lock" : "none";
      const lockState = !localJet?.lockTargetId ? "none" : localJet.lockProgress >= 1 ? "locked" : "tracking";
      const localFiring = controls.isFiring();
      renderer.render({
        dtSec,
        timeSec: nowMs / 1000,
        playerId,
        jets,
        events,
        missiles: placeSkybreakMissiles(snapshot.missiles ?? [], (nowMs - snapshotReceivedAtMs) / 1000, missileViews),
        localFiring,
        nextGateIndex: timeTrial && localJet ? localJet.gateIndex : -1,
        ghost: timeTrial && localJet?.runActive ? ghost.sample(localJet.runTimeSec) : null,
        roundIdentity: String(snapshot.matchId),
        reducedMotion: reducedMotion.matches,
      });
      audio.update({ jet: localJet ?? null, firing: localFiring, lockState, threat, events, playerId, timeSec: nowMs / 1000 });
      hud.update({
        snapshot: retainedSnapshot,
        playerId,
        jets,
        events,
        project: renderer.project,
        threat,
        engaged: controls.isEngaged(),
        touchActive: isPlatformTouchControlsActive(gameId),
        nowMs,
        trial: { bestSec: ghost.getBestSec(), newBest: nowMs < newBestUntilMs },
      });
      if (receivedSnapshot?.gameOver && !timeTrial) presentDogfightResults(snapshot, multiplayer.getPlayerId());
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
