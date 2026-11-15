/**
 * Platform themes: a validated JSON format mapped onto the design tokens in
 * global.scss. Themes change how the platform looks (colours, glass, corners,
 * fonts, icon pack, card shape and background) but never its layout.
 *
 * Themes are data only. Every value is checked against a typed schema or a
 * fixed allowlist and applied through CSS custom properties or React props,
 * never as raw CSS, so an imported file cannot inject styles, hide controls
 * or load anything from a URL. Fonts come from a fixed list; a background
 * image must be embedded as a raster data URL.
 */

import kaboomTheme from "../../data/themes/kaboom.kaboom-theme.json" with { type: "json" };
import emberTheme from "../../data/themes/ember.kaboom-theme.json" with { type: "json" };
import auroraTheme from "../../data/themes/aurora.kaboom-theme.json" with { type: "json" };
import violetHourTheme from "../../data/themes/violet-hour.kaboom-theme.json" with { type: "json" };
import eightBitTheme from "../../data/themes/eight-bit.kaboom-theme.json" with { type: "json" };
import graphiteTheme from "../../data/themes/graphite.kaboom-theme.json" with { type: "json" };
import classicDiscTheme from "../../data/themes/classic-disc.kaboom-theme.json" with { type: "json" };

/** @typedef {{accent:string,accentText:string,background:string,surface:string,text:string,textMuted:string,chassis:string}} PlatformThemeColors */
/** @typedef {{heading:string,body:string,mono:string}} PlatformThemeFonts */
/** @typedef {{style:"glass"|"editorial"|"cinematic"|"instrument"|"classic"}} PlatformThemeDisc */
/** @typedef {"solo"|"multi"|"friends"|"profile"|"config"} PlatformNavIconKey */
/** @typedef {{style:"outlined"|"rounded"|"sharp",fill:boolean,weight:number,nav:Partial<Record<PlatformNavIconKey,string>>}} PlatformThemeIcons */
/** @typedef {{shape:"portrait"|"tall"|"square"|"landscape"}} PlatformThemeCards */
/** @typedef {{style:"game-art"|"ambient"|"pattern"|"image",pattern:"grid"|"dots"|"lines"|"diagonal",image?:string,dim:number,blur:number}} PlatformThemeBackground */
/**
 * A validated theme; every section is present after validation.
 * @typedef {object} PlatformTheme
 * @property {"kaboom-theme"} format
 * @property {2} version
 * @property {string} id
 * @property {string} name
 * @property {string} [author]
 * @property {PlatformThemeColors} colors
 * @property {number} glass Opacity of the mid glass surface, 0.3–0.95.
 * @property {number} radius Corner-radius scale, 0 (square) to 1.5.
 * @property {PlatformThemeFonts} fonts
 * @property {PlatformThemeIcons} icons
 * @property {PlatformThemeCards} cards
 * @property {PlatformThemeBackground} background
 * @property {PlatformThemeDisc} disc
 */
/** @typedef {{ok:true,theme:PlatformTheme}|{ok:false,error:string}} PlatformThemeParseResult */

export const PLATFORM_THEME_FORMAT = "kaboom-theme";
export const PLATFORM_THEME_VERSION = 2;
const SUPPORTED_VERSIONS = new Set([1, 2]);
export const DEFAULT_PLATFORM_THEME_ID = "kaboom";
export const CUSTOM_PLATFORM_THEME_ID = "my-theme";
const STORAGE_KEY = "platform.themes.v1";

/** Bounds a file, an embedded image, and what a device keeps. */
export const PLATFORM_THEME_LIMITS = Object.freeze({
  maxBytes: 800 * 1024,
  maxImageChars: 700_000,
  maxStoredChars: 3_500_000,
  maxImported: 12,
  maxNameLength: 40,
});

/**
 * Fonts a theme may use. Each is served by Google Fonts; the URL is built
 * from this list, never from theme data.
 */
