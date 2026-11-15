import test from "node:test";
import assert from "node:assert/strict";
import { shouldSuggestHomeScreenFullscreen } from "../public/platform/src/platform-ui/services/homeScreenFullscreen.js";

const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1";
const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const IPAD = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36";

test("iPhone browsers without page fullscreen are pointed to Add to Home Screen", () => {
  for (const userAgent of [IPHONE_CHROME, IPHONE_SAFARI]) {
    assert.equal(shouldSuggestHomeScreenFullscreen({ userAgent, standalone: false, fullscreenEnabled: false }), true, userAgent);
  }
});

test("the tip is not shown once launched from the home screen", () => {
  assert.equal(shouldSuggestHomeScreenFullscreen({ userAgent: IPHONE_CHROME, standalone: true, fullscreenEnabled: false }), false);
});

test("devices with real page fullscreen never see the tip", () => {
  assert.equal(shouldSuggestHomeScreenFullscreen({ userAgent: ANDROID_CHROME, standalone: false, fullscreenEnabled: true }), false);
  assert.equal(shouldSuggestHomeScreenFullscreen({ userAgent: IPAD, standalone: false, fullscreenEnabled: true }), false);
  assert.equal(shouldSuggestHomeScreenFullscreen({ userAgent: IPHONE_CHROME, standalone: false, fullscreenEnabled: true }), false, "a future iPhone that supports it");
});
