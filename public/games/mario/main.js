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
import { LEVEL_1_1, buildOneOneTrack } from "/games/mario/levelData.js";

const GAME_SLUG = "mario";
const ROOM_READY_EVENT = "kaboom:room-ready";
const OPPONENT_JOIN_EVENT = "kaboom:opponent-joined";
const DISPOSE_GAME_EVENT = "kaboom:dispose-game";

const WIDTH = 1024;
const HEIGHT = 576;
const ROOM_STATUS_TTL_MS = 2200;

const LEVEL_TRACK = buildOneOneTrack();
const QBLOCK_FRAMES = [0, 0, 0, 0, 1, 2, 1];

const PLAYER_W = 16;
const PLAYER_H = 16;
const WALK_ACCEL = 920;
const RUN_ACCEL = 1320;
const AIR_ACCEL = 720;
const GROUND_FRICTION = 1080;
const AIR_DRAG = 180;
const MAX_WALK_SPEED = 125;
const MAX_RUN_SPEED = 175;
const JUMP_SPEED = 460;
const GRAVITY = 1450;
const MAX_FALL_SPEED = 760;

const INTERP_DELAY_MS = 42;
const INTERP_MAX_BUFFER = 16;
const PREDICTION_MAX_DT_SEC = 0.05;
const PREDICTION_CORRECTION_BLEND = 0.34;
const PREDICTION_CORRECTION_DECAY = 18;
const PREDICTION_HARD_SNAP_DIST = 72;

const FRAME_STANDING_X = 80;
const FRAME_WALK_X = 96;
const FRAME_JUMP_X = 160;
const FRAME_ROW_Y = 32;
const FRAME_SIZE = 16;
const RENDER_SCALE = 2.5;
const RENDER_W = FRAME_SIZE * RENDER_SCALE;
const RENDER_H = FRAME_SIZE * RENDER_SCALE;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function approach(value, target, step) {
  if (value < target) return Math.min(target, value + step);
  if (value > target) return Math.max(target, value - step);
  return target;
}

function intersects(a, b) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

const { canvas } = getGameDomRefs();
const { dpad, menu, actions } = getGameControls();

if (!canvas) {
  throw new Error("Mario requires #game-canvas in the platform view.");
}

const ctx = canvas.getContext("2d");
canvas.width = WIDTH;
canvas.height = HEIGHT;
canvas.style.width = "100%";
canvas.style.maxWidth = "100%";
canvas.style.display = "block";
canvas.style.objectFit = "contain";
canvas.style.objectPosition = "center";
canvas.style.height = "auto";
canvas.style.maxHeight = "100%";
canvas.style.imageRendering = "pixelated";

const socket = getGameSocket(GAME_SLUG);
let latestConnectionSnapshot = {
  status: socket.getConnectionState(),
  ping: socket.getPing(),
  pingP95Ms: null,
  jitterP95Ms: null,
  packetLossPct: 0,
};

const unsubscribeConnection = socket.onConnectionChange((snapshot) => {
  latestConnectionSnapshot = { ...latestConnectionSnapshot, ...snapshot };
  updateConnectionState(snapshot);
});

let roomUrl = "";
let gameId = null;
let hasJoined = false;
let myPlayerId = null;
let myRejoinToken = null;
let readyToPlay = false;
let opponentJoined = false;
let currentRoomId = null;

let latestServerState = null;
let shownGameOver = false;
let rematchPending = false;
let disposed = false;
let animationFrameId = 0;
let lastRenderSampleMs = performance.now();
let cameraX = 0;
let lastAudioStartAttemptMs = 0;

let statusMessage = "Joining room...";
let statusUntilMs = Date.now() + 2500;

const heldInput = {
  left: false,
  right: false,
  run: false,
  jump: false,
};
let jumpQueuedForPrediction = false;

const imageAssets = {
  playerRight: null,
  playerLeft: null,
  tiles: null,
  items: null,
  enemyLeft: null,
  enemyRight: null,
};

const audioAssets = {
  bgm: null,
  jump: null,
  clear: null,
  lose: null,
};

let assetsReady = false;
let assetsFailed = false;
let audioUnlocked = false;
let bgmPlaying = false;
let victorySoundPlayed = false;

const interpolationRuntimeOptions = {
  pingMs: 0,
  pingP95Ms: 0,
  jitterP95Ms: 0,
  packetLossPct: 0,
  nowMs: 0,
};

const localPrediction = {
  initialized: false,
  simX: 0,
  simY: 0,
  simVx: 0,
  simVy: 0,
  correctionX: 0,
  correctionY: 0,
};

function clearLocalPrediction() {
  localPrediction.initialized = false;
  localPrediction.simX = 0;
  localPrediction.simY = 0;
  localPrediction.simVx = 0;
  localPrediction.simVy = 0;
  localPrediction.correctionX = 0;
  localPrediction.correctionY = 0;
  jumpQueuedForPrediction = false;
}

function resetLocalPrediction(player) {
  if (!player) {
    clearLocalPrediction();
    return;
  }

  localPrediction.initialized = true;
  localPrediction.simX = Number.isFinite(player.x) ? player.x : 0;
  localPrediction.simY = Number.isFinite(player.y) ? player.y : 0;
  localPrediction.simVx = Number.isFinite(player.vx) ? player.vx : 0;
  localPrediction.simVy = Number.isFinite(player.vy) ? player.vy : 0;
  localPrediction.correctionX = 0;
  localPrediction.correctionY = 0;
}

