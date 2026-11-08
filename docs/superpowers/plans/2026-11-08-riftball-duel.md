# Riftball Duel implementation plan

Design: [Riftball Duel](../specs/2026-11-08-riftball-duel-design.md).

- [x] Define shared configuration, explicit input/player/ball contracts and court dimensions.
- [x] Write failing behavior tests; implement reusable bounded sphere motion and game-owned actions, scoring and prediction.
- [x] Integrate authoritative room/input lifecycle, snapshots and rematches without game branches in the SDK.
- [x] Build original skinned athletes with authored locomotion, charge, strike, jump, dash, feint and outcome clips; verify poses and resource ownership.
- [x] Build the lit arena, ball, camera, effects and bounded replay presentation with quality/reduced-motion support.
- [x] Integrate source-owned keyboard/shell/touch input, networking adapter, HUD/audio, platform results and cleanup.
- [x] Register metadata and bounded catalog entry; add build command, cover, developer/player docs and public sphere configuration example.
- [x] Run pure/integration tests, actual two-client matches and delayed delivery checks, visual inspection, independent code review, full suite and build.

Independent work ownership: simulation/server/sphere mechanic; athlete rig/animation; arena/camera/renderer. Root owns configuration and client/composition integration. No commits or deployment are part of this request.

## Verification evidence — 2026-11-08

- `npm test`: 600 tests passed, zero failures.
- `npm run build`: all game bundles and React production build passed.
- `npm run test:riftball:browser`: complete input-driven match, five-goal winner, actual winning replay, series/rematch, seat-preserving reload, all actions, no invalid bodies, touch movement/jump and charge/aim, standard shell analog movement/jump, live editor, portrait bounds, stable console, disposal and WebGL relaunch passed. Thirty-FPS rendering measured 29.98 FPS while 120 commands were acknowledged over two seconds.
- `PLATFORM_ROOM_TEST_GAMES=riftball,pong npm run test:room-start:browser`: creator/invitee behavior, all five countdown digits, six-hour wall-clock skew, GO, full-room error and rejoin countdown passed for both configurations.
- Delayed SDK pipeline regression: 50 ms command delivery, 150 ms snapshots, ordered bursts, bounded replay, stale ownership and convergence passed.
- Independent review findings were fixed and rechecked: action clock blending, serve-position blending, slot-biased passive contacts, and replay endpoint sampling.
- `npm run net:probe -- --url http://localhost:3000 --game riftball --seconds 30`: p95 room simulation CPU 0.57 ms, p95 scheduling lag 1.24 ms, zero dropped simulation steps and zero application snapshot gaps. This samples one local room and does not establish deployment capacity or global latency.

Landscape, portrait and opening-court screenshots were visually inspected. Phone verification used Chrome touch emulation rather than physical-device performance testing. The local server is running; deployment is outside this request.
