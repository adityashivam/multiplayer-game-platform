export const DEFAULT_THEME_ICONS = {
  header: {
    muteOn: "volume_up",
    muteOff: "volume_off",
    fullscreenOn: "open_in_full",
    fullscreenOff: "close_fullscreen",
    themeToggleLight: "dark_mode",
    themeToggleDark: "light_mode",
    themeToggle: "contrast",
  },
  nav: {
    solo: "sports_esports",
    multi: "hub",
    profile: "person",
    friends: "groups",
    config: "tune",
  },
  config: {
    selectedTheme: "verified",
  },
  game: {
    fullscreenOn: "open_in_full",
    fullscreenOff: "close_fullscreen",
  },
  share: {
    close: "close",
    copy: "content_copy",
    invite: "person_add",
    chat: "chat",
    sms: "sms",
    more: "share",
  },
  endGame: {
    rematch: "sports_mma",
    backHome: "home",
  },
  exitConfirm: {
    goHome: "home",
    stay: "sports_esports",
  },
  connection: {
    connected: "wifi",
    reconnecting: "sync",
    connecting: "sync",
    disconnected: "wifi_off",
  },
};

function mergeIcons(base, override) {
  if (!override || typeof override !== "object") return base;
  const merged = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      merged[key] = mergeIcons(base[key] || {}, value);
    } else if (typeof value === "string" && value.trim()) {
      merged[key] = value;
    }
  }
  return merged;
}

export function resolveThemeIcons(theme) {
  return mergeIcons(DEFAULT_THEME_ICONS, theme?.icons || {});
}
