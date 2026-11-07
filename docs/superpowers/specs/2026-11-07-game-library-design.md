# Game library redesign

Historical initial direction. The large-catalog and responsive-layout revision is recorded in [the catalog browsing plan](../plans/2026-11-07-catalog-browsing.md), which supersedes the horizontal shelf described below.

The user approved implementation of the proposed selected-game showcase inside the existing virtual console. Keep the React, Sass, Express, and versioned game registration architecture.

## Experience

- Make the selected game the main visual: landscape artwork, readable title, a short description, accurate capabilities, and a prominent Play button.
- Put a compact, horizontally scrollable game library below the showcase. Selecting a cover updates the showcase; Play or the console's existing action buttons launches it.
- Keep search, genre filtering, card resizing, controller navigation, settings, and game routes working. Remove nonfunctional layout toggles and temporary dummy catalog entries.
- Replace unrelated portraits, raw sprite sheets, and missing covers with small, local SVG illustrations appropriate to each game's mechanics. These are cover illustrations, not advertised gameplay screenshots.
- Remove fabricated activity statistics and promotional badges. Do not invent live player counts, matchmaking, achievements, or control support.
- Use the existing dark console and cyan action accent, more readable typography, and restrained entrance/selection motion. Respect reduced motion.
- Give the library more desktop screen space without changing the game screen's geometry. Support portrait and short landscape layouts, keyboard focus, touch targets, and scrolling.

## Platform contract

Games optionally supply `presentation: { coverUrl, accentColor, controls }` in registration metadata. Supported controls are `keyboard`, `touch`, and `pointer`. All fields are optional; missing art uses a generic platform fallback. Derive player capacity from room slots or existing catalog tags. UI components must not import or branch on concrete games. Bundled game presentation belongs to each game's package and is reused by the server catalog and offline fallback catalog.

Document this optional contract and validate supplied presentation metadata before registration. The public catalog must deliver it. No networking/gameplay behavior or hosting changes.

## Approach

The accepted direction is a selected-game showcase with a compact library below it. A cosmetic refresh of the old equal-weight grid would leave the hierarchy unresolved; a full shell replacement would exceed the proposed scope. Use code-native SVG illustrations so the simple arcade mechanics remain recognizable, local, and inexpensive to load.

## Verification

Test optional metadata validation, arbitrary game identities/player capacities, safe fallback presentation, and capability labels. Build the production UI and run the existing suite. Use an isolated browser to inspect desktop, mobile portrait, and short landscape; exercise selection, search, filter, resizing, keyboard/controller activation, game launch, and settings. Check missing art and reduced motion.
