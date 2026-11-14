# Game developer SDK

Sky Dash is a third-person 3D integration using the same room, queued-input,
prediction, touch layout and shell control contracts as the existing games.
See [its package guide](../public/games/sky-dash/README.md) for controls, game
configuration and two-human/three-bot capacity boundaries.

The platform provides transport, room allocation, scheduling, input queues, snapshots, optional prediction/reconciliation, interpolation and diagnostics. A game supplies configuration, graphics and its own rules. Common movement and action mechanics can use platform controllers; custom simulation callbacks remain available.

This is a trusted, in-process plugin contract. Loading uploaded third-party server code requires a separate isolation/hosting design. Registering a callback here does not create a sandbox.

## Package boundaries

| Location | Responsibility |
|---|---|
| `public/platform/frontend-engine/` | Game-independent browser SDK |
| `public/platform/shared/` | Protocol contracts and optional pure simulation controllers |
| `server/platform-backend-engine/core/` | Game-independent authoritative services |
| `public/games/<id>/shared/` | The game's controller settings and custom pure rules, shared with its server |
| `public/games/<id>/main.js` | Controls, rendering and SDK configuration |
| `server/platform-backend-engine/games/` | Game server adapters and trusted built-in composition |

Adding a trusted game changes its package and the application's package list, not networking engine internals. Core code must not branch on a game's ID or import concrete games.

## Register a game

`createGameRegistry()` accepts an array of `{ apiVersion: 1, meta, register }` plugins. For a single-player game, set `meta.networked: false` and omit `register`. Networked games declare a unique namespace and a trusted `register(io)` callback. IDs, client paths, namespaces, room metadata and networking capabilities are validated before callbacks run.

Catalog metadata must support structured cloning and JSON serialization. Circular references, BigInt values and functions are rejected during registration, before any game is mounted. Shared acyclic settings, Dates and optional fields remain supported.

```js
const gameMetadata = {
  id: "paddle-demo",
  name: "Paddle Demo",
  path: "/games/paddle-demo",
  namespace: "/paddle-demo",
  room: { playerIds: ["north", "south", "east"] },
  networking: {
    namespace: "/paddle-demo",
    tickRateHz: 60,
    inputProtocol: 2,
    inputTemplate: { raise: false, lower: false },
  },
  runtime: {
    kind: "module",
    mount: "canvas",
    entryUrl: "/games/paddle-demo/main.js",
    socketIo: true,
  },
};

const gameRegistry = createGameRegistry([
  { apiVersion: 1, meta: gameMetadata, register: registerPaddleDemo },
]);
```

The current application assembles trusted packages in `server/platform-backend-engine/games/builtInGames.js`. Its HTTP catalog, routes and diagnostic tool consume the registry. The browser platform uses `/games/<id>/<roomId>` routes; use that route convention for new client paths.

Room state provides a `players` object with one state per slot. Registration uses `meta.room.playerIds` when present; otherwise it infers slots from `state.players`. Slot count and names are game-defined. Each slot is an object with platform-owned connection/rejoin fields and game-owned state. `scheduleStart()` can wait for all inferred slots or an explicitly supplied set.

Player slot IDs use ASCII letters, digits, underscores and hyphens. Numeric-only IDs and `__proto__`, `constructor` and `prototype` are rejected because the current snapshot schema treats keys as dotted paths. IDs such as `crew-01`, `01pilot` and `_engineer` work. Keep user-facing display names in separate fields; snapshot object field names must also avoid embedded dots and prototype traversal keys.

## Supply game library artwork

The library and selected-game showcase read optional `meta.presentation` from the public catalog. Define it in the game package (the bundled games use `public/games/<id>/catalog.js`) and reuse that object in server registration and any browser fallback catalog. Adding a cover requires no platform UI changes.

```js
presentation: {
  coverUrl: "/games/paddle-demo/assets/cover.svg",
  accentColor: "#63e6dc",
  controls: ["keyboard", "touch"],
},
```

All three fields are optional. `coverUrl` accepts a root-relative path or HTTPS URL; a landscape image around 2:1 works well. Keep artwork's subject toward the right so the showcase title remains readable. Supply an illustration or actual gameplay image without embedded interface chrome. Missing or failed artwork uses the platform fallback. `accentColor` is a six-digit hex color. `controls` lists supported inputs from `keyboard`, `touch`, and `pointer` (mouse/pen); omit controls the game does not support. Invalid supplied fields are rejected before registration.

The platform derives capacity from `meta.room.playerIds`, with older player-count tags supported as a fallback. These labels describe supported capacity, not current online players. Titles, descriptions, and genre tags also come from ordinary game metadata. The library does not fabricate playtime, completion progress, or last-played activity.

## Declare reusable touch controls

Games opt into platform touch controls with a versioned `meta.touchControls` descriptor. Keep it in the game package and reuse it in server metadata and the browser fallback catalog. The platform supplies pointer ownership, 2/3/4-finger presets, a visual editor and browser/device persistence. Games own the meaning of control IDs, movement, camera sensitivity, combat and input mapping.

```js
export const touchControls = {
  apiVersion: 1,
  customizable: true,
  defaultPreset: "two-thumb",
  allowedPresets: ["two-thumb", "three-finger", "four-finger"],
  controls: [
    { id: "move", type: "stick", role: "move", label: "Move", icon: "joystick" },
    { id: "look", type: "look", role: "look", label: "Look", editable: false },
    { id: "fire", type: "button", role: "primary", label: "Fire", icon: "my_location", behavior: "hold-look" },
    { id: "jump", type: "button", role: "jump", label: "Jump", behavior: "press" },
    { id: "reload", type: "button", role: "reload", label: "Reload", defaultLayout: { size: 52, opacity: 0.65 } },
  ],
};

const gameMetadata = {
  // Other registration fields...
  touchControls,
};
```

The descriptor is optional. Set `customizable: false` to supply fixed runtime controls while preventing player edits; omit the descriptor to keep existing game-owned controls. Only games with explicit `customizable: true` appear in platform Game controls settings. Developer permission and `editable: false` always override saved preferences. A `look` area is always fixed. Restrict `allowedPresets` when only particular layouts suit the game; `defaultPreset` must be included.

