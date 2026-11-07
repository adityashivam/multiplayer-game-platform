# Fight Arcade Combat Upgrade

User-selected direction: fast arcade sword duels with light combos, heavy strikes, aerial attacks, blocking/parries, dashing, and an earned special. Additional requirements: smooth animation playback and fix mid-match room-full failures.

## Design and boundaries

Keep Fight's pixel-art characters and stage, and the stable platform console. Game-owned controls/HUD and effects may change. Keep networking orchestration in the existing platform SDK; combat rules, timing and effects stay in Fight. Work in the current checkout on `codex/fight-combat-upgrade`; do not commit, merge, push or deploy without a further request.

Use a 90-second duel without passive health regeneration, then the existing rematch flow. Light attacks chain through three strikes; heavy, sweep, launcher, aerial and meter-funded special offer different timing/range. Startup, active and recovery windows make hits readable. Guard/parry and a resource-limited dash provide counterplay. Hit checks require facing, range and vertical proximity. The server owns damage, guard and special earnings.

Keyboard and touch controls must be discoverable and usable together. A/light, X/heavy (down + X = sweep), Y/launcher or aerial (guard + Y = special), B/hold guard; double tap a direction to dash. Keyboard: arrows/WASD move/crouch/jump, J/Z light, K/X heavy, U/Y launcher/aerial, L/C guard, I/V special, Shift dash. Action face buttons belong to the game; diagnostics remains on its explicit button and N shortcut.

Animations must play at render cadence, finish their authored swing, distinguish a new attack by an action ID and start local presentation from predicted input. Do not raise simulation/network cadence or invent sprite frames. Use restrained slash/hit/parry effects, short camera feedback, synthesized sound after user interaction, and a legible game HUD. Reduced-motion must suppress camera shake/flashes.

## Shared interface

`public/games/fight/shared/simulation.js` exports existing movement and step APIs plus:

- `FIGHT_ACTION_EDGE_KEYS`: jump, attack, heavyAttack, aerialAttack, dash, specialAttack.
- Input template retains old keys and adds `block`, `dash`, `specialAttack`, `crouch` booleans.
- Attack IDs: `light`, `light2`, `finisher`, `heavy`, `sweep`, `launcher`, `aerial`, `special`.
- `FIGHT_COMBAT`: MAX_HEALTH 500, MAX_GUARD 100, MAX_SPECIAL 100, ROUND_DURATION_SEC 90.
- `createFightPlayerState(x, dir)` initializes all simulation/combat fields.
- Player additions: attackId, guardMeter, specialMeter, guarding, guardTimer, guardBrokenTimer, stunTimer, dashTimer, dashCooldown, dashDir, comboStep, comboWindowTimer, bufferedAttack, bufferTimerSec.
- `getFightAttackPhase(player)` returns idle/startup/active/recovery. Attack definitions include label, damage, range, duration, cooldown, startupSec, activeSec, stunSec, pushPx, guardDamage.
- `stepFightPlayer(player, input, dt, {active, opponent})` keeps deterministic movement/action timers; optional opponent supplies auto-facing.
- `resolveFightStrike(attacker, defender)` applies one authoritative hit and returns null or `{kind, attackType, damage}`; kind hit/block/parry/guard-break. Pure game rules, no transport.
- Snapshots carry all combat fields plus bounded `combatEvents` entries `{id, kind, attackerId, defenderId, attackType, damage, x, y}` and `maxHealth`, `durationSec`. Event IDs reset with rematch. Events repeat across snapshots; clients deduplicate.

## Tasks / verification

- [x] Shared deterministic combat and server lifecycle: timing, combos, guard/parry, meter, dash, geometry and fair result resolution. Add regression tests first.
- [x] Client controls, readable HUD, combat effects and render-cadence animation. Preserve networking subscriptions/cleanup and platform shell geometry.
- [x] Independently diagnose duplicate/reconnect joins and room-full failures; add contract regressions; coordinate any Fight main.js edits.
- [x] Integrate, review, run full Node tests/build, verify two actual clients, keyboard/touch, combat variety, animation continuity, reconnect and rematch. Report measured limits.

Baseline: main/origin main at 8f98cba; clean checkout; 211 tests pass.

## Completed implementation and verification

- Expanded both original attack sheets into versioned 12-frame transparent atlases using image generation with the original characters as references. Original assets remain available. Grid dimensions and normalized feet are checked in regression tests; idle/run/jump/death continue using original sheets.
- Client code is split into focused input/animation tracking, sprite placement, HUD layout and combat-effects modules. Compact HUD uses host CSS pixels and available letterboxes so text stays readable on 320px phones without resizing the game or console.
- A physical press generates one action edge; keyboard/touch holds merge independently. Guard, jump, crouch, chained attacks and special inputs use the shared Fight input contract. Platform B interception was removed; N and the diagnostics button retain platform access.
- Root cause of room-full interruption: a saved-token reconnect arrived while its old transport still owned the seat, then became permanently latched after rejection. Exact-token overlap now receives bounded SDK recovery (500ms retries, 20s maximum) without evicting the owner or taking another seat. Invalid/new third players still fail immediately. Final failures use a nonblocking game message.
- Reconnecting retains health and remaining time. Only a new duel/rematch resets them. Stale disconnects cannot clear a replacement connection's ownership.
- Review findings were reproduced and corrected: fixed-size 16-slot event snapshots prevent delayed effects during schema reuse; consistent pre-movement facing removes aerial crossover slot bias; independent presentation IDs allow valid attacks and sounds after a speculative attack counter is rolled back. Empty event slots have ID zero and are ignored.
- Fresh full suite: 271 tests passed, zero failed. Production build and whitespace checks passed. Latency tests cover new controls at 0/100/200/300ms and a 100ms burst; genuinely late actions converge within smooth recovery bounds instead of being mislabeled as zero-correction cases.
- Real two-client browser checks: keyboard movement/attacks, B hold guard, dash, full-room rejection, overlapping valid-token rejoin, preserved duel clock, complete match and rematch reset. Desktop, 390px/320px portrait and short landscape overlays fit their hosts with stable shell geometry and no runtime exceptions.
- Live animation trace traversed all frames 0–11; observed average render interval was about 16.65ms (~60FPS) on this headless test setup. The 120Hz render cap supports faster displays but is not a guarantee of 120FPS on every device or hosting/network conditions.

Local development server was restarted on port 3000 with the new rules. Changes remain uncommitted on `codex/fight-combat-upgrade`; nothing was pushed or deployed.
