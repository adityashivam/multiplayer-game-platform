export const DEFAULT_THEME_ICONS = {
  header: {
    muteOn: "volume_up",
    muteOff: "volume_off",
    fullscreenOn: "fullscreen",
    fullscreenOff: "fullscreen_exit",
    themeToggle: "contrast",
  },
  nav: {
    solo: "videogame_asset",
    multi: "hub",
    profile: "id_card",
    friends: "group",
    config: "settings",
  },
  config: {
    selectedTheme: "check_circle",
  },
  game: {
    fullscreenOn: "fullscreen",
    fullscreenOff: "fullscreen_exit",
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
    reconnecting: "wifi_find",
    connecting: "wifi_find",
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
