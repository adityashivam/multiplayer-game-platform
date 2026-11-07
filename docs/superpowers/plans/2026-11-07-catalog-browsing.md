# Scalable Game Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the library useful for a 10,000-game catalog without fetching or rendering it all in the browser.

**Architecture:** A generic catalog query service indexes registered metadata once and returns bounded pages. The browser queries the service with debounced search, global genre filters, and title sorting. A vertical grid is the primary workspace on the left, with a full-height artwork panel on the right in landscape. Portrait uses a full-width grid and opens selected-game details in a native modal. Individual metadata lookup keeps shared game links independent of pagination.

**Tech Stack:** Existing JavaScript ES modules, React, Sass, Express, Node test runner, isolated Chrome. No new dependencies.

**Spec:** User's latest feedback supersedes the horizontal-shelf direction in `../specs/2026-11-07-game-library-design.md`: a single row is unsuitable for 10,000 games. Keep the accepted artwork, console shell, accurate metadata, and generic PaaS boundaries.

## Global Constraints

- Return and render 24 games per page by default; cap API page size at 60.
- Keep legacy unparameterized `/api/games` compatible with existing diagnostics. The UI always requests a bounded page.
- Provide direct `/api/games/:gameId` metadata lookup for games outside the visible page.
- Preserve game launch/shared links, settings, search focus, touch, keyboard, and virtual console controls.
- Server and offline fallback use the same genre normalization, query rules, and title ordering.
- Keep game IDs/assets out of generic catalog and UI logic; do not add a database or deployment changes.
- Retain the existing uncommitted work and leave this revision uncommitted.

## Review Focus

- Late search responses cannot replace newer results; aborted requests cannot activate fallback games.
- Page/search/filter changes reset selection and scrolling without stealing search focus.
- Shared links resolve games outside page one without loading a fallback runtime first.
- An empty or failed catalog has an honest empty/error state; stale games cannot launch during loading.
- A 10,000-game fixture produces bounded payloads and DOM counts, usable pagination, and global search/genres.

### Task 1: Catalog query and HTTP contracts

**Files:** `public/platform/shared/gameCatalog.js`, `server/platform-backend-server/gameCatalogRoutes.js`, `server/platform-backend-server/server.js`, `tests/game-catalog.test.js`, `tests/game-catalog-routes.test.js`.

**Interfaces:** `createGameCatalog(games).query({page,pageSize,q,genre,sort})` returns `{games,total,page,pageSize,totalPages,genres}`. `parseGameCatalogQuery(query)` validates bounded HTTP query parameters. `registerGameCatalogRoutes(app, registry)` provides legacy list, paged list, and detail lookup.

- [x] Write and run failing tests with 10,000 entries, cross-page/global search, genre facets, stable sorting, page bounds, invalid parameters, ownership, legacy list, and direct detail lookup.
- [x] Implement the pure indexed query service and focused HTTP handlers; verify the tests pass.

### Task 2: Bounded browser data and independent game lookup

**Files:** `services/gameCatalogClient.js`, `hooks/useGameCatalog.js`, `hooks/useCatalogGame.js`, `PlatformApp.jsx`.

**Interfaces:** Catalog requests carry query/page/sort and abort stale requests. Game lookup fetches one game's metadata independently of catalog loading. The bounded fallback queries existing bundled metadata only after an actual request failure.

- [x] Implement debounced, abortable catalog loading with global genre options and stable query result ownership.
- [x] Resolve active game metadata independently, reusing a currently visible matching entry and handling 404/network failure appropriately.
- [x] Update the App's query/page/sort/selection wiring and two-dimensional keyboard/controller navigation.

### Task 3: Grid, compact preview, and verification

**Files:** `LobbyList.jsx`, `GameCard.jsx`, `GameShowcase.jsx`, `CatalogPagination.jsx`, `GameLibrary.module.scss`, `docs/game-sdk.md`, `AGENTS.md`.

- [x] Replace the horizontal shelf with a vertical responsive grid, full-height landscape artwork panel, portrait details dialog, result count, title sort, previous/next controls, and direct page navigation.
- [x] Preserve optional artwork fallbacks and focus/reduced-motion behavior. Document bounded catalog conventions.
- [x] Verify desktop and mobile, maximum card size, search/filter/sort/page changes, keyboard/controller movement, real touch, normal game launch, shared links, delayed request races, and a 10,000-game fixture.
- [x] Run `npm test`, `npm run build`, and `git diff --check`; request one focused read-only review and address material findings.

## Progress

- Continuing the approved UI implementation with the user's large-catalog correction. Current changes and local assets are preserved.

- Incorporated the user's in-flight layout corrections: right-hand artwork spans the content height in landscape; portrait has no squeezed preview strip. Native details contain focus and support back/Escape. Both thumbnails and preview foregrounds fit the whole image; only a decorative blurred background fills unused aspect-ratio space.
- Fixed small-portrait controller deck sizing so the A button remains reachable at 320×568. Stopped hover/entrance scaling from cropping foreground art.
- Fresh review identified retained active metadata after returning home, which could initialize a reopened runtime twice after a catalog refetch. Clearing the lookup on return fixes it. Browser launch → home → refetch → reopen now loads exactly one new Pong runtime. Narrow review of the new dialog, artwork fitting, and lookup correction found no additional issues.
- Browser verification passed at 1920×1080, 1440×900, 1024×768, 844×390, 390×844, and 320×568. Checks include maximum zoom, control geometry, foreground image fitting, portrait touch/details/back/Escape, keyboard grid navigation, search focus, empty results, filters, sorting, page jumps, settings, normal launch, and a shared link independent of the visible catalog.
- A 10,000-game fixture kept all catalog responses and the card DOM bounded to 24 entries. Verified 417 pages, global search finding game 9999, global genre totals, stale-request cancellation, and top-of-page scroll reset. The fixture stays outside production data.
- An initial browser run exposed an existing audio-fade timing exception: a frame timestamp could precede fade scheduling and produce a negative media volume. Clamped fade progress to [0,1]; a deterministic earlier-frame browser check now passes. No runtime exceptions in the final browser run.
- Final verification: **211/211 tests pass**, production build passes, and `git diff --check` passes. Local server remains running on port 3000. No commit or deployment was performed.
