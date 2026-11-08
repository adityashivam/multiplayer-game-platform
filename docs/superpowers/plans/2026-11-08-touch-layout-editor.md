# Platform touch layouts and editor implementation plan

**Goal:** Give players reusable 2/3/4-finger touch presets and a clean visual editor, available from Config and during play, only when a developer allows customization.

**Architecture:** Games declare a validated, versioned touch-controls descriptor. The platform owns presets, input pointer ownership, settings persistence, a visual editor, and optional immersive presentation. Game adapters map generic control events into existing SDK input; gameplay and camera rules stay game-owned.

**Tech stack:** Existing JavaScript ES modules, React, Sass, localStorage, Pointer Events, Node tests. No new dependencies.

## Design

- Visual thesis: calm dark platform surfaces, cyan selection/actions, a large layout preview, and a compact inspector that gives the control canvas priority.
- Content plan: Config has Game controls and Audio; Game controls offers a searchable bounded game picker, allowed preset choices, a layout preview, presentation options, and Edit layout. An in-game Controls button opens the same editor over the live arena.
- Interaction thesis: drag controls with immediate position feedback; select one to reveal size/opacity controls; Save commits a draft and Cancel restores saved settings. Switching presets previews the change. Keep the game canvas mounted and rendering throughout.
- Settings show only games with `touchControls.customizable === true`. Runtime fixed touch descriptors remain possible for games that forbid editing. Locked individual controls remain visible and cannot be changed.
- Layouts are stored on this browser/device per game, orientation, and preset. Portrait/landscape use independent normalized positions. Saving reports success or session-only persistence if storage is unavailable. Reset selected and Reset layout affect the draft until Save.
- In-game editor explains “Match continues while editing”. It owns focus and blocks gameplay controls, clears held input, supports Escape cancellation, and restores focus. Results/invite/exit dialogs retain priority.
- Two-thumb fire supports hold-and-drag aiming. Three fingers move primary fire to the upper left. Four fingers also move secondary action to the upper right. Games choose their own supported controls; unsupported actions are never invented.
- Expanding the play area is an explicit player presentation option. It hides decorative console controls while in touch play, restores the library on return, and never requests browser fullscreen/orientation. Selecting or editing a layout alone does not silently resize the shell.

## Interfaces

### Shared descriptor and profiles

`public/platform/shared/touchControls.js` exports:

- `TOUCH_CONTROLS_API_VERSION = 1`;
- `TOUCH_PRESET_IDS = ["two-thumb", "three-finger", "four-finger"]`;
- `TOUCH_CONTROL_LIMITS` with size 44..160 px and opacity .25..1;
- `validateTouchControls(descriptor, gameId)`; undefined is valid; invalid metadata throws TypeError before registration;
- `createDefaultTouchProfile(descriptor)`;
- `sanitizeTouchProfile(descriptor, candidate)` (owned, bounded values and only declared control IDs);
- `resolveTouchLayout(descriptor, profile, orientation)`;
- `updateTouchControl(profile, controlId, patch)` returns an owned profile with current preset overrides updated.

Descriptor shape:

```js
{
  apiVersion: 1,
  customizable: true,
  defaultPreset: "two-thumb",
  allowedPresets: ["two-thumb", "three-finger", "four-finger"],
  controls: [
    { id: "move", type: "stick", role: "move", label: "Move", icon: "joystick" },
    { id: "look", type: "look", role: "look", label: "Look", editable: false },
    { id: "fire", type: "button", role: "primary", label: "Fire", icon: "my_location", behavior: "hold-look" },
  ],
}
```

Control roles are `move|look|primary|secondary|reload|jump|utility`. Types are `stick|look|button`; button behavior is `hold|press|hold-look` (default hold). IDs are unique bounded game-defined strings. At most 16 controls. `editable:false` locks customization; look area is always fixed. Optional `defaultLayout:{x,y,size,opacity}` overrides the platform role default. Layout fields use normalized center x/y, CSS pixel size, and opacity.

Profile shape:

```js
{
  version: 1,
  presetId: "two-thumb",
  mode: "auto", // auto | on | off
  hideShell: false,
  layouts: { "two-thumb": {}, "three-finger": {}, "four-finger": {} },
}
```

Each preset map contains only customized control IDs and partial `{x,y,size,opacity}` values. Defaults and user data are copied, never mutated. Resolve returns an array of `{...control,x,y,size,opacity}`. Individual locks and global developer opt-out always take precedence over saved overrides.

### Storage and input

`public/platform/frontend-engine/touchControlSettings.js` exports `loadTouchProfile(gameId,descriptor,orientation)`, `saveTouchProfile(gameId,descriptor,orientation,profile)` -> `{profile,persisted}`, and `subscribeTouchProfile(gameId,descriptor,orientation,listener)` -> unsubscribe. Profiles are per local browser/device, game and orientation. It handles malformed/quota/blocked storage and cross-tab updates without losing a usable session profile.