The version 1 contract accepts at most 16 controls. IDs are unique strings of 1–48 ASCII letters, digits, underscores or hyphens; `__proto__`, `constructor` and `prototype` are reserved. Labels are nonempty and at most 64 characters. Optional icons are plain names of at most 64 letters, digits, underscores or hyphens. Metadata has closed shapes: unsupported fields, types, roles, behavior values, nonfinite numbers and out-of-range defaults fail registration before callbacks mount.

Supported types are `stick`, `look` and `button`. Roles are `move`, `look`, `primary`, `secondary`, `reload`, `jump` and `utility`. Roles select placement independently of type, while game-defined IDs select game behavior; for example, a game may declare a `stick` with role `look`. Multiple utility buttons remain possible. Presets contain only declared controls: three fingers move primary action to the upper left, and four fingers also move secondary action to the upper right. Two thumbs place primary action near the lower right; `hold-look` allows the firing thumb to drag the camera at the same time.

`defaultLayout` may override any subset of `{ x, y, size, opacity }`: x/y are normalized centers from 0 to 1, size is 44–160 CSS pixels, and opacity is 0.25–1. The platform insets rendered controls to keep their full targets inside the host. Portrait and landscape have separate defaults and saved profiles. Individual default overrides apply to every preset; omit x/y to use each preset's placement.

`public/platform/shared/touchControls.js` exports the descriptor/profile JSDoc types, `TOUCH_PRESET_IDS`, `TOUCH_CONTROL_LIMITS`, `createDefaultTouchProfile(descriptor)`, `sanitizeTouchProfile(descriptor, candidate)`, `resolveTouchLayout(descriptor, profile, orientation)`, and `updateTouchControl(profile, controlId, patch)`. Profiles are owned values with `{ version: 2, presetId, mode, hideShell, layouts }`. The descriptor API remains version 1; `TOUCH_PROFILE_VERSION` independently versions saved preferences. `mode` is `auto` by default and also accepts `on`/`off`; `hideShell` defaults to true and applies independently of touch detection. Visible controls default to about 40% opacity and brighten when pressed. Version-1 profiles retain preset/positions/sizes while adopting expanded play, automatic display and lower opacity. Explicit version-2 preferences remain respected; storage keys stay compatible. Layout maps hold partial overrides per preset. Sanitization discards removed/unknown/locked controls, ignores nonfinite or nonnumeric values, clamps finite values and preserves developer defaults for new controls. Editing an owned draft changes no saved data until Save.

`touchControlSettings.js` supplies `loadTouchProfile(gameId, descriptor, orientation)`, `saveTouchProfile(gameId, descriptor, orientation, profile)` and `subscribeTouchProfile(gameId, descriptor, orientation, listener)`. Storage is local to this browser/device, game, orientation and preset; it does not sync through an account. Saving returns `{ profile, persisted }`. When quota or blocked storage prevents persistence, the returned profile remains usable for this page's session and `persisted` is false. Tell the player that these changes are session-only. Same-page saves and cross-tab updates notify subscribers; malformed stored JSON falls back safely. Unsubscribe when the owning view unmounts.

Browser games subscribe through the SDK's window event boundary, which works across separately bundled game and React modules:

```js
import {
  subscribePlatformTouchInput,
  isPlatformTouchControlsActive,
} from "/platform/frontend-engine/touchControlSurface.js";

const touchInput = { moveX: 0, moveY: 0, fire: false, jumpQueued: false };
const unsubscribeTouch = subscribePlatformTouchInput(gameMetadata.id, (inputEvent) => {
  if (inputEvent.type === "reset") {
    touchInput.moveX = 0;
    touchInput.moveY = 0;
    touchInput.fire = false;
    touchInput.jumpQueued = false;
  } else if (inputEvent.type === "axis" && inputEvent.controlId === "move") {
    touchInput.moveX = inputEvent.x;
    touchInput.moveY = inputEvent.y;
  } else if (inputEvent.type === "look") {
    rotateGameCamera(inputEvent.deltaX, inputEvent.deltaY); // Game-owned sensitivity/rules.
  } else if (inputEvent.type === "action" && inputEvent.controlId === "fire") {
    touchInput.fire = inputEvent.active;
  } else if (inputEvent.type === "action" && inputEvent.controlId === "jump" && inputEvent.active) {
    touchInput.jumpQueued = true;
  }
});
```

Merge these values into the game's existing input capture and consume queued actions once. Button `hold` (the default) emits true on press and false on release; `press` emits a true/false pulse on press, which games should latch until capture; `hold-look` also emits relative CSS pixel look deltas with that button's ID. Background right-half swipes use the declared look control ID. Stick axes use a circular deadzone, point right/down and have magnitude at most one. `isPlatformTouchControlsActive(gameId)` lets adapters suppress legacy touch controls while keeping keyboard/mouse behavior. Runtime teardown must call `unsubscribeTouch()`.

Games already using `getGameControls()` can declare optional `platformBinding` values instead of adding a second touch adapter:

```js
controls: [
  { id: "move", type: "stick", role: "move", label: "Move", platformBinding: "horizontal" },
  { id: "jump", type: "button", role: "primary", label: "Jump", platformBinding: "a" },
],
```

Stick bindings accept `horizontal`, `vertical` or `directions`; button bindings accept `up`, `down`, `left`, `right`, `a`, `b`, `x` or `y`. Look surfaces do not accept a binding. The SDK supplies held/press callbacks through a cross-bundle window boundary, without clicking hidden console DOM. Pointer source ownership keeps simultaneous controls independent and releases them on cancellation/disposal. Game-specific meanings stay in the package's existing control subscriptions. Custom numeric/aim adapters can omit `platformBinding` and continue using `platformtouchinput`.

The shell's `TouchControlSurface` owns the DOM binding. Custom platform surfaces can call `bindTouchControlSurface({ element, gameId, descriptor, layout, disabled })` and must dispose the returned binding. Place the surface in the game frame with `[data-touch-control-id]` children. Empty surface/look space uses `pointer-events: none`; the binding captures look on its parent host and ignores interactive HUD targets and platform chrome. It updates pressed/knob feedback directly in the DOM. Independent pointer IDs support movement, look and actions together; a finger's release cannot clear another finger's action. Cancel/capture loss releases that owner, and blur, hidden pages, host resize, disabling or disposal clear all input. Set `disabled` while platform dialogs/editors own focus. Layout editing never remounts the game renderer, and the match continues during editing.

Games default to an expanded play area with the console hidden on desktop and touch devices. A current profile can explicitly restore the console; changing the control visibility mode does not shrink the play area. Selecting a preset or editing button positions does not request browser fullscreen, lock orientation or remount the game. Returning to the library restores the console presentation and releases platform-owned fullscreen.

