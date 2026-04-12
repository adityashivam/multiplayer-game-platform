import { getGameControls } from "/platform/frontend-engine/gameDom.js";
import { closeShareModal } from "/platform/frontend-engine/shareModalBridge.js";

const GAME_ID = "webgl-sample";
const STORAGE_KEY = "webgl-sample-best-score";
const DISPOSE_EVENTS = ["kaboom:dispose-game", "platform:dispose-game"];
const MAX_STARS = 42;
const MAX_LIVES = 3;

const canvas = document.getElementById("game-canvas");
const root = document.getElementById("game-root");
const { dpad, menu, actions } = getGameControls();

if (!canvas || !root) {
  throw new Error("WebGL sample requires #game-root and #game-canvas.");
}

closeShareModal();

canvas.style.touchAction = "none";
canvas.style.display = "block";
canvas.tabIndex = 0;

const gl = canvas.getContext("webgl", {
  alpha: false,
  antialias: true,
  depth: false,
  stencil: false,
  premultipliedAlpha: false,
});

if (!gl) {
  const errorCard = document.createElement("div");
  errorCard.textContent = "WebGL is unavailable on this device.";
  Object.assign(errorCard.style, {
    position: "absolute",
    inset: "50% auto auto 50%",
    transform: "translate(-50%, -50%)",
    padding: "14px 18px",
    borderRadius: "12px",
    border: "1px solid rgba(0, 229, 255, 0.18)",
    background: "rgba(14, 14, 14, 0.92)",
    color: "#e5e2e1",
    fontFamily: "Manrope, sans-serif",
    fontSize: "14px",
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    boxShadow: "0 20px 50px rgba(0, 0, 0, 0.45)",
  });
  root.appendChild(errorCard);
  throw new Error("WebGL unavailable");
}

const vertexShaderSource = `
  attribute vec2 a_position;
  attribute vec4 a_color;
  uniform vec2 u_resolution;
  varying vec4 v_color;

  void main() {
    vec2 zeroToOne = a_position / u_resolution;
    vec2 zeroToTwo = zeroToOne * 2.0;
    vec2 clipSpace = zeroToTwo - 1.0;
    gl_Position = vec4(clipSpace * vec2(1.0, -1.0), 0.0, 1.0);
    v_color = a_color;
  }
`;

const fragmentShaderSource = `
  precision mediump float;
  varying vec4 v_color;

  void main() {
    gl_FragColor = v_color;
  }
`;

function compileShader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || "Unknown shader error";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(vertexSource, fragmentSource) {
  const program = gl.createProgram();
  const vertexShader = compileShader(gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl.FRAGMENT_SHADER, fragmentSource);

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || "Unknown program link error";
    gl.deleteProgram(program);
    throw new Error(message);
  }

  return program;
}

const program = createProgram(vertexShaderSource, fragmentShaderSource);
const buffer = gl.createBuffer();
const positionAttribute = gl.getAttribLocation(program, "a_position");
const colorAttribute = gl.getAttribLocation(program, "a_color");
const resolutionUniform = gl.getUniformLocation(program, "u_resolution");

gl.useProgram(program);
gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
gl.enableVertexAttribArray(positionAttribute);
gl.vertexAttribPointer(positionAttribute, 2, gl.FLOAT, false, 24, 0);
gl.enableVertexAttribArray(colorAttribute);
gl.vertexAttribPointer(colorAttribute, 4, gl.FLOAT, false, 24, 8);
gl.enable(gl.BLEND);
gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

const hud = document.createElement("div");
Object.assign(hud.style, {
  position: "absolute",
  inset: "0",
  pointerEvents: "none",
  display: "flex",
  flexDirection: "column",
  justifyContent: "space-between",
  padding: "16px",
  fontFamily: "Space Grotesk, Manrope, sans-serif",
});

const topBar = document.createElement("div");
Object.assign(topBar.style, {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "12px",
});