function getTrack(state) {
  return {
    ...LEVEL_TRACK,
    worldWidth: Number.isFinite(state?.track?.worldWidth)
      ? state.track.worldWidth
      : LEVEL_TRACK.worldWidth,
    groundY: Number.isFinite(state?.track?.groundY)
      ? state.track.groundY
      : LEVEL_TRACK.groundY,
    finishX: Number.isFinite(state?.track?.finishX)
      ? state.track.finishX
      : LEVEL_TRACK.finishX,
    background: state?.track?.background || LEVEL_TRACK.background,
  };
}

function resolveHorizontalForPrediction(sim, solids, dt) {
  let nextX = sim.x + sim.vx * dt;
  const rect = { x: nextX, y: sim.y, w: PLAYER_W, h: PLAYER_H };

  for (let i = 0; i < solids.length; i += 1) {
    const solid = solids[i];
    if (!intersects(rect, solid)) continue;

    if (sim.vx > 0) {
      nextX = solid.x - PLAYER_W;
      rect.x = nextX;
      sim.vx = 0;
    } else if (sim.vx < 0) {
      nextX = solid.x + solid.w;
      rect.x = nextX;
      sim.vx = 0;
    }
  }

  sim.x = nextX;
}

function resolveVerticalForPrediction(sim, solids, dt) {
  let nextY = sim.y + sim.vy * dt;
  let grounded = false;
  const rect = { x: sim.x, y: nextY, w: PLAYER_W, h: PLAYER_H };

  for (let i = 0; i < solids.length; i += 1) {
    const solid = solids[i];
    if (!intersects(rect, solid)) continue;

    if (sim.vy > 0) {
      nextY = solid.y - PLAYER_H;
      rect.y = nextY;
      sim.vy = 0;
      grounded = true;
    } else if (sim.vy < 0) {
      nextY = solid.y + solid.h;
      rect.y = nextY;
      sim.vy = 0;
    }
  }

  sim.y = nextY;
  sim.onGround = grounded;
}

function estimateGrounded(simX, simY, solids, epsilon = 2) {
  const feetY = simY + PLAYER_H;
  for (let i = 0; i < solids.length; i += 1) {
    const solid = solids[i];
    const overlapX = simX < solid.x + solid.w && simX + PLAYER_W > solid.x;
    if (!overlapX) continue;
    if (Math.abs(feetY - solid.y) <= epsilon) return true;
  }
  return false;
}

function reconcileLocalPrediction(state) {
  if (!myPlayerId || !state?.players?.[myPlayerId]) {
    clearLocalPrediction();
    return;
  }

  const player = state.players[myPlayerId];

  if (!localPrediction.initialized) {
    resetLocalPrediction(player);
    return;
  }

  const predictiveActive = Boolean(
    state.started &&
      !state.gameOver &&
      player.connected &&
      !player.finished,
  );

  if (!predictiveActive) {
    resetLocalPrediction(player);
    return;
  }

  const renderedX = localPrediction.simX + localPrediction.correctionX;
  const renderedY = localPrediction.simY + localPrediction.correctionY;

  const errorX = (Number.isFinite(player.x) ? player.x : 0) - renderedX;
  const errorY = (Number.isFinite(player.y) ? player.y : 0) - renderedY;

  if (Math.abs(errorX) > PREDICTION_HARD_SNAP_DIST || Math.abs(errorY) > PREDICTION_HARD_SNAP_DIST) {
    resetLocalPrediction(player);
    return;
  }

  localPrediction.correctionX = clamp(
    localPrediction.correctionX + errorX * PREDICTION_CORRECTION_BLEND,
    -84,
    84,
  );
  localPrediction.correctionY = clamp(
    localPrediction.correctionY + errorY * PREDICTION_CORRECTION_BLEND,
    -84,
    84,
  );
}

