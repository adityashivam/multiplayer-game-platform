import { getGameControls, getGameDomRefs } from "/platform/frontend-engine/gameDom.js";
import { getGameSocket } from "/platform/frontend-engine/gameSocket.js";
import {
  hideEndGameModal,
  registerRematchHandler,
  showEndGameModal,
  updateEndGameModal,
} from "/platform/frontend-engine/endGameBridge.js";
import { openShareModal } from "/platform/frontend-engine/shareModalBridge.js";
import { createWorkerInterpolator } from "/platform/frontend-engine/interpolationWorker.js";
import { updateConnectionState } from "/platform/frontend-engine/connectionBridge.js";
import { createNetworkedGameSession } from "/platform/frontend-engine/networkedGameSession.js";
import {
  FIGHT_FIXED_DT_SEC,
  FIGHT_INPUT_TEMPLATE,
  stepFightPlayer,
  resolveFightSeparation,
} from "/games/fight/shared/simulation.js";
import {
  INPUT_PROTOCOL,
  SOCKET_EVENT,
} from "/platform/shared/networkProtocol.js";
import { createInputLatch } from "/platform/frontend-engine/inputTimeline.js";
import { createPluggablePoseRuntime } from "/platform/frontend-engine/pluggablePoseRuntime.js";

/** @typedef {import("./shared/simulation.js").FightInputState} FightInputState */
/** @typedef {import("./shared/simulation.js").FightPlayerId} FightPlayerId */

/**
 * @typedef {import("./shared/simulation.js").FightPlayerState & {
 *   health: number,
 *   inputEpoch?: number,
 *   inputSeqAck?: number,
 *   inputSimulationTick?: number
 * }} FightSnapshotPlayerState
 */

/**
 * @typedef {object} FightSnapshot
 * @property {{ p1: FightSnapshotPlayerState, p2: FightSnapshotPlayerState }} players
 * @property {1 | 2} [inputProtocol]
 * @property {number} timer
 * @property {boolean} gameOver
 * @property {FightPlayerId | "tie" | null} winner
 * @property {boolean} started
 * @property {number | null} startAt
 * @property {{ p1: boolean, p2: boolean }} connected
 * @property {import("../../platform/shared/networkProtocol.js").SnapshotNetworkMetadata} [net]
 */

/**
 * @typedef {object} FightPredictionContext
 * @property {number} [simulationTick]
 * @property {boolean} active
 * @property {FightSnapshotPlayerState} [opponent]
 */

/** @typedef {{ p1x: number, p1y: number, p2x: number, p2y: number }} FightRenderPose */

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
  maxFPS: 60,
  pixelDensity: 1,
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
const FIGHT_DIAGNOSTICS_REFRESH_MS = 500;
const FIGHT_INTERPOLATION_DELAY_MS = 42;
const FIGHT_EXTRAPOLATE_MS = 10;
const FIGHT_SNAPSHOT_BUFFER_SIZE = 32;
const FIGHT_MAX_SMOOTHING_DISTANCE = 250;
const LOCAL_NET_HUD_ENABLED = false;
let shareModalShown = false;
let toggleNetworkDiagnostics = () => {};
let cleanupNetworkDiagnostics = () => {};
let destroyFightNetworkSession = () => {};
let activeFightRuntime = null;

const inputLatch = createInputLatch(FIGHT_INPUT_TEMPLATE, {
  edgeKeys: ["jump", "attack", "heavyAttack", "aerialAttack"],
});

/**
 * @param {FightSnapshot} serverState
 * @returns {FightRenderPose}
 */
function extractFightPositions(serverState) {
  return {
    p1x: serverState.players.p1.x,
    p1y: serverState.players.p1.y,
    p2x: serverState.players.p2.x,
    p2y: serverState.players.p2.y,
  };
}

/**
 * @param {FightSnapshot} serverState
 * @returns {FightRenderPose}
 */
function extractFightVelocities(serverState) {
  return {
    p1x: serverState.players.p1.vx || 0,
    p1y: serverState.players.p1.vy || 0,
    p2x: serverState.players.p2.vx || 0,
    p2y: serverState.players.p2.vy || 0,
  };
}

function toFiniteNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function resetLocalInputState() {
  inputLatch.reset();
}

