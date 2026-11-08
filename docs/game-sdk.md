# Game developer SDK

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

`public/platform/shared/touchControls.js` exports the descriptor/profile JSDoc types, `TOUCH_PRESET_IDS`, `TOUCH_CONTROL_LIMITS`, `createDefaultTouchProfile(descriptor)`, `sanitizeTouchProfile(descriptor, candidate)`, `resolveTouchLayout(descriptor, profile, orientation)`, and `updateTouchControl(profile, controlId, patch)`. Profiles are owned values with `{ version: 1, presetId, mode, hideShell, layouts }`. `mode` is `auto` by default and also accepts `on`/`off`; `hideShell` defaults to false. Layout maps hold partial overrides per preset. Sanitization discards removed/unknown/locked controls, ignores nonfinite or nonnumeric values, clamps finite values and preserves developer defaults for new controls. Editing an owned draft changes no saved data until Save.

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

The shell's `TouchControlSurface` owns the DOM binding. Custom platform surfaces can call `bindTouchControlSurface({ element, gameId, descriptor, layout, disabled })` and must dispose the returned binding. Place the surface in the game frame with `[data-touch-control-id]` children. Empty surface/look space uses `pointer-events: none`; the binding captures look on its parent host and ignores interactive HUD targets and platform chrome. It updates pressed/knob feedback directly in the DOM. Independent pointer IDs support movement, look and actions together; a finger's release cannot clear another finger's action. Cancel/capture loss releases that owner, and blur, hidden pages, host resize, disabling or disposal clear all input. Set `disabled` while platform dialogs/editors own focus. Layout editing never remounts the game renderer, and the match continues during editing.

Players can explicitly choose to expand the play area by hiding decorative console controls during touch play. Selecting a preset or editing controls does not itself resize the shell, request browser fullscreen or lock orientation. Returning to the library restores the console presentation.

## Browse large catalogs

The browser library requests bounded pages with `GET /api/games?page=1&pageSize=24&q=&genre=all&sort=name-asc`. The default page size is 24 and the maximum is 60. Supported sort values are `name-asc` and `name-desc`. Search matches titles, descriptions, and tags across the entire registered catalog. Genre options are global facets, not just tags from the visible page.

Add `customizable=true` to request only games whose touch descriptor explicitly allows customization. This filter, search and genre selection run across the catalog before pagination, including the bundled browser fallback. Omitted or false `customizable` preserves ordinary catalog behavior. Use bounded filtered pages for a controls picker instead of fetching the entire catalog.

Paged responses contain `{ games, total, page, pageSize, totalPages, genres }`. Pages beyond the current result set clamp to its last page. Invalid query parameters return HTTP 400. The browser debounces search and aborts obsolete requests; it mounts only the current page's cards. Desktop browsing uses a grid on the left and a full-height artwork panel on the right. Portrait browsing uses a full-width grid; selecting a game opens its details and Play action in a native dialog. Page jumps and previous/next controls keep the catalog navigable without an endless horizontal list.

Foreground artwork is contained within its frame so the entire image remains visible. Selected-game panels add a blurred decorative copy behind the complete image to fill different aspect ratios; titles and actions use their own layout space instead of covering the artwork.

`GET /api/games/:gameId` returns `{ game }` or HTTP 404, independently of pagination. Use this endpoint for direct/shared links instead of fetching every game to resolve one runtime. Runtime metadata stays stable while a game is active. The unparameterized `GET /api/games` remains available for legacy diagnostic clients; it returns the full catalog and should not be used by a large browser library.

The current catalog index is built from trusted registered game metadata at server startup. It supports catalog browsing; it does not add dynamic uploads, a tenant database, or game-hosting capacity. A persistent catalog can later implement the same page/detail contract.

## Preserve the console shell

Library and game views share the same outer console dimensions, bezel, and controller positions. Game launch and shared links keep the user's current fullscreen/orientation state; the platform's Full Screen button is the explicit presentation control. `startInLandscape` is a game preference, not permission to resize the shell or automatically enter fullscreen.

Render within the supplied game host. Size or rotate a game's own drawing surface using its host's measured bounds and observe host resizes when needed. Do not use browser viewport dimensions to expand a renderer beyond the screen, mutate the outer shell, or request fullscreen/orientation from game initialization and input handlers. Route transitions may fade screen content without translating or scaling the console.

The platform's touch settings add an explicit **Expanded play area** preference. Players can select it in Config or the in-game Controls editor. The shell applies it without replacing the game canvas; game packages continue to fit the supplied host and do not toggle outer geometry themselves.

### Player control editor

Config → Game controls offers a bounded searchable picker containing only developer-enabled games. Players choose an allowed finger preset and edit button position, size, and opacity in a draft. Reset selected/Reset layout also remain drafts; Save applies them and Cancel discards them. Portrait and landscape profiles are labeled and saved separately for each game in the current device's browser. An open editor keeps its original target through device rotation.