export const PLATFORM_THEME_FONTS = Object.freeze({
  "space-grotesk": { label: "Space Grotesk", family: "Space Grotesk", fallback: "sans-serif" },
  manrope: { label: "Manrope", family: "Manrope", fallback: "sans-serif" },
  inter: { label: "Inter", family: "Inter", fallback: "sans-serif" },
  outfit: { label: "Outfit", family: "Outfit", fallback: "sans-serif" },
  sora: { label: "Sora", family: "Sora", fallback: "sans-serif" },
  rajdhani: { label: "Rajdhani", family: "Rajdhani", fallback: "sans-serif" },
  oxanium: { label: "Oxanium", family: "Oxanium", fallback: "sans-serif" },
  "chakra-petch": { label: "Chakra Petch", family: "Chakra Petch", fallback: "sans-serif" },
  "exo-2": { label: "Exo 2", family: "Exo 2", fallback: "sans-serif" },
  orbitron: { label: "Orbitron", family: "Orbitron", fallback: "sans-serif" },
  // Pixel fonts. Their glyphs are drawn far larger than other fonts at the
  // same size, so themes using them normalise sizes by x-height.
  "press-start-2p": { label: "Press Start 2P", family: "Press Start 2P", fallback: "monospace", pixel: true },
  vt323: { label: "VT323", family: "VT323", fallback: "monospace", pixel: true },
  // Serif display faces for editorial themes.
  fraunces: { label: "Fraunces", family: "Fraunces", fallback: "serif" },
  "playfair-display": { label: "Playfair Display", family: "Playfair Display", fallback: "serif" },
});

/**
 * Monospace fonts for labels in technical looks (the Instrument disc).
 * `system-mono` uses the device's own monospace and loads nothing.
 */
