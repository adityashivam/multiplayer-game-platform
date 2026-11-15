/**
 * Short synthesized interface sounds: no audio files to download. One shared
 * player follows the platform's sound mute; failures stay silent.
 */

/**
 * @typedef {"move"|"select"|"back"|"tab"|"error"|"countdown"|"go"} UiSoundKind
 * @typedef {{type:OscillatorType,from:number,to:number,startSec:number,durationSec:number,volume:number}} UiTone
 */

/** @type {Readonly<Record<UiSoundKind, readonly UiTone[]>>} */
const UI_SOUNDS = Object.freeze({
  move: [{ type: "triangle", from: 760, to: 940, startSec: 0, durationSec: 0.06, volume: 0.045 }],
  tab: [{ type: "sine", from: 620, to: 820, startSec: 0, durationSec: 0.08, volume: 0.05 }],
  select: [
    { type: "triangle", from: 523, to: 523, startSec: 0, durationSec: 0.08, volume: 0.06 },
    { type: "triangle", from: 784, to: 988, startSec: 0.06, durationSec: 0.14, volume: 0.06 },
  ],
  back: [{ type: "triangle", from: 660, to: 392, startSec: 0, durationSec: 0.11, volume: 0.05 }],
  error: [{ type: "square", from: 220, to: 180, startSec: 0, durationSec: 0.14, volume: 0.035 }],
  countdown: [{ type: "sine", from: 660, to: 660, startSec: 0, durationSec: 0.12, volume: 0.07 }],
  go: [
    { type: "triangle", from: 880, to: 880, startSec: 0, durationSec: 0.1, volume: 0.07 },
    { type: "triangle", from: 1320, to: 1320, startSec: 0.08, durationSec: 0.32, volume: 0.07 },
  ],
});

/** Every sound the player knows, for menus and tests. */
export const UI_SOUND_KINDS = Object.freeze(/** @type {UiSoundKind[]} */ (Object.keys(UI_SOUNDS)));

/**
 * @param {{createContext?:()=>AudioContext}} [options] The context is created on the first unmuted sound.
 * @returns {{play:(kind:UiSoundKind)=>void,setMuted:(muted:boolean)=>void}}
 */
export function createUiSoundPlayer({ createContext = () => new (globalThis.AudioContext || globalThis.webkitAudioContext)() } = {}) {
  /** @type {AudioContext|null} */
  let context = null;
  let muted = false;

  /** @param {UiTone} tone */
  function playTone(tone) {
    const start = context.currentTime + tone.startSec;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = tone.type;
    oscillator.frequency.setValueAtTime(tone.from, start);
    if (tone.to !== tone.from) oscillator.frequency.exponentialRampToValueAtTime(tone.to, start + tone.durationSec);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.linearRampToValueAtTime(tone.volume, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.durationSec);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + tone.durationSec + 0.02);
  }

  return {
    play(kind) {
      const tones = Object.hasOwn(UI_SOUNDS, kind) ? UI_SOUNDS[kind] : null;
      if (muted || !tones) return;
      try {
        context ??= createContext();
        if (context.state === "suspended") void context.resume?.();
        tones.forEach(playTone);
      } catch {
        // Sound is decoration; a missing or blocked audio device changes nothing.
      }
    },
    setMuted(nextMuted) {
      muted = Boolean(nextMuted);
    },
  };
}

/** The platform-wide player. Its mute follows the Config sound switch. */
export const uiSounds = createUiSoundPlayer();
