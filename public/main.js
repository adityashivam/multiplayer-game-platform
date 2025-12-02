// ---------- Kaboom init ----------
kaboom({
  width: 1280,
  height: 720,
  scale: 0.7,
  debug: false,
  global: true,
});

// ---------- Multiplayer setup ----------

// Generate or read room from URL
function getOrCreateGameId() {
  const pathMatch = window.location.pathname.match(/\/room\/([a-z0-9]+)/);
  if (pathMatch && pathMatch[1]) {
    return pathMatch[1];
  }
  
  // On home page, generate new room
  const gameId = Math.random().toString(36).slice(2, 8);
  window.history.replaceState({}, "", `/room/${gameId}`);
  return gameId;
}

const gameId = getOrCreateGameId();

// Backend URL
const SOCKET_URL = window.location.origin;

const socket = io(SOCKET_URL);

let myPlayerId = null;
let readyToPlay = false;

function sendInputFlag(type, value) {
  if (!readyToPlay) return;
  socket.emit("input", { type, value });
}

socket.on("connect", () => {
  socket.emit("joinGame", { gameId });
});

socket.on("roomFull", () => {
  alert("Room is full!");
});

socket.on("gameJoined", ({ playerId }) => {
  myPlayerId = playerId;
  readyToPlay = true;
  console.log("Joined game", gameId, "as", playerId);
});

// ---------- Assets ----------

loadSprite("background", "/assets/background/background_layer_1.png");
loadSprite("trees", "/assets/background/background_layer_2.png");

