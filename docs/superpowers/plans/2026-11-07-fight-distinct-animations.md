# Distinct Fight moves and sprite sequences

User request: attacks must look clearly different; replace shared attack playback with new move-specific sheets, improve jumping, and add sliding and dodging. Preserve all current uncommitted combat/room fixes on codex/fight-combat-upgrade.

## Visual and gameplay design

Each fighter gets distinct authored clips for quick slash, reverse cross-cut, combo finisher, heavy overhead, low sweep, rising launcher, aerial downward cut and special. Jump has takeoff/ascent/apex/descent/landing poses. Dodge uses a compact evasive roll/step; slide is a low extended-leg ground movement, not the running animation. Guard has its own defensive pose.

Generate separate transparent character atlases with four named animation rows and eight frames per row. Three atlases per fighter: light/cross/finisher/heavy; sweep/launcher/aerial/special; jump/slide/dodge/guard. Inspect the actual generated rows, calibrate scale/pivots, and verify game playback before use. Keep existing assets available as fallbacks, but active move routing must use distinct sequences.

Standing dash becomes the existing resource-limited dodge. Crouch + dash starts a ground slide with its own duration/speed/cost and low profile; air crouch + dash remains a dodge. Keep input/network architecture unchanged. Slide avoids horizontal light/light2 strikes but remains vulnerable to sweeps, heavy, launcher, aerial and special. Original short dodge invulnerability remains restricted to dodge. Blocking + dash may make a backward dodge; holding attack/shift must not autorepeat.

## Interface / ownership

- Root owns shared simulation, server integration, rules tests, asset generation and calibration.
- Presentation task owns game main.js, spritePresentation.js, presentation.js, focused client tests and necessary HUD labels. It must consume atlas manifest metadata and keep raw actor poses independent of visual pivots.
- Add shared player dashType: null|dodge|slide. Extend FIGHT_COMBAT with slide settings. Existing dashTimer/cooldown/dir retain their purpose.
- New presentation clipId distinguishes attack types, jump, landing, slide, dodge, guard, idle/run/death. Keep action presentationId rollback behavior.
- Asset manifest describes per-fighter sheets/grids and named clip frame ranges/pivots. Never assume every attack has the same row, frame count or pivot.

## Tasks

- [x] Generate and inspect six character atlases with visibly distinct movement silhouettes.
- [x] Add deterministic slide/dodge state, defense geometry and matching authority/prediction tests.
- [x] Route move-specific clips, render jump/landing and mobility sequences without snapshot restarts or foot/body scale jumps.
- [x] Verify actual browser poses/sequences for both fighters and representative controls, resource costs, reconnect/rematch, responsive layout and no shell shift. Run full tests/build, review and document controls.

## Verification completed

- Six transparent 1774 × 887 atlases use eight columns and four rows: 24 clips and 192 frames across the two fighters. Each move selects its own authored row. Per-frame contact pivots preserve character placement, and crouch holds the configured low sweep pose instead of its standing preparation frame.
- `npm test`: 300 tests passed, including slide vulnerability/resource rules, move routing, jump/landing playback, sprite placement, real asset ranges and existing delayed-delivery regressions. `npm run build` and `git diff --check` passed.
- Two real browser clients exercised all twelve clips for player one and heavy/jump/slide/dodge for player two. Rendered frame traces confirmed distinct sequences, stable contact positions and unchanged console shell geometry. The special meter was earned through actual hits.
- A 390 × 844 touch client verified low crouch, simultaneous down plus double-tap slide, and ordinary double-tap dodge. Screenshots confirmed the extended-leg slide and compact roll; overlays stayed within the host screen.
- Live reconnect checks preserved the seat, health and clock without evicting the current owner. An unrelated third player was rejected while the duel continued. A complete match and rematch reset combat state correctly.
- Independent code review found no important correctness issues in the animation, mobility or snapshot integration. Controls and resource rules are documented in `docs/fight-gameplay.md`.

No commit, merge, push or deployment is requested. Local development should remain available on port3000 after completion.
