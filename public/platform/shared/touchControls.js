/** Versioned, renderer-independent touch controls declared by trusted game packages. */
export const TOUCH_CONTROLS_API_VERSION = 1;
export const TOUCH_PRESET_IDS = Object.freeze(["two-thumb", "three-finger", "four-finger"]);
export const TOUCH_CONTROL_LIMITS = Object.freeze({
  x: Object.freeze({ min: 0, max: 1 }),
  y: Object.freeze({ min: 0, max: 1 }),
  size: Object.freeze({ min: 44, max: 160 }),
  opacity: Object.freeze({ min: 0.25, max: 1 }),
});

const MAX_TOUCH_CONTROLS = 16;
const MAX_CONTROL_TEXT_LENGTH = 64;
const CONTROL_ID_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,47}$/;
const UNSAFE_CONTROL_IDS = new Set(["__proto__", "constructor", "prototype"]);
const DESCRIPTOR_KEYS = new Set(["apiVersion", "customizable", "defaultPreset", "allowedPresets", "controls"]);
const CONTROL_KEYS = new Set(["id", "type", "role", "label", "icon", "editable", "behavior", "defaultLayout"]);
const LAYOUT_FIELDS = Object.freeze(["x", "y", "size", "opacity"]);
const CONTROL_TYPES = new Set(["stick", "look", "button"]);
const CONTROL_ROLES = new Set(["move", "look", "primary", "secondary", "reload", "jump", "utility"]);
const BUTTON_BEHAVIORS = new Set(["hold", "press", "hold-look"]);
const PROFILE_MODES = new Set(["auto", "on", "off"]);

/**
 * @typedef {"two-thumb"|"three-finger"|"four-finger"} TouchPresetId
 * @typedef {"portrait"|"landscape"} TouchOrientation
 * @typedef {"auto"|"on"|"off"} TouchControlMode
 * @typedef {"stick"|"look"|"button"} TouchControlType
 * @typedef {"move"|"look"|"primary"|"secondary"|"reload"|"jump"|"utility"} TouchControlRole
 * @typedef {"hold"|"press"|"hold-look"} TouchButtonBehavior
 * @typedef {{x: number, y: number, size: number, opacity: number}} TouchControlLayout
 * @typedef {Partial<TouchControlLayout>} TouchLayoutPatch
 * @typedef {object} TouchControlDescriptor
 * @property {string} id Game-defined event identifier, at most 48 ASCII letters/digits/underscores/hyphens.
 * @property {TouchControlType} type
 * @property {TouchControlRole} role
 * @property {string} label
 * @property {string} [icon] Material symbol name or another game-owned plain icon identifier.
 * @property {boolean} [editable=true] Look surfaces are fixed regardless of this value.
 * @property {TouchButtonBehavior} [behavior="hold"] Buttons only.
 * @property {TouchLayoutPatch} [defaultLayout]
 * @typedef {TouchControlDescriptor} TouchControl
 * @typedef {object} TouchControlsDescriptor
 * @property {1} apiVersion
 * @property {boolean} customizable Explicit developer permission to edit any settings.
 * @property {TouchPresetId} defaultPreset
 * @property {TouchPresetId[]} allowedPresets
 * @property {TouchControlDescriptor[]} controls At most 16 declared controls.
 * @typedef {Record<string, TouchLayoutPatch>} TouchPresetOverrides
 * @typedef {{"two-thumb": TouchPresetOverrides, "three-finger": TouchPresetOverrides, "four-finger": TouchPresetOverrides}} TouchPresetLayouts
 * @typedef {object} TouchProfile
 * @property {1} version
 * @property {TouchPresetId} presetId
 * @property {TouchControlMode} mode
 * @property {boolean} hideShell An explicit player presentation choice; defaults to false.
 * @property {TouchPresetLayouts} layouts
 * @typedef {TouchControlDescriptor & TouchControlLayout} ResolvedTouchControl
 */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isTouchMetadataObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

