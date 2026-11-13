# Repository coding conventions

## Base and precedence

This file wins wherever it differs from generic guidance. Its base is Robert C. Martin's (Uncle Bob's) **Clean Code** and **Clean Architecture**: SOLID, the Dependency Rule, component principles, Humble Object, small focused functions, intention-revealing names, and comments that explain why rather than what. This file records how they apply here, the project's own naming and layout choices, and the project rules they do not cover.

Apply these rules to new and changed code, keep work within the requested scope, and preserve existing behavior during refactoring unless a behavior change is explicitly requested.

### Intentional overrides of the base

- **No unrequested cleanup.** Change scope (convention 8) wins over the "leave it cleaner" habit: do not rename, extract, or reformat code you were not asked to touch.
- **Hot paths.** In simulation and rendering paths, in-place mutation, reused objects, and fewer calls beat small-function and immutability preferences when measurements support it.
- **JSDoc is required** on public functions and non-obvious helpers (convention 2), even though the base distrusts comments.
- **Framework coupling in `core/` is deliberate.** The engine core depends on Socket.IO (see the Dependency Rule section). Do not refactor Socket.IO out of it or add ports for it unless asked.
- **Tests are required for changed behavior; test-first is not.**

## Which sections apply

- Server engine, SDK, networking, or a game's sync adapter: Dependency Rule, Game and networking rules, Platform SDK architecture.
- Adding a game: Adding a game, Build outputs.
- `public/platform/src/`, overlays, dialogs, touch controls: Platform UX.
- Sprites and animation: Game animation and sprite art.
- Every change: Coding conventions, Build outputs, Verification, Before you finish.

## Project context

JavaScript ES module project with a React platform UI, browser game clients, and an Express/Socket.IO authoritative game server. Keep changes in the existing languages and architecture unless a migration is requested.

| Path | Responsibility | Clean Architecture role |
|------|----------------|-------------------------|
| `public/games/<game>/shared/` | Controller configuration and optional custom pure rules used by that game's browser client and authoritative server | Entities (game rules) |
| `public/platform/shared/` | Game-independent contracts, configurable simulation controllers, and constants used by browser and server | Entities and contracts (platform) |
| `server/platform-backend-engine/core/` | Authoritative room lifecycle, command processing, simulation, and snapshot handling | Use cases and Socket.IO adapters (framework-coupled by design) |
| `public/platform/frontend-engine/` | Reusable client timing, input, prediction, interpolation, and transport | Use cases and interface adapters (client) |
| `server/platform-backend-engine/games/` | Server-side adapters for bundled games (`fight.js`, `pong.js`, …) | Interface adapters (server) |
| `public/games/<game>/` (`main.js`, `client/`, `rendering/`) | Game-specific controls, rendering, assets, and synchronization adapters | Interface adapters and Humble Objects |
| `public/games/<game>/catalog.js` | Presentation metadata and touch descriptors read by the browser catalog | Game metadata |
| `server/platform-backend-server/` | HTTP/server entry points and operational endpoints | Frameworks and drivers |
| `server/platform-backend-engine/games/builtInGames.js` | Trusted built-in game package list | Main (server composition root) |
| `public/platform/src/data/games.js` | Browser catalog fallback built from each game's `catalog.js` | Main (browser composition root) |
| `scripts/` | Development and diagnostic tools | Tooling |
| `tests/` | Node test runner regression and integration tests | Tooling |

Newer games (Sky Dash, Riftball, Dead Shift) split into `shared/`, `client/`, and `rendering/`; older games keep most code in `main.js`.

### Dependency Rule in this repository

- Build a reusable platform with loose coupling to games and clear extension points for game developers. Dependencies point from game packages into the platform SDK; the platform must remain usable when any bundled game is removed.
- The engine core, `frontend-engine/`, and shared protocol modules must not import concrete games, contain game namespaces, or branch on game identities. Only the composition roots import concrete games: `builtInGames.js` (server packages) and `public/platform/src/data/games.js` (browser catalog). `tests/platform-boundaries.test.js` enforces this.
- Shared simulation rules (entities) must run without browser or server globals.
- Renderers, React components, and Express route handlers are Humble Objects: keep decisions in testable modules and keep these layers thin. `gameLoop.js` and `authoritativeInputSession.js` are not humble; they own timing and recovery logic and have direct tests.
- `core/` depends on Socket.IO by design (`rooms.js`, `gameLoop.js`, `registerGame.js`, `socketHandlers.js`, and the plugin `register(io)` contract).
- Apply Clean Architecture pragmatically. Prefer small modules with clear boundaries over large entry functions or speculative abstraction layers, and do not add layers, interfaces, or indirection that no second implementation needs.

