# Dead Shift

A two-player first-person zombie kill race in a shared containment chamber. The round lasts 90 seconds; the player with more infected eliminations wins. Equal scores draw. There is no friendly fire. A defeated operator respawns after three seconds with their score preserved.

## Play locally

Run `npm install`, `npm run build`, and `npm start`, then select **Dead Shift** in the library at `http://localhost:3000`. Use the platform's **START / Invite** control to share the generated room link. Open it in a separate browser profile, private window, or another device to join as the second operator. Reloading an existing tab restores that operator's seat.

For another device on your local Wi-Fi, replace `localhost` in the shared link with the server computer's LAN IP address. Both devices must reach port 3000. Starting the game does not request fullscreen or change the device's orientation.

| Action | Desktop | Platform controls |
| --- | --- | --- |
| Move | WASD / arrow keys | Left analog stick / D-pad |
| Aim | Mouse after clicking Enter arena | Right analog stick; drag the arena on touch devices |
| Fire | Left mouse button | Hold A |
| Reload | R | X |
| Select weapon | 1–5, wheel, Q/E, or weapon strip | B cycles; weapon strip selects directly |
| Select grenade launcher | G | Select weapon 4 |
| Jump | Space | Y |
| Sprint | Shift while moving | Full left-stick deflection uses normal movement speed |
| Invite | Platform Invite button | START |
| Release mouse | Escape | — |
| Network diagnostics | Platform Net button / N | Dedicated platform Net button |

All weapons have unlimited reserve ammunition, individual magazines, and automatic reload when empty. The grenade launcher fires bouncing, fused ballistic grenades. Rockets explode on contact. Walkers, runners, brutes, and spitters have different movement and attacks; spitters fire visible acid projectiles. Cover blocks shots, movement, and blast visibility.

## Implementation

- `shared/config.js`: input schema, arena bounds/cover, weapons, enemies, and limits.
- `shared/simulation.js`, `collision.js`, `navigation.js`: pure authoritative rules and client movement prediction.
- `client/multiplayer.js`: game adapter for the platform networking session, interpolation, room ownership, and reconnection.
- `client/controls.js`: mouse, keyboard, touch, and platform analog mapping.
- `rendering/`: Three.js arena, articulated actors, foreground weapons, and bounded effects. Visual motion advances at render cadence.
- `main.js`: assembly and resource lifetime. Host size comes from the platform; the game never changes shell geometry.
- `server/platform-backend-engine/games/dead-shift.js`: trusted game registration and room lifecycle.

The server owns ammunition, rate of fire, damage, enemy AI, projectile simulation, kill credit, respawns, and results. Client prediction applies only movement. Entity and event pools have fixed bounded snapshot shapes. This integration does not add genre-specific logic to platform services. Three.js is installed from npm and bundled locally by `npm run build:dead-shift`; there is no runtime CDN requirement.

## Verification

`npm test` includes pure gameplay, adapter lifecycle, delayed networking, numeric input, analog ownership, and client controls/recovery regressions. `npm run build` builds both the platform and the game.

With the local server running, `npm run test:dead-shift:browser` launches isolated headless Chrome clients and tests a real full round, all weapons/projectiles, keyboard/jump, simultaneous touch sticks, portrait fit, stable shell geometry, separate render/input cadence, rematch, token reload, cleanup, and relaunch. Screenshots are saved as `dead-shift-*.png` in the OS temporary directory. It takes about two minutes. Set `CHROME_PATH` to your Chrome/Chromium executable on other systems; the default is Chrome's macOS location. Set `DEAD_SHIFT_BASE_URL` to another test server if needed. The test creates disposable game rooms and never uses your normal browser profile.

## Artwork

`assets/cover.png` was generated with the built-in image generation tool. This is catalog key art; the playable arena uses real Three.js geometry, materials, and lighting. The prompt is retained in [the artwork record](artwork.md).