export const PLATFORM_THEME_MONO_FONTS = Object.freeze({
  "system-mono": { label: "System mono", family: null, stack: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
  "jetbrains-mono": { label: "JetBrains Mono", family: "JetBrains Mono", stack: "\"JetBrains Mono\", ui-monospace, monospace" },
  "ibm-plex-mono": { label: "IBM Plex Mono", family: "IBM Plex Mono", stack: "\"IBM Plex Mono\", ui-monospace, monospace" },
  vt323: { label: "VT323", family: "VT323", stack: "\"VT323\", ui-monospace, monospace" },
});

/**
 * How the portrait disc library looks. Each style is a coherent preset of
 * disc surface, name treatment, selection marker, art and Play button;
 * the theme's colours, fonts and corners still apply on top.
 */
export const PLATFORM_THEME_DISC_STYLES = Object.freeze({
  cinematic: "Cinematic",
  editorial: "Editorial",
  instrument: "Instrument",
  classic: "Classic disc",
  glass: "Glass",
});

/** Fonts index.html already loads; themes don't fetch them again. */
const PRELOADED_FONT_IDS = new Set(["space-grotesk", "manrope", "press-start-2p", "vt323"]);
/** Builds a Google Fonts stylesheet URL for an allowlisted family. */
function readGoogleFontUrl(family) {
  return `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@400;500;600;700&display=swap`;
}
/** x-height ratio pixel themes normalise every font to. */
const PIXEL_FONT_SIZE_ADJUST = "0.5";

/** Icon packs: the three Material Symbols families. */
export const PLATFORM_THEME_ICON_STYLES = Object.freeze({
  outlined: { label: "Outlined", family: "Material Symbols Outlined" },
  rounded: { label: "Rounded", family: "Material Symbols Rounded" },
  sharp: { label: "Sharp", family: "Material Symbols Sharp" },
});
export const PLATFORM_THEME_ICON_WEIGHTS = Object.freeze([200, 300, 400, 500, 600]);
const NAV_ICON_KEYS = /** @type {const} */ (["solo", "multi", "friends", "profile", "config"]);

export const PLATFORM_THEME_CARD_SHAPES = Object.freeze({
  portrait: { label: "Portrait", aspect: "3 / 4" },
  tall: { label: "Tall", aspect: "2 / 3" },
  square: { label: "Square", aspect: "1 / 1" },
  landscape: { label: "Landscape", aspect: "4 / 3" },
});

export const PLATFORM_THEME_BACKGROUND_STYLES = Object.freeze({
  "game-art": "Game art",
  ambient: "Ambient",
  pattern: "Pattern",
  image: "Image",
});
export const PLATFORM_THEME_PATTERNS = Object.freeze({ grid: "Grid", dots: "Dots", lines: "Lines", diagonal: "Diagonal" });

const COLOR_KEYS = /** @type {const} */ (["accent", "accentText", "background", "surface", "text", "textMuted", "chassis"]);
const TOP_LEVEL_KEYS = new Set(["format", "version", "id", "name", "author", "colors", "glass", "radius", "fonts", "icons", "cards", "background", "disc"]);
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const THEME_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const ICON_GLYPH = /^[a-z0-9_]{1,40}$/;
/** Raster images only, base64 alphabet only: nothing can close url("…"). */
const IMAGE_DATA_URL = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;
/** WCAG-style minimum contrast ratios that keep every theme readable. */
const MIN_CONTRAST = Object.freeze({ text: 7, textMuted: 3.5, accentText: 4.5 });
/** Dark themes only: game art and shading are authored for dark surfaces. */
const MAX_BACKGROUND_LUMINANCE = 0.05;

const DEFAULT_SECTIONS = Object.freeze({
  fonts: Object.freeze({ heading: "space-grotesk", body: "manrope", mono: "system-mono" }),
  icons: Object.freeze({ style: "outlined", fill: false, weight: 400, nav: Object.freeze({}) }),
  cards: Object.freeze({ shape: "portrait" }),
  background: Object.freeze({ style: "game-art", pattern: "grid", dim: 0, blur: 0 }),
  disc: Object.freeze({ style: "cinematic" }),
});

/**
 * Built-in themes, loaded from their JSON files: the same format players
 * import and export, so a theme file is the single source of a look. Each
 * goes through the same validation as an imported theme; a broken built-in
 * stops the app at load rather than rendering half a theme. The first is the
 * platform default, and the CSS fallbacks in styles/_theme-defaults.generated.scss
 * are generated from it (npm run platform:theme-defaults).
 * @type {readonly PlatformTheme[]}
 */
export const BUILT_IN_PLATFORM_THEMES = Object.freeze([
  kaboomTheme,
  emberTheme,
  auroraTheme,
  violetHourTheme,
  eightBitTheme,
  classicDiscTheme,
  graphiteTheme,
].map((source) => {
  const result = validatePlatformTheme(source);
  if (!result.ok) throw new Error(`Built-in theme "${source?.id}" is invalid: ${result.error}`);
  return Object.freeze(result.theme);
}));

/** @param {string} hex @returns {[number,number,number]} */
function readRgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** @param {[number,number,number]} rgb @returns {string} */
function writeHex(rgb) {
  return `#${rgb.map((channel) => Math.round(Math.min(255, Math.max(0, channel))).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Blend two colours; `amount` is the share of `toward`.
 * @param {string} base @param {string} toward @param {number} amount @returns {string}
 */
export function mixHexColors(base, toward, amount) {
  const from = readRgb(base);
  const to = readRgb(toward);
  return writeHex([0, 1, 2].map((index) => from[index] + (to[index] - from[index]) * amount));
}

/** @param {string} hex @returns {number} WCAG relative luminance, 0–1. */
export function readRelativeLuminance(hex) {
  const [red, green, blue] = readRgb(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** @param {string} first @param {string} second @returns {number} WCAG contrast ratio, 1–21. */
export function readContrastRatio(first, second) {
  const [lighter, darker] = [readRelativeLuminance(first), readRelativeLuminance(second)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Text colour for a button of the given accent: a deep tint of the accent
 * when it reads well, otherwise black or white, whichever reads better (one
 * of those always clears 4.5:1).
 * @param {string} accent @returns {string}
 */
export function readAccentTextColor(accent) {
  const tinted = mixHexColors(accent, "#000000", 0.86);
  if (readContrastRatio(tinted, accent) >= 4.5) return tinted;
  return readContrastRatio("#000000", accent) >= readContrastRatio("#ffffff", accent) ? "#000000" : "#ffffff";
}

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Strip control characters and trim, so names render as plain text. */
function cleanThemeText(value, maxLength) {
  return String(value).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maxLength);
}

/** @param {Record<string,unknown>} section @param {readonly string[]} allowed @param {string} path */
function findUnknownKey(section, allowed, path) {
  const unknown = Object.keys(section).find((key) => !allowed.includes(key));
  return unknown ? `Unknown setting "${path}.${unknown}".` : null;
}

/** @param {unknown} value @param {number} min @param {number} max */
function isNumberInRange(value, min, max) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

/** @returns {{ok:true,value:PlatformThemeFonts}|{ok:false,error:string}} */
function validateFonts(fonts) {
  if (fonts === undefined) return { ok: true, value: { ...DEFAULT_SECTIONS.fonts } };
  if (!isPlainObject(fonts)) return { ok: false, error: `"fonts" must be an object.` };
  const unknown = findUnknownKey(fonts, ["heading", "body", "mono"], "fonts");
  if (unknown) return { ok: false, error: unknown };
  const value = { ...DEFAULT_SECTIONS.fonts, ...fonts };
  for (const key of ["heading", "body"]) {
    if (!Object.hasOwn(PLATFORM_THEME_FONTS, value[key])) return { ok: false, error: `fonts.${key} must be one of: ${Object.keys(PLATFORM_THEME_FONTS).join(", ")}.` };
  }
  if (!Object.hasOwn(PLATFORM_THEME_MONO_FONTS, value.mono)) return { ok: false, error: `fonts.mono must be one of: ${Object.keys(PLATFORM_THEME_MONO_FONTS).join(", ")}.` };
  return { ok: true, value: { heading: value.heading, body: value.body, mono: value.mono } };
}

/** @returns {{ok:true,value:PlatformThemeIcons}|{ok:false,error:string}} */
function validateIcons(icons) {
  if (icons === undefined) return { ok: true, value: { ...DEFAULT_SECTIONS.icons, nav: {} } };
  if (!isPlainObject(icons)) return { ok: false, error: `"icons" must be an object.` };
  const unknown = findUnknownKey(icons, ["style", "fill", "weight", "nav"], "icons");
  if (unknown) return { ok: false, error: unknown };
  const value = { ...DEFAULT_SECTIONS.icons, ...icons };
  if (!Object.hasOwn(PLATFORM_THEME_ICON_STYLES, value.style)) return { ok: false, error: `icons.style must be outlined, rounded or sharp.` };
  if (typeof value.fill !== "boolean") return { ok: false, error: `icons.fill must be true or false.` };
  if (!PLATFORM_THEME_ICON_WEIGHTS.includes(value.weight)) return { ok: false, error: `icons.weight must be one of ${PLATFORM_THEME_ICON_WEIGHTS.join(", ")}.` };
  const nav = value.nav ?? {};
  if (!isPlainObject(nav)) return { ok: false, error: `icons.nav must be an object.` };
  const unknownNav = findUnknownKey(nav, NAV_ICON_KEYS, "icons.nav");
  if (unknownNav) return { ok: false, error: unknownNav };
  for (const [key, glyph] of Object.entries(nav)) {
    if (typeof glyph !== "string" || !ICON_GLYPH.test(glyph)) return { ok: false, error: `icons.nav.${key} must be a Material Symbols icon name like "sports_esports".` };
  }
  return { ok: true, value: { style: value.style, fill: value.fill, weight: value.weight, nav: { ...nav } } };
}

/** @returns {{ok:true,value:PlatformThemeCards}|{ok:false,error:string}} */
function validateCards(cards) {
  if (cards === undefined) return { ok: true, value: { ...DEFAULT_SECTIONS.cards } };
  if (!isPlainObject(cards)) return { ok: false, error: `"cards" must be an object.` };
  const unknown = findUnknownKey(cards, ["shape"], "cards");
  if (unknown) return { ok: false, error: unknown };
  const shape = cards.shape ?? DEFAULT_SECTIONS.cards.shape;
  if (!Object.hasOwn(PLATFORM_THEME_CARD_SHAPES, shape)) return { ok: false, error: `cards.shape must be one of: ${Object.keys(PLATFORM_THEME_CARD_SHAPES).join(", ")}.` };
  return { ok: true, value: { shape } };
}

/** @returns {{ok:true,value:PlatformThemeBackground}|{ok:false,error:string}} */
function validateBackground(background) {
  if (background === undefined) return { ok: true, value: { ...DEFAULT_SECTIONS.background } };
  if (!isPlainObject(background)) return { ok: false, error: `"background" must be an object.` };
  const unknown = findUnknownKey(background, ["style", "pattern", "image", "dim", "blur"], "background");
  if (unknown) return { ok: false, error: unknown };
  const value = { ...DEFAULT_SECTIONS.background, ...background };
  if (!Object.hasOwn(PLATFORM_THEME_BACKGROUND_STYLES, value.style)) return { ok: false, error: `background.style must be one of: ${Object.keys(PLATFORM_THEME_BACKGROUND_STYLES).join(", ")}.` };
  if (!Object.hasOwn(PLATFORM_THEME_PATTERNS, value.pattern)) return { ok: false, error: `background.pattern must be one of: ${Object.keys(PLATFORM_THEME_PATTERNS).join(", ")}.` };
  if (!isNumberInRange(value.dim, 0, 0.9)) return { ok: false, error: `background.dim must be a number from 0 to 0.9.` };
  if (!isNumberInRange(value.blur, 0, 24)) return { ok: false, error: `background.blur must be a number from 0 to 24.` };
  if (value.image !== undefined) {
    if (typeof value.image !== "string" || !IMAGE_DATA_URL.test(value.image)) return { ok: false, error: `background.image must be an embedded PNG, JPEG or WebP (a data: URL); links aren't allowed.` };
    if (value.image.length > PLATFORM_THEME_LIMITS.maxImageChars) return { ok: false, error: `background.image is too large; use an image under about 500 KB.` };
  }
  if (value.style === "image" && !value.image) return { ok: false, error: `background.style "image" needs background.image.` };
  return { ok: true, value: { style: value.style, pattern: value.pattern, dim: value.dim, blur: value.blur, ...(value.image ? { image: value.image } : {}) } };
}

