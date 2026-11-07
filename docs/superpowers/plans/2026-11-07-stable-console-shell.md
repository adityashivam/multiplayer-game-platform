# Stable Console Shell Fix

The user requires the virtual console shell to retain its size and position when moving between the library and a game. Preserve the current responsive frame and user-selected portrait deck state. Only screen content changes during navigation. Fullscreen remains an explicit user action.

## Findings

- The library conditionally adds `platformConsoleLibrary` (1640×820 maximum), while games revert to the older 1400×700 frame. This moves the bezel and controllers on launch.
- The App requests fullscreen/landscape both from the launch callback and again after metadata resolves. This can move the viewport even if shell dimensions are unified.
- The route transition translates/scales the content container. Use opacity only so navigation does not visually move the screen surface.
- The touch platformer also requests fullscreen/orientation itself. Its renderer must stay inside the platform's available game surface and leave outer presentation to the platform.

## Work

- [x] Reproduce with frame-by-frame browser geometry measurements and presentation request counters before code changes.
- [x] Make the accepted library frame the shared console geometry, remove automatic fullscreen/rotation during navigation, and keep the explicit fullscreen button.
- [x] Keep touch renderer sizing relative to its host surface without altering the outer console or global viewport.
- [x] Verify stable frame/screen/controller nodes and rectangles across games, portrait, short landscape, collapsed controls, return-home, and shared links. Verify explicit fullscreen still works.
- [x] Run the existing tests, production build, and whitespace checks, then request a focused read-only review.

## Constraints

Keep the JavaScript/React/Sass architecture and existing uncommitted work. No game-specific branches in the platform, no gameplay/network changes, no new dependencies, and no commit or deployment.

## Verification

- Before correction: desktop Pong changed the outer frame from 1640×820 to 1400×700; the largest measured geometry delta was 240 px. Launch requested fullscreen and orientation twice; portrait touch launch requested each three times. Console/screen DOM nodes were already persistent, confirming CSS geometry and presentation calls as the causes.
- After correction: frame-by-frame checks measured **0 px** change in console, screen, controller panes, portrait deck, A button, and D-pad bounds across eight launch cases: Fight, Pong, Mario Touch, WebGL sample; 1920×1080 and 1440×900 desktop, 390×844 portrait, collapsed portrait controls, and 844×390 landscape. Existing shell nodes persisted, with zero automatic fullscreen/orientation requests.
- Return-home checks passed for desktop, portrait touch, and collapsed controls. The touch renderer's transformed bounds stay inside its game host. Delayed metadata on shared Pong and Mario Touch links also produced 0 px shell movement.
- The native Full Screen control entered and exited fullscreen successfully after an explicit user click. It makes one fullscreen request and no orientation-lock request.
- Focused read-only review found no actionable issues. `npm test`: **211/211 passing**. `npm run build` and `git diff --check` pass. No runtime exceptions in the launch, return/fullscreen, or shared-link checks.
- Local browser evidence: `/tmp/kaboom-shell-green.log`, `/tmp/kaboom-shell-flow.log`, `/tmp/kaboom-shell-shared.log`. Changes remain uncommitted; the existing local server continues on port 3000.
