import test from "node:test";
import assert from "node:assert/strict";
import {
  BUILT_IN_PLATFORM_THEMES,
  DEFAULT_PLATFORM_THEME_ID,
  PLATFORM_THEME_LIMITS,
  PLATFORM_THEME_VARIABLE_NAMES,
  CUSTOM_PLATFORM_THEME_ID,
  addImportedPlatformTheme,
  applyPlatformTheme,
  createCustomPlatformTheme,
  readAccentTextColor,
  readPlatformThemeFontUrls,
  parsePlatformTheme,
  readContrastRatio,
  readPlatformThemeLibrary,
  readPlatformThemeVariables,
  removeImportedPlatformTheme,
  savePlatformThemeLibrary,
  serializePlatformTheme,
  validatePlatformTheme,
} from "../public/platform/src/platform-ui/services/platformThemes.js";

const sampleTheme = {
  format: "kaboom-theme",
  version: 1,
  id: "sea-glass",
  name: "Sea Glass",
  author: "A player",
  colors: { accent: "#5fd3e8", accentText: "#06222a", background: "#080c0e", surface: "#0e1619", text: "#eff6f8", textMuted: "#9fb3ba", chassis: "#161d20" },
  glass: 0.65,
  radius: 1.1,
};

function createMemoryStorage() {
  const values = new Map();
  return { getItem: (key) => (values.has(key) ? values.get(key) : null), setItem: (key, value) => values.set(key, String(value)) };
}

test("every built-in theme passes the same validation as an imported one", () => {
  assert.equal(BUILT_IN_PLATFORM_THEMES[0].id, DEFAULT_PLATFORM_THEME_ID);
  assert.ok(BUILT_IN_PLATFORM_THEMES.length >= 4);
  for (const theme of BUILT_IN_PLATFORM_THEMES) {
    const result = validatePlatformTheme(theme);
    assert.equal(result.ok, true, `${theme.id}: ${result.error}`);
  }
});

test("a valid theme file round-trips through export and import", () => {
  const parsed = parsePlatformTheme(JSON.stringify(sampleTheme));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsePlatformTheme(serializePlatformTheme(parsed.theme)), parsed);
});

test("values that could inject CSS or load URLs are rejected", () => {
  const attempts = [
    { ...sampleTheme, colors: { ...sampleTheme.colors, accent: "red; } body { background: url(https://example.test/x) }" } },
    { ...sampleTheme, colors: { ...sampleTheme.colors, background: "url(https://example.test/x)" } },
    { ...sampleTheme, colors: { ...sampleTheme.colors, text: "var(--evil)" } },
    { ...sampleTheme, glass: "0.5; display:none" },
    { ...sampleTheme, css: "body{display:none}" },
    { ...sampleTheme, colors: { ...sampleTheme.colors, backgroundImage: "#ffffff" } },
  ];
  for (const attempt of attempts) assert.equal(validatePlatformTheme(attempt).ok, false, JSON.stringify(attempt).slice(0, 80));
});

test("errors name the problem so authors can fix it", () => {
  assert.match(parsePlatformTheme("{not json").error, /valid JSON/);
  assert.match(validatePlatformTheme({ ...sampleTheme, format: "other" }).error, /format/);
  assert.match(validatePlatformTheme({ ...sampleTheme, colors: { ...sampleTheme.colors, accent: "#abc" } }).error, /colors\.accent/);
  assert.match(validatePlatformTheme({ ...sampleTheme, radius: 4 }).error, /radius/);
  assert.match(validatePlatformTheme({ ...sampleTheme, id: "Bad Id" }).error, /id/);
  assert.match(parsePlatformTheme("x".repeat(PLATFORM_THEME_LIMITS.maxBytes + 1)).error, /too large/);
});

test("unreadable themes are rejected by contrast checks", () => {
  assert.match(validatePlatformTheme({ ...sampleTheme, colors: { ...sampleTheme.colors, text: "#2a3034" } }).error, /colors\.text/);
  assert.match(validatePlatformTheme({ ...sampleTheme, colors: { ...sampleTheme.colors, accentText: "#5fd0e5" } }).error, /accentText/);
  assert.match(validatePlatformTheme({ ...sampleTheme, colors: { ...sampleTheme.colors, background: "#f4f4f4" } }).error, /dark/);
  assert.ok(readContrastRatio("#ffffff", "#000000") > 20);
});

test("names are kept as plain, bounded text", () => {
  const result = validatePlatformTheme({ ...sampleTheme, name: "Sea\u0000 Glass" + "!".repeat(80) });
  assert.equal(result.ok, true);
  assert.ok(!result.theme.name.includes("\u0000"));
  assert.ok(result.theme.name.length <= PLATFORM_THEME_LIMITS.maxNameLength);
});

