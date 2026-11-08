import test from "node:test";
import assert from "node:assert/strict";
import {
  createDefaultTouchProfile,
  resolveTouchLayout,
  sanitizeTouchProfile,
  updateTouchControl,
  validateTouchControls,
} from "../public/platform/shared/touchControls.js";

function createDescriptor(overrides = {}) {
  return {
    apiVersion: 1,
    customizable: true,
    defaultPreset: "two-thumb",
    allowedPresets: ["two-thumb", "three-finger", "four-finger"],
    controls: [
      { id: "drive", type: "stick", role: "move", label: "Move" },
      { id: "view", type: "look", role: "look", label: "Look", editable: false },
      { id: "tool", type: "button", role: "primary", label: "Use tool", behavior: "hold-look" },
      { id: "alternate", type: "button", role: "secondary", label: "Alternate" },
      { id: "hop", type: "button", role: "jump", label: "Hop", editable: false, defaultLayout: { x: 0.6, size: 60 } },
    ],
    ...overrides,
  };
}

test("touch descriptor rejects unsupported contracts and unbounded metadata before use", () => {
  assert.doesNotThrow(() => validateTouchControls(undefined, "synthetic"));
  assert.doesNotThrow(() => validateTouchControls(createDescriptor(), "synthetic"));

  const invalidDescriptors = [
    null,
    createDescriptor({ apiVersion: 2 }),
    createDescriptor({ customizable: "yes" }),
    createDescriptor({ allowedPresets: ["four-finger"] }),
    createDescriptor({ allowedPresets: ["two-thumb", "two-thumb"] }),
    createDescriptor({ mystery: true }),
    createDescriptor({ controls: Array.from({ length: 17 }, (_, index) => ({ id: `tool-${index}`, type: "button", role: "utility", label: "Tool" })) }),
    createDescriptor({ controls: [{ id: "drive", type: "stick", role: "move", label: "Move" }, { id: "drive", type: "button", role: "jump", label: "Jump" }] }),
    createDescriptor({ controls: [{ id: "__proto__", type: "button", role: "utility", label: "Tool" }] }),
    createDescriptor({ controls: [{ id: "tool", type: "button", role: "invented", label: "Tool" }] }),
    createDescriptor({ controls: [{ id: "tool", type: "button", role: "primary", label: "Tool", behavior: "turbo" }] }),
    createDescriptor({ controls: [{ id: "tool", type: "button", role: "primary", label: "Tool", defaultLayout: { x: NaN } }] }),
    createDescriptor({ controls: [{ id: "tool", type: "button", role: "primary", label: "Tool", defaultLayout: { size: 161 } }] }),
    createDescriptor({ controls: [{ id: "tool", type: "button", role: "primary", label: "Tool", defaultLayout: { opacity: 0.24 } }] }),
    createDescriptor({ controls: [{ id: "tool", type: "button", role: "primary", label: "Tool", extra: true }] }),
  ];
  for (const descriptor of invalidDescriptors) {
    assert.throws(() => validateTouchControls(descriptor, "synthetic"), TypeError);
  }
});

test("control roles remain placement hints for games with different primitive mappings", () => {
  const descriptor = createDescriptor({ controls: [
    { id: "camera-axis", type: "stick", role: "look", label: "Camera axis" },
    { id: "throttle", type: "button", role: "move", label: "Throttle" },
  ] });
  assert.doesNotThrow(() => validateTouchControls(descriptor, "synthetic"));
  const controls = resolveTouchLayout(descriptor, createDefaultTouchProfile(descriptor), "landscape");
  assert.equal(controls[0].type, "stick");
  assert.equal(controls[0].role, "look");
  assert.equal(controls[1].type, "button");
  assert.equal(controls[1].role, "move");
});

test("optional platform bindings accept only compatible standard directions and actions", () => {
  for (const platformBinding of ["horizontal", "vertical", "directions"]) {
    assert.doesNotThrow(() => validateTouchControls(createDescriptor({ controls: [
      { id: "drive", type: "stick", role: "move", label: "Move", platformBinding },
    ] }), "synthetic"));
  }
  for (const platformBinding of ["up", "down", "left", "right", "a", "b", "x", "y"]) {
    assert.doesNotThrow(() => validateTouchControls(createDescriptor({ controls: [
      { id: "tool", type: "button", role: "primary", label: "Tool", platformBinding },
    ] }), "synthetic"));
  }
  for (const control of [
    { id: "drive", type: "stick", role: "move", label: "Move", platformBinding: "a" },
    { id: "tool", type: "button", role: "primary", label: "Tool", platformBinding: "horizontal" },
    { id: "view", type: "look", role: "look", label: "Look", platformBinding: "directions" },
    { id: "tool", type: "button", role: "primary", label: "Tool", platformBinding: "start" },
    { id: "tool", type: "button", role: "primary", label: "Tool", platformBinding: { action: "a" } },
  ]) {
    assert.throws(() => validateTouchControls(createDescriptor({ controls: [control] }), "synthetic"), TypeError);
  }
});