## Coding conventions

1. **Types without TypeScript.** JSDoc is the type system. Use `@typedef`, `@template`, and typed parameters for input states, player states, command frames, options, and responses. Define closed shapes and literal unions when keys are known, and restrict key arguments with `keyof` where appropriate. Use dictionaries or generic key maps only for genuinely dynamic data, such as plugin-defined poses or snapshot schema paths. Do not introduce a TypeScript migration just to add types.
2. **JSDoc on public functions and non-obvious helpers.** Document purpose, parameter shapes, return values, mutation/ownership rules, and important failure cases, using `@param`, `@returns`, and `@throws` where useful. Keep it aligned with parameter names and behavior; avoid comments that merely repeat the code.
3. **Domain vocabulary.** Name functions for their action and domain, for example `parseAndValidateProbeOptions`, `recordReceivedSnapshot`, or `resetPlayerInputSession`; avoid vague helpers such as `required`, `invalid`, `process`, or `handle` without a domain. Name objects for their role, for example `playerState`, `inputFrame`, `predictionContext`, `probeClient`, `socketPacket`, `healthResponse`, and `networkSummary`. Use plurals for collections, and avoid `data`, `result`, `obj`, and one-letter identifiers when a domain name would clarify the role. Established coordinates and wire identifiers such as `x`, `y`, `p1`, and `p2` are fine. Preserve established public APIs and wire field names when renaming would break callers.
4. **Style and layout.** Follow the surrounding style; default to two-space indentation, double quotes, and semicolons in JavaScript. Keep related declarations together, separate setup, validation, processing, and returns with blank lines, and use ordinary multi-line branches and object declarations rather than dense one-line statements.
5. **Where constants live.** Name protocol versions, event names, packet kinds, HTTP details, error codes, simulation settings, and limits. Keep each constant next to the domain that owns it, and share real client/server contracts from `public/platform/shared/`. Do not create a universal constants file or extract every incidental literal. Keep literal expected values in tests when they independently verify a contract.
6. **Protocol and HTTP behind helpers.** Packet encoding, transport framing, health responses, headers, and response parsing belong in focused helpers. Game and application flows call meaningful operations instead of handling low-level protocol details inline.
7. **Readable entry functions.** Entry functions reveal the operation sequence and delegate validation, connection setup, simulation, metrics collection, and cleanup to focused helpers. Reuse shared networking code and adapt game-specific rules at explicit boundaries.
8. **Respect change scope.** Formatting-only requests change whitespace only. Refactoring must preserve gameplay rules, timing, defaults, wire formats, CLI output, and error behavior unless changes are requested. Do not reformat unrelated legacy code, add dependencies, or change hosting as part of cleanup.

## Game and networking rules

- Keep authoritative game results on the server.
- Keep simulation cadence independent of rendering FPS. Preserve command sequence, simulation tick, input epoch, and snapshot baseline semantics.
- Keep queues, histories, and catch-up work bounded. Prefer explicit units such as `delayMs`, `fixedDtSec`, and `sequenceNumber`.
- Distinguish round-trip latency, snapshot delivery gaps, server scheduling delay, simulation cost, and dropped simulation steps. Snapshot sequence gaps are not measured IP packet loss.
- Avoid unnecessary allocation, blocking work, or high-frequency UI updates in simulation and rendering paths. Optimize using measurements (for example `npm run net:probe` and the timing tests) while keeping the code understandable.

## Platform SDK architecture

### Ownership

- The platform owns transport, rooms, simulation scheduling, bounded input queues, snapshot delivery, optional prediction/reconciliation, client/server command ownership, acknowledgement, recovery and reset, lifecycle, diagnostics, and reusable simulation mechanics.
- Game packages select and configure mechanics and own their custom rules, combat outcomes, scoring, assets, controls, and rendering. Adapters describe rules and mappings; they do not duplicate networking orchestration such as input queues, acknowledgement/replay, interpolation timing, or reconnect/rematch reset.

### Contracts and extension points

