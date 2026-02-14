# Kaboom Multiplayer Game Platform

A server-authoritative multiplayer game platform built on **Kaboom.js** and **Socket.IO**. Games run at 60Hz on the server with client-side prediction, Hermite cubic interpolation, and rollback-replay netcode for smooth real-time gameplay.

**Current games:** Kaboom Fight (2P sword duel), Kaboom Pong (2P arcade pong)

---

## Quick Start

```bash
npm install
node server/server.js
```

Open `http://localhost:3000` in two browser tabs to play.

---

## Project Structure

```
server/
  server.js                      # Express + Socket.IO entry point
  games/
    metadata.js                  # Game catalog (id, name, namespace, tags)
    fight.js                     # Fight game server logic
    pong.js                      # Pong game server logic
  utils/
    registerGame.js              # Generic game registration framework
    gameLoop.js                  # 60Hz tick loop + state broadcast
    rooms.js                     # Room join/leave/rejoin logic
    inputProtocol.js             # Sequenced input with rollback support
    socketHandlers.js            # Socket event wiring
    gameStore.js                 # Per-namespace game state store

public/
  platform/
    shared/                      # Shared client modules (import from games)
      gameSocket.js              # Socket.IO wrapper with msgpack + metrics
      gameDom.js                 # Canvas ref + controller input API
      interpolation.js           # Hermite cubic interpolation engine
      interpolationWorker.js     # Recommended interpolation wrapper
      clientPrediction.js        # Client-side prediction + reconciliation
      inputTimeline.js           # Input buffering with sequence tracking
      connectionBridge.js        # Connection state for React UI
      endGameBridge.js           # End-game modal bridge
      shareModalBridge.js        # Share/invite modal bridge
      performanceSettings.js     # FPS/resolution settings
    src/
      App.jsx                    # React shell (lobby, game loader, UI)
      data/games.js              # Frontend game catalog
      components/
        Controller.jsx           # D-pad + action buttons (touch/click)
        GameView.jsx             # Game canvas container
  games/
    fight/                       # Fight game client
      index.html
      main.js
      assets/
    pong/                        # Pong game client
      index.html
      main.js
      assets/
```

---

## Adding a New Game

This walkthrough creates a minimal game called **"myGame"** from scratch.

### Step 1: Add Game Metadata

**File: `server/games/metadata.js`**

```js
export const myGameMeta = {
  id: "myGame",
  name: "My Game",
  description: "A custom multiplayer game.",
  namespace: "/myGame",
  path: "/games/myGame",
  tags: ["Real-time", "2 players"],
};
```

### Step 2: Create Server Game Handler

**File: `server/games/myGame.js`**

```js
import { myGameMeta } from "./metadata.js";
import { registerGame } from "../utils/registerGame.js";
import { applySequencedInput } from "../utils/inputProtocol.js";

const DEFAULT_INPUT = { left: false, right: false };

function createInitialState() {
  return {
    players: {
      p1: { x: 200, y: 400, input: { ...DEFAULT_INPUT }, connected: false, lastInputSeqAck: 0 },
      p2: { x: 600, y: 400, input: { ...DEFAULT_INPUT }, connected: false, lastInputSeqAck: 0 },
    },
    started: false,
    gameOver: false,
    connected: { p1: false, p2: false },
  };
}

function updateGameState(state, dt) {
  for (const id of ["p1", "p2"]) {
    const p = state.players[id];
    const speed = 300;
    if (p.input.left) p.x -= speed * dt;
    if (p.input.right) p.x += speed * dt;
    p.x = Math.max(0, Math.min(800, p.x));
  }
}

function sanitizeState(state) {
  // Add inputSeqAck for each player (required for client prediction)
  const s = { ...state };
  s.players = {};
  for (const id of ["p1", "p2"]) {
    s.players[id] = {
      ...state.players[id],
      inputSeqAck: state.players[id].lastInputSeqAck,
    };
    delete s.players[id].input;           // Don't send raw input to clients
    delete s.players[id].lastInputSeqAck; // Internal field
  }
  return s;
}

export function registerMyGame(io) {
  registerGame({
    io,
    meta: myGameMeta,
    createState: createInitialState,

    onPlayerConnected: (state, playerId) => {
      state.players[playerId].connected = true;
      state.connected[playerId] = true;
      if (state.connected.p1 && state.connected.p2) {
        state.started = true;
      }
    },

    handleInput: ({ state, playerId, payload }) => {
      applySequencedInput({
        player: state.players[playerId],
        payload,
        inputTemplate: DEFAULT_INPUT,
      });
    },

    updateState: (state, dt) => {
      if (state.started && !state.gameOver) {
        updateGameState(state, dt);
      }
    },

    serializeState: sanitizeState,

    handleDisconnect: (state, playerId) => {
      state.players[playerId].connected = false;
      state.connected[playerId] = false;
    },

    tickMs: 1000 / 60,
    dtFallback: 1 / 60,
  });
}
```

