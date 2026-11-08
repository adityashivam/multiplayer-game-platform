import { DEAD_SHIFT_WEAPONS } from "../shared/config.js";

const AUDIO_VOLUME = 0.22;
const MAX_SIMULTANEOUS_VOICES = 18;

/**
 * Synthesize compact weapon/impact ambience locally; no audio downloads are required.
 * Audio starts only after a player's interaction and all owned nodes close on exit.
 */
export function createDeadShiftAudio() {
  let audioContext = null;
  let masterGain = null;
  let noiseBuffer = null;
  let muted = false;
  let disposed = false;
  let activeVoices = 0;
  let lastEventId = 0;
  let nextLocalShotAtSec = 0;
  let nextStepAtSec = 0;
  let ambientOscillator = null;

  function unlock() {
    if (disposed || muted) return;
    const BrowserAudioContext = window.AudioContext || window.webkitAudioContext;
    if (!BrowserAudioContext) return;
    if (!audioContext) {
      audioContext = new BrowserAudioContext();
      masterGain = audioContext.createGain();
      masterGain.gain.value = AUDIO_VOLUME;
      masterGain.connect(audioContext.destination);
      noiseBuffer = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
      const noiseSamples = noiseBuffer.getChannelData(0);
      for (let sample = 0; sample < noiseSamples.length; sample += 1) noiseSamples[sample] = Math.random() * 2 - 1;

      ambientOscillator = audioContext.createOscillator();
      const ambientGain = audioContext.createGain();
      ambientOscillator.type = "sine";
      ambientOscillator.frequency.value = 47;
      ambientGain.gain.value = 0.08;
      ambientOscillator.connect(ambientGain).connect(masterGain);
      ambientOscillator.start();
    }
    if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
  }

  function playBurst({ durationSec = 0.12, frequencyHz = 650, volume = 0.6, playbackRate = 1 }) {
    if (!audioContext || audioContext.state !== "running" || muted || activeVoices >= MAX_SIMULTANEOUS_VOICES) return;
    const noiseSource = audioContext.createBufferSource();
    const lowpassFilter = audioContext.createBiquadFilter();
    const burstGain = audioContext.createGain();
    const nowSec = audioContext.currentTime;
    noiseSource.buffer = noiseBuffer;
    noiseSource.playbackRate.value = playbackRate;
    lowpassFilter.type = "lowpass";
    lowpassFilter.frequency.setValueAtTime(frequencyHz, nowSec);
    lowpassFilter.frequency.exponentialRampToValueAtTime(70, nowSec + durationSec);
    burstGain.gain.setValueAtTime(volume, nowSec);
    burstGain.gain.exponentialRampToValueAtTime(0.001, nowSec + durationSec);
    noiseSource.connect(lowpassFilter).connect(burstGain).connect(masterGain);
    activeVoices += 1;
    noiseSource.onended = () => {
      activeVoices -= 1;
      noiseSource.disconnect();
      lowpassFilter.disconnect();
      burstGain.disconnect();
    };
    noiseSource.start(nowSec);
    noiseSource.stop(nowSec + durationSec);
  }

  function playWeapon(weaponIndex, volume = 1) {
    const weaponBursts = [
      { durationSec: 0.13, frequencyHz: 2300, volume: 0.68 },
      { durationSec: 0.09, frequencyHz: 3600, volume: 0.44 },
      { durationSec: 0.28, frequencyHz: 1400, volume: 0.92 },
      { durationSec: 0.2, frequencyHz: 340, volume: 0.82 },
      { durationSec: 0.42, frequencyHz: 700, volume: 0.94 },
    ];
    const burst = weaponBursts[weaponIndex] || weaponBursts[0];
    playBurst({ ...burst, volume: burst.volume * volume });
  }

  return {
    unlock,
    toggleMute() {
      muted = !muted;
      if (masterGain) masterGain.gain.value = muted ? 0 : AUDIO_VOLUME;
      if (!muted) unlock();
      return muted;
    },
    reset() { lastEventId = 0; nextLocalShotAtSec = 0; },
    /** Immediate local sound, confirmed remote combat, and distance-attenuated effects. */
    update({ snapshot, playerId, input, timeSec, moving }) {
      if (!audioContext || muted || !snapshot) return;
      const playerState = snapshot.players[playerId];
      if (!playerState) return;
      const weaponSettings = DEAD_SHIFT_WEAPONS[input.weapon] || DEAD_SHIFT_WEAPONS[0];
      if (input.fire && snapshot.started && !snapshot.gameOver && playerState.health > 0 &&
          snapshot.players.p1.connected && snapshot.players.p2.connected && playerState.reloadRemaining <= 0 &&
          playerState.ammo > 0 && timeSec >= nextLocalShotAtSec) {
        playWeapon(input.weapon);
        nextLocalShotAtSec = timeSec + weaponSettings.fireIntervalSec;
      }
      if (moving && playerState.y <= 0.02 && playerState.health > 0 && timeSec >= nextStepAtSec) {
        playBurst({ durationSec: 0.06, frequencyHz: 220, volume: 0.16 });
        nextStepAtSec = timeSec + (input.sprint ? 0.28 : 0.4);
      }
      for (const gameEvent of snapshot.events) {
        if (gameEvent.id <= lastEventId) continue;
        const distance = Math.hypot(gameEvent.x - playerState.x, gameEvent.z - playerState.z);
        const volume = Math.max(0.04, 1 - distance / 32);
        if (gameEvent.kind === "shot" && gameEvent.actorId !== playerId) playWeapon(gameEvent.weapon, volume * 0.5);
        if (gameEvent.kind === "explosion") playBurst({ durationSec: 0.55, frequencyHz: 420, volume: volume * 0.9 });
        if (["hit", "headshot"].includes(gameEvent.kind) && gameEvent.actorId === playerId) playBurst({ durationSec: 0.04, frequencyHz: 2500, volume: 0.18 });
        if (gameEvent.kind === "damage") playBurst({ durationSec: 0.18, frequencyHz: 170, volume: volume * 0.4 });
      }
      lastEventId = Math.max(lastEventId, ...snapshot.events.map((gameEvent) => gameEvent.id));
    },
    dispose() {
      disposed = true;
      ambientOscillator?.stop();
      if (audioContext && audioContext.state !== "closed") audioContext.close().catch(() => {});
    },
  };
}
