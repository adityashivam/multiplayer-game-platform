import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultTouchProfile, updateTouchControl } from "../public/platform/shared/touchControls.js";
import { loadTouchProfile, saveTouchProfile, subscribeTouchProfile } from "../public/platform/frontend-engine/touchControlSettings.js";

const descriptor = {
  apiVersion: 1,
  customizable: true,
  defaultPreset: "two-thumb",
  allowedPresets: ["two-thumb", "three-finger", "four-finger"],
  controls: [{ id: "steer", type: "stick", role: "move", label: "Steer" }],
};

function installSettingsEnvironment(testContext) {
  const previousWindow = globalThis.window;
  const settingsWindow = new EventTarget();
  const storage = new Map();
  const localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  settingsWindow.localStorage = localStorage;
  settingsWindow.CustomEvent = CustomEvent;
  globalThis.window = settingsWindow;
  testContext.after(() => {
    if (previousWindow === undefined) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  });
  return { settingsWindow, storage, localStorage };
}

test("touch profiles persist per game and orientation with owned values", (testContext) => {
  installSettingsEnvironment(testContext);
  const draft = updateTouchControl(createDefaultTouchProfile(descriptor), "steer", { x: 0.32, size: 90 });
  draft.presetId = "three-finger";
  draft.mode = "on";
  const saved = saveTouchProfile("relay", descriptor, "portrait", draft);
  assert.equal(saved.persisted, true);
  saved.profile.layouts["two-thumb"].steer.x = 0.99;
  draft.layouts["two-thumb"].steer.x = 0.8;

  const loaded = loadTouchProfile("relay", descriptor, "portrait");
  assert.equal(loaded.layouts["two-thumb"].steer.x, 0.32);
  assert.equal(loaded.presetId, "three-finger");
  assert.equal(loaded.mode, "on");
  assert.deepEqual(loadTouchProfile("relay", descriptor, "landscape"), createDefaultTouchProfile(descriptor));
  assert.deepEqual(loadTouchProfile("other", descriptor, "portrait"), createDefaultTouchProfile(descriptor));
});

test("blocked and quota-limited storage retains the edited session profile across bundles", async (testContext) => {
  const { settingsWindow, localStorage } = installSettingsEnvironment(testContext);
  const peerSettings = await import("../public/platform/frontend-engine/touchControlSettings.js?peer-bundle");
  saveTouchProfile("relay", descriptor, "portrait", updateTouchControl(createDefaultTouchProfile(descriptor), "steer", { x: 0.2 }));
  localStorage.setItem = () => { throw new Error("quota exceeded"); };
  const saved = saveTouchProfile("relay", descriptor, "portrait", updateTouchControl(createDefaultTouchProfile(descriptor), "steer", { x: 0.7 }));
  assert.equal(saved.persisted, false);
  assert.equal(peerSettings.loadTouchProfile("relay", descriptor, "portrait").layouts["two-thumb"].steer.x, 0.7);

  Object.defineProperty(settingsWindow, "localStorage", { get() { throw new Error("storage blocked"); } });
  const blocked = peerSettings.saveTouchProfile("relay", descriptor, "landscape", updateTouchControl(createDefaultTouchProfile(descriptor), "steer", { size: 120 }));
  assert.equal(blocked.persisted, false);
  assert.equal(loadTouchProfile("relay", descriptor, "landscape").layouts["two-thumb"].steer.size, 120);
});