test("presets move only declared actions and portrait layout has independent defaults", () => {
  const descriptor = createDescriptor();
  const profile = createDefaultTouchProfile(descriptor);
  assert.equal(profile.mode, "auto");
  assert.equal(profile.hideShell, true);
  const twoThumb = resolveTouchLayout(descriptor, profile, "landscape");
  const threeFinger = resolveTouchLayout(descriptor, { ...profile, presetId: "three-finger" }, "landscape");
  const fourFinger = resolveTouchLayout(descriptor, { ...profile, presetId: "four-finger" }, "landscape");
  const portrait = resolveTouchLayout(descriptor, profile, "portrait");

  assert.deepEqual(twoThumb.map((control) => control.id), ["drive", "view", "tool", "alternate", "hop"]);
  assert.ok(twoThumb.find((control) => control.id === "tool").x > 0.5);
  assert.ok(threeFinger.find((control) => control.id === "tool").x < 0.5);
  assert.ok(threeFinger.find((control) => control.id === "tool").y < 0.4);
  assert.ok(fourFinger.find((control) => control.id === "alternate").y < 0.4);
  assert.notDeepEqual(portrait.find((control) => control.id === "drive"), twoThumb.find((control) => control.id === "drive"));
  assert.equal(twoThumb.find((control) => control.id === "hop").x, 0.6);
  assert.equal(twoThumb.find((control) => control.id === "hop").size, 60);
  assert.ok(twoThumb.every((control) => control.opacity <= 0.4));
  twoThumb[0].defaultLayout = { x: 0 };
  assert.equal(descriptor.controls[0].defaultLayout, undefined);
});

test("profile sanitization bounds finite values, drops stale controls and honors developer locks", () => {
  const descriptor = createDescriptor();
  const candidate = {
    version: 2,
    presetId: "four-finger",
    mode: "on",
    hideShell: true,
    layouts: {
      "two-thumb": { drive: { x: 0.2 } },
      "four-finger": {
        drive: { x: -4, y: 8, size: 1000, opacity: 0, arbitrary: 2 },
        tool: { x: NaN, y: Infinity, size: "88", opacity: 0.8 },
        hop: { x: 0.1, size: 150 },
        view: { x: 0, size: 160 },
        removed: { x: 0.4 },
      },
    },
  };
  const profile = sanitizeTouchProfile(descriptor, candidate);
  assert.deepEqual(profile.layouts["four-finger"], {
    drive: { x: 0, y: 1, size: 160, opacity: 0.25 },
    tool: { opacity: 0.8 },
  });
  assert.equal(profile.mode, "on");
  assert.equal(profile.hideShell, true);
  profile.layouts["two-thumb"].drive.x = 0.7;
  assert.equal(candidate.layouts["two-thumb"].drive.x, 0.2);
  assert.equal(resolveTouchLayout(descriptor, profile, "portrait").find((control) => control.id === "hop").x, 0.6);

  const lockedDescriptor = createDescriptor({ customizable: false });
  assert.deepEqual(sanitizeTouchProfile(lockedDescriptor, candidate), createDefaultTouchProfile(lockedDescriptor));
  assert.deepEqual(sanitizeTouchProfile(descriptor, { ...candidate, version: 999 }), createDefaultTouchProfile(descriptor));
  assert.deepEqual(sanitizeTouchProfile(descriptor, { ...candidate, presetId: "obsolete", mode: "unsupported" }).presetId, "two-thumb");
});

test("legacy profiles retain authored layouts while adopting expanded low-opacity presentation", () => {
  const descriptor = createDescriptor();
  const legacyProfile = {
    version: 1,
    presetId: "three-finger",
    mode: "off",
    hideShell: false,
    layouts: {
      "two-thumb": { drive: { x: 0.22, y: 0.81, size: 90, opacity: 0.35 } },
      "three-finger": { tool: { x: 0.24, y: 0.2, size: 72, opacity: 0.9 } },
    },
  };
  const migratedProfile = sanitizeTouchProfile(descriptor, legacyProfile);
  assert.equal(migratedProfile.version, 2);
  assert.equal(migratedProfile.presetId, "three-finger");
  assert.equal(migratedProfile.mode, "auto");
  assert.equal(migratedProfile.hideShell, true);
  assert.deepEqual(migratedProfile.layouts["two-thumb"].drive, { x: 0.22, y: 0.81, size: 90, opacity: 0.35 });
  assert.deepEqual(migratedProfile.layouts["three-finger"].tool, { x: 0.24, y: 0.2, size: 72, opacity: 0.4 });

  const explicitProfile = sanitizeTouchProfile(descriptor, {
    ...migratedProfile,
    mode: "off",
    hideShell: false,
    layouts: { "three-finger": { tool: { opacity: 0.95 } } },
  });
  assert.equal(explicitProfile.mode, "off");
  assert.equal(explicitProfile.hideShell, false);
  assert.equal(resolveTouchLayout(descriptor, explicitProfile).find((control) => control.id === "tool").opacity, 0.95);
  assert.equal(legacyProfile.layouts["three-finger"].tool.opacity, 0.9);
});

test("editing one preset produces owned bounded overrides without changing other presets", () => {
  const profile = createDefaultTouchProfile(createDescriptor());
  profile.layouts["three-finger"].drive = { x: 0.3 };
  const updated = updateTouchControl(profile, "tool", { x: 0.75, y: 0.8, size: 10, opacity: 2 });
  assert.deepEqual(updated.layouts["two-thumb"].tool, { x: 0.75, y: 0.8, size: 44, opacity: 1 });
  assert.deepEqual(profile.layouts["two-thumb"], {});
  updated.layouts["three-finger"].drive.x = 0.9;
  assert.equal(profile.layouts["three-finger"].drive.x, 0.3);
  assert.deepEqual(updateTouchControl(updated, "constructor", { x: 0 }).layouts, updated.layouts);
});
