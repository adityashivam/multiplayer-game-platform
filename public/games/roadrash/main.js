import { getGameControls, getGameDomRefs } from "/platform/shared/gameDom.js";
import { getGameSocket } from "/platform/shared/gameSocket.js";
import {
  hideEndGameModal,
  registerRematchHandler,
  showEndGameModal,
  updateEndGameModal,
} from "/platform/shared/endGameBridge.js";
import { openShareModal } from "/platform/shared/shareModalBridge.js";
import { updateConnectionState } from "/platform/shared/connectionBridge.js";

const GAME_SLUG = "roadrash";
const ROOM_READY_EVENT = "kaboom:room-ready";
const OPPONENT_JOIN_EVENT = "kaboom:opponent-joined";
const DISPOSE_GAME_EVENT = "kaboom:dispose-game";

const WIDTH = 1280;
const HEIGHT = 720;

const SEGMENT_LENGTH = 200;
const RUMBLE_LENGTH = 3;
const ROAD_WIDTH = 2000;
const LANES = 2;
const FIELD_OF_VIEW = 100;
const CAMERA_HEIGHT = 1000;
const DRAW_DISTANCE = 260;
const CAMERA_DEPTH = 1 / Math.tan((FIELD_OF_VIEW / 2) * (Math.PI / 180));
const PLAYER_Z = CAMERA_HEIGHT * CAMERA_DEPTH;
const RESOLUTION = HEIGHT / 480;
const MAX_SPEED_FOR_HUD = 28500;

const COLORS = {
  SKY: "#72D7EE",
  LIGHT: { road: "#696969", rumble: "#ffffff", lane: "#ffffff", shoulder: "#5f6a5f" },
  DARK: { road: "#5f5f5f", rumble: "#999999", lane: "#cfcfcf", shoulder: "#4d5d4f" },
};

const SPRITES = {
  BIKE01: { x: 111, y: 0, w: 21, h: 50 },
  BIKE02: { x: 132, y: 0, w: 23, h: 50 },
  BIKE03: { x: 155, y: 0, w: 24, h: 50 },
  CAR01: { x: 260, y: 0, w: 86, h: 70 },
  CAR02: { x: 179, y: 65, w: 82, h: 75 },
  PLAYER_KICK_LEFT: { x: 179, y: 0, w: 34, h: 50 },
  PLAYER_KICK_RIGHT: { x: 213, y: 0, w: 34, h: 50 },
  PLAYER_LEFT: { x: 27, y: 0, w: 25, h: 50 },
  PLAYER_STRAIGHT: { x: 0, y: 0, w: 21, h: 50 },
  PLAYER_RIGHT: { x: 58, y: 0, w: 25, h: 50 },
};

SPRITES.SCALE = 0.1 * (1 / SPRITES.PLAYER_STRAIGHT.w);

const TRAFFIC_BIKE_SPRITES = [SPRITES.BIKE01, SPRITES.BIKE02, SPRITES.BIKE03];
const TRAFFIC_CAR_SPRITES = [SPRITES.CAR01, SPRITES.CAR02];

const ROOM_STATUS_TTL_MS = 2200;

const { canvas } = getGameDomRefs();
const { dpad, menu, actions } = getGameControls();