### Step 3: Register in Server

**File: `server/server.js`** — add these lines:

```js
import { registerMyGame } from "./games/myGame.js";
import { myGameMeta } from "./games/metadata.js";

// Add to catalog array:
const catalog = [
  { ...fightGameMeta },
  { ...pongGameMeta },
  { ...myGameMeta },        // <-- add
];

// Register socket handlers:
registerMyGame(io);          // <-- add
```

### Step 4: Create Client Files

**Directory: `public/games/myGame/`**

**File: `public/games/myGame/index.html`**

```html
<!doctype html>
<html>
<head><title>My Game</title></head>
<body>
  <canvas id="game-canvas"></canvas>
  <script src="https://unpkg.com/kaboom/dist/kaboom.js"></script>
  <script type="module" src="/games/myGame/main.js"></script>
</body>
</html>
```

**File: `public/games/myGame/main.js`**

```js
import { getGameDomRefs, getGameControls } from "/platform/shared/gameDom.js";
import { getGameSocket } from "/platform/shared/gameSocket.js";
import { createWorkerInterpolator } from "/platform/shared/interpolationWorker.js";
import { createClientPredictor } from "/platform/shared/clientPrediction.js";
import { createInputTimeline } from "/platform/shared/inputTimeline.js";
import { showEndGameModal, hideEndGameModal, registerRematchHandler } from "/platform/shared/endGameBridge.js";

const GAME_SLUG = "myGame";
const { canvas } = getGameDomRefs();
const { dpad } = getGameControls();
const socket = getGameSocket(GAME_SLUG);

// --- Kaboom init ---
kaboom({ width: 800, height: 600, canvas: canvas || undefined, maxFPS: 60 });

// --- Input state ---
const localInput = { left: false, right: false };

dpad.left.onHold(() => { localInput.left = true; }, () => { localInput.left = false; });
dpad.right.onHold(() => { localInput.right = true; }, () => { localInput.right = false; });

// --- Interpolation (for remote player) ---
const interpolator = createWorkerInterpolator({
  extractPositions: (state) => ({
    p1x: state.players.p1.x, p1y: state.players.p1.y,
    p2x: state.players.p2.x, p2y: state.players.p2.y,
  }),
  extractVelocities: (state) => ({  // Optional: enables Hermite cubic interpolation
    p1x: state.players.p1.vx || 0, p1y: state.players.p1.vy || 0,
    p2x: state.players.p2.vx || 0, p2y: state.players.p2.vy || 0,
  }),
  interpDelayMs: 50,
  maxBufferSize: 12,
});

// --- Client prediction (for local player) ---
const predictor = createClientPredictor({
  moveSpeed: 300, gravity: 0, groundY: 400,
  worldMinX: 0, worldMaxX: 800,
});

// --- Input timeline (sequenced input with server ack) ---
const inputTimeline = createInputTimeline({
  hz: 60,
  captureInput: () => ({ left: localInput.left, right: localInput.right }),
  sendFrame: (frame) => {
    socket.send("input", { type: "inputFrame", seq: frame.seq, dtSec: frame.dtSec, state: frame.input });
  },
});

// --- Networking ---
let myPlayerId = null;
let gameId = null;
let latestState = null;

socket.onEvent("connect", () => {
  // Create or join room from URL
  const roomId = window.location.pathname.split("/").pop() || "lobby";
  socket.send("joinGame", { gameId: roomId });
});

socket.onEvent("gameJoined", ({ playerId, gameId: id }) => {
  myPlayerId = playerId;
  gameId = id;
  inputTimeline.start();
});

socket.onEvent("state", (state) => {
  latestState = state;
  interpolator.pushState(state);

  // Acknowledge server's input sequence
  const localPlayer = myPlayerId && state.players?.[myPlayerId];
  if (localPlayer?.inputSeqAck != null) {
    inputTimeline.acknowledge(localPlayer.inputSeqAck);
    predictor.reconcile(localPlayer);
  }
});

// --- Scene ---
scene("main", () => {
  const p1 = add([rect(40, 40), pos(200, 400), color(0, 200, 0), anchor("center")]);
  const p2 = add([rect(40, 40), pos(600, 400), color(200, 0, 0), anchor("center")]);

  onUpdate(() => {
    const positions = interpolator.getInterpolatedPositions();
    if (!positions) return;

    const dt = 1 / 60;
    const localPlayer = myPlayerId && latestState?.players?.[myPlayerId];
    const predicted = predictor.step(dt, localPlayer, localInput, {
      active: Boolean(latestState?.started),
      attackSlowdown: false,
    });

    if (myPlayerId === "p1") {
      p1.pos.x = predicted ? predicted.x : positions.p1x;
      p2.pos.x = positions.p2x;
    } else if (myPlayerId === "p2") {
      p1.pos.x = positions.p1x;
      p2.pos.x = predicted ? predicted.x : positions.p2x;
    }
  });
});

go("main");
```