const scoreBlock = document.createElement("div");
Object.assign(scoreBlock.style, {
  display: "grid",
  gap: "4px",
});

const titleNode = document.createElement("div");
titleNode.textContent = "WEBGL DRIFT";
Object.assign(titleNode.style, {
  color: "#c3f5ff",
  fontSize: "12px",
  fontWeight: "700",
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  textShadow: "0 0 12px rgba(0, 229, 255, 0.35)",
});

const scoreNode = document.createElement("div");
Object.assign(scoreNode.style, {
  color: "#e5e2e1",
  fontSize: "22px",
  fontWeight: "700",
  lineHeight: "1",
});

const metaNode = document.createElement("div");
Object.assign(metaNode.style, {
  color: "#bac9cc",
  fontSize: "11px",
  fontWeight: "600",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
});

scoreBlock.append(titleNode, scoreNode, metaNode);

const hintNode = document.createElement("div");
Object.assign(hintNode.style, {
  maxWidth: "240px",
  padding: "10px 12px",
  borderRadius: "12px",
  border: "1px solid rgba(0, 229, 255, 0.15)",
  background: "linear-gradient(180deg, rgba(20, 24, 28, 0.86), rgba(8, 10, 12, 0.78))",
  boxShadow: "0 20px 50px rgba(0, 0, 0, 0.28)",
  color: "#bac9cc",
  fontSize: "10px",
  fontWeight: "600",
  letterSpacing: "0.07em",
  lineHeight: "1.45",
  textTransform: "uppercase",
  textAlign: "right",
});
hintNode.textContent = "Drag or use arrow keys. Dodge red shards. Catch blue cores.";

topBar.append(scoreBlock, hintNode);

const overlay = document.createElement("div");
Object.assign(overlay.style, {
  position: "absolute",
  inset: "0",
  display: "none",
  alignItems: "center",
  justifyContent: "center",
  background: "linear-gradient(180deg, rgba(5, 7, 10, 0.18), rgba(5, 7, 10, 0.72))",
  pointerEvents: "auto",
});

const overlayCard = document.createElement("div");
Object.assign(overlayCard.style, {
  minWidth: "240px",
  maxWidth: "min(88vw, 340px)",
  padding: "18px 20px",
  borderRadius: "18px",
  border: "1px solid rgba(0, 229, 255, 0.18)",
  background: "linear-gradient(180deg, rgba(18, 22, 27, 0.96), rgba(8, 10, 12, 0.94))",
  boxShadow: "0 28px 90px rgba(0, 0, 0, 0.52)",
  display: "grid",
  gap: "10px",
  textAlign: "center",
});

const overlayTitle = document.createElement("div");
Object.assign(overlayTitle.style, {
  color: "#e5e2e1",
  fontSize: "24px",
  fontWeight: "800",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
});

const overlayBody = document.createElement("div");
Object.assign(overlayBody.style, {
  color: "#bac9cc",
  fontSize: "12px",
  fontWeight: "600",
  lineHeight: "1.5",
  letterSpacing: "0.05em",
  textTransform: "uppercase",
});

const overlayButton = document.createElement("button");
overlayButton.type = "button";
overlayButton.textContent = "Restart";
Object.assign(overlayButton.style, {
  justifySelf: "center",
  padding: "10px 16px",
  borderRadius: "999px",
  border: "1px solid rgba(0, 229, 255, 0.22)",
  background: "linear-gradient(180deg, rgba(0, 229, 255, 0.18), rgba(0, 229, 255, 0.08))",
  color: "#c3f5ff",
  fontFamily: "Space Grotesk, Manrope, sans-serif",
  fontSize: "12px",
  fontWeight: "700",
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  cursor: "pointer",
  boxShadow: "0 14px 40px rgba(0, 229, 255, 0.12)",
});
overlayButton.style.pointerEvents = "auto";

overlayCard.append(overlayTitle, overlayBody, overlayButton);
overlay.appendChild(overlayCard);
hud.append(topBar, overlay);
root.appendChild(hud);

