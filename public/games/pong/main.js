const GAME_SLUG = "pong";
const WIDTH = 1280;
const HEIGHT = 720;
const PADDLE_W = 26;
const PADDLE_H = 160;
const PADDLE_X1 = 70;
const PADDLE_X2 = WIDTH - 70;

// Use the in-app canvas so it stays inside the layout
const gameCanvas = document.getElementById("game-canvas");

// ---------- Kaboom init ----------
kaboom({
  width: 1280,
  height: 720,
  scale: 0.7,
  debug: false,
  global: true,
  canvas: gameCanvas || undefined,
});

// Fit canvas into top-half layout (mobile-first)
if (gameCanvas) {
  gameCanvas.style.width = "100vw";
  gameCanvas.style.height = "50vh";
  gameCanvas.style.maxHeight = "420px";
  gameCanvas.style.display = "block";
  gameCanvas.style.margin = "0 auto";
  gameCanvas.style.objectFit = "contain";
}

const shareInput = document.getElementById("room-url");
const copyRoomButton = document.getElementById("copy-room");
const openRoomButton = document.getElementById("open-room");

function buildRoomUrl(roomId) {
  return `${window.location.origin}/games/${GAME_SLUG}/${roomId}`;
}

function setRoomLink(url) {
  if (shareInput) shareInput.value = url;
  if (openRoomButton) {
    openRoomButton.onclick = () => {
      window.location.href = url;
    };
  }
}

function setupCopyButton() {
  if (!copyRoomButton) return;
  copyRoomButton.addEventListener("click", async () => {
    if (!shareInput?.value) return;
    try {
      await navigator.clipboard.writeText(shareInput.value);
      copyRoomButton.textContent = "Copied!";
      setTimeout(() => (copyRoomButton.textContent = "Copy link"), 1200);
    } catch (err) {
      copyRoomButton.textContent = "Select to copy";
      shareInput?.focus();
      shareInput?.select();
      setTimeout(() => (copyRoomButton.textContent = "Copy link"), 1400);
    }
  });
}
setupCopyButton();

function getRoomIdFromPath() {
  const match = window.location.pathname.match(new RegExp(`/games/${GAME_SLUG}/([a-z0-9]+)`, "i"));
  return match && match[1] ? match[1] : null;
}

async function ensureRoomId() {
  const existing = getRoomIdFromPath();
  if (existing) {
    setRoomLink(buildRoomUrl(existing));
    return existing;
  }
  try {
    const res = await fetch(`/api/games/${GAME_SLUG}/new-room`);
    const data = await res.json();
    const roomId = data?.roomId || Math.random().toString(36).slice(2, 8);
    const url = data?.url || buildRoomUrl(roomId);
    window.history.replaceState({}, "", `/games/${GAME_SLUG}/${roomId}`);
    setRoomLink(url);
    return roomId;
  } catch (err) {
    const fallback = Math.random().toString(36).slice(2, 8);
    const url = buildRoomUrl(fallback);
    window.history.replaceState({}, "", `/games/${GAME_SLUG}/${fallback}`);
    setRoomLink(url);
    return fallback;
  }
}

let gameId = null;
let hasJoined = false;
let myPlayerId = null;
let readyToPlay = false;
let removeTouchControls = null;

const socket = io(`/${GAME_SLUG}`);

function tryJoinGame() {
  if (!socket.connected || !gameId || hasJoined) return;
  socket.emit("joinGame", { gameId });
  hasJoined = true;
}

socket.on("connect", () => {
  hasJoined = false;
  if (gameId) {
    tryJoinGame();
  } else {
    ensureRoomId().then((id) => {
      gameId = id;
      tryJoinGame();
    });
  }
});

socket.on("roomFull", () => {
  alert("Room is full!");
});

socket.on("gameJoined", ({ playerId, gameId: joinedGameId }) => {
  myPlayerId = playerId;
  readyToPlay = true;
  gameId = gameId || joinedGameId;
  setRoomLink(buildRoomUrl(gameId));
  console.log("Joined game", gameId, "as", playerId);
});

ensureRoomId().then((id) => {
  gameId = id;
  tryJoinGame();
});