## Room voice chat

Registered multiplayer games share platform-owned voice controls; no game-specific WebRTC or audio forwarding code is required. Voice uses the existing room connection for bounded setup messages and browser WebRTC for media, independently of inputs and authoritative snapshots. Players explicitly join or listen only, then control microphone mute, incoming-audio mute and volume. The browser requests noise suppression, echo cancellation and automatic gain control, with mono Opus speech targeted at 24 kbps per outgoing peer.

The current topology supports at most four participants. Production coverage across restrictive/mobile networks requires a configured TURN relay; HTTPS is required for capture outside trusted localhost. See [voice setup, SDK usage, bandwidth limits and verification](voice-chat.md). Voice failures must never stop gameplay or affect authoritative outcomes.

## Browse large catalogs

The browser library requests bounded pages with `GET /api/games?page=1&pageSize=24&q=&genre=all&sort=name-asc`. The default page size is 24 and the maximum is 60. Supported sort values are `name-asc` and `name-desc`. Search matches titles, descriptions, and tags across the entire registered catalog. Genre options are global facets, not just tags from the visible page.

Add `customizable=true` to request only games whose touch descriptor explicitly allows customization. This filter, search and genre selection run across the catalog before pagination, including the bundled browser fallback. Omitted or false `customizable` preserves ordinary catalog behavior. Use bounded filtered pages for a controls picker instead of fetching the entire catalog.

Paged responses contain `{ games, total, page, pageSize, totalPages, genres }`. Pages beyond the current result set clamp to its last page. Invalid query parameters return HTTP 400. The browser debounces search and aborts obsolete requests; it mounts only the current page's cards. Desktop browsing uses a grid on the left and a full-height artwork panel on the right. Portrait browsing uses a full-width grid; selecting a game opens its details and Play action in a native dialog. Page jumps and previous/next controls keep the catalog navigable without an endless horizontal list.

Foreground artwork is contained within its frame so the entire image remains visible. Selected-game panels add a blurred decorative copy behind the complete image to fill different aspect ratios; titles and actions use their own layout space instead of covering the artwork.

`GET /api/games/:gameId` returns `{ game }` or HTTP 404, independently of pagination. Use this endpoint for direct/shared links instead of fetching every game to resolve one runtime. Runtime metadata stays stable while a game is active. The unparameterized `GET /api/games` remains available for legacy diagnostic clients; it returns the full catalog and should not be used by a large browser library.

The current catalog index is built from trusted registered game metadata at server startup. It supports catalog browsing; it does not add dynamic uploads, a tenant database, or game-hosting capacity. A persistent catalog can later implement the same page/detail contract.

## Platform-owned game presentation

The library uses the console shell; games default to a full-window play surface with the outer shell hidden. A landscape Play gesture requests native fullscreen synchronously before navigation, preserving the browser's transient user activation. Native denial or unsupported APIs fall back to the expanded viewport. A shared URL opens expanded without an unsolicited native request; players can use the labeled Fullscreen action. Escape exits native fullscreen without an automatic retry. Returning to the library restores the console and exits fullscreen owned by this game session, including late pending requests.

Every game starts in landscape on touch devices through the platform's shared presentation layer. A portrait touch viewport waits before initial runtime loading or room joining and shows a rotate-device prompt. A labeled **Use landscape fullscreen** action can enable fullscreen and retry rotation where supported. The legacy `startInLandscape` hint does not select this policy. Browser requirements are described in [requestFullscreen](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen).

After a game has started, later viewport changes keep its existing runtime, room and canvas. Returning to the library releases platform-owned orientation. This applies equally to shared-link entry and catalog launches, independently of the game's renderer or touch-customization capabilities. Games supply no orientation logic or new metadata fields.

Render within the supplied game host. Size or rotate a game's own drawing surface using its host's measured bounds and observe host resizes when needed. Do not use browser viewport dimensions to expand a renderer beyond the screen, mutate the outer shell, or request fullscreen/orientation from game initialization and input handlers. Route transitions may fade screen content without translating or scaling the console.

The platform's touch settings expose the **Expanded play area** preference, enabled by default. Players can restore the console from Config or the in-game Controls editor. The shell applies this choice without replacing the game canvas; game packages continue to fit the supplied host and do not toggle outer geometry themselves. Game HUD layers stay within the runtime stacking context so platform controls remain accessible.

Run `npm run test:presentation:browser` against the local server to verify landscape Play fullscreen, denied-request fallback, library restoration, saved-profile migration and translucent touch controls across the bundled catalog. Set `PLATFORM_PRESENTATION_GAMES=fight,pong` to select the touch games; native fullscreen/fallback checks still run. The suite uses an isolated Chrome profile and stores `game-presentation-*.png` screenshots in the OS temporary directory. `npm run test:orientation:browser` checks portrait startup, rotation restrictions and runtime continuity.

### Player control editor

Config → Game controls offers a bounded searchable picker containing only developer-enabled games. Players choose an allowed finger preset and edit button position, size, and opacity in a draft. Reset selected/Reset layout also remain drafts; Save applies them and Cancel discards them. Portrait and landscape profiles are labeled and saved separately for each game in the current device's browser. An open editor keeps its original target through device rotation.

Games with customization enabled also get a platform Controls button during play. The same editor sits over the existing renderer and explains that the session continues while editing; gameplay input is neutralized and higher-priority invitation/results/exit dialogs retain focus. The Options menu controls automatic/always/off display and Expanded play area. Layout changes do not request browser fullscreen, change device orientation or restart a room.

Run `npm run test:touch-controls:browser` against the local server for the complete two-client UI/touch regression. It uses an isolated Chrome profile, saves `touch-layout-*.png` screenshots in the OS temporary directory, and removes its profile on exit. `CHROME_PATH` overrides the default macOS Chrome executable; `PLATFORM_BASE_URL` overrides `http://localhost:3100`.

## Configure mechanics instead of rewriting them

For bounded movement along an axis, configure a step function:

```js
import { createAxisMovementController } from "/platform/shared/simulationControllers.js";

export const stepPlayer = createAxisMovementController({
  state: { position: "height" },
  input: { negative: "raise", positive: "lower" },
  speed: 900,
  min: 80,
  max: 640,
});
```

