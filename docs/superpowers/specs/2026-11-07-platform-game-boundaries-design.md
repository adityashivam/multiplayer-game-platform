# Platform and game package boundaries

The user authorized implementation of a loosely coupled platform with developer flexibility, and requested that its rules live in AGENTS.md. This implements a trusted plugin/SDK boundary in the existing JavaScript architecture. Public upload/execution of arbitrary third-party code, billing, tenant authentication, deployment, and hosting changes are outside this change.

## Chosen approach

Extend the existing engine with a versioned game registry and small reusable client/server input session adapters. Keep game-specific pure simulation beside each game. Register the existing trusted packages at a composition boundary. Retain the current renderers and wire compatibility.

Merely relocating files would leave duplicated lifecycle code. A full service or engine rewrite would change unrelated product behavior. The SDK/plugin approach reuses the current working engine while creating a testable extension boundary.

## Contracts

- A game plugin has apiVersion 1, metadata, and a register(io) callback for networked games. A registry validates duplicate IDs/namespaces/paths and exposes catalog and lookup operations. The HTTP application consumes the registry, not concrete game imports. Existing URLs/catalog fields and the legacy room alias remain available through composition configuration.
- Room allocation and rejoin iterate game-defined player slots from state.players, with optional configured playerIds. No p1/p2 assumptions in reusable room/state helpers. Existing two-player games keep their slot IDs and start behavior.
- createPredictedInputSession(config) owns a bounded input timeline, prediction, epoch resets, frame encoding, acknowledgements and replay. Config supplies captureInput, sendInput, simulate, extractPose and optional cloneState/fixedDtSec/smoothing limits. receiveAuthority({state, protocol, inputEpoch, acknowledgedSequence, context}) updates ownership; captureAndPredict(context) produces one command; getRenderPose(dtSec), getStats(), reset({preserveSequence}), stop() expose lifecycle. No sockets, browser globals, game IDs or game state paths inside this helper.
- createAuthoritativeInputSession({inputTemplate, edgeKeys, fixedDtSec, starvationMs}) owns input protocol receipt, per-loop budgets, starvation/drop recovery and epoch resets. simulateRoom({state,dtSec,simulate}) owns room-clock plumbing and steps game-defined players; getPlayerSnapshotMetadata supplies wire ownership fields. Games provide simulation and explicit serialization mappings. Fixed cadence defaults to 60 Hz and can be configured consistently on both sides.
- Fight and Pong use both session adapters with their own shared simulation. Fight retains its movement/combat behavior; Pong predicts only the local paddle while ball/scoring remain authoritative. Other games retain their existing supported networking path and registration.
- Common game mechanics are optional, parameterized platform controllers. Axis movement, side-view character motion, action timing and horizontal separation accept settings and input/state bindings, with custom conditions/hooks where needed. Fight and Pong shared modules contain configuration and factory wiring instead of repeating these algorithms. Custom simulation callbacks remain supported.
- createNetworkedGameSession owns socket state/lifecycle subscriptions, interpolation options, the predicted input session and bounded diagnostics. Games supply their socket/interpolator, prediction settings, readAuthority(snapshot), composeRenderPose(remotePose,localPose,snapshot), optional canCaptureInput(snapshot), onReset and onDiagnostics callbacks. samplePose({nowMs,deltaSec}) connects to the game's fixed render runtime; reset/destroy manage only the wrapper's own resources and listeners. Prediction can be omitted.
- The diagnostic CLI selects --game (default fight for compatibility), fetches public catalog networking metadata, and uses game input templates/namespace/cadence. No Fight identifiers or input types in generic diagnostic helpers. Games may expose snapshots without continuous input.

## Acceptance checks

Existing behavior tests stay green. Tests exercise synthetic plugins, duplicate/invalid registrations, three or more arbitrary player slots, full rooms, reconnect/rejoin/room switching, configurable simulation cadence, epoch recovery, and two different predicted simulations. Actual browser matches verify Fight and Pong movement and rematches; local probes select both games. Shared modules must remain independent of concrete game packages. No push or deployment is included.
