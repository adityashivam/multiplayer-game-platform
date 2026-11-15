# Platform themes

Players choose a theme in **Settings → Theme**. Themes change how the
platform looks: colours, glass, corners, fonts, icon pack, card shape,
background and the style of the portrait disc library. They never change its
layout or behaviour.

A theme JSON file is the single source of truth for a look. The built-in
themes are JSON files in the same format players import and export, and the
platform's CSS fallbacks are generated from the default theme's file.

Players can:

- Pick one of seven built-in themes: Kaboom (the default), Ember, Aurora,
  Violet Hour, 8-Bit (a retro pixel console), Classic Disc (a shiny CD) and
  Graphite.
- Open **Customize** to change the accent and base colour, heading, body and
  mono fonts, icon style, weight and fill, card shape, disc style, corners,
  glass, and the background (game art, ambient, pattern or their own image,
  with dim and blur). Edits save as "My theme".
- Import a theme from a JSON file or pasted text, export the current theme to
  share it, and remove themes they imported.

Themes are stored in this browser only (up to 12 imported themes, about
3.5 MB in total). Nothing is uploaded.

Where things live:

- Built-in themes: `public/platform/src/data/themes/<id>.kaboom-theme.json`.
- Format, validation and the CSS variables a theme sets:
  `public/platform/src/platform-ui/services/platformThemes.js`.
- Generated CSS fallbacks: `styles/_theme-defaults.generated.scss`, written by
  `npm run platform:theme-defaults` (run automatically by `npm run platform:build`)
  from the default theme's JSON. `tests/platform-theme-defaults.test.js` fails if
  the committed file drifts, or if `global.scss` repeats a theme token by hand.
- The Settings card is `ThemeSettings.jsx`; `usePlatformTheme.js` applies the
  selected theme when the app starts and loads the fonts it needs.

## Format (version 2)

```json
{
  "format": "kaboom-theme",
  "version": 2,
  "id": "sea-glass",
  "name": "Sea Glass",
  "author": "Your name",
  "colors": {
    "accent": "#5fd3e8",
    "accentText": "#06222a",
    "background": "#080c0e",
    "surface": "#0e1619",
    "text": "#eff6f8",
    "textMuted": "#9fb3ba",
    "chassis": "#161d20"
  },
  "glass": 0.65,
  "radius": 1.1,
  "fonts": { "heading": "outfit", "body": "inter" },
  "icons": { "style": "rounded", "fill": false, "weight": 400, "nav": { "solo": "sports_esports" } },
  "cards": { "shape": "tall" },
  "background": { "style": "pattern", "pattern": "dots", "dim": 0.2, "blur": 0 },
  "disc": { "style": "cinematic" }
}
```

`fonts`, `icons`, `cards`, `background` and `disc` are optional; missing ones use the
defaults shown in the tables. Version 1 files (colours, glass and radius only)
still import and are upgraded to version 2. Exports are always version 2.

### Colours, glass and corners

| Field | Rule | What it changes |
|-------|------|-----------------|
| `format`, `version` | `"kaboom-theme"` and `1` or `2` | Identifies the file |
| `id` | lower-case letters, numbers and dashes, up to 40; not a built-in id | Importing the same id again replaces that theme |
| `name`, `author` | text, up to 40 characters (`author` optional) | Shown on the theme tile |
| `colors.accent` | `#rrggbb` | Primary buttons, switches, selection and active tabs |
| `colors.accentText` | `#rrggbb`, contrast ≥ 4.5 against `accent` | Text on primary buttons |
| `colors.background` | `#rrggbb`, dark (relative luminance ≤ 0.05) | The screen behind every page |
| `colors.surface` | `#rrggbb` | Tint of the frosted glass panels, menus and dialogs |
| `colors.text` | `#rrggbb`, contrast ≥ 7 against `background` | Headings and main text |
| `colors.textMuted` | `#rrggbb`, contrast ≥ 3.5 against `background` | Secondary text and labels |
| `colors.chassis` | `#rrggbb` | The console shell around the screen |
| `glass` | number from 0.3 to 0.95 | How opaque the glass surfaces are |
| `radius` | number from 0 to 1.5 | Corner rounding (1 is the default; below 0.25 pill-shaped controls turn square too) |

### Fonts

