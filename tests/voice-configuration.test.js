import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createVoiceConfiguration } from "../server/platform-backend-engine/core/voiceConfiguration.js";

test("voice defaults to public STUN and allows explicitly disabling discovery", () => {
  const defaultConfiguration = createVoiceConfiguration({ env: {} });
  const disabledConfiguration = createVoiceConfiguration({ env: { VOICE_STUN_URLS: "" } });

  assert.deepEqual(defaultConfiguration.createIceServers("participant-1"), [
    { urls: ["stun:stun.l.google.com:19302"] },
  ]);
  assert.deepEqual(disabledConfiguration.createIceServers("participant-1"), []);
});

test("voice TURN credentials expire and derive from the participant without exposing the secret", () => {
  const configuration = createVoiceConfiguration({
    env: {
      VOICE_STUN_URLS: "stun:discovery.example:3478, stuns:discovery.example:5349",
      VOICE_TURN_URLS: "turn:relay.example:3478?transport=udp,turns:relay.example:5349?transport=tcp",
      VOICE_TURN_SECRET: "test-only-turn-shared-secret",
    },
    nowFn: () => 1700000000123,
  });
  const iceServers = configuration.createIceServers("participant-1");

  assert.deepEqual(iceServers, [
    { urls: ["stun:discovery.example:3478", "stuns:discovery.example:5349"] },
    {
      urls: ["turn:relay.example:3478?transport=udp", "turns:relay.example:5349?transport=tcp"],
      username: "1700000600:participant-1",
      credential: createHmac("sha1", "test-only-turn-shared-secret")
        .update("1700000600:participant-1").digest("base64"),
    },
  ]);
  assert.equal(JSON.stringify(iceServers).includes("test-only-turn-shared-secret"), false);
  assert.notEqual(configuration.createIceServers("participant-2")[1].credential, iceServers[1].credential);
});

test("voice configuration is parsed once and returns independently owned ICE arrays", () => {
  let nowMs = 100000;
  const env = {
    VOICE_TURN_URLS: "turn:[2001:db8::1]:3478",
    VOICE_TURN_SECRET: "test-only-turn-shared-secret",
    VOICE_TURN_TTL_SECONDS: "9000",
  };
  const configuration = createVoiceConfiguration({ env, nowFn: () => nowMs });
  env.VOICE_TURN_SECRET = "changed-after-configuration";
  env.VOICE_STUN_URLS = "stun:changed.example";
  const firstIceServers = configuration.createIceServers("participant-1");
  firstIceServers[0].urls.push("stun:untrusted.example");
  firstIceServers[1].username = "mutated";
  nowMs += 10000;
  const nextIceServers = configuration.createIceServers("participant-1");

  assert.deepEqual(nextIceServers[0], { urls: ["stun:stun.l.google.com:19302"] });
  assert.equal(nextIceServers[1].username, "3710:participant-1");
  assert.equal(nextIceServers[1].credential,
    createHmac("sha1", "test-only-turn-shared-secret").update("3710:participant-1").digest("base64"));
});

for (const [description, env] of [
  ["HTTP discovery URLs", { VOICE_STUN_URLS: "https://discovery.example" }],
  ["STUN credentials", { VOICE_STUN_URLS: "stun:user:password@discovery.example" }],
  ["TURN credentials in URLs", { VOICE_TURN_URLS: "turn:user:password@relay.example", VOICE_TURN_SECRET: "test-only-secret" }],
  ["a TURN URL without a secret", { VOICE_TURN_URLS: "turn:relay.example" }],
  ["a secret without a TURN URL", { VOICE_TURN_SECRET: "test-only-secret" }],
  ["oversized discovery URLs", { VOICE_STUN_URLS: `stun:${"a".repeat(600)}.example` }],
  ["too many discovery URLs", { VOICE_STUN_URLS: Array.from({ length: 9 }, (_, index) => `stun:host${index}.example`).join(",") }],
  ["invalid ports", { VOICE_STUN_URLS: "stun:discovery.example:65536" }],
  ["invalid relay transport", { VOICE_TURN_URLS: "turn:relay.example?transport=sctp", VOICE_TURN_SECRET: "test-only-secret" }],
  ["control characters in secrets", { VOICE_TURN_URLS: "turn:relay.example", VOICE_TURN_SECRET: "secret\nwith-newline" }],
  ["oversized relay secrets", { VOICE_TURN_URLS: "turn:relay.example", VOICE_TURN_SECRET: "x".repeat(1025) }],
  ["invalid credential lifetimes", { VOICE_TURN_TTL_SECONDS: "0" }],
  ["fractional credential lifetimes", { VOICE_TURN_TTL_SECONDS: "60.5" }],
]) {
  test(`voice configuration rejects ${description}`, () => {
    assert.throws(() => createVoiceConfiguration({ env }), TypeError);
  });
}

test("TURN usernames reject participant identifiers that can change credential boundaries", () => {
  const configuration = createVoiceConfiguration({
    env: { VOICE_TURN_URLS: "turn:relay.example", VOICE_TURN_SECRET: "test-only-secret" },
  });

  assert.throws(() => configuration.createIceServers("other:participant"), TypeError);
});
