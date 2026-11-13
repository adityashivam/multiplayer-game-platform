# Fight arcade combat

Fight is a 90-second sword duel for two players. Health does not regenerate. Damage, defense, meters and the winner are authoritative on the server; the local client predicts movement/actions and renders independently.

Open localhost:3100, launch Fight, and share the room link with a second browser/device. Refresh tabs that were open before the combat upgrade so client and server use the same rules.

## Controls

| Action | Console / touch | Keyboard |
| --- | --- | --- |
| Move | Left / right | Arrows or A / D |
| Jump | Up | Up, W or Space |
| Crouch | Down | Down or S |
| Light combo | Tap A, then tap again near recovery | J or Z |
| Heavy cleave | X | K or X |
| Low sweep | Down + X | Crouch + heavy |
| Rising cut / air slash | Y; light/heavy also becomes air slash in the air | U or Y |
| Guard / parry | Hold B; time the start of guard to parry | Hold L or C |
| Dodge roll | Double-tap left or right | Double-tap direction or Shift |
| Ground slide | Down + double-tap direction | Crouch + Shift |
| Backward dodge | Hold B + double-tap direction | Guard + Shift |
| Moon breaker special | Hold B and press Y with full special meter | I or V with full special meter |

A light chain has three strikes: quick slash, cross cut and finisher. Early presses have a short input buffer; holding attack does not automatically chain. Heavy and special attacks have longer windups and punishable recovery. Hits require the opponent to be in front, close enough and at a compatible height.

Guard absorbs most damage but consumes the guard meter. A precisely timed frontal guard parries and briefly staggers the attacker. Exhausting guard creates a punish window. A dodge costs 20 guard and protects only its opening frames. A ground slide costs 25 guard, stays low and passes under horizontal light cuts; sweeps, heavy strikes, launchers, aerial attacks and specials can still hit it. Crouch + dash in the air remains a dodge. Guard recovers while resting; special meter is earned through combat and is spent by the special attack. Recent chained hits scale damage to limit long strings.

The platform owns fullscreen, network diagnostics and dialogs. Diagnostics remains available through its button or N. Fight owns the face buttons, HUD, combat effects and sounds.

## Animation assets and timing

Each fighter uses four matched transparent atlases: `moves-playerN-strikes-v4.png`, `moves-playerN-techniques-v4.png`, `moves-playerN-mobility-v4.png`, and `moves-playerN-locomotion-v4.png`. The first three contain four rows of eight frames (1774×887); locomotion contains three rows of eight frames (2048×768). Across both fighters, that is 30 authored clips and 240 frames, including idle, running and defeat alongside the twelve combat/mobility clips. The runtime loads this matched family; older images remain source references.

Each fighter's sheets share a canonical character reference, costume and pixel treatment. `spriteAtlasManifest.js` declares each sheet, clip range, body scale and measured contact rows. `spritePresentation.js` applies these transforms to child visuals; actor simulation positions stay independent. Run clips retain a fixed floor pivot so airborne stride poses are not dragged downward. Jump has ascent, apex, descent and landing poses. Crouch holds a low preparation frame instead of compressing an idle sprite. See [the art reference, assets and prompts](fight-character-art.md).

The jump arc stays within the stage headroom. Dodge and slide keep their starting facing throughout the move. A new backward dodge uses the opponent's current position, including immediately after a jump crossover.

Rendering supports displays up to 120 Hz; it does not change the 60 Hz simulation. The actual display rate depends on device/browser. Animation uses authored startup, active and recovery timing, with local predicted presentation and stable action identities between network packets. Hit effects and sounds use authoritative events; reduced-motion mode disables camera shake.

## Tuning and verification

Combat tuning and deterministic rules live in `public/games/fight/shared/simulation.js`. The server adapter resolves both strikes from one combat phase so player slots do not decide trades. Combat event snapshots have 16 stable slots; ID zero denotes unused entries, which presentation ignores. This prevents delayed effects when the packed snapshot schema is reused.

Tests cover hit windows and geometry, combos, guard/parry/break, resources, dash, prediction under latency/bursts, crossed attacks, event delivery, animation identity and feet alignment. Reconnect tests protect player identity, bounded retry, clock/health continuity and stale disconnects. A genuine third player is still refused when both seats are occupied.

Body contact maintains 120 world pixels of horizontal spacing when vertical clearance is below 100 pixels. The shared separation controller transfers wall-blocked push to the free fighter, including same-X landings and mobility into corners. Weapon trails and extended limbs can intersect during intentional attacks; they do not determine the body collision geometry.

`renderContact.js` handles the visual boundary after prediction and interpolation are combined. It preserves contact order, releases visual corrections over elapsed time, and uses the same opponent reference as local collision prediction before landing. These adjustments never change server combat state. Room resets, visibility changes, ownership epochs and long rendering gaps discard stale visual history.

The contact regressions include a seeded 64-duel simulation, delayed jump crossings at 100/200/300ms RTT, and two independently predicted views of mixed launcher exchanges with jitter. Local browser checks exercise actual keyboard/touch inputs, both walls, body contact, jump crossings, defense, a complete duel and rematch. See [the combat review and testing notes](fight-testing.md) for the verified cases and limits.
