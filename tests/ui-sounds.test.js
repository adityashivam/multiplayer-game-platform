import test from "node:test";
import assert from "node:assert/strict";
import { UI_SOUND_KINDS, createUiSoundPlayer } from "../public/platform/src/platform-ui/services/uiSounds.js";

/** A minimal Web Audio stand-in that records the tones it is asked to play. */
function createFakeAudioContext() {
  const tones = [];
  const param = () => ({ setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {} });
  return {
    tones,
    state: "running",
    currentTime: 0,
    destination: {},
    resume() {},
    createOscillator() {
      const oscillator = { type: "sine", frequency: param(), connect: (node) => node, start() {}, stop(at) { tones.push({ type: oscillator.type, stopAt: at }); } };
      return oscillator;
    },
    createGain() {
      return { gain: param(), connect: (node) => node };
    },
  };
}

test("each interface sound plays at least one short tone", () => {
  const context = createFakeAudioContext();
  const player = createUiSoundPlayer({ createContext: () => context });
  for (const kind of UI_SOUND_KINDS) player.play(kind);
  assert.ok(context.tones.length >= UI_SOUND_KINDS.length);
  assert.ok(context.tones.every((tone) => tone.stopAt <= 0.6), "every tone ends within 0.6 s");
});

test("muted sounds never create an audio context", () => {
  let created = 0;
  const player = createUiSoundPlayer({ createContext: () => { created += 1; return createFakeAudioContext(); } });
  player.setMuted(true);
  player.play("select");
  assert.equal(created, 0);
  player.setMuted(false);
  player.play("select");
  assert.equal(created, 1);
});

test("unknown sounds and missing audio support are ignored safely", () => {
  const context = createFakeAudioContext();
  const player = createUiSoundPlayer({ createContext: () => context });
  assert.doesNotThrow(() => player.play("unknown"));
  assert.equal(context.tones.length, 0);
  const silent = createUiSoundPlayer({ createContext: () => { throw new Error("no audio"); } });
  assert.doesNotThrow(() => silent.play("move"));
});