### Step 5: Add to Frontend Catalog

**File: `public/platform/src/data/games.js`**

```js
export const gameTitles = {
  fight: "Kaboom Fight",
  pong: "Kaboom Pong",
  myGame: "My Game",        // <-- add
};

export const fallbackGames = [
  // ... existing entries ...
  {
    id: "myGame",
    name: "My Game",
    description: "A custom multiplayer game.",
    path: "/games/myGame",
    tags: ["Real-time", "2 players"],
  },
];

export const visualsByGame = {
  // ... existing entries ...
  myGame: {
    status: "NEW",
    players: "2P",
    icon: "sports_esports",
  },
};
```

### Done!

Restart the server. Visit `http://localhost:3000` and your game appears in the lobby.

---

## Server-Side API

### `registerGame(options)`

**Import:** `import { registerGame } from "../utils/registerGame.js";`

The core framework for registering a multiplayer game. Handles room creation, socket wiring, and the 60Hz game loop.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `io` | Server | *required* | Socket.IO server instance |
| `meta` | Object | *required* | Game metadata (`{ id, name, namespace, ... }`) |
| `createState` | `() => Object` | *required* | Factory that returns initial game state |
| `onStateCreated` | `(state) => void` | — | Called once after state is created |
| `onPlayerConnected` | `(state, playerId) => void` | — | Called when a player joins the room |
| `handleInput` | `({ state, playerId, payload }) => void` | — | Called on every player input event |
| `handleDisconnect` | `(state, playerId) => void` | — | Called when a player disconnects |
| `handleRematch` | `({ socket, games, nsp }) => void` | — | Called on rematch request (optional) |
| `beforeUpdate` | `(state, dt) => void` | — | Called before `updateState` each tick |
| `updateState` | `(state, dt) => void` | *required* | Core game logic, runs every tick |
| `serializeState` | `(state) => Object` | — | Transform state before sending to clients |
| `afterEmit` | `(state) => void` | — | Called after state is broadcast |
| `shouldCleanup` | `(state) => boolean` | — | Return true to delete abandoned room |
| `tickMs` | number | `1000/60` | Server tick interval in ms |
| `dtFallback` | number | `1/60` | Fallback delta time if measurement fails |
| `stateEvent` | string | `"state"` | Socket event name for state broadcast |