This works with `{ height: 360 }` state and `{ raise: true, lower: false }` input. The same pure function runs in browser prediction and authoritative simulation.

Other optional factories in the same module are:

- `createSideViewCharacterController({state,input,movement,actions?})`: configure field bindings, speed, gravity, jump velocity, floor, bounds and optional timed actions.
- `createTimedActionController({state,definitions,bindings,onStart?})`: configure action durations/cooldowns and ordered input bindings. A binding has `{inputKey,actionId,when?}`; ordinary bindings need no handwritten predicate.
- `createHorizontalSeparationController({state,minX,maxX,minDistance,verticalLimit})`: configure body separation and arena bounds. Wall contact transfers blocked displacement to the free body so the requested spacing is preserved, up to the available arena span.

Controllers validate settings at construction. They mutate the supplied owned player state and read inputs. Input/state field bindings let games use their own names. Custom conditions, effects and full simulation callbacks are supported; these mechanics are optional.

## Connect a browser game

The high-level API is `createNetworkedGameSession()`. Supply a game socket, interpolator, optional prediction configuration, authority mapping and pose mapping. It owns state subscriptions, command encoding, acknowledgement/replay, input epochs, buffering, connection timing and reconnect/rematch resets.

```js
const networkSession = createNetworkedGameSession({
  socket,
  interpolator,
  prediction: {
    fixedDtSec: 1 / 60,
    captureInput: () => controls.capture(),
    simulate: stepPlayer,
    extractPose: (playerState) => ({ height: playerState.height }),
  },
  readAuthority: (snapshot) => {
    const playerState = snapshot.players[localPlayerId];
    return playerState ? {
      state: playerState,
      protocol: snapshot.inputProtocol,
      inputEpoch: playerState.inputEpoch,
      acknowledgedSequence: playerState.inputSeqAck,
      context: { simulationTick: playerState.inputSimulationTick },
    } : null;
  },
  composeRenderPose: (remotePose, localPose) => remotePose ? {
    ...remotePose,
    localHeight: localPose?.height ?? remotePose.localHeight,
  } : null,
  canCaptureInput: (snapshot) => !snapshot.gameOver && !document.hidden,
  onReset: () => controls.reset(),
  onDiagnostics: updateConnectionState,
});
```

`socket` is the `getGameSocket(namespace)` facade. `localPlayerId` comes from its `gameJoined` event; game UI may also need that ID for labels and scoring. `interpolator` is created with `createWorkerInterpolator({extractPositions,extractVelocities?,interpDelayMs?,maxBufferSize?})`, using selectors appropriate to the game's snapshot shape. `controls` can use `createInputLatch(template,{edgeKeys,numericInputs})` so short boolean action presses survive between captures while numeric controls retain their magnitudes.

`composeRenderPose(remotePose, localPose, snapshot, predictedState)` also receives the current read-only prediction clone, or `null` without current ownership. Use it for discrete animation/action/serve identities instead of adding those values to `prediction.extractPose`, whose numeric fields absorb reconciliation offsets. Do not mutate or retain this borrowed state; copy the render fields you need. Existing callbacks that take fewer arguments continue to work.

```js
composeRenderPose(remotePose, localPose, snapshot, predictedState) {
  return {
    ...remotePose,
    localHeight: localPose?.height ?? snapshot.player.height,
    action: predictedState?.action ?? snapshot.player.action,
    actionId: predictedState?.actionId ?? snapshot.player.actionId,
  };
}
```

### Shared room connection

Use `createGameRoomConnection` alongside `createNetworkedGameSession` for games
with standard `/games/<gameId>/<roomId>` routes. It owns room creation, URL
publication, in-flight request deduplication and per-tab rejoin-token storage.
It subscribes before joining, ignores stale joins for other rooms and cancels
pending creation on disposal. The supplied socket remains caller-owned.

```js
import { createGameRoomConnection } from "/platform/frontend-engine/gameRoomConnection.js";

const roomConnection = createGameRoomConnection({
  gameId: "my-racer",
  socket,
  onJoined: ({ playerId }) => showAssignedRunner(playerId),
  onError: (message, retry) => showConnectionError(message, retry),
  onRematchRequested: () => showRematchOffer(),
});
// Read current ownership in the session's readAuthority callback.
const localPlayerId = roomConnection.getPlayerId();
// On explicit user action:
roomConnection.requestRematch();
// On runtime disposal, before destroying the socket:
roomConnection.dispose();
```

`gameId` uses the registered identifier alphabet. Optional `roomFullMessage`
customizes capacity feedback without assuming two players. Optional `storage`
can supply a Storage-compatible object or `null` to disable persistence;
`windowRef` and `fetchRoom` permit tests or embedding. Token access failures
allow the current connection to continue. Automatic socket reconnection,
bounded recovery and input epochs stay in the existing transport/input SDK.
Dead Shift and Sky Dash use this component with different input schemas.

### Platform readiness, invites and countdown

For a standard module runtime declaring `socketIo: true`, the transport publishes
a versioned `snapshot.net.room` contract independently
of gameplay subscriptions and asset loading. The standard shell consumes this
metadata automatically. Game packages must not automatically open an invite on
room assignment or implement a second platform countdown. Manual invite actions
remain available through the existing share bridge.

```js
import { scheduleStart } from "../core/index.js";
import { ROOM_START_COUNTDOWN_MS } from "../../../public/platform/shared/roomLifecycle.js";

function beforeUpdate(roomState) {
  scheduleStart(roomState, ROOM_START_COUNTDOWN_MS);
  if (!roomState.started && roomState.startAt !== null && Date.now() >= roomState.startAt) {
    roomState.started = true;
    roomState.startAt = null;
  }
}
```

The room state declares human `players` with `connected`, plus `started`,
`startAt` and `gameOver`. `scheduleStart` schedules once after all configured
human slots connect; its duration defaults to 5000 ms and remains an explicit
parameter for custom rules. All bundled multiplayer games use that shared
default, including Draw. Game input and simulation must remain inactive until
authority starts. On disconnect, pause the round and clear `startAt` so a
returning player gets a fresh shared countdown; preserve game progress.

