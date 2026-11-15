import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PLATFORM_THEME_DEFAULTS_PATH, renderPlatformThemeDefaults } from "../scripts/generate-platform-theme-defaults.mjs";
import { BUILT_IN_PLATFORM_THEMES, PLATFORM_THEME_VARIABLE_NAMES, validatePlatformTheme } from "../public/platform/src/platform-ui/services/platformThemes.js";

const THEMES_DIR = new URL("../public/platform/src/data/themes/", import.meta.url);

test("the committed CSS defaults match the default theme's JSON", () => {
  assert.equal(readFileSync(PLATFORM_THEME_DEFAULTS_PATH, "utf8"), renderPlatformThemeDefaults(), "run npm run platform:theme-defaults");
});

test("global.scss no longer repeats any theme token by hand", () => {
  const globalStyles = readFileSync(new URL("../public/platform/src/platform-ui/styles/global.scss", import.meta.url), "utf8");
  const rootBlock = globalStyles.slice(globalStyles.indexOf(":root {"), globalStyles.indexOf("\n}\n", globalStyles.indexOf(":root {")));
  for (const name of PLATFORM_THEME_VARIABLE_NAMES) assert.ok(!rootBlock.includes(`  ${name}:`), `${name} is defined by hand in global.scss`);
  assert.match(globalStyles, /@use "theme-defaults\.generated";/);
});

test("every built-in theme is a JSON file in the shared format, and every file is a built-in", () => {
  const files = readdirSync(THEMES_DIR).filter((name) => name.endsWith(".kaboom-theme.json"));
  assert.deepEqual(files.map((name) => name.replace(".kaboom-theme.json", "")).sort(), BUILT_IN_PLATFORM_THEMES.map((theme) => theme.id).sort());
  for (const name of files) {
    const source = JSON.parse(readFileSync(new URL(name, THEMES_DIR), "utf8"));
    const result = validatePlatformTheme(source);
    assert.equal(result.ok, true, `${name}: ${result.error}`);
    assert.deepEqual(result.theme, source, `${name} is stored in full, normalised form`);
  }
});
