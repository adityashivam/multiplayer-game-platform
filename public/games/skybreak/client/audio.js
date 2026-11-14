/** @typedef {import("./matchEvents.js").SkybreakEvent} SkybreakEvent */
/** @typedef {import("./snapshotPose.js").SkybreakPresentedJet} SkybreakPresentedJet */

const MASTER_VOLUME = 0.3;
const RAMP_SEC = 0.06;
const CANNON_INTERVAL_SEC = 0.075;

/**
 * Synthesized cockpit sound: turbine roar, afterburner, cannon, lock and
 * missile-warning tones, hits and explosions. Starts after a user gesture;
 * failures stay silent.
 */
export function createSkybreakAudio() {
  /** @type {AudioContext|null} */
  let context = null;
  let master = null;
  let roarGain = null;
  let roarFilter = null;
  let whine = null;
  let whineGain = null;
  let toneGain = null;
  let tone = null;
  let noiseBuffer = null;
  let muted = false;
  let nextCannonAt = 0;
  let toneOn = false;

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
      noiseBuffer = context.createBuffer(1, context.sampleRate * 2, context.sampleRate);
      const samples = noiseBuffer.getChannelData(0);
      let brown = 0;
      for (let index = 0; index < samples.length; index += 1) {
        brown = (brown + 0.02 * (Math.random() * 2 - 1)) / 1.02;
        samples[index] = brown * 3.5;
      }
      const roar = context.createBufferSource();
      roar.buffer = noiseBuffer;
      roar.loop = true;
      roarFilter = context.createBiquadFilter();
      roarFilter.type = "lowpass";
      roarFilter.frequency.value = 500;
      roarGain = context.createGain();
      roarGain.gain.value = 0;
      roar.connect(roarFilter).connect(roarGain).connect(master);
      roar.start();
      whine = context.createOscillator();
      whine.type = "sawtooth";
      whine.frequency.value = 900;
      whineGain = context.createGain();
      whineGain.gain.value = 0;
      const whineFilter = context.createBiquadFilter();
      whineFilter.type = "bandpass";
      whineFilter.frequency.value = 1400;
      whine.connect(whineFilter).connect(whineGain).connect(master);
      whine.start();
      tone = context.createOscillator();
      tone.type = "square";
      tone.frequency.value = 880;
      toneGain = context.createGain();
      toneGain.gain.value = 0;
      tone.connect(toneGain).connect(master);
      tone.start();
    } catch {
      context = null;
    }
  }

  /** @param {number} durationSec @param {number} filterHz @param {number} volume @param {number} [when] */
  function playNoise(durationSec, filterHz, volume, when = context.currentTime) {
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    source.buffer = noiseBuffer;
    filter.type = "lowpass";
    filter.frequency.value = filterHz;
    gain.gain.setValueAtTime(volume, when);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + durationSec);
    source.connect(filter).connect(gain).connect(master);
    source.start(when, Math.random());
    source.stop(when + durationSec + 0.05);
  }

  /** @param {number} fromHz @param {number} toHz @param {number} durationSec @param {number} volume */
  function playTone(fromHz, toHz, durationSec, volume) {
    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.setValueAtTime(fromHz, now);
    oscillator.frequency.exponentialRampToValueAtTime(toHz, now + durationSec);
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);
    oscillator.connect(gain).connect(master);
    oscillator.start(now);
    oscillator.stop(now + durationSec + 0.05);
  }

  return {
    unlock,
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : MASTER_VOLUME;
      return muted;
    },
    /**
     * @param {{jet:SkybreakPresentedJet|null,firing:boolean,lockState:"none"|"tracking"|"locked",threat:"none"|"lock"|"incoming",events:readonly SkybreakEvent[],playerId:string,timeSec:number}} frame
     */
    update({ jet, firing, lockState, threat, events, playerId, timeSec }) {
      if (!context || context.state !== "running" || muted) return;
      try {
        const now = context.currentTime;
        const alive = Boolean(jet?.alive);
        const speed = jet?.speed ?? 0;
        roarGain.gain.setTargetAtTime(alive ? 0.22 + (jet.boosting ? 0.25 : 0) : 0, now, RAMP_SEC);
        roarFilter.frequency.setTargetAtTime(alive ? 350 + speed * 2 + (jet.boosting ? 900 : 0) : 200, now, RAMP_SEC);
        whineGain.gain.setTargetAtTime(alive ? 0.025 : 0, now, RAMP_SEC);
        whine.frequency.setTargetAtTime(700 + speed * 3, now, RAMP_SEC);
        if (firing && alive) {
          if (nextCannonAt < now) nextCannonAt = now;
          while (nextCannonAt < now + 0.1) {
            playNoise(0.05, 2500, 0.2, nextCannonAt);
            nextCannonAt += CANNON_INTERVAL_SEC;
          }
        }
        const beepOn = threat === "incoming" ? Math.floor(timeSec * 8) % 2 === 0
          : threat === "lock" ? Math.floor(timeSec * 3) % 2 === 0
          : lockState === "locked" ? true
          : lockState === "tracking" ? Math.floor(timeSec * 6) % 2 === 0 : false;
        const toneHz = threat !== "none" ? (threat === "incoming" ? 1250 : 980) : 1500;
        if (beepOn !== toneOn) {
          toneGain.gain.setTargetAtTime(beepOn ? 0.05 : 0, now, 0.01);
          toneOn = beepOn;
        }
        tone.frequency.setTargetAtTime(toneHz, now, 0.01);
        for (const event of events) {
          const mine = event.jetId === playerId;
          if (event.kind === "hitConfirm" && mine) playTone(2200, 1800, 0.05, 0.15);
          else if (event.kind === "hit" && mine) playNoise(0.12, 900, 0.35);
          else if (event.kind === "explode") playNoise(mine ? 1.4 : 0.8, mine ? 700 : 400, mine ? 0.8 : 0.35);
          else if (event.kind === "missileLaunch" && mine) playNoise(0.7, 3000, 0.4);
          else if (event.kind === "flare" && mine) playNoise(0.3, 4000, 0.25);
          else if (event.kind === "gate" && mine) playTone(880, 1320, 0.18, 0.25);
          else if (event.kind === "runFinish" && mine) playTone(660, 1320, 0.6, 0.3);
        }
      } catch {
        // Audio is decoration; a failed node must never interrupt the frame.
      }
    },
    dispose() {
      context?.close().catch(() => {});
      context = null;
    },
  };
}
