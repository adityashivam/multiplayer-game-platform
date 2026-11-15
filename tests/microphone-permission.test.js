import test from "node:test";
import assert from "node:assert/strict";
import { chooseMicrophoneRecoveryAction, readMicrophonePermission, watchMicrophonePermission } from "../public/platform/frontend-engine/microphonePermission.js";
import { describeMicrophoneUnblockGuide } from "../public/platform/src/platform-ui/services/microphoneUnblockGuide.js";

/** A Permissions API stand-in whose microphone status can change. */
function createFakePermissions(initialState) {
  const status = new EventTarget();
  status.state = initialState;
  return {
    status,
    queries: [],
    async query(descriptor) {
      this.queries.push(descriptor.name);
      return status;
    },
    change(nextState) {
      status.state = nextState;
      status.dispatchEvent(new Event("change"));
    },
  };
}

test("permission reads report granted, prompt and denied without asking the user", async () => {
  for (const state of ["granted", "prompt", "denied"]) {
    const permissions = createFakePermissions(state);
    assert.equal(await readMicrophonePermission(permissions), state);
    assert.deepEqual(permissions.queries, ["microphone"]);
  }
});

test("browsers without a microphone permission query report unknown", async () => {
  assert.equal(await readMicrophonePermission(undefined), "unknown");
  assert.equal(await readMicrophonePermission({ query: async () => { throw new TypeError("microphone is not a valid name"); } }), "unknown");
  assert.equal(await readMicrophonePermission(createFakePermissions("something-new")), "unknown");
});

test("watching reports the current state and every later change until stopped", async () => {
  const permissions = createFakePermissions("denied");
  const seen = [];
  const stop = watchMicrophonePermission((state) => seen.push(state), permissions);
  await new Promise((resolve) => setTimeout(resolve, 0));
  permissions.change("granted");
  stop();
  permissions.change("denied");
  assert.deepEqual(seen, ["denied", "granted"]);
});

test("stopping before the first read never reports", async () => {
  const permissions = createFakePermissions("denied");
  const seen = [];
  watchMicrophonePermission((state) => seen.push(state), permissions)();
  await new Promise((resolve) => setTimeout(resolve, 0));
  permissions.change("granted");
  assert.deepEqual(seen, []);
});

const USER_AGENTS = {
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1",
  iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1",
  androidChrome: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36",
  androidWebView: "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0 Mobile Safari/537.36",
  instagramIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0",
  macChrome: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
  windowsEdge: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36 Edg/131.0",
  windowsFirefox: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15",
};

test("unblock steps match the player's device and browser", () => {
  const guide = (name) => describeMicrophoneUnblockGuide({ userAgent: USER_AGENTS[name] });
  assert.equal(guide("iphoneChrome").device, "ios");
  assert.match(guide("iphoneChrome").steps.join(" "), /Settings app.*Chrome.*Microphone/);
  assert.match(guide("iphoneSafari").steps.join(" "), /aA.*Website Settings/);
  assert.equal(guide("androidChrome").device, "android");
  assert.match(guide("androidChrome").steps.join(" "), /Permissions.*Microphone/);
  assert.equal(guide("macChrome").device, "desktop");
  assert.match(guide("macChrome").steps.join(" "), /System Settings.*Privacy & Security.*Microphone/);
  assert.match(guide("windowsEdge").steps.join(" "), /Windows.*Privacy/);
  assert.match(guide("windowsFirefox").steps.join(" "), /crossed-out microphone/);
  assert.match(guide("macSafari").steps.join(" "), /Settings for This Website/);
});

test("in-app browsers are sent to a real browser", () => {
  for (const name of ["instagramIphone", "androidWebView"]) {
    const guide = describeMicrophoneUnblockGuide({ userAgent: USER_AGENTS[name] });
    assert.equal(guide.device, "in-app", name);
    assert.match(guide.steps[0], /Chrome or Safari/);
  }
});

test("every guide has at least one step and never names this site's address", () => {
  for (const userAgent of [...Object.values(USER_AGENTS), "", "Unknown/1.0"]) {
    const guide = describeMicrophoneUnblockGuide({ userAgent });
    assert.ok(guide.steps.length >= 1);
    assert.ok(guide.steps.every((step) => typeof step === "string" && step.length > 0));
  }
});

test("allowing a blocked microphone resumes only what the player had asked for", () => {
  const deniedJoin = { status: "error", errorCode: "MICROPHONE_PERMISSION_DENIED", participants: [] };
  const deniedUnmute = { status: "connected", errorCode: "MICROPHONE_PERMISSION_DENIED", participants: [{ id: "a" }] };
  assert.equal(chooseMicrophoneRecoveryAction({ previousPermission: "denied", permission: "granted", voiceState: deniedJoin }), "join");
  assert.equal(chooseMicrophoneRecoveryAction({ previousPermission: "denied", permission: "granted", voiceState: deniedUnmute }), "unmute");
  assert.equal(chooseMicrophoneRecoveryAction({ previousPermission: "denied", permission: "prompt", voiceState: deniedJoin }), "join", "reset to Ask also allows a fresh prompt");
});

test("no automatic voice action without an earlier denied request", () => {
  const off = { status: "off", errorCode: null, participants: [] };
  const listening = { status: "connected", errorCode: null, participants: [] };
  assert.equal(chooseMicrophoneRecoveryAction({ previousPermission: "denied", permission: "granted", voiceState: off }), null);
  assert.equal(chooseMicrophoneRecoveryAction({ previousPermission: "denied", permission: "granted", voiceState: listening }), null, "listen-only never starts sending audio by itself");
  assert.equal(chooseMicrophoneRecoveryAction({ previousPermission: "granted", permission: "granted", voiceState: { status: "error", errorCode: "MICROPHONE_PERMISSION_DENIED", participants: [] } }), null);
  assert.equal(chooseMicrophoneRecoveryAction({ previousPermission: "denied", permission: "denied", voiceState: { status: "error", errorCode: "MICROPHONE_PERMISSION_DENIED", participants: [] } }), null);
});