function stepLocalPrediction(state, dtSec) {
  if (!myPlayerId || !state?.players?.[myPlayerId]) return null;

  const player = state.players[myPlayerId];
  const track = getTrack(state);
  const solids = LEVEL_TRACK.solids;
  const worldWidth = Number.isFinite(track.worldWidth) ? track.worldWidth : LEVEL_TRACK.worldWidth;
  const groundY = Number.isFinite(track.groundY) ? track.groundY : LEVEL_TRACK.groundY;

  if (!localPrediction.initialized) {
    resetLocalPrediction(player);
  }

  const dt = clamp(dtSec, 0, PREDICTION_MAX_DT_SEC);
  const predictiveActive = Boolean(
    state.started &&
      !state.gameOver &&
      player.connected &&
      !player.finished,
  );

  if (!predictiveActive) {
    const syncAlpha = Math.min(1, dt * 12);
    localPrediction.simX += ((Number.isFinite(player.x) ? player.x : 0) - localPrediction.simX) * syncAlpha;
    localPrediction.simY += ((Number.isFinite(player.y) ? player.y : 0) - localPrediction.simY) * syncAlpha;
    localPrediction.simVx += ((Number.isFinite(player.vx) ? player.vx : 0) - localPrediction.simVx) * syncAlpha;
    localPrediction.simVy += ((Number.isFinite(player.vy) ? player.vy : 0) - localPrediction.simVy) * syncAlpha;
    jumpQueuedForPrediction = false;
  } else {
    const groundedEstimate = estimateGrounded(localPrediction.simX, localPrediction.simY, solids);

    let moveDir = 0;
    if (heldInput.left && !heldInput.right) moveDir = -1;
    if (heldInput.right && !heldInput.left) moveDir = 1;

    if (moveDir !== 0) {
      const accel = groundedEstimate
        ? heldInput.run
          ? RUN_ACCEL
          : WALK_ACCEL
        : AIR_ACCEL;
      localPrediction.simVx += moveDir * accel * dt;
    } else {
      const drag = groundedEstimate ? GROUND_FRICTION : AIR_DRAG;
      localPrediction.simVx = approach(localPrediction.simVx, 0, drag * dt);
    }

    const maxSpeed = heldInput.run ? MAX_RUN_SPEED : MAX_WALK_SPEED;
    localPrediction.simVx = clamp(localPrediction.simVx, -maxSpeed, maxSpeed);

    const wantsJump = jumpQueuedForPrediction;
    jumpQueuedForPrediction = false;
    if (wantsJump && groundedEstimate) {
      localPrediction.simVy = -JUMP_SPEED;
    }

    localPrediction.simVy = clamp(localPrediction.simVy + GRAVITY * dt, -JUMP_SPEED, MAX_FALL_SPEED);

    const sim = {
      x: localPrediction.simX,
      y: localPrediction.simY,
      vx: localPrediction.simVx,
      vy: localPrediction.simVy,
      onGround: false,
    };

    resolveHorizontalForPrediction(sim, solids, dt);
    sim.x = clamp(sim.x, 0, worldWidth - PLAYER_W);
    resolveVerticalForPrediction(sim, solids, dt);

    if (sim.y > groundY + 260) {
      sim.y = LEVEL_TRACK.playerSpawn.y;
      sim.vy = 0;
      sim.vx = 0;
      sim.onGround = true;
    }

    localPrediction.simX = sim.x;
    localPrediction.simY = sim.y;
    localPrediction.simVx = sim.vx;
    localPrediction.simVy = sim.vy;
  }

  const decay = 1 / (1 + PREDICTION_CORRECTION_DECAY * dt);
  localPrediction.correctionX *= decay;
  localPrediction.correctionY *= decay;

  return {
    x: localPrediction.simX + localPrediction.correctionX,
    y: localPrediction.simY + localPrediction.correctionY,
    vx: localPrediction.simVx,
    vy: localPrediction.simVy,
  };
}

function extractMarioPositions(state) {
  const positions = {
    p1x: Number.isFinite(state?.players?.p1?.x) ? state.players.p1.x : 0,
    p1y: Number.isFinite(state?.players?.p1?.y) ? state.players.p1.y : 0,
    p2x: Number.isFinite(state?.players?.p2?.x) ? state.players.p2.x : 0,
    p2y: Number.isFinite(state?.players?.p2?.y) ? state.players.p2.y : 0,
  };

  const enemies = Array.isArray(state?.enemies) ? state.enemies : [];
  for (let i = 0; i < enemies.length; i += 1) {
    const enemy = enemies[i] || {};
    positions[`e${i}x`] = Number.isFinite(enemy.x) ? enemy.x : 0;
    positions[`e${i}y`] = Number.isFinite(enemy.y) ? enemy.y : 0;
  }

  return positions;
}

function extractMarioVelocities(state) {
  const velocities = {
    p1x: Number.isFinite(state?.players?.p1?.vx) ? state.players.p1.vx : 0,
    p1y: Number.isFinite(state?.players?.p1?.vy) ? state.players.p1.vy : 0,
    p2x: Number.isFinite(state?.players?.p2?.vx) ? state.players.p2.vx : 0,
    p2y: Number.isFinite(state?.players?.p2?.vy) ? state.players.p2.vy : 0,
  };

  const enemies = Array.isArray(state?.enemies) ? state.enemies : [];
  for (let i = 0; i < enemies.length; i += 1) {
    const enemy = enemies[i] || {};
    velocities[`e${i}x`] = Number.isFinite(enemy.vx) ? enemy.vx : 0;
    velocities[`e${i}y`] = Number.isFinite(enemy.vy) ? enemy.vy : 0;
  }

  return velocities;
}

const interpolator = createWorkerInterpolator({
  extractPositions: extractMarioPositions,
  extractVelocities: extractMarioVelocities,
  interpDelayMs: INTERP_DELAY_MS,
  maxBufferSize: INTERP_MAX_BUFFER,
});

function cloneRenderableState(state) {
  if (!state?.players) return state;
  return {
    ...state,
    track: state.track ? { ...state.track } : null,
    players: {
      p1: { ...state.players.p1 },
      p2: { ...state.players.p2 },
    },
    enemies: Array.isArray(state.enemies)
      ? state.enemies.map((enemy) => ({ ...enemy }))
      : [],
  };
}

function applyInterpolatedPose(renderState, pose) {
  if (!renderState?.players || !pose) return;

  if (Number.isFinite(pose.p1x)) renderState.players.p1.x = pose.p1x;
  if (Number.isFinite(pose.p1y)) renderState.players.p1.y = pose.p1y;
  if (Number.isFinite(pose.p2x)) renderState.players.p2.x = pose.p2x;
  if (Number.isFinite(pose.p2y)) renderState.players.p2.y = pose.p2y;

  if (!Array.isArray(renderState.enemies)) return;
  for (let i = 0; i < renderState.enemies.length; i += 1) {
    const enemy = renderState.enemies[i];
    if (!enemy) continue;
    const xKey = `e${i}x`;
    const yKey = `e${i}y`;
    if (Number.isFinite(pose[xKey])) enemy.x = pose[xKey];
    if (Number.isFinite(pose[yKey])) enemy.y = pose[yKey];
  }
}