test("profile subscribers see same-tab and cross-tab edits and ignore malformed remote values", async (testContext) => {
  const { settingsWindow, storage } = installSettingsEnvironment(testContext);
  const peerSettings = await import("../public/platform/frontend-engine/touchControlSettings.js?subscriber-bundle");
  const observed = [];
  const unsubscribe = subscribeTouchProfile("relay", descriptor, "portrait", (profile) => {
    observed.push(profile.layouts["two-thumb"].steer?.x ?? null);
    profile.mode = "off";
  });
  testContext.after(unsubscribe);
  peerSettings.saveTouchProfile("relay", descriptor, "portrait", updateTouchControl(createDefaultTouchProfile(descriptor), "steer", { x: 0.4 }));
  assert.deepEqual(observed, [0.4]);
  assert.equal(loadTouchProfile("relay", descriptor, "portrait").mode, "auto");
  const storageKey = [...storage.keys()][0];
  const remoteProfile = updateTouchControl(createDefaultTouchProfile(descriptor), "steer", { x: 0.6 });
  storage.set(storageKey, JSON.stringify(remoteProfile));
  settingsWindow.dispatchEvent(Object.assign(new Event("storage"), { key: storageKey, newValue: JSON.stringify(remoteProfile) }));
  assert.deepEqual(observed, [0.4, 0.6]);
  assert.equal(loadTouchProfile("relay", descriptor, "portrait").layouts["two-thumb"].steer.x, 0.6);

  storage.set(storageKey, "{broken");
  settingsWindow.dispatchEvent(Object.assign(new Event("storage"), { key: storageKey, newValue: "{broken" }));
  assert.equal(observed.length, 2);
  assert.equal(loadTouchProfile("relay", descriptor, "portrait").layouts["two-thumb"].steer.x, 0.6);
  unsubscribe();
  peerSettings.saveTouchProfile("relay", descriptor, "portrait", remoteProfile);
  assert.equal(observed.length, 2);
});

test("old preferences cannot override a developer lock or removed control", (testContext) => {
  const { storage } = installSettingsEnvironment(testContext);
  saveTouchProfile("relay", descriptor, "portrait", updateTouchControl(createDefaultTouchProfile(descriptor), "steer", { x: 0.4 }));
  assert.deepEqual(loadTouchProfile("relay", { ...descriptor, customizable: false }, "portrait"), createDefaultTouchProfile(descriptor));
  const updatedDescriptor = { ...descriptor, controls: [{ id: "new-steer", type: "stick", role: "move", label: "Steer" }] };
  assert.deepEqual(loadTouchProfile("relay", updatedDescriptor, "portrait").layouts["two-thumb"], {});
  storage.set([...storage.keys()][0], "not JSON");
  assert.doesNotThrow(() => loadTouchProfile("relay", descriptor, "portrait"));
});

test("stored version-one profiles migrate under the existing storage key and preserve later explicit choices", (testContext) => {
  const { storage } = installSettingsEnvironment(testContext);
  const storageKey = "platform.touch-controls.v1:relay:landscape";
  storage.set(storageKey, JSON.stringify({
    version: 1,
    presetId: "four-finger",
    mode: "off",
    hideShell: false,
    layouts: { "four-finger": { steer: { x: 0.28, y: 0.76, size: 96, opacity: 0.85 } } },
  }));
  const migratedProfile = loadTouchProfile("relay", descriptor, "landscape");
  assert.equal(migratedProfile.version, 2);
  assert.equal(migratedProfile.hideShell, true);
  assert.equal(migratedProfile.mode, "auto");
  assert.equal(migratedProfile.presetId, "four-finger");
  assert.deepEqual(migratedProfile.layouts["four-finger"].steer, { x: 0.28, y: 0.76, size: 96, opacity: 0.4 });

  const editedProfile = updateTouchControl(migratedProfile, "steer", { opacity: 0.85 });
  editedProfile.hideShell = false;
  editedProfile.mode = "off";
  saveTouchProfile("relay", descriptor, "landscape", editedProfile);
  assert.deepEqual([...storage.keys()], [storageKey]);
  assert.equal(JSON.parse(storage.get(storageKey)).version, 2);
  const reloadedProfile = loadTouchProfile("relay", descriptor, "landscape");
  assert.equal(reloadedProfile.hideShell, false);
  assert.equal(reloadedProfile.mode, "off");
  assert.equal(reloadedProfile.layouts["four-finger"].steer.opacity, 0.85);
});