Metadata has `{ apiVersion: 1, roomId, phase, startAtMs, countdownDurationMs,
connectedPlayers, requiredPlayers }`, with phase `waiting`, `countdown`,
`playing` or `finished`. Bots outside the human ownership table do not consume
seats. The transport adds `net.serverTime` and owns synchronization; clients use
a monotonic local anchor with bounded latency adjustment, so device wall-clock
skew and delayed ordered packets cannot rewind a countdown. Only the initial
authoritative transition into play produces GO; expiration of a local timer
never starts a game. Once the current seat has played, interrupted connections
and the server's resume countdown use a compact recovery notice over the retained
game surface, rather than reopening the initial joining dialog. Controls remain
paused until fresh authority resumes. The local presentation's `hasPlayed` flag
survives same-seat recovery and resets for rematches, new seats and recreated
rooms with a different ownership token; it is not an extra wire field.

Opening `/games/<id>` establishes new-room creator intent; after the room link
exists, its creator gets one automatic invitation while waiting. A direct shared
room URL joins without that invitation. Readiness, GO, terminal capacity errors,
modal focus and shell stability are platform-owned. Single-player/non-networked
packages keep their existing presentation. A terminal room-full error replaces
joining or an already open invitation, while transient owned-seat overlap still
uses the SDK's bounded recovery.

Prefer the unsubscribe function returned by `socket.onEvent` for cleanup.
`offEvent(event)` clears game subscribers for that event; transport-owned
decoding, lifecycle and connection listeners remain active until socket disposal.
The shell subscribes to the room lifecycle bridge without creating another socket.
Non-networked and independently embedded runtimes are not forced into this flow;
an iframe/other external runtime needs an explicit lifecycle adapter.

### Numeric controls and platform analog sticks

Declare every numeric field with `{min,max,integer?}`. Templates contain the neutral state restored on reset, including nonzero numbers such as an initial weapon selection. Reuse the same template/ranges in the browser latch, authoritative session, and `meta.networking.inputTemplate` / `meta.networking.numericInputs` so advertised capabilities agree with command validation.

```js
const inputTemplate = { moveX: 0, moveZ: 0, yaw: 0, tool: 1, fire: false, jump: false };
const numericInputs = {
  moveX: { min: -1, max: 1 },
  moveZ: { min: -1, max: 1 },
  yaw: { min: -Math.PI, max: Math.PI },
  tool: { min: 0, max: 4, integer: true },
};
const inputLatch = createInputLatch(inputTemplate, { numericInputs, edgeKeys: ["jump"] });
const platformControls = getGameControls();
const unsubscribeMovement = platformControls.sticks.left.onChange(({ x, y }) => {
  inputLatch.set("moveX", x);
  inputLatch.set("moveZ", -y);
});
const authoritativeInput = createAuthoritativeInputSession({
  inputTemplate, numericInputs, edgeKeys: ["jump"], fixedDtSec: 1 / 60,
});

// On runtime disposal, alongside the game's other input/network cleanup:
unsubscribeMovement();
inputLatch.reset();
```

Import `createInputLatch` from `/platform/frontend-engine/inputTimeline.js` and `getGameControls` from `/platform/frontend-engine/gameDom.js`; the server session is exported by the backend SDK. Each `sticks.left` / `sticks.right` control provides `getState()` and `onChange(handler)`, which returns an unsubscribe function. Reads and notifications are owned `{x,y}` copies. X is positive right; Y is positive down. Axes use a rescaled circular deadzone of 0.14 and unit maximum magnitude, including diagonals. A game maps these axes to its own movement/camera units and combines them with keyboard or pointer input.

Sticks capture one pointer each, allowing simultaneous movement and looking. Focus a labeled stick button and hold arrow keys for keyboard interaction. Release, cancellation, lost pointer capture, focus loss, hidden pages, resize, platform disabling, and unmount return that stick to neutral. The shell updates stick visuals directly without high-frequency React state changes. Games must unsubscribe on disposal and reset their own combined input when opening game-owned dialogs.

Numeric fields require finite numbers inside their configured bounds; integer fields reject fractional values. Unknown/missing queued-state keys and invalid booleans are rejected. Numeric-enabled legacy frames use the same complete-state validation. Invalid local numeric latch updates are ignored, never clamped or converted to booleans. Only boolean fields may be `edgeKeys`; constructor validation rejects numeric action edges. Existing boolean-only legacy adapters keep their coercion/acknowledgement behavior.

Keep the `rejoinToken` returned by `gameJoined`, scoped to the room and namespace, and include it when joining after a reconnect or reload:

```js
socket.send("joinGame", {
  gameId: roomId,
  rejoinToken: savedRejoinToken ?? undefined,
});
```

The server may still be waiting for the previous transport's disconnect. When the token identifies that occupied slot, it returns `roomFull` with `{gameId,rejoinPending:true}`. The facade retries the same room and token every 500 ms for at most 20 seconds, without allocating another slot or displacing the live owner. It delivers one final `roomFull` to game UI if recovery expires. Newcomers and invalid tokens receive ordinary full-room failures immediately. Success, disconnect, socket disposal or a new join request cancels pending retries. Game adapters should not add a second retry loop.

Repeated `gameJoined` acknowledgements for the current room, player, token and
input epoch on one connection are idempotent: the facade publishes ownership once,
without resetting prediction, input or room presentation. A genuine reconnect
still publishes fresh ownership. A different confirmed ownership discards the
previous snapshot sequence and delta baseline so a new room's lower sequence
cannot leave it stuck joining. Requesting another room invalidates the prior
confirmation even if the target room is full, so returning can reacquire that
seat. Adapters keep using the normal `gameJoined` and
`state` subscriptions; no game-specific recovery code is needed.

Prefer `createNetworkedGameRuntime()` for networked presentation. It captures/predicts input at the shared simulation cadence and samples remote interpolation/local presentation at the actual render cadence. It never interpolates discrete IDs through a second numeric pose buffer:

```js
import { createNetworkedGameRuntime } from "/platform/frontend-engine/networkedGameRuntime.js";

const movementRuntime = createNetworkedGameRuntime({
  session: networkSession,
  fixedDtSec: gameConfig.fixedDtSec,
  targetRenderFps: 60, // null renders on every animation frame
  maxFrameSec: 0.08,
  maxFixedSteps: 5,
  applyPose(pose) {
    renderer.applyPose(pose);
  },
});
// Inside the game's existing requestAnimationFrame callback:
movementRuntime.step({ nowMs: performance.now() });
// Dispose both; the scheduler does not own the supplied network session.
movementRuntime.destroy();
networkSession.destroy();
```