function buildRenderStateForFrame(nowMs, dtSec) {
  if (!latestServerState?.players) return latestServerState;

  interpolationRuntimeOptions.pingMs = latestConnectionSnapshot?.ping;
  interpolationRuntimeOptions.pingP95Ms = latestConnectionSnapshot?.pingP95Ms;
  interpolationRuntimeOptions.jitterP95Ms = latestConnectionSnapshot?.jitterP95Ms;
  interpolationRuntimeOptions.packetLossPct = latestConnectionSnapshot?.packetLossPct;
  interpolationRuntimeOptions.nowMs = nowMs;

  const renderState = cloneRenderableState(latestServerState);
  const interpolatedPose = interpolator.getInterpolatedPositions(interpolationRuntimeOptions);
  applyInterpolatedPose(renderState, interpolatedPose);

  if (myPlayerId && renderState.players?.[myPlayerId]) {
    const predictedLocal = stepLocalPrediction(latestServerState, dtSec);
    if (predictedLocal) {
      renderState.players[myPlayerId].x = predictedLocal.x;
      renderState.players[myPlayerId].y = predictedLocal.y;
      renderState.players[myPlayerId].vx = predictedLocal.vx;
      renderState.players[myPlayerId].vy = predictedLocal.vy;
    }
  }

  return renderState;
}

function resetMarioNetcodeState(nextState = null) {
  interpolator.reset();
  clearLocalPrediction();
  lastRenderSampleMs = performance.now();
  if (nextState?.players?.[myPlayerId]) {
    resetLocalPrediction(nextState.players[myPlayerId]);
  }
}

function setStatus(message, ttlMs = ROOM_STATUS_TTL_MS) {
  statusMessage = message;
  statusUntilMs = Date.now() + ttlMs;
}

function buildRoomUrl(roomId) {
  return `${window.location.origin}/games/${GAME_SLUG}/${roomId}`;
}

function setRoomLink(url) {
  roomUrl = url;
}

function announceRoomReady(roomId) {
  if (!roomId) return;
  if (roomId !== currentRoomId) {
    currentRoomId = roomId;
    opponentJoined = false;
    window.__kaboomOpponentJoined = null;
  }
  window.dispatchEvent(new CustomEvent(ROOM_READY_EVENT, { detail: { gameId: GAME_SLUG, roomId } }));
}

function announceOpponentJoined() {
  if (!gameId) return;
  window.__kaboomOpponentJoined = { gameId: GAME_SLUG, roomId: gameId };
  window.dispatchEvent(new CustomEvent(OPPONENT_JOIN_EVENT, { detail: { gameId: GAME_SLUG, roomId: gameId } }));
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
    const response = await fetch(`/api/games/${GAME_SLUG}/new-room`);
    if (!response.ok) throw new Error("Failed to create room");
    const data = await response.json();
    const roomId = data?.roomId || Math.random().toString(36).slice(2, 8);
    const url = data?.url || buildRoomUrl(roomId);
    window.history.replaceState({}, "", `/games/${GAME_SLUG}/${roomId}`);
    setRoomLink(url);
    announceRoomReady(roomId);
    return roomId;
  } catch {
    const fallback = Math.random().toString(36).slice(2, 8);
    window.history.replaceState({}, "", `/games/${GAME_SLUG}/${fallback}`);
    setRoomLink(buildRoomUrl(fallback));
    announceRoomReady(fallback);
    return fallback;
  }
}

function resultLabel(winner) {
  if (!winner || winner === "tie") return "Tie finish";
  if (!myPlayerId) return winner === "p1" ? "Player 1 wins" : "Player 2 wins";
  return winner === myPlayerId ? "You won the race" : "Rival won the race";
}

function sendInput(type, value) {
  if (!readyToPlay) return;
  socket.send("input", { type, value });
}

function setHoldInput(type, active) {
  if (heldInput[type] === active) return;
  heldInput[type] = active;
  sendInput(type, active);
}

function releaseAllInputs() {
  setHoldInput("left", false);
  setHoldInput("right", false);
  setHoldInput("run", false);
  setHoldInput("jump", false);
}

function triggerJump(active) {
  setHoldInput("jump", Boolean(active));
  if (active) {
    jumpQueuedForPrediction = true;
    playJumpSound();
  }
}

function tryJoinGame() {
  if (!socket.isConnected() || !gameId || hasJoined) return;

  let token = myRejoinToken;
  if (!token) {
    try {
      token = sessionStorage.getItem(`rejoinToken:${GAME_SLUG}:${gameId}`);
    } catch {
      // Ignore sessionStorage failures.
    }
  }

  socket.send("joinGame", { gameId, rejoinToken: token || undefined });
  hasJoined = true;
}

function onStartAction() {
  if (roomUrl) {
    openShareModal();
    return;
  }

  ensureRoomId().finally(() => {
    openShareModal();
  });
}

function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;

  if (audioAssets.bgm) {
    audioAssets.bgm.volume = 0.36;
    audioAssets.bgm.loop = true;
  }
}

