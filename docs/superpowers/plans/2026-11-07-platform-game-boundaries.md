# Platform Game Boundaries Implementation Plan

> **For agentic workers:** Use test-driven implementation and focused independent tasks. The user authorized execution now; continue through validation without another approval checkpoint.

**Goal:** Enforce loose coupling between reusable platform services and game packages while preserving working games.

**Architecture:** Versioned trusted game registration plus reusable client/server input sessions. Concrete simulations belong to game packages; rooms and diagnostics consume generic contracts. Fight and Pong demonstrate different simulations through the same SDK.

**Tech Stack:** JavaScript ES modules/JSDoc, Node tests, Express, Socket.IO, existing browser/Kaboom renderers.

**Spec:** docs/superpowers/specs/2026-11-07-platform-game-boundaries-design.md

## Global Constraints

- Apply AGENTS.md conventions. Preserve existing game URLs, default tick rates, legacy input support, game rules, and public catalog fields.
- Game-neutral engine code must not import concrete games. Game adapters may import the SDK and their own rules.
- Keep current hosting and JavaScript architecture; add no dependencies or third-party execution endpoint.
- Work in the current clean feature checkout so local testing stays available; do not push or deploy.

## Review Focus

- Arbitrary player slots, reconnect tokens, room switching, and stale socket occupancy must not allocate one slot twice.
- Epoch changes, input starvation, dropped simulation time, and rematches must discard stale command ownership.
- Configured simulation cadence must match input capture, prediction and authoritative consumption.
- Missing/invalid game registration or unsupported probe configuration must fail before partially mounting the platform.
- Prediction must not mutate retained snapshots or move authoritative ball/scoring state.

## Task 1: Registry and room extension boundary

**Files:** server/platform-backend-engine/core/{gameRegistry,rooms,registerGame,state,index}.js; server/platform-backend-engine/games/builtInGames.js; server/platform-backend-server/server.js; tests/game-registry.test.js; tests/game-rooms.test.js.

**Interfaces:** createGameRegistry(gamePlugins) accepts {apiVersion:1,meta,register?}; exposes listGames(), getGame(gameId), registerGames(io). HTTP catalog includes optional namespace, room, networking metadata unchanged. Rooms infer slots from state.players or use configured playerIds; scheduleStart retains existing signature and supports generic players.

- [x] Write failing behavior tests for a synthetic game registry, invalid/duplicate plugins and a three-slot room with custom names, full rejection, rejoin and room switching.
- [x] Run those tests, then implement generic registration and room helpers; move built-in composition out of the HTTP application.
- [x] Run focused tests and existing server lifecycle tests; document results.

## Task 2: Generic authoritative input sessions and game rules

**Files:** server/platform-backend-engine/core/{authoritativeInputSession,inputProtocol}.js; server/platform-backend-engine/games/{fight,pong}.js; public/games/pong/shared/simulation.js; tests/authoritative-input-session.test.js; tests/pong-simulation.test.js.

**Interfaces:** createAuthoritativeInputSession({inputTemplate,edgeKeys=[],fixedDtSec=1/60,starvationMs=500}) returns resetPlayer(player), receiveInput(player,payload,nowMs?), simulatePlayer({player,dtSec,loopTick,nowMs,droppedSteps,simulate}). consumeInputFrames accepts optional fixedDtSec. Pong exports PONG_INPUT_TEMPLATE, PONG_FIXED_DT_SEC, PONG_PADDLE_SETTINGS, stepPongPaddle(player,input,dtSec).

- [x] Write failing tests for 30 Hz configured consumption, arbitrary input keys, acknowledgement after simulation, starvation/drop/epoch recovery, and Pong paddle movement/bounds.
- [x] Implement the shared session and migrate Fight's existing orchestration into it without changing rules. Integrate Pong input sessions; preserve legacy controls and ball/scoring authority.
- [x] Run input, Fight, Pong and complete existing tests.

## Task 3: Client SDK sessions and Fight/Pong integrations

**Files:** public/platform/frontend-engine/predictedInputSession.js; public/games/fight/{main.js,shared/simulation.js}; public/games/pong/main.js; tests/predicted-input-session.test.js; existing Fight test imports.

**Interfaces:** createPredictedInputSession and methods follow the spec. sendInput receives an encoded inputFrame packet. receiveAuthority configures protocol/epoch and handles acknowledgements; captureAndPredict creates one fixed-step command only when initialized and ownership is ready.

