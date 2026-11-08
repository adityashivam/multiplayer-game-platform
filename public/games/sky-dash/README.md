# Sky Dash

An original third-person obstacle race for two humans and three bots. Both players see the same server-authoritative course. Bots use the same inputs, movement, collisions and checkpoints as humans.

## Play

Run `npm run build` and `npm start`, then choose **Sky Dash** in the library. Send the room link to a friend. The ninety-second race starts after both seats connect. Finish time ranks ahead of checkpoint progress; the round ends when both humans finish or time expires. Bots compete in the same standings and can win.

| Action | Keyboard | Standard shell | Platform touch |
| --- | --- | --- | --- |
| Move | WASD / arrows | Left stick / D-pad | Move stick |
| Jump | Space | A | Jump |
| Dash | Shift | B | Dash |
| Dive | E / X | X | Dive |
| Camera glance | — | Right stick | Follow camera |
| Recenter | R | Y | Automatic |
| Invite | Platform toolbar | START | Platform toolbar |
| Exit | Platform toolbar | HOME | Platform toolbar |

Jump the full-width hurdles, clear rotating sweepers and balance across moving seesaws. Their tilt reacts to the racers standing on either side. Time jumps through circular openings with rotating spokes, dodge swinging hammers and weave around the final bumpers. Checkpoints save progress; falls bring you back quickly. Dash grants a speed burst and dive launches you forward. Hits briefly disrupt movement. The camera follows automatically, so looking around is optional.

The creator receives one invite prompt while waiting; a friend opening that link joins directly. Once both humans connect, the platform shows the same server-timed **5–4–3–2–1**, followed by **GO**. A disconnect cancels the start and a returning player gets a fresh countdown. The canvas and shell remain in place throughout.

Touch layouts use Config or the in-game **Controls** editor. Move, resize or fade buttons, select a finger preset and explicitly hide the shell. The platform saves JSON overrides in localStorage per game and orientation. The game implements no separate mobile layout storage.

## Architecture and capacity

- `shared/config.js`: current human IDs, bot count, input contract, cadence and tuning.
- `shared/course.js`: pure analytic geometry sampled by authority, prediction and rendering.
- `shared/simulation.js`: race rules, bot inputs, contacts, checkpoints, respawns and standings.
- `client/`: control mappings, SDK networking adapter, race HUD and synthesized audio.
- `rendering/`: original Three.js geometry, runner rigs, visual clips, effects and follow camera.
- `server/platform-backend-engine/games/sky-dash.js`: registration, authoritative SDK input session and lifecycle.

The room has **two socket seats**; bots are separate game-owned actors. `registerSkyDashGame(io, { playerIds: ["red", "blue", "green", "gold"], botCount: 2 })` supports more humans without changing SDK internals. Select corresponding metadata at application composition when changing production capacity. Total racers are bounded at twelve; higher limits require measurements. The deployed default remains two humans and three bots.

The platform controller provides swept upright-character contact, sloped-top support, moving-platform carry, buffered jumps and coyote time. Game rules add seesaw load/spring dynamics, obstacle impulses and race outcomes. Seesaws use bounded arcade tilt and upright center-foot support rather than passive rigid-body sliding. Funny visual tumbles use procedural animation rather than expensive articulated ragdolls. A client-owned prediction clock advances per replay step and drives local obstacle presentation; seesaw lookahead is bounded at 150 ms and remote runners use delayed interpolation. Rendering follows quality/FPS preferences independently of the fixed 60 Hz simulation.

Disconnects pause the existing race. The per-tab seat token restores ownership and resumes the same course clock and checkpoints. Rematches increment round identity. Geometry, effects, input listeners, audio and networking are disposed when leaving.

## Verification

```sh
node --test tests/kinematic-character.test.js tests/sky-dash-*.test.js
npm test
npm run build
npm run test:sky-dash:browser
npm run test:room-start:browser
```

The browser check uses an isolated Chrome profile and a local server on port 3000; set `CHROME_PATH` or `SKY_DASH_BASE_URL` to override. `SKY_DASH_BROWSER_QUICK=1` checks launch, two clients, keyboard actions and responsive sizing. The full check drives legal inputs through the platform control boundary, then checks results, rematch and reload. It never assigns authoritative coordinates or game state.

No external model, texture or audio service is required. Quality profiles reduce resolution, shadows and particle budgets. Local checks are functional diagnostics, not hosting capacity benchmarks. Building locally does not update Render.

Verification recorded on 2026-11-08: 541 Node tests and the production build pass.
Two browser clients completed a full race with three bots, obstacle hits, falls,
checkpoints and separation, then rematched, restored a seat after reload and
returned/reopened the game. Real simultaneous shell and platform touch input,
the live layout editor, landscape/portrait sizing and stable shell geometry pass.
A 30 FPS render preference produced about 30 actual WebGL frames/second while
the server acknowledged 120 input frames over two seconds. Delayed-input tests
cover 50 ms command delay, 150 ms snapshot delay, bursts and starvation recovery.

The platform room-start browser check verifies creator versus invitee, every
countdown digit, GO, full-room errors and token-preserving reloads in Sky Dash,
Pong, Fight and Dead Shift, including an invited device clock six hours ahead. Unit coverage also
checks jitter cannot rewind digits and transport lifecycle continues without
gameplay subscribers. The harder course renderer sampled 173 draw calls and
222,526 triangles in an isolated scene. These are local functional/geometry
checks, not hosting or GPU capacity benchmarks; mobile hardware and the deployed
service still require measurements.