- Connect games through documented, versioned registration and adapter contracts. New games supply metadata and callbacks without changing engine internals. Keep the trusted built-in package list at the application composition boundary.
- Keep reusable engine contracts genre-independent. Make player slots, simulation cadence, input shapes, and networking capabilities game-configurable. Do not assume two players, six Fight controls, pixel coordinates, Kaboom rendering, or identical prediction needs. Use game-defined player identifiers within the documented snapshot-compatible format.
- Define each game's supported inputs and player state explicitly in its own adapter or shared rules. Declare its inputs, simulation cadence, and controller settings once in shared game configuration and reuse them across browser, server, and advertised capabilities.
- Keep game decisions behind focused callbacks rather than adding game-specific flags to core code.
- Prefer configuration over game code for common mechanics: use the controllers in `public/platform/shared/simulationControllers.js` (`createAxisMovementController`, `createSideViewCharacterController`, `createTimedActionController`, `createHorizontalSeparationController`) with parameters and input/state bindings. Keep game shared simulation files mostly configuration and controller composition, with custom callbacks for mechanics no controller covers. When a mechanic repeats across games, extract a focused, parameterized platform component rather than copying it into each game or growing a universal controller with game-specific flags. Keep extension hooks available for custom mechanics and renderers.
- Use `createNetworkedGameSession` (browser) and `createAuthoritativeInputSession` (server) for networking orchestration. Prefer the session's `simulateRoom()` and `getPlayerSnapshotMetadata()` methods over exposing scheduler internals or mapping protocol fields in game code.
- Keep developer setup concise. Document supported parameters, defaults, state/input mappings, and ownership responsibilities in [the game SDK guide](docs/game-sdk.md). New public SDK behavior needs a usable configuration example.
- Trusted in-process game plugins are not a sandbox for uploaded third-party code. External code execution and tenant isolation require an explicit hosting/isolation design; do not expose arbitrary module loading as a service API.

### Prediction and recovery

- Prediction is optional. Games that need event delivery or authoritative snapshots must not be forced into a movement pipeline; event-driven games use their own authoritative recovery contract instead of a movement predictor.
- For networked movement, use fixed command capture and render-time session sampling (prefer `createNetworkedGameRuntime`). Keep respawn, serve, round and recycled actor identities explicit and outside continuous pose smoothing.
- Configure independent correction groups when a pose contains different actors or units; a ball or animation-clock correction must not snap a correctly predicted player.
- On a multiplayer pause, reset input ownership for every affected player and clear game-owned held/action state while preserving match progress.

### Catalog and discovery

- Keep game discovery independent of bundled game count. Libraries request and render bounded catalog pages with server-side search, global genre filters, and explicit pagination.
- Resolve shared-link game metadata through individual lookup instead of downloading the whole catalog. Abort stale requests and keep active runtime metadata stable while playing.
- Keep catalog UI generic and metadata-driven. Games own cover assets and advertised controls; platform components must not branch on game identities or fabricate activity/player statistics. Use a browsable grid as the main large-catalog workspace and keep selected-game previews secondary.

## Adding a game

Add a game package under `public/games/<game>/` (`shared/`, `main.js`, `catalog.js`), a server adapter in `server/platform-backend-engine/games/`, an entry in `builtInGames.js`, an entry in `public/platform/src/data/games.js`, and a `build:<game>` script if the game is bundled. [The game SDK guide](docs/game-sdk.md) is authoritative; where the README and the SDK guide disagree, follow the SDK guide.

## Platform UX