### `applySequencedInput(options)`

**Import:** `import { applySequencedInput } from "../utils/inputProtocol.js";`

Applies sequenced input from the client with automatic ack tracking. Supports both streaming input frames and discrete events.

```js
applySequencedInput({
  player,                    // Player object (must have .input and .lastInputSeqAck)
  payload,                   // Raw payload from client: { type, seq, state }
  inputTemplate: { left: false, right: false },  // Input shape
});
```

The `player.lastInputSeqAck` field is automatically updated. Include it in your `serializeState` as `inputSeqAck` so the client can trim its pending input queue.

### Game Metadata Shape

```js
{
  id: "myGame",              // URL-safe identifier
  name: "My Game",           // Display name
  description: "...",        // Short description
  namespace: "/myGame",      // Socket.IO namespace (must start with /)
  path: "/games/myGame",     // URL path
  tags: ["Real-time", "2 players"],
}
```

---

## Client Platform API

All client modules are ES modules. Import them from `/platform/shared/` in your game's `main.js`.

### gameSocket.js

```js
import { getGameSocket } from "/platform/shared/gameSocket.js";
const socket = getGameSocket("myGame");
```

Creates a Socket.IO connection to the game's namespace with msgpack encoding and automatic ping/jitter tracking.

| Method | Signature | Description |
|--------|-----------|-------------|
| `onEvent` | `(event, handler) => unsubscribe` | Listen for a socket event. Returns cleanup function. |
| `offEvent` | `(event, handler?) => void` | Remove listener(s) for an event. |
| `send` | `(event, payload) => void` | Emit an event to the server. |
| `isConnected` | `() => boolean` | Check if socket is connected. |
| `getPing` | `() => number \| null` | Current RTT in milliseconds. |
| `getConnectionState` | `() => string` | `"connected"`, `"disconnected"`, or `"reconnecting"`. |
| `onConnectionChange` | `(callback) => unsubscribe` | Subscribe to connection state changes. Fires immediately with current state. |
| `destroy` | `() => void` | Disconnect and clean up all listeners. |

**Example:**

```js
socket.onEvent("state", (state) => {
  // Handle server state update (fires at ~60Hz)
});

socket.onEvent("gameJoined", ({ playerId, gameId }) => {
  console.log("Joined as", playerId);
});

socket.send("input", { type: "inputFrame", seq: 1, state: { left: true } });
```

### gameDom.js

```js
import { getGameDomRefs, getGameControls } from "/platform/shared/gameDom.js";
```

**`getGameDomRefs()`** — Returns `{ canvas }` with a reference to the game canvas element.

**`getGameControls()`** — Returns the controller interface for the on-screen gamepad:

```js
const { dpad, actions, menu } = getGameControls();

// D-pad directions (hold events for sustained input)
dpad.up.onHold(onDown, onUp)       // => cleanup function
dpad.down.onHold(onDown, onUp)
dpad.left.onHold(onDown, onUp)
dpad.right.onHold(onDown, onUp)

// Action buttons (press events for one-shot input)
actions.a.onPress(handler)          // => cleanup function
actions.b.onPress(handler)
actions.x.onPress(handler)
actions.y.onPress(handler)

// Menu buttons
menu.start.onPress(handler)
menu.home.onPress(handler)
menu.select.onPress(handler)
```

**Control methods:**