`public/platform/frontend-engine/touchControlSurface.js` exports:

- `subscribePlatformTouchInput(gameId,listener)` -> unsubscribe;
- `isPlatformTouchControlsActive(gameId)`;
- `bindTouchControlSurface({element,gameId,descriptor,layout,disabled})` -> `{reset,dispose}`.

Events contain `gameId` and one of `{type:"axis",controlId,x,y}`, `{type:"look",controlId,deltaX,deltaY}`, `{type:"action",controlId,active}`, `{type:"reset"}`. Events use the window/DOM boundary so separately bundled React and game modules share them. Pointer IDs own their controls independently. Look begins in the right-hand play area, ignores interactive UI, and is suppressed while a modal/editor has focus. Buttons with hold-look emit both action and relative look. Axes are circular/deadzoned. Release/cancel/blur/visibility/resize/disposal neutralize all owned inputs; four simultaneous pointers are supported. No game imports or namespace branches.

### React

`components/touch-controls/` exports:

- `TouchControlSurface({game,profile,orientation,enabled,disabled})`: runtime controls, low-overhead pointer bindings; `data-platform-touch-game`/`data-active` mark active surface.
- `TouchLayoutPreview({game,profile,orientation})`: passive preview.
- `TouchLayoutEditor({game,profile,orientation,inGame,onSave,onCancel})`: accessible draft editor using shared focus behavior. It stays below higher-priority platform dialogs and never remounts the game canvas.

Root owns Config UI, paged game picker, profile hook, App/GameView/toolbar/shell integration, Dead Shift descriptor/input mapping, and integration/browser QA. UI agent owns only the touch-controls component folder. SDK agent owns only shared/engine touch modules, catalog/registry validation and filtering, tests, and SDK docs.

### Catalog

Advertise optional `touchControls` in public game metadata. Add bounded `customizable=true` catalog filtering, including browser fallback catalog, so Config never downloads every game. Filter global metadata before pagination. Existing catalog behavior remains unchanged without the filter.

## Tasks

- [x] Implement descriptor/profile validation, presets, persistence, generic pointer input and focused regression tests.
- [x] Build reusable preview, runtime controls, and the visual editor with drag, keyboard adjustments, size/opacity, reset, Save/Cancel and focus handling.
- [x] Add a bounded searchable game picker and controls settings in Config; integrate in-game Controls access and explicit expanded play area.
- [x] Declare Dead Shift controls and map platform events to movement/look/fire/reload/jump/weapon; add optional game-owned aiming zoom without changing authoritative combat/network input shapes.
- [x] Verify permissions, persistence, orientation changes, multi-pointer ownership, modal resets, renderer continuity, existing games, responsive layout and actual input in browser; run npm test and npm run build, then independent review.

## Review focus

No customization for opted-out/locked games or controls; no unbounded catalog fetch; pointer release never cancels another finger's fire; no live input while dragging editor controls; draft rollback; migration of saved layouts when developer controls change; blocked storage feedback; correct local persistence scope; orientation clamping and safe targets; no overlays covering platform navigation; no game renderer remount or implicit fullscreen; no game-specific SDK branches.

## Verification and decisions

- Node regression suite: 431 tests passed; production build passed. Independent review's two important findings were fixed and covered: portrait expanded sizing, and touch resets clearing another device's held input. Follow-up review found no remaining Important/Critical issue.
- `npm run test:touch-controls:browser` uses isolated Chrome profiles to verify Config, filtered game selection, drag, sliders, Save/Cancel, reload persistence, rapid preference changes, 2/3/4-finger movement/aim/fire, live canvas continuity, rotation during editing, expanded portrait sizing, dialog focus priority, cleanup, and an existing non-opted-in Pong runtime.
- Actual expanded portrait host measured 390×844 at a 390×844 viewport. Three/four-finger fire and simultaneous thumb movement/look reached authoritative state; two-thumb fire dragging aimed and fired together.
- Editor targets keep the opening orientation through rotation and save to that orientation. This preserves the draft instead of silently switching the profile being edited. Portrait and landscape settings are visibly labeled and saved independently.
- Config actions apply small patches against the latest profile; quick successive changes preserve the selected preset. Editor Save commits a complete owned draft.
- No host geometry changes while editing. Expanded play area applies only after an explicit preference choice; in-game grid animation is disabled so the renderer avoids intermediate resize steps. Browser fullscreen/orientation remain under player control.
- Same-device saves are local to this browser, with bounded session fallback when persistent storage is unavailable. Physical devices and deployed-service testing remain outside the local browser emulation coverage.
- No deployment, push, merge or new commit was performed for this UI work. Dead Shift opts in through metadata; other games keep their existing controls until their developers opt in.
