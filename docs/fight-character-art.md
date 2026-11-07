# Fight character art

The active v4 sheets use one reference design per fighter throughout idle, running, combat, mobility, guard and defeat. Earlier originals and v2/v3 assets remain as source references; the runtime loads the eight matched sheets below.

| Fighter | Sheet | Layout | Asset |
| --- | --- | --- | --- |
| Samurai | Light/cross/finisher/heavy | 8×4,1774×887 | [Strikes](../public/games/fight/assets/moves-player1-strikes-v4.png) |
| Samurai | Sweep/launcher/aerial/special | 8×4,1774×887 | [Techniques](../public/games/fight/assets/moves-player1-techniques-v4.png) |
| Samurai | Jump/slide/dodge/guard | 8×4,1774×887 | [Mobility](../public/games/fight/assets/moves-player1-mobility-v4.png) |
| Samurai | Idle/run/defeat | 8×3,2048×768 | [Locomotion](../public/games/fight/assets/moves-player1-locomotion-v4.png) |
| Kenji | Light/cross/finisher/heavy | 8×4,1774×887 | [Strikes](../public/games/fight/assets/moves-player2-strikes-v4.png) |
| Kenji | Sweep/launcher/aerial/special | 8×4,1774×887 | [Techniques](../public/games/fight/assets/moves-player2-techniques-v4.png) |
| Kenji | Jump/slide/dodge/guard | 8×4,1774×887 | [Mobility](../public/games/fight/assets/moves-player2-mobility-v4.png) |
| Kenji | Idle/run/defeat | 8×3,2048×768 | [Locomotion](../public/games/fight/assets/moves-player2-locomotion-v4.png) |

There are 15 clips per fighter, eight frames per clip: 30 clips and 240 frames in total. `landing` uses the final jump frame and the generic `attack` alias uses the light clip. Unknown clip names retain that fighter's matched idle appearance.

## Design reference

Samurai keeps the burgundy/brown conical hat, red scarf, pale jacket with burgundy panels, dark brown hakama and violet-grey scabbard. Kenji keeps the red hair/head detail, blue tunic, navy trousers, grey shin wraps and blue scabbard. Each fighter keeps the same face, costume, pixel treatment and proportions across its sheets.

The original idle/run/attack sheets established the designs. Each accepted v4 strike atlas then served as the common reference for its techniques, mobility and locomotion sheets. The complete [generation prompts and reference inputs](art/fight-character-prompts.json) document the built-in image-generation workflow. Generated PNGs are copied into the game package and preserve their alpha channel.

## Registration and verification

`spriteAtlasManifest.js` declares per-sheet geometry, measured contact rows and body-size normalization. Neutral source poses exclude raised swords when measuring height. Samurai's neutral body height remains 208 world pixels and Kenji's remains 212. The existing actor origins and authoritative simulation coordinates are unchanged.

Run clips use a fixed floor pivot so tucked/airborne stride frames keep their authored motion. Other per-frame contact pivots align the corresponding pose with the actor. Child visual transforms own these corrections; they never modify physics or networking state.

The original eight-frame move identities remain distinct. Browser review checks every displayed sheet belongs to v4, compares all 30 clips at game scale, and exercises both fighters through real controls, specials, defeat and rematch. Asset/routing tests check PNG geometry, complete eight-frame clips, body scale and floor pivots. The previous collision and network regressions remain part of `npm test`.

[Character-state comparison](art/fight-character-preview.png)