| Method | Description |
|--------|-------------|
| `onHold(onDown, onUp)` | `onDown()` on pointer/touch start, `onUp()` on release. Returns cleanup function. |
| `onPress(handler)` | `handler()` on click/tap. Returns cleanup function. |

Buttons are matched by data attributes in the DOM: `data-dir="left"`, `data-action="a"`, etc. Touch and pointer events are handled automatically for mobile support.

**Example: Mapping D-pad to game input**

```js
const input = { left: false, right: false, jump: false };

dpad.left.onHold(() => { input.left = true; }, () => { input.left = false; });
dpad.right.onHold(() => { input.right = true; }, () => { input.right = false; });
dpad.up.onHold(() => { input.jump = true; }, () => { input.jump = false; });
```

### interpolationWorker.js (Recommended)

```js
import { createWorkerInterpolator } from "/platform/shared/interpolationWorker.js";
```

Smooth position rendering for remote players. Buffers server snapshots and interpolates between them using Hermite cubic splines (when velocities are provided) or linear lerp.

Despite the name, this runs **synchronously on the main thread** (not a Web Worker). The name is legacy.

**Config:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `extractPositions` | `(state) => Object` | *required* | Extract `{key: number}` position fields from server state |
| `extractVelocities` | `(state) => Object` | — | Extract matching velocity fields. Enables Hermite cubic interpolation. |
| `interpDelayMs` | number | 50 | Render delay behind server (ms). Lower = less latency, more extrapolation. Range: 30-100. |
| `maxBufferSize` | number | 10 | Max snapshots in buffer. At 60Hz, 12 = 200ms of history. Range: 6-20. |
| `adaptive` | boolean | true | Auto-tune delay based on network quality. |

**Methods:**

| Method | Signature | Description |
|--------|-----------|-------------|
| `pushState` | `(state) => void` | Buffer a new server snapshot. Call on every `"state"` event. |
| `getInterpolatedPositions` | `(runtimeOpts?) => Object \| null` | Get interpolated positions for this frame. Call in `onUpdate`. |
| `getLatestState` | `() => Object \| null` | Get the raw latest server state. |
| `getNetworkStats` | `() => Object` | Get jitter, packet loss, update rate, etc. |
| `reset` | `() => void` | Clear buffer. Call on rematch/scene change. |
| `destroy` | `() => void` | Clean up. |

**Example:**

```js
const interpolator = createWorkerInterpolator({
  extractPositions: (state) => ({
    p1x: state.players.p1.x,
    p1y: state.players.p1.y,
    p2x: state.players.p2.x,
    p2y: state.players.p2.y,
  }),
  extractVelocities: (state) => ({   // Same keys as positions, values are velocity
    p1x: state.players.p1.vx || 0,
    p1y: state.players.p1.vy || 0,
    p2x: state.players.p2.vx || 0,
    p2y: state.players.p2.vy || 0,
  }),
  interpDelayMs: 50,
  maxBufferSize: 12,
});

// On server state:
socket.onEvent("state", (state) => interpolator.pushState(state));

// Every render frame:
onUpdate(() => {
  const pos = interpolator.getInterpolatedPositions();
  if (pos) {
    player1.pos.x = pos.p1x;
    player2.pos.x = pos.p2x;
  }
});
```

### clientPrediction.js

```js
import { createClientPredictor } from "/platform/shared/clientPrediction.js";
```

Instant local input response via client-side physics simulation. The predictor runs the same physics as the server, then reconciles with authoritative server state via soft correction offsets that decay over time.

**Config (all optional with defaults):**

