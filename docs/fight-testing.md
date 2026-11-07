# Fight combat review and local verification

Reviewed on 2026-11-07 on `codex/fight-combat-upgrade`. Changes remain local and uncommitted.

## Confirmed issues corrected

| Issue | Correction |
| --- | --- |
| Wall clamping discarded part of body separation. Walking contact converged to 111.67px instead of 120px; dodge/slide compressed it further. | The configurable platform separation controller transfers blocked displacement to the free body and settles corner contact in one step. |
| The predicted local fighter could overlap a delayed opponent despite valid server spacing. | Fight applies visual contact after render interpolation, using raw simulation coordinates before artwork offsets. |
| Jump/launcher crossings could move a rendered fighter 191–240px across sides. | Contact playback retains side/correction history, releases correction over elapsed time, and uses the same opponent reference as local prediction when choosing a landing side. Exact-X ties match the simulation's deterministic order. |
| Direction changes could flip a dodge/slide within its animation. A fresh back dodge after crossing could travel toward the opponent. | Mobility refreshes facing at startup, then preserves it throughout the move. |
| The original jump rose 517px and carried the fighter out of the canvas. | The adjusted arc rises about 219px while preserving jump/landing phases and jump-over gameplay. |

Visual history resets on room lifecycle changes, visibility changes, input ownership changes and long rendering gaps. Game contact presentation stays within Fight; the platform controller remains configurable and independent of game identities.

## Automated verification

`npm test`: **332 passed, zero failed**. `npm run build` and `git diff --check` passed.

- `tests/fight-contact.test.js`: both walls, walking/dodge/slide pressure, exact-X landings, jump headroom, crossing/back-dodge facing, and mixed combat invariants. The seeded soak completed **64/64 duels** and checked **1,418 impacts**, including health/resource bounds and one impact per swing.
- `tests/fight-render-contact.test.js`: both player orders, immutable poses/snapshots, contact release, prediction-versus-artwork landing order, exact-X corner ties, reset/visibility-resume equivalents, new ownership epochs, and equivalent release at 30/60/120Hz.
- `tests/fight-contact-netcode.test.js`: real prediction, interpolation and authoritative input sessions at 100/200/300ms RTT during late jump crossings.
- `tests/fight-combat-contact-netcode.test.js`: two independently predicted views during actual light/heavy/launcher combat at 300ms RTT, with and without jitter.
- Existing combat, snapshot, reconnect, catalog and platform contract regressions remain green. Custom field mappings exercise the generic separation controller independently of Fight.

Run all checks with:

```sh
npm test
npm run build
```

## Browser verification

Isolated Chrome clients used real keyboard and touch input against the local server. A TCP proxy delayed WebSocket delivery by 150ms each way with up to 30ms additional jitter; the connection display measured roughly 300ms RTT.

| Scenario | Result |
| --- | --- |
| Center contact and pressure at both walls | Both views maintained 120px body spacing, within floating-point tolerance. No invalid health/resource/position states. |
| Slide/dodge into a cornered opponent | Spacing and bounds remained valid; moves expired normally. |
| Forward and late descending jump crossings | No body penetration or large synthetic side flips in the final run. |
| Heavy strike into established guard | Server emitted a block outcome. |
| Complete alternating light/heavy/launcher duel | Correct victory at zero health; both views stayed separated. Largest recorded horizontal frame movement was 71.41 world pixels, including ordinary movement/contact/hit corrections. |
| Challenge Opponent / rematch | Both fighters reset to 500 health with cleared attack, mobility and special state. |
| 390×844 touch viewport | Actual low crouch, simultaneous down/double-tap slide, ordinary double-tap dodge, and bounded overlays passed. |
| Frozen close-contact attack frames | Inspected heavy, sweep and slide silhouettes; body placement and feet remained aligned. Weapon/limb intersection during a strike is intentional. |
| Jump apex | Fighter remains inside the stage instead of disappearing above the canvas. |

An exact-X landing at an arena wall can move the stationary fighter 120px to resolve genuine physical penetration. That is the authoritative collision rule, distinct from the corrected synthetic 191–240px network side flips. The regression checks preserve this deterministic resolution.

This verifies local correctness under the covered network conditions. The deployed service and hosting capacity were not changed or benchmarked.

## Character consistency follow-up — 2026-11-08

The matched v4 family includes idle, running and defeat, so changing state no longer switches to independently styled artwork. All eight atlases use measured body scale and contact registration; generic attack/landing aliases retain the same fighter design.

`npm test` passed 333 tests. A fresh two-browser fight exercised both fighters' attacks, specials, jump, slide, dodge and guard, then defeat and rematch. Every observed sprite used v4; no legacy character textures were requested and no near-ground body penetration was recorded. All30 clips were inspected in a [comparison at game scale](art/fight-character-preview.png). The guard cleanup was checked separately in the final mobility sequence. Full prompts, image paths and registration details are in [the character art notes](fight-character-art.md).
