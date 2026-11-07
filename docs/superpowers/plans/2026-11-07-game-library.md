# Game Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make games inviting to discover and launch inside the existing virtual console.

**Architecture:** The server publishes optional game-owned presentation metadata. Generic UI components derive accurate library details, render a selected-game showcase, and provide a compact cover shelf. Reuse local SVG artwork and existing launch/controller flows.

**Tech Stack:** JavaScript ES modules, React, Sass modules, Express, Node test runner, isolated Chrome for browser verification. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-07-game-library-design.md`

## Global Constraints

- Keep platform components independent of game identities.
- Preserve networking/gameplay, game routes, settings, and the handheld shell.
- Use optional `presentation: { coverUrl, accentColor, controls }`; supported controls are `keyboard`, `touch`, and `pointer`.
- Show accurate capabilities; remove fabricated activity values and dummy games.
- Support reduced motion, keyboard, touch, portrait, and short landscape.
- Work in the current clean feature checkout; leave changes reviewable and uncommitted.

## Review Focus

- A game with no artwork or a failed image request still has a readable, usable preview and launch action.
- Filtering to no results removes stale preview/launch state; clearing the filter restores selection.
- Arbitrary game identities and three-player rooms work without UI edits.
- Keyboard focus remains on search/filter/Play during ordinary pointer selection and asynchronous catalog loading.
- Small viewports and increased card size allow all games and Play to remain reachable.

### Task 1: Optional game presentation contract

**Files:** `public/platform/shared/gamePresentation.js`, `public/platform/src/platform-ui/services/gamePresentation.js`, `server/platform-backend-engine/core/gameRegistry.js`, `server/platform-backend-server/server.js`, `tests/game-presentation.test.js`, `tests/game-registry.test.js`.

**Interfaces:** Registration accepts optional presentation metadata; `readGameLibraryDetails(game)` produces cover URL, accent, genre, player, and control labels without game-specific lookups.

- [x] Add failing tests for malformed presentation metadata, a synthetic three-player game, absent capabilities, and safe defaults.
- [x] Implement focused validation and display derivation, add public catalog delivery, and verify the tests pass.

### Task 2: Game-owned covers and catalog data

**Files:** `public/games/*/catalog.js`, `public/games/*/assets/cover.svg`, `public/platform/src/data/games.js`, `server/platform-backend-engine/games/metadata.js`, `public/platform/src/platform-ui/hooks/useGameCatalog.js`, `docs/game-sdk.md`.

**Interfaces:** Each bundled package exports its presentation object for both catalogs. Existing fallback runtimes and routes remain intact.

- [x] Add small local landscape illustrations for the seven bundled games and accurate control metadata.
- [x] Reuse package presentation in server and fallback metadata, remove `visualsByGame` and temporary dummy games, document the contract.
- [x] Verify all published cover paths exist and the built-in registry accepts the metadata.

### Task 3: Selected-game showcase and compact library

**Files:** `GameShowcase.jsx`, `GameArtwork.jsx`, `GameCard.jsx`, `LobbyList.jsx`, `LobbyHeader.jsx`, focused `GameLibrary.module.scss` under `components/platform-screen/`; `PlatformApp.jsx`, existing shell Sass.

**Interfaces:** Keep existing `LobbyList` selection/launch/zoom/ref props. Showcase launches the currently selected game's existing path. Cards select; existing console actions still launch.

- [x] Build responsive showcase, artwork fallback, compact shelf, useful capabilities, accessible selection, and clear Play.
- [x] Keep search/filter/zoom; remove inert view switches. Update selection scrolling for the horizontal shelf and avoid stealing focus from controls.
- [x] Apply library-only shell sizing, readable navigation labels, and reduced-motion rules.
- [x] Build and check desktop, portrait, and short landscape in a real browser, including missing art, empty filter, keyboard, game launch, and settings.

### Task 4: Review and completion

- [x] Run `npm test`, `npm run build`, and `git diff --check`; inspect output.
- [x] Request a fresh focused code review, address material findings, and recheck affected behavior.
- [x] Record results here and leave implementation uncommitted for user review.

## Progress

- Design direction accepted by the user's implementation request. Implementation proceeds in the existing clean feature checkout so the running local app can be reviewed directly.

- Implemented optional presentation validation and display derivation, seven game-owned covers, generic showcase/shelf, accurate capabilities, retained search/filter/zoom/settings, and library-only shell sizing. Removed obsolete library Sass, dummy games, fabricated stats, and inert view switches. No new dependencies.
- Node regressions: validation and presentation tests failed before implementation and passed afterward. Final full suite: **197/197 passing** (`npm test`); production build passes (`npm run build`); `git diff --check` passes.
- Isolated browser checks passed at 1920×1080, 1440×900, 1024×768, 390×844, 320×568, and 844×390. Every bundled game retains a reachable Play action at maximum card size. Real touch selection, keyboard shelf navigation/scrolling, search, filtering, zoom, settings, game launch, and console D-pad/A launch passed without runtime exceptions.
- A synthetic three-player catalog entry with a failing image URL retained its fallback, title, player label, and Play action. Reduced motion disabled preview animations. An empty server catalog rendered an empty state instead of fabricated fallback games.
- Fresh code review found a pending focus request after no-op boundary navigation, capacity precedence, and non-string control coercion. Each was reproduced before correction. Added failing Node regressions for the metadata cases; the browser boundary-Home → search case failed before correction and passes afterward. Full suite and browser checks passed after the fixes. No review findings remain deferred.
- Local server restarted with updated catalog metadata on port 3000. Changes remain uncommitted and have not been deployed.