/** @returns {{ok:true,value:PlatformThemeDisc}|{ok:false,error:string}} */
function validateDisc(disc) {
  if (disc === undefined) return { ok: true, value: { ...DEFAULT_SECTIONS.disc } };
  if (!isPlainObject(disc)) return { ok: false, error: `"disc" must be an object.` };
  const unknown = findUnknownKey(disc, ["style"], "disc");
  if (unknown) return { ok: false, error: unknown };
  const style = disc.style ?? DEFAULT_SECTIONS.disc.style;
  if (!Object.hasOwn(PLATFORM_THEME_DISC_STYLES, style)) return { ok: false, error: `disc.style must be one of: ${Object.keys(PLATFORM_THEME_DISC_STYLES).join(", ")}.` };
  return { ok: true, value: { style } };
}

/**
 * Validate an untrusted theme object (format version 1 or 2). Every key and
 * value is checked; the first problem is reported in words a theme author can
 * act on. The result is always a complete version 2 theme.
 * @param {unknown} candidate
 * @returns {PlatformThemeParseResult}
 */
export function validatePlatformTheme(candidate) {
  if (!isPlainObject(candidate)) return { ok: false, error: "A theme must be a JSON object." };
  if (candidate.format !== PLATFORM_THEME_FORMAT) return { ok: false, error: `"format" must be "${PLATFORM_THEME_FORMAT}".` };
  if (!SUPPORTED_VERSIONS.has(/** @type {number} */ (candidate.version))) return { ok: false, error: `"version" must be 1 or 2.` };
  const unknownKey = Object.keys(candidate).find((key) => !TOP_LEVEL_KEYS.has(key));
  if (unknownKey) return { ok: false, error: `Unknown setting "${unknownKey}".` };
  if (typeof candidate.id !== "string" || !THEME_ID.test(candidate.id)) return { ok: false, error: `"id" must be lower-case letters, numbers and dashes (up to 40).` };
  if (typeof candidate.name !== "string" || !cleanThemeText(candidate.name, PLATFORM_THEME_LIMITS.maxNameLength)) return { ok: false, error: `"name" must be a short piece of text.` };
  if (candidate.author !== undefined && typeof candidate.author !== "string") return { ok: false, error: `"author" must be text.` };

  if (!isPlainObject(candidate.colors)) return { ok: false, error: `"colors" must be an object.` };
  const unknownColor = Object.keys(candidate.colors).find((key) => !COLOR_KEYS.includes(/** @type {any} */ (key)));
  if (unknownColor) return { ok: false, error: `Unknown colour "${unknownColor}".` };
  for (const key of COLOR_KEYS) {
    const value = candidate.colors[key];
    if (typeof value !== "string" || !HEX_COLOR.test(value)) return { ok: false, error: `colors.${key} must be a hex colour like #1a2b3c.` };
  }
  if (!isNumberInRange(candidate.glass, 0.3, 0.95)) return { ok: false, error: `"glass" must be a number from 0.3 to 0.95.` };
  if (!isNumberInRange(candidate.radius, 0, 1.5)) return { ok: false, error: `"radius" must be a number from 0 to 1.5.` };

  const colors = /** @type {PlatformThemeColors} */ (Object.fromEntries(COLOR_KEYS.map((key) => [key, String(candidate.colors[key]).toLowerCase()])));
  if (readRelativeLuminance(colors.background) > MAX_BACKGROUND_LUMINANCE) return { ok: false, error: "colors.background must be dark; light themes aren't supported yet." };
  if (readContrastRatio(colors.text, colors.background) < MIN_CONTRAST.text) return { ok: false, error: "colors.text needs more contrast against the background." };
  if (readContrastRatio(colors.textMuted, colors.background) < MIN_CONTRAST.textMuted) return { ok: false, error: "colors.textMuted needs more contrast against the background." };
  if (readContrastRatio(colors.accentText, colors.accent) < MIN_CONTRAST.accentText) return { ok: false, error: "colors.accentText needs more contrast against the accent." };

  const fonts = validateFonts(candidate.fonts);
  if (!fonts.ok) return fonts;
  const icons = validateIcons(candidate.icons);
  if (!icons.ok) return icons;
  const cards = validateCards(candidate.cards);
  if (!cards.ok) return cards;
  const background = validateBackground(candidate.background);
  if (!background.ok) return background;
  const disc = validateDisc(candidate.disc);
  if (!disc.ok) return disc;

  return {
    ok: true,
    theme: {
      format: PLATFORM_THEME_FORMAT,
      version: PLATFORM_THEME_VERSION,
      id: candidate.id,
      name: cleanThemeText(candidate.name, PLATFORM_THEME_LIMITS.maxNameLength),
      ...(candidate.author ? { author: cleanThemeText(candidate.author, PLATFORM_THEME_LIMITS.maxNameLength) } : {}),
      colors,
      glass: Number(candidate.glass),
      radius: Number(candidate.radius),
      fonts: fonts.value,
      icons: icons.value,
      cards: cards.value,
      background: background.value,
      disc: disc.value,
    },
  };
}

