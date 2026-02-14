import { getGameControls, getGameDomRefs } from "/platform/shared/gameDom.js";
import { getGameSocket } from "/platform/shared/gameSocket.js";
import {
  hideEndGameModal,
  registerRematchHandler,
  showEndGameModal,
  updateEndGameModal,
} from "/platform/shared/endGameBridge.js";
import { openShareModal } from "/platform/shared/shareModalBridge.js";
import { createWorkerInterpolator } from "/platform/shared/interpolationWorker.js";
import { updateConnectionState } from "/platform/shared/connectionBridge.js";

// ---------- Kaboom init ----------
const { canvas } = getGameDomRefs();
const { dpad, menu, actions } = getGameControls();
let roomUrl = "";
kaboom({
  width: 1280,
  height: 720,
  scale: 0.7,
  debug: false,
  global: true,
  canvas: canvas || undefined,
});

// Fit canvas into portrait-first layout (top half of screen)
const gameCanvas = canvas;
if (gameCanvas) {
  gameCanvas.style.width = "100%";
  gameCanvas.style.maxWidth = "100%";
  gameCanvas.style.display = "block";
  gameCanvas.style.objectFit = "contain";
  gameCanvas.style.objectPosition = "center";
  gameCanvas.style.height = "auto";
  gameCanvas.style.maxHeight = "100%";
}

// ---------- Multiplayer setup ----------
const GAME_SLUG = "fight";
const ASSET_BASE = `/games/${GAME_SLUG}/assets`;
const OPPONENT_JOIN_EVENT = "kaboom:opponent-joined";
const ROOM_READY_EVENT = "kaboom:room-ready";
const DISPOSE_GAME_EVENT = "kaboom:dispose-game";
const NET_STATS_REFRESH_MS = 150;
const SERVER_TICK_MS = 1000 / 60;
const PREDICT_MOVE_SPEED = 500;
const PREDICT_JUMP_SPEED = -1300;
const PREDICT_GRAVITY = 1600;
const PREDICT_WORLD_MIN_X = 100;
const PREDICT_WORLD_MAX_X = 1180;
const PREDICT_GROUND_Y = 870;
const LOCAL_NET_HUD_ENABLED = false;
let shareModalShown = false;
let toggleNetworkDiagnostics = () => {};
let cleanupNetworkDiagnostics = () => {};
let resetFightNetcodeState = () => {};

const localInputState = {
  left: false,
  right: false,
  jump: false,
  attack: false,
  heavyAttack: false,
  aerialAttack: false,
};

function extractFightPositions(state) {
  return {
    p1x: state.players.p1.x,
    p1y: state.players.p1.y,
    p2x: state.players.p2.x,
    p2y: state.players.p2.y,
  };
}

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function toFiniteNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function resetLocalInputState() {
  Object.keys(localInputState).forEach((key) => {
    localInputState[key] = false;
  });
}

function createNetworkEstimator({ expectedTickMs = SERVER_TICK_MS, maxSamples = 180 } = {}) {
  let prevArrivalMs = null;
  let prevSeq = null;
  let prevTransitMs = null;
  let intervalEwmaMs = expectedTickMs;
  let jitterMs = 0;
  let totalExpected = 0;
  let totalReceived = 0;
  let outOfOrderCount = 0;
  const lossWindow = [];
  const recentArrivals = [];

  function pushLossSample(expected, received) {
    lossWindow.push({ expected, received });
    totalExpected += expected;
    totalReceived += received;
    if (lossWindow.length > maxSamples) {
      const removed = lossWindow.shift();
      totalExpected -= removed.expected;
      totalReceived -= removed.received;
    }
  }

  function recordSnapshot({ arrivalMs, seq, serverTimeMs }) {
    if (!Number.isFinite(arrivalMs)) return;

    if (prevArrivalMs != null) {
      const interval = Math.max(0, arrivalMs - prevArrivalMs);
      intervalEwmaMs += (interval - intervalEwmaMs) * 0.12;
      if (!Number.isFinite(serverTimeMs)) {
        const jitterDelta = Math.abs(interval - intervalEwmaMs);
        jitterMs += (jitterDelta - jitterMs) / 16;
      }
    }
    prevArrivalMs = arrivalMs;

    recentArrivals.push(arrivalMs);
    while (recentArrivals.length > 0 && arrivalMs - recentArrivals[0] > 5000) {
      recentArrivals.shift();
    }

    if (Number.isFinite(seq)) {
      if (prevSeq == null) {
        pushLossSample(1, 1);
        prevSeq = seq;
      } else if (seq > prevSeq) {
        const gap = seq - prevSeq;
        pushLossSample(gap, 1);
        prevSeq = seq;
      } else if (seq < prevSeq) {
        outOfOrderCount += 1;
      }
    } else {
      pushLossSample(1, 1);
    }

    if (Number.isFinite(serverTimeMs)) {
      const transitMs = arrivalMs - serverTimeMs;
      if (prevTransitMs != null) {
        const jitterDelta = Math.abs(transitMs - prevTransitMs);
        jitterMs += (jitterDelta - jitterMs) / 16;
      }
      prevTransitMs = transitMs;
    }
  }

  function getStats() {
    let updateRateHz = 0;
    if (recentArrivals.length >= 2) {
      const span = recentArrivals[recentArrivals.length - 1] - recentArrivals[0];
      if (span > 0) {
        updateRateHz = ((recentArrivals.length - 1) * 1000) / span;
      }
    }

    const expected = Math.max(1, totalExpected);
    const packetLossPct = clampNumber((1 - totalReceived / expected) * 100, 0, 100);

    return {
      avgIntervalMs: intervalEwmaMs,
      jitterMs,
      packetLossPct,
      updateRateHz,
      outOfOrderCount,
    };
  }

  function reset() {
    prevArrivalMs = null;
    prevSeq = null;
    prevTransitMs = null;
    intervalEwmaMs = expectedTickMs;
    jitterMs = 0;
    totalExpected = 0;
    totalReceived = 0;
    outOfOrderCount = 0;
    lossWindow.length = 0;
    recentArrivals.length = 0;
  }

  return { recordSnapshot, getStats, reset };
}