| Field | Allowed values (default) |
|-------|--------------------------|
| `fonts.heading` | `space-grotesk` (default), `manrope`, `inter`, `outfit`, `sora`, `rajdhani`, `oxanium`, `chakra-petch`, `exo-2`, `orbitron`, and the pixel fonts `press-start-2p` and `vt323` |
| `fonts.body` | the same list (default `manrope`) |
| `fonts.mono` | `system-mono` (default: the device's own monospace, loads nothing), `jetbrains-mono`, `ibm-plex-mono`, `vt323` |

The heading and body lists also include the serif faces `fraunces` and
`playfair-display`, used by editorial themes. The mono font labels technical
looks such as the Instrument disc.

Fonts load from Google Fonts using URLs the platform builds from this list.
A theme can't name any other font or URL.

Pixel fonts draw their glyphs much larger than other fonts at the same size.
When a theme uses one, the platform normalises every text size by x-height
(`font-size-adjust: 0.5`) and turns off synthetic bold, so titles stay inside
their space and pixels stay crisp.

### Icon pack

| Field | Allowed values (default) |
|-------|--------------------------|
| `icons.style` | `outlined` (default), `rounded`, `sharp` (the Material Symbols families) |
| `icons.fill` | `true` or `false` (default `false`) |
| `icons.weight` | `200`, `300`, `400` (default), `500`, `600` |
| `icons.nav` | optional icons for the dock: keys `solo`, `multi`, `friends`, `profile`, `config`; values are Material Symbols names such as `"sports_esports"` (lower-case letters, digits, `_`) |

### Cards

| Field | Allowed values (default) |
|-------|--------------------------|
| `cards.shape` | `portrait` 3:4 (default), `tall` 2:3, `square` 1:1, `landscape` 4:3 |

Very short screens still use a compact card crop so the library fits.

### Disc style

The portrait library's disc (names on a turning disc beside the selected
game's art) has four presets. Each is a coherent combination of disc surface,
name treatment, selection marker, art and Play button; the theme's colours,
fonts and corners still apply on top.

| `disc.style` | Look |
|--------------|------|
| `cinematic` (default) | No plate; upright names fade along the curve, a thin bar marks the selection, the art bleeds to the edge and fades under the title, Play is a solid light button |
| `editorial` | A single hairline arc, numbered upright small caps, a short rule marks the selection, a quiet frame for the art, Play as a text link with an arrow |
| `instrument` | A machined dial with two rings and an engraved index, mono labels and a counter, spec rows (genre, players, input), an outlined accent Play |
| `classic` | A polished silver CD: data-track grooves, a rainbow reflection that sweeps as it turns, a bright rim, names printed in dark ink around the disc, and cover art in a clear jewel case |
| `glass` | The original frosted disc with a soft sheen and names tilted along the rim |

### Background

| Field | Rule (default) |
|-------|----------------|
| `background.style` | `game-art` (default: the focused game's art), `ambient` (a glow in the accent), `pattern`, or `image` |
| `background.pattern` | `grid` (default), `dots`, `lines`, `diagonal`; used by `pattern` |
| `background.image` | required for `image`: an embedded PNG, JPEG or WebP `data:` URL of at most 700,000 characters (about 500 KB) |
| `background.dim` | number from 0 to 0.9 (default 0): darkens the background |
| `background.blur` | number from 0 to 24 (default 0): blur in pixels |

Background images must be embedded. Links to images are rejected, so a
shared theme can't load anything from the internet or track who uses it.
**Customize → Background → Image** prepares a picture for you. It resizes the
picture on your device to at most 1600 px and re-encodes it as WebP, which
also drops metadata such as location.

Every field except `author` and the four optional sections is required. Theme
files are limited to 800 KB.

## What themes can't do

Themes are data, not CSS. Each value is checked against the rules above and
applied as a CSS custom property or a component prop. A theme can't add
styles or selectors, load anything from a URL, hide or move controls, or
change layout, motion or game art. Unknown fields are rejected. Version 2
supports dark themes only, because game art and its shading are made for dark
surfaces.

Import errors name the field to fix, for example
`colors.text needs more contrast against the background.` or
`background.image must be an embedded PNG, JPEG or WebP (a data: URL); links aren't allowed.`

## Adding or changing a built-in theme

1. Add or edit `public/platform/src/data/themes/<id>.kaboom-theme.json`. Built-ins
   are stored in full, normalised form (every section present), exactly as
   **Export** writes them, so the easiest start is exporting a theme from
   Settings.
2. For a new theme, import it in `platformThemes.js` and add it to the
   `BUILT_IN_PLATFORM_THEMES` list. Every built-in goes through the same
   validation as an imported theme; an invalid file stops the app at load.
3. If you changed the default theme (the first in the list), run
   `npm run platform:theme-defaults` to regenerate the CSS fallbacks.

`tests/platform-theme-defaults.test.js` checks that every JSON file is a
listed built-in, that each is valid and stored in full, and that the
generated CSS matches the default theme.