The low-level equivalent calls `networkSession.captureAndPredict()` once per fixed update and `networkSession.samplePose({captureInput:false,nowMs,deltaSec,interpolationAlpha:alpha})` on render. `interpolationAlpha` defaults to 1 and blends only the local predictor's continuous fixed-step endpoints; remote playback already samples render time. `deltaSec` is elapsed presentation time, including skipped frames under a rendering cap. The established `samplePose({nowMs,deltaSec})` still captures one command by default for older integrations. Do not invoke both capture paths for the same simulation step. Browser and server must use the same fixed duration.

Server registration uses `meta.networking.tickRateHz` as its default cadence. An explicit `tickMs` overrides it; games without declared timing keep the platform's 60 Hz default. Reuse the same game configuration for the prediction/controller step duration.

The session accepts `getStats()`, `getLatestSnapshot()`, `reset({preserveSequence?})` and `destroy()`. Reset happens automatically on join, disconnect, player departure and rematch. Destroy removes only the session's subscriptions and stops its prediction; the caller still owns and disposes the socket/interpolator. Keep retained snapshots read-only.

Return null from `readAuthority` while the local player has no authoritative state. The session then renders interpolation without a stale predicted override, retains unacknowledged commands and rebases prediction when authority returns. After a capture pause, new command sequences advance past elapsed authoritative simulation time; only actual acknowledgements remove retained commands, so late action inputs are preserved.

Omit `prediction` and `readAuthority` for interpolation-only games. Games with event-driven drawing or other custom state delivery can use the lower-level transport APIs directly. A prediction pipeline is not mandatory for every genre or renderer.

### Discrete resets and independent correction units

`readAuthority(snapshot).context.continuityKey` accepts a string or number identifying a continuous local movement segment. Change it on a respawn, serve or new round. The SDK snaps render offsets/fixed endpoints for that change while retaining correctly owned, unacknowledged commands. Epochs still own input reset/recovery. Use `onInputOwnershipReset({previousEpoch,inputEpoch})` to clear game input latches on an accepted known epoch change; it does not reset the interpolation buffer or runtime.

Pass `extractContinuityKeys(snapshot)` to `createWorkerInterpolator()` when remote numeric paths can teleport or refer to recycled actor slots:

```js
const interpolator = createWorkerInterpolator({
  extractPositions: (snapshot) => ({ rivalX: snapshot.rival.x, rivalZ: snapshot.rival.z }),
  extractContinuityKeys: (snapshot) => ({
    rivalX: `${snapshot.roundId}:${snapshot.rival.respawnId}`,
    rivalZ: `${snapshot.roundId}:${snapshot.rival.respawnId}`,
  }),
});
```

Changed endpoint identities choose the newer endpoint and suppress extrapolation across the reset. They do not move the whole playback clock forward to the latest snapshot. Keep action IDs, respawn/serve IDs and other discrete presentation outside `prediction.extractPose`; obtain them from the borrowed fourth `composeRenderPose` argument instead. Renderers that choose latest-authority identity guards must apply them coherently with the corresponding positions.

When a prediction pose contains independent actors or units, declare `prediction.correctionGroups`:

```js
correctionGroups: [
  { name: "player", fields: ["x", "y", "z"], maxSmoothingDistance: 1.2 },
  { name: "ball", fields: ["ballX", "ballY", "ballZ"], maxSmoothingDistance: 1.2 },
  { name: "facing", fields: ["facingSin", "facingCos"], maxSmoothingDistance: 3 },
],
```

Fields must be unique across nonempty groups; thresholds are finite, nonnegative and expressed in that group's units. Unlisted fields share the existing `maxSmoothingDistance` fallback. A large ball correction snaps the ball group without snapping a correctly predicted player. Omit groups for a simple homogeneous position pose. Hermite interpolation limits contradictory tangents so monotonic endpoint motion cannot reverse just because of high reported velocity.

## Connect authoritative simulation

`createAuthoritativeInputSession({inputTemplate,numericInputs?,edgeKeys?,fixedDtSec?,starvationMs?})` provides:

- `receiveInput(player,payload,nowMs?)`: validate and queue input; queued frames acknowledge after simulation.
- `simulateRoom({state,dtSec,simulate})`: step all game-defined players while the SDK manages room timing, command budgets and recovery. The callback receives `(player,inputState,fixedDtSec,playerId,inputFrame)`.
- `resetPlayer(player)`: clear queued/held input and advance ownership on connection changes.
- `getPlayerSnapshotMetadata(player)`: return `inputEpoch`, `inputSeqAck` and `inputSimulationTick` for the game's serializer.

Call these from the standard `registerGame()` or `registerPluggableGame()` callbacks. When a room pauses because a participant leaves, reset every affected player's input ownership and game-owned held/action state while retaining match progress. New shared authority must reject frames from both old owners. Game rules use the supplied step duration; the SDK owns room-clock fields and recovery. Include `inputProtocol` in snapshots and spread `getPlayerSnapshotMetadata(player)` alongside each player's prediction state. The existing Fight and Pong adapters provide complete examples. `simulatePlayer()` remains available as a lower-level hook for custom schedulers.

The queued input validator accepts game-defined booleans and explicitly bounded numeric controls. The SDK owns its template/range copies, queued-state copies, resets, acknowledgements, and ownership recovery. Custom message/input schemes can use registration's `handleInput` callback; they must define and validate their own contract. Game-specific combat, ball outcomes, scoring and wins remain authoritative.

## Current coverage and verification

Fight and Pong use the high-level client session, the shared authoritative input session and configurable platform mechanics. Dead Shift uses those same sessions with bounded numeric movement/aim/weapon inputs, game-owned 3D movement prediction, server-owned combat, and a Three.js renderer. Its shared `roundId` distinguishes rematches from snapshot recovery so reconnects do not replay old visual effects. See [its controls and integration](../public/games/dead-shift/README.md).

Sky Dash combines the same sessions with configurable 3D kinematic movement and game-owned obstacle rules. [Riftball Duel](../public/games/riftball/README.md) reuses that character controller, adds a configurable sphere body, and predicts a bounded ball/contact preview while authoritative rules own goals, overtime and series wins. Both use the generic touch editor and synchronized room countdown.

[Edgeout](../public/games/edgeout/README.md) drives its fighters with the same character controller against one shrinking platform, and keeps hits, ring-outs and rounds authoritative. It registers twice from one adapter: a two-seat duel and a one-seat practice mode whose server-owned bot stays outside seat ownership, so readiness counts only the human.

