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

## Browse large catalogs

The browser library requests bounded pages with `GET /api/games?page=1&pageSize=24&q=&genre=all&sort=name-asc`. The default page size is 24 and the maximum is 60. Supported sort values are `name-asc` and `name-desc`. Search matches titles, descriptions, and tags across the entire registered catalog. Genre options are global facets, not just tags from the visible page.

Paged responses contain `{ games, total, page, pageSize, totalPages, genres }`. Pages beyond the current result set clamp to its last page. Invalid query parameters return HTTP 400. The browser debounces search and aborts obsolete requests; it mounts only the current page's cards. Desktop browsing uses a grid on the left and a full-height artwork panel on the right. Portrait browsing uses a full-width grid; selecting a game opens its details and Play action in a native dialog. Page jumps and previous/next controls keep the catalog navigable without an endless horizontal list.

Foreground artwork is contained within its frame so the entire image remains visible. Selected-game panels add a blurred decorative copy behind the complete image to fill different aspect ratios; titles and actions use their own layout space instead of covering the artwork.

`GET /api/games/:gameId` returns `{ game }` or HTTP 404, independently of pagination. Use this endpoint for direct/shared links instead of fetching every game to resolve one runtime. Runtime metadata stays stable while a game is active. The unparameterized `GET /api/games` remains available for legacy diagnostic clients; it returns the full catalog and should not be used by a large browser library.

The current catalog index is built from trusted registered game metadata at server startup. It supports catalog browsing; it does not add dynamic uploads, a tenant database, or game-hosting capacity. A persistent catalog can later implement the same page/detail contract.

## Preserve the console shell

Library and game views share the same outer console dimensions, bezel, and controller positions. Game launch and shared links keep the user's current fullscreen/orientation state; the platform's Full Screen button is the explicit presentation control. `startInLandscape` is a game preference, not permission to resize the shell or automatically enter fullscreen.

Render within the supplied game host. Size or rotate a game's own drawing surface using its host's measured bounds and observe host resizes when needed. Do not use browser viewport dimensions to expand a renderer beyond the screen, mutate the outer shell, or request fullscreen/orientation from game initialization and input handlers. Route transitions may fade screen content without translating or scaling the console.

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

`socket` is the `getGameSocket(namespace)` facade. `localPlayerId` comes from its `gameJoined` event; game UI may also need that ID for labels and scoring. `interpolator` is created with `createWorkerInterpolator({extractPositions,extractVelocities?,interpDelayMs?,maxBufferSize?})`, using selectors appropriate to the game's snapshot shape. `controls` can use `createInputLatch(template,{edgeKeys})` so short action presses survive between captures.

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

`createAuthoritativeInputSession({inputTemplate,edgeKeys?,fixedDtSec?,starvationMs?})` provides:

- `receiveInput(player,payload,nowMs?)`: validate and queue input; queued frames acknowledge after simulation.
- `simulateRoom({state,dtSec,simulate})`: step all game-defined players while the SDK manages room timing, command budgets and recovery. The callback receives `(player,inputState,fixedDtSec,playerId,inputFrame)`.
- `resetPlayer(player)`: clear queued/held input and advance ownership on connection changes.
- `getPlayerSnapshotMetadata(player)`: return `inputEpoch`, `inputSeqAck` and `inputSimulationTick` for the game's serializer.

Call these from the standard `registerGame()` or `registerPluggableGame()` callbacks. Game rules use the supplied step duration; the SDK owns room-clock fields and recovery. Include `inputProtocol` in snapshots and spread `getPlayerSnapshotMetadata(player)` alongside each player's prediction state. The existing Fight and Pong adapters provide complete examples. `simulatePlayer()` remains available as a lower-level hook for custom schedulers.

The current queued input validator accepts game-defined boolean control keys. Custom message/input schemes can use registration's `handleInput` callback; they must define and validate their own contract. Game-specific combat, ball outcomes, scoring and wins remain authoritative.

## Current coverage and verification

Fight and Pong use the high-level client session, the shared authoritative input session and configurable platform mechanics. Mario, Mario Touch and Road Rash retain their existing input adapters and inherit shared transport/interpolation/scheduler fixes; their full prediction migrations remain separate work. Draw uses its event-driven state path. The WebGL sample is single-player.

```sh
npm test
npm run build
npm run net:probe -- --url http://localhost:3000 --game pong --seconds 30
```

The probe reads the selected game's public capabilities. Set `inputProtocol` and `inputTemplate` to null for snapshot/RTT-only diagnostics; continuous input is not forced on other game types. Probe limits bound a single diagnostic match. Tests also verify arbitrary player slots, configurable cadence, SDK lifecycle/ownership, alternate controller bindings and that platform runtime bundles have no concrete game-package dependencies.
