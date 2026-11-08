import { getGameControls, getGameDomRefs } from "/platform/frontend-engine/gameDom.js";
import { getGameSocket } from "/platform/frontend-engine/gameSocket.js";
import {
  hideEndGameModal,
  registerRematchHandler,
  showEndGameModal,
  updateEndGameModal,
} from "/platform/frontend-engine/endGameBridge.js";
import { openShareModal } from "/platform/frontend-engine/shareModalBridge.js";
import {
  getRuntimePerformanceProfile,
  subscribeRuntimePerformanceProfile,
} from "/platform/frontend-engine/performanceSettings.js";
import { createWorkerInterpolator } from "/platform/frontend-engine/interpolationWorker.js";
import { updateConnectionState } from "/platform/frontend-engine/connectionBridge.js";
import { createPluggablePoseRuntime } from "/platform/frontend-engine/pluggablePoseRuntime.js";
import { createInputLatch } from "/platform/frontend-engine/inputTimeline.js";
import { createNetworkedGameSession } from "/platform/frontend-engine/networkedGameSession.js";
import { INPUT_PROTOCOL, SOCKET_EVENT } from "/platform/shared/networkProtocol.js";
import {
  PONG_FIXED_DT_SEC,
  PONG_INPUT_TEMPLATE,
  PONG_PADDLE_SETTINGS,
  stepPongPaddle,
} from "/games/pong/shared/simulation.js";

/**
 * @typedef {import("./shared/simulation.js").PongPlayerState & {
 *   inputEpoch?: number, inputSeqAck?: number, inputSimulationTick?: number,
 *   score: number, connected: boolean
 * }} PongSnapshotPlayer
 */
/**
 * @typedef {object} PongSnapshot
 * @property {{p1: PongSnapshotPlayer, p2: PongSnapshotPlayer}} players
 * @property {{x: number, y: number}} ball
 * @property {1|2} [inputProtocol]
 * @property {boolean} gameOver
 * @property {boolean} started
 * @property {number|null} startAt
 * @property {"p1"|"p2"|null} winner
 * @property {"p1"|"p2"|null} lastLost
 */

const GAME_SLUG = "pong";
const ROOM_READY_EVENT = "kaboom:room-ready";
const DISPOSE_GAME_EVENT = "kaboom:dispose-game";
const WIDTH = 960;
const HEIGHT = PONG_PADDLE_SETTINGS.HEIGHT;
const PADDLE_W = 26;
const PADDLE_H = PONG_PADDLE_SETTINGS.PADDLE_HEIGHT;
const PADDLE_X1 = 70;
const PADDLE_X2 = WIDTH - 70;
const DIAGNOSTICS_REFRESH_MS = 120;
const paddleInputLatch = createInputLatch(PONG_INPUT_TEMPLATE);
let destroyPongNetworkSession = () => {};

/** Clear held controls when browser focus or room ownership changes. */
function resetPongControls() {
  paddleInputLatch.reset();
}

function resetHiddenPongControls() {
  if (document.hidden) resetPongControls();
}

window.addEventListener("blur", resetPongControls);
document.addEventListener("visibilitychange", resetHiddenPongControls);