[Driftline](../public/games/driftline/README.md) predicts a game-owned vehicle model on a shared spline track. It records countdown throttle through the same queued input session for launch timing, and registers a two-seat race and a one-seat practice mode with server-owned bots filling the grid.

Mario and Mario Touch now use the same sessions and shared acceleration, gravity and tile collision rules. Road Rash uses shared acceleration/steering and unwrapped progress; kicks, traffic, damage and race results remain server-owned. All eight continuous multiplayer entries advertise queued protocol 2 and their actual shared input schemas/cadence. Every adapter resets both command owners when a player leaves, so old held/queued controls cannot cross a reconnect.

Draw stays event-driven: local strokes appear immediately, ordered revisioned events update both clients, and `syncBoard` requests bounded `drawBoard` history on join/recovery. Periodic state packets contain lifecycle and board revision instead of repeating the full canvas. Local echoes cannot rewind points, clear acknowledgements are owner-specific, and drawing waits for authoritative start plus history hydration. The WebGL Drift sample is single-player.

[Ludo Table](../public/games/ludo/README.md) uses another event-driven contract: revision/round-bound roll and move commands, complete fixed-shape board snapshots at 10 Hz, and server-only cryptographic dice. Its entry profile gives six a 1-in-3 chance when every unfinished piece is in the yard, equally for all seats; active-piece turns use ordinary 1-in-6 odds. Each draw is independent, with no forced roll number or miss counter. Shared pure rules determine eligibility and legal-piece highlights from authoritative board state, while visual hops and dice rolls run at render cadence. Reconnect resets the command baseline and preserves board progress; rematches reset the board and retain room voice. The registered mode has two human seats.

Deterministic tests cover all continuous multiplayer games at **150, 300 and 500 ms RTT**, using half that delay in each direction, jitter and ordered delivery stalls. Coverage includes short actions, bounded queues, stopping/convergence, ownership recovery, respawns and new serves. Shared SDK tests also exercise alternate input schemas/rates, rendering at 120/144 Hz and a 1.3 second starvation/recovery. These are correctness scenarios, not global capacity or latency guarantees.

```sh
npm test
npm run build
npm run net:probe -- --url http://localhost:3100 --game pong --seconds 30
npm run test:multiplayer:browser
```

The probe reads the selected game's public capabilities. It alternates the first two boolean controls and preserves every numeric template value; use a game-owned diagnostic for a specific analog movement pattern. Set `inputProtocol` and `inputTemplate` to null and omit `numericInputs` for snapshot/RTT-only diagnostics; continuous input is not forced on other game types. Probe limits bound a single diagnostic match. Tests also verify arbitrary player slots, configurable cadence, SDK lifecycle/ownership, alternate controller bindings and that platform runtime bundles have no concrete game-package dependencies.

The multiplayer browser suite runs two clients for continuous games and Draw through a loopback WebSocket proxy with 500 ms RTT, deterministic jitter and periodic 200 ms stalls. HTTP assets and protocol handshakes remain unthrottled. Set `PLATFORM_TEST_RTT_MS=300` or `PLATFORM_TEST_GAMES=fight,pong` to select a scenario; set `CHROME_PATH` if Chrome is not installed at the existing macOS default. It checks actual browser inputs, queued acknowledgements, opponent updates, a seat-preserving reload and Draw history recovery. Ludo's separate `npm run test:ludo:browser` exercises its discrete authoritative contract; `LUDO_TEST_RTT_MS=500` selects impaired delivery. RTT uses acknowledged application probes; Engine.IO heartbeat receipt/response events are not round-trip measurements.

