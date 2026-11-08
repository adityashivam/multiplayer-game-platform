# Dead Shift implementation plan

## Goal

Add a two-player first-person zombie kill race: a shared horror arena, five weapons, four enemy types, server-owned combat, and a 90-second round. Preserve the platform's stable console shell and reusable SDK boundaries.

## Visual and interaction direction

Visual thesis: a cinematic abandoned containment chamber with wet industrial materials, cold teal haze, amber emergency light, articulated enemy silhouettes, and a detailed foreground weapon.

Content plan: the arena fills the host canvas; a quiet score/clock strip orients players; health, ammunition, and a compact weapon selector support play; one contextual prompt captures the mouse. Existing platform invitation, connection, fullscreen, diagnostics, and results UI remain platform-owned.

Interaction thesis: immediate camera/weapon response, weighty but restrained recoil and impact feedback, and distinct enemy gait/attack telegraphs. Respect reduced-motion settings and render independently of the authoritative simulation.

## Architecture and constraints

- Three.js is bundled locally with esbuild; no runtime CDN dependency.
- `public/games/dead-shift/shared/` owns pure movement, world collision, combat, enemy AI, projectile physics, and configuration. No renderer or browser globals enter shared rules.
- A game server adapter uses `createAuthoritativeInputSession`. The client uses `createNetworkedGameSession`, prediction, and shared interpolation. New numeric inputs and analog controls extend the SDK generically, preserving all existing boolean games.
- New game registration belongs to the trusted built-in composition boundary. No platform module imports this game.
- Server simulation runs at 60 Hz. Entities, projectiles, event history, catch-up work, visual effects, and rendering resolution are bounded.
- No automatic fullscreen, orientation lock, shell resize, or runtime remount. Dispose listeners, sockets, animation frames, audio, and GPU resources on exit.

## Shared integration contract

- Slug `dead-shift`; players `p1`, `p2`; world uses meters, Y up, feet at Y=0. Camera yaw 0 faces -Z; positive pitch looks up. Forward input `moveZ` is positive, right input `moveX` is positive.
- Inputs: numeric `moveX`, `moveZ` [-1,1], `yaw` [-PI,PI], `pitch` [-1.3,1.3], integer `weapon` [0,4]; boolean `fire`, `reload`, `jump`, `sprint`. Edge inputs are `fire`, `reload`, `jump`; fire also remains continuous while held.
- Numeric input configuration is `numericInputs: { key: { min, max, integer? } }`; input templates contain neutral defaults. Unknown keys, nonfinite numbers, values outside bounds, and invalid integers are rejected on the server.
- `shared/config.js` exports `DEAD_SHIFT_GAME_ID`, `DEAD_SHIFT_FIXED_DT_SEC`, `DEAD_SHIFT_INPUT_TEMPLATE`, `DEAD_SHIFT_NUMERIC_INPUTS`, `DEAD_SHIFT_EDGE_KEYS`, `DEAD_SHIFT_WEAPONS`, `DEAD_SHIFT_ENEMY_TYPES`, `DEAD_SHIFT_ARENA`, `DEAD_SHIFT_COLLIDERS`, and pool/round settings.
- `shared/simulation.js` exports `createDeadShiftPlayer(playerId)`, `stepDeadShiftPlayer(playerState, inputState, dtSec, context)`, and the server's pure round/combat helpers. Movement prediction mutates only player movement fields; authoritative health, kills, and ammunition are never predicted as results.
- Player snapshots expose `x,y,z,vx,vy,vz,yaw,pitch,health,kills,weapon,ammo,reloadRemaining,respawnRemaining,shotId,connected` plus SDK acknowledgement/epoch metadata. Additional game fields are permitted when explicit and stable.
- Snapshots expose `roundId`, `players`, `enemies`, `projectiles`, `events`, `timer`, `durationSec`, `started`, `startAt`, `gameOver`, `winner`, and `inputProtocol`. Fixed pools retain a stable snapshot shape; ID zero means an unused slot. The positive round ID persists across rejoin and increments on rematch, allowing renderers to preserve seen effects during snapshot recovery.
- Enemies expose `id,type,x,y,z,yaw,health,maxHealth,attackPhase,damageId`. Projectiles expose `id,kind,x,y,z,vx,vy,vz,ownerId`. Events expose `id,kind,actorId,targetId,x,y,z,value,weapon`.
- Renderer API: `createDeadShiftRenderer({canvas})` returns `resize(width,height)`, `render({dtSec,timeSec,roundId,playerId,localPlayer,players,enemies,projectiles,events,input,moving,reducedMotion})`, `setQuality(profile)`, `getStats()`, and `dispose()`. Root client owns animation scheduling, networking, and DOM HUD. Renderer may import shared configuration; it does not own networking or DOM chrome.