function deriveSmoothingConfig(stats, pingMs) {
  const avgIntervalMs = stats?.avgIntervalMs ?? SERVER_TICK_MS;
  const jitterMs = stats?.jitterMs ?? 0;
  const packetLossPct = stats?.packetLossPct ?? 0;
  const rttMs = Number.isFinite(pingMs) ? pingMs : 0;

  let interpDelayMs = 45 + avgIntervalMs * 1.25 + jitterMs * 2.8 + packetLossPct * 3;
  if (rttMs > 120) interpDelayMs += (rttMs - 120) * 0.14;
  interpDelayMs = clampNumber(interpDelayMs, 45, 220);

  let extrapolateMs = 8 + jitterMs * 1.2 + packetLossPct * 1.8;
  if (rttMs > 180) extrapolateMs += 8;
  extrapolateMs = clampNumber(extrapolateMs, 8, 90);

  return { interpDelayMs, extrapolateMs };
}

function createLocalPredictionState() {
  return {
    initialized: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    correctionX: 0,
    correctionY: 0,
    hardSnapCount: 0,
  };
}

function createNetworkHud(canvasEl) {
  if (!LOCAL_NET_HUD_ENABLED) {
    return {
      toggle: () => false,
      isVisible: () => false,
      render: () => {},
      destroy: () => {},
    };
  }

  if (!canvasEl || typeof document === "undefined") {
    return {
      toggle: () => false,
      isVisible: () => false,
      render: () => {},
      destroy: () => {},
    };
  }

  const host = canvasEl.parentElement || document.body;
  if (!host) {
    return {
      toggle: () => false,
      isVisible: () => false,
      render: () => {},
      destroy: () => {},
    };
  }

  const computed = window.getComputedStyle(host);
  if (computed.position === "static") {
    host.style.position = "relative";
  }

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "NET";
  button.setAttribute("aria-label", "Toggle network stats");
  Object.assign(button.style, {
    position: "absolute",
    top: "44px",
    right: "10px",
    zIndex: "1701",
    padding: "4px 7px",
    border: "1px solid rgba(255,255,255,0.34)",
    background: "rgba(4, 10, 18, 0.68)",
    color: "#dbeafe",
    fontFamily: '"Press Start 2P", monospace',
    fontSize: "8px",
    letterSpacing: "0.06em",
    lineHeight: "1",
    cursor: "pointer",
    backdropFilter: "blur(3px)",
  });

  const panel = document.createElement("pre");
  panel.hidden = true;
  Object.assign(panel.style, {
    position: "absolute",
    top: "74px",
    right: "10px",
    zIndex: "1701",
    margin: "0",
    padding: "7px 9px",
    minWidth: "192px",
    maxWidth: "min(74vw, 270px)",
    border: "1px solid rgba(255,255,255,0.25)",
    borderRadius: "4px",
    background: "rgba(2, 8, 14, 0.78)",
    color: "#e2e8f0",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: "11px",
    lineHeight: "1.35",
    whiteSpace: "pre-wrap",
    pointerEvents: "none",
    backdropFilter: "blur(4px)",
  });

  let visible = false;
  const setVisible = (nextVisible) => {
    visible = Boolean(nextVisible);
    panel.hidden = !visible;
    button.textContent = visible ? "NET ON" : "NET";
  };

  const toggle = () => {
    setVisible(!visible);
    return visible;
  };

  const handleToggleClick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggle();
  };

  button.addEventListener("click", handleToggleClick);
  host.appendChild(button);
  host.appendChild(panel);

  return {
    toggle,
    isVisible: () => visible,
    render(lines) {
      if (!Array.isArray(lines)) return;
      panel.textContent = lines.join("\n");
    },
    destroy() {
      button.removeEventListener("click", handleToggleClick);
      button.remove();
      panel.remove();
    },
  };
}

