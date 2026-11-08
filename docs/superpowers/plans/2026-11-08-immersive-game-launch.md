# Expanded landscape game launches

The requested default is a full-canvas game view with the outer console hidden, browser fullscreen on a landscape Play gesture where supported, and readable translucent touch controls. Keep the library console, game runtime/canvas identity, room ownership and game rules intact. Players retain per-game control editing and can explicitly choose a console view again.

Visual direction: the game is the dominant surface; white/cyan circular controls rest at about 40% opacity and brighten on press. Keep Home, Invite, Controls and Fullscreen in the compact platform toolbar. Existing feedback/fades are sufficient; do not animate or remount game geometry during presentation changes.

## Implementation

1. Add descriptor-driven platform button/direction bindings so existing games can use the touch surface through their existing `getGameControls` subscriptions. Use a window event boundary across separate bundles, bounded source ownership, release/reset cleanup, closed supported bindings and no game identity branches in the SDK. Supply appropriate layouts for Fight, Pong, Mario variants, Road Rash, Draw and WebGL Drift; preserve the custom 3D adapters.
2. Default new profiles to expanded presentation and low-opacity controls. Migrate version-1 saved profiles to the new defaults while retaining positions, sizes and preset choice; current-version explicit player preferences remain respected. Keep descriptor API version 1 and stable storage keys separate from the profile version.
3. Decouple shell expansion from whether a touch device is detected. All games start expanded by default, including desktop and single-player games. Touch overlays remain automatic on touch devices, with the existing visibility/editor options available. Restore the console on return to the library.
4. Request native fullscreen synchronously during landscape library activation. Direct shared links use the full-window fallback and the labeled Fullscreen action because browsers require user activation. Handle denial/unsupported APIs, pending requests, Escape and return navigation without reloading the runtime or repeatedly forcing fullscreen.
5. Update the SDK guide and repository presentation policy to describe the newly authorized launch behavior. Verify Node contracts, build, real browser fullscreen, all catalog touch controls, simultaneous movement/actions, layout editing, portrait rotation, cancellation and library restoration.

## Review focus

- Separate React/game bundles must share virtual controls without hidden DOM button clicks.
- Disposing/replacing a touch surface must release only its own input sources.
- Browser denial or late fullscreen completion must not strand the library in fullscreen.
- Saved positions and sizes must survive migration; explicit new preferences must persist.
- Drawing must retain unobstructed canvas gestures, while FPS controls allow movement, aim and fire together.

## Verification

Run focused regressions before implementation and after each change, then `npm test` and `npm run build`. Exercise actual browser Play gestures and shared URLs, touch emulation in landscape/portrait, multiple pointers and return navigation. No commit, push or deployment is part of this request.

Completed verification:

- `npm test`: 767 passed, zero failures.
- `npm run build`: passed.
- `npm run test:presentation:browser`: all ten bundled games passed; native fullscreen, denied-request fallback, shared-link entry, control opacity, multiplayer movement/actions, saved-profile migration and library restoration verified. A focused WebGL Drift run also verified its touch Play action.
- `npm run test:touch-controls:browser`: saved positions, sizes and opacity; cancel/reload; two-, three- and four-finger movement/aim/fire; live editing; rotation; modal priority and canvas continuity passed.
- `npm run test:orientation:browser`: portrait loading/room gates, restricted rotation/fullscreen, pending request cleanup and runtime continuity passed.
- Independent code review found no important issues. Runtime stacking isolation was additionally checked against an oversized game HUD layer, preserving access to platform Home controls.

Native fullscreen remains browser-dependent and requires a player gesture. Shared URLs use the expanded viewport and retain the labeled Fullscreen control. Verification used isolated local Chrome sessions; these changes have not been deployed.
