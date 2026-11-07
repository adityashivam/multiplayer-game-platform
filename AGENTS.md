# Repository coding conventions

These conventions apply throughout this repository. Apply them to new and changed code, keep work within the requested scope, and preserve existing behavior during refactoring unless a behavior change is explicitly requested.

## Project context

This is a JavaScript ES module project with a React platform UI, browser game clients, and an Express/Socket.IO authoritative game server. Keep changes in the existing languages and architecture unless a migration is requested.

- `public/platform/frontend-engine/`: reusable client timing, input, prediction, interpolation, and transport code.
- `public/platform/shared/`: game-independent contracts, configurable simulation controllers, and constants used by browser and server.
- `public/games/`: game-specific controls, rendering, assets, and synchronization adapters.
- `public/games/<game>/shared/`: controller configuration and optional custom pure rules used by that game's browser client and authoritative server.
- `server/platform-backend-engine/`: authoritative room lifecycle, command processing, simulation, and snapshot handling.
- `server/platform-backend-server/`: HTTP/server entry points and operational endpoints.
- `scripts/`: development and diagnostic tools.
- `tests/`: Node test runner regression and integration tests.

## Coding conventions

1. **Explicit types and supported keys.** In JavaScript, use useful JSDoc `@typedef`, `@template`, and typed parameters for input states, player states, command frames, options, and responses. Define closed shapes and literal unions when keys are known. Restrict key arguments with `keyof` where appropriate. Use dictionaries or generic key maps only for genuinely dynamic data, such as plugin-defined poses or snapshot schema paths. Do not introduce a TypeScript migration just to add types.

2. **Descriptive function names.** Name functions for their action and domain, such as `parseAndValidateProbeOptions`, `recordReceivedSnapshot`, or `resetPlayerInputSession`. Avoid vague helpers such as `required`, `invalid`, `process`, or `handle` without a domain. Preserve established public APIs and wire field names when changing them would break callers.

3. **Role-specific object names.** Prefer names such as `playerState`, `inputFrame`, `predictionContext`, `probeClient`, `socketPacket`, `healthResponse`, and `networkSummary`. Use plurals for collections. Avoid ambiguous names such as `data`, `result`, `obj`, and one-letter identifiers when a domain name would clarify their role. Established mathematical coordinates and wire identifiers such as `x`, `y`, `p1`, and `p2` remain appropriate.

4. **Logical spacing and readable formatting.** Keep related declarations together. Separate setup, validation, processing, and returns with blank lines. Use ordinary multi-line branches and object declarations rather than dense one-line statements. Follow the surrounding style; default to two-space indentation, double quotes, and semicolons in JavaScript.

5. **Named domain constants.** Give protocol versions, event names, packet kinds, HTTP details, error codes, simulation settings, and limits meaningful names. Put constants next to the domain that owns them; share actual client/server contracts from `public/platform/shared/`. Avoid a universal constants collection or extracting every incidental literal. Keep literal expected values in tests when they independently verify a contract.

6. **Encapsulated protocol and HTTP handling.** Put packet encoding, transport framing, health responses, headers, and response parsing behind focused helpers. Main game and application flows should call meaningful operations rather than manipulate low-level protocol details inline.

7. **Clear main flow and focused responsibilities.** Entry functions should reveal the operation sequence. Delegate validation, connection setup, simulation, metrics collection, and cleanup to focused helpers. Prefer small modules with clear boundaries over large entry functions or speculative abstraction layers. Reuse shared networking code and adapt game-specific rules at explicit boundaries.

8. **Useful JSDoc.** Document public functions and non-obvious helpers with their purpose, parameter shapes, return values, mutation/ownership rules, and important failure cases. Use `@param`, `@returns`, and `@throws` where useful. Keep documentation aligned with parameter names and behavior; avoid comments that merely repeat the code.

9. **Respect change scope.** Formatting-only requests must change whitespace only. Refactoring must preserve gameplay rules, timing, defaults, wire formats, CLI output, and error behavior unless changes are requested. Do not reformat unrelated legacy code, add dependencies, or change hosting as part of cleanup.

## Game and networking boundaries

- Keep authoritative game results on the server. Shared simulation rules must remain usable without browser or server globals.
- Keep simulation cadence separate from rendering cadence. Preserve command sequence, simulation tick, input epoch, and snapshot baseline semantics.
- Keep queues, histories, and catch-up work bounded. Prefer explicit units such as `delayMs`, `fixedDtSec`, and `sequenceNumber`.
- Distinguish round-trip latency, snapshot delivery gaps, server scheduling delay, simulation cost, and dropped simulation steps. Snapshot sequence gaps are not measured IP packet loss.
- Keep reusable engine contracts genre-independent. Define each game's supported inputs and player state explicitly in its own adapter or shared rules.
- Avoid unnecessary allocation, blocking work, or high-frequency UI updates in simulation and rendering paths. Optimize using measurements while keeping the code understandable.

## Platform as a service architecture