function buildRoomUrl(roomId) {
  return `${window.location.origin}/games/${GAME_SLUG}/${roomId}`;
}

function setRoomLink(url) {
  roomUrl = url;
}

function openShareModalOnce() {
  if (shareModalShown) return;
  shareModalShown = true;
  openShareModal();
}

function setupCopyButton() {
  // no-op; share UI removed
}

setupCopyButton();

function getRoomIdFromPath() {
  const pathMatch = window.location.pathname.match(new RegExp(`/games/${GAME_SLUG}/([a-z0-9]+)`, "i"));
  return pathMatch && pathMatch[1] ? pathMatch[1] : null;
}

async function ensureRoomId() {
  const existingId = getRoomIdFromPath();
  if (existingId) {
    setRoomLink(buildRoomUrl(existingId));
    announceRoomReady(existingId);
    return existingId;
  }

  try {
    const res = await fetch(`/api/games/${GAME_SLUG}/new-room`);
    if (!res.ok) throw new Error("Failed to create room");
    const data = await res.json();
    const roomId = data.roomId || Math.random().toString(36).slice(2, 8);
    const targetUrl = data.url || buildRoomUrl(roomId);
    window.history.replaceState({}, "", `/games/${GAME_SLUG}/${roomId}`);
    setRoomLink(targetUrl);
    announceRoomReady(roomId);
    return roomId;
  } catch (err) {
    const roomId = Math.random().toString(36).slice(2, 8);
    const fallbackUrl = buildRoomUrl(roomId);
    window.history.replaceState({}, "", `/games/${GAME_SLUG}/${roomId}`);
    setRoomLink(fallbackUrl);
    announceRoomReady(roomId);
    return roomId;
  }
}

function getOrCreateRoomId() {
  if (!roomReadyPromise) {
    roomReadyPromise = ensureRoomId().then((id) => {
      gameId = id;
      return id;
    });
  }
  return roomReadyPromise;
}

let gameId = null;
let hasJoined = false;
const socket = getGameSocket(GAME_SLUG);
let latestConnectionSnapshot = {
  status: socket.getConnectionState(),
  ping: socket.getPing(),
};
const unsubscribeConnection = socket.onConnectionChange((snapshot) => {
  latestConnectionSnapshot = { ...latestConnectionSnapshot, ...snapshot };
  updateConnectionState(snapshot);
});
let roomReadyPromise = null;

let myPlayerId = null;
let myRejoinToken = null;
let readyToPlay = false;
let lastConnected = { p1: false, p2: false };
let opponentJoined = false;
let currentRoomId = null;
let rematchPending = false;
const interpolator = createWorkerInterpolator({
  extractPositions: extractFightPositions,
  interpDelayMs: 50,
  maxBufferSize: 12,
});

registerRematchHandler(() => {
  if (rematchPending) return;
  rematchPending = true;
  updateEndGameModal({
    status: "Waiting for opponent...",
    phase: "waiting",
  });
  socket.send("rematch");
});

function announceRoomReady(roomId) {
  if (!roomId) return;
  if (roomId !== currentRoomId) {
    currentRoomId = roomId;
    opponentJoined = false;
    window.__kaboomOpponentJoined = null;
  }
  window.dispatchEvent(
    new CustomEvent(ROOM_READY_EVENT, { detail: { gameId: GAME_SLUG, roomId } }),
  );
  openShareModalOnce();
}

function announceOpponentJoined() {
  window.__kaboomOpponentJoined = { gameId: GAME_SLUG, roomId: gameId };
  window.dispatchEvent(
    new CustomEvent(OPPONENT_JOIN_EVENT, { detail: { gameId: GAME_SLUG, roomId: gameId } }),
  );
}

function sendInputFlag(type, value) {
  if (!readyToPlay) return;
  if (Object.prototype.hasOwnProperty.call(localInputState, type)) {
    localInputState[type] = Boolean(value);
  }
  socket.send("input", { type, value });
}

function handleDirectionalInput(direction, active) {
  switch (direction) {
    case "left":
    case "right":
      sendInputFlag(direction, active);
      break;
    case "up":
      sendInputFlag("jump", active);
      break;
    case "down":
      // D-pad down = light attack
      sendInputFlag("attack", active);
      break;
    default:
      break;
  }
}