| Option | Default | Range | Description |
|--------|---------|-------|-------------|
| **Physics (must match server)** | | | |
| `moveSpeed` | 500 | — | Horizontal move speed (units/sec) |
| `jumpSpeed` | -1300 | — | Initial jump velocity |
| `gravity` | 1600 | — | Downward acceleration |
| `worldMinX` | 100 | — | Left boundary |
| `worldMaxX` | 1180 | — | Right boundary |
| `groundY` | 870 | — | Ground level Y coordinate |
| `minSeparation` | 120 | — | Min distance between players for push-apart |
| **Correction tuning** | | | |
| `correctionBlendFactor` | 0.35 | 0.15-0.6 | Per-tick blend toward server error. Higher = faster settling, less wobble. |
| `correctionDeadzone` | 0.5 | 0.25-2.0 | Ignore errors smaller than this (px). Prevents micro-oscillation. |
| `correctionDecayCoeff` | 22 | 10-35 | How fast corrections decay per frame. Higher = springier. |
| `correctionClampMin/Max` | -140/140 | 80-200 | Max correction offset (px). |
| `hardSnapDistSq` | 62500 | 22500-90000 | Squared distance for hard teleport (250px = 62500). |
| `hardSnapVerticalError` | 150 | 80-200 | Vertical error threshold for teleport (px). |
| **Contact tuning (near-opponent behavior)** | | | |
| `proximityLerpMax` | 0.35 | 0.15-0.6 | Per-frame lerp toward server when touching opponent. |
| `proximityLerpRange` | 2 | 1.5-3.0 | Multiple of minSeparation where server-follow begins. |
| `contactExitBuffer` | 50 | 30-100 | Extra px before contact assist fully releases. |
| `contactAssistRiseRate` | 24 | 10-30 | How fast contact assist engages (1/sec). |
| `contactAssistFallRate` | 10 | 4-20 | How fast contact assist releases (1/sec). |
| `contactMoveSuppression` | 0.85 | 0.5-0.9 | How much local movement is suppressed near opponent (0-1). |
| `contactServerFollowRate` | 22 | 10-30 | Server-follow speed near contact (1/sec). |

**Methods:**

| Method | Signature | Description |
|--------|-----------|-------------|
| `step` | `(deltaSec, serverPlayer, input, opts) => {x, y} \| null` | Advance prediction by one frame. Call every render tick. |
| `reconcile` | `(serverPlayer) => void` | Blend toward server state. Call on every server tick. |
| `reset` | `(serverPlayer?) => void` | Hard reset to server state. Call on scene entry. |
| `injectCorrection` | `(cx, cy) => void` | Inject visual offset (e.g. after resimulation). Decays naturally. |
| `getState` | `() => Object` | Debug: get internal prediction state. |

**`step()` opts parameter:**

| Field | Type | Description |
|-------|------|-------------|
| `active` | boolean | Whether prediction is active (game started, both connected). |
| `attackSlowdown` | boolean | Apply attack speed penalty. |
| `opponentX` | number | Opponent X position (for contact detection). |
| `opponentY` | number | Opponent Y position (for contact detection). |
| `replay` | boolean | Set true during resimulation replay. |

**Example:**

```js
const predictor = createClientPredictor({
  moveSpeed: 300,
  gravity: 1600,
  groundY: 600,
  worldMinX: 0,
  worldMaxX: 800,
});

// On server state:
predictor.reconcile(serverPlayerState);

// Every render frame:
const predicted = predictor.step(dt, serverPlayerState, localInput, {
  active: true,
  attackSlowdown: false,
});
if (predicted) {
  player.pos.x = predicted.x;
  player.pos.y = predicted.y;
}
```

### inputTimeline.js

```js
import { createInputTimeline } from "/platform/shared/inputTimeline.js";
```

Captures input at a fixed rate, assigns sequence numbers, and maintains a pending queue for rollback replay.

**Config:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `hz` | number | 60 | Input polling rate in Hz |
| `maxPendingFrames` | number | 240 | Max input frames in pending queue |
| `captureInput` | `() => Object` | — | Return current input state snapshot |
| `sendFrame` | `(frame) => void` | — | Send frame to server. Frame: `{ seq, dtSec, input }` |

**Methods:**