/**
 * Parse an imported theme file or pasted text.
 * @param {string} text
 * @returns {PlatformThemeParseResult}
 */
export function parsePlatformTheme(text) {
  if (typeof text !== "string" || !text.trim()) return { ok: false, error: "The theme file is empty." };
  if (text.length > PLATFORM_THEME_LIMITS.maxBytes) return { ok: false, error: "The theme file is too large (800 KB maximum)." };
  try {
    return validatePlatformTheme(JSON.parse(text));
  } catch {
    return { ok: false, error: "The theme isn't valid JSON." };
  }
}

/** @param {string} fontId @returns {string} A CSS font-family list from the allowlist. */
function readFontStack(fontId) {
  const font = PLATFORM_THEME_FONTS[fontId] ?? PLATFORM_THEME_FONTS[DEFAULT_SECTIONS.fonts.body];
  return `"${font.family}", ${font.fallback}`;
}

/**
 * The CSS custom properties a theme sets. Values are validated hex colours,
 * numbers, lengths, aspect ratios or font names from the allowlist only.
 * @param {PlatformTheme} theme
 * @returns {Record<string,string>}
 */
export function readPlatformThemeVariables(theme) {
  const { accent, accentText, background, surface, text, textMuted, chassis } = theme.colors;
  const [red, green, blue] = readRgb(surface);
  const glassAt = (opacity) => `rgba(${red}, ${green}, ${blue}, ${Math.min(0.96, Math.max(0.2, opacity)).toFixed(2)})`;
  const radius = (size) => `${Math.round(size * theme.radius)}px`;
  const usesPixelFont = [theme.fonts.heading, theme.fonts.body].some((fontId) => PLATFORM_THEME_FONTS[fontId]?.pixel);

  return {
    "--color-accent": accent,
    "--platform-accent": accent,
    "--platform-accent-text": accentText,
    "--platform-accent-hover": mixHexColors(accent, "#ffffff", 0.45),
    "--surface-base": background,
    "--glass-1": glassAt(theme.glass * 0.76),
    "--glass-2": glassAt(theme.glass),
    "--glass-3": glassAt(theme.glass * 1.24),
    "--text-strong": text,
    "--text-body": mixHexColors(text, textMuted, 0.45),
    "--text-muted": textMuted,
    "--text-faint": mixHexColors(textMuted, background, 0.32),
    "--platform-text": text,
    "--platform-text-muted": textMuted,
    "--color-text": text,
    "--focus-ring": text,
    "--chassis": chassis,
    "--chassis-deep": mixHexColors(chassis, "#000000", 0.5),
    "--radius-sm": radius(8),
    "--radius-md": radius(14),
    "--radius-lg": radius(22),
    // Pills follow the corner scale too: square themes get square controls.
    "--radius-pill": theme.radius < 0.25 ? radius(8) : "999px",
    "--platform-font-heading": readFontStack(theme.fonts.heading),
    "--platform-font-body": readFontStack(theme.fonts.body),
    "--platform-font-mono": PLATFORM_THEME_MONO_FONTS[theme.fonts.mono].stack,
    "--icon-font-family": `"${PLATFORM_THEME_ICON_STYLES[theme.icons.style].family}"`,
    "--icon-fill": theme.icons.fill ? "1" : "0",
    "--icon-weight": String(theme.icons.weight),
    "--card-aspect": PLATFORM_THEME_CARD_SHAPES[theme.cards.shape].aspect,
    // Pixel fonts: equal x-heights keep titles in bounds, and no faux bold
    // keeps the pixels crisp.
    "--font-size-adjust": usesPixelFont ? PIXEL_FONT_SIZE_ADJUST : "none",
    "--font-synthesis": usesPixelFont ? "none" : "weight style",
  };
}