function clampRuntimeRange(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizePerformanceProfile(rawProfile = {}) {
  const targetFps = clampRuntimeRange(rawProfile?.targetFps, 30, 60, 60);
  const resolutionScale = clampRuntimeRange(rawProfile?.resolutionScale, 0.6, 1, 1);
  return {
    targetFps,
    resolutionScale,
    reducedEffects: Boolean(rawProfile?.reducedEffects),
  };
}

const initialPerformanceProfile = normalizePerformanceProfile(getRuntimePerformanceProfile());

function extractPongPositions(state) {
  return {
    p1y: state.players.p1.y,
    p2y: state.players.p2.y,
    ballx: state.ball.x,
    bally: state.ball.y,
  };
}

// Use the in-app canvas so it stays inside the layout
const { canvas } = getGameDomRefs();
const { dpad, menu, actions } = getGameControls();
const gameCanvas = canvas;
let roomUrl = "";

// ---------- Kaboom init ----------
kaboom({
  width: WIDTH,
  height: HEIGHT,
  scale: 0.7,
  debug: false,
  global: true,
  maxFPS: initialPerformanceProfile.targetFps,
  pixelDensity: initialPerformanceProfile.resolutionScale,
  canvas: gameCanvas || undefined,
});

// Fit canvas into top-half layout (mobile-first)
if (gameCanvas) {
  gameCanvas.style.width = "100%";
  gameCanvas.style.maxWidth = "100%";
  gameCanvas.style.display = "block";
  gameCanvas.style.objectFit = "contain";
  gameCanvas.style.objectPosition = "center";
  gameCanvas.style.height = "auto";
  gameCanvas.style.maxHeight = "100%";
  gameCanvas.style.imageRendering =
    initialPerformanceProfile.resolutionScale < 0.9 ? "pixelated" : "auto";
}

function buildRoomUrl(roomId) {
  return `${window.location.origin}/games/${GAME_SLUG}/${roomId}`;
}

function setRoomLink(url) {
  roomUrl = url;
}

function announceRoomReady(roomId) {
  if (!roomId) return;
  window.dispatchEvent(
    new CustomEvent(ROOM_READY_EVENT, { detail: { gameId: GAME_SLUG, roomId } }),
  );
}

function getRoomIdFromPath() {
  const match = window.location.pathname.match(new RegExp(`/games/${GAME_SLUG}/([a-z0-9]+)`, "i"));
  return match && match[1] ? match[1] : null;
}

async function ensureRoomId() {
  const existing = getRoomIdFromPath();
  if (existing) {
    setRoomLink(buildRoomUrl(existing));
    announceRoomReady(existing);
    return existing;
  }
  try {
    const res = await fetch(`/api/games/${GAME_SLUG}/new-room`);
    if (!res.ok) throw new Error("Failed to create room");
    const data = await res.json();
    const roomId = data?.roomId || Math.random().toString(36).slice(2, 8);
    const url = data?.url || buildRoomUrl(roomId);
    window.history.replaceState({}, "", `/games/${GAME_SLUG}/${roomId}`);
    setRoomLink(url);
    announceRoomReady(roomId);
    return roomId;
  } catch (err) {
    const fallback = Math.random().toString(36).slice(2, 8);
    const url = buildRoomUrl(fallback);
    window.history.replaceState({}, "", `/games/${GAME_SLUG}/${fallback}`);
    setRoomLink(url);
    announceRoomReady(fallback);
    return fallback;
  }
}

let gameId = null;
let hasJoined = false;
/** @type {"p1"|"p2"|null} */
let myPlayerId = null;
let myRejoinToken = null;
let readyToPlay = false;
let lastConnected = { p1: false, p2: false };
let hasPlayedRound = false;

const socket = getGameSocket(GAME_SLUG);
let latestConnectionSnapshot = {
  status: socket.getConnectionState(),
  ping: socket.getPing(),
};
const unsubscribeConnection = socket.onConnectionChange((snapshot) => {
  latestConnectionSnapshot = { ...latestConnectionSnapshot, ...snapshot };
  updateConnectionState(snapshot);
});
let rematchPending = false;
let targetRenderFps = initialPerformanceProfile.targetFps;
let activePongRuntime = null;
const interpolator = createWorkerInterpolator({
  extractPositions: extractPongPositions,
  interpDelayMs: 36,
  maxBufferSize: 14,
});

function applyRuntimePerformanceProfile(nextProfile) {
  const profile = normalizePerformanceProfile(nextProfile);
  targetRenderFps = profile.targetFps;
  activePongRuntime?.setTargetRenderFps(targetRenderFps);
  if (typeof setPixelDensity === "function") {
    try {
      setPixelDensity(profile.resolutionScale);
    } catch {
      // Ignore runtime pixel density failures on unsupported kaboom builds.
    }
  }
  if (gameCanvas) {
    gameCanvas.style.imageRendering = profile.resolutionScale < 0.9 ? "pixelated" : "auto";
  }
}

applyRuntimePerformanceProfile(initialPerformanceProfile);
const unsubscribePerformanceProfile = subscribeRuntimePerformanceProfile(applyRuntimePerformanceProfile);

registerRematchHandler(() => {
  if (rematchPending) return;
  rematchPending = true;
  updateEndGameModal({
    status: "Waiting for opponent...",
    phase: "waiting",
  });
  socket.send("rematch");
});

function tryJoinGame() {
  if (!socket.isConnected() || !gameId || hasJoined) return;
  let token = myRejoinToken;
  if (!token) {
    try { token = sessionStorage.getItem(`rejoinToken:${GAME_SLUG}:${gameId}`); } catch (e) { /* noop */ }
  }
  socket.send("joinGame", { gameId, rejoinToken: token || undefined });
  hasJoined = true;
}

socket.onEvent("connect", () => {
  hasJoined = false;
  // Check if the URL room ID changed (e.g., back/forward navigation)
  const pathRoomId = getRoomIdFromPath();
  if (pathRoomId && gameId && pathRoomId !== gameId) {
    gameId = null;
    myRejoinToken = null;
  }
  if (gameId) {
    tryJoinGame();
  } else {
    ensureRoomId().then((id) => {
      gameId = id;
      tryJoinGame();
    });
  }
});

socket.onEvent("roomFull", () => {
  readyToPlay = false;
  paddleInputLatch.reset();
});

socket.onEvent("gameJoined", ({ playerId, gameId: joinedGameId, rejoinToken: token }) => {
  myPlayerId = playerId;
  myRejoinToken = token || null;
  readyToPlay = true;
  gameId = gameId || joinedGameId;
  if (token && gameId) {
    try { sessionStorage.setItem(`rejoinToken:${GAME_SLUG}:${gameId}`, token); } catch (e) { /* noop */ }
  }
  setRoomLink(buildRoomUrl(gameId));
  announceRoomReady(gameId);
  console.log("Joined game", gameId, "as", playerId);
});

socket.onEvent(SOCKET_EVENT.DISCONNECT, () => {
  readyToPlay = false;
});

socket.onEvent("rematchRequested", ({ playerId }) => {
  if (playerId === myPlayerId) return;
  updateEndGameModal({
    status: "Accept challenge.",
    actionLabel: "Accept Challenge",
    phase: "ready",
  });
});

ensureRoomId().then((id) => {
  gameId = id;
  tryJoinGame();
});

function handleDirectionalInput(direction, active) {
  // Map horizontal to vertical since Pong paddles move only up/down
  const mapped =
    direction === "up" || direction === "left"
      ? "up"
      : direction === "down" || direction === "right"
      ? "down"
      : null;
  if (!mapped) return;
  paddleInputLatch.set(mapped, active);
}

function handleActionInput(action) {
  switch (action) {
    case "start":
      if (roomUrl) {
        openShareModal();
      } else {
        ensureRoomId().finally(() => {
          openShareModal();
        });
      }
      break;
    case "b":
      break;
    case "a":
    case "x":
    case "y":
      break;
    default:
      break;
  }
}

function initControllerNavigation() {
  const cleanups = [];

  cleanups.push(dpad.left.onHold(
    () => handleDirectionalInput("left", true),
    () => handleDirectionalInput("left", false),
  ));
  cleanups.push(dpad.right.onHold(
    () => handleDirectionalInput("right", true),
    () => handleDirectionalInput("right", false),
  ));
  cleanups.push(dpad.up.onHold(
    () => handleDirectionalInput("up", true),
    () => handleDirectionalInput("up", false),
  ));
  cleanups.push(dpad.down.onHold(
    () => handleDirectionalInput("down", true),
    () => handleDirectionalInput("down", false),
  ));

  cleanups.push(actions.a.onPress(() => handleActionInput("a")));
  cleanups.push(actions.b.onPress(() => handleActionInput("b")));
  cleanups.push(actions.x.onPress(() => handleActionInput("x")));
  cleanups.push(actions.y.onPress(() => handleActionInput("y")));

  cleanups.push(menu.start.onPress(() => handleActionInput("start")));

  return () => {
    cleanups.forEach((cleanup) => {
      if (typeof cleanup === "function") cleanup();
    });
  };
}

// ---------- Scene ----------
scene("pong", () => {
  setGravity(0);
  destroyPongNetworkSession();
  resetPongControls();
  interpolator.reset();
  if (activePongRuntime) {
    activePongRuntime.destroy();
    activePongRuntime = null;
  }
  socket.offEvent("state");
  socket.offEvent("playerJoined");
  socket.offEvent("playerLeft");

  add([
    rect(WIDTH, HEIGHT),
    color(7, 10, 19),
    pos(0, 0),
    anchor("topleft"),
    fixed(),
  ]);

  // Net line
  const net = add([
    rect(4, HEIGHT),
    pos(WIDTH / 2, 0),
    color(80, 100, 160),
    opacity(0.5),
    anchor("top"),
  ]);
  net.use(lifespan(Infinity));

  const paddle1 = add([
    rect(PADDLE_W, PADDLE_H),
    pos(PADDLE_X1, HEIGHT / 2),
    anchor("center"),
    color(120, 200, 255),
    outline(4, rgb(40, 80, 140)),
  ]);

  const paddle2 = add([
    rect(PADDLE_W, PADDLE_H),
    pos(PADDLE_X2, HEIGHT / 2),
    anchor("center"),
    color(250, 170, 90),
    outline(4, rgb(150, 80, 40)),
  ]);

  const ball = add([
    circle(12),
    pos(WIDTH / 2, HEIGHT / 2),
    anchor("center"),
    color(240, 240, 255),
    outline(3, rgb(120, 130, 150)),
  ]);

  const scoreText = add([
    text("0   0", { size: 48 }),
    pos(WIDTH / 2, 40),
    anchor("center"),
    color(220, 230, 255),
  ]);

  const infoText = add([
    text("Waiting for players...", { size: 20 }),
    pos(WIDTH / 2, HEIGHT - 40),
    anchor("center"),
    color(180, 200, 240),
  ]);

  const startOverlay = add([
    rect(420, 140),
    color(0, 0, 0),
    opacity(0.65),
    anchor("center"),
    pos(WIDTH / 2, HEIGHT / 2),
    fixed(),
    z(1500),
  ]);
  const startMessage = startOverlay.add([
    text("Waiting for other player...", { size: 26 }),
    anchor("center"),
    pos(0, -12),
  ]);
  const countdownText = startOverlay.add([
    text("", { size: 32 }),
    anchor("center"),
    pos(0, 32),
  ]);

  const toast = add([
    rect(320, 60),
    color(20, 20, 20),
    opacity(0.85),
    pos(WIDTH / 2, 80),
    anchor("center"),
    fixed(),
    z(1600),
  ]);
  const toastText = toast.add([text("", { size: 20 }), anchor("center")]);
  toast.hidden = true;
  let toastTimer = null;
  let gameOverFlag = false;
  const networkSession = createNetworkedGameSession({
    socket,
    interpolator,
    prediction: {
      fixedDtSec: PONG_FIXED_DT_SEC,
      captureInput: () => paddleInputLatch.capture(),
      simulate: stepPongPaddle,
      extractPose: (paddleState) => ({ y: paddleState.y }),
    },
    readAuthority: (serverSnapshot) => {
      const localPlayer = serverSnapshot.players?.[myPlayerId];
      return localPlayer ? {
        state: localPlayer,
        protocol: serverSnapshot.inputProtocol ?? INPUT_PROTOCOL.LEGACY,
        inputEpoch: localPlayer.inputEpoch,
        acknowledgedSequence: localPlayer.inputSeqAck ?? 0,
        context: { simulationTick: localPlayer.inputSimulationTick },
      } : null;
    },
    canCaptureInput: (serverSnapshot) => readyToPlay && !document.hidden && !serverSnapshot.gameOver,
    composeRenderPose: (remotePose, localPose) => remotePose ? {
      ...remotePose,
      p1y: myPlayerId === "p1" && localPose ? localPose.y : remotePose.p1y,
      p2y: myPlayerId === "p2" && localPose ? localPose.y : remotePose.p2y,
    } : null,
    onReset: () => {
      resetPongControls();
      movementRuntime.reset();
    },
    onDiagnostics: updateConnectionState,
    diagnosticsIntervalMs: DIAGNOSTICS_REFRESH_MS,
  });

  const movementRuntime = createPluggablePoseRuntime({
    fixedDtSec: PONG_FIXED_DT_SEC,
    maxFrameSec: 0.08,
    maxFixedSteps: 10,
    targetRenderFps,
    samplePose: (runtimeContext) => networkSession.samplePose({
      nowMs: runtimeContext.nowMs,
      deltaSec: runtimeContext.fixedDtSec,
    }),
    applyPose: (pose) => {
      paddle1.pos.y = pose.p1y;
      paddle2.pos.y = pose.p2y;
      ball.pos.x = pose.ballx;
      ball.pos.y = pose.bally;
    },
  });
  activePongRuntime = movementRuntime;
  destroyPongNetworkSession = () => networkSession.destroy();
  networkSession.reset();

  function showToast(msg) {
    if (!toast) return;
    toast.hidden = false;
    toastText.text = msg;
    if (toastTimer) toastTimer.cancel();
    toastTimer = wait(1.6, () => {
      toast.hidden = true;
      toastTimer = null;
    });
  }

  function getResultLabel(winner) {
    if (!winner) return "Match complete.";
    if (!myPlayerId) {
      return winner === "p1" ? "Left player wins!" : "Right player wins!";
    }
    return winner === myPlayerId ? "You Win!" : "You Lose!";
  }

  function updateStartUI(started, startAt, connected, gameOver) {
    if (!startOverlay || !startMessage || !countdownText) return;
    const both = connected?.p1 && connected?.p2;

    if (gameOver) {
      startOverlay.hidden = true;
      countdownText.text = "";
      return;
    }

    if (started || hasPlayedRound) {
      startOverlay.hidden = true;
      countdownText.text = "";
      return;
    }

    startOverlay.hidden = false;
    if (!both) {
      startMessage.text = "Waiting for other player...";
      countdownText.text = "";
      return;
    }

    startMessage.text = "Get ready...";
    if (startAt) {
      const seconds = Math.max(0, Math.ceil((startAt - Date.now()) / 1000));
      countdownText.text = seconds > 0 ? `Starting in ${seconds}` : "Play!";
    } else {
      countdownText.text = "";
    }
  }

  socket.onEvent("playerLeft", ({ playerId }) => {
    showToast(`Player ${playerId === "p1" ? "1" : "2"} left the room`);
    rematchPending = false;
    hasPlayedRound = false;
    gameOverFlag = false;
    hideEndGameModal();
  });

  socket.onEvent("rematchStarted", () => {
    showToast("Rematch starting!");
    rematchPending = false;
    hasPlayedRound = false;
    gameOverFlag = false;
    hideEndGameModal();
  });

  socket.onEvent("state", (state) => {
    if (!state || !state.players || !state.ball) return;

    // Discrete updates use latest state immediately
    const { players, gameOver, winner, started, startAt, lastLost } = state;
    const connected = { p1: players.p1.connected, p2: players.p2.connected };

    if (connected.p1 !== lastConnected.p1 || connected.p2 !== lastConnected.p2) {
      if (connected.p1 && !lastConnected.p1 && connected.p2) {
        showToast("Player 1 connected");
      }
      if (connected.p2 && !lastConnected.p2 && connected.p1) {
        showToast("Player 2 connected");
      }
      lastConnected = connected;
    }

    scoreText.text = `${players.p1.score}   ${players.p2.score}`;
    infoText.text = `You are ${
      myPlayerId ? myPlayerId.toUpperCase() : "spectator"
    } • Move: D-pad • First to 10`;

    if (started) {
      hasPlayedRound = true;
    }

    updateStartUI(started, startAt, connected, gameOver);

    if (!gameOver && lastLost) {
      showToast(lastLost === "p1" ? "Left missed — point to Right" : "Right missed — point to Left");
    }

    if (gameOver && !gameOverFlag) {
      gameOverFlag = true;
      rematchPending = false;
      showEndGameModal({
        title: "Match Over",
        subtitle: getResultLabel(winner),
        status: "",
        phase: "ready",
        winner,
      });
    } else if (!gameOver && gameOverFlag) {
      gameOverFlag = false;
    }
  });

  // Per-frame interpolated position updates
  onUpdate(() => {
    movementRuntime.step({ nowMs: performance.now() });
  });
});

const cleanupControllerNavigation = initControllerNavigation();

let disposed = false;

function disposeGameRuntime() {
  if (disposed) return;
  disposed = true;

  cleanupControllerNavigation?.();
  destroyPongNetworkSession();
  resetPongControls();
  registerRematchHandler(null);
  hideEndGameModal();
  activePongRuntime?.destroy?.();
  activePongRuntime = null;
  interpolator.destroy?.();
  unsubscribeConnection?.();
  unsubscribePerformanceProfile?.();
  updateConnectionState({ status: "disconnected", ping: null });

  socket.offEvent("connect");
  socket.offEvent(SOCKET_EVENT.DISCONNECT);
  socket.offEvent("roomFull");
  socket.offEvent("gameJoined");
  socket.offEvent("rematchRequested");
  socket.offEvent("rematchStarted");
  socket.offEvent("playerJoined");
  socket.offEvent("playerLeft");
  socket.offEvent("state");
  socket.destroy?.();

  window.removeEventListener(DISPOSE_GAME_EVENT, handleDisposeEvent);
  window.removeEventListener("blur", resetPongControls);
  document.removeEventListener("visibilitychange", resetHiddenPongControls);
  if (typeof quit === "function") {
    try {
      quit();
    } catch (err) {
      // no-op
    }
  }
}

function handleDisposeEvent(event) {
  const targetGameId = event?.detail?.gameId;
  if (!targetGameId || targetGameId === GAME_SLUG) {
    disposeGameRuntime();
  }
}

window.addEventListener(DISPOSE_GAME_EVENT, handleDisposeEvent);

go("pong");