/** @param {unknown} controlId @returns {controlId is string} */
function isSupportedTouchControlId(controlId) {
  return typeof controlId === "string" && CONTROL_ID_PATTERN.test(controlId) && !UNSAFE_CONTROL_IDS.has(controlId);
}

/** @param {object} metadata @param {Set<string>} allowedKeys @returns {boolean} */
function hasOnlyTouchMetadataKeys(metadata, allowedKeys) {
  return Reflect.ownKeys(metadata).every((key) => typeof key === "string" && allowedKeys.has(key));
}

/** @param {unknown} value @returns {boolean} */
function isValidDefaultTouchLayout(value) {
  return isTouchMetadataObject(value) && hasOnlyTouchMetadataKeys(value, new Set(LAYOUT_FIELDS)) &&
    Object.entries(value).every(([field, number]) => Number.isFinite(number) &&
      number >= TOUCH_CONTROL_LIMITS[field].min && number <= TOUCH_CONTROL_LIMITS[field].max);
}

/**
 * Reject invalid or unsupported touch contracts before a game registers callbacks.
 * Metadata uses closed shapes; user-saved profiles instead use bounded sanitization.
 * @param {TouchControlsDescriptor|undefined} descriptor
 * @param {string} gameId
 * @returns {void}
 * @throws {TypeError} For an invalid version, unsupported fields, duplicate IDs or unbounded defaults.
 */
export function validateTouchControls(descriptor, gameId) {
  if (descriptor === undefined) {
    return;
  }
  if (!isTouchMetadataObject(descriptor) || !hasOnlyTouchMetadataKeys(descriptor, DESCRIPTOR_KEYS) ||
      descriptor.apiVersion !== TOUCH_CONTROLS_API_VERSION || typeof descriptor.customizable !== "boolean" ||
      !TOUCH_PRESET_IDS.includes(descriptor.defaultPreset) || !Array.isArray(descriptor.allowedPresets) ||
      descriptor.allowedPresets.length === 0 || descriptor.allowedPresets.length > TOUCH_PRESET_IDS.length ||
      descriptor.allowedPresets.some((presetId) => !TOUCH_PRESET_IDS.includes(presetId)) ||
      new Set(descriptor.allowedPresets).size !== descriptor.allowedPresets.length ||
      !descriptor.allowedPresets.includes(descriptor.defaultPreset) || !Array.isArray(descriptor.controls) ||
      descriptor.controls.length === 0 || descriptor.controls.length > MAX_TOUCH_CONTROLS) {
    throw new TypeError(`Game ${gameId} has invalid touch controls metadata`);
  }

  const controlIds = new Set();
  for (const control of descriptor.controls) {
    if (!isTouchMetadataObject(control) || !hasOnlyTouchMetadataKeys(control, CONTROL_KEYS) ||
        !isSupportedTouchControlId(control.id) || controlIds.has(control.id) ||
        !CONTROL_TYPES.has(control.type) || !CONTROL_ROLES.has(control.role) ||
        typeof control.label !== "string" || !control.label.trim() || control.label.length > MAX_CONTROL_TEXT_LENGTH ||
        (control.icon !== undefined && (typeof control.icon !== "string" ||
          !/^[A-Za-z0-9_-]{1,64}$/.test(control.icon))) ||
        (control.editable !== undefined && typeof control.editable !== "boolean") ||
        (control.behavior !== undefined && (control.type !== "button" || !BUTTON_BEHAVIORS.has(control.behavior))) ||
        (control.defaultLayout !== undefined && !isValidDefaultTouchLayout(control.defaultLayout))) {
      throw new TypeError(`Game ${gameId} has invalid touch control metadata`);
    }
    controlIds.add(control.id);
  }
}

/** @returns {TouchPresetLayouts} */
function createEmptyTouchLayouts() {
  return { "two-thumb": {}, "three-finger": {}, "four-finger": {} };
}