- **Presentation.** Keep library console geometry viewport-driven and independent of game identity. Games default to an expanded platform play surface with the outer console hidden, including with touch controls disabled or keyboard/mouse input; an explicit current profile preference can restore the console. Keep runtime/canvas identity stable through presentation changes.
- **Fullscreen.** Request browser fullscreen synchronously from a landscape Play gesture and use the full-window fallback when unavailable or denied. Direct shared links must not request native fullscreen without user activation; keep a labeled Fullscreen action available. Do not force re-entry after Escape. Returning to the library restores the console and releases platform-owned fullscreen.
- **Orientation.** All games use platform-owned landscape startup on touch devices: attempt native landscape rotation and defer initial runtime loading/room joining while a touch viewport remains portrait. The rotate prompt can explicitly request landscape fullscreen. Later viewport changes must retain the running game and canvas. Game renderers fit the supplied host and never own fullscreen or orientation.
- **Touch controls.** Bundled games supply touch descriptors; reusable button/direction bindings route through the SDK, independent of visible console DOM. Default to translucent readable surfaces (about 40% opacity) with distinct pressed feedback. Preserve editable positions/sizes and per-game/device profiles through versioned migration, with descriptor API and preference schema versions kept separate.
- **Controls ownership.** Controller action buttons belong to games. Platform actions such as diagnostics use their own labeled controls and keyboard shortcut instead of consuming a game's attack/defense button.
- **Visual language.** All platform-owned UX uses the library's dark surfaces, subtle rounded borders, cyan primary actions, Space Grotesk headings, and Manrope body text, including in-game fullscreen controls, connection/ping status, diagnostics, settings, loading/errors, and invite/exit/results dialogs. Reuse platform design tokens and shared dialog chrome instead of copying styles into games. Game artwork and gameplay HUDs may use their own visual language; platform UX must not inherit game-specific pixel styling.
- **Overlays and accessibility.** Keep overlays within the host screen without resizing or remounting the runtime or console shell. Provide labels, visible feedback, readable telemetry, keyboard focus containment for the topmost modal, Escape cancellation where dismissal is supported, and focus restoration. Do not announce every telemetry refresh to assistive technology or run platform shortcuts while a modal has focus.

## Game animation and sprite art

- Advance animations at render cadence with stable action identities, independent of snapshot delivery. Faster animation playback must not change authoritative combat timing.
- Give materially different moves distinct authored clips with explicit frame ranges and pivots; retiming one shared strike does not substitute for visibly different attack, jump, slide or dodge poses. Keep visual transforms separate from simulation coordinates.
- Verify the actual sprite sequence and state transitions in the browser at game scale, not only the configuration.

### Sprite fighters (Fight)

- Keep each fighter's face, costume, palette, proportions and pixel treatment consistent across idle, running, attacks, defense, mobility and defeat. Reuse a canonical character reference for related sprite sheets and calibrate visual size and contact pivots without changing physics.

## Build outputs

`dist/` folders are gitignored and `postinstall` runs `npm run build`. After editing these, rebuild or the browser keeps serving stale code:

- A game whose server adapter `entryUrl` points to `/games/<game>/dist/main.js` (currently Dead Shift, Sky Dash, Riftball, Ludo): `npm run build:<game>`.
- `public/platform/src/`: `npm run platform:build` (the server serves `public/platform/dist/index.html`).

Other games load `/games/<game>/main.js` as plain ES modules and need no rebuild. Run the server locally with `npm run dev` (port 3100).

## Verification

Use existing behavior tests to protect refactors. Add meaningful regression tests for changed behavior, not tests that mirror implementation text or renamed constants.

```sh
npm test
npm run build
```

- Unit and integration tests are `tests/*.test.js` (Node test runner), with shared fixtures in `tests/helpers/`. Browser suites are `tests/browser/*.mjs`, run with `npm run test:<name>:browser`; they read settings such as `CHROME_PATH`, `PLATFORM_BASE_URL`, `PLATFORM_TEST_RTT_MS`, and `PLATFORM_TEST_GAMES`.
- After changes to networking, input, rooms, or a game's sync adapter, verify the affected games with multiple clients (movement, short action presses, contact, reconnects, rematches, delayed delivery), for example with `npm run test:multiplayer:browser`. Verify networked adapters at 150, 300 and 500 ms RTT with jitter, ordered delivery stalls, short actions, and neutral-input stability.
- Prove reusable contracts and shared SDK changes with different games and game configurations, input/state schemas, player capacities, and simulation rates. Fight and Pong are existing integrations. Verify lifecycle, latency, and reconnect behavior at the contract boundary, not only through Fight-specific tests.
- Diagnostics select game configuration through the same public contracts. A game-specific probe must be labeled as such and kept with that game.
- Use `npm run net:probe -- --url http://localhost:3100 --game pong --seconds 30` to inspect a selected match's server and network timing; it is not a capacity benchmark. See [the game SDK guide](docs/game-sdk.md) for configuration examples and integration coverage.

## Before you finish

1. `npm test` passes.
2. Affected bundles are rebuilt (see Build outputs).
3. No engine or shared module imports a game or branches on a game identity.
4. No unrelated renames or reformatting.
5. Changed behavior has a regression test.
6. New public SDK behavior is documented in [the game SDK guide](docs/game-sdk.md) with a configuration example.
7. Report what changed, what was verified, and any remaining limitation. A local rebuild does not update the deployed service.