/** Every property a theme may set, so switching back to the default clears them all. */
export const PLATFORM_THEME_VARIABLE_NAMES = Object.freeze(Object.keys(readPlatformThemeVariables(BUILT_IN_PLATFORM_THEMES[0])));

/**
 * Apply a theme to an element's inline custom properties. The default theme
 * clears them, so global.scss provides the values.
 * @param {PlatformTheme} theme
 * @param {{style:{setProperty:(name:string,value:string)=>void,removeProperty:(name:string)=>void}}} root Usually document.documentElement.
 */
export function applyPlatformTheme(theme, root) {
  if (theme.id === DEFAULT_PLATFORM_THEME_ID) {
    for (const name of PLATFORM_THEME_VARIABLE_NAMES) root.style.removeProperty(name);
    return;
  }
  for (const [name, value] of Object.entries(readPlatformThemeVariables(theme))) root.style.setProperty(name, value);
}

/**
 * The Google Fonts stylesheet URLs a theme needs, built only from the
 * allowlists. Families the platform already loads are skipped.
 * @param {PlatformTheme} theme
 * @returns {string[]}
 */
export function readPlatformThemeFontUrls(theme) {
  const urls = [...new Set([theme.fonts.heading, theme.fonts.body])]
    .filter((fontId) => !PRELOADED_FONT_IDS.has(fontId))
    .map((fontId) => readGoogleFontUrl(PLATFORM_THEME_FONTS[fontId].family));
  const mono = PLATFORM_THEME_MONO_FONTS[theme.fonts.mono];
  if (mono.family && !PRELOADED_FONT_IDS.has(theme.fonts.mono)) urls.push(readGoogleFontUrl(mono.family));
  if (theme.icons.style !== "outlined") {
    const family = PLATFORM_THEME_ICON_STYLES[theme.icons.style].family.replace(/ /g, "+");
    urls.push(`https://fonts.googleapis.com/css2?family=${family}:opsz,wght,FILL@20..48,100..700,0..1&display=block`);
  }
  return urls;
}

