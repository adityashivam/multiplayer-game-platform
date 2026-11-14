/** @typedef {import("./matchEvents.js").LastFuseMatchEvent} LastFuseMatchEvent */

const MASTER_VOLUME = 0.32;
const MAX_VOICES_PER_FRAME = 4;
const MIN_TICK_INTERVAL_SEC = 0.09;

/**
 * Synthesized sound set; no audio files to download. The context starts only
 * after a user gesture. Failures stay silent and never affect gameplay.
 * @returns {{unlock():void,toggleMute():boolean,play(events:readonly LastFuseMatchEvent[],playerId:string):void,updateFuse(fuse:{active:boolean,fuseSec:number,near:boolean}):void,dispose():void}}
 */
export function createLastFuseAudio() {
  /** @type {AudioContext|null} */
  let context = null;
  /** @type {GainNode|null} */
  let master = null;
  /** @type {AudioBuffer|null} */
  let noiseBuffer = null;
  let muted = false;
  let nextTickAt = 0;

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

  /** @param {LastFuseMatchEvent} event @param {string} playerId */
  function playEvent(event, playerId) {
    const local = event.runnerId === playerId || event.fromId === playerId;
    switch (event.kind) {
      case "armed":
        playNoise(0.35, 5200, 0.22, "highpass");
        playTone(220, 440, 0.18, "triangle", 0.18);
        break;
      case "pass":
        playNoise(0.08, 2400, local ? 0.4 : 0.22);
        playTone(local ? 520 : 380, local ? 260 : 220, 0.14, "square", local ? 0.22 : 0.12);
        break;
      case "blast":
        playNoise(1.2, 420, 0.75);
        playTone(110, 32, 0.9, "sawtooth", 0.4);
        break;
      case "fall": if (local) playTone(620, 110, 0.6, "sine", 0.22); break;
      case "crumbleWarning": playNoise(1.4, 260, 0.35); break;
      case "collapse": playNoise(0.9, 180, 0.55); break;
      case "jump": if (local) playNoise(0.07, 1600, 0.12); break;
      case "dash": if (local) playNoise(0.14, 3000, 0.18, "bandpass"); break;
      case "round":
        playTone(523, 1046, 0.32, "triangle", 0.24);
        playTone(659, 1318, 0.4, "sine", 0.16);
        break;
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
    play(events, playerId) {
      if (!ready()) return;
      try {
        for (let index = 0; index < events.length && index < MAX_VOICES_PER_FRAME; index += 1) playEvent(events[index], playerId);
      } catch {
        // Audio is decoration; a failed node must never interrupt the frame.
      }
    },
    /**
     * Fuse ticks quicken as the fuse burns; louder when the bomb is yours or near.
     * @param {{active:boolean,fuseSec:number,near:boolean}} fuse
     */
    updateFuse({ active, fuseSec, near }) {
      if (!ready() || !active) return;
      const now = context.currentTime;
      if (now < nextTickAt) return;
      const intervalSec = Math.max(MIN_TICK_INTERVAL_SEC, Math.min(1, fuseSec / 8));
      nextTickAt = now + intervalSec;
      try {
        playTone(fuseSec < 3 ? 1480 : 1120, fuseSec < 3 ? 1480 : 1120, 0.045, "square", near ? 0.12 : 0.035);
      } catch {
        // Ignore audio node failures.
      }
    },
    dispose() {
      context?.close().catch(() => {});
      context = null;
      master = null;
    },
  };
}
