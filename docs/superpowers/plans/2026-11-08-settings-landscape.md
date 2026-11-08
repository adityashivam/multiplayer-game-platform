# Settings layout and landscape startup

The user requested repairs to the Config layout, consistent music alignment with the mute button at the right, and landscape startup for every game.

- [x] Reproduce the clipped controls and excessive preview frame in the browser.
- [x] Reflow settings beside the preview using the available console screen width; stack controls first on narrow screens.
- [x] Give the preview its natural aspect ratio and align audio across the same content width.
- [x] Put mute at the far right and verify desktop/phone layouts, persistence and editing.
- [x] Apply landscape startup centrally for all games. Touch devices in portrait wait before initial runtime loading/room joining. Native rotation is attempted where supported; an explicit fullscreen action and a rotate-device prompt cover browser restrictions.
- [x] Preserve the loaded runtime on later viewport changes, release platform-owned orientation on exit, and verify different games, shared links, unsupported/denied APIs, and asynchronous cleanup.
- [x] Run relevant browser checks, all Node tests, production build, and review.

Visual direction: existing dark platform surfaces, compact aligned rows, cyan primary actions and a clear secondary preview. No new game-specific settings UI or console geometry changes. The latest landscape request supersedes the earlier ban on platform-owned startup orientation; fullscreen remains an explicit player action.

## Verification

- All 608 Node tests and the production build pass.
- Config browser regression first reproduced the clipped expanded-play-area switch. The repaired layout passes at 2105×1170, 1440×900, 1024×768, 844×390, 390×844 and 320×568. It verifies preview aspect/fit, scroll reachability, stable shell bounds, and the far-right mute position in both On and Muted states.
- Touch-layout browser coverage passes persistence, cancel/save, orientation-specific drafts, four simultaneous pointers, two-/three-finger aiming and firing, live editing, expanded portrait, modal focus priority, return cleanup and existing-game permissions.
- Landscape browser coverage passes catalog and shared-link startup for Riftball and Pong, no early runtime/room creation, unsupported/denied rotation fallback, explicit fullscreen retry, pending automatic-request upgrade, actual viewport admission, later-rotation runtime continuity and orientation cleanup.
- Six orientation unit tests cover asynchronous ownership, synchronous rejection, coalescing, manual upgrade and late completion. Independent review findings were fixed and rechecked.

Desktop and emulated-phone screenshots were visually inspected. Native rotation capabilities were simulated for deterministic browser tests; physical-device rotation and deployed hosting were not tested. The local application is rebuilt and running.