function handleActionInput(action) {
  switch (action) {
    case "a": {
      // A = light attack
      sendInputFlag("attack", true);
      setTimeout(() => sendInputFlag("attack", false), 150);
      break;
    }
    case "x": {
      // X = heavy attack (slower, more damage)
      sendInputFlag("heavyAttack", true);
      setTimeout(() => sendInputFlag("heavyAttack", false), 300);
      break;
    }
    case "y": {
      // Y = aerial attack
      sendInputFlag("aerialAttack", true);
      setTimeout(() => sendInputFlag("aerialAttack", false), 200);
      break;
    }
    case "start":
      if (roomUrl) {
        openShareModal();
      } else {
        getOrCreateRoomId().finally(() => {
          openShareModal();
        });
      }
      break;
    case "b":
      toggleNetworkDiagnostics();
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
    roomReadyPromise = null;
    gameId = null;
    myRejoinToken = null;
  }
  getOrCreateRoomId().then(() => {
    tryJoinGame();
  });
});

socket.onEvent("roomFull", () => {
  alert("Room is full!");
});

socket.onEvent("gameJoined", ({ playerId, gameId: joinedGameId, rejoinToken: token }) => {
  myPlayerId = playerId;
  myRejoinToken = token || null;
  readyToPlay = true;
  gameId = joinedGameId;
  resetFightNetcodeState();
  if (token && joinedGameId) {
    try { sessionStorage.setItem(`rejoinToken:${GAME_SLUG}:${joinedGameId}`, token); } catch (e) { /* noop */ }
  }
  setRoomLink(buildRoomUrl(joinedGameId));
  announceRoomReady(joinedGameId);
  console.log("Joined game", joinedGameId, "as", playerId);
});

socket.onEvent("rematchRequested", ({ playerId }) => {
  if (playerId === myPlayerId) return;
  updateEndGameModal({
    status: "Accept challenge.",
    actionLabel: "Accept Challenge",
    phase: "ready",
  });
});

socket.onEvent("rematchStarted", () => {
  rematchPending = false;
  interpolator.reset();
  resetLocalInputState();
  resetFightNetcodeState();
  hideEndGameModal();
});

getOrCreateRoomId().then(() => {
  tryJoinGame();
});

// ---------- Assets ----------

loadSprite("background", `${ASSET_BASE}/background/background_layer_1.png`);
loadSprite("trees", `${ASSET_BASE}/background/background_layer_2.png`);

loadSpriteAtlas(`${ASSET_BASE}/oak_woods_tileset.png`, {
  "ground-golden": {
    x: 16,
    y: 0,
    width: 16,
    height: 16,
  },
  "deep-ground": {
    x: 16,
    y: 32,
    width: 16,
    height: 16,
  },
  "ground-silver": {
    x: 0,
    y: 0,
    width: 16,
    height: 16,
  },
});

loadSprite("shop", `${ASSET_BASE}/shop_anim.png`, {
  sliceX: 6,
  sliceY: 1,
  anims: {
    default: {
      from: 0,
      to: 5,
      speed: 12,
      loop: true,
    },
  },
});

loadSprite("fence", `${ASSET_BASE}/fence_1.png`);
loadSprite("sign", `${ASSET_BASE}/sign.png`);

loadSprite("idle-player1", `${ASSET_BASE}/idle-player1.png`, {
  sliceX: 8,
  sliceY: 1,
  anims: { idle: { from: 0, to: 7, speed: 12, loop: true } },
});
loadSprite("jump-player1", `${ASSET_BASE}/jump-player1.png`, {
  sliceX: 2,
  sliceY: 1,
  anims: { jump: { from: 0, to: 1, speed: 2, loop: true } },
});
loadSprite("attack-player1", `${ASSET_BASE}/attack-player1.png`, {
  sliceX: 6,
  sliceY: 1,
  anims: { attack: { from: 1, to: 5, speed: 18 } },
});
loadSprite("run-player1", `${ASSET_BASE}/run-player1.png`, {
  sliceX: 8,
  sliceY: 1,
  anims: { run: { from: 0, to: 7, speed: 18 } },
});
loadSprite("death-player1", `${ASSET_BASE}/death-player1.png`, {
  sliceX: 6,
  sliceY: 1,
  anims: { death: { from: 0, to: 5, speed: 10 } },
});

loadSprite("idle-player2", `${ASSET_BASE}/idle-player2.png`, {
  sliceX: 4,
  sliceY: 1,
  anims: { idle: { from: 0, to: 3, speed: 8, loop: true } },
});
loadSprite("jump-player2", `${ASSET_BASE}/jump-player2.png`, {
  sliceX: 2,
  sliceY: 1,
  anims: { jump: { from: 0, to: 1, speed: 2, loop: true } },
});
loadSprite("attack-player2", `${ASSET_BASE}/attack-player2.png`, {
  sliceX: 4,
  sliceY: 1,
  anims: { attack: { from: 0, to: 3, speed: 18 } },
});
loadSprite("run-player2", `${ASSET_BASE}/run-player2.png`, {
  sliceX: 8,
  sliceY: 1,
  anims: { run: { from: 0, to: 7, speed: 18 } },
});
loadSprite("death-player2", `${ASSET_BASE}/death-player2.png`, {
  sliceX: 7,
  sliceY: 1,
  anims: { death: { from: 0, to: 6, speed: 10 } },
});