const rects = [];
const hazards = [];
const pickups = [];
const stars = [];
const keys = new Set();
const controlState = {
  left: false,
  right: false,
};

let rafId = 0;
let lastTime = 0;
let width = 0;
let height = 0;
let dpr = 1;
let running = true;
let gameOver = false;
let introVisible = true;
let introTimer = 2.8;
let score = 0;
let bestScore = Number.parseInt(localStorage.getItem(STORAGE_KEY) || "0", 10) || 0;
let lives = MAX_LIVES;
let flashTimer = 0;
let spawnTimer = 0;
let pickupTimer = 0;
let difficultyTimer = 0;
let pointerActive = false;
let pointerX = 0;
let cleanupControllerNavigation = null;

const player = {
  x: 0,
  y: 0,
  width: 52,
  height: 24,
  speed: 480,
};

function showOverlay(title, body, buttonLabel = "Restart") {
  overlayTitle.textContent = title;
  overlayBody.textContent = body;
  overlayButton.textContent = buttonLabel;
  overlay.style.display = "flex";
}

function hideOverlay() {
  overlay.style.display = "none";
}

function resize() {
  const nextWidth = Math.max(320, root.clientWidth || canvas.clientWidth || 960);
  const nextHeight = Math.max(180, root.clientHeight || canvas.clientHeight || 540);
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  width = nextWidth;
  height = nextHeight;

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  gl.viewport(0, 0, canvas.width, canvas.height);

  player.width = Math.max(38, Math.min(64, width * 0.08));
  player.height = Math.max(18, Math.min(28, height * 0.045));
  player.y = height - Math.max(46, height * 0.11);
  player.x = Math.min(Math.max(player.x, player.width * 0.5), width - player.width * 0.5);
}