- Build a reusable platform with loose coupling to games and clear extension points for game developers. The platform must remain usable when any bundled game is removed.
- Dependency direction is from game packages into the platform SDK. Reusable client/server engines and shared protocol modules must not import concrete games, contain game namespaces, or branch on game identities.
- The platform owns transport, rooms, simulation scheduling, bounded input queues, snapshot delivery, optional prediction/reconciliation, lifecycle, diagnostics, and reusable simulation mechanics. Game packages select and configure mechanics and own their custom rules, combat outcomes, scoring, assets, controls, and rendering.
- Connect games through documented, versioned registration and adapter contracts. New games should supply metadata and callbacks without changing engine internals. Keep the trusted built-in package list at the application composition boundary.
- Make player slots, simulation cadence, input shapes, and supported networking capabilities game-configurable. Avoid assumptions that all games have two players, six Fight controls, pixel coordinates, Kaboom rendering, or identical prediction requirements.
- Prediction is optional. Support games that need event delivery or authoritative snapshots without forcing them into a movement pipeline. Keep game decisions behind focused callbacks rather than adding game-specific flags to core code.
- Keep client/server command ownership, acknowledgement, recovery, and reset behavior in the SDK. Adapters should describe game rules and mappings instead of duplicating networking orchestration.
- Prefer configuration over repeated game code for common mechanics. Use the platform's axis movement, side-view movement, timed action, and separation controllers with parameters and input/state bindings. Keep game shared simulation files primarily configuration and controller composition. Preserve custom callbacks for mechanics the existing controllers do not cover.
- Use `createNetworkedGameSession` for browser networking orchestration and `createAuthoritativeInputSession` for server input ownership, processing, and recovery. Prefer `simulateRoom` and `getPlayerSnapshotMetadata` over exposing scheduler internals or manually mapping protocol fields in game code. Developers should supply configuration and game callbacks without implementing input queues, acknowledgement/replay, interpolation timing, or reconnect/rematch reset algorithms.
- Declare a game's inputs, simulation cadence, and controller settings in shared game configuration and reuse them across browser, server, and advertised capabilities. Keep simulation cadence independent of rendering FPS.
- When a mechanic repeats across games, extract a focused, parameterized platform component. Avoid copying an implementation into each game or growing a universal controller with game-specific flags. Keep extension hooks available for custom mechanics and renderers.
- Keep developer setup concise and document supported parameters, defaults, state/input mappings, and ownership responsibilities in [the game SDK guide](docs/game-sdk.md). New public SDK behavior needs a usable configuration example.
- Keep game discovery independent of bundled game count. Browser libraries must request and render bounded catalog pages with server-side search, global genre filters, and explicit pagination. Resolve shared-link game metadata through individual lookup instead of downloading the entire catalog. Abort stale requests and keep active runtime metadata stable while playing.
- Keep catalog UI generic and metadata-driven. Games own cover assets and advertised controls; platform components must not branch on game identities or fabricate activity/player statistics. Use a browsable grid as the main large-catalog workspace and keep selected-game previews secondary.
- Keep the console shell stable across library, loading, game, and return navigation. Shell geometry belongs to the platform and depends on viewport size and explicit user presentation choices, never on the selected game or route. Starting a game must not automatically request fullscreen or lock device orientation. Renderers must fit the provided host surface and leave the outer shell and browser presentation unchanged.
- Match all platform-owned UX to the library's dark surfaces, subtle rounded borders, cyan primary actions, Space Grotesk headings, and Manrope body text. This includes in-game fullscreen controls, connection/ping status, diagnostics, settings, loading/errors, and invite/exit/results dialogs. Reuse platform design tokens and shared dialog chrome rather than copying styles into games. Game artwork and gameplay HUDs may use their own visual language; platform UX must not inherit game-specific pixel styling.
- Keep platform overlays within the available host screen without resizing or remounting the runtime or console shell. Provide labels, visible feedback, readable telemetry, keyboard focus containment for the topmost modal, Escape cancellation where dismissal is supported, and focus restoration. Do not announce every telemetry refresh to assistive technology or use platform shortcuts while a modal has focus.
- Diagnostics must select game configuration through the same public contracts. A game-specific probe must be labeled as such and kept with that game.
- Prove reusable contracts with different games, input/state schemas, player capacities, and simulation rates. Use game-defined player identifiers within the documented snapshot-compatible format. Verify lifecycle, latency, and reconnect behavior at the contract boundary, not only through Fight-specific tests.
- Trusted in-process game plugins are not a sandbox for uploaded third-party code. External code execution and tenant isolation require an explicit hosting/isolation design; do not expose arbitrary module loading as a service API.

## Verification

Use existing behavior tests to protect refactors. Add meaningful regression tests for changed behavior, not tests that mirror implementation text or renamed constants.

```sh
npm test
npm run build
```

When relevant, verify the affected games with multiple clients, including movement, short action presses, contact, reconnects, rematches, and delayed delivery. Shared SDK changes should be exercised with different game configurations; Fight and Pong are existing integrations. Use `npm run net:probe -- --url http://localhost:3000 --game pong --seconds 30` to inspect a selected match's server and network timing; this is not a capacity benchmark. See [the game SDK guide](docs/game-sdk.md) for configuration examples and current integration coverage.

Report what changed, what was verified, and any remaining limitation. A local rebuild does not update the deployed service.