/**
 * Create an owned profile without implicitly expanding the console or forcing touch input.
 * @param {TouchControlsDescriptor|undefined} descriptor
 * @returns {TouchProfile}
 */
export function createDefaultTouchProfile(descriptor) {
  return {
    version: TOUCH_CONTROLS_API_VERSION,
    presetId: descriptor?.defaultPreset ?? "two-thumb",
    mode: "auto",
    hideShell: false,
    layouts: createEmptyTouchLayouts(),
  };
}

/** @param {unknown} candidate @returns {TouchLayoutPatch} */
function sanitizeTouchLayoutPatch(candidate) {
  const layoutPatch = {};
  if (!isTouchMetadataObject(candidate)) {
    return layoutPatch;
  }
  for (const field of LAYOUT_FIELDS) {
    const value = candidate[field];
    if (typeof value === "number" && Number.isFinite(value)) {
      const bounds = TOUCH_CONTROL_LIMITS[field];
      layoutPatch[field] = Math.min(bounds.max, Math.max(bounds.min, value));
    }
  }
  return layoutPatch;
}

/**
 * Read only current declared editable controls from untrusted local preferences.
 * New/removed controls migrate to developer defaults; locks override old saved values.
 * Numeric strings and nonfinite values are discarded, finite values are clamped.
 * @param {TouchControlsDescriptor|undefined} descriptor
 * @param {unknown} candidate
 * @returns {TouchProfile} Independently owned, with no references into metadata or preferences.
 */
export function sanitizeTouchProfile(descriptor, candidate) {
  const profile = createDefaultTouchProfile(descriptor);
  if (!descriptor?.customizable || !isTouchMetadataObject(candidate) || candidate.version !== TOUCH_CONTROLS_API_VERSION) {
    return profile;
  }

  if (descriptor.allowedPresets.includes(candidate.presetId)) {
    profile.presetId = candidate.presetId;
  }
  if (PROFILE_MODES.has(candidate.mode)) {
    profile.mode = candidate.mode;
  }
  profile.hideShell = candidate.hideShell === true;

  if (!isTouchMetadataObject(candidate.layouts)) {
    return profile;
  }
  for (const presetId of descriptor.allowedPresets) {
    const savedLayout = candidate.layouts[presetId];
    if (!isTouchMetadataObject(savedLayout)) {
      continue;
    }
    for (const control of descriptor.controls) {
      if (control.editable === false || control.type === "look" || !Object.hasOwn(savedLayout, control.id)) {
        continue;
      }
      const layoutPatch = sanitizeTouchLayoutPatch(savedLayout[control.id]);
      if (Object.keys(layoutPatch).length > 0) {
        profile.layouts[presetId][control.id] = layoutPatch;
      }
    }
  }
  return profile;
}

/** @type {Record<TouchControlRole, TouchControlLayout>} */
const LANDSCAPE_ROLE_LAYOUTS = {
  move: { x: 0.16, y: 0.77, size: 128, opacity: 0.65 },
  look: { x: 0.75, y: 0.5, size: 160, opacity: 0.25 },
  primary: { x: 0.85, y: 0.77, size: 80, opacity: 0.75 },
  secondary: { x: 0.73, y: 0.62, size: 64, opacity: 0.65 },
  reload: { x: 0.92, y: 0.47, size: 52, opacity: 0.6 },
  jump: { x: 0.65, y: 0.79, size: 64, opacity: 0.65 },
  utility: { x: 0.91, y: 0.29, size: 52, opacity: 0.6 },
};

/** @type {Record<TouchControlRole, TouchLayoutPatch>} */
const PORTRAIT_ROLE_LAYOUTS = {
  move: { x: 0.2, y: 0.82, size: 112 },
  look: {},
  primary: { x: 0.82, y: 0.82, size: 76 },
  secondary: { x: 0.7, y: 0.66 },
  reload: { x: 0.9, y: 0.55 },
  jump: { x: 0.58, y: 0.84 },
  utility: { x: 0.87, y: 0.34 },
};