## Tasks

- [x] Extend generic input schema and transport validation with bounded numeric fields; add backward-compatibility and rejection tests.
- [x] Make platform left/right sticks accessible, reusable analog controls with pointer ownership, deadzone, cancellation, and an SDK subscription API; cover normalization/reset behavior.
- [x] Implement pure arena movement, separation, enemy navigation/attacks, hitscan and ballistic weapon rules, scoring, respawns, and 90-second results with meaningful tests.
- [x] Register an authoritative game adapter with countdown, reconnect, disconnection cleanup, snapshot pools, and rematches using SDK lifecycle/input contracts.
- [x] Build the Three.js room, articulated zombies/opponent, distinct first-person guns, lighting, weapon/impact effects, and bounded resource ownership.
- [x] Integrate mouse/keyboard, platform analog controls, touch controls, prediction/interpolation, HUD, audio, shared platform dialogs, runtime disposal, and catalog artwork.
- [x] Bundle the game, register catalog metadata, and document controls and SDK numeric-input configuration.
- [x] Run focused tests, then `npm test` and `npm run build`; inspect the real arena and test two clients, attacks/projectiles, health/scoring, round completion, reconnect, rematch, shell stability, and analog controls.

## Review focus

Authoritative fire rate/ammunition and single kill credit; wall occlusion; swept projectile collision and grenade gravity; finite bounded input; no overlap or entity identity interpolation artifacts; no game-specific SDK branches; no input leaks through modals; stable host geometry; readable mobile HUD; bounded allocation and complete cleanup. Record actual browser/network observations and remaining limits without claiming unmeasured capacity or universal frame rates.

## Verification record

- Prior Fight work committed as `c17574b`; this feature is isolated on `codex/dead-shift-multiplayer`.
- Final `npm test`: 388 passed, zero failures. Final `npm run build` and `git diff --check` passed.
- Independent review found no Important/Critical issue. Two minor metadata/pause-label inconsistencies were corrected.
- The retained browser test (`npm run test:dead-shift:browser`) passed catalog launch/new-room creation, two live clients, movement/jump, all five weapons, shared grenade/rocket/acid projectiles, full 90-second results, rematch, reload into the same seat, stable shell, stopped rendering on exit, stylesheet cleanup, and relaunch.
- Portrait 390×844: no horizontal overflow; both visible sticks measured 64×64. Simultaneous emulated touch movement and aim worked and reset on release.
- Requested 30 FPS produced 29.99 rendered frames/s with 120 acknowledged commands over approximately two seconds, confirming independent 60 Hz input. The full-round local RAF median/p95 were approximately 16.7 ms. These are observations from this machine, not hardware guarantees.
- A deterministic networking regression covers 150 ms delayed authority, upstream delay and command bursts, bounded queues, correct short-fire credit, stale acknowledgements, and movement convergence.
- Ten-second live probes of Dead Shift and existing Pong completed with zero dropped simulation steps, sequence gaps, or arrival/server gaps over 50 ms. The Dead Shift sample's room CPU p95 was about 0.6 ms. These small local matches are not capacity or deployed-region benchmarks.
- Visual inspection covered the arena, foreground weapons, visible rival, active infected, portrait HUD, and shared platform results dialog. Art is intentionally stylized and rendered with procedural 3D models; the catalog cover is generated key art.
- Physical mobile devices, real internet latency and the deployed service remain outside this local verification. No hosting, deployment, merge, or push was performed.