- [x] Write failing tests showing two different input/state schemas work without game IDs, bounded pending history, 30 Hz packets, stale acknowledgement handling, epoch reset, and snapshot immutability.
- [x] Implement the SDK; move Fight simulation into its game package and migrate Fight lifecycle/encoding/replay to the SDK.
- [x] Add createNetworkedGameSession in public/platform/frontend-engine/networkedGameSession.js with behavior tests in tests/networked-game-session.test.js. Own snapshot/lifecycle subscriptions, optional prediction, interpolation options, bounded diagnostics and precise cleanup; keep socket/interpolator ownership with the caller. Migrate both clients to this higher-level API.
- [x] Integrate Pong's local paddle with the same SDK; interpolate opponent/ball and retain game-specific input/rendering callbacks.
- [x] Run client/Fight/Pong tests and production build.

## Task 4: Configurable diagnostics

**Files:** scripts/network-probe.mjs; scripts/lib/{probeClient,networkMetrics,probeOptions}.js; server/platform-backend-engine/games/metadata.js; public/platform/shared/networkProtocol.js; tests/network-metrics.test.js; tests/probe-options.test.js.

**Interfaces:** Catalog metadata adds optional room.playerIds and networking.{namespace,tickRateHz,inputProtocol,inputTemplate}. CLI --game selects catalog entry (default fight); generic probe helpers receive configuration. Fight namespace/constants and types leave shared protocol/metrics modules.

- [x] Write failing tests for selecting different game schemas, malformed/unknown options/configuration, and cadence-dependent legacy input duration.
- [x] Implement configurable catalog-driven probes. Keep existing default URL/duration behavior and report fields; add game identity to the report.
- [x] Run diagnostic tests, then local Fight and Pong probes after combined server restart.

## Task 5: Integration, developer guidance and review

- [x] Update README with the trusted plugin contract, SDK example, configurable capabilities, game-owned rules, and PaaS scope.
- [x] Verify all tests, build, dependency boundaries, arbitrary player slots, and real two-browser Fight/Pong movement/rematches including delayed delivery.
- [x] Obtain independent review, address concrete findings, and leave the local server ready to test.

## User steering: configurable mechanics

- [x] Add optional parameterized platform controllers for axis movement, side-view motion, timed actions and separation. Define input/state field bindings and validate construction settings. Preserve custom simulation callbacks.
- [x] Reduce Fight/Pong shared simulation modules to settings and controller composition; preserve their exports and exact game rules.
- [x] Verify controller behavior with alternate bindings/settings and seeded before/after simulations, then rerun gameplay checks.

## Progress and decisions

- Baseline: clean codex/netcode-smoothness at 6830285; 49/49 tests pass.
- Execution scope: trusted built-in plugins and reusable SDK; third-party upload/execution is a separate service concern. Keep work in the user's feature checkout for direct local testing.
- User steering: prefer platform-owned configurable mechanics and less per-game networking glue. Add opt-in simulation controllers and a high-level networking session, preserving custom hooks and optional prediction.
- Registry/rooms complete: arbitrary slots, reconnect/room switching, metadata validation and all seven built-in HTTP routes verified.
- Shared sessions/controllers complete: latest combined suite 154/154. Configured controllers match saved original behavior across 419,844 Fight steps, 1,372 contact cases and 30,819 Pong steps.
- Fight/Pong browser checks passed directly and through a 150 ms RTT proxy with jitter and a 100 ms delivery burst. Pong also rejoined its slot and moved after a page reload. No runtime errors or hard correction snaps in those checks.
- Catalog-driven local Fight/Pong/Draw probes passed at approximately 60 Hz with zero dropped steps. Draw sent no input commands.
- Final verification: 170/170 tests, production build and whitespace checks pass. The custom registered three-player game runs at 30 Hz using metadata-derived scheduling; each player's inputs are acknowledged through the same probe contract.
- Independent review found one player-ID/snapshot-path incompatibility. Shared identifier validation now rejects unsupported dotted, numeric-only and prototype traversal identifiers in registration, room allocation and diagnostics; rejection regressions were verified RED to GREEN and compatible identifiers retain their exact snapshot values. The supported format is documented.
- Declared networking cadence now configures the server scheduler by default, with an explicit override available and invalid timing rejected before mounting. Regression tests were verified RED to GREEN.
- Final Fight/Pong probes report approximately 60 Hz, advancing acknowledgements and zero dropped steps. The final local server is running on port 3000. Temporary latency proxy and isolated test servers are stopped. No deployment, push or commit was performed for this change.