function sendInput(type, value) {
  if (!readyToPlay) return;
  socket.emit("input", { type, value });
}

// ---------- Scene ----------
scene("pong", () => {
  setGravity(0);
  socket.off("state");
  socket.off("playerJoined");
  socket.off("playerLeft");

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

  const gameOverOverlay = add([
    rect(WIDTH, HEIGHT),
    color(0, 0, 0),
    opacity(0.6),
    pos(0, 0),
    anchor("topleft"),
    fixed(),
    z(2000),
  ]);
  const gameOverText = gameOverOverlay.add([
    text("", { size: 42 }),
    anchor("center"),
    pos(WIDTH / 2, HEIGHT / 2 - 40),
  ]);
  const newGameButton = gameOverOverlay.add([
    rect(240, 70),
    area(),
    color(40, 140, 220),
    anchor("center"),
    pos(WIDTH / 2, HEIGHT / 2 + 40),
    "new-game-button",
  ]);
  newGameButton.add([text("New Room", { size: 26 }), anchor("center")]);
  gameOverOverlay.hidden = true;

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

  function updateStartUI(started, startAt, connected, gameOver) {
    if (!startOverlay || !startMessage || !countdownText) return;
    const both = connected?.p1 && connected?.p2;

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
    if (!both) {
      startMessage.text = "Waiting for other player...";
      countdownText.text = "";
      return;
    }

    startMessage.text = "Player joined! Get ready...";
    if (startAt) {
      const seconds = Math.max(0, Math.ceil((startAt - Date.now()) / 1000));
      countdownText.text = seconds > 0 ? `Starting in ${seconds}` : "Play!";
    } else {
      countdownText.text = "";
    }
  }

  async function startNewGame() {
    try {
      const res = await fetch(`/api/games/${GAME_SLUG}/new-room`);
      const data = await res.json();
      const roomId = data?.roomId || Math.random().toString(36).slice(2, 8);
      const targetUrl = data?.url || buildRoomUrl(roomId);
      window.location.href = targetUrl;
    } catch (err) {
      const fallback = Math.random().toString(36).slice(2, 8);
      window.location.href = buildRoomUrl(fallback);
    }
  }

  onClick("new-game-button", () => {
    if (gameOverOverlay?.hidden) return;
    startNewGame();
  });

  socket.on("playerJoined", ({ playerId }) => {
    showToast(`Player ${playerId === "p1" ? "1" : "2"} joined`);
  });

  socket.on("playerLeft", ({ playerId }) => {
    showToast(`Player ${playerId === "p1" ? "1" : "2"} left`);
  });

  onKeyDown("w", () => {
    if (myPlayerId !== "p1") return;
    sendInput("up", true);
  });
  onKeyRelease("w", () => {
    if (myPlayerId !== "p1") return;
    sendInput("up", false);
  });

  onKeyDown("s", () => {
    if (myPlayerId !== "p1") return;
    sendInput("down", true);
  });
  onKeyRelease("s", () => {
    if (myPlayerId !== "p1") return;
    sendInput("down", false);
  });

  onKeyDown("up", () => {
    if (myPlayerId !== "p2") return;
    sendInput("up", true);
  });
  onKeyRelease("up", () => {
    if (myPlayerId !== "p2") return;
    sendInput("up", false);
  });

  onKeyDown("down", () => {
    if (myPlayerId !== "p2") return;
    sendInput("down", true);
  });
  onKeyRelease("down", () => {
    if (myPlayerId !== "p2") return;
    sendInput("down", false);
  });

  function setupTouchControls() {
    const isTouch =
      "ontouchstart" in window ||
      navigator.maxTouchPoints > 0 ||
      navigator.msMaxTouchPoints > 0 ||
      window.innerWidth <= 900;
    if (!isTouch) return null;

    const style = document.createElement("style");
    style.textContent = `
      .touch-wrapper {
        position: fixed;
        bottom: 0;
        left: 0;
        width: 100%;
        max-height: 360px;
        padding: 12px 16px 18px;
        display: flex;
        justify-content: center;
        gap: 18px;
        align-items: flex-end;
        background: linear-gradient(180deg, rgba(7,8,15,0.25) 0%, rgba(5,6,11,0.9) 70%);
        pointer-events: auto;
        z-index: 3000;
        backdrop-filter: blur(6px);
      }
      .touch-controls {
        display: flex;
        gap: 12px;
        pointer-events: auto;
        align-items: center;
      }
      .touch-cluster {
        display: grid;
        grid-template-columns: repeat(2, 1fr);
        grid-template-rows: repeat(2, 1fr);
        gap: 10px;
      }
      .touch-btn {
        width: 78px;
        height: 78px;
        border-radius: 18px;
        border: 2px solid rgba(255,255,255,0.35);
        background: radial-gradient(circle at 30% 30%, rgba(70,90,255,0.35), rgba(25,30,55,0.95));
        color: #f5f5f5;
        font-weight: 800;
        font-size: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 12px 24px rgba(0,0,0,0.45);
        user-select: none;
        -webkit-user-select: none;
        touch-action: none;
      }
      .touch-btn:active {
        transform: translateY(2px);
        box-shadow: 0 6px 14px rgba(0,0,0,0.35);
      }
      .touch-btn.wide {
        width: 160px;
      }
      @media (max-width: 640px) {
        .touch-btn {
          width: 64px;
          height: 64px;
          font-size: 16px;
        }
        .touch-btn.wide {
          width: 130px;
        }
      }
    `;
    document.head.appendChild(style);

    const wrapper = document.createElement("div");
    wrapper.className = "touch-wrapper";

    const leftControls = document.createElement("div");
    leftControls.className = "touch-controls";

    const dpad = document.createElement("div");
    dpad.className = "touch-cluster";

    function createBtn({ label, type }) {
      const btn = document.createElement("div");
      btn.className = "touch-btn";
      btn.textContent = label;

      const start = (e) => {
        e.preventDefault();
        sendInput(type, true);
      };
      const end = (e) => {
        e.preventDefault();
        sendInput(type, false);
      };

      btn.addEventListener("touchstart", start, { passive: false });
      btn.addEventListener("touchend", end, { passive: false });
      btn.addEventListener("touchcancel", end, { passive: false });
      btn.addEventListener("pointerdown", start);
      btn.addEventListener("pointerup", end);
      btn.addEventListener("pointerout", end);
      btn.addEventListener("pointercancel", end);

      return btn;
    }

    dpad.appendChild(createBtn({ label: "⤒", type: "up" }));
    dpad.appendChild(createBtn({ label: "⤓", type: "down" }));
    dpad.appendChild(createBtn({ label: "⤒", type: "up" }));
    dpad.appendChild(createBtn({ label: "⤓", type: "down" }));

    leftControls.appendChild(dpad);
    wrapper.appendChild(leftControls);
    document.body.appendChild(wrapper);

    return () => {
      document.body.removeChild(wrapper);
      document.head.removeChild(style);
    };
  }

  if (!removeTouchControls) {
    removeTouchControls = setupTouchControls();
  }

  socket.on("state", (state) => {
    if (!state || !state.players || !state.ball) return;
    const { players, ball: ballState, gameOver, winner, started, startAt } = state;

    paddle1.pos.y = players.p1.y;
    paddle2.pos.y = players.p2.y;
    ball.pos.x = ballState.x;
    ball.pos.y = ballState.y;

    scoreText.text = `${players.p1.score}   ${players.p2.score}`;
    infoText.text = `You are ${myPlayerId ? myPlayerId.toUpperCase() : "spectator"} • Move: ${
      myPlayerId === "p1" ? "W/S" : myPlayerId === "p2" ? "Arrow keys" : "N/A"
    }`;

    updateStartUI(started, startAt, { p1: players.p1.connected, p2: players.p2.connected }, gameOver);

    if (gameOver) {
      gameOverOverlay.hidden = false;
      gameOverText.text =
        winner === "p1" ? "Left player wins!" : winner === "p2" ? "Right player wins!" : "Game over";
    } else {
      gameOverOverlay.hidden = true;
    }
  });
});

go("pong");