function tryStartBgm() {
  if (!audioUnlocked || !audioAssets.bgm || bgmPlaying) return;

  const now = Date.now();
  if (now - lastAudioStartAttemptMs < 300) return;
  lastAudioStartAttemptMs = now;

  const promise = audioAssets.bgm.play();
  if (promise && typeof promise.then === "function") {
    promise
      .then(() => {
        bgmPlaying = true;
      })
      .catch(() => {
        bgmPlaying = false;
      });
  } else {
    bgmPlaying = true;
  }
}

function pauseBgm() {
  if (!audioAssets.bgm || !bgmPlaying) return;
  audioAssets.bgm.pause();
  bgmPlaying = false;
}

function playJumpSound() {
  if (!audioUnlocked || !audioAssets.jump) return;
  try {
    audioAssets.jump.currentTime = 0;
    audioAssets.jump.play();
  } catch {
    // Ignore blocked audio play.
  }
}

function playResultSound(winner) {
  if (!audioUnlocked) return;
  if (winner === myPlayerId && audioAssets.clear) {
    try {
      audioAssets.clear.currentTime = 0;
      audioAssets.clear.play();
    } catch {
      // Ignore blocked audio play.
    }
    return;
  }
  if (audioAssets.lose) {
    try {
      audioAssets.lose.currentTime = 0;
      audioAssets.lose.play();
    } catch {
      // Ignore blocked audio play.
    }
  }
}

function initControllerNavigation() {
  const cleanups = [];

  cleanups.push(dpad.left.onHold(() => setHoldInput("left", true), () => setHoldInput("left", false)));
  cleanups.push(dpad.right.onHold(() => setHoldInput("right", true), () => setHoldInput("right", false)));
  cleanups.push(dpad.up.onHold(() => triggerJump(true), () => triggerJump(false)));
  cleanups.push(actions.a.onHold(() => triggerJump(true), () => triggerJump(false)));
  cleanups.push(actions.x.onHold(() => triggerJump(true), () => triggerJump(false)));
  cleanups.push(actions.b.onHold(() => setHoldInput("run", true), () => setHoldInput("run", false)));
  cleanups.push(menu.start.onPress(() => onStartAction()));

  return () => {
    cleanups.forEach((cleanup) => {
      if (typeof cleanup === "function") cleanup();
    });
  };
}

function initKeyboardNavigation() {
  const pressed = new Set();

  const downMap = {
    ArrowLeft: () => setHoldInput("left", true),
    a: () => setHoldInput("left", true),
    A: () => setHoldInput("left", true),
    ArrowRight: () => setHoldInput("right", true),
    d: () => setHoldInput("right", true),
    D: () => setHoldInput("right", true),
    Shift: () => setHoldInput("run", true),
    z: () => setHoldInput("run", true),
    Z: () => setHoldInput("run", true),
    x: () => triggerJump(true),
    X: () => triggerJump(true),
    ArrowUp: () => triggerJump(true),
    " ": () => triggerJump(true),
    Enter: () => onStartAction(),
  };

  const upMap = {
    ArrowLeft: () => setHoldInput("left", false),
    a: () => setHoldInput("left", false),
    A: () => setHoldInput("left", false),
    ArrowRight: () => setHoldInput("right", false),
    d: () => setHoldInput("right", false),
    D: () => setHoldInput("right", false),
    Shift: () => setHoldInput("run", false),
    z: () => setHoldInput("run", false),
    Z: () => setHoldInput("run", false),
    x: () => triggerJump(false),
    X: () => triggerJump(false),
    ArrowUp: () => triggerJump(false),
    " ": () => triggerJump(false),
  };

  const onKeyDown = (event) => {
    const tag = event.target?.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;

    const action = downMap[event.key];
    if (!action) return;
    if (event.repeat) return;

    event.preventDefault();
    if (pressed.has(event.key)) return;

    unlockAudio();
    pressed.add(event.key);
    action();
  };

  const onKeyUp = (event) => {
    const action = upMap[event.key];
    if (!action) return;
    event.preventDefault();
    pressed.delete(event.key);
    action();
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("pointerdown", unlockAudio, { passive: true });

  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("pointerdown", unlockAudio);
  };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    image.src = src;
  });
}

async function loadAssets() {
  const [playerRight, playerLeft, tiles, items, enemyLeft, enemyRight] = await Promise.all([
    loadImage(`/games/${GAME_SLUG}/assets/sprites/player.png`),
    loadImage(`/games/${GAME_SLUG}/assets/sprites/playerl.png`),
    loadImage(`/games/${GAME_SLUG}/assets/sprites/tiles.png`),
    loadImage(`/games/${GAME_SLUG}/assets/sprites/items.png`),
    loadImage(`/games/${GAME_SLUG}/assets/sprites/enemy.png`),
    loadImage(`/games/${GAME_SLUG}/assets/sprites/enemyr.png`),
  ]);

  imageAssets.playerRight = playerRight;
  imageAssets.playerLeft = playerLeft;
  imageAssets.tiles = tiles;
  imageAssets.items = items;
  imageAssets.enemyLeft = enemyLeft;
  imageAssets.enemyRight = enemyRight;

  const bgm = new Audio(`/games/${GAME_SLUG}/assets/sounds/aboveground_bgm.ogg`);
  const jump = new Audio(`/games/${GAME_SLUG}/assets/sounds/jump-small.wav`);
  const clear = new Audio(`/games/${GAME_SLUG}/assets/sounds/stage_clear.wav`);
  const lose = new Audio(`/games/${GAME_SLUG}/assets/sounds/mariodie.wav`);
  bgm.loop = true;

  audioAssets.bgm = bgm;
  audioAssets.jump = jump;
  audioAssets.clear = clear;
  audioAssets.lose = lose;

  assetsReady = true;
}