High RTT still delays opponent information and server-confirmed damage, scoring and contacts. Prediction cannot make an unknown opponent action immediate. Socket.IO delivers ordered messages over a reliable transport; a stalled connection can hold newer updates behind older messages, and reconnect history needs explicit application recovery. See [delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/) and the [snapshot interpolation reference](https://gafferongames.com/post/snapshot_interpolation/). Test real devices and the deployed host separately; these local correctness checks are not a server capacity benchmark.

## Upright 3D character movement

`/platform/shared/kinematicCharacter.js` exports `createKinematicCharacterController(settings)` for pure browser/server movement against translating platforms with axis-aligned X/Z bounds and optional sloped tops. Coordinates use world units, positive Y up, X/Z at the character's horizontal center, and Y at the bottom of its cylinder. Games own obstacles, damage, abilities, checkpoints and results; the controller owns acceleration, gravity, jump edges, support, platform carry and solid contact.

```js
import {
  createKinematicCharacterController,
  getKinematicPlatformTopY,
  resolveKinematicCharacterSeparation,
} from "/platform/shared/kinematicCharacter.js";

const characterController = createKinematicCharacterController({
  radius: 0.4,
  height: 1.4,
  moveSpeed: 8,
  jumpSpeed: 9,
  gravity: 24,
});
const body = {
  x: 0, y: 0, z: 0,
  vx: 0, vy: 0, vz: 0,
  grounded: true, supportId: 1,
  coyoteSec: 0, jumpBufferSec: 0, jumpHeld: false,
};
const platforms = [{
  id: 1, x: 0, z: 0,
  width: 8, depth: 12, topY: 0, thickness: 1,
  vx: 0, vy: 0, vz: 0,
}];

characterController.step(body, { x: 0, z: -0.5, jump: false }, 1 / 60, {
  platforms,
  controlScale: 1,
  speedScale: 1,
});

// Pass only active actors; revalidate world contacts after positional push-outs.
const activeCharacters = [body];
resolveKinematicCharacterSeparation(activeCharacters, { radius: 0.4, height: 1.4, iterations: 12 });
characterController.step(body, { x: 0, z: 0, jump: false }, 0, { platforms });
```

Settings are copied and validated at construction. Dimensions, `moveSpeed`, `jumpSpeed` and `maxDtSec` must be finite and positive; acceleration, braking, gravity and grace durations may be zero. The optional settings are:

| Setting | Default | Meaning |
| --- | --- | --- |
| `radius`, `height` | `0.42`, `1.5` | Upright cylinder dimensions. |
| `moveSpeed` | `8` | Full-intent horizontal units per second. |
| `acceleration`, `airAcceleration` | `48`, `18` | Grounded and airborne input acceleration in units per second squared. |
| `braking` | `40` | Deceleration when movement intent is zero. |
| `gravity`, `jumpSpeed` | `24`, `9` | Downward acceleration and upward jump speed. |
| `coyoteSec`, `jumpBufferSec` | `0.1`, `0.12` | Support grace and early jump-press retention, in seconds. |
| `maxDtSec` | `0.1` | Maximum simulated duration per call; excess time is discarded. |
| `maxSubsteps` | `12` | Integer work limit from 1 through 128. Continuous sweeps also protect thin walls/ceilings when the limit is reached. |

`step(body,input,dtSec,{platforms,controlScale?,speedScale?})` returns `undefined` and mutates only the body's documented movement fields. Inputs are world-space `{x,z,jump}`: use finite axes, preserve analog magnitudes below one, and normalize longer diagonals. A held jump never retriggers after landing. Keep every body field in snapshots and prediction state so buffered jumps, support and edge ownership reconcile together. Invalid or negative durations and nonfinite/negative scale values throw `TypeError`.

Every platform supplies a unique positive numeric `id`, center `x/z`, positive `width/depth`, center-top height `topY`, positive vertical `thickness`, and `vx/vy/vz`. Supply its pose at the **start** of the step. The controller projects geometry linearly using that step's velocity and leaves the platform unchanged. Games advance or analytically resample platform poses for the next step. Character `vx/vz` describe motion relative to support; grounded `vy` is zero. Carry adds platform velocity once during movement, so do not also add it to the body. Stepping beyond an edge or removing the supporting ID releases grounding.

Optional `slopeX` and `slopeZ` default to zero and define `localTopY = topY + slopeX * (x - platform.x) + slopeZ * (z - platform.z)` at the sampled platform pose. Each gradient must be finite and within `[-1,1]`; invalid sampled gradients throw before the controller mutates the body. Width/depth stay projected horizontal extents, and the underside is the same local plane minus vertical thickness. The upright cylinder uses its center foot for plane contact, keeping horizontal speed while walking up or down. Top/underside sweeps and side contacts use the local plane rather than a taller enclosing box. This is arcade surface following; it does not implement rigid-body rotation or passive gravity sliding down ramps.

Use the shared `getKinematicPlatformTopY(platform,x,z,elapsedSec=0)` export for rendering, foot markers, spawn placement and game-owned carry. It returns the local top height from the same plane definition, projecting `vx/vy/vz` from the supplied start pose when `elapsedSec` is nonzero. The sampler extrapolates the plane outside its footprint; callers still check bounds when selecting support. For example:

```js
const ramp = {
  id: 2, x: 0, z: -12, topY: 1,
  width: 6, depth: 8, thickness: 0.4,
  vx: 0, vy: 0, vz: 0,
  slopeX: Math.tan(0.2), slopeZ: 0,
};
const footY = getKinematicPlatformTopY(ramp, 2, -12);
```

Slopes are constant during each controller call; games own angle, angular velocity, weight and spring/damping rules. Sample their tilt before each step. A body already grounded on the same support can follow up to `0.08` units of sampled height change when its foot still overlaps the footprint and its own `vy` is nonpositive. This reattachment requires explicit slope fields, including explicit zero at neutral tilt, and also works during a zero-duration contact pass. Airborne/jumping bodies, different support IDs and larger gaps do not snap down to a surface. Game-owned tilt carry should move only prior supported actors and avoid adding the same height change twice.

`controlScale` and `speedScale` default to one. Use `controlScale:0` during game-owned knockback or dive recovery to disable both input acceleration and braking while retaining external velocity. Use `speedScale` for temporary target-speed changes. Both values are finite and nonnegative. A zero-duration call resolves penetration and support only; it preserves jump edges and all timers. For a post-step contact pass, supply platform geometry at that post-step instant.

`resolveKinematicCharacterSeparation(bodies,{radius,height,iterations?})` separates vertically overlapping cylinders in deterministic array order and mutates only X/Z positions, preserving velocities. Callers filter finished/respawning actors. `iterations` defaults to six and must be an integer from one through 32. Coincident centers separate deterministically; crowded arrangements may retain a small overlap at the iteration limit. Revalidate world contacts afterwards, including when crowd separation pushes an actor past a platform edge. Contact iterations and penetration passes are bounded; contradictory solids or crushing geometry require a game-owned recovery rule.

## Configurable 3D sphere bodies

`/platform/shared/sphereBody.js` exports `createSphereBodyController(settings)`. It owns bounded swept sphere/AABB collision, gravity, drag, floor settling and restitution. Games supply static box solids and own moving-body interactions, scoring, contact effects and reset rules. It imports no game code and can simulate balls or projectiles in pure browser/server code.

```js
import { createSphereBodyController } from "/platform/shared/sphereBody.js";

const sphereController = createSphereBodyController({
  radius: 0.4,
  gravity: 18,
  restitution: 0.78,
  floorRestitution: 0.62,
  linearDamping: 0.12,
  groundFriction: 1.6,
  maxSpeed: 28,
});
const ballBody = { x: 0, y: 1, z: 0, vx: 8, vy: 0, vz: -12 };
const walls = [{ minX: 10, maxX: 11, minY: 0, maxY: 5, minZ: -20, maxZ: 20 }];
const { bounceCount } = sphereController.step(ballBody, 1 / 60, {
  solids: walls,
  floorY: 0,
  onTravel(segment) {
    // Observe actual swept travel, before a later rebound. Do not mutate it.
    inspectGameOwnedTrigger(segment);
  },
});
```

`step` mutates the supplied six-coordinate body and returns its bounce count. Radius is positive, restitution values are in `[0,1]`, and all coordinates/settings must be finite. Solids use ordered finite bounds; at most 256 boxes are accepted. Invalid inputs throw before simulation changes the body. `floorY` is optional. `onTravel` receives `{startX,startY,startZ,endX,endY,endZ}` for actual swept segments; depenetration does not count as travel or trigger a crossing.

Defaults are gravity `18`, restitution `0.72`, floor restitution equal to restitution, linear damping `0.12/sec`, ground friction `1.6 units/sec²`, rest speed `0.55`, maximum speed `64`, maximum step `0.05s`, eight substeps and eight contacts per substep. Radius defaults to `0.4`. Substeps are bounded to `[1,64]` and contacts to `[1,32]`; long positive durations clamp rather than running unlimited catch-up. `dtSec:0` performs contact recovery without advancing time. This controller covers static geometry; game-defined dynamic interactions still need their own bounded rules.
