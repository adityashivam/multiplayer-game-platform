import { getGameControls, getGameDomRefs } from "/platform/shared/gameDom.js";

const GAME_SLUG = "pong";
const WIDTH = 960;
const HEIGHT = 720;
const PADDLE_W = 26;
const PADDLE_H = 160;
const PADDLE_X1 = 70;
const PADDLE_X2 = WIDTH - 70;

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
}

function buildRoomUrl(roomId) {
  return `${window.location.origin}/games/${GAME_SLUG}/${roomId}`;
}

function setRoomLink(url) {
  roomUrl = url;
}

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
let lastConnected = { p1: false, p2: false };
let hasPlayedRound = false;

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

function handleDirectionalInput(direction, active) {
  // Map horizontal to vertical since Pong paddles move only up/down
  const mapped =
    direction === "up" || direction === "left"
      ? "up"
      : direction === "down" || direction === "right"
      ? "down"
      : null;
  if (!mapped) return;
  sendInput(mapped, active);
}

function handleActionInput(action) {
  switch (action) {
    case "a":
    case "x":
    case "y":
      socket.emit("rematch");
      break;
    case "start":
      if (roomUrl) window.location.href = roomUrl;
      break;
    case "b":
      window.location.href = "/";
      break;
    default:
      break;
  }
}

function initControllerNavigation() {
  dpad.left.onHold(
    () => handleDirectionalInput("left", true),
    () => handleDirectionalInput("left", false),
  );
  dpad.right.onHold(
    () => handleDirectionalInput("right", true),
    () => handleDirectionalInput("right", false),
  );
  dpad.up.onHold(
    () => handleDirectionalInput("up", true),
    () => handleDirectionalInput("up", false),
  );
  dpad.down.onHold(
    () => handleDirectionalInput("down", true),
    () => handleDirectionalInput("down", false),
  );

  actions.a.onPress(() => handleActionInput("a"));
  actions.b.onPress(() => handleActionInput("b"));
  actions.x.onPress(() => handleActionInput("x"));
  actions.y.onPress(() => handleActionInput("y"));

  menu.start.onPress(() => handleActionInput("start"));

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
  const rematchButton = gameOverOverlay.add([
    rect(240, 70),
    area(),
    color(80, 200, 140),
    anchor("center"),
    pos(WIDTH / 2, HEIGHT / 2 + 130),
    "rematch-button",
  ]);
  rematchButton.add([text("Rematch", { size: 26 }), anchor("center")]);
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

  onClick("rematch-button", () => {
    if (gameOverOverlay?.hidden) return;
    socket.emit("rematch");
    showToast("Rematch requested...");
  });

  socket.on("rematchStarted", () => {
    showToast("Rematch starting!");
    hasPlayedRound = false;
  });

socket.on("state", (state) => {
  if (!state || !state.players || !state.ball) return;
  const { players, ball: ballState, gameOver, winner, started, startAt, lastLost } = state;
  const connected = { p1: players.p1.connected, p2: players.p2.connected };

    if (connected.p1 !== lastConnected.p1 || connected.p2 !== lastConnected.p2) {
      // Only toast on net new connections, not repeated start cycles
      if (connected.p1 && !lastConnected.p1 && connected.p2) {
        showToast("Player 1 connected");
      }
      if (connected.p2 && !lastConnected.p2 && connected.p1) {
        showToast("Player 2 connected");
      }
      lastConnected = connected;
    }

    paddle1.pos.y = players.p1.y;
    paddle2.pos.y = players.p2.y;
    ball.pos.x = ballState.x;
    ball.pos.y = ballState.y;

    scoreText.text = `${players.p1.score}   ${players.p2.score}`;
    infoText.text = `You are ${myPlayerId ? myPlayerId.toUpperCase() : "spectator"} • Move: ${
      myPlayerId === "p1" ? "W/S" : myPlayerId === "p2" ? "Arrow keys" : "N/A"
    } • First to 10`;

    if (started) {
      hasPlayedRound = true;
    }

    updateStartUI(started, startAt, connected, gameOver);
    updateInviteOverlay(connected);

    if (!gameOver && lastLost) {
      showToast(lastLost === "p1" ? "Left missed — point to Right" : "Right missed — point to Left");
    }

    if (gameOver) {
      gameOverOverlay.hidden = false;
      gameOverText.text =
        winner === "p1" ? "Left player wins!" : winner === "p2" ? "Right player wins!" : "Game over";
    } else {
      gameOverOverlay.hidden = true;
    }
  });
});

initControllerNavigation();

go("pong");