function drawRoundedRect(x, y, w, h, radius, fillStyle, strokeStyle = null) {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();
  if (strokeStyle) {
    ctx.strokeStyle = strokeStyle;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawBackground(track) {
  ctx.fillStyle = track.background || LEVEL_1_1.background;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const skyFade = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  skyFade.addColorStop(0, "rgba(255,255,255,0.08)");
  skyFade.addColorStop(1, "rgba(0,0,0,0.08)");
  ctx.fillStyle = skyFade;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

function resolveSheetImage(sheet) {
  if (sheet === "items") return imageAssets.items;
  return imageAssets.tiles;
}

function drawTileEntry(entry) {
  const image = resolveSheetImage(entry.sheet);
  if (!image || !entry) return;

  const dx = Math.round(entry.x - cameraX);
  const dy = Math.round(entry.y);
  const dw = entry.dw || entry.sw;
  const dh = entry.dh || entry.sh;

  if (dx + dw < -24 || dx > WIDTH + 24 || dy + dh < -24 || dy > HEIGHT + 24) {
    return;
  }

  ctx.drawImage(
    image,
    entry.sx,
    entry.sy,
    entry.sw,
    entry.sh,
    dx,
    dy,
    dw,
    dh,
  );
}

function drawStaticLayer(entries) {
  for (let i = 0; i < entries.length; i += 1) {
    drawTileEntry(entries[i]);
  }
}

function drawAnimatedQBlocks(entries, nowMs) {
  if (!imageAssets.tiles) return;
  const frame = QBLOCK_FRAMES[Math.floor(nowMs / 110) % QBLOCK_FRAMES.length];
  const sx = 384 + frame * 16;

  for (let i = 0; i < entries.length; i += 1) {
    const block = entries[i];
    if (!block) continue;

    const dx = Math.round(block.x - cameraX);
    const dy = Math.round(block.y);
    if (dx + 16 < -24 || dx > WIDTH + 24) continue;

    ctx.drawImage(imageAssets.tiles, sx, 0, 16, 16, dx, dy, 16, 16);
  }
}

function drawPlayerLabel(text, x, y, isSelf) {
  if (!text) return;
  ctx.font = "bold 12px monospace";
  const padX = 6;
  const width = Math.ceil(ctx.measureText(text).width) + padX * 2;
  const height = 20;
  const left = Math.round(x - width / 2);
  const top = Math.round(y - height - 8);

  drawRoundedRect(
    left,
    top,
    width,
    height,
    6,
    "rgba(15, 23, 42, 0.86)",
    isSelf ? "#38bdf8" : "#f97316",
  );

  ctx.fillStyle = "#f8fafc";
  ctx.fillText(text, left + padX, top + 14);
}

function getPlayerFrame(player, nowMs) {
  if (!player) return FRAME_STANDING_X;

  if (!player.onGround) {
    return FRAME_JUMP_X;
  }

  const speed = Math.abs(player.vx || 0);
  if (speed > 10) {
    const frame = Math.floor(nowMs / 95) % 3;
    return FRAME_WALK_X + frame * FRAME_SIZE;
  }

  return FRAME_STANDING_X;
}

function drawPlayer(playerId, player, nowMs) {
  if (!player) return;

  const image = player.facing < 0 ? imageAssets.playerLeft : imageAssets.playerRight;
  const frameX = getPlayerFrame(player, nowMs);

  const dx = Math.round(player.x - cameraX - (RENDER_W - PLAYER_W) / 2);
  const dy = Math.round(player.y - (RENDER_H - PLAYER_H));

  if (image) {
    ctx.drawImage(
      image,
      frameX,
      FRAME_ROW_Y,
      FRAME_SIZE,
      FRAME_SIZE,
      dx,
      dy,
      RENDER_W,
      RENDER_H,
    );
  } else {
    ctx.fillStyle = playerId === myPlayerId ? "#38bdf8" : "#f97316";
    ctx.fillRect(dx, dy, RENDER_W, RENDER_H);
  }

  const label = playerId === myPlayerId ? "You" : "Rival";
  drawPlayerLabel(label, dx + RENDER_W / 2, dy, playerId === myPlayerId);
}

function drawEnemy(enemy, nowMs) {
  if (!enemy || !enemy.alive) return;

  const dx = Math.round(enemy.x - cameraX);
  if (dx + 24 < -40 || dx > WIDTH + 40) return;

  if (enemy.type === "goomba") {
    const image = imageAssets.enemyLeft;
    if (!image) return;

    const stomped = Boolean(enemy.stomped);
    const frame = stomped ? 2 : Math.floor(nowMs / 160) % 2;
    const sx = frame * 16;
    const sy = 16;
    const sw = 16;
    const sh = 16;

    ctx.drawImage(image, sx, sy, sw, sh, dx, Math.round(enemy.y), sw * 2, sh * 2);
    return;
  }

  if (enemy.type === "koopa") {
    const stomped = Boolean(enemy.stomped);
    const facingRight = enemy.facing > 0;
    const image = facingRight ? imageAssets.enemyRight : imageAssets.enemyLeft;
    if (!image) return;

    if (stomped) {
      ctx.drawImage(image, 160, 0, 16, 16, dx, Math.round(enemy.y), 32, 32);
      return;
    }

    const frame = Math.floor(nowMs / 190) % 2;
    const sx = 96 + frame * 16;
    const sy = 0;
    const sw = 16;
    const sh = 32;
    ctx.drawImage(image, sx, sy, sw, sh, dx, Math.round(enemy.y), sw * 2, sh * 2);
  }
}

function drawEnemies(enemies, nowMs) {
  if (!Array.isArray(enemies)) return;
  for (let i = 0; i < enemies.length; i += 1) {
    drawEnemy(enemies[i], nowMs);
  }
}

function drawProgressBar(state, myPlayer, rivalPlayer) {
  if (!state || !myPlayer || !rivalPlayer) return;

  const track = getTrack(state);
  const raceDistance = Math.max(1, track.finishX);

  const myProgress = clamp((myPlayer.x + PLAYER_W) / raceDistance, 0, 1);
  const rivalProgress = clamp((rivalPlayer.x + PLAYER_W) / raceDistance, 0, 1);

  const barX = 118;
  const barY = HEIGHT - 56;
  const barW = WIDTH - 236;
  const barH = 14;

  ctx.fillStyle = "rgba(2, 6, 23, 0.8)";
  ctx.fillRect(barX - 12, barY - 18, barW + 24, barH + 38);

  ctx.fillStyle = "#1e293b";
  ctx.fillRect(barX, barY, barW, barH);

  ctx.fillStyle = "#38bdf8";
  ctx.fillRect(barX, barY, Math.max(2, Math.round(barW * myProgress)), barH);

  const rivalX = clamp(barX + Math.round(barW * rivalProgress), barX, barX + barW);
  ctx.fillStyle = "#f97316";
  ctx.fillRect(rivalX - 2, barY - 3, 4, barH + 6);

  ctx.fillStyle = "#f8fafc";
  ctx.font = "bold 12px monospace";
  ctx.fillText("YOU", barX, barY - 5);
  ctx.fillText("RIVAL", barX + barW - 42, barY - 5);
}

function drawHud(state) {
  const myPlayer = state?.players?.[myPlayerId] || state?.players?.p1 || null;
  const rivalPlayer = myPlayerId === "p1" ? state?.players?.p2 : state?.players?.p1;

  ctx.fillStyle = "rgba(15,23,42,0.78)";
  ctx.fillRect(18, 18, 320, 96);

  const myRank = myPlayer?.rank || "-";
  const speed = Math.round(Math.abs(myPlayer?.vx || 0));

  ctx.fillStyle = "#f8fafc";
  ctx.font = "bold 24px monospace";
  ctx.fillText(`${speed}`, 36, 50);
  ctx.font = "bold 12px monospace";
  ctx.fillText("SPEED", 108, 50);

  ctx.font = "bold 22px monospace";
  ctx.fillText(`RANK ${myRank}/2`, 36, 82);

  if (Date.now() < statusUntilMs && statusMessage) {
    const message = statusMessage;
    const width = Math.min(620, Math.ceil(ctx.measureText(message).width) + 32);
    const x = WIDTH / 2 - width / 2;
    const y = HEIGHT - 116;
    drawRoundedRect(x, y, width, 42, 8, "rgba(2, 6, 23, 0.78)");
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 19px monospace";
    ctx.fillText(message, x + 16, y + 27);
  }

  if (state && !state.started && !state.gameOver) {
    const bothConnected = state.players?.p1?.connected && state.players?.p2?.connected;
    drawRoundedRect(WIDTH / 2 - 240, HEIGHT / 2 - 88, 480, 176, 14, "rgba(2,6,23,0.82)", "#7dd3fc");
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 30px monospace";
    const msg = bothConnected ? "Race begins soon" : "Waiting for rival...";
    const msgW = ctx.measureText(msg).width;
    ctx.fillText(msg, WIDTH / 2 - msgW / 2, HEIGHT / 2 - 10);

    if (bothConnected && state.startAt) {
      const remaining = Math.max(0, Math.ceil((state.startAt - Date.now()) / 1000));
      const countdown = remaining > 0 ? String(remaining) : "GO";
      ctx.font = "bold 52px monospace";
      const cW = ctx.measureText(countdown).width;
      ctx.fillText(countdown, WIDTH / 2 - cW / 2, HEIGHT / 2 + 58);
    }
  }

  if (myPlayer && rivalPlayer) {
    drawProgressBar(state, myPlayer, rivalPlayer);
  }
}

function renderMarioWorld(state, nowMs) {
  const track = getTrack(state);
  const myPlayer = state?.players?.[myPlayerId] || state?.players?.p1;

  if (myPlayer) {
    const targetCamera = clamp(
      myPlayer.x - WIDTH * 0.34,
      0,
      Math.max(0, track.worldWidth - WIDTH),
    );
    cameraX = lerp(cameraX, targetCamera, 0.18);
  } else {
    cameraX = lerp(cameraX, 0, 0.1);
  }

  drawBackground(track);
  drawStaticLayer(LEVEL_TRACK.render.sceneryTiles);
  drawStaticLayer(LEVEL_TRACK.render.flagTiles);
  drawEnemies(state?.enemies, nowMs);
  drawStaticLayer(LEVEL_TRACK.render.terrainTiles);
  drawAnimatedQBlocks(LEVEL_TRACK.render.qBlockTiles, nowMs);

  if (state?.players?.p1) drawPlayer("p1", state.players.p1, nowMs);
  if (state?.players?.p2) drawPlayer("p2", state.players.p2, nowMs);

  drawStaticLayer(LEVEL_TRACK.render.pipeTiles);
  drawHud(state);
}

function renderFrame() {
  if (disposed) return;

  const nowMs = performance.now();

  if (!assetsReady) {
    ctx.fillStyle = "#0b1020";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 30px monospace";
    const text = assetsFailed ? "Asset load failed" : "Loading Mario assets...";
    const tw = ctx.measureText(text).width;
    ctx.fillText(text, WIDTH / 2 - tw / 2, HEIGHT / 2);
    animationFrameId = requestAnimationFrame(renderFrame);
    return;
  }

  const dtSec = Math.max(0, Math.min((nowMs - lastRenderSampleMs) / 1000, PREDICTION_MAX_DT_SEC));
  lastRenderSampleMs = nowMs;

  const renderState = buildRenderStateForFrame(nowMs, dtSec);
  renderMarioWorld(renderState, nowMs);

  const raceActive = Boolean(renderState?.started && !renderState?.gameOver);
  if (raceActive) {
    tryStartBgm();
  } else if (renderState?.gameOver) {
    pauseBgm();
  }

  animationFrameId = requestAnimationFrame(renderFrame);
}

registerRematchHandler(() => {
  if (rematchPending) return;
  rematchPending = true;
  updateEndGameModal({
    status: "Waiting for rival...",
    phase: "waiting",
  });
  socket.send("rematch");
});

socket.onEvent("connect", () => {
  hasJoined = false;
  latestServerState = null;
  resetMarioNetcodeState(null);

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
  setStatus("Room is full", 3500);
});

socket.onEvent("gameJoined", ({ playerId, gameId: joinedGameId, rejoinToken }) => {
  myPlayerId = playerId;
  myRejoinToken = rejoinToken || null;
  readyToPlay = true;
  gameId = gameId || joinedGameId;
  resetMarioNetcodeState(null);

  if (rejoinToken && gameId) {
    try {
      sessionStorage.setItem(`rejoinToken:${GAME_SLUG}:${gameId}`, rejoinToken);
    } catch {
      // Ignore sessionStorage failures.
    }
  }

  setRoomLink(buildRoomUrl(gameId));
  announceRoomReady(gameId);
  setStatus(`Joined as ${playerId.toUpperCase()}`);
});

socket.onEvent("playerJoined", ({ playerId }) => {
  if (playerId !== myPlayerId) {
    setStatus("Rival joined the race");
    if (!opponentJoined) {
      opponentJoined = true;
      announceOpponentJoined();
    }
  }
});

socket.onEvent("playerLeft", ({ playerId }) => {
  if (playerId !== myPlayerId) {
    setStatus("Rival disconnected", 3200);
    opponentJoined = false;
    window.__kaboomOpponentJoined = null;
    rematchPending = false;
    shownGameOver = false;
    hideEndGameModal();
  }
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
  shownGameOver = false;
  victorySoundPlayed = false;
  latestServerState = null;
  resetMarioNetcodeState(null);
  releaseAllInputs();
  hideEndGameModal();
  setStatus("Rematch started");
});

socket.onEvent("state", (state) => {
  if (!state || !state.players) return;

  latestServerState = state;
  interpolator.pushState(state);
  reconcileLocalPrediction(state);

  const connected = state.players;
  if (!opponentJoined && connected?.p1?.connected && connected?.p2?.connected) {
    opponentJoined = true;
    announceOpponentJoined();
  }

  if (state.gameOver && !shownGameOver) {
    shownGameOver = true;
    rematchPending = false;

    showEndGameModal({
      title: "Race Over",
      subtitle: resultLabel(state.winner),
      status: "",
      phase: "ready",
      winner: state.winner,
    });

    if (!victorySoundPlayed) {
      playResultSound(state.winner);
      victorySoundPlayed = true;
    }
  } else if (!state.gameOver && shownGameOver) {
    shownGameOver = false;
    victorySoundPlayed = false;
    hideEndGameModal();
  }
});

const cleanupControllerNavigation = initControllerNavigation();
const cleanupKeyboardNavigation = initKeyboardNavigation();

function disposeGameRuntime() {
  if (disposed) return;
  disposed = true;

  releaseAllInputs();
  cleanupControllerNavigation?.();
  cleanupKeyboardNavigation?.();
  registerRematchHandler(null);
  hideEndGameModal();
  window.__kaboomOpponentJoined = null;

  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = 0;
  }

  pauseBgm();

  unsubscribeConnection?.();
  updateConnectionState({ status: "disconnected", ping: null });
  interpolator.destroy?.();
  latestServerState = null;
  clearLocalPrediction();

  socket.offEvent("connect");
  socket.offEvent("roomFull");
  socket.offEvent("gameJoined");
  socket.offEvent("playerJoined");
  socket.offEvent("playerLeft");
  socket.offEvent("rematchRequested");
  socket.offEvent("rematchStarted");
  socket.offEvent("state");
  socket.destroy?.();

  window.removeEventListener(DISPOSE_GAME_EVENT, handleDisposeEvent);
}

function handleDisposeEvent(event) {
  const targetGameId = event?.detail?.gameId;
  if (!targetGameId || targetGameId === GAME_SLUG) {
    disposeGameRuntime();
  }
}

window.addEventListener(DISPOSE_GAME_EVENT, handleDisposeEvent);

ensureRoomId().then((id) => {
  gameId = id;
  tryJoinGame();
});

loadAssets().catch((error) => {
  console.error(error);
  assetsFailed = true;
});

renderFrame();