/**
 * Build or update the player's own theme from a starting theme plus changes.
 * The result goes through full validation, so editor controls can't produce
 * an unsafe or unreadable theme.
 * @param {PlatformTheme} baseTheme
 * @param {{colors?:Partial<PlatformThemeColors>,glass?:number,radius?:number,fonts?:Partial<PlatformThemeFonts>,icons?:Partial<PlatformThemeIcons>,cards?:Partial<PlatformThemeCards>,background?:Partial<PlatformThemeBackground>,disc?:Partial<PlatformThemeDisc>}} changes
 * @returns {PlatformThemeParseResult}
 */
export function createCustomPlatformTheme(baseTheme, changes) {
  const colors = { ...baseTheme.colors, ...changes.colors };
  if (changes.colors?.accent && !changes.colors.accentText) colors.accentText = readAccentTextColor(changes.colors.accent);
  const background = { ...baseTheme.background, ...changes.background };
  if (background.style !== "image" && changes.background?.style) delete background.image;
  return validatePlatformTheme({
    format: PLATFORM_THEME_FORMAT,
    version: PLATFORM_THEME_VERSION,
    id: CUSTOM_PLATFORM_THEME_ID,
    name: "My theme",
    author: "You",
    colors,
    glass: changes.glass ?? baseTheme.glass,
    radius: changes.radius ?? baseTheme.radius,
    fonts: { ...baseTheme.fonts, ...changes.fonts },
    icons: { ...baseTheme.icons, ...changes.icons, nav: { ...baseTheme.icons.nav, ...changes.icons?.nav } },
    cards: { ...baseTheme.cards, ...changes.cards },
    background,
    disc: { ...baseTheme.disc, ...changes.disc },
  });
}