function seedStars() {
  stars.length = 0;
  for (let index = 0; index < MAX_STARS; index += 1) {
    stars.push({
      x: Math.random() * width,
      y: Math.random() * height,
      size: 1 + Math.random() * 2.4,
      speed: 18 + Math.random() * 54,
      alpha: 0.16 + Math.random() * 0.34,
    });
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function collides(a, b) {
  return (
    Math.abs(a.x - b.x) * 2 < a.width + b.width &&
    Math.abs(a.y - b.y) * 2 < a.height + b.height
  );
}

function spawnHazard() {
  const widthScale = 26 + Math.random() * 18;
  hazards.push({
    x: clamp(Math.random() * width, widthScale, width - widthScale),
    y: -40,
    width: widthScale,
    height: 24 + Math.random() * 20,
    speed: 220 + Math.random() * 110 + difficultyTimer * 12,
  });
}

function spawnPickup() {
  pickups.push({
    x: clamp(Math.random() * width, 18, width - 18),
    y: -28,
    width: 22,
    height: 22,
    speed: 180 + Math.random() * 60,
  });
}

function resetGame() {
  score = 0;
  lives = MAX_LIVES;
  flashTimer = 0;
  spawnTimer = 0.48;
  pickupTimer = 2.75;
  difficultyTimer = 0;
  gameOver = false;
  introVisible = true;
  introTimer = 2.4;
  player.x = width * 0.5;
  player.y = height - Math.max(46, height * 0.11);
  hazards.length = 0;
  pickups.length = 0;
  hideOverlay();
  syncHud();
}

function syncHud() {
  scoreNode.textContent = `${Math.floor(score)}`;
  metaNode.textContent = `Lives ${lives} / Best ${Math.max(bestScore, Math.floor(score))}`;
  hintNode.style.opacity = introVisible && !gameOver ? "1" : "0.52";
}

function finishGame() {
  gameOver = true;
  introVisible = false;
  bestScore = Math.max(bestScore, Math.floor(score));
  localStorage.setItem(STORAGE_KEY, String(bestScore));
  showOverlay("Run Over", `Score ${Math.floor(score)}. Best ${bestScore}.`, "Play Again");
  syncHud();
}

function restartGame() {
  resetGame();
}

function dismissIntroOverlay() {
  if (gameOver) return;
  hideOverlay();
  introVisible = false;
  syncHud();
  canvas.focus();
}

function handleOverlayAction() {
  if (gameOver) {
    restartGame();
    canvas.focus();
    return;
  }

  dismissIntroOverlay();
}

function setControlState(direction, active) {
  if (direction !== "left" && direction !== "right") return;
  controlState[direction] = Boolean(active);
  if (active) {
    dismissIntroOverlay();
  }
}

function handlePlatformDirection(direction, active) {
  const mappedDirection =
    direction === "left" || direction === "up"
      ? "left"
      : direction === "right" || direction === "down"
      ? "right"
      : null;

  if (!mappedDirection) return;
  setControlState(mappedDirection, active);
}

function handlePlatformAction(action) {
  switch (action) {
    case "a":
    case "x":
    case "y":
    case "start":
      handleOverlayAction();
      break;
    default:
      break;
  }
}

function initControllerNavigation() {
  const cleanups = [];

  cleanups.push(
    dpad.left.onHold(
      () => handlePlatformDirection("left", true),
      () => handlePlatformDirection("left", false),
    ),
  );
  cleanups.push(
    dpad.right.onHold(
      () => handlePlatformDirection("right", true),
      () => handlePlatformDirection("right", false),
    ),
  );
  cleanups.push(
    dpad.up.onHold(
      () => handlePlatformDirection("up", true),
      () => handlePlatformDirection("up", false),
    ),
  );
  cleanups.push(
    dpad.down.onHold(
      () => handlePlatformDirection("down", true),
      () => handlePlatformDirection("down", false),
    ),
  );

  cleanups.push(actions.a.onPress(() => handlePlatformAction("a")));
  cleanups.push(actions.x.onPress(() => handlePlatformAction("x")));
  cleanups.push(actions.y.onPress(() => handlePlatformAction("y")));
  cleanups.push(menu.start.onPress(() => handlePlatformAction("start")));

  return () => {
    cleanups.forEach((cleanup) => {
      if (typeof cleanup === "function") cleanup();
    });
  };
}

function pushRect(x, y, rectWidth, rectHeight, color) {
  const left = x;
  const right = x + rectWidth;
  const top = y;
  const bottom = y + rectHeight;
  const [r, g, b, a] = color;

  rects.push(
    left,
    top,
    r,
    g,
    b,
    a,
    right,
    top,
    r,
    g,
    b,
    a,
    left,
    bottom,
    r,
    g,
    b,
    a,
    left,
    bottom,
    r,
    g,
    b,
    a,
    right,
    top,
    r,
    g,
    b,
    a,
    right,
    bottom,
    r,
    g,
    b,
    a,
  );
}

function renderBackground() {
  for (const star of stars) {
    pushRect(star.x, star.y, star.size, star.size, [0.76, 0.96, 1, star.alpha]);
  }

  const laneWidth = width / 4;
  const dashHeight = Math.max(10, height * 0.035);
  const dashGap = dashHeight * 0.8;
  const laneCount = 3;

  for (let lane = 1; lane <= laneCount; lane += 1) {
    const laneX = laneWidth * lane;
    const scrollOffset = (performance.now() * 0.18) % (dashHeight + dashGap);
    for (let y = -dashHeight; y < height + dashHeight; y += dashHeight + dashGap) {
      pushRect(
        laneX - 2,
        y + scrollOffset,
        4,
        dashHeight,
        [0.0, 0.9, 1.0, 0.12],
      );
    }
  }
}

function renderPlayer() {
  const left = player.x - player.width * 0.5;
  const top = player.y - player.height * 0.5;
  pushRect(left, top, player.width, player.height, [0.0, 0.89, 1.0, 0.95]);
  pushRect(left + 8, top + 4, player.width - 16, player.height - 8, [0.06, 0.13, 0.19, 0.95]);
  pushRect(player.x - 6, top - 6, 12, 6, [0.62, 0.98, 1.0, 0.8]);
}

function renderHazards() {
  for (const hazard of hazards) {
    const left = hazard.x - hazard.width * 0.5;
    const top = hazard.y - hazard.height * 0.5;
    pushRect(left, top, hazard.width, hazard.height, [1.0, 0.36, 0.25, 0.88]);
    pushRect(left + 4, top + 4, hazard.width - 8, hazard.height - 8, [0.34, 0.05, 0.04, 0.82]);
  }
}

function renderPickups() {
  for (const pickup of pickups) {
    const left = pickup.x - pickup.width * 0.5;
    const top = pickup.y - pickup.height * 0.5;
    pushRect(left, top, pickup.width, pickup.height, [0.0, 0.92, 1.0, 0.82]);
    pushRect(left + 4, top + 4, pickup.width - 8, pickup.height - 8, [0.8, 0.98, 1.0, 0.96]);
  }
}

function renderFlash() {
  if (flashTimer <= 0) return;
  pushRect(0, 0, width, height, [1.0, 0.2, 0.18, flashTimer * 0.22]);
}

function drawFrame() {
  rects.length = 0;

  gl.clearColor(0.03, 0.05, 0.08, 1.0);
  gl.clear(gl.COLOR_BUFFER_BIT);

  renderBackground();
  renderHazards();
  renderPickups();
  renderPlayer();
  renderFlash();

  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(rects), gl.DYNAMIC_DRAW);
  gl.uniform2f(resolutionUniform, width, height);
  gl.drawArrays(gl.TRIANGLES, 0, rects.length / 6);
}

function updateStars(deltaTime) {
  for (const star of stars) {
    star.y += star.speed * deltaTime;
    if (star.y > height + 6) {
      star.y = -4;
      star.x = Math.random() * width;
      star.size = 1 + Math.random() * 2.4;
      star.speed = 18 + Math.random() * 54;
      star.alpha = 0.16 + Math.random() * 0.34;
    }
  }
}

function updatePlayer(deltaTime) {
  const movement = player.speed * deltaTime;
  if (keys.has("ArrowLeft") || keys.has("a") || controlState.left) {
    player.x -= movement;
  }
  if (keys.has("ArrowRight") || keys.has("d") || controlState.right) {
    player.x += movement;
  }

  if (pointerActive) {
    player.x += (pointerX - player.x) * Math.min(1, deltaTime * 10);
  }

  player.x = clamp(player.x, player.width * 0.5, width - player.width * 0.5);
}

function updateHazards(deltaTime) {
  for (let index = hazards.length - 1; index >= 0; index -= 1) {
    const hazard = hazards[index];
    hazard.y += hazard.speed * deltaTime;

    if (collides(player, hazard)) {
      hazards.splice(index, 1);
      flashTimer = 1;
      lives -= 1;
      if (lives <= 0) {
        finishGame();
      } else {
        syncHud();
      }
      continue;
    }

    if (hazard.y - hazard.height * 0.5 > height + 10) {
      hazards.splice(index, 1);
      score += 8;
    }
  }
}

function updatePickups(deltaTime) {
  for (let index = pickups.length - 1; index >= 0; index -= 1) {
    const pickup = pickups[index];
    pickup.y += pickup.speed * deltaTime;

    if (collides(player, pickup)) {
      pickups.splice(index, 1);
      score += 120;
      syncHud();
      continue;
    }

    if (pickup.y - pickup.height * 0.5 > height + 10) {
      pickups.splice(index, 1);
    }
  }
}

function updateSpawns(deltaTime) {
  difficultyTimer += deltaTime;
  spawnTimer -= deltaTime;
  pickupTimer -= deltaTime;

  if (spawnTimer <= 0) {
    spawnHazard();
    spawnTimer = clamp(0.72 - difficultyTimer * 0.03 + Math.random() * 0.22, 0.22, 0.76);
  }

  if (pickupTimer <= 0) {
    spawnPickup();
    pickupTimer = 3.6 + Math.random() * 1.6;
  }
}

function update(deltaTime) {
  updateStars(deltaTime);

  if (gameOver) {
    flashTimer = Math.max(0, flashTimer - deltaTime * 0.8);
    return;
  }

  if (introVisible) {
    introTimer -= deltaTime;
    if (introTimer <= 0) {
      introVisible = false;
      syncHud();
    }
  }

  flashTimer = Math.max(0, flashTimer - deltaTime * 1.8);
  score += deltaTime * 18;

  updatePlayer(deltaTime);
  updateSpawns(deltaTime);
  updateHazards(deltaTime);
  updatePickups(deltaTime);
  syncHud();
}

function frame(timestamp) {
  if (!running) return;
  if (!lastTime) lastTime = timestamp;

  const deltaTime = Math.min((timestamp - lastTime) / 1000, 0.05);
  lastTime = timestamp;

  update(deltaTime);
  drawFrame();

  rafId = window.requestAnimationFrame(frame);
}

function handlePointer(event) {
  if (!gameOver && overlay.style.display === "flex") {
    dismissIntroOverlay();
  }

  const rect = canvas.getBoundingClientRect();
  pointerActive = true;
  pointerX = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * width;
  if (gameOver) {
    restartGame();
  }
}

function handlePointerUp() {
  pointerActive = false;
}

function handleKeyDown(event) {
  const key = event.key.toLowerCase();
  if (key === " " || key === "enter") {
    event.preventDefault();
    if (gameOver) {
      restartGame();
      return;
    }

    if (overlay.style.display === "flex") {
      dismissIntroOverlay();
      return;
    }
  }

  if (key === "arrowleft" || key === "arrowright" || key === "a" || key === "d") {
    keys.add(key);
    dismissIntroOverlay();
    event.preventDefault();
  }
}

function handleKeyUp(event) {
  keys.delete(event.key.toLowerCase());
}

function dispose() {
  if (!running) return;
  running = false;

  if (rafId) {
    window.cancelAnimationFrame(rafId);
  }

  window.removeEventListener("resize", resize);
  window.removeEventListener("keydown", handleKeyDown);
  window.removeEventListener("keyup", handleKeyUp);
  window.removeEventListener("pointerup", handlePointerUp);
  canvas.removeEventListener("pointerdown", handlePointer);
  canvas.removeEventListener("pointermove", handlePointer);
  overlayButton.removeEventListener("click", handleOverlayAction);
  if (typeof cleanupControllerNavigation === "function") {
    cleanupControllerNavigation();
    cleanupControllerNavigation = null;
  }

  for (const eventName of DISPOSE_EVENTS) {
    window.removeEventListener(eventName, handleDisposeEvent);
  }

  hud.remove();

  const loseContext = gl.getExtension("WEBGL_lose_context");
  if (loseContext) {
    loseContext.loseContext();
  }
}

function handleDisposeEvent(event) {
  const detailGameId = event?.detail?.gameId;
  if (!detailGameId || detailGameId === GAME_ID) {
    dispose();
  }
}

overlayButton.addEventListener("click", handleOverlayAction);
window.addEventListener("resize", resize);
window.addEventListener("keydown", handleKeyDown);
window.addEventListener("keyup", handleKeyUp);
window.addEventListener("pointerup", handlePointerUp);
canvas.addEventListener("pointerdown", handlePointer);
canvas.addEventListener("pointermove", handlePointer);
cleanupControllerNavigation = initControllerNavigation();

for (const eventName of DISPOSE_EVENTS) {
  window.addEventListener(eventName, handleDisposeEvent);
}

resize();
seedStars();
resetGame();
syncHud();
showOverlay("WebGL Drift", "Drag or use arrow keys. Collect blue cores. Dodge red shards.", "Start Run");

rafId = window.requestAnimationFrame(frame);