Games with customization enabled also get a platform Controls button during play. The same editor sits over the existing renderer and explains that the session continues while editing; gameplay input is neutralized and higher-priority invitation/results/exit dialogs retain focus. The Options menu controls automatic/always/off display and Expanded play area. Layout changes do not request browser fullscreen, change device orientation or restart a room.

Run `npm run test:touch-controls:browser` against the local server for the complete two-client UI/touch regression. It uses an isolated Chrome profile, saves `touch-layout-*.png` screenshots in the OS temporary directory, and removes its profile on exit. `CHROME_PATH` overrides the default macOS Chrome executable; `PLATFORM_BASE_URL` overrides `http://localhost:3000`.

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

Call `networkSession.samplePose({nowMs,deltaSec})` once per fixed simulation step and render its returned pose. `createPluggablePoseRuntime()` provides fixed sampling with independent rendering. Use the same fixed duration on browser and server; the SDK cannot infer a game's simulation cadence from rendering FPS.

Server registration uses `meta.networking.tickRateHz` as its default cadence. An explicit `tickMs` overrides it; games without declared timing keep the platform's 60 Hz default. Reuse the same game configuration for the prediction/controller step duration.

The session accepts `getStats()`, `getLatestSnapshot()`, `reset({preserveSequence?})` and `destroy()`. Reset happens automatically on join, disconnect, player departure and rematch. Destroy removes only the session's subscriptions and stops its prediction; the caller still owns and disposes the socket/interpolator. Keep retained snapshots read-only.

Return null from `readAuthority` while the local player has no authoritative state. The session then renders interpolation without a stale predicted override, retains unacknowledged commands and rebases prediction when authority returns. After a capture pause, new command sequences advance past elapsed authoritative simulation time; only actual acknowledgements remove retained commands, so late action inputs are preserved.

Omit `prediction` and `readAuthority` for interpolation-only games. Games with event-driven drawing or other custom state delivery can use the lower-level transport APIs directly. A prediction pipeline is not mandatory for every genre or renderer.

## Connect authoritative simulation

`createAuthoritativeInputSession({inputTemplate,numericInputs?,edgeKeys?,fixedDtSec?,starvationMs?})` provides:

- `receiveInput(player,payload,nowMs?)`: validate and queue input; queued frames acknowledge after simulation.
- `simulateRoom({state,dtSec,simulate})`: step all game-defined players while the SDK manages room timing, command budgets and recovery. The callback receives `(player,inputState,fixedDtSec,playerId,inputFrame)`.
- `resetPlayer(player)`: clear queued/held input and advance ownership on connection changes.
- `getPlayerSnapshotMetadata(player)`: return `inputEpoch`, `inputSeqAck` and `inputSimulationTick` for the game's serializer.

Call these from the standard `registerGame()` or `registerPluggableGame()` callbacks. Game rules use the supplied step duration; the SDK owns room-clock fields and recovery. Include `inputProtocol` in snapshots and spread `getPlayerSnapshotMetadata(player)` alongside each player's prediction state. The existing Fight and Pong adapters provide complete examples. `simulatePlayer()` remains available as a lower-level hook for custom schedulers.

The queued input validator accepts game-defined booleans and explicitly bounded numeric controls. The SDK owns its template/range copies, queued-state copies, resets, acknowledgements, and ownership recovery. Custom message/input schemes can use registration's `handleInput` callback; they must define and validate their own contract. Game-specific combat, ball outcomes, scoring and wins remain authoritative.

## Current coverage and verification

Fight and Pong use the high-level client session, the shared authoritative input session and configurable platform mechanics. Dead Shift uses those same sessions with bounded numeric movement/aim/weapon inputs, game-owned 3D movement prediction, server-owned combat, and a Three.js renderer. Its shared `roundId` distinguishes rematches from snapshot recovery so reconnects do not replay old visual effects. See [its controls and integration](../public/games/dead-shift/README.md).

Mario, Mario Touch and Road Rash retain their existing input adapters and inherit shared transport/interpolation/scheduler fixes; their full prediction migrations remain separate work. Draw uses its event-driven state path. The WebGL sample is single-player.

```sh
npm test
npm run build
npm run net:probe -- --url http://localhost:3000 --game pong --seconds 30
```

The probe reads the selected game's public capabilities. It alternates the first two boolean controls and preserves every numeric template value; use a game-owned diagnostic for a specific analog movement pattern. Set `inputProtocol` and `inputTemplate` to null and omit `numericInputs` for snapshot/RTT-only diagnostics; continuous input is not forced on other game types. Probe limits bound a single diagnostic match. Tests also verify arbitrary player slots, configurable cadence, SDK lifecycle/ownership, alternate controller bindings and that platform runtime bundles have no concrete game-package dependencies.
