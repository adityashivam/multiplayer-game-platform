# Invite Modal Style Alignment

Align the game-independent invite dialog with the current platform: dark blue/charcoal surfaces, Space Grotesk headings, Manrope body text, subtle rounded borders, cyan primary action, and readable spacing. Keep it inside the existing game screen so the console shell stays stable.

The existing modal uses pixel fonts and large unconnected social buttons. Make the working room link/copy flow primary and keep close/back actions clear. Do not add external messaging integrations. Isolate styles from match-results and exit-confirmation dialogs so those flows are unaffected.

- [x] Confirm the existing typography and oversizing in the browser.
- [x] Implement a focused invite component and scoped styles, preserving copy/close behavior and visible feedback.
- [x] Associate the link label, contain keyboard focus while open, support Escape, and restore prior focus on close.
- [x] Verify copy/failure feedback, close/reopen, desktop, portrait, small phones, short landscape, and a different game. Run existing tests, production build, and whitespace checks.

No new dependencies, game-specific UI conditions, gameplay/server changes, commits, or deployment.

Verification completed:

- Browser checks passed at 1440×900, 1920×1080, 390×844, 320×568, and 844×390 across Fight, Pong, and Mario Touch. The dialog and its buttons stay inside the available screen without horizontal overflow.
- Copy payload and success feedback, clipboard-denied manual-copy feedback, URL selection, close/reopen, Tab wrapping, Escape, and focus restoration passed. Clipboard writes were stubbed during these checks.
- Review identified that clicking a shell control could move focus outside the open dialog. A browser regression reproduced that failure; document-level focus containment now passes the same check and cleans up on close.
- `npm test`: 211 passed, 0 failed. `npm run build` and `git diff --check` passed.
- The invite dialog uses its own styles; exit and match-result dialogs retain their existing styles. Inactive social-share placeholders were removed, leaving the working room-link flow.