/** @returns {FightInputState} Captures held controls and consumes pending action edges. */
function captureLocalInputState() {
  return inputLatch.capture();
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

/** @type {FightPlayerId | null} */
let myPlayerId = null;
let myRejoinToken = null;
let readyToPlay = false;
let lastConnected = { p1: false, p2: false };
let opponentJoined = false;
let currentRoomId = null;
let rematchPending = false;
// ── Interpolation Tuning (remote player smoothness) ──
const interpolator = createWorkerInterpolator({
  extractPositions: extractFightPositions,
  extractVelocities: extractFightVelocities,
  interpDelayMs: FIGHT_INTERPOLATION_DELAY_MS,
  maxBufferSize: FIGHT_SNAPSHOT_BUFFER_SIZE,
});

registerRematchHandler(() => {
  if (rematchPending) return;
  rematchPending = true;
  updateEndGameModal({
    status: "Waiting for opponent...",
    phase: "waiting",
  });
  socket.send(SOCKET_EVENT.REMATCH);
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

/**
 * @param {keyof FightInputState} inputKey
 * @param {boolean} active
 */
function setLocalInputFlag(inputKey, active) {
  inputLatch.set(inputKey, active);
}

function handleDirectionalInput(direction, active) {
  switch (direction) {
    case "left":
    case "right":
      setLocalInputFlag(direction, active);
      break;
    case "up":
      setLocalInputFlag("jump", active);
      break;
    case "down":
      // D-pad down = light attack
      setLocalInputFlag("attack", active);
      break;
    default:
      break;
  }
}

function handleActionInput(action) {
  switch (action) {
    case "a": {
      // A = light attack
      setLocalInputFlag("attack", true);
      setTimeout(() => setLocalInputFlag("attack", false), 150);
      break;
    }
    case "x": {
      // X = heavy attack (slower, more damage)
      setLocalInputFlag("heavyAttack", true);
      setTimeout(() => setLocalInputFlag("heavyAttack", false), 300);
      break;
    }
    case "y": {
      // Y = aerial attack
      setLocalInputFlag("aerialAttack", true);
      setTimeout(() => setLocalInputFlag("aerialAttack", false), 200);
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
  window.addEventListener("blur", resetLocalInputState);
  cleanups.push(() => window.removeEventListener("blur", resetLocalInputState));

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
  socket.send(SOCKET_EVENT.JOIN_GAME, { gameId, rejoinToken: token || undefined });
  hasJoined = true;
}

socket.onEvent(SOCKET_EVENT.CONNECT, () => {
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

socket.onEvent(SOCKET_EVENT.ROOM_FULL, () => {
  alert("Room is full!");
});

socket.onEvent(SOCKET_EVENT.GAME_JOINED, ({ playerId, gameId: joinedGameId, rejoinToken: token }) => {
  myPlayerId = playerId;
  myRejoinToken = token || null;
  readyToPlay = true;
  gameId = joinedGameId;
  if (token && joinedGameId) {
    try { sessionStorage.setItem(`rejoinToken:${GAME_SLUG}:${joinedGameId}`, token); } catch (e) { /* noop */ }
  }
  setRoomLink(buildRoomUrl(joinedGameId));
  announceRoomReady(joinedGameId);
  console.log("Joined game", joinedGameId, "as", playerId);
});

socket.onEvent(SOCKET_EVENT.REMATCH_REQUESTED, ({ playerId }) => {
  if (playerId === myPlayerId) return;
  updateEndGameModal({
    status: "Accept challenge.",
    actionLabel: "Accept Challenge",
    phase: "ready",
  });
});

socket.onEvent(SOCKET_EVENT.REMATCH_STARTED, () => {
  rematchPending = false;
  interpolator.reset();
  resetLocalInputState();
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
  destroyFightNetworkSession();
  interpolator.reset();
  if (activeFightRuntime) {
    activeFightRuntime.destroy();
    activeFightRuntime = null;
  }
  socket.offEvent(SOCKET_EVENT.STATE);
  socket.offEvent(SOCKET_EVENT.PLAYER_JOINED);
  socket.offEvent(SOCKET_EVENT.PLAYER_LEFT);

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
  /** @type {Partial<import("../../platform/frontend-engine/interpolation.js").InterpolationNetworkStats>} */
  let latestNetStats = {};
  let smoothingConfig = {
    interpDelayMs: FIGHT_INTERPOLATION_DELAY_MS,
    extrapolateMs: FIGHT_EXTRAPOLATE_MS,
  };
  /**
   * Mutate only the owned prediction state. Separation uses an opponent copy so
   * prediction cannot change the retained authoritative snapshot.
   * @param {FightSnapshotPlayerState} playerState
   * @param {FightInputState} inputState
   * @param {number} fixedDtSec
   * @param {FightPredictionContext} predictionContext
   */
  function simulatePredictedFightPlayer(playerState, inputState, fixedDtSec, predictionContext) {
    stepFightPlayer(playerState, inputState, fixedDtSec, predictionContext);
    if (predictionContext.active && predictionContext.opponent && !playerState.dead) {
      const opponentState = { ...predictionContext.opponent };
      if (myPlayerId === "p1") {
        resolveFightSeparation(playerState, opponentState);
      } else {
        resolveFightSeparation(opponentState, playerState);
      }
    }
  }

  /** @param {FightSnapshot} serverSnapshot @returns {FightPredictionContext} */
  function createFightPredictionContext(serverSnapshot) {
    return {
      simulationTick: serverSnapshot.players?.[myPlayerId]?.inputSimulationTick,
      active: Boolean(serverSnapshot.started && !serverSnapshot.gameOver &&
        serverSnapshot.connected?.p1 && serverSnapshot.connected?.p2),
      opponent: serverSnapshot.players?.[myPlayerId === "p1" ? "p2" : "p1"],
    };
  }

  const networkSession = createNetworkedGameSession({
    socket,
    interpolator,
    prediction: {
      fixedDtSec: FIGHT_FIXED_DT_SEC,
      captureInput: captureLocalInputState,
      simulate: simulatePredictedFightPlayer,
      extractPose: (playerState) => ({ x: playerState.x, y: playerState.y }),
      maxSmoothingDistance: FIGHT_MAX_SMOOTHING_DISTANCE,
    },
    readAuthority: (serverSnapshot) => {
      const localPlayer = serverSnapshot.players?.[myPlayerId];
      return localPlayer ? {
        state: localPlayer,
        protocol: serverSnapshot.inputProtocol ?? INPUT_PROTOCOL.LEGACY,
        inputEpoch: localPlayer.inputEpoch,
        acknowledgedSequence: localPlayer.inputSeqAck ?? 0,
        context: createFightPredictionContext(serverSnapshot),
      } : null;
    },
    canCaptureInput: (serverSnapshot) => readyToPlay && !document.hidden && !serverSnapshot.gameOver,
    composeRenderPose: (remotePose, localPose) => remotePose ? createFightRenderPose(remotePose, localPose) : null,
    onReset: resetFightPresentation,
    onDiagnostics: (sessionStats) => {
      latestNetStats = sessionStats.interpolation ?? {};
      smoothingConfig = {
        interpDelayMs: latestNetStats.effectiveDelayMs ?? latestNetStats.interpDelayMs ?? FIGHT_INTERPOLATION_DELAY_MS,
        extrapolateMs: latestNetStats.extrapolateMs ?? 0,
      };
      updateConnectionState(sessionStats);
    },
    diagnosticsIntervalMs: FIGHT_DIAGNOSTICS_REFRESH_MS,
  });

  /**
   * Apply prediction to the local player's pose and interpolation to the opponent.
   * @param {FightRenderPose} interpolatedPositions
   * @param {{ x: number, y: number } | null} predictedPose
   * @returns {FightRenderPose}
   */
  function createFightRenderPose(interpolatedPositions, predictedPose) {
    if (myPlayerId === "p1") {
      return {
        p1x: predictedPose ? predictedPose.x : interpolatedPositions.p1x,
        p1y: (predictedPose ? predictedPose.y : interpolatedPositions.p1y) + PLAYER1_Y_OFFSET,
        p2x: interpolatedPositions.p2x,
        p2y: interpolatedPositions.p2y + PLAYER2_Y_OFFSET,
      };
    }

    if (myPlayerId === "p2") {
      return {
        p1x: interpolatedPositions.p1x,
        p1y: interpolatedPositions.p1y + PLAYER1_Y_OFFSET,
        p2x: predictedPose ? predictedPose.x : interpolatedPositions.p2x,
        p2y: (predictedPose ? predictedPose.y : interpolatedPositions.p2y) + PLAYER2_Y_OFFSET,
      };
    }

    return {
      p1x: interpolatedPositions.p1x,
      p1y: interpolatedPositions.p1y + PLAYER1_Y_OFFSET,
      p2x: interpolatedPositions.p2x,
      p2y: interpolatedPositions.p2y + PLAYER2_Y_OFFSET,
    };
  }

  const movementRuntime = createPluggablePoseRuntime({
    fixedDtSec: FIGHT_FIXED_DT_SEC,
    maxFrameSec: 0.08,
    maxFixedSteps: 5,
    targetRenderFps: null,
    samplePose: (runtimeContext) => {
      if (!player1 || !player2) {
        return;
      }

      return networkSession.samplePose({
        nowMs: runtimeContext.nowMs,
        deltaSec: runtimeContext.fixedDtSec,
      });
    },
    applyPose: (pose) => {
      if (!player1 || !player2) return;
      player1.pos.x = pose.p1x;
      player1.pos.y = pose.p1y;
      player2.pos.x = pose.p2x;
      player2.pos.y = pose.p2y;
    },
  });
  activeFightRuntime = movementRuntime;

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

  function refreshNetworkHud(nowMs, force = false) {
    if (!netHud.isVisible()) return;
    if (!force && nowMs - lastNetworkHudPaint < NET_STATS_REFRESH_MS) return;
    lastNetworkHudPaint = nowMs;

    const pingMs = toFiniteNumber(latestConnectionSnapshot?.ping);
    const correctionMagnitude = networkSession.getStats().prediction?.correctionDistance ?? 0;
    const localRole = myPlayerId ? myPlayerId.toUpperCase() : "--";
    const status = (latestConnectionSnapshot?.status || "connecting").toUpperCase();

    netHud.render([
      `NET ${status}`,
      `Ping RTT: ${pingMs == null ? "--" : `${pingMs} ms`}`,
      `Jitter: ${(latestNetStats.jitterMs || 0).toFixed(1)} ms`,
      `Snapshot gaps: ${(latestNetStats.packetLossPct || 0).toFixed(1)}%`,
      `Update Rate: ${(latestNetStats.updateRateHz || 0).toFixed(1)} Hz`,
      `Interp Delay: ${Math.round(smoothingConfig.interpDelayMs)} ms`,
      `Extrapolation: ${Math.round(smoothingConfig.extrapolateMs)} ms`,
      `Prediction Err: ${correctionMagnitude.toFixed(1)} px`,
      `Out-of-order: ${latestNetStats.outOfOrderCount || 0}`,
      `Player Slot: ${localRole}`,
      `Toggle: NET / B / N`,
    ]);
  }

  /** Reset game presentation after the SDK clears networking ownership. */
  function resetFightPresentation() {
    movementRuntime.reset();
    latestNetStats = {};
    smoothingConfig = {
      interpDelayMs: FIGHT_INTERPOLATION_DELAY_MS,
      extrapolateMs: FIGHT_EXTRAPOLATE_MS,
    };
    resetLocalInputState();
    lastNetworkHudPaint = 0;
    refreshNetworkHud(performance.now(), true);
  }

  destroyFightNetworkSession = () => networkSession.destroy();
  networkSession.reset();

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

  socket.onEvent(SOCKET_EVENT.PLAYER_JOINED, ({ playerId }) => {
    showJoinToast(`Player ${playerId === "p1" ? "1" : "2"} joined the game`);
    announceOpponentJoined();
  });

  socket.onEvent(SOCKET_EVENT.PLAYER_LEFT, ({ playerId }) => {
    showJoinToast(`Player ${playerId === "p1" ? "1" : "2"} left the game`);
    opponentJoined = false;
    window.__kaboomOpponentJoined = null;
    rematchPending = false;
    gameOverFlag = false;
    hideEndGameModal();
  });

  // Server state updates
  socket.onEvent(SOCKET_EVENT.STATE, (serverState) => {
    if (!player1 || !player2 || !player1HealthBar || !player2HealthBar) {
      return;
    }

    const arrivalMs = performance.now();
    // Discrete updates use latest state immediately
    const { players, timer, gameOver, winner, started, startAt, connected } = serverState;
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

    const player1State = players.p1;
    const player2State = players.p2;

    // Facing direction (discrete)
    player1.flipX = player1State.dir === -1;
    player2.flipX = player2State.dir === -1;

    // Health bars (discrete)
    player1HealthBar.width = player1State.health;
    player2HealthBar.width = player2State.health;

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
    updatePlayerAnimation(player1, player1State, "player1");
    updatePlayerAnimation(player2, player2State, "player2");

    refreshNetworkHud(arrivalMs);
  });

  // Per-frame interpolated position updates
  onUpdate(() => {
    movementRuntime.step({ nowMs: performance.now() });
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
  destroyFightNetworkSession();
  destroyFightNetworkSession = () => {};
  registerRematchHandler(null);
  hideEndGameModal();
  resetLocalInputState();
  activeFightRuntime?.destroy?.();
  activeFightRuntime = null;
  interpolator.destroy?.();
  unsubscribeConnection?.();
  updateConnectionState({ status: "disconnected", ping: null });
  window.__kaboomOpponentJoined = null;

  socket.offEvent(SOCKET_EVENT.CONNECT);
  socket.offEvent(SOCKET_EVENT.ROOM_FULL);
  socket.offEvent(SOCKET_EVENT.GAME_JOINED);
  socket.offEvent(SOCKET_EVENT.REMATCH_REQUESTED);
  socket.offEvent(SOCKET_EVENT.REMATCH_STARTED);
  socket.offEvent(SOCKET_EVENT.PLAYER_JOINED);
  socket.offEvent(SOCKET_EVENT.PLAYER_LEFT);
  socket.offEvent(SOCKET_EVENT.STATE);
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
