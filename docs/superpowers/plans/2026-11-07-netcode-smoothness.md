# Netcode smoothness implementation plan

## Approved scope

Implement the preceding networking audit's software fixes and validate Fight first. Keep the current free hosting and region. The user authorized implementation on 2026-11-07; paid hosting and regional deployment are excluded. Work on the feature branch in the existing clean checkout so the local game remains directly testable. No push or deployment is included.

## Architecture and contracts

- Keep Socket.IO/WebSocket and reliable chained snapshots in this iteration; measure queue/delivery gaps instead of dropping dependent deltas.
- Fix shared render pacing and use a monotonic, gradually adjusted remote playback timeline.
- Introduce a reusable, bounded command buffer and a reusable authoritative-state-plus-pending-command prediction controller.
- Fight uses 60 Hz command simulation on both sides and shared pure player simulation rules. Server acknowledgements advance only after simulation. Protocol-2 commands are buffered with bounded catch-up; legacy input remains supported. Fight uses continuous fixed world steps: held-input physics continues during starvation, late command states are coalesced with action edges preserved, and acknowledgement advances after the step incorporates them. Snapshots expose inputSimulationTick so already-simulated time is not replayed.
- Server module exports `enqueueInputFrame({player,payload,inputTemplate})`, `consumeInputFrames({player,dtSec,simulate})`, `resetInputBuffer(player)`. Consumer invokes `simulate(input, fixedDtSec, frame)` before acknowledging each command. Protocol-2 frame is `{type:'inputFrame',protocol:2,seq,state}`; duration is server-controlled 1/60 s. Queue cap 120, catch-up cap 8 commands/tick, accumulated time credit cap 250 ms. Reset buffer on reconnect/rematch. Reject invalid/duplicate/stale commands and never silently overwrite discrete edges.
- Shared Fight rules live at `public/platform/shared/fightSimulation.js`, exporting `FIGHT_FIXED_DT_SEC`, `FIGHT_INPUT_TEMPLATE`, `stepFightPlayer(player,input,dtSec,{active})`, and `resolveFightSeparation(p1,p2)`. Include attack timer/cooldown state needed for replay in snapshots. Preserve server-only health, combat results, and match authority.
- Generic client controller accepts simulation/clone/pose callbacks; always restores authoritative state and replays unacknowledged commands. Correction smoothing affects the displayed pose, not authoritative simulation.
- Add build/protocol identity and a repeatable two-player network probe reporting server generation timing separately from RTT and snapshot arrival gaps. No expensive load test against the free deployment.

## Tasks and checks

1. Shared frame pacing/interpolation: regression tests for irregular 60 Hz frames, 90/120/144 Hz cadence, buffer growth, monotonic time, burst delivery, duplicate snapshots and reset. Run `node --test tests/runtime-timing.test.js tests/interpolation.test.js` RED then GREEN.
2. Server command processing/shared Fight physics: tests for acknowledgement only after simulation, ordered short presses, duplicates, invalid input, server-controlled durations, bounded queues/catch-up and reset; verify shared player rules preserve normal movement/attack timing. Run `node --test tests/input-protocol.test.js tests/fight-simulation.test.js` RED then GREEN.
3. Generic prediction and Fight integration: tests for immediate prediction, delayed authoritative replay, correction decay and reset; use 60 Hz commands without the old independent 120 Hz sender or conditional stale-state correction. Run `node --test tests/command-prediction.test.js`, then the complete test suite.
4. Diagnostics/release identity: health endpoint, build identity, clear network HUD labels, and `npm run net:probe -- --url URL --seconds 30` with one two-player test room. Tests cover protocol decoding, metrics, and classification.
5. Build and integration: `npm test`, `npm run build`, real two-player browser test, movement/contact/jump checks with emulated RTT and jitter, and a baseline probe of the current deployed server. Review whole diff and resolve important findings before delivery.

## Review focus

Reconnect/scene reset during loading; short input edges arriving in a burst; frame stalls and clock drift; loss of a delta baseline; server/client movement and contact parity; bounded queue behavior under abusive input; health metrics that confuse network delay with server CPU.

## Progress

- Baseline: clean checkout at 0bac3c0; no existing test script. The previous shared-link fix is committed locally but the deployed UI bundle is older.
- Implementation complete. Fight integrates the new prediction controller; shared changes retain existing public APIs for other games.
- Verification: 49/49 tests pass and production frontend build succeeds. Actual two-player browser checks passed for movement, short jump presses, landing, contact, rematch and post-rematch movement, both directly and through 150 ms RTT + jitter + a 100 ms burst. No runtime exceptions or hard teleports in those checks.
- Live free-server probe: roughly 60 snapshots/sec, zero dropped simulation steps and about 172 ms median RTT in the final short sample. This is one-match timing evidence, not a capacity benchmark. Current deployment still has legacy protocol (health endpoint absent); no deployment performed.

- Review fixes: continuous physics avoids frozen jump/attack state; server dropped-time and 500 ms input starvation trigger epoch resynchronization; client reconciliation filters already simulated command time. Rematch resets socket delta baselines and subscriber delivery. Probe uses the shared deadline-paced stream; display delay is measured in the projected server timeline.