/**
 * The JSON a player can save and share.
 * @param {PlatformTheme} theme
 * @returns {string}
 */
export function serializePlatformTheme(theme) {
  return `${JSON.stringify(theme, null, 2)}\n`;
}

/**
 * @typedef {{selectedId:string,imported:PlatformTheme[]}} PlatformThemeLibrary
 */

/**
 * Read the selected theme and imported themes. Anything invalid is dropped.
 * @param {Pick<Storage,"getItem">|undefined} [storage=globalThis.localStorage]
 * @returns {PlatformThemeLibrary}
 */
export function readPlatformThemeLibrary(storage = globalThis.localStorage) {
  try {
    const stored = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "null");
    if (!isPlainObject(stored)) return { selectedId: DEFAULT_PLATFORM_THEME_ID, imported: [] };
    const imported = (Array.isArray(stored.imported) ? stored.imported : [])
      .map(validatePlatformTheme)
      .filter((result) => result.ok && !BUILT_IN_PLATFORM_THEMES.some((theme) => theme.id === result.theme.id))
      .map((result) => /** @type {{theme:PlatformTheme}} */ (result).theme)
      .slice(0, PLATFORM_THEME_LIMITS.maxImported);
    const selectedId = typeof stored.selectedId === "string" && [...BUILT_IN_PLATFORM_THEMES, ...imported].some((theme) => theme.id === stored.selectedId)
      ? stored.selectedId
      : DEFAULT_PLATFORM_THEME_ID;
    return { selectedId, imported };
  } catch {
    return { selectedId: DEFAULT_PLATFORM_THEME_ID, imported: [] };
  }
}

/**
 * @param {PlatformThemeLibrary} library
 * @param {Pick<Storage,"setItem">|undefined} [storage=globalThis.localStorage]
 * @returns {boolean} False when the browser refused to store it.
 */
export function savePlatformThemeLibrary(library, storage = globalThis.localStorage) {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(library));
    return true;
  } catch {
    // Private windows, blocked or full storage keep the theme for this visit only.
    return false;
  }
}

/**
 * Add an imported (or edited) theme, replacing one with the same id.
 * Built-in ids are reserved, and the count and total size are bounded.
 * @param {PlatformThemeLibrary} library
 * @param {PlatformTheme} theme An already validated theme.
 * @returns {{ok:true,library:PlatformThemeLibrary}|{ok:false,error:string}}
 */
export function addImportedPlatformTheme(library, theme) {
  if (BUILT_IN_PLATFORM_THEMES.some((builtIn) => builtIn.id === theme.id)) return { ok: false, error: `"${theme.id}" is a built-in theme id; choose another id.` };
  const others = library.imported.filter((existing) => existing.id !== theme.id);
  if (others.length >= PLATFORM_THEME_LIMITS.maxImported) return { ok: false, error: `You can keep up to ${PLATFORM_THEME_LIMITS.maxImported} imported themes; remove one first.` };
  const imported = [...others, theme];
  if (JSON.stringify(imported).length > PLATFORM_THEME_LIMITS.maxStoredChars) return { ok: false, error: "Not enough room on this device for that theme; remove a theme with a background image first." };
  return { ok: true, library: { selectedId: theme.id, imported } };
}

/**
 * @param {PlatformThemeLibrary} library
 * @param {string} themeId
 * @returns {PlatformThemeLibrary} Falls back to the default if the removed theme was selected.
 */
export function removeImportedPlatformTheme(library, themeId) {
  return {
    selectedId: library.selectedId === themeId ? DEFAULT_PLATFORM_THEME_ID : library.selectedId,
    imported: library.imported.filter((theme) => theme.id !== themeId),
  };
}
