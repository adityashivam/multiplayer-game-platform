# Consistent Platform UX Implementation Plan

**Goal:** Apply the established library and invite-dialog design to all active platform controls and dialogs, including controls shown over games.

**Architecture:** Share platform design tokens and a focused accessible dialog component. Keep runtime surfaces and shell geometry unchanged. Connection and performance values remain driven by existing game-independent bridges.

**Tech stack:** Existing React, JavaScript with JSDoc, and SCSS modules. No dependencies or game/server changes.

## Design

- Visual thesis: calm charcoal and dark blue surfaces, subtle rounded borders, Space Grotesk headings, Manrope controls, and cyan for the primary action or active state.
- Content plan: compact connection status and fullscreen/network controls; an on-demand readable diagnostics inspector; consistent invite, exit, and result dialogs; matching audio settings and error states.
- Interaction thesis: short opacity entrances and color feedback; visible keyboard focus; reduced-motion support. Opening platform UI must not resize or remount the game surface or console shell.
- Use a shared dialog and tokens instead of copying styling into each game or adding a broad component framework. Game-owned scores, timers, art, and controls keep their visual language.

## Constraints and review focus

- Preserve fullscreen, diagnostics shortcuts, clipboard, exit, rematch, and audio behavior.
- Keep diagnostics bounded within the game host, including 320px portrait and short landscape screens.
- Multiple open platform dialogs must give focus and Escape handling only to the top dialog, with restoration when it closes.
- Preserve hidden network UI for games that opt out, unavailable metric placeholders, and actual telemetry values.
- Keep changes local and uncommitted; preserve existing uncommitted UI work.

## Tasks

- [x] Capture the old fullscreen/exit appearance and reproduce a failing browser assertion for the requested typography.
- [x] Add platform tokens and a shared `PlatformDialog` with focus containment. Reuse it in invite, exit, and results while preserving callbacks and accessible names.
- [x] Restyle the connection indicator, fullscreen/network toolbar, diagnostics, and runtime errors without changing runtime geometry or metric collection.
- [x] Align active settings styles and document the platform-wide design boundary in `AGENTS.md`.
- [x] Verify dialog priority, keyboard/clipboard/exit/rematch/fullscreen/audio interactions, desktop/mobile layouts, network states, and stable shell geometry. Run `npm test`, `npm run build`, and `git diff --check`, then review the complete task diff.

## Execution record

Implementation proceeds in the existing working branch because it contains the UI that the user is testing. The requested design is already established by the library, invite dialog, and screenshots; no new design approval is needed.

Exit confirmation takes priority over results and invites; results take priority over invites. Render one platform modal at a time so competing dialogs cannot trap focus against each other. The shared focus hook also releases listeners and restores focus on unmount.

The platform handles its diagnostics shortcut during capture so a legacy game handler cannot swallow it. Platform shortcuts stay inactive while a modal is open. Dialog key presses stay within the dialog while retaining native button activation; releases for keys held before opening still reach the game to avoid stuck input.

## Verification

- The initial typography browser assertion failed on `Press Start 2P` and now passes with Manrope and rounded controls.
- Desktop and mobile browser checks passed at 1920×1080, 1440×900, 390×844, 320×568, and 844×390, across Fight, Pong, and Mario Touch. All 24 diagnostic readings remain available in a bounded scrollable panel. Exit and settings controls remain within their screens.
- Verified copy success/failure feedback, Tab containment, Escape cancellation, focus restoration, diagnostics shortcuts and close, explicit native fullscreen enter/exit, exit to library, disabled/enabled rematch callbacks, and mute state.
- Verified connected, connecting, reconnecting, and offline labels; supplied telemetry values and unavailable placeholders; hidden network UX for the WebGL single-player game; long result content on a small phone; and unavailable-game error recovery.
- Eight frame-traced launch cases retained the same shell/screen nodes with a maximum shift of 0px. Return navigation and explicit fullscreen passed. No launch requested fullscreen or device orientation changes.
- Read-only review identified game keyboard listeners interfering with dialog activation. Complete trusted Enter/Space events reproduced the failure, and the shared boundary now passes in Draw and Mario. A separate regression proves that a movement key held before opening a modal still releases.
- `npm test`: 211 passed, 0 failed. `npm run build` and `git diff --check` passed after the keyboard correction. Browser checks reported no runtime exceptions.

No gameplay files, server behavior, protocol changes, dependencies, commits, or deployment were added by this task. All pre-existing uncommitted changes were preserved.
