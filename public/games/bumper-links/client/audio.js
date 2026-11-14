/** @typedef {import("./matchEvents.js").BumperLinksClientEvent} BumperLinksClientEvent */

const MASTER_VOLUME = 0.32;
const MAX_VOICES_PER_FRAME = 4;

/**
 * Synthesized sound set; no audio files to download. The context starts only
 * after a user gesture. Failures stay silent and never affect gameplay.
 * @returns {{unlock():void,toggleMute():boolean,play(events:readonly BumperLinksClientEvent[],playerId:string):void,dispose():void}}
 */
export function createBumperLinksAudio() {
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
      noiseBuffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
      const samples = noiseBuffer.getChannelData(0);
      for (let index = 0; index < samples.length; index += 1) samples[index] = Math.random() * 2 - 1;
    } catch {
      context = null;
    }
  }

  const ready = () => Boolean(context && master && !muted && context.state === "running");

  /** @param {number} fromHz @param {number} toHz @param {number} durationSec @param {OscillatorType} type @param {number} volume @param {number} [delaySec=0] */
  function playTone(fromHz, toHz, durationSec, type, volume, delaySec = 0) {
    const start = context.currentTime + delaySec;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(fromHz, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, toHz), start + durationSec);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + durationSec);
    oscillator.connect(gain).connect(master);
    oscillator.start(start);
    oscillator.stop(start + durationSec + 0.02);
  }

  /** @param {number} durationSec @param {number} filterHz @param {number} volume @param {BiquadFilterType} [type] */
  function playNoise(durationSec, filterHz, volume, type = "lowpass") {
    const now = context.currentTime;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = noiseBuffer;
    filter.type = type;
    filter.frequency.setValueAtTime(filterHz, now);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);
    source.connect(filter).connect(gain).connect(master);
    source.start(now);
    source.stop(now + durationSec + 0.02);
  }

  /** @param {BumperLinksClientEvent} event @param {string} playerId */
  function playEvent(event, playerId) {
    const local = event.ballId === playerId || event.byId === playerId;
    switch (event.type) {
      case "shot":
        playNoise(0.05, 3800, local ? 0.32 : 0.12, "highpass");
        playTone(900, 600, 0.06, "triangle", local ? 0.16 : 0.06);
        break;
      case "sink":
        playTone(523, 523, 0.14, "triangle", local ? 0.26 : 0.12);
        playTone(659, 659, 0.14, "triangle", local ? 0.24 : 0.1, 0.1);
        playTone(784, 784, 0.26, "triangle", local ? 0.24 : 0.1, 0.2);
        break;
      case "splash":
      case "knockout":
        playNoise(0.6, 900, local ? 0.45 : 0.22);
        playTone(300, 120, 0.3, "sine", local ? 0.16 : 0.06);
        break;
      case "holeStart":
        playTone(440, 880, 0.3, "sine", 0.14);
        break;
      case "holeOver":
        playTone(392, 784, 0.4, "triangle", 0.16);
        break;
      default:
        break;
    }
  }

  return {
    unlock,
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : MASTER_VOLUME;
      return muted;
    },
    play(events, playerId) {
      if (!ready()) return;
      try {
        for (let index = 0; index < events.length && index < MAX_VOICES_PER_FRAME; index += 1) playEvent(events[index], playerId);
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
