# Multiplayer hardening across the catalog

Apply the existing authoritative platform networking contract to every multiplayer game. Keep game rules and outcomes server-owned, simulation independent of rendering, and game adapters independent of one another. WebGL Drift is a single-player sample and has no multiplayer transport to migrate.

## Implementation

1. Measure shared prediction and interpolation under ordered 150, 300 and 500 ms round-trip delivery, jitter, 200 ms stalls and reconnects. Fix demonstrated reversals and interpolation across discrete respawn/reset identities with parameterized SDK behavior.
2. Migrate Mario and Mario Touch to shared movement rules, queued commands, acknowledgement/replay, bounded histories and epoch recovery. Preserve level, enemies and race behavior. The Mario agent owns its game, server adapter and focused tests.
3. Migrate Road Rash to shared movement rules and the same sessions. Use unwrapped progress for prediction/interpolation; preserve server-owned traffic, damage, kicks and scoring. The Road Rash agent owns its game, server adapter and focused tests.
4. Audit Fight, Pong, Dead Shift, Sky Dash and Riftball for discontinuities and delayed presentation. Exercise their real shared simulation through the SDK; integrate continuity identities where needed. The root agent owns these adapters and catalog metadata.
5. Keep Draw event-driven. Verify immediate local drawing, authoritative convergence, clear/reconnect recovery and bounded history without a movement predictor. Eliminate full-board serialization at simulation frequency. The root agent owns Draw.
6. Document the contracts, per-game coverage and practical latency limits. Run independent code review, the Node suite, production build and two-client browser checks through controlled ordered latency/jitter. Do not equate local probes with a capacity benchmark or a deployed-service update.

## Acceptance checks

- Commands and snapshots use actual SDK boundaries; queues, replay and catch-up remain bounded.
- Short actions between fixed captures survive delivery bursts. Server-owned damage, hits, kills and race results remain authoritative.
- Resting characters settle without oscillation; monotonic remote movement does not reverse solely because of interpolation tangents. Reset identities never interpolate across respawns, serves or new rounds.
- Reconnects preserve seats, discard stale ownership and clear held controls; rematches start cleanly.
- Mario, Mario Touch and Road Rash advertise their actual queued input templates and shared cadence.
- Tests explicitly distinguish round-trip delay from one-way delay. High latency still delays remote information and server-confirmed interactions; no zero-lag guarantee is made.

## Reference techniques

These changes use established client prediction, server reconciliation and buffered snapshot interpolation. Socket.IO preserves event order but does not replay missed server events by default, so authoritative recovery is still required after reconnects. See [Socket.IO delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/), [snapshot interpolation](https://gafferongames.com/post/snapshot_interpolation/) and [Valve's networking overview](https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking).

## Verification completed

- `npm test`: 736 tests passed, including per-game 150/300/500 ms RTT scenarios and cross-catalog ownership/metadata checks.
- `npm run build`: production build passed.
- Actual two-browser-client checks passed for Fight, Pong, Mario, Mario Touch, Road Rash, Dead Shift, Sky Dash, Riftball and Draw through 500 ms baseline RTT, ±40 ms deterministic one-way jitter and periodic 200 ms delivery stalls. Observed RTT samples were above 500 ms. Checks included native inputs, opponent updates, protocol acknowledgements, retained seats on reload, later Mario Touch portrait rotation, and Draw stroke/clear/history recovery.
- Pong's final browser check additionally verified rendered paddle centers match the authoritative 1280-unit arena. Fight keyboard capture and application-only RTT regressions came from failures in the real impaired browser checks.
- Independent review found and resolved concurrent Draw clear acknowledgement, stale paused lifecycle, evicted stroke echoes, invalid runtime timing and legacy action re-latching issues. No remaining review findings.
- Updated local server restarted on port 3000; its individual game metadata endpoint responds successfully. Deployment and hosted capacity testing remain separate from local correctness verification.