loadSpriteAtlas("/assets/oak_woods_tileset.png", {
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

loadSprite("shop", "/assets/shop_anim.png", {
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

loadSprite("fence", "/assets/fence_1.png");
loadSprite("sign", "/assets/sign.png");

loadSprite("idle-player1", "/assets/idle-player1.png", {
  sliceX: 8,
  sliceY: 1,
  anims: { idle: { from: 0, to: 7, speed: 12, loop: true } },
});
loadSprite("jump-player1", "/assets/jump-player1.png", {
  sliceX: 2,
  sliceY: 1,
  anims: { jump: { from: 0, to: 1, speed: 2, loop: true } },
});
loadSprite("attack-player1", "/assets/attack-player1.png", {
  sliceX: 6,
  sliceY: 1,
  anims: { attack: { from: 1, to: 5, speed: 18 } },
});
loadSprite("run-player1", "/assets/run-player1.png", {
  sliceX: 8,
  sliceY: 1,
  anims: { run: { from: 0, to: 7, speed: 18 } },
});
loadSprite("death-player1", "/assets/death-player1.png", {
  sliceX: 6,
  sliceY: 1,
  anims: { death: { from: 0, to: 5, speed: 10 } },
});

loadSprite("idle-player2", "/assets/idle-player2.png", {
  sliceX: 4,
  sliceY: 1,
  anims: { idle: { from: 0, to: 3, speed: 8, loop: true } },
});
loadSprite("jump-player2", "/assets/jump-player2.png", {
  sliceX: 2,
  sliceY: 1,
  anims: { jump: { from: 0, to: 1, speed: 2, loop: true } },
});
loadSprite("attack-player2", "/assets/attack-player2.png", {
  sliceX: 4,
  sliceY: 1,
  anims: { attack: { from: 0, to: 3, speed: 18 } },
});
loadSprite("run-player2", "/assets/run-player2.png", {
  sliceX: 8,
  sliceY: 1,
  anims: { run: { from: 0, to: 7, speed: 18 } },
});
loadSprite("death-player2", "/assets/death-player2.png", {
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
  socket.off("state");
  socket.off("playerJoined");
  socket.off("playerLeft");

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
  let winningText = null;
  let gameOverFlag = false;
  let countInterval = null;
  let startOverlay = null;
  let startMessage = null;
  let countdownText = null;
  let joinToast = null;
  let joinToastText = null;
  let joinToastTimer = null;
  let gameOverOverlay = null;
  let gameOverText = null;
  let newGameButton = null;

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
    text("60"),
    area(),
    anchor("center"),
    {
      timeLeft: 60,
    },
  ]);

  // Winner text
  winningText = add([text(""), area(), anchor("center"), pos(center())]);

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

  // Game over overlay and new game button
  gameOverOverlay = add([
    rect(width(), height()),
    color(0, 0, 0),
    opacity(0.6),
    pos(0, 0),
    anchor("topleft"),
    fixed(),
    z(2000),
  ]);
  gameOverText = gameOverOverlay.add([
    text("", { size: 42 }),
    anchor("center"),
    pos(center().add(0, -40)),
  ]);
  newGameButton = gameOverOverlay.add([
    rect(240, 70),
    area(),
    color(40, 140, 220),
    anchor("center"),
    pos(center().add(0, 60)),
    "new-game-button",
  ]);
  newGameButton.add([text("New Game", { size: 26 }), anchor("center")]);
  gameOverOverlay.hidden = true;

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

    startMessage.text = "Player joined! Get ready...";
    if (startAt) {
      const seconds = Math.max(0, Math.ceil((startAt - Date.now()) / 1000));
      countdownText.text = seconds > 0 ? `Starting in ${seconds}` : "Fight!";
    } else {
      countdownText.text = "";
    }
  }

  function showGameOverUI(winner) {
    if (!gameOverOverlay || !gameOverText) return;
    gameOverOverlay.hidden = false;
    if (startOverlay) startOverlay.hidden = true;
    let message = "Tie!";
    if (winner === "p1") message = "Player 1 Wins!";
    else if (winner === "p2") message = "Player 2 Wins!";
    gameOverText.text = message;
  }

  async function startNewGame() {
    try {
      const res = await fetch("/api/new-room");
      const data = await res.json();
      if (data?.url) {
        window.location.href = data.url;
      } else if (data?.roomId) {
        window.location.href = `/room/${data.roomId}`;
      }
    } catch (err) {
      const fallbackId = Math.random().toString(36).slice(2, 8);
      window.location.href = `/room/${fallbackId}`;
    }
  }

  onClick("new-game-button", () => {
    if (gameOverOverlay?.hidden) return;
    startNewGame();
  });

  socket.on("playerJoined", ({ playerId }) => {
    showJoinToast(`Player ${playerId === "p1" ? "1" : "2"} joined the game`);
  });

  socket.on("playerLeft", ({ playerId }) => {
    showJoinToast(`Player ${playerId === "p1" ? "1" : "2"} left the game`);
  });

  // Input handlers
  onKeyDown("d", () => {
    if (myPlayerId !== "p1") return;
    sendInputFlag("right", true);
  });
  onKeyRelease("d", () => {
    if (myPlayerId !== "p1") return;
    sendInputFlag("right", false);
  });

  onKeyDown("a", () => {
    if (myPlayerId !== "p1") return;
    sendInputFlag("left", true);
  });
  onKeyRelease("a", () => {
    if (myPlayerId !== "p1") return;
    sendInputFlag("left", false);
  });

  onKeyDown("w", () => {
    if (myPlayerId !== "p1") return;
    sendInputFlag("jump", true);
  });
  onKeyRelease("w", () => {
    if (myPlayerId !== "p1") return;
    sendInputFlag("jump", false);
  });

  onKeyDown("space", () => {
    if (myPlayerId !== "p1") return;
    sendInputFlag("attack", true);
  });
  onKeyRelease("space", () => {
    if (myPlayerId !== "p1") return;
    sendInputFlag("attack", false);
  });

  // Player 2 controls
  onKeyDown("right", () => {
    if (myPlayerId !== "p2") return;
    sendInputFlag("right", true);
  });
  onKeyRelease("right", () => {
    if (myPlayerId !== "p2") return;
    sendInputFlag("right", false);
  });

  onKeyDown("left", () => {
    if (myPlayerId !== "p2") return;
    sendInputFlag("left", true);
  });
  onKeyRelease("left", () => {
    if (myPlayerId !== "p2") return;
    sendInputFlag("left", false);
  });

  onKeyDown("up", () => {
    if (myPlayerId !== "p2") return;
    sendInputFlag("jump", true);
  });
  onKeyRelease("up", () => {
    if (myPlayerId !== "p2") return;
    sendInputFlag("jump", false);
  });

  onKeyDown("down", () => {
    if (myPlayerId !== "p2") return;
    sendInputFlag("attack", true);
  });
  onKeyRelease("down", () => {
    if (myPlayerId !== "p2") return;
    sendInputFlag("attack", false);
  });

  onKeyDown("enter", () => {
    if (gameOverFlag) go("fight");
  });

  // Server state updates
  socket.on("state", (state) => {
    if (!player1 || !player2 || !player1HealthBar || !player2HealthBar) {
      return;
    }

    const { players, timer, gameOver, winner, started, startAt, connected } = state;
    updateStartUI(started, startAt, connected, gameOver);

    const s1 = players.p1;
    const s2 = players.p2;

    // Update positions
    player1.pos.x = s1.x;
    player1.pos.y = s1.y + PLAYER1_Y_OFFSET;
    player2.pos.x = s2.x;
    player2.pos.y = s2.y + PLAYER2_Y_OFFSET;

    // Facing direction
    player1.flipX = s1.dir === -1;
    player2.flipX = s2.dir === -1;

    // Health bars
    player1HealthBar.width = s1.health;
    player2HealthBar.width = s2.health;

    // Timer
    count.text = String(Math.ceil(timer));

    // Game over
    if (gameOver && !gameOverFlag) {
      gameOverFlag = true;
      if (countInterval) clearInterval(countInterval);

      if (winner === "p1") {
        winningText.text = "Player 1 won!";
        if (s2.dead) {
          player2.use(sprite(player2.sprites.death));
          player2.play("death");
        }
      } else if (winner === "p2") {
        winningText.text = "Player 2 won!";
        if (s1.dead) {
          player1.use(sprite(player1.sprites.death));
          player1.play("death");
        }
      } else {
        winningText.text = "Tie!";
      }

      showGameOverUI(winner);
    }

    // Update animations based on state
    updatePlayerAnimation(player1, s1);
    updatePlayerAnimation(player2, s2);
  });

  function updatePlayerAnimation(player, state) {
    if (!player || !state) return;

    const { attacking, dead, vx } = state;

    if (dead) {
      if (player.curAnim() !== "death") {
        player.use(sprite(player.sprites.death));
        player.play("death");
      }
    } else if (attacking) {
      if (player.curAnim() !== "attack") {
        player.use(sprite(player.sprites.attack));
        player.play("attack");
      }
    } else if (Math.abs(vx) > 5) {
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
});

go("fight");