test("a theme sets only known custom properties with safe values", () => {
  const variables = readPlatformThemeVariables(validatePlatformTheme(sampleTheme).theme);
  assert.deepEqual(Object.keys(variables), [...PLATFORM_THEME_VARIABLE_NAMES]);
  for (const value of Object.values(variables)) {
    assert.match(value, /^(#[0-9a-f]{6}|rgba\(\d+, \d+, \d+, [\d.]+\)|\d+px|[\d.]+|\d+ \/ \d+|"[A-Za-z0-9 ]+"(, (sans-serif|monospace))?|none|weight style)$/, value);
  }
  assert.equal(variables["--radius-md"], "15px");
});

test("applying the default theme clears every theme property", () => {
  const properties = new Map();
  const root = { style: { setProperty: (name, value) => properties.set(name, value), removeProperty: (name) => properties.delete(name) } };
  applyPlatformTheme(validatePlatformTheme(sampleTheme).theme, root);
  assert.equal(properties.get("--platform-accent"), "#5fd3e8");
  applyPlatformTheme(BUILT_IN_PLATFORM_THEMES[0], root);
  assert.equal(properties.size, 0);
});

test("imported themes are stored, replaced by id, bounded and removable", () => {
  const storage = createMemoryStorage();
  let library = readPlatformThemeLibrary(storage);
  assert.deepEqual(library, { selectedId: DEFAULT_PLATFORM_THEME_ID, imported: [] });
  const theme = validatePlatformTheme(sampleTheme).theme;
  library = addImportedPlatformTheme(library, theme).library;
  library = addImportedPlatformTheme(library, { ...theme, name: "Sea Glass 2" }).library;
  assert.equal(library.imported.length, 1);
  assert.equal(library.selectedId, "sea-glass");
  savePlatformThemeLibrary(library, storage);
  assert.deepEqual(readPlatformThemeLibrary(storage), library);
  assert.match(addImportedPlatformTheme(library, { ...theme, id: "ember" }).error, /built-in/);
  const full = { selectedId: "kaboom", imported: Array.from({ length: PLATFORM_THEME_LIMITS.maxImported }, (_, index) => ({ ...theme, id: `t-${index}` })) };
  assert.match(addImportedPlatformTheme(full, { ...theme, id: "one-more" }).error, /up to/);
  assert.deepEqual(removeImportedPlatformTheme(library, "sea-glass"), { selectedId: DEFAULT_PLATFORM_THEME_ID, imported: [] });
});

test("tampered or blocked storage falls back to the default theme", () => {
  const storage = createMemoryStorage();
  storage.setItem("platform.themes.v1", JSON.stringify({ selectedId: "ghost", imported: [{ ...sampleTheme, colors: { ...sampleTheme.colors, accent: "red" } }] }));
  assert.deepEqual(readPlatformThemeLibrary(storage), { selectedId: DEFAULT_PLATFORM_THEME_ID, imported: [] });
  storage.setItem("platform.themes.v1", "{broken");
  assert.equal(readPlatformThemeLibrary(storage).selectedId, DEFAULT_PLATFORM_THEME_ID);
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.equal(readPlatformThemeLibrary(blocked).selectedId, DEFAULT_PLATFORM_THEME_ID);
  assert.doesNotThrow(() => savePlatformThemeLibrary({ selectedId: "kaboom", imported: [] }, blocked));
});

const tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==";

test("version 1 files still import and come back as complete version 2 themes", () => {
  const result = validatePlatformTheme(sampleTheme);
  assert.equal(result.ok, true);
  assert.equal(result.theme.version, 2);
  assert.deepEqual(result.theme.fonts, { heading: "space-grotesk", body: "manrope" });
  assert.equal(result.theme.icons.style, "outlined");
  assert.equal(result.theme.cards.shape, "portrait");
  assert.equal(result.theme.background.style, "game-art");
});

test("fonts, icon packs, card shapes and backgrounds come from fixed lists", () => {
  const rich = {
    ...sampleTheme,
    version: 2,
    fonts: { heading: "orbitron", body: "inter" },
    icons: { style: "sharp", fill: true, weight: 300, nav: { solo: "sports_esports", config: "settings" } },
    cards: { shape: "square" },
    background: { style: "image", pattern: "dots", image: tinyPng, dim: 0.4, blur: 6 },
  };
  const result = validatePlatformTheme(rich);
  assert.equal(result.ok, true, result.error);
  const variables = readPlatformThemeVariables(result.theme);
  assert.equal(variables["--platform-font-heading"], "\"Orbitron\", sans-serif");
  assert.equal(variables["--icon-font-family"], "\"Material Symbols Sharp\"");
  assert.equal(variables["--icon-fill"], "1");
  assert.equal(variables["--card-aspect"], "1 / 1");

  const rejected = [
    { ...rich, fonts: { heading: "Comic Sans MS", body: "inter" } },
    { ...rich, fonts: { heading: "inter", body: "inter", url: "https://example.test/font.css" } },
    { ...rich, icons: { ...rich.icons, style: "emoji" } },
    { ...rich, icons: { ...rich.icons, nav: { solo: "x); background: red" } } },
    { ...rich, icons: { ...rich.icons, nav: { shop: "store" } } },
    { ...rich, cards: { shape: "circle" } },
    { ...rich, background: { ...rich.background, image: "https://example.test/tracker.png" } },
    { ...rich, background: { ...rich.background, image: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" } },
    { ...rich, background: { ...rich.background, image: 'data:image/png;base64,AAAA"); background: url(https://example.test' } },
    { ...rich, background: { ...rich.background, image: `data:image/png;base64,${"A".repeat(PLATFORM_THEME_LIMITS.maxImageChars)}` } },
    { ...rich, background: { style: "image", dim: 0.2, blur: 0 } },
    { ...rich, background: { ...rich.background, dim: 2 } },
  ];
  for (const theme of rejected) assert.equal(validatePlatformTheme(theme).ok, false, JSON.stringify(theme.fonts ?? theme.icons ?? theme.background).slice(0, 90));
});

test("font and icon stylesheets are built only from the allowlists", () => {
  const theme = validatePlatformTheme({ ...sampleTheme, version: 2, fonts: { heading: "exo-2", body: "manrope" }, icons: { style: "rounded", fill: false, weight: 400 } }).theme;
  const urls = readPlatformThemeFontUrls(theme);
  assert.ok(urls.every((url) => url.startsWith("https://fonts.googleapis.com/css2?family=")));
  assert.ok(urls.some((url) => url.includes("family=Exo+2")));
  assert.ok(urls.some((url) => url.includes("Material+Symbols+Rounded")));
  assert.ok(!urls.some((url) => url.includes("Manrope")), "already-loaded fonts are not fetched again");
  assert.deepEqual(readPlatformThemeFontUrls(BUILT_IN_PLATFORM_THEMES[0]), []);
});

test("the customizer builds a valid personal theme, picking readable button text", () => {
  const base = BUILT_IN_PLATFORM_THEMES[0];
  const result = createCustomPlatformTheme(base, { colors: { accent: "#ffcc00" }, cards: { shape: "tall" }, fonts: { heading: "oxanium" } });
  assert.equal(result.ok, true, result.error);
  assert.equal(result.theme.id, CUSTOM_PLATFORM_THEME_ID);
  assert.equal(result.theme.cards.shape, "tall");
  assert.ok(readContrastRatio(result.theme.colors.accentText, "#ffcc00") >= 4.5);
  for (const accent of ["#ff0000", "#0000ff", "#777777", "#00ff00"]) assert.ok(readContrastRatio(readAccentTextColor(accent), accent) >= 4.5, accent);
  const withImage = createCustomPlatformTheme(base, { background: { style: "image", image: tinyPng, dim: 0.5 } });
  assert.equal(withImage.ok, true, withImage.error);
  const backToArt = createCustomPlatformTheme(withImage.theme, { background: { style: "game-art" } });
  assert.equal(backToArt.theme.background.image, undefined, "leaving image mode drops the stored image");
});

test("themes with images are bounded by what a device can store", () => {
  const theme = validatePlatformTheme({ ...sampleTheme, version: 2, background: { style: "image", pattern: "grid", image: `data:image/png;base64,${"A".repeat(PLATFORM_THEME_LIMITS.maxImageChars - 30)}`, dim: 0.3, blur: 0 } }).theme;
  let library = { selectedId: "kaboom", imported: [] };
  let refused = null;
  for (let index = 0; index < 8 && !refused; index += 1) {
    const result = addImportedPlatformTheme(library, { ...theme, id: `big-${index}` });
    if (result.ok) library = result.library; else refused = result.error;
  }
  assert.match(refused ?? "", /Not enough room/);
});

const regularPill = () => readPlatformThemeVariables(BUILT_IN_PLATFORM_THEMES[0])["--radius-pill"];

test("pixel-font themes normalise text size and keep pixels crisp", () => {
  const eightBit = BUILT_IN_PLATFORM_THEMES.find((theme) => theme.id === "eight-bit");
  assert.ok(eightBit, "the 8-Bit theme ships built in");
  const variables = readPlatformThemeVariables(eightBit);
  assert.equal(variables["--platform-font-heading"], "\"Press Start 2P\", monospace");
  assert.equal(variables["--font-size-adjust"], "0.5");
  assert.equal(variables["--font-synthesis"], "none");
  assert.equal(variables["--radius-md"], "0px", "square corners");
  assert.equal(variables["--radius-pill"], "0px", "square controls");
  assert.equal(regularPill(), "999px");
  assert.deepEqual(readPlatformThemeFontUrls(eightBit).filter((url) => !url.includes("Material+Symbols")), [], "pixel fonts are already loaded by the page");
  const regular = readPlatformThemeVariables(BUILT_IN_PLATFORM_THEMES[0]);
  assert.equal(regular["--font-size-adjust"], "none");
  assert.equal(regular["--font-synthesis"], "weight style");
});
