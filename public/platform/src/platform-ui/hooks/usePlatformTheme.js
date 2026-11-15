import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  BUILT_IN_PLATFORM_THEMES,
  addImportedPlatformTheme,
  applyPlatformTheme,
  createCustomPlatformTheme,
  parsePlatformTheme,
  readPlatformThemeFontUrls,
  readPlatformThemeLibrary,
  removeImportedPlatformTheme,
  savePlatformThemeLibrary,
} from "../services/platformThemes.js";

/** @typedef {import("../services/platformThemes.js").PlatformTheme} PlatformTheme */
/** @typedef {{ok:true,theme:PlatformTheme}|{ok:false,error:string}} PlatformThemeChangeResult */

/**
 * Load the fonts and icon pack a theme needs. URLs come only from the
 * theme allowlists; each stylesheet is added once.
 * @param {PlatformTheme} theme
 */
export function loadPlatformThemeFonts(theme) {
  for (const href of readPlatformThemeFontUrls(theme)) {
    if ([...document.head.querySelectorAll("link[data-theme-font]")].some((link) => link.getAttribute("href") === href)) continue;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.dataset.themeFont = "";
    document.head.appendChild(link);
  }
}

/**
 * The platform theme for this device: built-in and imported themes, the
 * selection, and import, customize and remove actions. The selected theme is
 * applied to the document at startup, and a change crossfades where the
 * browser supports view transitions (instantly under reduced motion).
 * @returns {{themes:PlatformTheme[],builtInCount:number,selectedTheme:PlatformTheme,selectTheme:(themeId:string)=>void,importTheme:(text:string)=>PlatformThemeChangeResult,customizeTheme:(changes:Parameters<typeof createCustomPlatformTheme>[1])=>PlatformThemeChangeResult,removeTheme:(themeId:string)=>void}}
 */
export default function usePlatformTheme() {
  const [library, setLibrary] = useState(() => readPlatformThemeLibrary());
  const themes = useMemo(() => [...BUILT_IN_PLATFORM_THEMES, ...library.imported], [library.imported]);
  const selectedTheme = themes.find((theme) => theme.id === library.selectedId) ?? BUILT_IN_PLATFORM_THEMES[0];
  const appliedOnce = useRef(false);
  // Customizing applies live while a slider or picker moves; only switching
  // between themes crossfades.
  const applyInstantly = useRef(false);

  useLayoutEffect(() => {
    loadPlatformThemeFonts(selectedTheme);
    const root = document.documentElement;
    const apply = () => applyPlatformTheme(selectedTheme, root);
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (!appliedOnce.current || applyInstantly.current || reducedMotion || typeof document.startViewTransition !== "function") {
      apply();
    } else {
      document.startViewTransition(apply);
    }
    appliedOnce.current = true;
    applyInstantly.current = false;
  }, [selectedTheme]);

  // Save once edits settle, not on every slider step; leaving the page
  // saves whatever is pending.
  const libraryRef = useRef(library);
  libraryRef.current = library;
  useEffect(() => {
    const saveTimer = window.setTimeout(() => savePlatformThemeLibrary(library), 300);
    return () => window.clearTimeout(saveTimer);
  }, [library]);
  useEffect(() => {
    const saveNow = () => savePlatformThemeLibrary(libraryRef.current);
    window.addEventListener("pagehide", saveNow);
    return () => window.removeEventListener("pagehide", saveNow);
  }, []);

  const selectTheme = useCallback((themeId) => {
    setLibrary((current) => ({ ...current, selectedId: themeId }));
  }, []);

  /** @param {PlatformTheme} theme @returns {PlatformThemeChangeResult} */
  const storeTheme = useCallback((theme) => {
    const added = addImportedPlatformTheme(library, theme);
    if (!added.ok) return added;
    setLibrary(added.library);
    return { ok: true, theme };
  }, [library]);

  const importTheme = useCallback((text) => {
    const parsed = parsePlatformTheme(text);
    return parsed.ok ? storeTheme(parsed.theme) : parsed;
  }, [storeTheme]);

  const customizeTheme = useCallback((changes) => {
    const customized = createCustomPlatformTheme(selectedTheme, changes);
    if (!customized.ok) return customized;
    applyInstantly.current = true;
    return storeTheme(customized.theme);
  }, [selectedTheme, storeTheme]);

  const removeTheme = useCallback((themeId) => {
    setLibrary((current) => removeImportedPlatformTheme(current, themeId));
  }, []);

  return { themes, builtInCount: BUILT_IN_PLATFORM_THEMES.length, selectedTheme, selectTheme, importTheme, customizeTheme, removeTheme };
}