| Method | Description |
|--------|-------------|
| `start()` | Start polling input at configured Hz. |
| `stop()` | Stop polling. |
| `reset()` | Clear pending frames and reset sequence counter. |
| `acknowledge(seq)` | Remove all pending frames up to `seq`. Call when server acks input. |
| `getPendingFrames()` | Get reference to pending frames array (for resimulation replay). |
| `sendNow()` | Capture and send a frame immediately. |
| `isRunning()` | Check if timeline is active. |

**Example:**

```js
const timeline = createInputTimeline({
  hz: 60,
  captureInput: () => ({ left: input.left, right: input.right }),
  sendFrame: (frame) => {
    socket.send("input", {
      type: "inputFrame",
      seq: frame.seq,
      dtSec: frame.dtSec,
      state: frame.input,
    });
  },
});

timeline.start();

// On server ack:
socket.onEvent("state", (state) => {
  const ack = state.players[myId]?.inputSeqAck;
  if (ack != null) timeline.acknowledge(ack);
});
```

### endGameBridge.js

```js
import {
  showEndGameModal,
  hideEndGameModal,
  updateEndGameModal,
  registerRematchHandler,
} from "/platform/shared/endGameBridge.js";
```

| Function | Description |
|----------|-------------|
| `showEndGameModal({ title, subtitle, status, phase, winner })` | Show the end-game overlay. `phase`: `"ready"` or `"waiting"`. |
| `updateEndGameModal({ status, actionLabel, phase })` | Update specific fields on the modal. |
| `hideEndGameModal()` | Hide the modal and reset state. |
| `registerRematchHandler(callback)` | Register a function called when the player clicks rematch. |

### shareModalBridge.js

```js
import { openShareModal, closeShareModal } from "/platform/shared/shareModalBridge.js";
```

Opens/closes the room invite modal so players can share the room URL.

### connectionBridge.js

```js
import { updateConnectionState, subscribeConnectionState, getConnectionState } from "/platform/shared/connectionBridge.js";
```

Bridge between game socket metrics and the React UI. Call `updateConnectionState({ status, ping })` from your game to update the connection indicator.

### performanceSettings.js

```js
import {
  loadPerformanceSettings,
  savePerformanceSettings,
  getRuntimePerformanceProfile,
} from "/platform/shared/performanceSettings.js";
```

Manages FPS target and resolution scale. Settings persist in localStorage.

---

## Input System

The platform provides a virtual gamepad with D-pad, action buttons (A/B/X/Y), and menu buttons (Start/Home/Select). It works on both desktop (click) and mobile (touch/pointer events).

### Button Layout

```
         [UP]                    [Y]
   [LEFT]    [RIGHT]        [X]     [A]
        [DOWN]                  [B]

   [HOME]  [SELECT]  [START]
```

### DOM Data Attributes

The controller buttons use data attributes for identification:

| Attribute | Values |
|-----------|--------|
| `data-dir` | `up`, `down`, `left`, `right` |
| `data-action` | `a`, `b`, `x`, `y`, `start`, `home`, `select` |

### Input Pattern (from Fight game)

```js
const { dpad, actions, menu } = getGameControls();
const input = { left: false, right: false, jump: false, attack: false };

// D-pad: continuous hold
dpad.left.onHold(() => { input.left = true; }, () => { input.left = false; });
dpad.right.onHold(() => { input.right = true; }, () => { input.right = false; });
dpad.up.onHold(() => { input.jump = true; }, () => { input.jump = false; });

// Actions: one-shot with auto-release
actions.a.onPress(() => {
  input.attack = true;
  setTimeout(() => { input.attack = false; }, 150);
});

// Menu
menu.start.onPress(() => openShareModal());
```

### Keyboard Input

Kaboom.js provides built-in keyboard handling. Use Kaboom's `onKeyDown` / `onKeyPress` / `onKeyRelease` for desktop keyboard support:

