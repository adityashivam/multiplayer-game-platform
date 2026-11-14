/** @typedef {import("./matchEvents.js").EdgeoutMatchEvent} EdgeoutMatchEvent */

const MASTER_VOLUME = 0.32;
const MAX_VOICES_PER_FRAME = 4;

/**
 * Small synthesized sound set; no audio files to download. The context starts
 * only after a user gesture, as browsers require. Failures stay silent and
 * never affect gameplay.
 * @returns {{unlock():void,toggleMute():boolean,play(events:readonly EdgeoutMatchEvent[]):void,dispose():void}}
 */
export function createEdgeoutAudio() {
  /** @type {AudioContext|null} */
  let context = null;
  /** @type {GainNode|null} */
  let master = null;
  /** @type {AudioBuffer|null} */
  let noiseBuffer = null;
  let muted = false;

  function unlock() {
    if (context) {
      if (context.state === "suspended") context.resume().catch(() => {});
      return;
    }
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    try {
      context = new AudioContextClass();
      master = context.createGain();
      master.gain.value = muted ? 0 : MASTER_VOLUME;
      master.connect(context.destination);
      noiseBuffer = context.createBuffer(1, context.sampleRate * 0.5, context.sampleRate);
      const samples = noiseBuffer.getChannelData(0);
      for (let index = 0; index < samples.length; index += 1) samples[index] = Math.random() * 2 - 1;
    } catch {
      context = null;
    }
  }

  /** @param {number} fromHz @param {number} toHz @param {number} durationSec @param {OscillatorType} type @param {number} volume */
  function playTone(fromHz, toHz, durationSec, type, volume) {
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(fromHz, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, toHz), now + durationSec);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);
    oscillator.connect(gain).connect(master);
    oscillator.start(now);
    oscillator.stop(now + durationSec + 0.02);
  }

  /** @param {number} durationSec @param {number} filterHz @param {number} volume */
  function playNoise(durationSec, filterHz, volume) {
    const now = context.currentTime;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = noiseBuffer;
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(filterHz, now);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);
    source.connect(filter).connect(gain).connect(master);
    source.start(now);
    source.stop(now + durationSec + 0.02);
  }

  /** @param {EdgeoutMatchEvent} event */
  function playEvent(event) {
    switch (event.kind) {
      case "swing": playNoise(0.09, 1800 + 1600 * event.power, 0.25); break;
      case "dash": playNoise(0.16, 2600, 0.22); break;
      case "hit":
        playTone(180 + 120 * event.power, 60, 0.18 + 0.12 * event.power, "square", 0.32);
        playNoise(0.12, 1200, 0.3);
        break;
      case "blocked": playTone(520, 420, 0.08, "triangle", 0.25); break;
      case "guardBreak":
        playTone(300, 90, 0.25, "sawtooth", 0.25);
        playNoise(0.2, 900, 0.3);
        break;
      case "parry":
        playTone(1320, 1760, 0.14, "triangle", 0.3);
        playTone(880, 1320, 0.22, "sine", 0.22);
        break;
      case "ringOut": playTone(660, 70, 0.75, "sawtooth", 0.24); break;
      case "collapse": playNoise(0.6, 380, 0.45); break;
      case "round": playTone(523, 1046, 0.35, "triangle", 0.26); break;
      default: break;
    }
  }

  return {
    unlock,
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : MASTER_VOLUME;
      return muted;
    },
    play(events) {
      if (!context || !master || muted || context.state !== "running") return;
      try {
        for (let index = 0; index < events.length && index < MAX_VOICES_PER_FRAME; index += 1) playEvent(events[index]);
      } catch {
        // Audio is decoration; a failed node must never interrupt the frame.
      }
    },
    dispose() {
      context?.close().catch(() => {});
      context = null;
      master = null;
    },
  };
}