/**
 * Resolve a preset without inventing unsupported actions or altering source objects.
 * X/Y are normalized centers; renderers must inset circles to keep their actual
 * pixel size within the available host, including at saved coordinates zero/one.
 * @param {TouchControlsDescriptor|undefined} descriptor
 * @param {unknown} profile
 * @param {TouchOrientation} [orientation="landscape"]
 * @returns {ResolvedTouchControl[]}
 */
export function resolveTouchLayout(descriptor, profile, orientation = "landscape") {
  if (!descriptor) {
    return [];
  }
  const safeProfile = sanitizeTouchProfile(descriptor, profile);
  const roleCounts = new Map();

  return descriptor.controls.map((control) => {
    const roleIndex = roleCounts.get(control.role) ?? 0;
    roleCounts.set(control.role, roleIndex + 1);
    const defaultLayout = {
      ...LANDSCAPE_ROLE_LAYOUTS[control.role],
      ...(orientation === "portrait" ? PORTRAIT_ROLE_LAYOUTS[control.role] : {}),
    };
    if (safeProfile.presetId !== "two-thumb" && control.role === "primary") {
      defaultLayout.x = 0.15;
      defaultLayout.y = orientation === "portrait" ? 0.18 : 0.22;
    }
    if (safeProfile.presetId === "four-finger" && control.role === "secondary") {
      defaultLayout.x = 0.85;
      defaultLayout.y = orientation === "portrait" ? 0.18 : 0.22;
    }
    // Repeated utility/role controls remain distinct without game-specific slots.
    defaultLayout.x = Math.max(0.08, defaultLayout.x - roleIndex % 4 * 0.1);
    defaultLayout.y = Math.max(0.1, defaultLayout.y - Math.floor(roleIndex / 4) * 0.13);

    return {
      ...control,
      ...(control.defaultLayout ? { defaultLayout: { ...control.defaultLayout } } : {}),
      ...defaultLayout,
      ...control.defaultLayout,
      ...safeProfile.layouts[safeProfile.presetId][control.id],
    };
  });
}

/**
 * Copy an editor draft and update only its selected preset. The final save must
 * sanitize against a descriptor so developer permissions remain authoritative.
 * @param {TouchProfile} profile
 * @param {string} controlId
 * @param {TouchLayoutPatch} patch
 * @returns {TouchProfile}
 */
export function updateTouchControl(profile, controlId, patch) {
  const ownedProfile = createDefaultTouchProfile();
  if (TOUCH_PRESET_IDS.includes(profile?.presetId)) {
    ownedProfile.presetId = profile.presetId;
  }
  ownedProfile.mode = PROFILE_MODES.has(profile?.mode) ? profile.mode : "auto";
  ownedProfile.hideShell = profile?.hideShell === true;

  for (const presetId of TOUCH_PRESET_IDS) {
    const overrides = profile?.layouts?.[presetId];
    if (!isTouchMetadataObject(overrides)) {
      continue;
    }
    let copiedControls = 0;
    for (const existingControlId of Object.keys(overrides)) {
      if (!isSupportedTouchControlId(existingControlId)) {
        continue;
      }
      if (copiedControls >= MAX_TOUCH_CONTROLS) {
        break;
      }
      ownedProfile.layouts[presetId][existingControlId] = sanitizeTouchLayoutPatch(overrides[existingControlId]);
      copiedControls += 1;
    }
  }

  if (isSupportedTouchControlId(controlId)) {
    const currentLayout = ownedProfile.layouts[ownedProfile.presetId];
    if (Object.hasOwn(currentLayout, controlId) || Object.keys(currentLayout).length < MAX_TOUCH_CONTROLS) {
      currentLayout[controlId] = { ...currentLayout[controlId], ...sanitizeTouchLayoutPatch(patch) };
    }
  }
  return ownedProfile;
}
