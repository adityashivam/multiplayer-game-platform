export const PERFORMANCE_SETTINGS_KEY = "kaboom-performance-settings";
export const PERFORMANCE_PROFILE_EVENT = "kaboom:performance-profile";
export const FPS_OPTIONS = [30, 45, 60];
export const RESOLUTION_OPTIONS = [0.6, 0.75, 0.85, 1];

const DEFAULT_SETTINGS = {
  mode: "auto",
  targetFps: 60,
  resolutionScale: 1,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function parseFiniteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nearestOption(value, options, fallback) {
  if (!Array.isArray(options) || options.length === 0) return fallback;
  const target = parseFiniteNumber(value, fallback);
  let closest = options[0];
  let bestDistance = Math.abs(closest - target);
  for (let i = 1; i < options.length; i += 1) {
    const distance = Math.abs(options[i] - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      closest = options[i];
    }
  }
  return closest;
}

export function getDefaultPerformanceSettings() {
  return { ...DEFAULT_SETTINGS };
}

export function sanitizePerformanceSettings(raw = {}) {
  const mode = raw?.mode === "manual" ? "manual" : "auto";
  const targetFps = nearestOption(raw?.targetFps, FPS_OPTIONS, DEFAULT_SETTINGS.targetFps);
  const resolutionScale = nearestOption(
    raw?.resolutionScale,
    RESOLUTION_OPTIONS,
    DEFAULT_SETTINGS.resolutionScale,
  );

  return {
    mode,
    targetFps: clamp(targetFps, FPS_OPTIONS[0], FPS_OPTIONS[FPS_OPTIONS.length - 1]),
    resolutionScale: clamp(
      resolutionScale,
      RESOLUTION_OPTIONS[0],
      RESOLUTION_OPTIONS[RESOLUTION_OPTIONS.length - 1],
    ),
  };
}

function sanitizeRuntimeProfile(raw = {}) {
  const targetFps = nearestOption(raw?.targetFps, FPS_OPTIONS, DEFAULT_SETTINGS.targetFps);
  const resolutionScale = nearestOption(
    raw?.resolutionScale,
    RESOLUTION_OPTIONS,
    DEFAULT_SETTINGS.resolutionScale,
  );
  const autoTier =
    raw?.autoTier === "low" || raw?.autoTier === "medium" || raw?.autoTier === "balanced"
      ? raw.autoTier
      : "balanced";
  return {
    mode: raw?.mode === "manual" ? "manual" : "auto",
    autoTier,
    autoLowEndActive: Boolean(raw?.autoLowEndActive),
    targetFps: clamp(targetFps, FPS_OPTIONS[0], FPS_OPTIONS[FPS_OPTIONS.length - 1]),
    resolutionScale: clamp(
      resolutionScale,
      RESOLUTION_OPTIONS[0],
      RESOLUTION_OPTIONS[RESOLUTION_OPTIONS.length - 1],
    ),
    reducedEffects: Boolean(raw?.reducedEffects),
  };
}

export function loadPerformanceSettings() {
  if (typeof window === "undefined" || !window.localStorage) {
    return getDefaultPerformanceSettings();
  }
  try {
    const stored = window.localStorage.getItem(PERFORMANCE_SETTINGS_KEY);
    if (!stored) return getDefaultPerformanceSettings();
    const parsed = JSON.parse(stored);
    return sanitizePerformanceSettings(parsed);
  } catch {
    return getDefaultPerformanceSettings();
  }
}

export function savePerformanceSettings(settings) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(PERFORMANCE_SETTINGS_KEY, JSON.stringify(sanitizePerformanceSettings(settings)));
  } catch {
    // Storage unavailable.
  }
}

export function publishRuntimePerformanceProfile(profile = {}) {
  if (typeof window === "undefined") return;
  const sanitized = sanitizeRuntimeProfile(profile);
  window.__kaboomRuntimePerformanceProfile = sanitized;
  window.dispatchEvent(new CustomEvent(PERFORMANCE_PROFILE_EVENT, { detail: sanitized }));
}

export function getRuntimePerformanceProfile() {
  if (typeof window === "undefined") {
    return sanitizeRuntimeProfile(DEFAULT_SETTINGS);
  }
  const runtimeProfile = window.__kaboomRuntimePerformanceProfile;
  if (runtimeProfile && typeof runtimeProfile === "object") {
    return sanitizeRuntimeProfile(runtimeProfile);
  }
  const settings = loadPerformanceSettings();
  if (settings.mode === "manual") {
    return sanitizeRuntimeProfile({
      mode: "manual",
      autoLowEndActive: false,
      targetFps: settings.targetFps,
      resolutionScale: settings.resolutionScale,
      reducedEffects: settings.targetFps <= 45 || settings.resolutionScale < 1,
    });
  }
  return sanitizeRuntimeProfile({
    mode: "auto",
    autoLowEndActive: false,
    targetFps: DEFAULT_SETTINGS.targetFps,
    resolutionScale: DEFAULT_SETTINGS.resolutionScale,
    reducedEffects: false,
  });
}

export function subscribeRuntimePerformanceProfile(callback) {
  if (typeof window === "undefined" || typeof callback !== "function") return () => {};
  const handleProfile = (event) => {
    callback(sanitizeRuntimeProfile(event?.detail || {}));
  };
  window.addEventListener(PERFORMANCE_PROFILE_EVENT, handleProfile);
  callback(getRuntimePerformanceProfile());
  return () => {
    window.removeEventListener(PERFORMANCE_PROFILE_EVENT, handleProfile);
  };
}