```js
onKeyDown("left", () => { input.left = true; });
onKeyRelease("left", () => { input.left = false; });
onKeyDown("right", () => { input.right = true; });
onKeyRelease("right", () => { input.right = false; });
onKeyPress("space", () => { input.jump = true; });
```

---

## Netcode Guide

### Architecture Overview

```
Server (60Hz)                    Client (60fps)
     |                                |
     |  -- state packet (msgpack) --> |
     |                                |  1. Buffer snapshot for interpolation
     |                                |  2. Reconcile prediction with server
     |                                |  3. Acknowledge input sequence
     |                                |
     |                                |  Per render frame:
     |                                |  - Local player: client prediction (instant)
     |                                |  - Remote player: Hermite interpolation (smooth)
     |                                |
     |  <-- input frame (seq, dt) --- |
     |                                |
     | Apply input, advance physics   |
     | Broadcast state with inputSeqAck
```

### Interpolation

Remote players are rendered using **Hermite cubic spline interpolation** between server snapshots. This produces C1-continuous curves (smooth velocity transitions) — the same technique used by Source Engine, Unreal, and Unity.

**How it works:**
1. Server sends state at 60Hz. Each snapshot is buffered with a timestamp.
2. The client renders 50ms behind the latest snapshot (configurable `interpDelayMs`).
3. Each frame, the interpolator finds the two snapshots surrounding the render time and interpolates between them.
4. If `extractVelocities` is provided, Hermite cubic interpolation is used. Otherwise, linear lerp.
5. If the render time is ahead of all snapshots (packet loss), the system extrapolates using velocity data.

**Without velocities (linear):** Position jumps between straight-line segments at each snapshot.
**With velocities (Hermite):** Position follows smooth curves that respect velocity at each snapshot.

### Client Prediction

The local player uses **client-side prediction** for instant input response:

1. Player presses a key → local physics simulation runs immediately
2. Server receives the input, runs authoritative simulation, sends back state with `inputSeqAck`
3. Client receives server state → reconciles by computing error between predicted and server position
4. Error is absorbed as a **correction offset** that decays exponentially over subsequent frames
5. If error exceeds thresholds, **resimulation** replays all pending inputs from the server's authoritative state

### Resimulation (Rollback-Replay)

When prediction diverges too far from the server:

1. Save current visual position
2. Reset predictor to server's authoritative position
3. Replay all pending (unacknowledged) input frames
4. Inject the visual difference as a decaying correction to prevent pops

**Tunable thresholds** (in `main.js`):

| Parameter | Default | Range | Description |
|-----------|---------|-------|-------------|
| `RESIM_ERROR_PX` | 12 | 6-30 | Soft trigger: resim when prediction diverges this far (px) |
| `RESIM_HARD_ERROR_PX` | 28 | 16-60 | Hard trigger: force resim at this error |
| `RESIM_COOLDOWN_MS` | 50 | 30-200 | Min time between resimulations (ms) |

### Tuning Guide

**Movement feels laggy / floaty:**
- Increase `correctionBlendFactor` (faster error absorption)
- Decrease `RESIM_COOLDOWN_MS` (more frequent resim)
- Decrease `correctionDecayCoeff` (corrections last longer to close gaps)

**Movement has visible jitter / micro-teleports:**
- Increase `correctionDeadzone` (ignore small errors)
- Increase `hardSnapDistSq` (fewer hard teleports)
- Decrease `correctionBlendFactor` (slower, smoother correction)

**Near-opponent oscillation:**
- Increase `contactMoveSuppression` (less local movement near contact)
- Increase `contactServerFollowRate` (follow server more)
- Increase `proximityLerpMax` (stronger server pull)

**Remote player stutters:**
- Increase `interpDelayMs` (more buffer = smoother)
- Add `extractVelocities` for Hermite interpolation
- Check network quality via `interpolator.getNetworkStats()`
