const THEME_STYLE_ID = "kaboom-custom-theme";
const SELECTED_THEME_KEY = "kaboom-selected-theme";

/**
 * Apply a theme by injecting CSS variables into a <style> element.
 * When theme is null or the default, removes the injected style so
 * global.scss provides the fallback.
 */
export function applyTheme(theme) {
  if (!theme || theme.id === "default") {
    removeTheme();
    return;
  }

  const lightVars = Object.entries(theme.light || {})
    .map(([key, value]) => `  --${key}: ${value};`)
    .join("\n");

  const darkVars = Object.entries(theme.dark || {})
    .map(([key, value]) => `  --${key}: ${value};`)
    .join("\n");

  let css = "";
  if (lightVars) css += `:root {\n${lightVars}\n}\n`;
  if (darkVars) css += `.dark {\n${darkVars}\n}`;

  let styleEl = document.getElementById(THEME_STYLE_ID);
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = THEME_STYLE_ID;
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = css;
}

/**
 * Remove custom theme style, reverting to global.scss defaults.
 */
export function removeTheme() {
  const styleEl = document.getElementById(THEME_STYLE_ID);
  if (styleEl) styleEl.remove();
}

/**
 * Persist the selected theme id to localStorage.
 */
export function saveSelectedTheme(themeId) {
  if (!themeId) {
    localStorage.removeItem(SELECTED_THEME_KEY);
  } else {
    localStorage.setItem(SELECTED_THEME_KEY, themeId);
  }
}

/**
 * Retrieve the stored theme id from localStorage.
 */
export function getSelectedThemeId() {
  return localStorage.getItem(SELECTED_THEME_KEY);
}