if (!canvas) {
  throw new Error("Road Rash requires #game-canvas in the platform view.");
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

const socket = getGameSocket(GAME_SLUG);
const unsubscribeConnection = socket.onConnectionChange((snapshot) => {
  updateConnectionState(snapshot);
});

let roomUrl = "";
let gameId = null;
let hasJoined = false;
let myPlayerId = null;
let myRejoinToken = null;
let readyToPlay = false;
let currentRoomId = null;
let opponentJoined = false;

let latestState = null;
let shownGameOver = false;
let rematchPending = false;
let animationFrameId = 0;
let disposed = false;

let statusMessage = "Joining room...";
let statusUntilMs = Date.now() + 2500;

const heldInput = {
  left: false,
  right: false,
  throttle: false,
  brake: false,
};

const imageAssets = {
  background: null,
  sprites: null,
};

let assetsReady = false;
let assetsFailed = false;

const segments = [];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function wrap(value, max) {
  if (!Number.isFinite(max) || max <= 0) return value;
  let out = value;
  while (out >= max) out -= max;
  while (out < 0) out += max;
  return out;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function percentRemaining(n, total) {
  return (n % total) / total;
}

function project(point, cameraX, cameraY, cameraZ, trackLength) {
  const z = point.world.z;
  const looped = z < cameraZ ? z + trackLength : z;
  point.camera.x = point.world.x - cameraX;
  point.camera.y = point.world.y - cameraY;
  point.camera.z = looped - cameraZ;
  point.screen.scale = CAMERA_DEPTH / Math.max(0.0001, point.camera.z);
  point.screen.x = Math.round((WIDTH / 2) + point.screen.scale * point.camera.x * WIDTH / 2);
  point.screen.y = Math.round((HEIGHT / 2) - point.screen.scale * point.camera.y * HEIGHT / 2);
  point.screen.w = Math.round(point.screen.scale * ROAD_WIDTH * WIDTH / 2);
}

function polygon(x1, y1, x2, y2, x3, y3, x4, y4, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.lineTo(x3, y3);
  ctx.lineTo(x4, y4);
  ctx.closePath();
  ctx.fill();
}

function rumbleWidth(projectedRoadWidth) {
  return projectedRoadWidth / Math.max(6, 2 * LANES);
}

function laneMarkerWidth(projectedRoadWidth) {
  return projectedRoadWidth / Math.max(32, 8 * LANES);
}

function drawSegment(segment) {
  const p1 = segment.p1.screen;
  const p2 = segment.p2.screen;
  const color = segment.color;

  const r1 = rumbleWidth(p1.w);
  const r2 = rumbleWidth(p2.w);
  const l1 = laneMarkerWidth(p1.w);
  const l2 = laneMarkerWidth(p2.w);

  ctx.fillStyle = color.shoulder;
  ctx.fillRect(0, p2.y, WIDTH, p1.y - p2.y);

  polygon(p1.x - p1.w - r1, p1.y, p1.x - p1.w, p1.y, p2.x - p2.w, p2.y, p2.x - p2.w - r2, p2.y, color.rumble);
  polygon(p1.x + p1.w + r1, p1.y, p1.x + p1.w, p1.y, p2.x + p2.w, p2.y, p2.x + p2.w + r2, p2.y, color.rumble);
  polygon(p1.x - p1.w, p1.y, p1.x + p1.w, p1.y, p2.x + p2.w, p2.y, p2.x - p2.w, p2.y, color.road);

  const laneW1 = (p1.w * 2) / LANES;
  const laneW2 = (p2.w * 2) / LANES;
  let laneX1 = p1.x - p1.w + laneW1;
  let laneX2 = p2.x - p2.w + laneW2;
  for (let lane = 1; lane < LANES; lane += 1, laneX1 += laneW1, laneX2 += laneW2) {
    polygon(laneX1 - l1 / 2, p1.y, laneX1 + l1 / 2, p1.y, laneX2 + l2 / 2, p2.y, laneX2 - l2 / 2, p2.y, color.lane);
  }
}

function drawSprite(sprite, scale, destX, destY, offsetX = -0.5, offsetY = -1, clipY = null) {
  if (!imageAssets.sprites || !sprite) return;

  const { destW, destH } = spriteScreenSize(sprite, scale);
  const x = destX + destW * offsetX;
  const y = destY + destH * offsetY;

  const clipH = clipY == null ? 0 : Math.max(0, y + destH - clipY);
  if (clipH >= destH) return;

  ctx.drawImage(
    imageAssets.sprites,
    sprite.x,
    sprite.y,
    sprite.w,
    sprite.h - (sprite.h * clipH) / destH,
    x,
    y,
    destW,
    destH - clipH,
  );
}

function spriteScreenSize(sprite, scale) {
  return {
    destW: sprite.w * scale * (WIDTH / 2) * (SPRITES.SCALE * ROAD_WIDTH),
    destH: sprite.h * scale * (WIDTH / 2) * (SPRITES.SCALE * ROAD_WIDTH),
  };
}

function drawRiderLabel(x, topY, text, tint = "#1d4ed8") {
  if (!text) return;
  ctx.font = "bold 12px monospace";
  const padX = 6;
  const padY = 3;
  const labelW = Math.ceil(ctx.measureText(text).width) + padX * 2;
  const labelH = 16 + padY * 2;
  const boxX = Math.round(x - labelW / 2);
  const boxY = Math.round(topY - labelH - 6);

  ctx.fillStyle = "rgba(2, 6, 23, 0.9)";
  ctx.fillRect(boxX, boxY, labelW, labelH);
  ctx.strokeStyle = tint;
  ctx.lineWidth = 1;
  ctx.strokeRect(boxX + 0.5, boxY + 0.5, labelW - 1, labelH - 1);
  ctx.fillStyle = "#f8fafc";
  ctx.fillText(text, boxX + padX, boxY + labelH - 6);
}

function addSegment(curve, y) {
  const n = segments.length;
  const prevY = n === 0 ? 0 : segments[n - 1].p2.world.y;
  segments.push({
    index: n,
    p1: { world: { x: 0, y: prevY, z: n * SEGMENT_LENGTH }, camera: {}, screen: {} },
    p2: { world: { x: 0, y, z: (n + 1) * SEGMENT_LENGTH }, camera: {}, screen: {} },
    curve,
    color: Math.floor(n / RUMBLE_LENGTH) % 2 ? COLORS.DARK : COLORS.LIGHT,
    clip: HEIGHT,
  });
}

function buildTrack(totalSegments = 600) {
  segments.length = 0;
  let y = 0;

  for (let n = 0; n < totalSegments; n += 1) {
    const primary = Math.sin(n / 23) * 2.1;
    const secondary = Math.sin(n / 51 + 1.7) * 1.6;
    const curve = primary + secondary;
    y += Math.sin(n / 19) * 8;
    addSegment(curve, y);
  }
}

function findSegment(z, trackLength) {
  if (segments.length === 0) return null;
  const wrapped = wrap(z, trackLength);
  return segments[Math.floor(wrapped / SEGMENT_LENGTH) % segments.length];
}

function getTrafficSprite(item) {
  if (!item) return SPRITES.BIKE01;
  if (item.type === "car") {
    return TRAFFIC_CAR_SPRITES[item.variant % TRAFFIC_CAR_SPRITES.length] || SPRITES.CAR01;
  }
  return TRAFFIC_BIKE_SPRITES[item.variant % TRAFFIC_BIKE_SPRITES.length] || SPRITES.BIKE01;
}

function getRiderSprite(player, steer = 0) {
  if (player?.kickActive && player?.kickSide < 0) return SPRITES.PLAYER_KICK_LEFT;
  if (player?.kickActive && player?.kickSide > 0) return SPRITES.PLAYER_KICK_RIGHT;
  if (steer < 0) return SPRITES.PLAYER_LEFT;
  if (steer > 0) return SPRITES.PLAYER_RIGHT;
  return SPRITES.PLAYER_STRAIGHT;
}

function toForwardDistance(trackLength, fromZ, toZ) {
  let dz = toZ - fromZ;
  if (dz < -trackLength / 2) dz += trackLength;
  return dz;
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
  const [background, sprites] = await Promise.all([
    loadImage(`/games/${GAME_SLUG}/assets/background.png`),
    loadImage(`/games/${GAME_SLUG}/assets/sprites.png`),
  ]);
  imageAssets.background = background;
  imageAssets.sprites = sprites;
  assetsReady = true;
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
  window.dispatchEvent(
    new CustomEvent(ROOM_READY_EVENT, { detail: { gameId: GAME_SLUG, roomId } }),
  );
}

function announceOpponentJoined() {
  if (!gameId) return;
  window.__kaboomOpponentJoined = { gameId: GAME_SLUG, roomId: gameId };
  window.dispatchEvent(
    new CustomEvent(OPPONENT_JOIN_EVENT, { detail: { gameId: GAME_SLUG, roomId: gameId } }),
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

function setStatus(message, ttlMs = ROOM_STATUS_TTL_MS) {
  statusMessage = message;
  statusUntilMs = Date.now() + ttlMs;
}

function resultLabel(winner) {
  if (!winner || winner === "tie") return "Photo finish tie!";
  if (!myPlayerId) return winner === "p1" ? "Rider 1 wins" : "Rider 2 wins";
  return winner === myPlayerId ? "You won the race" : "You lost the race";
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
  setHoldInput("throttle", false);
  setHoldInput("brake", false);
}

function triggerKick(side) {
  if (!readyToPlay) return;
  if (side === "left") sendInput("kickLeft", true);
  else sendInput("kickRight", true);
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
    case "x":
      triggerKick("left");
      break;
    case "b":
      triggerKick("right");
      break;
    case "a":
      triggerKick("right");
      break;
    case "y":
      triggerKick("left");
      break;
    default:
      break;
  }
}

function initControllerNavigation() {
  const cleanups = [];

  cleanups.push(dpad.left.onHold(() => setHoldInput("left", true), () => setHoldInput("left", false)));
  cleanups.push(dpad.right.onHold(() => setHoldInput("right", true), () => setHoldInput("right", false)));
  cleanups.push(dpad.up.onHold(() => setHoldInput("throttle", true), () => setHoldInput("throttle", false)));
  cleanups.push(dpad.down.onHold(() => setHoldInput("brake", true), () => setHoldInput("brake", false)));

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

function initKeyboardNavigation() {
  const pressed = new Set();

  const downMap = {
    ArrowLeft: () => setHoldInput("left", true),
    a: () => setHoldInput("left", true),
    A: () => setHoldInput("left", true),
    ArrowRight: () => setHoldInput("right", true),
    d: () => setHoldInput("right", true),
    D: () => setHoldInput("right", true),
    ArrowUp: () => setHoldInput("throttle", true),
    w: () => setHoldInput("throttle", true),
    W: () => setHoldInput("throttle", true),
    ArrowDown: () => setHoldInput("brake", true),
    s: () => setHoldInput("brake", true),
    S: () => setHoldInput("brake", true),
    z: () => triggerKick("left"),
    Z: () => triggerKick("left"),
    c: () => triggerKick("right"),
    C: () => triggerKick("right"),
    Enter: () => handleActionInput("start"),
  };

  const upMap = {
    ArrowLeft: () => setHoldInput("left", false),
    a: () => setHoldInput("left", false),
    A: () => setHoldInput("left", false),
    ArrowRight: () => setHoldInput("right", false),
    d: () => setHoldInput("right", false),
    D: () => setHoldInput("right", false),
    ArrowUp: () => setHoldInput("throttle", false),
    w: () => setHoldInput("throttle", false),
    W: () => setHoldInput("throttle", false),
    ArrowDown: () => setHoldInput("brake", false),
    s: () => setHoldInput("brake", false),
    S: () => setHoldInput("brake", false),
  };

  const onKeyDown = (event) => {
    const tag = event.target?.tagName?.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return;

    const action = downMap[event.key];
    if (!action) return;

    if (event.repeat && (event.key === "z" || event.key === "Z" || event.key === "c" || event.key === "C")) {
      return;
    }

    event.preventDefault();
    if (pressed.has(event.key) && event.key !== "z" && event.key !== "Z" && event.key !== "c" && event.key !== "C") {
      return;
    }

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

  return () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
  };
}

function drawBackground(baseSegmentCurve = 0) {
  ctx.fillStyle = COLORS.SKY;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  if (imageAssets.background) {
    const image = imageAssets.background;
    const imageW = image.width;
    const imageH = image.height;
    const parallax = Math.round((wrap(baseSegmentCurve * 100, imageW) / imageW) * imageW);

    ctx.drawImage(image, parallax, 0, imageW - parallax, imageH, 0, 0, WIDTH, Math.floor(HEIGHT * 0.65));
    if (parallax > 0) {
      const rightWidth = Math.round((parallax / imageW) * WIDTH);
      ctx.drawImage(image, 0, 0, parallax, imageH, WIDTH - rightWidth, 0, rightWidth, Math.floor(HEIGHT * 0.65));
    }
  }

  const horizon = Math.floor(HEIGHT * 0.62);
  const gradient = ctx.createLinearGradient(0, horizon, 0, HEIGHT);
  gradient.addColorStop(0, "rgba(44, 67, 84, 0.08)");
  gradient.addColorStop(1, "rgba(11, 16, 23, 0.45)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, horizon, WIDTH, HEIGHT - horizon);
}

function drawPositionIndicator(state, myPlayer, opponent) {
  if (!state || !myPlayer || !opponent) return;

  const trackLength = Math.max(1, state.trackLength || 1);
  const lapsRequired = Math.max(1, state.lapsRequired || 10);
  const raceDistance = lapsRequired * trackLength;

  const metersFromStart = (player) => {
    const laps = Number.isFinite(player?.lapsCompleted) ? player.lapsCompleted : 0;
    const z = clamp(Number.isFinite(player?.z) ? player.z : 0, 0, trackLength);
    if (player?.finished) return raceDistance;
    return laps * trackLength + z;
  };

  const myMeters = metersFromStart(myPlayer);
  const opponentMeters = metersFromStart(opponent);
  const myProgress = clamp(myMeters / raceDistance, 0, 1);
  const opponentProgress = clamp(opponentMeters / raceDistance, 0, 1);

  const barX = 120;
  const barY = HEIGHT - 58;
  const barW = WIDTH - 240;
  const barH = 16;

  ctx.fillStyle = "rgba(2, 6, 23, 0.82)";
  ctx.fillRect(barX - 10, barY - 16, barW + 20, barH + 36);

  ctx.fillStyle = "#1f2937";
  ctx.fillRect(barX, barY, barW, barH);

  ctx.fillStyle = "#0ea5e9";
  ctx.fillRect(barX, barY, Math.max(2, Math.round(barW * myProgress)), barH);

  ctx.fillStyle = "#f97316";
  const opponentX = clamp(barX + Math.round(barW * opponentProgress), barX, barX + barW);
  ctx.fillRect(Math.max(barX, opponentX - 2), barY - 3, 4, barH + 6);

  const myX = clamp(barX + Math.round(barW * myProgress), barX, barX + barW);
  ctx.fillStyle = "#93c5fd";
  ctx.beginPath();
  ctx.arc(myX, barY + barH / 2, 6, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#f8fafc";
  ctx.font = "bold 13px monospace";
  ctx.fillText("YOU", barX, barY - 4);
  ctx.fillText("OPP", barX + barW - 34, barY - 4);

  const gap = opponentMeters - myMeters;
  let gapText = "NECK AND NECK";
  if (Math.abs(gap) > 40) {
    gapText = gap > 0 ? `OPP +${Math.round(gap)}m` : `YOU +${Math.round(Math.abs(gap))}m`;
  }
  const gapWidth = ctx.measureText(gapText).width;
  ctx.fillText(gapText, WIDTH / 2 - gapWidth / 2, barY + barH + 16);
}

function drawHud(state, myPlayer, opponent) {
  const lapsRequired = Math.max(1, state?.lapsRequired || 10);
  const lapsCompleted = Number.isFinite(myPlayer?.lapsCompleted) ? myPlayer.lapsCompleted : 0;
  const currentLap = myPlayer?.finished ? lapsRequired : clamp(lapsCompleted + 1, 1, lapsRequired);
  const lapLabel = `LAP ${currentLap}/${lapsRequired}`;
  const rankLabel = `RANK ${myPlayer?.rank || "-"}/2`;
  const speedMph = Math.round(((myPlayer?.speed || 0) / MAX_SPEED_FOR_HUD) * 180);
  const speedLabel = `${speedMph} MPH`;

  ctx.fillStyle = "rgba(0, 0, 0, 0.42)";
  ctx.fillRect(22, 18, 360, 104);

  ctx.fillStyle = "#f8fafc";
  ctx.font = "bold 26px monospace";
  ctx.fillText(speedLabel, 40, 50);

  ctx.font = "bold 22px monospace";
  ctx.fillText(rankLabel, 40, 82);
  ctx.fillText(lapLabel, 210, 82);

  const integrity = clamp(myPlayer?.integrity ?? 100, 0, 100);
  ctx.fillStyle = "#111827";
  ctx.fillRect(40, 92, 320, 18);
  ctx.fillStyle = integrity > 40 ? "#22c55e" : integrity > 20 ? "#f59e0b" : "#ef4444";
  ctx.fillRect(40, 92, Math.round(3.2 * integrity), 18);

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 12px monospace";
  ctx.fillText(`BIKE ${Math.round(integrity)}%`, 44, 105);

  if (Date.now() < statusUntilMs && statusMessage) {
    const width = Math.min(640, 26 + ctx.measureText(statusMessage).width + 26);
    const x = WIDTH / 2 - width / 2;
    const y = HEIGHT - 120;
    ctx.fillStyle = "rgba(2, 6, 23, 0.72)";
    ctx.fillRect(x, y, width, 42);
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 20px monospace";
    ctx.fillText(statusMessage, x + 14, y + 28);
  }

  if (state && !state.started && !state.gameOver) {
    const bothConnected = state.players?.p1?.connected && state.players?.p2?.connected;
    ctx.fillStyle = "rgba(0,0,0,0.58)";
    ctx.fillRect(WIDTH / 2 - 240, HEIGHT / 2 - 84, 480, 168);
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 30px monospace";
    const message = bothConnected ? "Engines warming up" : "Waiting for rival...";
    const mWidth = ctx.measureText(message).width;
    ctx.fillText(message, WIDTH / 2 - mWidth / 2, HEIGHT / 2 - 12);

    if (bothConnected && state.startAt) {
      const remaining = Math.max(0, Math.ceil((state.startAt - Date.now()) / 1000));
      const cText = remaining > 0 ? `Start in ${remaining}` : "GO";
      ctx.font = "bold 46px monospace";
      const cWidth = ctx.measureText(cText).width;
      ctx.fillText(cText, WIDTH / 2 - cWidth / 2, HEIGHT / 2 + 48);
    }
  }

  drawPositionIndicator(state, myPlayer, opponent);
}

function renderRoad(state) {
  if (!state?.players) {
    drawBackground(0);
    drawHud(null, null, null);
    return;
  }

  const trackLength = state.trackLength || segments.length * SEGMENT_LENGTH;
  const myPlayer = state.players[myPlayerId] || state.players.p1 || state.players.p2;
  if (!myPlayer) {
    drawBackground(0);
    drawHud(state, null, null);
    return;
  }
  const opponent = myPlayerId
    ? state.players[myPlayerId === "p1" ? "p2" : "p1"]
    : myPlayer === state.players.p1
      ? state.players.p2
      : state.players.p1;

  const cameraZ = wrap(myPlayer.z, trackLength);
  const baseSegment = findSegment(cameraZ, trackLength);
  if (!baseSegment) {
    drawBackground(0);
    drawHud(state, myPlayer, opponent);
    return;
  }

  const basePercent = percentRemaining(cameraZ, SEGMENT_LENGTH);
  const playerSegment = findSegment(cameraZ + PLAYER_Z, trackLength) || baseSegment;
  const playerPercent = percentRemaining(cameraZ + PLAYER_Z, SEGMENT_LENGTH);
  const playerY = lerp(playerSegment.p1.world.y, playerSegment.p2.world.y, playerPercent);

  drawBackground(baseSegment.curve * basePercent);

  let maxY = HEIGHT;
  let x = 0;
  let dx = -(baseSegment.curve * basePercent);

  for (let n = 0; n < DRAW_DISTANCE; n += 1) {
    const segment = segments[(baseSegment.index + n) % segments.length];
    segment.looped = segment.index < baseSegment.index;
    segment.clip = maxY;

    project(segment.p1, myPlayer.x * ROAD_WIDTH - x, playerY + CAMERA_HEIGHT, cameraZ, trackLength);
    project(segment.p2, myPlayer.x * ROAD_WIDTH - x - dx, playerY + CAMERA_HEIGHT, cameraZ, trackLength);

    x += dx;
    dx += segment.curve;

    if (
      segment.p1.camera.z <= CAMERA_DEPTH ||
      segment.p2.screen.y >= segment.p1.screen.y ||
      segment.p2.screen.y >= maxY
    ) {
      continue;
    }

    drawSegment(segment);
    maxY = segment.p1.screen.y;
  }

  const buckets = new Map();
  const maxVisibleZ = SEGMENT_LENGTH * DRAW_DISTANCE;

  const pushWorldObject = ({ relZ, x: objectX, sprite, riderTag = null, riderTagTint = null }) => {
    if (!Number.isFinite(relZ) || relZ <= 0 || relZ >= maxVisibleZ) return;
    const worldZ = cameraZ + relZ;
    const segment = findSegment(worldZ, trackLength);
    if (!segment) return;
    const items = buckets.get(segment.index) || [];
    items.push({
      x: objectX,
      percent: percentRemaining(worldZ, SEGMENT_LENGTH),
      sprite,
      riderTag,
      riderTagTint,
    });
    buckets.set(segment.index, items);
  };

  const preStartGrid = Boolean(!state.started && !state.gameOver);

  if (opponent && opponent.connected) {
    const relZ = opponent.z - myPlayer.z;
    if (!preStartGrid && relZ > 0) {
      pushWorldObject({
        relZ,
        x: opponent.x,
        sprite: getRiderSprite(opponent, 0),
        riderTag: "RIVAL",
        riderTagTint: "#f97316",
      });
    }
  }

  if (Array.isArray(state.traffic)) {
    for (let i = 0; i < state.traffic.length; i += 1) {
      const item = state.traffic[i];
      const relZ = toForwardDistance(trackLength, cameraZ, item.z);
      if (relZ <= 0) continue;
      pushWorldObject({ relZ, x: item.x, sprite: getTrafficSprite(item) });
    }
  }

  for (let n = DRAW_DISTANCE - 1; n > 0; n -= 1) {
    const segment = segments[(baseSegment.index + n) % segments.length];
    const items = buckets.get(segment.index);
    if (!items || items.length === 0) continue;

    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      const spriteScale = lerp(segment.p1.screen.scale, segment.p2.screen.scale, item.percent);
      const spriteX =
        lerp(segment.p1.screen.x, segment.p2.screen.x, item.percent) +
        spriteScale * item.x * ROAD_WIDTH * WIDTH / 2;
      const spriteY = lerp(segment.p1.screen.y, segment.p2.screen.y, item.percent);
      drawSprite(item.sprite, spriteScale, spriteX, spriteY, -0.5, -1, segment.clip);
      if (item.riderTag) {
        const { destH } = spriteScreenSize(item.sprite, spriteScale);
        drawRiderLabel(spriteX, spriteY - destH, item.riderTag, item.riderTagTint || "#1d4ed8");
      }
    }
  }

  const steer = heldInput.left && !heldInput.right ? -1 : heldInput.right && !heldInput.left ? 1 : 0;
  const playerSprite = getRiderSprite(myPlayer, steer);
  const bounce = (1.5 * Math.random() * ((myPlayer.speed || 0) / MAX_SPEED_FOR_HUD) * RESOLUTION) * (Math.random() < 0.5 ? -1 : 1);
  const playerScreenY =
    HEIGHT / 2 -
    (CAMERA_DEPTH / PLAYER_Z) * lerp(playerSegment.p1.camera.y, playerSegment.p2.camera.y, playerPercent) * HEIGHT / 2;

  drawSprite(
    playerSprite,
    CAMERA_DEPTH / PLAYER_Z,
    WIDTH / 2,
    playerScreenY + bounce,
    -0.5,
    -1,
    null,
  );
  const playerScale = CAMERA_DEPTH / PLAYER_Z;
  const { destH: playerDestH } = spriteScreenSize(playerSprite, playerScale);
  drawRiderLabel(WIDTH / 2, playerScreenY + bounce - playerDestH, "YOU", "#38bdf8");

  if (preStartGrid && opponent && opponent.connected) {
    const opponentSprite = getRiderSprite(opponent, 0);
    const opponentScale = CAMERA_DEPTH / PLAYER_Z;
    const opponentX =
      WIDTH / 2 + opponentScale * (opponent.x - myPlayer.x) * ROAD_WIDTH * WIDTH / 2;
    const opponentY = playerScreenY;
    drawSprite(opponentSprite, opponentScale, opponentX, opponentY, -0.5, -1, null);
    const { destH: oppDestH } = spriteScreenSize(opponentSprite, opponentScale);
    drawRiderLabel(opponentX, opponentY - oppDestH, "RIVAL", "#f97316");
  }

  drawHud(state, myPlayer, opponent);
}

function renderFrame() {
  if (disposed) return;

  if (!assetsReady) {
    ctx.fillStyle = "#0b1020";
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.fillStyle = "#f8fafc";
    ctx.font = "bold 32px monospace";
    const loadingText = assetsFailed ? "Asset load failed" : "Loading Road Rash assets...";
    const textWidth = ctx.measureText(loadingText).width;
    ctx.fillText(loadingText, WIDTH / 2 - textWidth / 2, HEIGHT / 2);
    animationFrameId = requestAnimationFrame(renderFrame);
    return;
  }

  renderRoad(latestState);
  animationFrameId = requestAnimationFrame(renderFrame);
}

registerRematchHandler(() => {
  if (rematchPending) return;
  rematchPending = true;
  updateEndGameModal({
    status: "Waiting for opponent...",
    phase: "waiting",
  });
  socket.send("rematch");
});

socket.onEvent("connect", () => {
  hasJoined = false;

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
  latestState = null;
  releaseAllInputs();
  hideEndGameModal();
  setStatus("Rematch started");
});

socket.onEvent("state", (state) => {
  if (!state || !state.players) return;
  latestState = state;

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
  } else if (!state.gameOver && shownGameOver) {
    shownGameOver = false;
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

  unsubscribeConnection?.();
  updateConnectionState({ status: "disconnected", ping: null });

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

buildTrack();

ensureRoomId().then((id) => {
  gameId = id;
  tryJoinGame();
});

loadAssets().catch((error) => {
  console.error(error);
  assetsFailed = true;
});

renderFrame();