// ---------- Game constants ----------
const GROUND_Y = 704;
const PLAYER1_Y_OFFSET = 20;
const PLAYER2_Y_OFFSET = 0;

// ---------- Scene ----------

scene("fight", () => {
  setGravity(0); // Server handles physics
  interpolator.reset();
  socket.offEvent("state");
  socket.offEvent("playerJoined");
  socket.offEvent("playerLeft");

  const background = add([sprite("background"), scale(4)]);
  background.add([sprite("trees")]);

  const groundTiles = addLevel(
    [
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "------#######-----------",
      "dddddddddddddddddddddddd",
      "dddddddddddddddddddddddd",
    ],
    {
      tileWidth: 16,
      tileHeight: 16,
      tiles: {
        "#": () => [sprite("ground-golden")],
        "-": () => [sprite("ground-silver")],
        d: () => [sprite("deep-ground")],
      },
    }
  );

  groundTiles.use(scale(4));

  const shop = background.add([sprite("shop"), pos(170, 15)]);
  shop.play("default");

  // invisible walls
  add([rect(16, 720), pos(-20, 0), color(0, 0, 0), opacity(0)]);
  add([rect(16, 720), pos(1280, 0), color(0, 0, 0), opacity(0)]);

  background.add([sprite("fence"), pos(85, 125)]);
  background.add([sprite("fence"), pos(10, 125)]);
  background.add([sprite("sign"), pos(290, 115)]);

  // Player objects for rendering
  let player1 = null;
  let player2 = null;
  let player1HealthBar = null;
  let player2HealthBar = null;
  let counter = null;
  let gameOverFlag = false;
  let countInterval = null;
  let startOverlay = null;
  let startMessage = null;
  let countdownText = null;
  let joinToast = null;
  let joinToastText = null;
  let joinToastTimer = null;
  let lastNetworkHudPaint = 0;
  let latestServerState = null;
  const netEstimator = createNetworkEstimator();
  let latestNetStats = netEstimator.getStats();
  let smoothingConfig = { interpDelayMs: 55, extrapolateMs: 14 };
  const localPrediction = createLocalPredictionState();
  const netHud = createNetworkHud(gameCanvas);
  const handleKeyToggleNetwork = (event) => {
    const tag = event?.target?.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;
    if (event.key?.toLowerCase() === "n" && !event.repeat) {
      event.preventDefault();
      toggleNetworkDiagnostics();
    }
  };

  toggleNetworkDiagnostics = () => {
    const isVisible = netHud.toggle();
    if (isVisible) {
      lastNetworkHudPaint = 0;
    }
    return isVisible;
  };

  cleanupNetworkDiagnostics = () => {
    toggleNetworkDiagnostics = () => {};
    netHud.destroy();
    window.removeEventListener("keydown", handleKeyToggleNetwork);
  };

  window.addEventListener("keydown", handleKeyToggleNetwork);

  function resetLocalPredictionFromServer(serverPlayerState) {
    if (!serverPlayerState) {
      localPrediction.initialized = false;
      localPrediction.correctionX = 0;
      localPrediction.correctionY = 0;
      return;
    }
    localPrediction.initialized = true;
    localPrediction.x = serverPlayerState.x;
    localPrediction.y = serverPlayerState.y;
    localPrediction.vx = serverPlayerState.vx || 0;
    localPrediction.vy = 0;
    localPrediction.correctionX = 0;
    localPrediction.correctionY = 0;
  }

  function reconcileLocalPrediction(serverPlayerState) {
    if (!serverPlayerState) return;
    if (!localPrediction.initialized) {
      resetLocalPredictionFromServer(serverPlayerState);
      return;
    }

    const errorX = serverPlayerState.x - localPrediction.x;
    const errorY = serverPlayerState.y - localPrediction.y;
    const errorDistance = Math.hypot(errorX, errorY);
    const requiresHardSnap = errorDistance > 140 || Math.abs(errorY) > 100;

    if (requiresHardSnap) {
      localPrediction.hardSnapCount += 1;
      resetLocalPredictionFromServer(serverPlayerState);
      return;
    }

    localPrediction.correctionX = clampNumber(localPrediction.correctionX + errorX * 0.36, -90, 90);
    localPrediction.correctionY = clampNumber(localPrediction.correctionY + errorY * 0.36, -90, 90);
  }

  function stepLocalPrediction(deltaSec, serverPlayerState, matchState) {
    if (!serverPlayerState || !myPlayerId) return null;

    const activeMatch = Boolean(
      matchState?.started &&
        !matchState?.gameOver &&
        matchState?.connected?.p1 &&
        matchState?.connected?.p2,
    );

    if (!activeMatch) {
      resetLocalPredictionFromServer(serverPlayerState);
      return { x: serverPlayerState.x, y: serverPlayerState.y };
    }

    if (!localPrediction.initialized) {
      resetLocalPredictionFromServer(serverPlayerState);
    }

    const clampedDt = clampNumber(deltaSec, 0, 0.05);
    const attackSlowdown =
      serverPlayerState.attacking ||
      localInputState.attack ||
      localInputState.heavyAttack ||
      localInputState.aerialAttack;
    const speedMultiplier = attackSlowdown ? 0.3 : 1;

    if (localInputState.left && !localInputState.right) {
      localPrediction.vx = -PREDICT_MOVE_SPEED * speedMultiplier;
    } else if (localInputState.right && !localInputState.left) {
      localPrediction.vx = PREDICT_MOVE_SPEED * speedMultiplier;
    } else {
      localPrediction.vx = 0;
    }

    if (localInputState.jump && localPrediction.y >= PREDICT_GROUND_Y - 1) {
      localPrediction.vy = PREDICT_JUMP_SPEED;
    }

    localPrediction.vy += PREDICT_GRAVITY * clampedDt;
    localPrediction.y += localPrediction.vy * clampedDt;
    if (localPrediction.y > PREDICT_GROUND_Y) {
      localPrediction.y = PREDICT_GROUND_Y;
      localPrediction.vy = 0;
    }

    localPrediction.x += localPrediction.vx * clampedDt;
    localPrediction.x = clampNumber(localPrediction.x, PREDICT_WORLD_MIN_X, PREDICT_WORLD_MAX_X);

    const correctionDecay = Math.exp(-clampedDt * 16);
    localPrediction.correctionX *= correctionDecay;
    localPrediction.correctionY *= correctionDecay;

    return {
      x: localPrediction.x + localPrediction.correctionX,
      y: localPrediction.y + localPrediction.correctionY,
    };
  }

  function refreshNetworkHud(nowMs, force = false) {
    if (!netHud.isVisible()) return;
    if (!force && nowMs - lastNetworkHudPaint < NET_STATS_REFRESH_MS) return;
    lastNetworkHudPaint = nowMs;

    const pingMs = toFiniteNumber(latestConnectionSnapshot?.ping);
    const correctionMagnitude = Math.hypot(localPrediction.correctionX, localPrediction.correctionY);
    const localRole = myPlayerId ? myPlayerId.toUpperCase() : "--";
    const status = (latestConnectionSnapshot?.status || "connecting").toUpperCase();

    netHud.render([
      `NET ${status}`,
      `Ping RTT: ${pingMs == null ? "--" : `${pingMs} ms`}`,
      `Jitter: ${(latestNetStats.jitterMs || 0).toFixed(1)} ms`,
      `Packet Loss: ${(latestNetStats.packetLossPct || 0).toFixed(1)}%`,
      `Update Rate: ${(latestNetStats.updateRateHz || 0).toFixed(1)} Hz`,
      `Interp Delay: ${Math.round(smoothingConfig.interpDelayMs)} ms`,
      `Extrapolation: ${Math.round(smoothingConfig.extrapolateMs)} ms`,
      `Prediction Err: ${correctionMagnitude.toFixed(1)} px`,
      `Out-of-order: ${latestNetStats.outOfOrderCount || 0}`,
      `Player Slot: ${localRole}`,
      `Toggle: NET / B / N`,
    ]);
  }

  function resetNetcodeState() {
    interpolator.reset();
    netEstimator.reset();
    latestNetStats = netEstimator.getStats();
    smoothingConfig = { interpDelayMs: 55, extrapolateMs: 14 };
    latestServerState = null;
    resetLocalInputState();
    resetLocalPredictionFromServer(null);
    lastNetworkHudPaint = 0;
    refreshNetworkHud(performance.now(), true);
  }

  resetFightNetcodeState = resetNetcodeState;
  resetNetcodeState();

  function makePlayer(posX, posY, scaleFactor, id) {
    const p = add([
      pos(posX, posY),
      scale(scaleFactor),
      // Bottom anchor so the server's y matches the fighter's feet
      area({ shape: new Rect(vec2(-8, -42), 16, 42) }),
      anchor("bot"),
      {
        sprites: {
          run: "run-" + id,
          idle: "idle-" + id,
          jump: "jump-" + id,
          attack: "attack-" + id,
          death: "death-" + id,
        },
      },
    ]);
    p.use(sprite(p.sprites.idle));
    p.play("idle");
    return p;
  }

  player1 = makePlayer(200, GROUND_Y + PLAYER1_Y_OFFSET, 4, "player1");
  player2 = makePlayer(1000, GROUND_Y + PLAYER2_Y_OFFSET, 4, "player2");
  player2.flipX = true;

  // Health bars
  const player1HealthContainer = add([
    rect(500, 70),
    area(),
    outline(5),
    pos(90, 20),
    color(200, 0, 0),
  ]);

  player1HealthBar = player1HealthContainer.add([
    rect(498, 65),
    color(0, 180, 0),
    pos(498, 70 - 2.5),
    rotate(180),
  ]);

  const player2HealthContainer = add([
    rect(500, 70),
    area(),
    outline(5),
    pos(690, 20),
    color(200, 0, 0),
  ]);

  player2HealthBar = player2HealthContainer.add([
    rect(498, 65),
    color(0, 180, 0),
    pos(2.5, 2.5),
  ]);

  // Timer
  counter = add([
    rect(100, 100),
    pos(center().x, center().y - 300),
    color(10, 10, 10),
    area(),
    anchor("center"),
  ]);

  const count = counter.add([
    text("300"),
    area(),
    anchor("center"),
    {
      timeLeft: 300,
    },
  ]);

  // Start / countdown overlay
  startOverlay = add([
    rect(520, 160),
    color(0, 0, 0),
    opacity(0.65),
    anchor("center"),
    pos(center()),
    fixed(),
    z(1500),
  ]);
  startMessage = startOverlay.add([
    text("Waiting for other player..."),
    anchor("center"),
    pos(0, -20),
  ]);
  countdownText = startOverlay.add([text(""), anchor("center"), pos(0, 30)]);

  // Join notification toast
  joinToast = add([
    rect(320, 60),
    color(20, 20, 20),
    opacity(0.8),
    pos(center().x, 90),
    anchor("center"),
    fixed(),
    z(1600),
  ]);
  joinToastText = joinToast.add([text(""), anchor("center")]);
  joinToast.hidden = true;

  function showJoinToast(message) {
    if (!joinToast) return;
    joinToast.hidden = false;
    joinToastText.text = message;
    if (joinToastTimer) joinToastTimer.cancel();
    joinToastTimer = wait(1.5, () => {
      joinToast.hidden = true;
      joinToastTimer = null;
    });
  }

  function getResultLabel(winner) {
    if (winner === "tie") return "Tie game!";
    if (!myPlayerId) {
      return winner === "p1" ? "Player 1 Wins!" : "Player 2 Wins!";
    }
    return winner === myPlayerId ? "You Win!" : "You Lose!";
  }

  function updateStartUI(started, startAt, connected, gameOver) {
    if (!startOverlay || !startMessage || !countdownText) return;
    const bothConnected = connected?.p1 && connected?.p2;

    if (gameOver) {
      startOverlay.hidden = true;
      countdownText.text = "";
      return;
    }

    if (started) {
      startOverlay.hidden = true;
      countdownText.text = "";
      return;
    }

    startOverlay.hidden = false;
    if (!bothConnected) {
      startMessage.text = "Waiting for other player...";
      countdownText.text = "";
      return;
    }

    startMessage.text = "Get ready...";
    if (startAt) {
      const seconds = Math.max(0, Math.ceil((startAt - Date.now()) / 1000));
      countdownText.text = seconds > 0 ? `Starting in ${seconds}` : "Fight!";
    } else {
      countdownText.text = "";
    }
  }

  socket.onEvent("playerJoined", ({ playerId }) => {
    showJoinToast(`Player ${playerId === "p1" ? "1" : "2"} joined the game`);
    announceOpponentJoined();
  });

  socket.onEvent("playerLeft", ({ playerId }) => {
    showJoinToast(`Player ${playerId === "p1" ? "1" : "2"} left the game`);
    opponentJoined = false;
    window.__kaboomOpponentJoined = null;
    rematchPending = false;
    gameOverFlag = false;
    resetNetcodeState();
    hideEndGameModal();
  });

  // Server state updates
  socket.onEvent("state", (state) => {
    if (!player1 || !player2 || !player1HealthBar || !player2HealthBar) {
      return;
    }

    const arrivalMs = performance.now();
    const arrivalWallClockMs = Date.now();
    const netMeta = state?.net || {};
    const seq = toFiniteNumber(netMeta.seq);
    const serverTimeMs = toFiniteNumber(netMeta.serverTime);
    netEstimator.recordSnapshot({ arrivalMs: arrivalWallClockMs, seq, serverTimeMs });
    latestNetStats = netEstimator.getStats();
    smoothingConfig = deriveSmoothingConfig(latestNetStats, latestConnectionSnapshot?.ping);
    latestServerState = state;

    // Buffer state for interpolated rendering
    interpolator.pushState(state);

    // Discrete updates use latest state immediately
    const { players, timer, gameOver, winner, started, startAt, connected } = state;
    if (myPlayerId && players?.[myPlayerId]) {
      reconcileLocalPrediction(players[myPlayerId]);
    }
    if (connected) {
      if (connected.p1 !== lastConnected.p1 || connected.p2 !== lastConnected.p2) {
        if (connected.p1 && !lastConnected.p1 && connected.p2) {
          showJoinToast("Player 1 connected");
        }
        if (connected.p2 && !lastConnected.p2 && connected.p1) {
          showJoinToast("Player 2 connected");
        }
        lastConnected = connected;
      }
      if (!opponentJoined && connected.p1 && connected.p2) {
        opponentJoined = true;
        announceOpponentJoined();
      }
    }
    updateStartUI(started, startAt, connected, gameOver);

    const s1 = players.p1;
    const s2 = players.p2;

    // Facing direction (discrete)
    player1.flipX = s1.dir === -1;
    player2.flipX = s2.dir === -1;

    // Health bars (discrete)
    player1HealthBar.width = s1.health;
    player2HealthBar.width = s2.health;

    // Timer (discrete)
    count.text = String(Math.ceil(timer));

    // Game over (discrete)
    if (gameOver && !gameOverFlag) {
      gameOverFlag = true;
      rematchPending = false;
      if (countInterval) clearInterval(countInterval);

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

    // Animations (discrete)
    updatePlayerAnimation(player1, s1, "player1");
    updatePlayerAnimation(player2, s2, "player2");

    refreshNetworkHud(arrivalMs);
  });

  // Per-frame interpolated position updates
  onUpdate(() => {
    if (!player1 || !player2) return;

    const positions = interpolator.getInterpolatedPositions({
      pingMs: latestConnectionSnapshot?.ping,
      pingP95Ms: latestConnectionSnapshot?.pingP95Ms,
      jitterP95Ms: latestConnectionSnapshot?.jitterP95Ms,
      packetLossPct: latestConnectionSnapshot?.packetLossPct,
    });
    if (!positions) {
      refreshNetworkHud(performance.now());
      return;
    }

    player1.pos.x = positions.p1x;
    player1.pos.y = positions.p1y + PLAYER1_Y_OFFSET;
    player2.pos.x = positions.p2x;
    player2.pos.y = positions.p2y + PLAYER2_Y_OFFSET;

    refreshNetworkHud(performance.now());
  });

  // Track per-player attack animation state to vary speed by type
  const attackAnimState = { player1: null, player2: null };

  function updatePlayerAnimation(player, state, playerId) {
    if (!player || !state) return;

    const { attacking, attackType, dead, vx } = state;

    if (dead) {
      if (player.curAnim() !== "death") {
        player.use(sprite(player.sprites.death));
        player.play("death");
      }
    } else if (attacking) {
      // Vary animation speed by attack type for a different feel
      const prevType = attackAnimState[playerId];
      if (player.curAnim() !== "attack" || prevType !== attackType) {
        attackAnimState[playerId] = attackType;
        player.use(sprite(player.sprites.attack));
        const speed = attackType === "heavy" ? 10 : attackType === "aerial" ? 22 : 18;
        player.play("attack", { speed });
      }
    } else {
      attackAnimState[playerId] = null;
      if (Math.abs(vx) > 5) {
        if (player.curAnim() !== "run") {
          player.use(sprite(player.sprites.run));
          player.play("run");
        }
      } else {
        if (player.curAnim() !== "idle") {
          player.use(sprite(player.sprites.idle));
          player.play("idle");
        }
      }
    }
  }
});

const cleanupControllerNavigation = initControllerNavigation();

let disposed = false;

function disposeGameRuntime() {
  if (disposed) return;
  disposed = true;

  cleanupControllerNavigation?.();
  cleanupNetworkDiagnostics?.();
  cleanupNetworkDiagnostics = () => {};
  resetFightNetcodeState = () => {};
  registerRematchHandler(null);
  hideEndGameModal();
  resetLocalInputState();
  interpolator.destroy?.();
  unsubscribeConnection?.();
  updateConnectionState({ status: "disconnected", ping: null });
  window.__kaboomOpponentJoined = null;

  socket.offEvent("connect");
  socket.offEvent("roomFull");
  socket.offEvent("gameJoined");
  socket.offEvent("rematchRequested");
  socket.offEvent("rematchStarted");
  socket.offEvent("playerJoined");
  socket.offEvent("playerLeft");
  socket.offEvent("state");
  socket.destroy?.();

  window.removeEventListener(DISPOSE_GAME_EVENT, handleDisposeEvent);
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

go("fight");
