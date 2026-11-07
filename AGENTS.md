# Repository coding conventions

These conventions apply throughout this repository. Apply them to new and changed code, keep work within the requested scope, and preserve existing behavior during refactoring unless a behavior change is explicitly requested.

## Project context

This is a JavaScript ES module project with a React platform UI, browser game clients, and an Express/Socket.IO authoritative game server. Keep changes in the existing languages and architecture unless a migration is requested.

- `public/platform/frontend-engine/`: reusable client timing, input, prediction, interpolation, and transport code.
- `public/platform/shared/`: pure simulation rules, shared contracts, and constants used by both browser and server.
- `public/games/`: game-specific controls, rendering, assets, and synchronization adapters.
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

## Verification

Use existing behavior tests to protect refactors. Add meaningful regression tests for changed behavior, not tests that mirror implementation text or renamed constants.

```sh
npm test
npm run build
```

When relevant, verify Fight with two clients, including movement, short action presses, contact, reconnects, rematches, and delayed delivery. Use `npm run net:probe -- --url http://localhost:3000 --seconds 30` to inspect a single match's server and network timing; this is not a capacity benchmark.

Report what changed, what was verified, and any remaining limitation. A local rebuild does not update the deployed service.
